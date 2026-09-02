"""
POST /document/protect
Extrai texto de documento, aplica mascaramento DLP e retorna o texto
completo com dados sensíveis substituídos por placeholders canônicos.
O texto original nunca é persistido — apenas o texto mascarado é retornado.
"""

from fastapi import APIRouter, UploadFile, HTTPException, Depends, Request
from fastapi.responses import JSONResponse
import asyncio

from middleware.auth import require_auth
from document.parsers.pdf_parser_v2 import parse_pdf_v2 as parse_pdf
from document.parsers.docx_parser import parse_docx
from document.parsers.xlsx_parser import parse_xlsx
from document.parsers.csv_parser import parse_csv
from document.parsers.doc_parser import parse_doc
from dlp.scanner import scan as dlp_scan
from services.error_reporter import log_error

router = APIRouter(prefix="/document", tags=["document-protect"])

SUPPORTED = {"pdf", "docx", "doc", "xlsx", "xls", "csv", "txt", "md", "json"}
MAX_SIZE = 50 * 1024 * 1024  # 50 MB

# User-visible messages mapped from internal error codes
_USER_MESSAGES = {
    "extraction_timeout": "A extração do documento demorou demais. Tente com um arquivo menor.",
    "file_too_large": "Arquivo muito grande para processar.",
    "malformed_document": "Não foi possível ler o documento. Verifique se o arquivo não está corrompido.",
    "parse_error": "Erro ao processar o documento.",
    "gemini_quota": "Serviço de OCR temporariamente indisponível. Tente novamente em alguns minutos.",
    "gemini_unavailable": "Serviço de reconhecimento de imagens indisponível no momento.",
}


def _user_msg(error_code: str | None, fallback: str) -> str:
    if error_code and error_code in _USER_MESSAGES:
        return _USER_MESSAGES[error_code]
    return fallback


@router.post("/protect")
async def protect_document(
    file: UploadFile,
    request: Request,
    _user: dict = Depends(require_auth),
):
    user_id = _user.get("sub") or _user.get("id")
    user_email = _user.get("email")

    if not file or not file.filename:
        raise HTTPException(400, "Arquivo inválido")

    ext = (file.filename.rsplit(".", 1)[-1] or "").lower()
    if ext not in SUPPORTED:
        raise HTTPException(400, f"Tipo não suportado: .{ext}. Suportados: {', '.join(sorted(SUPPORTED))}")

    try:
        file_bytes = await file.read()
    except Exception:
        raise HTTPException(400, "Falha ao ler arquivo")

    if len(file_bytes) > MAX_SIZE:
        raise HTTPException(413, "Arquivo muito grande (máximo 50 MB)")

    # ── Extração de texto ─────────────────────────────────────────────────────
    result = None
    extracted = None

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
        else:  # txt, md, json
            extracted = file_bytes.decode("utf-8", errors="replace")

        if result is not None and getattr(result, "error_code", None):
            ec = result.error_code
            em = getattr(result, "error_message", "") or ""
            await log_error(
                endpoint="/document/protect",
                error_type=f"parser_{ec}",
                error_message=f"[{ext.upper()}] {em}",
                severity="error",
                user_id=user_id,
                user_email=user_email,
                context={"file_ext": ext, "file_size": len(file_bytes)},
            )
            raise HTTPException(422, _user_msg(ec, f"Falha ao processar documento: {em[:120]}"))

    except HTTPException:
        raise
    except Exception as e:
        em = str(e)
        # Detect Gemini quota/availability errors
        if "429" in em or "quota" in em.lower() or "RESOURCE_EXHAUSTED" in em:
            ec = "gemini_quota"
        elif "403" in em or "leaked" in em.lower() or "API key" in em:
            ec = "gemini_unavailable"
        else:
            ec = "parse_error"

        await log_error(
            endpoint="/document/protect",
            error_type=ec,
            error_message=em[:500],
            severity="error" if "quota" not in em.lower() else "warning",
            user_id=user_id,
            user_email=user_email,
            context={"file_ext": ext, "file_size": len(file_bytes)},
        )
        raise HTTPException(422, _user_msg(ec, f"Falha ao extrair texto: {em[:120]}"))
    finally:
        del file_bytes

    if not extracted or not extracted.strip():
        await log_error(
            endpoint="/document/protect",
            error_type="empty_extraction",
            error_message=f"[{ext.upper()}] extraction returned empty text",
            severity="warning",
            user_id=user_id,
            user_email=user_email,
        )
        raise HTTPException(422, "Nenhum texto foi extraído do arquivo. O documento pode estar em branco ou ser apenas imagem sem OCR disponível no momento.")

    # ── DLP mascaramento ─────────────────────────────────────────────────────
    # DLP local SEMPRE roda — garante detecção correta independente do método de extração
    try:
        scan_result = await asyncio.get_event_loop().run_in_executor(
            None, dlp_scan, extracted
        )
        masked_text = scan_result.masked_content
        risk_level  = scan_result.risk_level.value if hasattr(scan_result.risk_level, "value") else str(scan_result.risk_level)
        findings    = [
            {"entity_type": f.entity_type.value if hasattr(f.entity_type, "value") else str(f.entity_type),
             "value": extracted[f.start:f.end] if hasattr(f, "start") and f.start is not None else None,
             "count": 1}
            for f in scan_result.findings
        ]
        blocked     = scan_result.blocked
    except Exception as e:
        em = str(e)
        await log_error(
            endpoint="/document/protect",
            error_type="dlp_error",
            error_message=em[:500],
            severity="error",
            user_id=user_id,
            user_email=user_email,
        )
        raise HTTPException(500, "Erro no processamento de segurança do documento. Tente novamente.")
    finally:
        del extracted

    extraction_method = getattr(result, "extraction_method", "native") if result else "native"

    return JSONResponse({
        "masked_text":        masked_text,
        "risk_level":         risk_level,
        "findings_count":     len(findings),
        "findings":           findings,
        "blocked":            blocked,
        "char_count":         len(masked_text),
        "extraction_method":  extraction_method,
    })
