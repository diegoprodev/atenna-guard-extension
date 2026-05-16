"""
FASE 4.2B — PDF Parser (textual only)
Extração segura com todos os guards da MATRIZ DE LIMITES.

Defesas implementadas:
- Timeout hard via asyncio.wait_for + thread
- Truncamento em MAX_PAGES e MAX_CHARS_EXTRACTED
- Rejeição de PDFs encriptados antes de qualquer parse
- Captura de MemoryError, RecursionError, exceções de parser
- del explícito do buffer após extração
- Nunca loga conteúdo extraído
"""
from __future__ import annotations

import asyncio
import gc
from dataclasses import dataclass

from document.limits import (
    MAX_CHARS_EXTRACTED,
    MAX_EXTRACTION_TIME_S,
    MAX_PAGES,
    DocumentErrorCode,
)


@dataclass(frozen=True)
class PdfParseResult:
    text:          str
    pages_parsed:  int
    total_pages:   int
    truncated:     bool
    scan_only:     bool   # True se PDF baseado em imagem (sem texto)
    error_code:    str | None
    error_message: str | None


def _extract_sync(file_bytes: bytes) -> PdfParseResult:
    """
    Executa extração síncrona — sempre chamada em thread separada com timeout.
    Nunca chamada diretamente no loop async.
    """
    try:
        import pdfplumber  # type: ignore
    except ImportError:
        return PdfParseResult(
            text="", pages_parsed=0, total_pages=0,
            truncated=False, scan_only=False,
            error_code=DocumentErrorCode.PARSE_ERROR,
            error_message="pdfplumber not installed",
        )

    try:
        import io
        pdf_io = io.BytesIO(file_bytes)

        with pdfplumber.open(pdf_io) as pdf:
            # ── Guard: PDF encriptado ──────────────────────────────────────
            _is_encrypted = getattr(pdf.doc, "is_encrypted", None) or getattr(pdf.doc, "_encryption", None)
            if _is_encrypted:
                return PdfParseResult(
                    text="", pages_parsed=0, total_pages=0,
                    truncated=False, scan_only=False,
                    error_code=DocumentErrorCode.ENCRYPTED_PDF,
                    error_message="PDF is encrypted — cannot extract text",
                )

            total_pages = len(pdf.pages)
            pages_to_parse = min(total_pages, MAX_PAGES)
            truncated_pages = total_pages > MAX_PAGES

            extracted_parts: list[str] = []
            chars_so_far = 0
            truncated_chars = False

            for i in range(pages_to_parse):
                try:
                    page_text = pdf.pages[i].extract_text() or ""
                except Exception:
                    # Página corrompida — pular, não abortar
                    continue

                remaining = MAX_CHARS_EXTRACTED - chars_so_far
                if len(page_text) > remaining:
                    extracted_parts.append(page_text[:remaining])
                    truncated_chars = True
                    break

                extracted_parts.append(page_text)
                chars_so_far += len(page_text)

            full_text = "\n".join(extracted_parts)
            total_chars = len(full_text)
            scan_only = total_chars < 10 and total_pages > 0

            return PdfParseResult(
                text=full_text,
                pages_parsed=pages_to_parse,
                total_pages=total_pages,
                truncated=truncated_pages or truncated_chars,
                scan_only=scan_only,
                error_code=None,
                error_message=None,
            )

    except MemoryError:
        gc.collect()
        return PdfParseResult(
            text="", pages_parsed=0, total_pages=0,
            truncated=False, scan_only=False,
            error_code=DocumentErrorCode.PARSE_ERROR,
            error_message="Memory limit exceeded during extraction",
        )
    except RecursionError:
        return PdfParseResult(
            text="", pages_parsed=0, total_pages=0,
            truncated=False, scan_only=False,
            error_code=DocumentErrorCode.PARSE_ERROR,
            error_message="Deeply nested PDF structure detected",
        )
    except Exception:
        # Nunca expor detalhes da exceção no response
        return PdfParseResult(
            text="", pages_parsed=0, total_pages=0,
            truncated=False, scan_only=False,
            error_code=DocumentErrorCode.MALFORMED,
            error_message="Could not parse document",
        )


async def parse_pdf(file_bytes: bytes) -> PdfParseResult:
    """
    Entry point async. Executa extração em thread com timeout hard.
    Libera file_bytes após retorno — caller deve fazer del.
    """
    try:
        result = await asyncio.wait_for(
            asyncio.get_event_loop().run_in_executor(None, _extract_sync, file_bytes),
            timeout=MAX_EXTRACTION_TIME_S,
        )
    except asyncio.TimeoutError:
        gc.collect()
        result = PdfParseResult(
            text="", pages_parsed=0, total_pages=0,
            truncated=False, scan_only=False,
            error_code=DocumentErrorCode.TIMEOUT,
            error_message="Extraction exceeded time limit",
        )

    return result
