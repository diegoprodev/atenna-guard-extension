"""
FASE 4.2C — CSV Parser
CSV/TSV é texto puro — parse sem dependências externas.

Defesas implementadas:
- Detecção de fórmulas maliciosas (CSV injection: =, +, -, @, |, %)
- Limite de linhas e chars extraídos
- Encoding detection com fallback utf-8 → latin-1
- Timeout hard via asyncio.wait_for
"""
from __future__ import annotations

import asyncio
import gc
from dataclasses import dataclass

from document.limits import (
    MAX_CHARS_EXTRACTED,
    MAX_EXTRACTION_TIME_S,
    DocumentErrorCode,
)

_MAX_ROWS = 10_000
_CSV_INJECTION_CHARS = frozenset("=+|-@%")


@dataclass(frozen=True)
class CsvParseResult:
    text:      str
    rows:      int
    truncated: bool
    error_code:    str | None
    error_message: str | None


def _extract_sync(file_bytes: bytes) -> CsvParseResult:
    # Detect encoding
    for enc in ("utf-8-sig", "utf-8", "latin-1"):
        try:
            raw = file_bytes.decode(enc)
            break
        except UnicodeDecodeError:
            raw = None
    else:
        raw = file_bytes.decode("latin-1", errors="replace")

    if raw is None:
        return CsvParseResult(
            text="", rows=0, truncated=False,
            error_code=DocumentErrorCode.MALFORMED,
            error_message="Could not decode CSV file",
        )

    lines = raw.splitlines()
    truncated_rows = len(lines) > _MAX_ROWS
    lines = lines[:_MAX_ROWS]

    sanitized: list[str] = []
    chars_so_far = 0

    for line in lines:
        # Strip CSV injection: cells starting with injection chars become literals
        cells = line.split(",")
        clean_cells = []
        for cell in cells:
            stripped = cell.strip().strip('"')
            if stripped and stripped[0] in _CSV_INJECTION_CHARS:
                stripped = "'" + stripped
            clean_cells.append(stripped)
        safe_line = "\t".join(clean_cells)

        remaining = MAX_CHARS_EXTRACTED - chars_so_far
        if len(safe_line) > remaining:
            sanitized.append(safe_line[:remaining])
            truncated_rows = True
            break
        sanitized.append(safe_line)
        chars_so_far += len(safe_line)

    full_text = "\n".join(sanitized)
    return CsvParseResult(
        text=full_text,
        rows=len(sanitized),
        truncated=truncated_rows,
        error_code=None,
        error_message=None,
    )


async def parse_csv(file_bytes: bytes) -> CsvParseResult:
    """Entry point async. Executa extração em thread com timeout hard."""
    try:
        result = await asyncio.wait_for(
            asyncio.get_event_loop().run_in_executor(None, _extract_sync, file_bytes),
            timeout=MAX_EXTRACTION_TIME_S,
        )
    except asyncio.TimeoutError:
        gc.collect()
        result = CsvParseResult(
            text="", rows=0, truncated=False,
            error_code=DocumentErrorCode.TIMEOUT,
            error_message="Extraction exceeded time limit",
        )
    return result
