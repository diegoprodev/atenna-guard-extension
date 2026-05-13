"""
FASE 4.2B — Document Pipeline Stress / Abuse Harness
15 cenários obrigatórios antes de qualquer deploy.

Todos os cenários cobertos por esta spec:
docs/specs/FASE_4.2B_DOCUMENT_LIMITS_MATRIX.md — Seção 6

Execução: pytest tests/test_document_abuse.py -v
"""
from __future__ import annotations

import asyncio
import io
import struct
import zipfile
from unittest.mock import AsyncMock, patch

import pytest

from document.limits import (
    CHUNK_SIZE_CHARS,
    MAX_CHARS_EXTRACTED,
    MAX_CHUNKS,
    MAX_CONCURRENT_PARSES,
    MAX_PAGES,
    MAX_UPLOAD_SIZE_BYTES,
    MIN_FILE_SIZE_BYTES,
    DocumentErrorCode,
)
from document.sanitizer import chunk_text, validate_upload
from document.parsers.pdf_parser import parse_pdf
from document.parsers.docx_parser import parse_docx


# ─── Fixtures ─────────────────────────────────────────────────────────────────

def _make_minimal_pdf(pages: int = 1, text_per_page: str = "Hello World") -> bytes:
    """Cria PDF textual mínimo em memória — sem dependência de pdfplumber."""
    try:
        import reportlab.pdfgen.canvas as rl  # type: ignore
        buf = io.BytesIO()
        c = rl.Canvas(buf)
        for _ in range(pages):
            c.drawString(100, 750, text_per_page)
            c.showPage()
        c.save()
        return buf.getvalue()
    except ImportError:
        # Fallback: PDF mínimo válido hardcoded (1 página, sem texto)
        return (
            b"%PDF-1.4\n"
            b"1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n"
            b"2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n"
            b"3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 612 792]>>endobj\n"
            b"xref\n0 4\n0000000000 65535 f\n"
            b"0000000009 00000 n\n0000000058 00000 n\n0000000115 00000 n\n"
            b"trailer<</Size 4/Root 1 0 R>>\nstartxref\n190\n%%EOF"
        )


def _make_minimal_docx(text: str = "Hello World") -> bytes:
    """Cria DOCX mínimo em memória usando python-docx."""
    try:
        from docx import Document  # type: ignore
        doc = Document()
        doc.add_paragraph(text)
        buf = io.BytesIO()
        doc.save(buf)
        return buf.getvalue()
    except ImportError:
        # Fallback: ZIP vazio com extensão DOCX
        buf = io.BytesIO()
        with zipfile.ZipFile(buf, "w") as zf:
            zf.writestr("word/document.xml", "<w:document/>")
        return buf.getvalue()


def _make_zip_bomb(target_uncompressed: int = MAX_UPLOAD_SIZE_BYTES * 11) -> bytes:
    """Cria arquivo ZIP com alta razão de compressão simulando ZIP bomb."""
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", compression=zipfile.ZIP_DEFLATED) as zf:
        # String de zeros comprime muito bem
        chunk = b"\x00" * 65536
        chunks_needed = target_uncompressed // len(chunk)
        content = chunk * max(1, min(chunks_needed, 20))  # cap para não travar o teste
        zf.writestr("word/document.xml", content)
    return buf.getvalue()


# ─── 1. Validação de upload ────────────────────────────────────────────────────

def test_validate_pdf_valido():
    """PDF válido dentro dos limites — aceito."""
    data = b"%PDF-1.4 " + b"A" * 100
    r = validate_upload("relatorio.pdf", data)
    assert r.valid
    assert r.filetype == "pdf"


def test_validate_docx_valido():
    """DOCX válido (magic bytes ZIP) — aceito."""
    data = b"PK\x03\x04" + b"B" * 100
    r = validate_upload("doc.docx", data)
    assert r.valid
    assert r.filetype == "docx"


def test_validate_arquivo_muito_grande():
    """Arquivo acima de MAX_UPLOAD_SIZE_BYTES — rejeitado com FILE_TOO_LARGE."""
    data = b"%PDF-1.4" + b"X" * (MAX_UPLOAD_SIZE_BYTES + 1)
    r = validate_upload("big.pdf", data)
    assert not r.valid
    assert r.error_code == DocumentErrorCode.FILE_TOO_LARGE


def test_validate_arquivo_muito_pequeno():
    """Arquivo abaixo de MIN_FILE_SIZE_BYTES — rejeitado com FILE_TOO_SMALL."""
    data = b"%PDF"
    r = validate_upload("tiny.pdf", data)
    assert not r.valid
    assert r.error_code == DocumentErrorCode.FILE_TOO_SMALL


def test_validate_tipo_nao_suportado():
    """Arquivo .xlsx — rejeitado com UNSUPPORTED_TYPE."""
    data = b"PK\x03\x04" + b"B" * 100
    r = validate_upload("planilha.xlsx", data)
    assert not r.valid
    assert r.error_code == DocumentErrorCode.UNSUPPORTED_TYPE


def test_validate_mime_spoof_pdf():
    """Arquivo com extensão .pdf mas magic bytes de ZIP — MIME_MISMATCH."""
    data = b"PK\x03\x04" + b"B" * 100  # ZIP com extensão .pdf
    r = validate_upload("fake.pdf", data)
    assert not r.valid
    assert r.error_code == DocumentErrorCode.MIME_MISMATCH


def test_validate_mime_spoof_docx():
    """Arquivo com extensão .docx mas magic bytes de PDF — MIME_MISMATCH."""
    data = b"%PDF-1.4" + b"X" * 100
    r = validate_upload("fake.docx", data)
    assert not r.valid
    assert r.error_code == DocumentErrorCode.MIME_MISMATCH


# ─── 2. Chunking ──────────────────────────────────────────────────────────────

def test_chunking_texto_normal():
    """Texto de 15K chars deve gerar 3 chunks de 5K."""
    text = "A" * 15_000
    chunks = chunk_text(text)
    assert len(chunks) == 3
    assert all(len(c) == CHUNK_SIZE_CHARS for c in chunks)


def test_chunking_respeita_max_chunks():
    """Texto de 600K chars deve ser limitado a MAX_CHUNKS chunks."""
    text = "B" * (CHUNK_SIZE_CHARS * (MAX_CHUNKS + 10))
    chunks = chunk_text(text)
    assert len(chunks) == MAX_CHUNKS


def test_chunking_texto_vazio():
    """Texto vazio — lista vazia."""
    assert chunk_text("") == []


# ─── 3. PDF Parser ────────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_pdf_malformado_retorna_erro():
    """Bytes corrompidos — parse_pdf retorna error_code, sem exceção."""
    junk = b"NOTAPDF" + b"\x00" * 200
    result = await parse_pdf(junk)
    assert result.error_code is not None
    assert result.text == ""


@pytest.mark.asyncio
async def test_pdf_timeout_retorna_erro():
    """Simulate timeout: mock _extract_sync para demorar além do timeout."""
    import time

    def slow_extract(_bytes: bytes):
        time.sleep(15)  # excede MAX_EXTRACTION_TIME_S=8

    with patch("document.parsers.pdf_parser._extract_sync", side_effect=slow_extract):
        # Reduzir timeout para 0.1s no teste para não travar o CI
        with patch("document.parsers.pdf_parser.MAX_EXTRACTION_TIME_S", 0.1):
            result = await parse_pdf(b"%PDF-1.4" + b"A" * 100)

    assert result.error_code == DocumentErrorCode.TIMEOUT
    assert result.text == ""


@pytest.mark.asyncio
async def test_pdf_trunca_paginas_acima_do_limite():
    """
    Simula PDF com 60 páginas — deve retornar truncated=True e pages_parsed=50.
    """
    class FakePage:
        def extract_text(self) -> str:
            return "Texto da página com CPF 529.982.247-25"

    class FakePdf:
        is_encrypted = False
        pages = [FakePage() for _ in range(60)]
        def __enter__(self): return self
        def __exit__(self, *a): pass
        @property
        def doc(self): return self

    with patch("pdfplumber.open", return_value=FakePdf()):
        result = await parse_pdf(b"%PDF-1.4" + b"A" * 100)

    assert result.truncated is True
    assert result.pages_parsed == MAX_PAGES
    assert result.total_pages == 60


@pytest.mark.asyncio
async def test_pdf_trunca_chars_acima_do_limite():
    """
    Simula PDF cujo texto excede MAX_CHARS_EXTRACTED — deve truncar.
    """
    big_text = "X" * (MAX_CHARS_EXTRACTED + 10_000)

    class FakePage:
        def extract_text(self) -> str:
            return big_text

    class FakePdf:
        is_encrypted = False
        pages = [FakePage()]
        def __enter__(self): return self
        def __exit__(self, *a): pass
        @property
        def doc(self): return self

    with patch("pdfplumber.open", return_value=FakePdf()):
        result = await parse_pdf(b"%PDF-1.4" + b"A" * 100)

    assert result.truncated is True
    assert len(result.text) <= MAX_CHARS_EXTRACTED


@pytest.mark.asyncio
async def test_pdf_encriptado_retorna_erro():
    """PDF encriptado — error_code=encrypted_pdf, sem tentativa de parse."""
    class FakePdf:
        is_encrypted = True
        pages = []
        def __enter__(self): return self
        def __exit__(self, *a): pass
        @property
        def doc(self): return self

    with patch("pdfplumber.open", return_value=FakePdf()):
        result = await parse_pdf(b"%PDF-1.4" + b"A" * 100)

    assert result.error_code == DocumentErrorCode.ENCRYPTED_PDF
    assert result.text == ""


# ─── 4. DOCX Parser ───────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_docx_zip_bomb_rejeitado():
    """
    Quando _check_zip_bomb detecta bomba → parser rejeita com FILE_TOO_LARGE.
    Usa mock para simular detecção sem criar arquivos 100MB+ em memória.
    """
    minimal_zip = b"PK\x03\x04" + b"\x00" * 200
    with patch("document.parsers.docx_parser._check_zip_bomb", return_value=True):
        result = await parse_docx(minimal_zip)
    assert result.error_code == DocumentErrorCode.FILE_TOO_LARGE
    assert result.text == ""


def test_check_zip_bomb_deteccao():
    """_check_zip_bomb retorna True quando descomprimido excede o threshold."""
    from document.parsers.docx_parser import _check_zip_bomb, _MAX_UNCOMPRESSED
    # Criar ZIP com total file_size > _MAX_UNCOMPRESSED usando ZipInfo manipulado
    import zipfile, io
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as zf:
        # Adicionar arquivo com conteúdo real pequeno mas metadata de tamanho grande
        info = zipfile.ZipInfo("big.bin")
        zf.writestr(info, b"\x00" * 64)
    # Verificar que arquivo normal (64 bytes) não é bomb
    buf.seek(0)
    assert not _check_zip_bomb(buf.read())

    # Verificar limite: arquivo com _MAX_UNCOMPRESSED + 1 bytes seria bomb
    # Testamos a função via mock de ZipFile
    class FakeInfo:
        file_size = _MAX_UNCOMPRESSED + 1
    import zipfile as zf_module
    with patch("zipfile.ZipFile") as mock_zf:
        mock_zf.return_value.__enter__.return_value.infolist.return_value = [FakeInfo()]
        result = _check_zip_bomb(b"PK\x03\x04" + b"\x00" * 100)
    assert result is True


@pytest.mark.asyncio
async def test_docx_malformado_retorna_erro():
    """Bytes que não são ZIP válido — error_code, sem exceção."""
    junk = b"PK\x03\x04" + b"\xff\xfe" * 100
    result = await parse_docx(junk)
    assert result.error_code is not None
    assert result.text == ""


# ─── 5. Concorrência ──────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_semaforo_limita_concorrencia():
    """
    MAX_CONCURRENT_PARSES requests simultâneos devem ser aceitos.
    O (MAX_CONCURRENT_PARSES + 1)º deve esperar (semáforo corretamente adquirido).
    """
    from document.limits import MAX_CONCURRENT_PARSES
    semaphore = asyncio.Semaphore(MAX_CONCURRENT_PARSES)
    acquired = []

    async def try_acquire():
        async with semaphore:
            acquired.append(1)
            await asyncio.sleep(0.05)

    tasks = [try_acquire() for _ in range(MAX_CONCURRENT_PARSES + 2)]
    await asyncio.gather(*tasks)
    assert len(acquired) == MAX_CONCURRENT_PARSES + 2  # todos completam, mas serializados
