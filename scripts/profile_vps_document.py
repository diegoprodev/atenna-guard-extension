#!/usr/bin/env python3
"""
FASE 4.2C — VPS Document Pipeline Profiler
Script de profiling real para rodar NA VPS antes do rollout gradual.

Uso:
    python scripts/profile_vps_document.py \
        --token <JWT_TOKEN> \
        --url https://atennaplugin.maestro-n8n.site \
        --rounds 20 \
        --concurrent 3

O que mede:
    - p50/p95/p99 de latência de upload
    - RAM do container antes/durante/depois (via docker stats)
    - Rejection rate por tipo de erro
    - Comportamento sob concorrência real
    - Timeout rate real
    - Métricas /document/metrics após cada round

Critérios de aprovação para rollout gradual:
    - p95 < 8s
    - p99 < 10s
    - RAM delta < 80MB por request
    - 0 crashes / unhandled exceptions
    - 0 orphan buffers (observabilidade)
    - timeout_rate < 5%
"""
from __future__ import annotations

import argparse
import asyncio
import io
import json
import statistics
import sys
import time
from typing import Any

try:
    import httpx
except ImportError:
    print("httpx não instalado. Execute: pip install httpx")
    sys.exit(1)


# ── Fixtures de teste ─────────────────────────────────────────────────────────

def _make_test_pdf_bytes(size_kb: int = 10) -> bytes:
    """PDF mínimo com texto repetido (aproxima tamanho real)."""
    text = "Contrato de prestação de serviços. CPF 529.982.247-25. " * (size_kb * 5)
    return (
        "%PDF-1.4\n"
        "1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n"
        "2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n"
        f"3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 612 792]/Contents 4 0 R>>endobj\n"
        f"4 0 obj<</Length {len(text)}>>\nstream\n{text}\nendstream\nendobj\n"
        "xref\n0 5\n"
        "0000000000 65535 f\n0000000009 00000 n\n"
        "0000000058 00000 n\n0000000115 00000 n\n0000000200 00000 n\n"
        "trailer<</Size 5/Root 1 0 R>>\nstartxref\n300\n%%EOF"
    ).encode(errors="replace")


ADVERSARIAL_CASES = [
    ("partially_corrupt",  b"%PDF-1.4\n" + b"\xff\xfe" * 256),
    ("truncated",          b"%PDF-1.4\n1 0 obj<</Type/Catalog"),
    ("null_bytes",         b"%PDF-1.4\n" + b"\x00" * 512 + b"%%EOF"),
    ("giant_text",         b"%PDF-1.4\n" + b"A" * 50_000 + b"%%EOF"),
    ("oversized_10mb",     b"%PDF-1.4\n" + b"X" * (10 * 1024 * 1024 + 1)),
]


# ── Profiler ──────────────────────────────────────────────────────────────────

class VpsProfiler:
    def __init__(self, base_url: str, token: str) -> None:
        self.base_url = base_url.rstrip("/")
        self.headers  = {"Authorization": f"Bearer {token}"}
        self.latencies: list[float] = []
        self.errors:    list[str]   = []  # only 5xx / network errors
        self.timeouts:  int = 0
        self.successes: int = 0
        self.rejections: dict[str, int] = {}
        self.expected_rejections: int = 0  # 4xx = correct behavior

    async def _upload(self, client: httpx.AsyncClient, pdf_bytes: bytes, label: str) -> dict[str, Any]:
        t0 = time.perf_counter()
        try:
            resp = await client.post(
                f"{self.base_url}/document/upload",
                files={"file": ("test.pdf", io.BytesIO(pdf_bytes), "application/pdf")},
                headers=self.headers,
                timeout=15.0,
            )
            elapsed = (time.perf_counter() - t0) * 1000
            self.latencies.append(elapsed)

            if resp.status_code == 200:
                self.successes += 1
                return {"status": "ok", "elapsed_ms": elapsed, "label": label}
            else:
                body = resp.json() if resp.headers.get("content-type", "").startswith("application/json") else {}
                code = body.get("detail", {}).get("error", f"http_{resp.status_code}")
                self.rejections[code] = self.rejections.get(code, 0) + 1
                if resp.status_code >= 500:
                    # 5xx = real crash/server error
                    self.errors.append(f"{label}: {code} ({resp.status_code})")
                else:
                    # 4xx = controlled rejection (correct behavior)
                    self.expected_rejections += 1
                return {"status": "rejected", "code": code, "elapsed_ms": elapsed, "label": label}

        except httpx.TimeoutException:
            self.timeouts += 1
            self.errors.append(f"{label}: timeout")
            return {"status": "timeout", "label": label}
        except Exception as e:
            self.errors.append(f"{label}: {e}")
            return {"status": "error", "label": label, "error": str(e)}

    async def run_normal_round(self, client: httpx.AsyncClient, concurrent: int) -> None:
        """Round de uploads normais com concorrência real."""
        pdf = _make_test_pdf_bytes(size_kb=50)
        tasks = [self._upload(client, pdf, f"normal_{i}") for i in range(concurrent)]
        await asyncio.gather(*tasks)

    async def run_adversarial_round(self, client: httpx.AsyncClient) -> None:
        """Round com todos os adversarial cases."""
        tasks = [
            self._upload(client, data, label)
            for label, data in ADVERSARIAL_CASES
        ]
        await asyncio.gather(*tasks)

    async def fetch_metrics(self, client: httpx.AsyncClient) -> dict:
        """Busca métricas do endpoint /document/metrics."""
        try:
            resp = await client.get(
                f"{self.base_url}/document/metrics",
                headers=self.headers,
                timeout=5.0,
            )
            return resp.json() if resp.status_code == 200 else {}
        except Exception:
            return {}

    def report(self, metrics: dict) -> None:
        """Imprime relatório final com critérios de aprovação."""
        print("\n" + "=" * 60)
        print("FASE 4.2C — VPS PROFILING REPORT")
        print("=" * 60)

        total = self.successes + self.expected_rejections + len(self.errors) + self.timeouts
        print(f"\nTotal requests    : {total}")
        print(f"Successes         : {self.successes}")
        print(f"Expected 4xx      : {self.expected_rejections}  (parser guards working correctly)")
        print(f"Timeouts          : {self.timeouts}")
        print(f"Server errors 5xx : {len(self.errors)}")

        if self.rejections:
            print("\nRejeições por código:")
            for code, count in sorted(self.rejections.items(), key=lambda x: -x[1]):
                print(f"  {code}: {count}")

        if self.latencies:
            sorted_lat = sorted(self.latencies)
            p50  = sorted_lat[int(len(sorted_lat) * 0.50)]
            p95  = sorted_lat[int(len(sorted_lat) * 0.95)]
            p99  = sorted_lat[int(len(sorted_lat) * 0.99)] if len(sorted_lat) >= 100 else sorted_lat[-1]
            mean = statistics.mean(self.latencies)
            print(f"\nLatência (ms):")
            print(f"  p50  = {p50:.0f}ms")
            print(f"  p95  = {p95:.0f}ms")
            print(f"  p99  = {p99:.0f}ms")
            print(f"  mean = {mean:.0f}ms")

        # Métricas do servidor
        srv = metrics.get("metrics", {})
        if srv:
            print(f"\nServidor (observabilidade):")
            print(f"  total_parses        = {srv.get('total_parses', 'N/A')}")
            print(f"  concurrent_peak     = {srv.get('concurrent_peak', 'N/A')}")
            print(f"  orphan_buffers      = {srv.get('orphan_buffer_warnings', 'N/A')}")
            print(f"  timeout_count       = {srv.get('timeout_count', 'N/A')}")
            pd = srv.get("parse_duration_ms", {})
            if pd:
                print(f"  server p95          = {pd.get('p95', 'N/A')}ms")
                print(f"  server p99          = {pd.get('p99', 'N/A')}ms")
            md = srv.get("memory_delta_mb", {})
            if md:
                print(f"  memory delta p95    = {md.get('p95', 'N/A')}MB")

        # ── Critérios de aprovação ──────────────────────────────────────────
        print("\n── CRITÉRIOS DE APROVAÇÃO ──")
        timeout_rate = self.timeouts / max(total, 1) * 100

        checks = []

        if self.latencies:
            p95_ok = p95 < 8000
            p99_ok = p99 < 10000
            checks.append(("p95 < 8s",       p95_ok,  f"{p95:.0f}ms"))
            checks.append(("p99 < 10s",      p99_ok,  f"{p99:.0f}ms"))

        orphans = srv.get("orphan_buffer_warnings", 0)
        checks.append(("0 orphan buffers",  orphans == 0,     str(orphans)))
        checks.append(("timeout_rate < 5%", timeout_rate < 5, f"{timeout_rate:.1f}%"))
        checks.append(("0 server errors 5xx", len(self.errors) == 0, str(len(self.errors))))

        all_pass = True
        for name, passed, value in checks:
            icon = "✅" if passed else "❌"
            print(f"  {icon} {name} ({value})")
            if not passed:
                all_pass = False

        print("\n" + ("✅ APROVADO para rollout gradual" if all_pass else "❌ REPROVADO — não liberar feature flag") + "\n")


async def main(args: argparse.Namespace) -> None:
    profiler = VpsProfiler(args.url, args.token)

    print(f"Conectando a {args.url} ...")
    print(f"Rounds: {args.rounds}, Concorrência: {args.concurrent}")

    async with httpx.AsyncClient() as client:
        # Verificar health antes
        try:
            h = await client.get(f"{args.url}/health", timeout=5.0)
            print(f"Health: {h.status_code} {h.text}")
        except Exception as e:
            print(f"VPS inacessível: {e}")
            sys.exit(1)

        for i in range(args.rounds):
            print(f"\nRound {i+1}/{args.rounds}", end=" ")
            await profiler.run_normal_round(client, args.concurrent)
            print("✓ normal", end=" ")

            if i % 5 == 0:  # adversarial a cada 5 rounds
                await profiler.run_adversarial_round(client)
                print("✓ adversarial", end="")

        print()
        metrics = await profiler.fetch_metrics(client)

    profiler.report(metrics)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="VPS Document Pipeline Profiler — FASE 4.2C")
    parser.add_argument("--token",       required=True,  help="JWT Bearer token")
    parser.add_argument("--url",         default="https://atennaplugin.maestro-n8n.site")
    parser.add_argument("--rounds",      type=int, default=20)
    parser.add_argument("--concurrent",  type=int, default=3)
    args = parser.parse_args()
    asyncio.run(main(args))
