"""
PDF Redactor — FASE 4.7
Aplica redaction permanente (PyMuPDF) sobre achados do DLP.

Estratégia:
1. Abrir PDF original com PyMuPDF.
2. Para cada achado DLP, buscar o texto original em cada página (page.search_for).
3. Criar anotação de redação (page.add_redact_annot) com fundo preto.
4. Aplicar redação permanente (page.apply_redactions) — remove texto por baixo.
5. Salvar novo PDF em memória.

Limitações documentadas:
- Texto dividido em múltiplos spans (renderizado, não linear) pode não ser
  localizado via search_for — nesses casos o item é marcado como não-aplicado.
- PDFs scanned (imagem) não têm texto copiável; redação visual não é necessária.
- Não suporta redação de texto em imagens embutidas.
"""
from __future__ import annotations

import gc
import io
from dataclasses import dataclass, field
from typing import List, Tuple


@dataclass
class RedactionReport:
    total_findings: int
    applied: int
    skipped: int
    skipped_items: List[str] = field(default_factory=list)  # entity types não aplicados
    needs_review: bool = False


def redact_pdf(
    pdf_bytes: bytes,
    findings: list,  # list of DlpFinding
    original_text: str,
) -> Tuple[bytes, RedactionReport]:
    """
    Retorna (pdf_protegido_bytes, relatório).
    Se não conseguir abrir o PDF, levanta ValueError.
    """
    try:
        import fitz
    except ImportError:
        raise RuntimeError("PyMuPDF não instalado")

    try:
        doc = fitz.open(stream=pdf_bytes, filetype="pdf")
    except Exception as e:
        raise ValueError(f"PDF inválido ou corrompido: {e}")

    applied = 0
    skipped = 0
    skipped_items: List[str] = []

    # Pre-compute unique (value, placeholder) pairs to avoid redundant searches
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

    for page in doc:
        for value, placeholder in pairs:
            rects = page.search_for(value, quads=False)
            if rects:
                for rect in rects:
                    # fill=(0,0,0) = tarja preta permanente
                    page.add_redact_annot(rect, text="", fill=(0, 0, 0))
                page.apply_redactions(images=fitz.PDF_REDACT_IMAGE_NONE)
                applied += 1
            # Se não encontrado nesta página não incrementamos skipped
            # (o valor pode estar em outra página)

    # Detectar valores que não foram encontrados em nenhuma página
    for value, placeholder in pairs:
        found_any = False
        for page in doc:
            if page.search_for(value, quads=False):
                found_any = True
                break
        if not found_any:
            skipped += 1
            skipped_items.append(placeholder)

    buf = io.BytesIO()
    doc.save(buf, garbage=4, deflate=True, clean=True)
    doc.close()
    gc.collect()

    report = RedactionReport(
        total_findings=len(pairs),
        applied=applied,
        skipped=skipped,
        skipped_items=skipped_items,
        needs_review=skipped > 0,
    )
    return buf.getvalue(), report
