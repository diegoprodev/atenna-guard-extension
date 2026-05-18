"""
FASE 4.5 — Intelligent PDF Parser
- Detecção automática: nativo vs imagens
- Texto nativo: pdfplumber (rápido, local)
- Com imagens: Gemini Vision OCR (automático, barato)
- Fallback: graceful degradation com texto nativo
"""
from __future__ import annotations

import asyncio
import gc
import io
import os
from dataclasses import dataclass
from typing import Optional

from document.limits import (
    MAX_CHARS_EXTRACTED,
    MAX_EXTRACTION_TIME_S,
    MAX_PAGES,
    DocumentErrorCode,
)


@dataclass(frozen=True)
class PdfParseResultV2:
    text: str
    pages_parsed: int
    total_pages: int
    truncated: bool
    has_images: bool
    has_tables: bool
    extraction_method: str  # "native", "vision", "hybrid", "fallback", "timeout", "none"
    error_code: Optional[str]
    error_message: Optional[str]


def _analyze_pdf_pages(pdf_bytes: bytes) -> dict:
    """
    Análise prévia: detectar se PDF tem imagens/tabelas.
    Retorna: {
        'total_pages': int,
        'has_images': bool,
        'has_tables': bool,
        'text_density': float (0.0-1.0),
    }
    """
    try:
        import pdfplumber
    except ImportError:
        return {"error": "pdfplumber not installed"}

    pdf_io = io.BytesIO(pdf_bytes)
    with pdfplumber.open(pdf_io) as pdf:
        total_pages = len(pdf.pages)

        # Analisar primeiras 3 páginas
        sample_pages = min(3, total_pages)
        total_text = 0
        has_images = False
        has_tables = False

        for i in range(sample_pages):
            page = pdf.pages[i]
            text = page.extract_text() or ""
            total_text += len(text)

            if page.images:
                has_images = True
            if page.extract_tables():
                has_tables = True

        avg_text_per_page = total_text / sample_pages if sample_pages > 0 else 0
        text_density = min(1.0, avg_text_per_page / 1000)  # Normalize

        return {
            'total_pages': total_pages,
            'has_images': has_images,
            'has_tables': has_tables,
            'text_density': text_density,
        }


def _format_table_as_text(table: list) -> str:
    """Convert table to markdown-ish text."""
    lines = []
    for row in table:
        lines.append(" | ".join(str(cell or "") for cell in row))
    return "\n".join(lines)


def _extract_native_text(file_bytes: bytes) -> str:
    """Extrai texto nativo + tabelas usando pdfplumber."""
    try:
        import pdfplumber
    except ImportError:
        return ""

    pdf_io = io.BytesIO(file_bytes)
    extracted_parts = []
    chars_so_far = 0

    with pdfplumber.open(pdf_io) as pdf:
        pages_to_parse = min(len(pdf.pages), MAX_PAGES)

        for i in range(pages_to_parse):
            try:
                page = pdf.pages[i]

                # 1. Texto nativo
                page_text = page.extract_text() or ""

                # 2. Tabelas (se houver)
                tables = page.extract_tables() or []
                if tables:
                    page_text += "\n\n[TABELAS DETECTADAS]\n"
                    for table_idx, table in enumerate(tables):
                        page_text += f"\n[TABELA {table_idx + 1}]\n"
                        page_text += _format_table_as_text(table)
                        page_text += "\n[/TABELA]\n"

                # Truncar se necessário
                remaining = MAX_CHARS_EXTRACTED - chars_so_far
                if len(page_text) > remaining:
                    extracted_parts.append(page_text[:remaining])
                    break

                extracted_parts.append(page_text)
                chars_so_far += len(page_text)

            except Exception:
                continue

    return "\n".join(extracted_parts)


async def _extract_with_vision(file_bytes: bytes, has_native_text: bool) -> str:
    """
    Usa Gemini Vision para OCR de imagens no PDF.
    Se PDF tem texto nativo, usa Vision apenas para imagens.
    """
    try:
        import google.generativeai as genai
        from pdf2image import convert_from_bytes
    except ImportError:
        return ""

    api_key = os.getenv("GEMINI_API_KEY")
    if not api_key:
        return ""

    genai.configure(api_key=api_key)
    model = genai.GenerativeModel("gemini-2.0-flash-exp")

    # Converter PDF para imagens (primeiras 10 páginas para MVP)
    try:
        images = convert_from_bytes(file_bytes, first_page=1, last_page=10)
    except Exception:
        return ""

    extracted_text = []

    for idx, img in enumerate(images):
        try:
            # Converter PIL Image para bytes
            img_byte_arr = io.BytesIO()
            img.save(img_byte_arr, format="PNG")
            img_byte_arr.seek(0)

            # Prompt depende se já temos texto nativo
            if has_native_text:
                prompt = "Extraia APENAS conteúdo visual (gráficos, diagramas, imagens, tabelas complexas). Ignore texto puro. Português/English."
            else:
                prompt = "Extraia TODO o texto e conteúdo visual desta página em português e inglês, com máxima fidelidade."

            # Call Gemini Vision
            response = model.generate_content([
                prompt,
                {
                    "mime_type": "image/png",
                    "data": img_byte_arr.getvalue(),
                },
            ])

            if response.text:
                extracted_text.append(f"[PAGE {idx + 1} - VISION]\n{response.text}\n")

        except Exception as e:
            print(f"[VISION-ERROR] Page {idx + 1}: {e}")
            continue

    return "\n".join(extracted_text)


def _extract_sync(file_bytes: bytes) -> PdfParseResultV2:
    """Extração síncrona (chamada em thread)."""
    try:
        import pdfplumber
    except ImportError:
        return PdfParseResultV2(
            text="", pages_parsed=0, total_pages=0,
            truncated=False, has_images=False, has_tables=False,
            extraction_method="none",
            error_code=DocumentErrorCode.PARSE_ERROR,
            error_message="pdfplumber not installed",
        )

    try:
        # 1. Análise prévia
        analysis = _analyze_pdf_pages(file_bytes)
        if "error" in analysis:
            return PdfParseResultV2(
                text="", pages_parsed=0, total_pages=0,
                truncated=False, has_images=False, has_tables=False,
                extraction_method="none",
                error_code=DocumentErrorCode.PARSE_ERROR,
                error_message=analysis["error"],
            )

        # 2. Extrair texto nativo
        native_text = _extract_native_text(file_bytes)
        has_images = analysis.get("has_images", False)
        has_tables = analysis.get("has_tables", False)
        total_pages = analysis.get("total_pages", 0)
        text_density = analysis.get("text_density", 0.0)

        # 3. Decidir se usar Vision
        #    Vision se: tem imagens OU texto muito esparso (scanned)
        use_vision = has_images or text_density < 0.1

        pdf_io = io.BytesIO(file_bytes)
        with pdfplumber.open(pdf_io) as pdf:
            pages_to_parse = min(len(pdf.pages), MAX_PAGES)

        extraction_method = "native"
        if use_vision:
            extraction_method = "native+vision"

        return PdfParseResultV2(
            text=native_text,
            pages_parsed=pages_to_parse,
            total_pages=total_pages,
            truncated=pages_to_parse < total_pages,
            has_images=has_images,
            has_tables=has_tables,
            extraction_method=extraction_method,
            error_code=None,
            error_message=None,
        )

    except MemoryError:
        gc.collect()
        return PdfParseResultV2(
            text="", pages_parsed=0, total_pages=0,
            truncated=False, has_images=False, has_tables=False,
            extraction_method="none",
            error_code=DocumentErrorCode.PARSE_ERROR,
            error_message="Memory limit exceeded",
        )
    except Exception as e:
        return PdfParseResultV2(
            text="", pages_parsed=0, total_pages=0,
            truncated=False, has_images=False, has_tables=False,
            extraction_method="none",
            error_code=DocumentErrorCode.MALFORMED,
            error_message=str(e)[:100],
        )


async def parse_pdf_v2(file_bytes: bytes) -> PdfParseResultV2:
    """
    Entry point async.
    1. Extrai texto nativo (pdfplumber)
    2. Se tem imagens, aciona Gemini Vision
    3. Combina resultados
    """
    # Fase 1: Extração síncrona (nativa)
    try:
        result = await asyncio.wait_for(
            asyncio.get_event_loop().run_in_executor(None, _extract_sync, file_bytes),
            timeout=MAX_EXTRACTION_TIME_S,
        )
    except asyncio.TimeoutError:
        gc.collect()
        return PdfParseResultV2(
            text="", pages_parsed=0, total_pages=0,
            truncated=False, has_images=False, has_tables=False,
            extraction_method="timeout",
            error_code=DocumentErrorCode.TIMEOUT,
            error_message="Extraction timeout",
        )

    # Fase 2: Vision OCR (se necessário)
    if result.has_images and not result.error_code:
        try:
            vision_text = await asyncio.wait_for(
                _extract_with_vision(file_bytes, has_native_text=len(result.text) > 100),
                timeout=120.0,  # Vision pode ser mais lento
            )
            if vision_text:
                result = PdfParseResultV2(
                    text=result.text + "\n\n[VISUAL CONTENT FROM GEMINI VISION]\n" + vision_text,
                    pages_parsed=result.pages_parsed,
                    total_pages=result.total_pages,
                    truncated=result.truncated,
                    has_images=result.has_images,
                    has_tables=result.has_tables,
                    extraction_method="hybrid" if "native" in result.extraction_method else "vision",
                    error_code=None,
                    error_message=None,
                )
        except Exception as e:
            print(f"[VISION-FALLBACK] Vision failed: {e}, continuing with native text")
            # Continue com texto nativo se Vision falhar

    return result
