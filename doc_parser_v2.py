from __future__ import annotations
import asyncio
import gc
import re
from dataclasses import dataclass


try:
    from document.limits import DocumentErrorCode
    _MAX_CHARS = 2_000_000
    _TIMEOUT   = 60.0
except ImportError:
    _MAX_CHARS = 2_000_000
    _TIMEOUT   = 60.0

    class DocumentErrorCode:  # type: ignore[no-redef]
        PARSE_ERROR = 'parse_error'
        MALFORMED   = 'malformed_document'
        TIMEOUT     = 'extraction_timeout'


@dataclass(frozen=True)
class DocParseResult:
    text:          str
    paragraphs:    int
    truncated:     bool
    error_code:    str | None
    error_message: str | None


def _truncate(text: str):
    if len(text) > _MAX_CHARS:
        return text[:_MAX_CHARS], True
    return text, False


def _strip_rtf_lib(data: bytes) -> str:
    """Primary: use striprtf library — handles nested groups, tables, encoding."""
    from striprtf.striprtf import rtf_to_text
    try:
        text = data.decode('utf-8', errors='replace')
    except Exception:
        text = data.decode('latin-1', errors='replace')
    return rtf_to_text(text, errors='ignore') or ''


_HEX_RE = re.compile(r"\\'([0-9a-fA-F]{2})")


def _hex_replace(m: re.Match) -> str:
    try:
        return bytes.fromhex(m.group(1)).decode('latin-1')
    except Exception:
        return ''


def _strip_rtf_regex(data: bytes) -> str:
    """Fallback regex-based RTF stripper if striprtf unavailable."""
    try:
        text = data.decode('latin-1', errors='replace')
    except Exception:
        text = data.decode('utf-8', errors='replace')

    # Truncate at last balanced closing brace (RTF document boundary)
    depth = 0
    last_close = len(text)
    for idx, ch in enumerate(text):
        if ch == '{':
            depth += 1
        elif ch == '}':
            depth -= 1
            if depth == 0:
                last_close = idx + 1
                break
    text = text[:last_close]

    text = _HEX_RE.sub(_hex_replace, text)
    text = re.sub(r'\\ ', ' ', text)
    text = re.sub(r'\\par\b ?', '\n', text)
    text = re.sub(r'\\line\b ?', '\n', text)
    text = re.sub(r'\\tab\b ?', '\t', text)
    text = re.sub(r'\\page\b ?', '\n', text)
    text = re.sub(r'\\[a-zA-Z]+-?\d* ?', '', text)
    text = re.sub(r'\\[^a-zA-Z\n]', '', text)
    text = text.replace('{', '').replace('}', '')

    clean_lines = []
    for line in text.splitlines():
        line = line.strip()
        if not line:
            continue
        printable = sum(1 for c in line if ('\x20' <= c <= '\x7e') or ('\xa0' <= c <= '\xff'))
        if printable / len(line) >= 0.70:
            clean_lines.append(line)

    result = '\n'.join(clean_lines)
    result = re.sub(r'\n{3,}', '\n\n', result)
    return result.strip()


def _extract_sync(file_bytes: bytes) -> DocParseResult:
    is_rtf = file_bytes[:5] in (b'{\\rtf', b'{\\rt\n')
    is_ole = file_bytes[:8] == b'\xd0\xcf\x11\xe0\xa1\xb1\x1a\xe1'

    if is_rtf:
        # Primary: striprtf library (handles complex RTF with tables/images)
        try:
            text = _strip_rtf_lib(file_bytes)
            text, truncated = _truncate(text)
            if text.strip():
                return DocParseResult(text=text, paragraphs=text.count('\n') + 1,
                                      truncated=truncated, error_code=None, error_message=None)
        except Exception:
            pass

        # Fallback: regex stripper
        try:
            text = _strip_rtf_regex(file_bytes)
            text, truncated = _truncate(text)
            if text.strip():
                return DocParseResult(text=text, paragraphs=text.count('\n') + 1,
                                      truncated=truncated, error_code=None, error_message=None)
        except MemoryError:
            gc.collect()
            return DocParseResult(text='', paragraphs=0, truncated=False,
                                  error_code=DocumentErrorCode.PARSE_ERROR,
                                  error_message='Memory limit exceeded')
        except Exception:
            pass

    # mammoth handles DOCX-embedded-in-.doc and some RTF variants
    try:
        import mammoth
        import io
        result = mammoth.extract_raw_text(io.BytesIO(file_bytes))
        text = result.value or ''
        text, truncated = _truncate(text)
        if text.strip():
            return DocParseResult(text=text, paragraphs=text.count('\n') + 1,
                                  truncated=truncated, error_code=None, error_message=None)
    except MemoryError:
        gc.collect()
        return DocParseResult(text='', paragraphs=0, truncated=False,
                              error_code=DocumentErrorCode.PARSE_ERROR,
                              error_message='Memory limit exceeded')
    except Exception:
        pass

    if is_ole:
        try:
            import olefile
            import io
            ole = olefile.OleFileIO(io.BytesIO(file_bytes))
            if ole.exists('WordDocument'):
                raw = ole.openstream('WordDocument').read()
                chunks = re.findall(rb'[\x20-\x7e\xc0-\xff]{6,}', raw)
                text = ' '.join(c.decode('latin-1', errors='replace') for c in chunks)
                text, truncated = _truncate(text)
                ole.close()
                if text.strip():
                    return DocParseResult(text=text, paragraphs=1, truncated=truncated,
                                          error_code=None, error_message=None)
        except Exception:
            pass

    return DocParseResult(text='', paragraphs=0, truncated=False,
                          error_code=DocumentErrorCode.MALFORMED,
                          error_message='Could not parse .doc file')


async def parse_doc(file_bytes: bytes) -> DocParseResult:
    try:
        result = await asyncio.wait_for(
            asyncio.get_event_loop().run_in_executor(None, _extract_sync, file_bytes),
            timeout=_TIMEOUT,
        )
    except asyncio.TimeoutError:
        gc.collect()
        result = DocParseResult(text='', paragraphs=0, truncated=False,
                                error_code=DocumentErrorCode.TIMEOUT,
                                error_message='Extraction exceeded time limit')
    return result
