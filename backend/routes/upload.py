"""
FASE 4.2B — Upload Document Endpoint
Gated por feature flag DOCUMENT_UPLOAD_ENABLED (default: false).

IMPORTANTE: NÃO ativar em produção antes do stress harness passar 100%.
Ver: docs/specs/FASE_4.2B_DOCUMENT_LIMITS_MATRIX.md
"""
from __future__ import annotations

import asyncio
import os
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, UploadFile, File
from pydantic import BaseModel

from middleware.auth import require_auth
from document.limits import (
    MAX_UPLOAD_SIZE_BYTES,
    MAX_CONCURRENT_PARSES,
    DocumentErrorCode,
)
from document.sanitizer import validate_upload, chunk_text, cleanup_buffers, build_safe_summary
from document.parsers.pdf_parser import parse_pdf
from document.parsers.docx_parser import parse_docx
from dlp.policy import evaluate
import document.observability as obs

router = APIRouter(prefix="/document", tags=["Document DLP"])

# ── Feature flag — lido uma vez no startup ────────────────────────────────────
_ENABLED: bool = os.getenv("DOCUMENT_UPLOAD_ENABLED", "false").lower() == "true"

# ── Semáforo de concorrência ──────────────────────────────────────────────────
_semaphore = asyncio.Semaphore(MAX_CONCURRENT_PARSES)


# ── Response models ───────────────────────────────────────────────────────────

class DocumentFinding(BaseModel):
    entity_type:  str
    risk_level:   str
    count:        int
    placeholder:  str

class DocumentScanResponse(BaseModel):
    filename:        str
    file_size_bytes: int
    pages_parsed:    int
    chars_extracted: int
    truncated:       bool
    scan_only:       bool
    findings:        list[DocumentFinding]
    risk_level:      str
    blocked:         bool
    block_reason:    str | None
    masked_summary:  str


# ── Endpoint ──────────────────────────────────────────────────────────────────

@router.get("/metrics")
async def document_metrics(
    _user: dict[str, Any] = Depends(require_auth),
) -> dict:
    """
    Métricas internas do pipeline de documentos.
    Auth-gated — nunca exposto sem JWT válido.
    Usado para profiling VPS antes do rollout gradual.
    """
    if not _ENABLED:
        return {"status": "disabled", "metrics": {}}
    return {"status": "ok", "metrics": obs.snapshot()}


@router.post("/upload", response_model=DocumentScanResponse)
async def upload_document(
    file: UploadFile = File(...),
    _user: dict[str, Any] = Depends(require_auth),
) -> DocumentScanResponse:
    """
    Recebe PDF ou DOCX, extrai texto, aplica DLP scan e retorna findings.
    NUNCA retorna texto extraído — apenas findings e metadados.

    Feature flag: DOCUMENT_UPLOAD_ENABLED=true necessário.
    """
    if not _ENABLED:
        raise HTTPException(
            status_code=503,
            detail={
                "error": "feature_disabled",
                "message": "Document upload is not yet available.",
            },
        )

    # ── Guard: semáforo de concorrência ──────────────────────────────────────
    if _semaphore.locked() and _semaphore._value == 0:  # type: ignore[attr-defined]
        raise HTTPException(
            status_code=503,
            detail={"error": DocumentErrorCode.CAPACITY_EXCEEDED, "message": "Service at capacity. Try again shortly."},
        )

    filename = file.filename or "document"

    # ── Ler body com limite hard ──────────────────────────────────────────────
    # FastAPI não tem limite automático de body — lemos com guard manual
    file_bytes = await file.read(MAX_UPLOAD_SIZE_BYTES + 1)
    if len(file_bytes) > MAX_UPLOAD_SIZE_BYTES:
        raise HTTPException(
            status_code=413,
            detail={"error": DocumentErrorCode.FILE_TOO_LARGE, "message": "File exceeds size limit."},
        )

    file_size = len(file_bytes)

    # ── Validação de upload (mime, extensão, tamanho mínimo) ─────────────────
    validation = validate_upload(filename, file_bytes)
    if not validation.valid:
        del file_bytes
        obs.record_rejection(validation.error_code or "unknown")
        _status = 413 if validation.error_code == DocumentErrorCode.FILE_TOO_LARGE else 422
        raise HTTPException(
            status_code=_status,
            detail={"error": validation.error_code, "message": validation.error_message},
        )

    filetype = validation.filetype or "unknown"

    # ── Parse com semáforo de concorrência + observabilidade ─────────────────
    async with _semaphore:
        with obs.parse_context(filetype):
            if filetype == "pdf":
                parse_result: Any = await parse_pdf(file_bytes)
                pages_parsed  = parse_result.pages_parsed
                total_pages   = parse_result.total_pages
                truncated     = parse_result.truncated
                scan_only     = parse_result.scan_only
                extracted_text = parse_result.text
            else:
                parse_result = await parse_docx(file_bytes)
                pages_parsed  = 1
                total_pages   = 1
                truncated     = parse_result.truncated
                scan_only     = False
                extracted_text = parse_result.text

    # ── Liberar buffer original imediatamente ─────────────────────────────────
    with obs.cleanup_context():
        del file_bytes
        cleanup_buffers()

    # ── Tratar erros de parse ─────────────────────────────────────────────────
    if parse_result.error_code:
        obs.record_rejection(parse_result.error_code)
        if parse_result.error_code == DocumentErrorCode.TIMEOUT:
            obs.record_timeout()
        _status_map = {
            DocumentErrorCode.ENCRYPTED_PDF:    422,
            DocumentErrorCode.RESTRICTED_PDF:   422,
            DocumentErrorCode.MALFORMED:         422,
            DocumentErrorCode.TIMEOUT:           408,
            DocumentErrorCode.FILE_TOO_LARGE:    413,
            DocumentErrorCode.PARSE_ERROR:       422,
        }
        status_code = _status_map.get(parse_result.error_code, 422)
        raise HTTPException(
            status_code=status_code,
            detail={"error": parse_result.error_code, "message": parse_result.error_message},
        )

    # ── DLP scan por chunks ───────────────────────────────────────────────────
    chars_extracted = len(extracted_text)

    findings_agg: dict[str, DocumentFinding] = {}
    max_risk = "NONE"
    overall_blocked = False
    overall_block_reason: str | None = None

    if extracted_text and not scan_only:
        chunks = chunk_text(extracted_text)

        # Liberar texto completo antes do DLP — só precisamos dos chunks
        del extracted_text
        cleanup_buffers()

        from dlp.types import RISK_ORDER
        for chunk in chunks:
            policy = evaluate(chunk, strict_mode=False)

            # Agregar findings por tipo de entidade
            for f in policy.findings:
                key = f.entity_type.value
                if key in findings_agg:
                    existing = findings_agg[key]
                    findings_agg[key] = DocumentFinding(
                        entity_type=existing.entity_type,
                        risk_level=existing.risk_level,
                        count=existing.count + 1,
                        placeholder=existing.placeholder,
                    )
                else:
                    findings_agg[key] = DocumentFinding(
                        entity_type=key,
                        risk_level=f.risk_level.value,
                        count=1,
                        placeholder=f.placeholder,
                    )

            # Acumular risco máximo
            if RISK_ORDER.get(policy.max_risk.value, 0) > RISK_ORDER.get(max_risk, 0):
                max_risk = policy.max_risk.value

            if policy.blocked and not overall_blocked:
                overall_blocked = True
                overall_block_reason = policy.block_reason
    else:
        del extracted_text

    findings_list = list(findings_agg.values())

    # Registrar chars extraídos para observabilidade
    obs.record_extraction(chars_extracted)

    # Resumo seguro — nunca inclui texto original
    masked_summary = build_safe_summary(
        " ".join(f.placeholder for f in findings_list)
    )

    return DocumentScanResponse(
        filename=filename,
        file_size_bytes=file_size,
        pages_parsed=pages_parsed,
        chars_extracted=chars_extracted,
        truncated=truncated,
        scan_only=scan_only,
        findings=findings_list,
        risk_level=max_risk,
        blocked=overall_blocked,
        block_reason=overall_block_reason,
        masked_summary=masked_summary,
    )
