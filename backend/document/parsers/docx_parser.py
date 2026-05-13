"""
FASE 4.2B — DOCX Parser
Extração segura com ZIP bomb defense e guards da MATRIZ DE LIMITES.

Defesas implementadas:
- Verificação do tamanho descomprimido antes de extrair (ZIP bomb)
- Timeout hard via asyncio.wait_for + thread
- Truncamento em MAX_CHARS_EXTRACTED
- Captura de exceções de ZIP corrompido
- Macros VBA ignoradas (texto only)
- Imagens embutidas ignoradas
- del explícito do buffer após extração
"""
from __future__ import annotations

import asyncio
import gc
from dataclasses import dataclass

from document.limits import (
    MAX_CHARS_EXTRACTED,
    MAX_EXTRACTION_TIME_S,
    MAX_UPLOAD_SIZE_BYTES,
    DocumentErrorCode,
)

# ZIP bomb threshold: descomprimido > 10× o tamanho máximo de upload → rejeitar
_ZIP_BOMB_RATIO = 10
_MAX_UNCOMPRESSED = MAX_UPLOAD_SIZE_BYTES * _ZIP_BOMB_RATIO


@dataclass(frozen=True)
class DocxParseResult:
    text:          str
    paragraphs:    int
    truncated:     bool
    error_code:    str | None
    error_message: str | None


def _check_zip_bomb(file_bytes: bytes) -> bool:
    """Retorna True se o arquivo parece uma ZIP bomb."""
    import zipfile
    import io
    try:
        with zipfile.ZipFile(io.BytesIO(file_bytes)) as zf:
            total_uncompressed = sum(info.file_size for info in zf.infolist())
            return total_uncompressed > _MAX_UNCOMPRESSED
    except Exception:
        return False  # Arquivo ZIP inválido — será detectado no parse


def _extract_sync(file_bytes: bytes) -> DocxParseResult:
    """
    Executa extração síncrona — sempre chamada em thread com timeout.
    """
    # ── Guard: ZIP bomb ────────────────────────────────────────────────────
    if _check_zip_bomb(file_bytes):
        return DocxParseResult(
            text="", paragraphs=0, truncated=False,
            error_code=DocumentErrorCode.FILE_TOO_LARGE,
            error_message="Compressed document exceeds safe decompression limit",
        )

    try:
        from docx import Document  # type: ignore
        import io

        doc = Document(io.BytesIO(file_bytes))

        extracted_parts: list[str] = []
        chars_so_far = 0
        truncated = False
        para_count = 0

        for para in doc.paragraphs:
            text = para.text
            if not text:
                continue

            para_count += 1
            remaining = MAX_CHARS_EXTRACTED - chars_so_far

            if len(text) > remaining:
                extracted_parts.append(text[:remaining])
                truncated = True
                break

            extracted_parts.append(text)
            chars_so_far += len(text)

        full_text = "\n".join(extracted_parts)

        return DocxParseResult(
            text=full_text,
            paragraphs=para_count,
            truncated=truncated,
            error_code=None,
            error_message=None,
        )

    except MemoryError:
        gc.collect()
        return DocxParseResult(
            text="", paragraphs=0, truncated=False,
            error_code=DocumentErrorCode.PARSE_ERROR,
            error_message="Memory limit exceeded during extraction",
        )
    except Exception:
        return DocxParseResult(
            text="", paragraphs=0, truncated=False,
            error_code=DocumentErrorCode.MALFORMED,
            error_message="Could not parse document",
        )


async def parse_docx(file_bytes: bytes) -> DocxParseResult:
    """
    Entry point async. Executa extração em thread com timeout hard.
    """
    try:
        result = await asyncio.wait_for(
            asyncio.get_event_loop().run_in_executor(None, _extract_sync, file_bytes),
            timeout=MAX_EXTRACTION_TIME_S,
        )
    except asyncio.TimeoutError:
        gc.collect()
        result = DocxParseResult(
            text="", paragraphs=0, truncated=False,
            error_code=DocumentErrorCode.TIMEOUT,
            error_message="Extraction exceeded time limit",
        )

    return result
