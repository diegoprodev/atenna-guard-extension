"""
FASE 4.2D — Upload de arquivos grandes via CF R2 (>10MB, até 50MB).

Flow:
  1. POST /document/upload-url  → gera presigned PUT URL no R2
  2. Browser faz PUT direto no R2 (sem passar pelo VPS)
  3. POST /document/parse-r2    → VPS baixa do R2, parseia, faz DLP, deleta do R2
  4. Response: mesma estrutura do /document/upload (DocumentScanResponse)

Segurança:
  - Presigned URL válida por 5 minutos
  - Objeto deletado imediatamente após parse
  - Lifecycle rule: delete após 1 dia (fallback)
  - Extensão validada antes de gerar URL
  - Parse usa os mesmos parsers e guards do upload direto
"""
from __future__ import annotations

import os
from typing import Any

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from middleware.auth import require_auth
from document.limits import ALLOWED_EXTENSIONS, MAX_CONCURRENT_PARSES, DocumentErrorCode
from document.sanitizer import chunk_text, cleanup_buffers, build_safe_summary
from document.parsers.pdf_parser import parse_pdf
from document.parsers.docx_parser import parse_docx
from document.parsers.xlsx_parser import parse_xlsx
from document.parsers.csv_parser import parse_csv
from dlp.policy import evaluate
import document.observability as obs

try:
    from storage.r2_client import generate_upload_url, download_for_parse, delete_object, is_configured
    _R2_AVAILABLE = True
except ImportError:
    _R2_AVAILABLE = False

import asyncio

router = APIRouter(prefix="/document", tags=["Document DLP Large"])

_ENABLED: bool = os.getenv("DOCUMENT_UPLOAD_ENABLED", "false").lower() == "true"
_LARGE_UPLOAD_ENABLED: bool = os.getenv("LARGE_UPLOAD_ENABLED", "false").lower() == "true"
_MAX_LARGE_FILE_MB = 50

_semaphore = asyncio.Semaphore(MAX_CONCURRENT_PARSES)

# ── Content-type map ──────────────────────────────────────────────────────────
_EXT_CONTENT_TYPE: dict[str, str] = {
    ".pdf":  "application/pdf",
    ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    ".csv":  "text/csv",
}


class UploadUrlRequest(BaseModel):
    filename: str
    size_bytes: int


class UploadUrlResponse(BaseModel):
    upload_url: str
    key: str
    expires_in: int


class ParseR2Request(BaseModel):
    key: str
    filename: str


# ── POST /document/upload-url ─────────────────────────────────────────────────

@router.post("/upload-url", response_model=UploadUrlResponse)
async def get_upload_url(
    body: UploadUrlRequest,
    _user: dict[str, Any] = Depends(require_auth),
) -> UploadUrlResponse:
    """Gera presigned PUT URL no R2 para upload direto do browser."""
    if not _ENABLED or not _LARGE_UPLOAD_ENABLED:
        raise HTTPException(503, {"error": "feature_disabled"})
    if not _R2_AVAILABLE or not is_configured():
        raise HTTPException(503, {"error": "storage_not_configured"})

    ext = "." + body.filename.rsplit(".", 1)[-1].lower() if "." in body.filename else ""
    if ext not in ALLOWED_EXTENSIONS:
        raise HTTPException(422, {"error": DocumentErrorCode.UNSUPPORTED_TYPE})

    max_bytes = _MAX_LARGE_FILE_MB * 1024 * 1024
    if body.size_bytes > max_bytes:
        raise HTTPException(413, {"error": DocumentErrorCode.FILE_TOO_LARGE,
                                   "message": f"File exceeds {_MAX_LARGE_FILE_MB}MB limit"})

    user_id = _user.get("id") or _user.get("sub") or "anon"
    content_type = _EXT_CONTENT_TYPE.get(ext, "application/octet-stream")

    result = generate_upload_url(user_id, body.filename, content_type)
    return UploadUrlResponse(**result)


# ── POST /document/parse-r2 ───────────────────────────────────────────────────

@router.post("/parse-r2")
async def parse_r2_object(
    body: ParseR2Request,
    _user: dict[str, Any] = Depends(require_auth),
) -> dict:
    """
    VPS baixa objeto do R2, parseia e faz DLP.
    Objeto é deletado do R2 imediatamente após download.
    """
    if not _ENABLED or not _LARGE_UPLOAD_ENABLED:
        raise HTTPException(503, {"error": "feature_disabled"})
    if not _R2_AVAILABLE or not is_configured():
        raise HTTPException(503, {"error": "storage_not_configured"})

    # Validate key belongs to this user
    user_id = _user.get("id") or _user.get("sub") or ""
    if user_id and f"uploads/{user_id}/" not in body.key:
        raise HTTPException(403, {"error": "forbidden"})

    ext = "." + body.filename.rsplit(".", 1)[-1].lower() if "." in body.filename else ""
    if ext not in ALLOWED_EXTENSIONS:
        raise HTTPException(422, {"error": DocumentErrorCode.UNSUPPORTED_TYPE})

    # Download from R2
    try:
        file_bytes = await asyncio.get_event_loop().run_in_executor(
            None, download_for_parse, body.key
        )
    except Exception:
        raise HTTPException(404, {"error": "object_not_found"})

    # Delete immediately — parse happens in memory
    await asyncio.get_event_loop().run_in_executor(None, delete_object, body.key)

    filetype = ext.lstrip(".")

    # Parse (same logic as /document/upload)
    async with _semaphore:
        with obs.parse_context(filetype):
            if filetype == "pdf":
                parse_result: Any = await parse_pdf(file_bytes)
                pages_parsed = parse_result.pages_parsed
                truncated = parse_result.truncated
                scan_only = parse_result.scan_only
                extracted_text = parse_result.text
            elif filetype == "docx":
                parse_result = await parse_docx(file_bytes)
                pages_parsed = 1; truncated = parse_result.truncated
                scan_only = False; extracted_text = parse_result.text
            elif filetype == "xlsx":
                parse_result = await parse_xlsx(file_bytes)
                pages_parsed = parse_result.sheets
                truncated = parse_result.truncated
                scan_only = False; extracted_text = parse_result.text
            else:
                parse_result = await parse_csv(file_bytes)
                pages_parsed = 1; truncated = parse_result.truncated
                scan_only = False; extracted_text = parse_result.text

    del file_bytes
    cleanup_buffers()

    if parse_result.error_code:
        raise HTTPException(422, {"error": parse_result.error_code,
                                   "message": parse_result.error_message})

    # DLP scan
    findings_agg: dict = {}
    max_risk = "NONE"
    overall_blocked = False
    block_reason: str | None = None

    if extracted_text and not scan_only:
        from dlp.types import RISK_ORDER
        for chunk in chunk_text(extracted_text):
            policy = evaluate(chunk, strict_mode=False)
            for f in policy.findings:
                key = f.entity_type.value
                existing = findings_agg.get(key)
                if existing:
                    existing["count"] += 1
                else:
                    findings_agg[key] = {"entity_type": key, "risk_level": f.risk_level.value,
                                          "count": 1, "placeholder": f.placeholder}
            if RISK_ORDER.get(policy.max_risk.value, 0) > RISK_ORDER.get(max_risk, 0):
                max_risk = policy.max_risk.value
            if policy.blocked and not overall_blocked:
                overall_blocked = True; block_reason = policy.block_reason
        del extracted_text
        cleanup_buffers()
    else:
        del extracted_text

    findings_list = list(findings_agg.values())
    masked_summary = build_safe_summary(" ".join(f["placeholder"] for f in findings_list))

    return {
        "filename": body.filename,
        "pages_parsed": pages_parsed,
        "truncated": truncated,
        "scan_only": scan_only,
        "findings": findings_list,
        "risk_level": max_risk,
        "blocked": overall_blocked,
        "block_reason": block_reason,
        "masked_summary": masked_summary,
    }
