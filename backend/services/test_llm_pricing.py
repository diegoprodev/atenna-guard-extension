"""
FASE 10.9.6 — preço de LLM centralizado numa fonte única (antes: 3 cópias
divergentes de PROVIDER_COST em costs.py/overview.py/usage.py, todas com
uma taxa única "cega" pra input+output ~10-20x acima do preço real do
gpt-4.1-nano).
"""
from services.llm_pricing import cost_usd, MODEL_PRICING_PER_1M


def test_openai_and_gemini_have_realistic_current_pricing():
    # gpt-4.1-nano e gemini-2.5-flash-lite são os modelos reais em uso
    # (ver services/prompt_service.py) — preço na faixa de centavos por
    # milhão de tokens, não dólares (o bug antigo tinha US$2/1M).
    for provider in ("openai", "google-ai-studio"):
        pricing = MODEL_PRICING_PER_1M[provider]
        assert 0 < pricing["input"] < 1.0
        assert 0 < pricing["output"] < 2.0
        # Output custa mais que input (padrão de todo provider de LLM)
        assert pricing["output"] >= pricing["input"]


def test_cost_usd_matches_input_output_split():
    # 1M tokens de input + 1M de output = input_rate + output_rate exatos
    cost = cost_usd("openai", 1_000_000, 1_000_000)
    expected = MODEL_PRICING_PER_1M["openai"]["input"] + MODEL_PRICING_PER_1M["openai"]["output"]
    assert abs(cost - expected) < 1e-9


def test_cost_usd_zero_tokens_is_zero():
    assert cost_usd("openai", 0, 0) == 0.0


def test_unknown_provider_never_shows_zero_cost():
    # Provider desconhecido/novo tem que superestimar, nunca esconder custo
    # mostrando US$0 (isso já aconteceu antes: PROVIDER_COST.get(p, 0.001)
    # tratava qualquer provider não catalogado como quase de graça).
    cost = cost_usd("algum-provider-novo-nao-catalogado", 1_000_000, 0)
    assert cost >= 1.0  # taxa alta de propósito (ver _DEFAULT_PRICING)
