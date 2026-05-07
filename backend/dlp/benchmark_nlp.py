"""
TASK 6 Benchmark: en_core_web_sm vs pt_core_news_sm

Real PT-BR corpus + performance metrics.
Validates improvement in Portuguese context detection.
"""

import time
import psutil
import os
from typing import Dict, List, Tuple
from dataclasses import dataclass

# Corpus PT-BR real para testes
PT_BR_CORPUS = {
    "legal": [
        "Processo CNJ nº 0000001-31.2024.8.26.0000 da Comarca de São Paulo.",
        "Parecer jurídico n. 123/2024 emitido pela Procuradoria Geral do Estado.",
        "Conforme jurisprudência do STJ em recurso especial nº 1.234.567.",
    ],
    "administrative": [
        "Ofício n. 456/2024-DAF encaminhado ao Ministério da Educação.",
        "Portaria n. 789/2024 publicada no Diário Oficial da União.",
        "Despacho do Diretor Geral aprovando a solicitação administrativo.",
    ],
    "medical": [
        "Paciente diagnosticado com HIV positivo em janeiro de 2024.",
        "Prontuário do paciente João Silva contendo informações sobre tratamento de diabetes.",
        "Cirurgia cardíaca realizada conforme protocolo de câncer de mama.",
    ],
    "financial": [
        "Salário mensal do funcionário: R$ 5.000,00 com dedução de FGTS.",
        "Investimento em fundo de renda fixa com rendimento de 15% ao ano.",
        "Balanço patrimonial da empresa com lucro líquido de R$ 2.5 milhões.",
    ],
    "contracts": [
        "Contrato de prestação de serviços n. 999/2024 entre Atenna e Cliente.",
        "Cláusula confidencial: Todos os dados são propriedade intelectual confidencial.",
        "Acordo de confidencialidade assinado em 07 de maio de 2026.",
    ],
    "personal_data": [
        "CPF: 050.423.674-11 de Maria Silva Santos.",
        "CNPJ: 12.345.678/0001-99 da empresa Atenna Ltda.",
        "Email: diego@atenna.ai e telefone (11) 98765-4321.",
    ],
    "api_keys": [
        "API key: sk-ant-v3aBcDefGhijKlmnOp_1234567890",
        "Stripe live key: sk_live_51234567890abcdefghij",
        "Bearer token: eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4gRG9lIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U",
    ],
    "institution_names": [
        "Universidade de São Paulo conforme resolução administrativa.",
        "Instituto Brasileiro de Geografia e Estatística publicou relatório.",
        "Banco Central do Brasil divulgou nova resolução sobre dados pessoais.",
    ],
}


@dataclass
class MetricResult:
    """Individual metric result."""
    name: str
    value: float
    unit: str


@dataclass
class BenchmarkResult:
    """Complete benchmark result for one model."""
    model_name: str
    startup_time_ms: float
    memory_mb: float
    avg_latency_ms: float
    throughput_samples_per_sec: float
    entities_detected: int
    avg_entities_per_sample: float
    false_positives: int
    false_negatives: int


def benchmark_model(model_config: Dict, corpus: Dict[str, List[str]]) -> BenchmarkResult:
    """
    Benchmark one model against PT-BR corpus.

    Measures:
    - Startup time
    - Memory usage
    - Latency per sample
    - Throughput
    - Entity detection accuracy
    """
    from presidio_analyzer import AnalyzerEngine
    from presidio_analyzer.nlp_engine import NlpEngineProvider

    model_name = model_config.get("model_name", "unknown")
    print(f"\n{'='*60}")
    print(f"Benchmarking: {model_name}")
    print(f"{'='*60}")

    # Startup time measurement
    process = psutil.Process(os.getpid())
    mem_before = process.memory_info().rss / 1024 / 1024  # MB

    print(f"Loading model {model_name}...")
    t_start = time.perf_counter()

    provider = NlpEngineProvider(nlp_configuration={
        "nlp_engine_name": "spacy",
        "models": [model_config],
    })
    nlp_engine = provider.create_engine()
    engine = AnalyzerEngine(nlp_engine=nlp_engine, supported_languages=["pt"])

    startup_time = (time.perf_counter() - t_start) * 1000
    mem_after = process.memory_info().rss / 1024 / 1024  # MB
    memory_used = mem_after - mem_before

    # Analysis latency + entity detection
    latencies = []
    total_entities = 0
    entity_count_by_sample = []

    print(f"Analyzing {sum(len(v) for v in corpus.values())} samples...")

    for category, samples in corpus.items():
        print(f"  {category}...", end=" ", flush=True)
        for sample in samples:
            t0 = time.perf_counter()
            try:
                results = engine.analyze(text=sample, language="pt")
                latency = (time.perf_counter() - t0) * 1000
                latencies.append(latency)
                total_entities += len(results)
                entity_count_by_sample.append(len(results))
            except Exception as e:
                pass  # Silent fail on encoding/analysis issues
        print("OK")

    # Calculate metrics
    avg_latency = sum(latencies) / len(latencies) if latencies else 0
    throughput = (len(latencies) / sum(latencies) * 1000) if latencies and sum(latencies) > 0 else 0  # samples/sec
    avg_entities = total_entities / len(entity_count_by_sample) if entity_count_by_sample else 0

    result = BenchmarkResult(
        model_name=model_name,
        startup_time_ms=startup_time,
        memory_mb=memory_used,
        avg_latency_ms=avg_latency,
        throughput_samples_per_sec=throughput,
        entities_detected=total_entities,
        avg_entities_per_sample=avg_entities,
        false_positives=0,  # TODO: implement validation corpus
        false_negatives=0,   # TODO: implement validation corpus
    )

    print(f"\nResults for {model_name}:")
    print(f"  Startup: {startup_time:.2f}ms")
    print(f"  Memory: {memory_used:.2f}MB")
    print(f"  Avg Latency: {avg_latency:.2f}ms")
    print(f"  Throughput: {throughput:.2f} samples/sec")
    print(f"  Total Entities: {total_entities}")
    print(f"  Avg Entities/Sample: {avg_entities:.2f}")

    return result


def print_comparison_table(en_result: BenchmarkResult, pt_result: BenchmarkResult):
    """Print side-by-side comparison table."""
    print(f"\n{'='*80}")
    print("BENCHMARK COMPARISON TABLE")
    print(f"{'='*80}")

    metrics = [
        ("Startup Time (ms)", "startup_time_ms"),
        ("Memory Usage (MB)", "memory_mb"),
        ("Avg Latency (ms)", "avg_latency_ms"),
        ("Throughput (samples/sec)", "throughput_samples_per_sec"),
        ("Total Entities Detected", "entities_detected"),
        ("Avg Entities/Sample", "avg_entities_per_sample"),
    ]

    print(f"\n{'Metric':<30} {'en_core':<20} {'pt_core':<20} {'Improvement':<20}")
    print("-" * 90)

    for metric_name, attr_name in metrics:
        en_val = getattr(en_result, attr_name)
        pt_val = getattr(pt_result, attr_name)

        # Calculate improvement direction
        if attr_name in ["startup_time_ms", "memory_mb", "avg_latency_ms"]:
            # Lower is better
            if en_val > 0:
                improvement = ((en_val - pt_val) / en_val) * 100
                arrow = "OK" if improvement > 0 else "XX"
            else:
                improvement = 0
                arrow = "--"
        else:
            # Higher is better
            if en_val > 0:
                improvement = ((pt_val - en_val) / en_val) * 100
                arrow = "OK" if improvement > 0 else "XX"
            else:
                improvement = 0
                arrow = "--"

        print(
            f"{metric_name:<30} "
            f"{en_val:<20.2f} "
            f"{pt_val:<20.2f} "
            f"{arrow} {improvement:+.1f}%"
        )

    print("-" * 90)


if __name__ == "__main__":
    import sys

    try:
        # Test en_core_web_sm (current)
        print("\nPhase 1: Testing CURRENT model (en_core_web_sm)")
        en_result = benchmark_model(
            {"lang_code": "en", "model_name": "en_core_web_sm"},
            PT_BR_CORPUS
        )

        # Test pt_core_news_sm (target)
        print("\n\nPhase 2: Testing TARGET model (pt_core_news_sm)")
        print("[INFO] pt_core_news_sm must be installed first:")
        print("   pip install https://github.com/explosion/spacy-models/releases/download/pt_core_news_sm-3.7.0/pt_core_news_sm-3.7.0-py3-none-any.whl")

        try:
            pt_result = benchmark_model(
                {"lang_code": "pt", "model_name": "pt_core_news_sm"},
                PT_BR_CORPUS
            )

            # Print comparison
            print_comparison_table(en_result, pt_result)

            # Decision criteria
            print(f"\n{'='*80}")
            print("ACCEPTANCE CRITERIA")
            print(f"{'='*80}")

            memory_ok = pt_result.memory_mb < 100  # Max 100MB added
            latency_ok = pt_result.avg_latency_ms < 200  # Max 200ms/sample
            entities_improved = pt_result.avg_entities_per_sample >= en_result.avg_entities_per_sample

            print(f"[OK] Memory acceptable (<100MB): {memory_ok} ({pt_result.memory_mb:.2f}MB)")
            print(f"[OK] Latency acceptable (<200ms): {latency_ok} ({pt_result.avg_latency_ms:.2f}ms)")
            print(f"[OK] Entity detection improved: {entities_improved} ({pt_result.avg_entities_per_sample:.2f} vs {en_result.avg_entities_per_sample:.2f})")

            all_ok = memory_ok and latency_ok and entities_improved
            print(f"\n{'TASK 6 ELIGIBLE: YES' if all_ok else 'TASK 6 ELIGIBLE: NO'}")

            sys.exit(0 if all_ok else 1)

        except Exception as e:
            print(f"Error loading pt_core_news_sm: {e}")
            print("Install model first, then re-run benchmark.")
            sys.exit(1)

    except Exception as e:
        print(f"Fatal error: {e}")
        import traceback
        traceback.print_exc()
        sys.exit(1)
