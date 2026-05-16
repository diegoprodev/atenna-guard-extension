"""
FASE 4.2B — Document Sanitizer
Memory cleanup, chunking para DLP e validação de entrada.

Responsabilidades:
1. Validar arquivo antes de qualquer parse (tamanho, MIME, extensão)
2. Dividir texto extraído em chunks para DLP scan
3. Cleanup explícito de buffers após uso
4. Nunca retornar texto extraído no response — apenas findings
"""
from __future__ import annotations

import gc
import os
from dataclasses import dataclass

from document.limits import (
    ALLOWED_EXTENSIONS,
    CHUNK_SIZE_CHARS,
    DOCX_MAGIC,
    MAX_CHUNKS,
    MAX_UPLOAD_SIZE_BYTES,
    MIN_FILE_SIZE_BYTES,
    PDF_MAGIC,
    DocumentErrorCode,
)


@dataclass(frozen=True)
class ValidationResult:
    valid:       bool
    filetype:    str | None   # "pdf" | "docx" | None
    error_code:  str | None
    error_message: str | None


def validate_upload(filename: str, file_bytes: bytes) -> ValidationResult:
    """
    Valida tamanho, extensão e magic bytes antes de qualquer parse.
    Detecta MIME spoof (extensão ≠ magic bytes).
    """
    size = len(file_bytes)

    # Guard: tamanho mínimo
    if size < MIN_FILE_SIZE_BYTES:
        return ValidationResult(
            valid=False, filetype=None,
            error_code=DocumentErrorCode.FILE_TOO_SMALL,
            error_message="File is empty or too small",
        )

    # Guard: tamanho máximo
    if size > MAX_UPLOAD_SIZE_BYTES:
        return ValidationResult(
            valid=False, filetype=None,
            error_code=DocumentErrorCode.FILE_TOO_LARGE,
            error_message=f"File exceeds {MAX_UPLOAD_SIZE_BYTES // (1024*1024)} MB limit",
        )

    # Guard: extensão
    ext = os.path.splitext(filename.lower())[1]
    if ext not in ALLOWED_EXTENSIONS:
        return ValidationResult(
            valid=False, filetype=None,
            error_code=DocumentErrorCode.UNSUPPORTED_TYPE,
            error_message=f"File type '{ext}' is not supported",
        )

    # Guard: magic bytes (detecção de MIME spoof)
    # CSV é texto puro — sem magic bytes confiáveis, extensão é fonte de verdade
    is_pdf  = file_bytes[:4] == PDF_MAGIC
    is_zip  = file_bytes[:4] == DOCX_MAGIC   # DOCX e XLSX são ambos ZIP

    if ext == ".pdf" and not is_pdf:
        return ValidationResult(
            valid=False, filetype=None,
            error_code=DocumentErrorCode.MIME_MISMATCH,
            error_message="File extension does not match file content",
        )

    if ext in (".docx", ".xlsx") and not is_zip:
        return ValidationResult(
            valid=False, filetype=None,
            error_code=DocumentErrorCode.MIME_MISMATCH,
            error_message="File extension does not match file content",
        )

    if ext == ".pdf":
        filetype = "pdf"
    elif ext == ".docx":
        filetype = "docx"
    elif ext == ".xlsx":
        filetype = "xlsx"
    else:
        filetype = "csv"

    return ValidationResult(valid=True, filetype=filetype, error_code=None, error_message=None)


def chunk_text(text: str) -> list[str]:
    """
    Divide texto em chunks de CHUNK_SIZE_CHARS para DLP scan.
    Limita a MAX_CHUNKS — nunca retorna mais chunks que o limite.
    """
    chunks: list[str] = []
    offset = 0
    while offset < len(text) and len(chunks) < MAX_CHUNKS:
        chunks.append(text[offset: offset + CHUNK_SIZE_CHARS])
        offset += CHUNK_SIZE_CHARS
    return chunks


def cleanup_buffers(*args: object) -> None:
    """
    Cleanup explícito de buffers grandes após uso.
    Chama gc.collect() para liberar memória imediatamente.

    Uso:
        cleanup_buffers(file_bytes, extracted_text)
    """
    # Deletar referências aos objetos passados
    # (o caller ainda precisa fazer `del` nas suas variáveis locais)
    del args
    gc.collect()


def build_safe_summary(masked_text: str, page: int | None = None) -> str:
    """
    Constrói um resumo seguro para o response — nunca retorna texto original.
    Retorna apenas descrição dos findings mascarados.
    """
    if not masked_text:
        return "Nenhum dado sensível detectado"

    # Contar placeholders no texto mascarado
    placeholders = [
        w for w in masked_text.split()
        if w.startswith("[") and w.endswith("]")
    ]

    if not placeholders:
        return "Texto processado — nenhum dado sensível encontrado"

    unique = list(dict.fromkeys(placeholders))  # preserva ordem, remove duplicatas
    location = f" na página {page}" if page else ""
    return f"{', '.join(unique)} encontrado{location}"
