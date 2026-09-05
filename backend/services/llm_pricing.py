"""
Preço real por 1M tokens dos modelos que prompt_service.py de fato usa —
FONTE ÚNICA de custo de LLM pro admin.

FASE 10.9.6 — achado: cada rota admin (costs.py, overview.py, usage.py)
tinha sua PRÓPRIA cópia de `PROVIDER_COST` com os MESMOS valores
desatualizados (uma taxa única "cega" pra input+output, 0.002/1k =
US$2/1M pra OpenAI — ~10-20x o preço real do gpt-4.1-nano, o modelo que
prompt_service.py de fato usa hoje). Correção precisava lembrar de mexer
em 3 lugares — e óbvio que iam divergir de novo na próxima atualização de
preço. Uma função, um lugar.

Atualizar aqui quando o provider trocar de modelo (ver
services/prompt_service.py / openai_service.py / gemini_service.py).
"""

MODEL_PRICING_PER_1M = {
    'openai':           {'input': 0.100, 'output': 0.400},  # gpt-4.1-nano
    'google-ai-studio': {'input': 0.100, 'output': 0.400},  # gemini-2.5-flash-lite
}

# Provider desconhecido/novo: taxa alta de propósito — nunca esconder custo
# subestimando um provider que ainda não catalogamos aqui.
_DEFAULT_PRICING = {'input': 1.000, 'output': 1.000}


def cost_usd(provider: str, tokens_in: int, tokens_out: int) -> float:
    """Custo em USD de uma chamada, dado o provider (chave do CF AI Gateway:
    'openai' ou 'google-ai-studio') e a contagem real de tokens de entrada/saída."""
    pricing = MODEL_PRICING_PER_1M.get(provider, _DEFAULT_PRICING)
    return (tokens_in / 1_000_000) * pricing['input'] + (tokens_out / 1_000_000) * pricing['output']
