# FASE 10.9.2 — bugs e features do badge (lote do dono)

**Origem:** uso real. 4 itens: B7, B8, B9, B10.

| # | Item | Entrega |
|---|------|---------|
| B7 | canetinha regerava o mesmo prompt calada | ✅ nesta fase (parte 1) |
| B8 | alerta "você já gerou com o mesmo conteúdo" (Sim/Não), detecta igual mesmo pós-DLP | ✅ nesta fase (parte 1) |
| B9 | botão "Reverter proteção" no badge após DLP aplicado | ⏳ parte 2 |
| B10 | preferência "sempre gerar [direto/estruturado/estratégico]" | ⏳ parte 2 |

---

## Parte 1 — B7 + B8 (mesma raiz: detectar "mesmo conteúdo")

### Problema
- **B7:** a canetinha sempre chamava `openModal(true)` → gerava de novo. Se `promptCache`
  (memória) batia o texto exato, mostrava o cache — mas mesmo assim sem avisar, e qualquer
  diferença mínima (espaço, DLP aplicado) = regeração do zero, gastando cota.
- **B8:** o dono quer que, **depois da 1ª geração**, todo clique na canetinha com conteúdo na
  caixa **pergunte** antes: _"`<nome>`, você já gerou um prompt com o mesmo conteúdo. Deseja
  gerar novamente?"_ — e que "mesmo conteúdo" seja reconhecido **mesmo depois do DLP reescrever
  a caixa** (`meu CPF 123...` vs `meu CPF [CPF]`).

### Decisão
- Novo `src/core/lastGeneration.ts`:
  - `normalizeForCompare(text)` — tira tokens de DLP (`[CPF]`, `[NOME]`, …), sequências longas
    de dígitos, caixa, pontuação de borda, espaços repetidos. Assim pré-DLP e pós-DLP
    normalizam **igual**.
  - `signatureOf(text)` — hash djb2 curto da forma normalizada (`''` se < 3 chars úteis).
  - `getLastGenSignature()` / `setLastGenSignature()` — em `chrome.storage.local`, **escopado
    por `user_id`** (`sk('atenna_last_gen_sig')`), some no logout (`USER_SCOPED_BASES`).
  - `isSameAsLastGeneration(text)` — compara a assinatura de `text` com a última salva.
- `modal/core.ts`, caminho da canetinha (`autoGenerate && userText !== ''`):
  - se `isSameAsLastGeneration(userText)` → renderiza `renderDuplicateConfirm` **em vez de
    gerar**. Botões: **"Gerar de novo"** (força geração fresca, ignora cache) e **"Ver o
    anterior"** (mostra o `promptCache`, ou onboarding se não houver).
  - `setLastGenSignature(signatureOf(userText))` gravado **após** cada geração bem-sucedida.
- `renderDuplicateConfirm` reusa o visual do card de sugestão (`.atenna-modal__suggest*`) —
  sem CSS novo. Botão primário verde (Lei de Jakob), 2 opções só (Lei de Hick).

### Arquivos
- `src/core/lastGeneration.ts` (novo) + `src/core/lastGeneration.test.ts` (6 testes).
- `src/ui/modal/prompt-states.ts` — `renderDuplicateConfirm`.
- `src/ui/modal/core.ts` — check no caminho da canetinha + grava assinatura pós-geração.
- `src/core/auth.ts` — `atenna_last_gen_sig` em `USER_SCOPED_BASES`.
- `src/ui/modal.test.ts` — teste de cache renomeado pro novo comportamento.
- `tests/e2e/full-flow.spec.ts` — **F10**.

### Contrato
- 1ª canetinha com conteúdo → gera normal, salva assinatura.
- 2ª canetinha, conteúdo com a **mesma assinatura** (mesmo com DLP no meio) → **não gera** →
  mostra _"você já gerou um prompt com o mesmo conteúdo. Deseja gerar novamente?"_
- "Gerar de novo" → geração fresca (ignora cache). "Ver o anterior" → cache, 0 backend.
- Conteúdo diferente → gera direto, sem perguntar.

### Testes
- `lastGeneration.test.ts` — normalização, pré/pós-DLP igual, escopo por usuário, hash estável.
- `full-flow F10` — canetinha 2x com mesmo texto → alerta aparece, botão "Gerar de novo".
- `modal.test.ts` — reabrir com mesmo texto → alerta; "Ver o anterior" → 3 cards, 0 fetch.
- `vitest` 331 · `full-flow` 10/10 · build limpo.

### Riscos
- Só frontend. Reload da extensão.
- Falso "mesmo conteúdo": a normalização é agressiva (tira dígitos/tokens). Se dois textos
  diferentes só nos números normalizarem igual, o dono só perde 1 clique a mais ("Gerar de
  novo"). Trade-off aceito.

---

## Parte 2 — B9 + B10 (a fazer)
- **B9:** após o DLP reescrever a caixa, o badge mostra "Reverter proteção" por ~15s / até o
  próximo envio. Guarda o texto original **em memória** (nunca em storage).
- **B10:** Configurações → Personalização → seletor "sempre gerar [perguntar / direto /
  estruturado / estratégico]". Se != "perguntar", a canetinha pula a escolha de estilo.
