"""
DOC Parser v2 — Enterprise extraction for .doc (RTF/OLE) with smart Gemini escalation.
- Native RTF: striprtf library (handles nested groups, tables, encoding)
- Native RTF fallback: regex stripper
- Native OLE: mammoth → olefile raw extraction
- Smart escalation: triggers Gemini only when visual content detected OR density low
- Gemini: uploads entire .doc — handles images, tables, graphs
"""
from __future__ import annotations

import asyncio
import gc
import io
import os
import re
import tempfile
from dataclasses import dataclass
from typing import Optional

try:
    from document.limits import DocumentErrorCode, MAX_CHARS_EXTRACTED, MAX_EXTRACTION_TIME_S
    _TIMEOUT = MAX_EXTRACTION_TIME_S
    _MAX_CHARS = MAX_CHARS_EXTRACTED
except ImportError:
    _MAX_CHARS = 2_000_000
    _TIMEOUT = 60.0

    class DocumentErrorCode:  # type: ignore[no-redef]
        PARSE_ERROR = "parse_error"
        MALFORMED = "malformed_document"
        TIMEOUT = "extraction_timeout"

# Gemini MIME for .doc (Word 97-2003)
DOC_MIME = "application/msword"

_HEX_RE = re.compile(r"\\'([0-9a-fA-F]{2})")


@dataclass(frozen=True)
class DocParseResult:
    text: str
    paragraphs: int
    truncated: bool
    has_images: bool
    extraction_method: str  # "native", "vision", "hybrid", "fallback", "timeout", "none"
    error_code: Optional[str]
    error_message: Optional[str]


def _truncate(text: str):
    if len(text) > _MAX_CHARS:
        return text[:_MAX_CHARS], True
    return text, False


def _detect_rtf_images(data: bytes) -> bool:
    """Check for embedded image keywords in RTF."""
    sample = data[:200_000]
    return b"\\pict" in sample or b"\\emfblip" in sample or b"\\wmetafile" in sample


def _detect_ole_images(file_bytes: bytes) -> bool:
    """Check OLE for image streams."""
    try:
        import olefile
        ole = olefile.OleFileIO(io.BytesIO(file_bytes))
        names = ole.listdir()
        ole.close()
        for parts in names:
            name = "/".join(parts).lower()
            if "image" in name or "picture" in name or "object" in name:
                return True
    except Exception:
        pass
    return False


def _strip_rtf_lib(data: bytes) -> str:
    from striprtf.striprtf import rtf_to_text
    try:
        text = data.decode("utf-8", errors="replace")
    except Exception:
        text = data.decode("latin-1", errors="replace")
    return rtf_to_text(text, errors="ignore") or ""


def _hex_replace(m: re.Match) -> str:
    try:
        return bytes.fromhex(m.group(1)).decode("latin-1")
    except Exception:
        return ""


def _strip_rtf_regex(data: bytes) -> str:
    try:
        text = data.decode("latin-1", errors="replace")
    except Exception:
        text = data.decode("utf-8", errors="replace")

    depth, last_close = 0, len(text)
    for idx, ch in enumerate(text):
        if ch == "{":
            depth += 1
        elif ch == "}":
            depth -= 1
            if depth == 0:
                last_close = idx + 1
                break
    text = text[:last_close]

    text = _HEX_RE.sub(_hex_replace, text)
    text = re.sub(r"\\ ", " ", text)
    text = re.sub(r"\\par\b ?", "\n", text)
    text = re.sub(r"\\line\b ?", "\n", text)
    text = re.sub(r"\\tab\b ?", "\t", text)
    text = re.sub(r"\\page\b ?", "\n", text)
    text = re.sub(r"\\[a-zA-Z]+-?\d* ?", "", text)
    text = re.sub(r"\\[^a-zA-Z\n]", "", text)
    text = text.replace("{", "").replace("}", "")

    clean_lines = []
    for line in text.splitlines():
        line = line.strip()
        if not line:
            continue
        printable = sum(1 for c in line if ("\x20" <= c <= "\x7e") or ("\xa0" <= c <= "\xff"))
        if printable / len(line) >= 0.70:
            clean_lines.append(line)

    result = "\n".join(clean_lines)
    result = re.sub(r"\n{3,}", "\n\n", result)
    return result.strip()


async def _extract_with_gemini(file_bytes: bytes) -> str:
    """Upload entire .doc to Gemini Files API."""
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
        with tempfile.NamedTemporaryFile(suffix=".doc", delete=False) as tmp:
            tmp.write(file_bytes)
            tmp_path = tmp.name

        uploaded_file = genai.upload_file(tmp_path, mime_type=DOC_MIME)

        model = genai.GenerativeModel("gemini-2.5-flash-lite")
        response = model.generate_content([
            (
                "Extraia TODO o conteúdo deste documento Word com máxima fidelidade. "
                "Inclua: texto de parágrafos, conteúdo de tabelas (em formato tabular), "
                "descrição de gráficos e imagens, KPIs, métricas e dados numéricos. "
                "Preserve a estrutura: cabeçalhos, listas, seções. "
                "Inclua TODO o documento sem omitir nenhuma parte. "
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
        print(f"[GEMINI-DOC] Failed: {e}")
        return ""
    finally:
        if tmp_path:
            try:
                os.unlink(tmp_path)
            except Exception:
                pass


def _extract_sync(file_bytes: bytes) -> tuple:
    """Returns (text, paragraphs, truncated, has_images, needs_vision)."""
    is_rtf = file_bytes[:5] in (b"{\\rtf", b"{\\rt\n")
    is_ole = file_bytes[:8] == b"\xd0\xcf\x11\xe0\xa1\xb1\x1a\xe1"

    has_images = False
    text = ""

    if is_rtf:
        has_images = _detect_rtf_images(file_bytes)

        try:
            text = _strip_rtf_lib(file_bytes)
        except Exception:
            pass

        if not text.strip():
            try:
                text = _strip_rtf_regex(file_bytes)
            except MemoryError:
                gc.collect()
                return "", 0, False, has_images, False
            except Exception:
                pass

    if not text.strip():
        try:
            import mammoth
            result = mammoth.extract_raw_text(io.BytesIO(file_bytes))
            text = result.value or ""
        except MemoryError:
            gc.collect()
            return "", 0, False, has_images, False
        except Exception:
            pass

    if not text.strip() and is_ole:
        has_images = has_images or _detect_ole_images(file_bytes)
        try:
            import olefile
            ole = olefile.OleFileIO(io.BytesIO(file_bytes))
            if ole.exists("WordDocument"):
                raw = ole.openstream("WordDocument").read()
                chunks = re.findall(rb"[\x20-\x7e\xc0-\xff]{6,}", raw)
                text = " ".join(c.decode("latin-1", errors="replace") for c in chunks)
            ole.close()
        except Exception:
            pass

    text, truncated = _truncate(text)
    paragraphs = text.count("\n") + 1 if text.strip() else 0
    avg_chars = len(text) / paragraphs if paragraphs > 0 else 0

    # Escalate to Gemini if: visual content detected OR text suspiciously sparse
    needs_vision = has_images or (paragraphs > 3 and avg_chars < 80)

    print(
        f"[DOC-ANALYSIS] is_rtf={is_rtf}, is_ole={is_ole}, has_images={has_images}, "
        f"paragraphs={paragraphs}, avg_chars={avg_chars:.0f}, needs_vision={needs_vision}"
    )

    return text, paragraphs, truncated, has_images, needs_vision


async def parse_doc(file_bytes: bytes) -> DocParseResult:
    # Phase 1: Native extraction
    try:
        text, paragraphs, truncated, has_images, needs_vision = await asyncio.wait_for(
            asyncio.get_event_loop().run_in_executor(None, _extract_sync, file_bytes),
            timeout=_TIMEOUT,
        )
    except asyncio.TimeoutError:
        gc.collect()
        return DocParseResult(
            text="", paragraphs=0, truncated=False, has_images=False,
            extraction_method="timeout",
            error_code=DocumentErrorCode.TIMEOUT,
            error_message="Extraction exceeded time limit",
        )

    if not text.strip() and not needs_vision:
        return DocParseResult(
            text="", paragraphs=0, truncated=False, has_images=has_images,
            extraction_method="none",
            error_code=DocumentErrorCode.MALFORMED,
            error_message="Could not parse .doc file",
        )

    extraction_method = "native"

    # Phase 2: Gemini Files API — full document understanding
    if needs_vision:
        print(f"[GEMINI-DOC] Triggering full-document extraction")
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

                return DocParseResult(
                    text=combined[:_MAX_CHARS],
                    paragraphs=paragraphs,
                    truncated=len(combined) > _MAX_CHARS,
                    has_images=has_images,
                    extraction_method=extraction_method,
                    error_code=None,
                    error_message=None,
                )
            else:
                print("[GEMINI-DOC] Empty response, using native text only")
        except Exception as e:
            print(f"[GEMINI-DOC] Vision failed: {e}, using native text")

    return DocParseResult(
        text=text,
        paragraphs=paragraphs,
        truncated=truncated,
        has_images=has_images,
        extraction_method=extraction_method,
        error_code=None,
        error_message=None,
    )
