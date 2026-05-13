"""
FASE 4.2C — Document Pipeline Observability
Métricas em memória para parse duration, RAM, rejection rate, concorrência.

Thread-safe. Zero dependências externas. Exportável via /document/metrics.
Sem persistência — reset no restart do container. Agregações in-process.

Métricas coletadas:
- parse_duration_ms: histogram para p50/p95/p99
- memory_delta_mb: delta de RAM antes/depois de cada parse
- rejection_rate: contagem por error_code
- timeout_count: parses que excederam o tempo limite
- concurrent_peak: pico de parses simultâneos
- cleanup_latency_ms: tempo entre parse e del do buffer
- extraction_chars: distribuição de chars extraídos
- upload_type: PDF vs DOCX
- orphan_buffer_warnings: buffers detectados sem cleanup
"""
from __future__ import annotations

import gc
import os
import threading
import time
from collections import defaultdict
from dataclasses import dataclass, field
from typing import Generator
from contextlib import contextmanager


# ── Histogram simples (percentil via sorted list) ─────────────────────────────

class _Histogram:
    """Thread-safe histogram com janela rolling de 1000 samples."""
    _WINDOW = 1000

    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._samples: list[float] = []

    def record(self, value: float) -> None:
        with self._lock:
            self._samples.append(value)
            if len(self._samples) > self._WINDOW:
                self._samples.pop(0)

    def percentile(self, p: float) -> float:
        with self._lock:
            if not self._samples:
                return 0.0
            sorted_s = sorted(self._samples)
            idx = max(0, int(len(sorted_s) * p / 100) - 1)
            return round(sorted_s[idx], 2)

    def mean(self) -> float:
        with self._lock:
            if not self._samples:
                return 0.0
            return round(sum(self._samples) / len(self._samples), 2)

    def count(self) -> int:
        with self._lock:
            return len(self._samples)


# ── Métricas globais ──────────────────────────────────────────────────────────

_lock = threading.Lock()

_parse_duration    = _Histogram()
_memory_delta      = _Histogram()
_extraction_chars  = _Histogram()
_cleanup_latency   = _Histogram()

_rejection_counts: dict[str, int]    = defaultdict(int)
_upload_type_counts: dict[str, int]  = defaultdict(int)
_timeout_count:   int = 0
_concurrent_peak: int = 0
_concurrent_now:  int = 0
_orphan_warnings: int = 0
_total_parses:    int = 0
_error_count:     int = 0


def _get_rss_mb() -> float:
    """Retorna RSS atual do processo em MB. Fallback 0 se psutil ausente."""
    try:
        import psutil  # type: ignore
        return psutil.Process(os.getpid()).memory_info().rss / (1024 * 1024)
    except Exception:
        return 0.0


# ── Context managers para instrumentação ─────────────────────────────────────

@contextmanager
def parse_context(filetype: str) -> Generator[None, None, None]:
    """
    Instrumenta um parse completo: duração, RAM delta, concorrência.

    Uso:
        async with parse_context("pdf"):
            result = await parse_pdf(bytes)
    """
    global _concurrent_now, _concurrent_peak, _total_parses

    with _lock:
        _concurrent_now += 1
        if _concurrent_now > _concurrent_peak:
            _concurrent_peak = _concurrent_now
        _total_parses += 1
        _upload_type_counts[filetype] += 1

    ram_before = _get_rss_mb()
    t0 = time.perf_counter()

    try:
        yield
    finally:
        elapsed_ms = (time.perf_counter() - t0) * 1000
        ram_after = _get_rss_mb()
        delta_mb = max(0.0, ram_after - ram_before)

        _parse_duration.record(elapsed_ms)
        _memory_delta.record(delta_mb)

        with _lock:
            _concurrent_now = max(0, _concurrent_now - 1)


@contextmanager
def cleanup_context() -> Generator[None, None, None]:
    """Mede latência entre fim do parse e cleanup dos buffers."""
    t0 = time.perf_counter()
    try:
        yield
    finally:
        elapsed_ms = (time.perf_counter() - t0) * 1000
        _cleanup_latency.record(elapsed_ms)


def record_rejection(error_code: str) -> None:
    global _error_count
    with _lock:
        _rejection_counts[error_code] += 1
        _error_count += 1


def record_timeout() -> None:
    global _timeout_count
    with _lock:
        _timeout_count += 1


def record_extraction(chars: int) -> None:
    _extraction_chars.record(float(chars))


def warn_orphan_buffer() -> None:
    global _orphan_warnings
    with _lock:
        _orphan_warnings += 1


# ── Snapshot exportável ───────────────────────────────────────────────────────

def snapshot() -> dict:
    """
    Retorna snapshot thread-safe de todas as métricas.
    Chamado pelo endpoint /document/metrics.
    """
    with _lock:
        rejections = dict(_rejection_counts)
        upload_types = dict(_upload_type_counts)
        total = _total_parses
        timeouts = _timeout_count
        peak = _concurrent_peak
        now = _concurrent_now
        orphans = _orphan_warnings
        errors = _error_count

    return {
        "total_parses": total,
        "error_count": errors,
        "timeout_count": timeouts,
        "concurrent_now": now,
        "concurrent_peak": peak,
        "orphan_buffer_warnings": orphans,
        "rejection_by_code": rejections,
        "upload_type_distribution": upload_types,
        "parse_duration_ms": {
            "p50":   _parse_duration.percentile(50),
            "p95":   _parse_duration.percentile(95),
            "p99":   _parse_duration.percentile(99),
            "mean":  _parse_duration.mean(),
            "count": _parse_duration.count(),
        },
        "memory_delta_mb": {
            "p50":   _memory_delta.percentile(50),
            "p95":   _memory_delta.percentile(95),
            "p99":   _memory_delta.percentile(99),
            "mean":  _memory_delta.mean(),
        },
        "extraction_chars": {
            "p50":   _extraction_chars.percentile(50),
            "p95":   _extraction_chars.percentile(95),
            "p99":   _extraction_chars.percentile(99),
            "mean":  _extraction_chars.mean(),
        },
        "cleanup_latency_ms": {
            "p50":   _cleanup_latency.percentile(50),
            "p95":   _cleanup_latency.percentile(95),
            "mean":  _cleanup_latency.mean(),
        },
    }


def reset() -> None:
    """Reset completo — usado em testes."""
    global _timeout_count, _concurrent_peak, _concurrent_now
    global _orphan_warnings, _total_parses, _error_count

    with _lock:
        _rejection_counts.clear()
        _upload_type_counts.clear()
        _timeout_count = 0
        _concurrent_peak = 0
        _concurrent_now = 0
        _orphan_warnings = 0
        _total_parses = 0
        _error_count = 0

    # Criar novos histograms — não há método clear
    global _parse_duration, _memory_delta, _extraction_chars, _cleanup_latency
    _parse_duration   = _Histogram()
    _memory_delta     = _Histogram()
    _extraction_chars = _Histogram()
    _cleanup_latency  = _Histogram()
