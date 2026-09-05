# FASE 10.9.6 — Custo/latência de LLM: investigação + correção

**Status:** parcialmente implementado (esta sessão) · **Pedido original:** dono, 04/09/2026 —
"investigue com os plugin skills e monte uma spec de resolução"

## Problema

Pedido original, várias queixas juntas:
1. Modal demora **~3s só pra abrir** (antes de qualquer geração) — "só depois uns 8 pra gerar".
2. Geração de prompt chegou a **~15s** numa medição real do dono.
3. Comparar modelos/preços atuais de LLM (Gemini x OpenAI) "direito".
4. Investigar **cache** de prompt pra economizar.
5. Admin com **comparativo de custo por LLM/modelo, ao vivo, sempre visível**.
6. Verificar se as API keys (Gemini/OpenAI) estão configuradas certas e refletir isso no admin.
7. Admin "não funciona, não reflete dado real, acho que tá mockada" — CF AI Gateway retornando 404.
8. Conversão automática USD→BRL (manter/estender).
9. "Métrica validada e real é fundamental e primordial pra mim."

## Investigação — achado real por achado (não suposição)

| # | Suspeita do dono | O que achei de verdade | Evidência |
|---|---|---|---|
| 1 | Modal lento pra abrir | `openModal()` monta o overlay na hora (correto), mas fica **em branco** até `await bffMe()` resolver. `GET /auth/me` fazia **3 chamadas Supabase em SÉRIE** (`resolve_token` → `_get_plan` → `onboarding_seen`), cada uma bloqueante (supabase-py é síncrono, sem `await` real) — a 2ª e a 3ª não dependem uma da outra. | `backend/routes/bff_auth.py:255-281` (antes do fix) |
| 2 | Geração ~15s | `AsyncOpenAI(max_retries=2)` fazia o SDK reintentar sozinho (com backoff) ANTES de devolver erro — e `prompt_service.py` **já** cai pro Gemini (~8s) quando o OpenAI falha. Duas camadas de retry somando. | `backend/services/openai_service.py:91-97` (antes do fix) — já corrigido e deployado no PR #62 |
| 3 | Preço "atual" dos modelos | **3 cópias divergentes** da mesma tabela de preço (`costs.py`, `overview.py`, `usage.py`), todas com uma taxa única "cega" pra input+output, `openai: $0.002/1k` = **US$2/1M** — **~10-20x** o preço real do `gpt-4.1-nano` (o modelo que o sistema de fato usa, não o que tava cotado). Frontend (`admin/src/pages/Costs.tsx`) tinha uma **4ª cópia**, hardcoded, com `gpt-4o-mini` (modelo errado, nem é o usado) e o mesmo preço velho. | grep em `routes/admin/{costs,overview,usage}.py` + `admin/src/pages/Costs.tsx:104-114` |
| 4 | Cache de prompt | Investigado e **descartado**: o system prompt (OpenAI/Gemini) tem ~250-300 tokens — abaixo do mínimo de 1024 tokens que o cache automático da OpenAI exige pra sequer ativar. Não há ganho de cache possível no tamanho atual do prompt, independente de qualquer reordenação. Documentado aqui pra não reabrir a mesma investigação depois. | cálculo de tokens do `_SYSTEM_PROMPT_TEMPLATE` |
| 5 | Admin "mockado" | **Não é mock** — `routes/admin/costs.py`, `overview.py`, `usage.py` já chamam Cloudflare/Supabase de verdade, com fallback pra estimativa só quando a chamada real falha. `admin/src/pages/Costs.tsx` já tem os 2 estados (real vs. estimado) e até **já mostra o motivo exato** do 404 ("Token sem permissão" + instrução de correção). O que tava errado era o dado de fallback (preço stale), não a arquitetura. | leitura completa dos 3 arquivos backend + `Costs.tsx` |
| 6 | CF AI Gateway 404 | Causa raiz: `CF_ACCOUNT_ID` não estava setado no `.env` da VPS → URL da API Cloudflare com segmento de conta vazio → 404. **RESOLVIDO**: o Account ID (`e6d552f924497f01ac4a986ef8f8c342`) já estava hardcoded nas URLs do AI Gateway em `openai_service.py`/`gemini_service.py`/`costs.py` (`.../v1/<ACCOUNT_ID>/<GATEWAY_ID>/...`) — extraí dali, setei no `.env` da VPS, recriei o container. Testado ao vivo: `logs API = 200`, 20 logs reais, custo real por provider. O token **já tinha** a permissão certa — só faltava o ID. | `ssh atenna-vps` + curl direto |
| 7 | API keys configuradas certas? | `OPENAI_API_KEY`/`GEMINI_API_KEY` presentes no `.env` da VPS (confirmado nesta sessão anterior — Gemini validado com HTTP 200 real, direto e via CF Gateway). Não há verificação **visível no admin** hoje — proposto abaixo. | sessão anterior (429/observabilidade) |
| 8 | USD→BRL | **Já existe**: `backend/utils/fx_rate.py` (`get_usd_brl()`, frankfurter.app/ECB, fallback 5.06) — só `overview.py` tinha uma cópia própria duplicada em vez de usar o helper. Corrigido (ver Decisões). | `utils/fx_rate.py` |

## Decisões

| Tema | Decisão | Porquê |
|---|---|---|
| Latência do `/auth/me` | `resolve_token` (pré-requisito) roda primeiro; `_get_plan` + `_get_onboarding_seen` rodam em **paralelo** via `asyncio.to_thread` + `gather` (client Supabase é síncrono, não dá pra `await` direto) | corta ~1 round trip inteiro do tempo de abrir o modal, sem trocar de SDK |
| Retry do OpenAI | `max_retries=0` (já no PR #62) | elimina retry duplicado com o fallback pro Gemini |
| Preço de LLM | **Fonte única**: `backend/services/llm_pricing.py` (`MODEL_PRICING_PER_1M`, `cost_usd()`) — `costs.py`/`overview.py`/`usage.py` importam dali, ninguém mais tem cópia própria | preço desatualizado só precisa ser corrigido **1 vez**, nunca mais diverge |
| Preço real usado | `gpt-4.1-nano`: $0.10/1M input, $0.40/1M output · `gemini-2.5-flash-lite`: $0.10/1M input, $0.40/1M output (mesma faixa — ver comentário em `prompt_service.py`) | preço público atual dos modelos realmente chamados, não um genérico |
| Provider desconhecido | taxa alta de propósito (`_DEFAULT_PRICING = {input:1.0, output:1.0}`) em vez de barata | nunca esconder custo de um provider novo/não catalogado |
| USD→BRL duplicado | `overview.py` passa a usar `utils/fx_rate.get_usd_brl()` — removida a cópia local `_fetch_usd_brl` | 1 fonte, mesmo comportamento (frankfurter.app, fallback 5.06) |
| Cache de prompt | **Não implementar** — prompt curto demais pro cache automático ajudar. Reavaliar só se o system prompt crescer além de ~1000 tokens no futuro | evita esforço sem ganho real |
| CF_ACCOUNT_ID / token | **RESOLVIDO** — Account ID extraído das URLs do AI Gateway já no código; setado no `.env` da VPS; container recriado; dados reais confirmados ao vivo. Não precisou de nada do dono. | o ID não é segredo, aparece na própria URL do gateway |
| Usar o custo nativo da Cloudflare | **Follow-up** — os logs do CF AI Gateway agora trazem um campo `cost` calculado pela própria Cloudflare. `cost_usd()` do `llm_pricing.py` continua como fallback/sanity-check, mas dá pra preferir `l.get('cost')` quando presente (mais preciso, acompanha mudança de preço sozinho) | Cloudflare adicionou isso depois que o código foi escrito |
| Validação de API keys no admin | **Follow-up, não nesta spec** — checar `OPENAI_API_KEY`/`GEMINI_API_KEY` fazendo uma chamada mínima (`GET /v1/models` já existe em `overview.py` pro OpenAI; falta o mesmo pro Gemini) e mostrar status no admin | escopo maior, merece PR própria com teste de bypass (não vazar a key no payload) |

## Arquivos

```
backend/services/llm_pricing.py                    # novo — fonte única de preço
backend/services/test_llm_pricing.py                # novo
backend/routes/admin/costs.py                       # usa llm_pricing
backend/routes/admin/overview.py                    # usa llm_pricing + utils/fx_rate (remove duplicata)
backend/routes/admin/usage.py                       # usa llm_pricing
backend/routes/bff_auth.py                          # /auth/me: 2 lookups em paralelo
backend/tests/test_me_endpoint_parallel.py          # novo — prova o paralelismo
backend/tests/test_admin_cost_no_name_shadowing.py  # novo — guarda contra a colisão de nome achada durante o fix
admin/src/pages/Costs.tsx                           # corrige preço/modelo hardcoded na tabela de fallback
```

## Testes

1. `test_llm_pricing.py` (4) — preço realista, split input/output, provider desconhecido nunca fica de graça.
2. `test_admin_cost_no_name_shadowing.py` (1) — regressão do bug real que eu mesmo introduzi ao migrar
   pra `llm_pricing.cost_usd`: `overview.py` e `usage.py` tinham uma variável LOCAL também chamada
   `cost_usd`, que sombreava a função importada (`UnboundLocalError` em runtime, não pega em import).
   Confirmado que o teste falha reintroduzindo o bug de propósito, antes de commitar o fix.
3. `test_me_endpoint_parallel.py` (1) — com 200ms de delay artificial em cada lookup, o tempo total
   fica < 320ms (paralelo), não ~400ms (série). Confirmado que falha no código anterior (sequencial).
4. Regressão local: `pytest backend/` sem presidio/fpdf instalados → 184 passed, mesmos 6 failed + 24
   errors pré-existentes (dependência ausente, não relacionados a este diff).
5. `admin && npx tsc --noEmit` — limpo.

## Riscos / Bloqueios

- ~~**CF_ACCOUNT_ID ausente**~~ — RESOLVIDO (ver tabela de investigação #6). Dados reais do Cloudflare
  já aparecem em `/admin/costs`, `/admin/overview`, `/admin/usage`.
- **Preço de modelo muda com o tempo** — `MODEL_PRICING_PER_1M` é hardcoded; se OpenAI/Google mudarem
  preço, precisa atualizar manualmente. Aceitável por ora (mudança rara, comentário no arquivo aponta
  onde atualizar); automatizar via API de preço fica de fora do escopo.
- **Validação de API key no admin** não entrou nesta spec (ver Decisões) — fica como follow-up.

## Rollout

1. ✅ `max_retries=0` (produção, PR #62).
2. ✅ `/auth/me` paralelizado + `llm_pricing.py` + fix do frontend (produção, PR #63).
3. ✅ `CF_ACCOUNT_ID` setado no `.env` da VPS + container recriado — dados reais do Cloudflare
   confirmados ao vivo (`/admin/costs` fora do modo estimado).
4. ⏳ Follow-up (PR separada): validação de API key visível no admin; preferir `l.get('cost')`
   nativo da Cloudflare sobre a estimativa quando presente.
