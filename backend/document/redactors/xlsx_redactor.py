"""
XLSX Redactor — FASE 4.7
Mascara células sensíveis preservando workbook, estilos, fórmulas, abas.
"""
from __future__ import annotations

import io
from typing import List, Tuple


def redact_xlsx(
    xlsx_bytes: bytes,
    findings: list,
    original_text: str,
) -> bytes:
    try:
        import openpyxl
    except ImportError:
        raise RuntimeError("openpyxl não instalado")

    wb = openpyxl.load_workbook(io.BytesIO(xlsx_bytes))

    seen: set[str] = set()
    pairs: List[Tuple[str, str]] = []
    for f in findings:
        if f.start is None or f.end is None:
            continue
        value = original_text[f.start:f.end]
        if not value.strip() or value in seen:
            continue
        seen.add(value)
        pairs.append((value, f.placeholder))

    if not pairs:
        return xlsx_bytes

    for ws in wb.worksheets:
        for row in ws.iter_rows():
            for cell in row:
                if cell.data_type == "s" and isinstance(cell.value, str):
                    new_val = cell.value
                    for value, placeholder in pairs:
                        if value in new_val:
                            new_val = new_val.replace(value, placeholder)
                    if new_val != cell.value:
                        cell.value = new_val

    buf = io.BytesIO()
    wb.save(buf)
    return buf.getvalue()
