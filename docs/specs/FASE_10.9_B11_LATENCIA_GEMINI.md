# FASE 10.9 (B11) — "demora a mais" no Gemini pra refinar prompts

**Status:** causa raiz explicada; instrumentação durável adicionada; medição real
pendente (precisa de tráfego pós-deploy).

## O que o dono relatou
"Percebo uma certa demora a mais que antes na API do Gemini para refinar os prompts."

## Causa raiz (achada lendo `services/prompt_service.py`)

**Gemini nunca é o caminho principal.** A orquestração é:

```
1. OpenAI gpt-4.1-nano  (primário)   — ~4,7s (comentário original do código)
2. Gemini 2.5 Flash Lite (fallback)  — ~8s   (quase o dobro)
```

Gemini só entra quando o **OpenAI falha ou lança exceção**. Se o dono está vendo respostas
mais lentas "do Gemini", isso quer dizer que o **OpenAI errou** naquela chamada — a
"demora" não é o Gemini ficar mais lento, é estar caindo no fallback mais devagar com
mais frequência.

## Por que não dá pra confirmar com número real (ainda)

- O contador de provider (`observability_metrics.record_generation`) é um `Counter` do
  Prometheus **só em memória** — zera a cada restart/deploy do container. Só hoje o
  backend foi reiniciado ~10 vezes (uma por PR mergeado). Não sobrou histórico.
- `/metrics` é bloqueado no nginx público (correto, é interno) — só dá pra ler de dentro
  da VPS, e mesmo assim o contador está zerado.
- Não havia medição de **duração** nenhuma antes desta fase — só sucesso/erro.

## Fix — instrumentação durável (esta fase)

`generate_prompts()` agora sempre marca:
- `_provider`: `"openai"` | `"gemini"` | `"none"`
- `_provider_ms`: tempo da chamada que efetivamente respondeu
- `_total_ms` (só no caminho de fallback): inclui o tempo perdido tentando o OpenAI antes

`/generate-prompts` grava isso no `audit_log` → **`dlp_events`** (tabela persistente,
sobrevive a deploy): `duration_ms` (coluna) + `metadata.provider`/`metadata.provider_ms`.

## Como tirar o número real dentro de alguns dias

```sql
select metadata->>'provider' as provider,
       percentile_cont(0.5) within group (order by duration_ms) as p50_ms,
       percentile_cont(0.95) within group (order by duration_ms) as p95_ms,
       count(*) as n
from dlp_events
where event_type = 'generate_prompt' and duration_ms > 0
group by 1;
```

Isso também responde "o OpenAI está falhando mais que antes?" — `count(*)` com
`provider='gemini'` alto = fallback disparando com frequência anormal.

## Testes
`backend/tests/test_provider_instrumentation.py` — `generate_prompts()` marca
`_provider`/`_provider_ms`/`_total_ms` nos 3 caminhos (openai ok, fallback pro gemini,
ambos falham); `audit_log` aceita `duration_ms`.

## Riscos
Zero — só adiciona campos/medição, nenhum comportamento de geração muda.
