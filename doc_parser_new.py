from __future__ import annotations
import asyncio
import gc
import re
from dataclasses import dataclass


MAX_CHARS_EXTRACTED = 500_000
MAX_EXTRACTION_TIME_S = 60


class DocumentErrorCode:
    PARSE_ERROR = 'parse_error'
    MALFORMED = 'malformed_document'
    FILE_TOO_LARGE = 'file_too_large'
    TIMEOUT = 'extraction_timeout'


@dataclass(frozen=True)
class DocParseResult:
    text:          str
    paragraphs:    int
    truncated:     bool
    error_code:    str | None
    error_message: str | None


_HEX_RE = re.compile(r"\\'([0-9a-fA-F]{2})")


def _hex_replace(m: re.Match) -> str:
    try:
        return bytes.fromhex(m.group(1)).decode('latin-1')
    except Exception:
        return ''


def _remove_rtf_group(text: str, keyword: str) -> str:
    """Remove balanced RTF group containing keyword (e.g. fonttbl, stylesheet)."""
    pat = re.compile(r'\\' + re.escape(keyword) + r'\b')
    result = []
    i = 0
    while i < len(text):
        m = pat.search(text, i)
        if not m:
            result.append(text[i:])
            break
        abs_kw = m.start()
        # Find opening brace before keyword
        brace_pos = text.rfind('{', i, abs_kw)
        if brace_pos == -1:
            result.append(text[i:])
            break
        result.append(text[i:brace_pos])
        # Skip balanced braces
        depth = 1
        j = brace_pos + 1
        while j < len(text) and depth > 0:
            if text[j] == '{':
                depth += 1
            elif text[j] == '}':
                depth -= 1
            j += 1
        i = j
    return ''.join(result)


def _strip_rtf(data: bytes) -> str:
    try:
        text = data.decode('latin-1', errors='replace')
    except Exception:
        text = data.decode('utf-8', errors='replace')

    # Remove metadata groups
    for kw in ('fonttbl', 'colortbl', 'stylesheet', 'listtable',
                'listoverridetable', 'rsidtbl', 'generator', 'info',
                'header', 'footer', 'headerf', 'footerf',
                'pict', 'object', 'fldinst', 'fldrslt'):
        try:
            text = _remove_rtf_group(text, kw)
        except Exception:
            pass

    # Convert hex escapes
    text = _HEX_RE.sub(_hex_replace, text)

    # RTF special chars → readable
    text = text.replace('\\ ', ' ')
    text = re.sub(r'\\par\b ?', '\n', text)
    text = re.sub(r'\\line\b ?', '\n', text)
    text = re.sub(r'\\tab\b ?', '\t', text)
    text = re.sub(r'\\page\b ?', '\n', text)

    # Remove remaining RTF control words and symbols
    text = re.sub(r'\\[a-zA-Z]+\-?\d* ?', '', text)
    text = re.sub(r'\\[^a-zA-Z\n]', '', text)
    text = text.replace('{', '').replace('}', '')

    # Filter lines: keep only lines with >= 70% printable chars
    clean_lines = []
    for line in text.splitlines():
        line = line.strip()
        if not line:
            continue
        printable = sum(1 for c in line if ('\x20' <= c <= '\x7e') or ('\xa0' <= c <= '˿'))
        ratio = printable / len(line)
        if ratio >= 0.70:
            clean_lines.append(line)

    result = '\n'.join(clean_lines)
    result = re.sub(r'\n{3,}', '\n\n', result)
    return result.strip()


def _truncate(text: str):
    if len(text) > MAX_CHARS_EXTRACTED:
        return text[:MAX_CHARS_EXTRACTED], True
    return text, False


def _extract_sync(file_bytes: bytes) -> DocParseResult:
    is_rtf = file_bytes[:5] in (b'{\\rtf', b'{\\rt\n')
    is_ole = file_bytes[:8] == b'\xd0\xcf\x11\xe0\xa1\xb1\x1a\xe1'

    if is_rtf:
        try:
            text = _strip_rtf(file_bytes)
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

    try:
        import mammoth, io
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
            import olefile, io
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
            timeout=MAX_EXTRACTION_TIME_S,
        )
    except asyncio.TimeoutError:
        gc.collect()
        result = DocParseResult(text='', paragraphs=0, truncated=False,
                                error_code=DocumentErrorCode.TIMEOUT,
                                error_message='Extraction exceeded time limit')
    return result
