"""
DOCX Parser v2 — Enterprise extraction with smart Gemini escalation.
- Native: python-docx (paragraphs + tables in document order)
- Fallback native: raw XML via zipfile
- Smart escalation: triggers Gemini Files API only when doc has embedded images/charts
  OR native extraction density is too low (< 80 chars/paragraph avg)
- Gemini: uploads entire DOCX in one call — handles images, tables, graphs, KPIs
"""
from __future__ import annotations

import asyncio
import gc
import io
import os
import tempfile
import zipfile
from dataclasses import dataclass
from typing import Optional

from document.limits import (
    MAX_CHARS_EXTRACTED,
    MAX_EXTRACTION_TIME_S,
    MAX_UPLOAD_SIZE_BYTES,
    DocumentErrorCode,
)

_ZIP_BOMB_RATIO = 10
_MAX_UNCOMPRESSED = MAX_UPLOAD_SIZE_BYTES * _ZIP_BOMB_RATIO

DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document"


@dataclass(frozen=True)
class DocxParseResult:
    text: str
    paragraphs: int
    truncated: bool
    has_images: bool
    extraction_method: str  # "native", "vision", "hybrid", "fallback", "timeout", "none"
    error_code: Optional[str]
    error_message: Optional[str]


def _check_zip_bomb(file_bytes: bytes) -> bool:
    try:
        with zipfile.ZipFile(io.BytesIO(file_bytes)) as zf:
            total = sum(info.file_size for info in zf.infolist())
            return total > _MAX_UNCOMPRESSED
    except Exception:
        return False


def _analyze_docx(file_bytes: bytes) -> dict:
    """Detect embedded images/charts and estimate text density."""
    has_images = False
    total_paragraphs = 0
    total_chars = 0

    try:
        with zipfile.ZipFile(io.BytesIO(file_bytes)) as zf:
            names = zf.namelist()
            # Any media file or chart signals visual content
            for name in names:
                if name.startswith("word/media/") or name.startswith("word/charts/"):
                    has_images = True
                    break

            # Sample text density from document.xml
            if "word/document.xml" in names:
                from defusedxml.ElementTree import fromstring as _xml_fromstring  # defesa contra XML bomb/XXE
                W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main"
                xml_bytes = zf.read("word/document.xml")
                root = _xml_fromstring(xml_bytes)
                for para in root.iter("{%s}p" % W):
                    texts = [t.text for t in para.iter("{%s}t" % W) if t.text]
                    text = "".join(texts).strip()
                    if text:
                        total_paragraphs += 1
                        total_chars += len(text)
    except Exception:
        pass

    avg_chars = total_chars / total_paragraphs if total_paragraphs > 0 else 0
    return {
        "has_images": has_images,
        "total_paragraphs": total_paragraphs,
        "avg_chars_per_paragraph": avg_chars,
    }


def _iter_block_items(doc):
    """Yield paragraphs and tables in document order."""
    from docx.oxml.ns import qn
    from docx.table import Table
    from docx.text.paragraph import Paragraph

    parent = doc.element.body
    for child in parent.iterchildren():
        if child.tag == qn("w:p"):
            yield Paragraph(child, parent)
        elif child.tag == qn("w:tbl"):
            yield Table(child, parent)


def _format_table(table) -> str:
    rows = []
    for row in table.rows:
        cells = [cell.text.strip() for cell in row.cells]
        rows.append(" | ".join(cells))
    return "\n".join(rows)


def _extract_via_python_docx(file_bytes: bytes):
    from docx import Document

    doc = Document(io.BytesIO(file_bytes))
    parts, chars, truncated, count = [], 0, False, 0

    for block in _iter_block_items(doc):
        from docx.table import Table
        from docx.text.paragraph import Paragraph

        if isinstance(block, Paragraph):
            text = block.text.strip()
            if not text:
                continue
            block_text = text
        elif isinstance(block, Table):
            block_text = "[TABELA]\n" + _format_table(block) + "\n[/TABELA]"
        else:
            continue

        count += 1
        remaining = MAX_CHARS_EXTRACTED - chars
        if len(block_text) > remaining:
            parts.append(block_text[:remaining])
            truncated = True
            break
        parts.append(block_text)
        chars += len(block_text)

    return "\n".join(parts), count, truncated


def _extract_via_xml(file_bytes: bytes):
    from defusedxml.ElementTree import fromstring as _xml_fromstring  # defesa contra XML bomb/XXE

    W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main"
    with zipfile.ZipFile(io.BytesIO(file_bytes)) as zf:
        if "word/document.xml" not in zf.namelist():
            raise ValueError("word/document.xml not found")
        xml_bytes = zf.read("word/document.xml")

    root = _xml_fromstring(xml_bytes)
    parts, chars, truncated, count = [], 0, False, 0

    for para in root.iter("{%s}p" % W):
        texts = [t.text for t in para.iter("{%s}t" % W) if t.text]
        text = "".join(texts).strip()
        if not text:
            continue
        count += 1
        remaining = MAX_CHARS_EXTRACTED - chars
        if len(text) > remaining:
            parts.append(text[:remaining])
            truncated = True
            break
        parts.append(text)
        chars += len(text)

    return "\n".join(parts), count, truncated


async def _extract_with_gemini(file_bytes: bytes) -> str:
    """Upload entire DOCX to Gemini Files API — handles images, tables, charts."""
    try:
        import google.generativeai as genai
    except ImportError:
        return ""

    api_key = os.getenv("GEMINI_API_KEY")
    if not api_key:
        return ""

    genai.configure(api_key=api_key)

    tmp_path = None
    try:
        with tempfile.NamedTemporaryFile(suffix=".docx", delete=False) as tmp:
            tmp.write(file_bytes)
            tmp_path = tmp.name

        uploaded_file = genai.upload_file(tmp_path, mime_type=DOCX_MIME)

        model = genai.GenerativeModel("gemini-2.5-flash-lite")
        response = model.generate_content([
            (
                "Extraia TODO o conteúdo deste documento Word com máxima fidelidade. "
                "Inclua: texto de parágrafos, conteúdo de tabelas (em formato tabular), "
                "descrição de gráficos e imagens, KPIs, métricas e dados numéricos. "
                "Preserve a estrutura: cabeçalhos, listas, seções. "
                "Inclua TODO o documento sem omitir nenhuma página ou seção. "
                "Responda apenas com o conteúdo extraído."
            ),
            uploaded_file,
        ])

        try:
            genai.delete_file(uploaded_file.name)
        except Exception:
            pass

        return response.text if response.text else ""

    except Exception as e:
        print(f"[GEMINI-DOCX] Failed: {e}")
        return ""
    finally:
        if tmp_path:
            try:
                os.unlink(tmp_path)
            except Exception:
                pass


def _extract_sync(file_bytes: bytes) -> tuple:
    """Returns (text, count, truncated, has_images, needs_vision)."""
    if _check_zip_bomb(file_bytes):
        return "", 0, False, False, False

    analysis = _analyze_docx(file_bytes)
    has_images = analysis["has_images"]
    avg_chars = analysis["avg_chars_per_paragraph"]
    total_para = analysis["total_paragraphs"]

    # Try python-docx first (paragraphs + tables in order)
    text, count, truncated = "", 0, False
    try:
        text, count, truncated = _extract_via_python_docx(file_bytes)
    except MemoryError:
        gc.collect()
        return "", 0, False, has_images, False
    except Exception:
        pass

    # Fallback to raw XML
    if not text.strip():
        try:
            text, count, truncated = _extract_via_xml(file_bytes)
        except Exception:
            pass

    native_avg = len(text) / count if count > 0 else avg_chars

    # Escalate to Gemini if: has visual content OR text density is suspiciously low
    needs_vision = has_images or (total_para > 5 and native_avg < 80)

    print(
        f"[DOCX-ANALYSIS] paragraphs={total_para}, has_images={has_images}, "
        f"native_avg={native_avg:.0f} chars/para, needs_vision={needs_vision}"
    )

    return text, count, truncated, has_images, needs_vision


async def parse_docx(file_bytes: bytes) -> DocxParseResult:
    # Guard: zip bomb → rejeita com FILE_TOO_LARGE (não "malformed")
    if _check_zip_bomb(file_bytes):
        return DocxParseResult(
            text="", paragraphs=0, truncated=False, has_images=False,
            extraction_method="rejected",
            error_code=DocumentErrorCode.FILE_TOO_LARGE,
            error_message="Documento rejeitado: taxa de compressão suspeita (zip bomb)",
        )

    # Phase 1: Native extraction
    try:
        text, count, truncated, has_images, needs_vision = await asyncio.wait_for(
            asyncio.get_event_loop().run_in_executor(None, _extract_sync, file_bytes),
            timeout=MAX_EXTRACTION_TIME_S,
        )
    except asyncio.TimeoutError:
        gc.collect()
        return DocxParseResult(
            text="", paragraphs=0, truncated=False, has_images=False,
            extraction_method="timeout",
            error_code=DocumentErrorCode.TIMEOUT,
            error_message="Extraction exceeded time limit",
        )

    if not text and not needs_vision:
        return DocxParseResult(
            text="", paragraphs=0, truncated=False, has_images=has_images,
            extraction_method="none",
            error_code=DocumentErrorCode.MALFORMED,
            error_message="Could not extract text from document",
        )

    extraction_method = "native"

    # Phase 2: Gemini Files API — full document OCR/understanding
    if needs_vision:
        print(f"[GEMINI-DOCX] Triggering full-document extraction ({count} paragraphs native)")
        try:
            vision_text = await asyncio.wait_for(
                _extract_with_gemini(file_bytes),
                timeout=180.0,
            )
            if vision_text:
                if text.strip():
                    combined = text + "\n\n[CONTEÚDO VISUAL E ESTRUTURAL VIA GEMINI]\n" + vision_text
                    extraction_method = "hybrid"
                else:
                    combined = vision_text
                    extraction_method = "vision"

                return DocxParseResult(
                    text=combined[:MAX_CHARS_EXTRACTED],
                    paragraphs=count,
                    truncated=len(combined) > MAX_CHARS_EXTRACTED,
                    has_images=has_images,
                    extraction_method=extraction_method,
                    error_code=None,
                    error_message=None,
                )
            else:
                print("[GEMINI-DOCX] Empty response, using native text only")
        except Exception as e:
            print(f"[GEMINI-DOCX] Vision failed: {e}, using native text")

    return DocxParseResult(
        text=text,
        paragraphs=count,
        truncated=truncated,
        has_images=has_images,
        extraction_method=extraction_method,
        error_code=None,
        error_message=None,
    )
