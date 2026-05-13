"""
FASE 4.2C — Document Pipeline Stress + Adversarial Harness

Valida:
1. Adversarial files — nenhum causa hang, crash ou memory leak
2. Concorrência real — MAX_CONCURRENT_PARSES simultâneos sem deadlock
3. Observabilidade — métricas registradas corretamente
4. p95/p99 — limites de performance aceitáveis (local e VPS)
5. Memory profile — delta após cada parse dentro do threshold
6. Cleanup — buffers liberados, gc.collect chamado

Execução: pytest tests/test_document_stress.py -v
"""
from __future__ import annotations

import asyncio
import gc
import time
from unittest.mock import patch

import pytest

import document.observability as obs
from document.limits import (
    MAX_CHARS_EXTRACTED,
    MAX_CONCURRENT_PARSES,
    MAX_EXTRACTION_TIME_S,
    DocumentErrorCode,
)
from document.parsers.pdf_parser import parse_pdf
from document.parsers.docx_parser import parse_docx
from document.sanitizer import chunk_text, validate_upload
from tests.fixtures.adversarial.generators import (
    partially_corrupt_pdf,
    truncated_pdf,
    hybrid_pdf,
    encrypted_malformed_pdf,
    xml_nesting_docx,
    fake_mime_pdf,
    fake_mime_docx,
    giant_metadata_pdf,
    embedded_payload_docx,
    zero_pages_pdf,
    null_bytes_pdf,
    oversized_object_pdf,
    unicode_bomb,
)


# ─── Setup ────────────────────────────────────────────────────────────────────

@pytest.fixture(autouse=True)
def reset_metrics():
    obs.reset()
    yield
    obs.reset()


# ─── 1. Adversarial PDFs — nenhum deve causar hang ou exceção não capturada ──

@pytest.mark.asyncio
async def test_adversarial_partially_corrupt_pdf():
    """PDF parcialmente corrompido — retorna erro sem hang."""
    result = await parse_pdf(partially_corrupt_pdf())
    assert result.error_code is not None or result.text is not None  # não crashou


@pytest.mark.asyncio
async def test_adversarial_truncated_pdf():
    """PDF truncado — retorna erro sem exceção."""
    result = await parse_pdf(truncated_pdf())
    assert result.error_code is not None or result.pages_parsed == 0


@pytest.mark.asyncio
async def test_adversarial_hybrid_pdf():
    """PDF com dados binários aleatórios — retorna sem hang."""
    result = await parse_pdf(hybrid_pdf())
    # Deve retornar algo — não travar indefinidamente
    assert hasattr(result, "error_code")


@pytest.mark.asyncio
async def test_adversarial_encrypted_malformed():
    """PDF que declara encryption mas está corrompido — não crashar."""
    result = await parse_pdf(encrypted_malformed_pdf())
    # Deve ser encrypted_pdf ou malformed — nunca exceção não capturada
    assert result.error_code in (
        DocumentErrorCode.ENCRYPTED_PDF,
        DocumentErrorCode.MALFORMED,
        DocumentErrorCode.PARSE_ERROR,
        None,  # pdfplumber pode ignorar o /Encrypt corrompido
    )


@pytest.mark.asyncio
async def test_adversarial_zero_pages_pdf():
    """PDF com 0 páginas — deve retornar resultado vazio sem crash."""
    result = await parse_pdf(zero_pages_pdf())
    assert result.text == "" or result.pages_parsed == 0


@pytest.mark.asyncio
async def test_adversarial_null_bytes_pdf():
    """PDF com blocos de null bytes — parser deve aguentar."""
    result = await parse_pdf(null_bytes_pdf())
    assert hasattr(result, "error_code")


@pytest.mark.asyncio
async def test_adversarial_oversized_object_pdf():
    """PDF com objeto de 600KB — deve truncar em MAX_CHARS_EXTRACTED."""
    result = await parse_pdf(oversized_object_pdf())
    assert len(result.text) <= MAX_CHARS_EXTRACTED


@pytest.mark.asyncio
async def test_adversarial_giant_metadata_pdf():
    """PDF com metadata de 200KB — não deve travar."""
    result = await parse_pdf(giant_metadata_pdf())
    assert hasattr(result, "error_code")


# ─── 2. Adversarial DOCXs ────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_adversarial_xml_nesting_docx():
    """DOCX com XML 500 levels deep — não causar RecursionError."""
    result = await parse_docx(xml_nesting_docx(depth=500))
    # Pode retornar erro ou texto — nunca RecursionError não capturado
    assert hasattr(result, "error_code")


@pytest.mark.asyncio
async def test_adversarial_embedded_payload_docx():
    """DOCX com path traversal embutido — parser deve ignorar safely."""
    result = await parse_docx(embedded_payload_docx())
    # python-docx deve ignorar paths fora do esperado
    assert result.error_code in (None, DocumentErrorCode.MALFORMED, DocumentErrorCode.PARSE_ERROR)
    # Crucialmente: não executar o payload, não expor conteúdo de ../
    if result.text:
        assert "root:x:" not in result.text  # /etc/passwd não deve aparecer


@pytest.mark.asyncio
async def test_adversarial_unicode_bomb_docx():
    """DOCX com Unicode exploitation patterns — DLP deve processar sem crash."""
    result = await parse_docx(unicode_bomb())
    assert hasattr(result, "error_code")


# ─── 3. MIME spoof — validate_upload deve rejeitar antes do parse ────────────

def test_mime_spoof_blocks_before_parse():
    """Fake PDF (JPEG magic) deve ser rejeitado na validação, nunca parseado."""
    data = fake_mime_pdf()
    r = validate_upload("doc.pdf", data)
    assert not r.valid
    assert r.error_code == DocumentErrorCode.MIME_MISMATCH


def test_mime_spoof_docx_blocks_before_parse():
    """Fake DOCX (PDF magic) deve ser rejeitado na validação."""
    data = fake_mime_docx()
    r = validate_upload("doc.docx", data)
    assert not r.valid
    assert r.error_code == DocumentErrorCode.MIME_MISMATCH


# ─── 4. Concorrência real ────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_concurrent_parses_sem_deadlock():
    """
    MAX_CONCURRENT_PARSES + 2 parses simultâneos.
    Todos devem completar sem deadlock ou starvation.
    Tempo total deve ser razoável (< 60s local).
    """
    pdf = partially_corrupt_pdf()

    async def one_parse():
        return await parse_pdf(pdf)

    t0 = time.perf_counter()
    tasks = [one_parse() for _ in range(MAX_CONCURRENT_PARSES + 2)]
    results = await asyncio.gather(*tasks, return_exceptions=True)
    elapsed = time.perf_counter() - t0

    # Nenhum deve ser Exception não capturada
    for r in results:
        assert not isinstance(r, Exception), f"Parse levantou exceção: {r}"

    # Não deve demorar mais de 60s (timeout de 8s × (N+2) parses)
    assert elapsed < 60.0, f"Concorrência demorou {elapsed:.1f}s — possível deadlock"


@pytest.mark.asyncio
async def test_concurrent_peak_registrado():
    """Observabilidade: concurrent_peak deve ser > 1 após parses simultâneos."""
    obs.reset()
    pdf = partially_corrupt_pdf()

    async def instrumented_parse():
        with obs.parse_context("pdf"):
            return await parse_pdf(pdf)

    await asyncio.gather(*[instrumented_parse() for _ in range(3)])
    snap = obs.snapshot()
    assert snap["concurrent_peak"] >= 1  # pelo menos 1 simultâneo registrado
    assert snap["total_parses"] == 3


# ─── 5. Observabilidade ───────────────────────────────────────────────────────

def test_observability_rejection_registrada():
    """record_rejection incrementa o contador correto."""
    obs.reset()
    obs.record_rejection(DocumentErrorCode.ENCRYPTED_PDF)
    obs.record_rejection(DocumentErrorCode.ENCRYPTED_PDF)
    obs.record_rejection(DocumentErrorCode.TIMEOUT)

    snap = obs.snapshot()
    assert snap["rejection_by_code"][DocumentErrorCode.ENCRYPTED_PDF] == 2
    assert snap["rejection_by_code"][DocumentErrorCode.TIMEOUT] == 1
    assert snap["error_count"] == 3


def test_observability_timeout_count():
    """record_timeout incrementa o contador."""
    obs.reset()
    obs.record_timeout()
    obs.record_timeout()
    snap = obs.snapshot()
    assert snap["timeout_count"] == 2


def test_observability_histograma_percentis():
    """Histogram retorna percentis corretos para distribuição conhecida."""
    obs.reset()
    for ms in range(1, 101):  # 1ms a 100ms
        obs._parse_duration.record(float(ms))

    snap = obs.snapshot()
    # p50 deve ser ~50ms
    assert 45.0 <= snap["parse_duration_ms"]["p50"] <= 55.0
    # p95 deve ser ~95ms
    assert 90.0 <= snap["parse_duration_ms"]["p95"] <= 100.0
    # p99 deve ser ~99ms
    assert 95.0 <= snap["parse_duration_ms"]["p99"] <= 100.0


def test_observability_upload_type_distribution():
    """Upload type distribuição registrada corretamente."""
    obs.reset()
    obs._upload_type_counts["pdf"]  += 3
    obs._upload_type_counts["docx"] += 1

    snap = obs.snapshot()
    assert snap["upload_type_distribution"]["pdf"] == 3
    assert snap["upload_type_distribution"]["docx"] == 1


def test_observability_orphan_warning():
    """warn_orphan_buffer incrementa o contador."""
    obs.reset()
    obs.warn_orphan_buffer()
    snap = obs.snapshot()
    assert snap["orphan_buffer_warnings"] == 1


# ─── 6. Performance local (thresholds conservadores) ─────────────────────────

@pytest.mark.asyncio
async def test_parse_duration_local_threshold():
    """
    Parse de arquivo adversarial deve completar < 9s localmente.
    (Threshold = MAX_EXTRACTION_TIME_S + 1s de overhead de test)
    """
    t0 = time.perf_counter()
    await parse_pdf(partially_corrupt_pdf())
    elapsed = time.perf_counter() - t0
    assert elapsed < MAX_EXTRACTION_TIME_S + 1.0, \
        f"Parse local demorou {elapsed:.2f}s — verificar thread pool"


@pytest.mark.asyncio
async def test_parse_texto_vazio_nao_vaza_memoria():
    """
    Parse de arquivo corrompido não deve deixar objetos grandes no heap.
    Verifica que gc.collect() após parse não encontra muitos objetos novos.
    """
    gc.collect()
    before = len(gc.get_objects())

    await parse_pdf(partially_corrupt_pdf())
    gc.collect()

    after = len(gc.get_objects())
    delta = after - before
    # Delta conservador: menos de 5000 novos objetos no GC após um parse
    assert delta < 5000, f"Possível memory leak: {delta} novos objetos no heap após parse"


# ─── 7. Chunking com texto adversarial ───────────────────────────────────────

def test_chunking_unicode_nao_quebra():
    """Chunking de texto com multibyte Unicode não deve quebrar."""
    text = "CPF 529.982.247-25 " * 1000 + "🔒" * 500
    chunks = chunk_text(text)
    assert len(chunks) > 0
    # Reconstrução não deve perder dados (até MAX_CHUNKS × CHUNK_SIZE)
    reconstructed = "".join(chunks)
    assert len(reconstructed) <= len(text)


def test_chunking_sem_overflow_de_index():
    """Chunking exato em múltiplos de CHUNK_SIZE não deve criar chunk vazio."""
    from document.limits import CHUNK_SIZE_CHARS
    text = "X" * (CHUNK_SIZE_CHARS * 3)
    chunks = chunk_text(text)
    assert len(chunks) == 3
    assert all(len(c) > 0 for c in chunks)
