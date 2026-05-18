"""
FASE 4.2C — Document Pipeline Limits Matrix (PDF + DOCX + XLSX + CSV)
Fonte de verdade para todos os limites de segurança do pipeline de documentos.
Qualquer mudança aqui requer aprovação explícita (ver FASE_4.2B_DOCUMENT_LIMITS_MATRIX.md).
"""
from __future__ import annotations

# ── Upload ────────────────────────────────────────────────────────────────────
MAX_UPLOAD_SIZE_BYTES: int = 100 * 1024 * 1024  # 100 MB (FASE 4.4 — large PDF/document investigation)
MIN_FILE_SIZE_BYTES:   int = 64                   # arquivos menores = corrompidos/vazios

# ── Extração ──────────────────────────────────────────────────────────────────
MAX_PAGES:              int   = 500               # 500 páginas (para PDFs grandes)
MAX_CHARS_EXTRACTED:    int   = 2_000_000         # ~1000 páginas densas
MAX_EXTRACTION_TIME_S:  float = 120.0             # 120s timeout (FASE 4.4 — large PDF/doc extraction)
MAX_MEMORY_MB:          int   = 80

# ── Chunking para DLP ─────────────────────────────────────────────────────────
CHUNK_SIZE_CHARS: int = 5_000
MAX_CHUNKS:       int = 100                        # MAX_CHARS / CHUNK_SIZE = 100

# ── Concorrência ─────────────────────────────────────────────────────────────
MAX_CONCURRENT_PARSES: int = 3

# ── Magic bytes para detecção de MIME ────────────────────────────────────────
PDF_MAGIC:  bytes = b"%PDF"
DOCX_MAGIC: bytes = b"PK\x03\x04"               # DOCX/XLSX = ZIP (mesmo magic)

# ── Tipos aceitos ─────────────────────────────────────────────────────────────
ALLOWED_EXTENSIONS: frozenset[str] = frozenset({".pdf", ".docx", ".xlsx", ".csv"})
ALLOWED_CONTENT_TYPES: frozenset[str] = frozenset({
    "application/pdf",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "text/csv",
    "text/plain",
    "application/octet-stream",  # fallback — extensão é a fonte de verdade
})

# ── Códigos de erro semânticos (nunca expor detalhes internos) ────────────────
class DocumentErrorCode:
    FILE_TOO_LARGE    = "file_too_large"
    FILE_TOO_SMALL    = "file_too_small"
    UNSUPPORTED_TYPE  = "unsupported_type"
    MIME_MISMATCH     = "mime_mismatch"
    ENCRYPTED_PDF     = "encrypted_pdf"
    RESTRICTED_PDF    = "restricted_pdf"
    MALFORMED         = "malformed_document"
    TIMEOUT           = "extraction_timeout"
    CAPACITY_EXCEEDED = "capacity_exceeded"
    PARSE_ERROR       = "parse_error"
