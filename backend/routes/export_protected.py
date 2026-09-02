"""
POST /document/export-protected
Feature Pro — gera versao protegida do documento com dados sensiveis
removidos/mascarados, preservando ao maximo o formato original.

Formatos suportados:
  PDF  -> redaction permanente (PyMuPDF) — tarjas pretas removem texto copiavel
  DOCX -> substituicao mantendo estrutura de runs/tabelas (python-docx)
  XLSX -> masking por celula preservando workbook/estilos (openpyxl)
  CSV/TXT/MD/JSON -> texto mascarado pelo DLP scanner

Fallback seguro: se redacao falhar, retorna TXT mascarado com aviso.
"""
from __future__ import annotations

import asyncio
import time
import urllib.parse
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Request, UploadFile
from fastapi.responses import Response

from dlp.rate_limit import get_user_plan
from dlp.scanner import scan as dlp_scan
from document.parsers.pdf_parser_v2 import parse_pdf_v2 as parse_pdf
from document.parsers.docx_parser import parse_docx
from document.parsers.xlsx_parser import parse_xlsx
from document.parsers.csv_parser import parse_csv
from document.parsers.doc_parser import parse_doc
from document.redactors.pdf_redactor import redact_pdf
from document.redactors.docx_redactor import redact_docx
from document.redactors.xlsx_redactor import redact_xlsx
from document.redactors.txt_redactor import redact_text
from middleware.auth import require_auth
from services.error_reporter import log_error

router = APIRouter(prefix="/document", tags=["document-export"])

SUPPORTED = {"pdf", "docx", "doc", "xlsx", "xls", "csv", "txt", "md", "json"}
MAX_SIZE = 50 * 1024 * 1024  # 50 MB

CONTENT_TYPES = {
    "pdf":  "application/pdf",
    "docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "csv":  "text/csv; charset=utf-8",
    "txt":  "text/plain; charset=utf-8",
    "md":   "text/plain; charset=utf-8",
    "json": "application/json; charset=utf-8",
}


@router.post("/export-protected")
async def export_protected(
    file: UploadFile,
    request: Request,
    _user: dict = Depends(require_auth),
):
    t0 = time.monotonic()
    user_id = _user.get("sub") or _user.get("id")
    user_email = _user.get("email")

    # Verificar plano Pro
    plan = get_user_plan(user_id) if user_id else "free"
    if plan != "pro":
        raise HTTPException(
            403,
            detail={
                "error": "pro_required",
                "message": "Exportar documento protegido e uma feature Pro. Faca upgrade para continuar.",
                "upgrade_url": "https://atenna.ai/pricing",
            },
        )

    if not file or not file.filename:
        raise HTTPException(400, "Arquivo invalido")

    ext = (file.filename.rsplit(".", 1)[-1] or "").lower()
    if ext not in SUPPORTED:
        raise HTTPException(400, f"Tipo nao suportado: .{ext}")

    try:
        file_bytes = await file.read()
    except Exception:
        raise HTTPException(400, "Falha ao ler arquivo")

    if len(file_bytes) > MAX_SIZE:
        raise HTTPException(413, "Arquivo muito grande (maximo 50 MB)")

    original_name = file.filename
    base_name = original_name.rsplit(".", 1)[0] if "." in original_name else original_name

    # Extracao de texto
    result = None
    extracted: Optional[str] = None

    try:
        if ext == "pdf":
            result = await parse_pdf(file_bytes)
            extracted = result.text
        elif ext == "docx":
            result = await parse_docx(file_bytes)
            extracted = result.text
        elif ext == "doc":
            result = await parse_doc(file_bytes)
            extracted = result.text
        elif ext in ("xlsx", "xls"):
            result = await parse_xlsx(file_bytes)
            extracted = result.text
        elif ext == "csv":
            result = await parse_csv(file_bytes)
            extracted = result.text
        else:
            extracted = file_bytes.decode("utf-8", errors="replace")
    except Exception as e:
        await log_error(
            endpoint="/document/export-protected",
            error_type="parse_error",
            error_message=str(e)[:500],
            severity="error",
            user_id=user_id,
            user_email=user_email,
        )
        raise HTTPException(422, "Falha ao extrair texto do documento.")

    if not extracted or not extracted.strip():
        raise HTTPException(422, "Nenhum texto extraido. O documento pode estar em branco ou ser apenas imagem.")

    # DLP scan
    try:
        scan_result = await asyncio.get_event_loop().run_in_executor(
            None, dlp_scan, extracted
        )
    except Exception as e:
        await log_error(
            endpoint="/document/export-protected",
            error_type="dlp_error",
            error_message=str(e)[:500],
            severity="error",
            user_id=user_id,
            user_email=user_email,
        )
        raise HTTPException(500, "Erro no processamento de seguranca.")

    findings = scan_result.findings
    masked_content = scan_result.masked_content
    risk_level = scan_result.risk_level.value if hasattr(scan_result.risk_level, "value") else str(scan_result.risk_level)

    t_dlp = time.monotonic() - t0

    # Aplicar redacao
    output_ext = ext
    output_bytes: Optional[bytes] = None
    fallback_used = False
    redaction_report = None

    try:
        if ext == "pdf":
            output_bytes, redaction_report = await asyncio.get_event_loop().run_in_executor(
                None, redact_pdf, file_bytes, findings, extracted
            )
        elif ext == "docx":
            output_bytes = await asyncio.get_event_loop().run_in_executor(
                None, redact_docx, file_bytes, findings, extracted
            )
        elif ext in ("xlsx", "xls"):
            output_ext = "xlsx"
            output_bytes = await asyncio.get_event_loop().run_in_executor(
                None, redact_xlsx, file_bytes, findings, extracted
            )
        else:
            output_bytes = redact_text(masked_content)

    except Exception as e:
        await log_error(
            endpoint="/document/export-protected",
            error_type="redaction_error",
            error_message=str(e)[:500],
            severity="warning",
            user_id=user_id,
            user_email=user_email,
        )
        # Fallback seguro: TXT mascarado
        output_bytes = redact_text(masked_content)
        output_ext = "txt"
        fallback_used = True

    t_total = time.monotonic() - t0

    print(
        f"[EXPORT-PROTECTED] user={user_id} ext={ext} "
        f"findings={len(findings)} risk={risk_level} "
        f"fallback={fallback_used} t={t_total:.1f}s",
        flush=True,
    )

    # Headers de download
    safe_base = base_name.encode("ascii", errors="ignore").decode("ascii") or "documento"
    download_name = f"{safe_base}_protegido.{output_ext}"
    encoded_name = urllib.parse.quote(f"{base_name}_protegido.{output_ext}")

    content_type = CONTENT_TYPES.get(output_ext, "application/octet-stream")

    headers = {
        "Content-Disposition": (
            f'attachment; filename="{download_name}"; '
            f"filename*=UTF-8''{encoded_name}"
        ),
        "X-Findings-Count": str(len(findings)),
        "X-Risk-Level": risk_level,
        "X-Fallback-Used": "1" if fallback_used else "0",
        "X-Processing-Time-Ms": str(int(t_total * 1000)),
    }
    if redaction_report:
        headers["X-Redaction-Applied"] = str(redaction_report.applied)
        headers["X-Redaction-Skipped"] = str(redaction_report.skipped)
        headers["X-Needs-Review"] = "1" if redaction_report.needs_review else "0"

    return Response(
        content=output_bytes,
        media_type=content_type,
        headers=headers,
    )
