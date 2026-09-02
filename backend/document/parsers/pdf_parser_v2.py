"""
FASE 4.6 — Hybrid Intelligent PDF Parser
Pipeline enterprise:
  1. PyMuPDF extrai texto nativo de TODAS as paginas em <5s
  2. Identifica paginas "pobres" em texto (< TEXT_THRESHOLD chars)
  3. Gemini OCR apenas nas paginas pobres (scanned, images, low-density)
  4. Merge: texto nativo + OCR seletivo
  5. DLP roda no texto final (sempre, no routes/protect.py)

Resultado: 5-15s para 99% dos PDFs nativos; 15-40s para docs mistos/scanned.
"""
from __future__ import annotations

import asyncio
import base64
import gc
import io
import os
from dataclasses import dataclass
from typing import Optional, List

from document.limits import (
    MAX_CHARS_EXTRACTED,
    MAX_PAGES,
    DocumentErrorCode,
)

# Paginas com menos de N chars sao candidatas ao OCR seletivo
TEXT_THRESHOLD = 100

# Maximo de paginas pobres por chamada Gemini (evita payloads gigantes)
MAX_OCR_PAGES_PER_CALL = 30

# DPI para renderizacao das imagens OCR
OCR_DPI = 150


@dataclass(frozen=True)
class PdfParseResultV2:
    text: str
    pages_parsed: int
    total_pages: int
    truncated: bool
    has_images: bool
    has_tables: bool
    extraction_method: str  # "native" | "hybrid" | "vision" | "fallback" | "timeout" | "none"
    error_code: Optional[str]
    error_message: Optional[str]
    gemini_masked: bool = False
    gemini_entities: Optional[List[dict]] = None


# ── Helpers ───────────────────────────────────────────────────────────────────

def _page_to_png_bytes(page, dpi: int = OCR_DPI) -> bytes:
    import fitz
    mat = fitz.Matrix(dpi / 72, dpi / 72)  # escala uniforme X e Y
    pix = page.get_pixmap(matrix=mat, alpha=False)
    return pix.tobytes("png")


# ── Stage 1: Extracao nativa PyMuPDF ─────────────────────────────────────────

def _extract_native_pymupdf(pdf_bytes: bytes) -> dict:
    try:
        import fitz  # PyMuPDF
    except ImportError:
        return {"error": "PyMuPDF not installed", "texts": {}, "total_pages": 0, "has_images": False}

    try:
        doc = fitz.open(stream=pdf_bytes, filetype="pdf")
    except Exception as e:
        return {"error": str(e), "texts": {}, "total_pages": 0, "has_images": False}

    total = len(doc)
    texts = {}
    has_images = False
    pages_to_process = min(total, MAX_PAGES)

    # pages_with_drawings: indices de paginas com graficos vetoriais + pouco texto
    # (graficos de barras, pizza, linhas — text labels sao poucos, visual e denso)
    pages_with_drawings: list = []

    for idx in range(pages_to_process):
        try:
            page = doc[idx]
            text = page.get_text("text")
            texts[idx] = text or ""
            if not has_images and page.get_images():
                has_images = True
            # Detecta graficos vetoriais: muitos drawings + pouco texto = candidato a OCR
            if len((text or "").strip()) < TEXT_THRESHOLD:
                drawings = page.get_drawings()
                if len(drawings) >= 5:  # 5+ elementos vetoriais = provavelmente grafico
                    pages_with_drawings.append(idx)
                    if not has_images:
                        has_images = True  # trata como "visual" para ativar OCR seletivo
        except Exception:
            texts[idx] = ""

    doc.close()
    gc.collect()

    total_chars = sum(len(t) for t in texts.values())
    print(
        f"[PYMUPDF] {pages_to_process}/{total} pages, "
        f"{total_chars} chars, has_images={has_images}, "
        f"drawing_pages={len(pages_with_drawings)}"
    )
    return {
        "texts": texts,
        "total_pages": total,
        "pages_processed": pages_to_process,
        "has_images": has_images,
    }


# ── Stage 2: Identifica paginas pobres ───────────────────────────────────────

def _find_poor_pages(texts: dict, threshold: int = TEXT_THRESHOLD) -> List[int]:
    return [idx for idx, t in texts.items() if len(t.strip()) < threshold]


# ── Stage 3: OCR seletivo nas paginas pobres ─────────────────────────────────

async def _ocr_pages_with_gemini(pdf_bytes: bytes, page_indices: List[int]) -> dict:
    if not page_indices:
        return {}

    try:
        import fitz
        import google.generativeai as genai
    except ImportError as e:
        print(f"[OCR-SELECTIVE] Import error: {e}")
        return {}

    api_key = os.getenv("GEMINI_API_KEY")
    if not api_key:
        return {}

    genai.configure(api_key=api_key)
    model = genai.GenerativeModel("gemini-2.5-flash-lite")

    try:
        doc = fitz.open(stream=pdf_bytes, filetype="pdf")
    except Exception as e:
        print(f"[OCR-SELECTIVE] PDF open error: {e}")
        return {}

    results = {}
    batches = [page_indices[i:i + MAX_OCR_PAGES_PER_CALL] for i in range(0, len(page_indices), MAX_OCR_PAGES_PER_CALL)]

    for batch in batches:
        valid_batch = []
        parts = [
            (
                f"Extraia o texto completo das imagens a seguir (cada imagem = uma pagina de PDF). "
                "Para cada pagina responda no formato:\n"
                "--- PAGINA N ---\n"
                "(texto da pagina N)\n\n"
                "Preserve paragrafos, listas, tabelas e cabecalhos. "
                "Se a pagina nao tiver texto legivel escreva: --- PAGINA N ---\n(vazia)\n"
            )
        ]

        for page_idx in batch:
            try:
                page = doc[page_idx]
                png_bytes = _page_to_png_bytes(page)
                b64 = base64.standard_b64encode(png_bytes).decode("ascii")
                parts.append({"inline_data": {"mime_type": "image/png", "data": b64}})
                valid_batch.append(page_idx)
            except Exception as e:
                print(f"[OCR-SELECTIVE] Render error page {page_idx}: {e}")
                results[page_idx] = ""

        if not valid_batch:
            continue

        try:
            captured_batch = valid_batch[:]
            response = await asyncio.get_event_loop().run_in_executor(
                None, lambda p=parts: model.generate_content(p)
            )
            raw = (response.text or "").strip()

            import re
            sections = re.split(r"---\s*PAGINA\s+(\d+)\s*---", raw, flags=re.IGNORECASE)
            # sections = ['prefix', '1', 'text1', '2', 'text2', ...]
            for i in range(1, len(sections) - 1, 2):
                try:
                    seq = int(sections[i]) - 1  # 1-based -> 0-based
                    if 0 <= seq < len(captured_batch):
                        page_text = sections[i + 1].strip()
                        if page_text.lower() == "(vazia)":
                            page_text = ""
                        results[captured_batch[seq]] = page_text
                except (ValueError, IndexError):
                    pass

        except Exception as e:
            print(f"[OCR-SELECTIVE] Gemini batch error: {e}")
            for page_idx in valid_batch:
                if page_idx not in results:
                    results[page_idx] = ""

    doc.close()
    gc.collect()
    return results


# ── Stage fallback: PDF inteiro via Gemini ────────────────────────────────────

async def _extract_full_gemini(file_bytes: bytes) -> str:
    try:
        import google.generativeai as genai
    except ImportError:
        return ""

    api_key = os.getenv("GEMINI_API_KEY")
    if not api_key:
        return ""

    genai.configure(api_key=api_key)
    model = genai.GenerativeModel("gemini-2.5-flash-lite")

    PROMPT = (
        "Extraia TODO o texto deste PDF com maxima fidelidade. "
        "Preserve paragrafos, listas, tabelas e cabecalhos. "
        "Inclua TODAS as paginas. "
        "Nao resuma nem omita nenhum conteudo. "
        "Responda apenas com o texto extraido, sem comentarios."
    )

    INLINE_MAX = 20 * 1024 * 1024

    try:
        if len(file_bytes) <= INLINE_MAX:
            b64 = base64.standard_b64encode(file_bytes).decode("ascii")
            response = await asyncio.get_event_loop().run_in_executor(
                None,
                lambda: model.generate_content([
                    PROMPT,
                    {"inline_data": {"mime_type": "application/pdf", "data": b64}},
                ])
            )
        else:
            import tempfile
            import time
            tmp_path = None
            uploaded_file = None
            try:
                with tempfile.NamedTemporaryFile(suffix=".pdf", delete=False) as tmp:
                    tmp.write(file_bytes)
                    tmp_path = tmp.name

                uploaded_file = await asyncio.get_event_loop().run_in_executor(
                    None, lambda: genai.upload_file(tmp_path, mime_type="application/pdf")
                )
                deadline = time.monotonic() + 60
                while uploaded_file.state.name != "ACTIVE":
                    if time.monotonic() > deadline:
                        raise TimeoutError("Files API ACTIVE timeout")
                    await asyncio.sleep(2)
                    uploaded_file = await asyncio.get_event_loop().run_in_executor(
                        None, lambda f=uploaded_file: genai.get_file(f.name)
                    )
                response = await asyncio.get_event_loop().run_in_executor(
                    None, lambda: model.generate_content([PROMPT, uploaded_file])
                )
            finally:
                if uploaded_file:
                    try:
                        await asyncio.get_event_loop().run_in_executor(
                            None, lambda f=uploaded_file: genai.delete_file(f.name)
                        )
                    except Exception:
                        pass
                if tmp_path:
                    try:
                        os.unlink(tmp_path)
                    except Exception:
                        pass

        raw = (response.text or "").strip()
        if raw.startswith("```"):
            raw = raw.split("\n", 1)[-1].rsplit("```", 1)[0].strip()
        return raw

    except Exception as e:
        print(f"[GEMINI-FULL] Failed: {e}")
        return ""


# ── Entry point ───────────────────────────────────────────────────────────────

async def parse_pdf_v2(file_bytes: bytes) -> PdfParseResultV2:
    """
    Pipeline hibrido inteligente:
    - PyMuPDF extrai texto nativo em <5s (218 paginas)
    - Gemini OCR apenas nas paginas scanned/pobres em texto
    - Merge do texto nativo + OCR seletivo
    """
    import time
    t0 = time.monotonic()

    # Stage 1: Extracao nativa PyMuPDF ───────────────────────────────────────
    try:
        native_result = await asyncio.wait_for(
            asyncio.get_event_loop().run_in_executor(
                None, _extract_native_pymupdf, file_bytes
            ),
            timeout=30.0,
        )
    except asyncio.TimeoutError:
        gc.collect()
        return PdfParseResultV2(
            text="", pages_parsed=0, total_pages=0,
            truncated=False, has_images=False, has_tables=False,
            extraction_method="timeout",
            error_code=DocumentErrorCode.TIMEOUT,
            error_message="PyMuPDF extraction timeout",
        )

    if "error" in native_result and not native_result.get("texts"):
        # PyMuPDF nao disponivel — fallback Gemini full
        print(f"[HYBRID] PyMuPDF unavailable: {native_result['error']} — Gemini full fallback")
        try:
            full_text = await asyncio.wait_for(_extract_full_gemini(file_bytes), timeout=240.0)
        except asyncio.TimeoutError:
            full_text = ""

        if full_text:
            return PdfParseResultV2(
                text=full_text[:MAX_CHARS_EXTRACTED],
                pages_parsed=0, total_pages=0,
                truncated=len(full_text) > MAX_CHARS_EXTRACTED,
                has_images=True, has_tables=False,
                extraction_method="vision",
                error_code=None, error_message=None,
            )
        return PdfParseResultV2(
            text="", pages_parsed=0, total_pages=0,
            truncated=False, has_images=False, has_tables=False,
            extraction_method="none",
            error_code=DocumentErrorCode.PARSE_ERROR,
            error_message=native_result.get("error", "Unknown"),
        )

    texts = native_result["texts"]
    total_pages = native_result["total_pages"]
    pages_processed = native_result["pages_processed"]
    has_images = native_result["has_images"]

    t_native = time.monotonic() - t0
    print(f"[HYBRID] Stage 1 done in {t_native:.1f}s")

    # Stage 2: Identifica paginas pobres ─────────────────────────────────────
    poor_pages = _find_poor_pages(texts, TEXT_THRESHOLD)
    poor_ratio = len(poor_pages) / max(pages_processed, 1)
    print(
        f"[HYBRID] poor_pages={len(poor_pages)}/{pages_processed} ({poor_ratio:.0%})"
    )

    # Stage 3: OCR seletivo ───────────────────────────────────────────────────
    ocr_texts = {}
    extraction_method = "native"

    if poor_pages and has_images:
        print(f"[HYBRID] Selective OCR on {len(poor_pages)} pages")
        try:
            ocr_texts = await asyncio.wait_for(
                _ocr_pages_with_gemini(file_bytes, poor_pages),
                timeout=120.0,
            )
            extraction_method = "hybrid"
            print(f"[HYBRID] OCR done in {time.monotonic() - t0:.1f}s, {len(ocr_texts)} pages")
        except asyncio.TimeoutError:
            print("[HYBRID] OCR timeout — native only")
        except Exception as e:
            print(f"[HYBRID] OCR error: {e} — native only")

    elif poor_ratio > 0.8:
        # Documento quase todo scanned
        print("[HYBRID] >80% poor pages — full Gemini")
        try:
            full_text = await asyncio.wait_for(_extract_full_gemini(file_bytes), timeout=240.0)
            if full_text:
                t_total = time.monotonic() - t0
                print(f"[HYBRID] Full Gemini in {t_total:.1f}s")
                return PdfParseResultV2(
                    text=full_text[:MAX_CHARS_EXTRACTED],
                    pages_parsed=pages_processed, total_pages=total_pages,
                    truncated=len(full_text) > MAX_CHARS_EXTRACTED,
                    has_images=has_images, has_tables=False,
                    extraction_method="vision",
                    error_code=None, error_message=None,
                )
        except asyncio.TimeoutError:
            print("[HYBRID] Full Gemini timeout — native fallback")

    # Stage 4: Merge texto nativo + OCR ──────────────────────────────────────
    merged_parts = []
    for idx in sorted(texts.keys()):
        native_text = texts[idx].strip()
        ocr_text = ocr_texts.get(idx, "").strip()
        if ocr_text and len(ocr_text) > len(native_text):
            merged_parts.append(ocr_text)
        elif native_text:
            merged_parts.append(native_text)

    final_text = "\n\n".join(merged_parts)
    total_chars = len(final_text)
    t_total = time.monotonic() - t0

    print(
        f"[HYBRID] Done in {t_total:.1f}s | method={extraction_method} | "
        f"{total_chars} chars | {pages_processed}/{total_pages} pages"
    )

    return PdfParseResultV2(
        text=final_text[:MAX_CHARS_EXTRACTED],
        pages_parsed=pages_processed, total_pages=total_pages,
        truncated=total_chars > MAX_CHARS_EXTRACTED,
        has_images=has_images, has_tables=False,
        extraction_method=extraction_method,
        error_code=None, error_message=None,
    )
