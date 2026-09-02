# Triagem do relatório GitGuard — 2026-09-02

Scan `cmtjnvm6j00f4f1xo6lyjyani` · commit `0f0b7d33` · 52 findings (35 HIGH · 16 MEDIUM · 1 LOW).

**Contexto que o scanner não tem:** este é um **produto de DLP**. O código-fonte contém,
por design, dezenas de regexes e fixtures com formato de credencial (`sk-…`, `AKIA…`, `eyJ…`,
`sk_live_…`) — é *o que o produto detecta*, não segredo. Isso explica a maioria dos HIGH.

---

## 1. REAL — precisa ação

| # | Finding | Local | Ação | Status |
|---|---|---|---|---|
| R-1 | 🔴 **Chave GCP/Gemini real commitada** (`gcp-api-key`) | `docs/VPS_ACCESS_GUIDE.md` | **Rotacionar no Google Cloud** (dono) + purgar do histórico git | ⏳ dono precisa rotacionar |
| R-2 | Dockerfile sem `USER` (roda como root) — `missing-user` | `backend/Dockerfile` | Adicionado `USER atenna` (uid 10001) | ✅ corrigido |
| R-3 | `xml.etree` sem defesa contra XML bomb/XXE — `use-defused-xml` (2×) | `backend/document/parsers/docx_parser.py` | Trocado para `defusedxml.ElementTree` | ✅ corrigido |
| R-4 | `react-router-dom` 6.30.3 — 4 CVEs (open-redirect + XSS) | `admin/package.json` | Constraint → `^6.30.3`; migração p/ v7 = follow-up (painel interno, token-gated, `noindex` → risco prático baixo) | 🟡 parcial |
| R-5 | `md5` sem `usedforsecurity=False` (2×) | `backend/dlp/engine.py:250` | Uso não-cripto (dedup key truncada); adicionado `usedforsecurity=False` | ✅ corrigido |
| R-6 | nginx usa `$host` (host-header injection no 301 + no `proxy_set_header`) | `backend/nginx/default.conf` | `$host` → `api.atennaia.com.br` fixo | ✅ corrigido |
| R-7 | `CF_ACCOUNT_ID` com default hardcoded (3×) — `generic-api-key` | `backend/routes/admin/{costs,overview,usage}.py` | É um ID público (não credencial), mas removido o fallback: `os.getenv('CF_ACCOUNT_ID', '')` | ✅ corrigido |
| R-8 | `Math.random()` para IDs (4×) — `insecure_random_generator` | `analytics.ts`, `history.ts`, `upload-flow.ts` | IDs não-sensíveis (sessão de analytics, id de histórico, sufixo de arquivo) — mas trocado para `crypto.randomUUID()` | ✅ corrigido |

## 2. FALSO POSITIVO — o produto é um DLP

| Finding | Qtd | Por quê é falso positivo |
|---|---|---|
| `stripe-access-token` | 7 | Regexes `sk_live_` / `sk_test_` em `src/dlp/patterns.ts`, `backend/dlp/analyzer.py`, `scanner.py` — **o produto detecta essas chaves**. Não há integração Stripe no repo (ainda). |
| `jwt` / `detected-jwt-token` | 2 | JWTs fake em fixtures de teste (`test_telemetry_persistence.py`, specs e2e). |
| `node_password` (njsscan) | 17 | Variáveis `password` em formulários de login (`const password = input.value`) — leitura de input do usuário, não segredo hardcoded. Verificado: **zero** string de senha literal em `src/`/`admin/`. |
| `node_username` (njsscan) | 3 | Idem — campos `username`/`email` de formulário. |
| `curl-auth-header` | 6 | `curl -H "Authorization: Bearer $JWT"` em docs — placeholders/variáveis, sem token real. Docs serão arquivados na limpeza (P1.4). |
| `generic-api-key` (semgrep) | 1-2 | CF Account ID (público) — tratado em R-7. |
| `path-join-resolve-traversal` | 1 | `resolve('dist/manifest.json')` em `scripts/*.mjs` — path fixo, build-time, sem input do usuário. |
| `unsafe-formatstring` | 1 | f-string montando URL a partir de arg de CLI em `scripts/profile_vps_document.py` — **arquivo removido**. |

**Supressão:** adicionados `.gitleaks.toml` (allowlist dos paths de DLP + fixtures + docs) e
`.semgrepignore`. Scratch scripts removidos (`profile_vps_document.py`, `checkout_tmp.py`,
`PRESIDIO_ENGINE_COMPLETE.py`, `doc_parser_*.py`).

## 3. Já corrigido antes deste relatório (sessão de 2026-09-01/02)

- JWT bruto gravado em `chrome.storage` (listener morto de magic-link) — removido
- Domínio morto `maestro-n8n.site` (produção fora do ar) — migrado p/ `api.atennaia.com.br`
- `.claude/settings.json` versionado (podia ter logs com segredo) — `git rm --cached`
- DLP server-side quebrado — restaurado (FASE 9.0)

---

## Resumo executivo

| | |
|---|---|
| Findings reais que exigiam código | **7** — todos corrigidos, exceto o upgrade v7 do react-router (follow-up) |
| Ação do dono (não-código) | **1** — rotacionar a chave Gemini no Google Cloud Console |
| Falsos positivos | **~43** — inerentes a um produto de DLP; suprimidos via `.gitleaks.toml` / `.semgrepignore` |
| Purga de histórico git (chave Gemini) | pendente — operação à parte (reescreve histórico) |

## Nota de deploy — container não-root

Com `USER atenna` (uid 10001) no Dockerfile, o bind mount `./data:/app/data` precisa ser
`chown`-ado no host: `chown -R 10001:10001 /root/atenna-backend/data`. Feito na VPS em 2026-09-02.
Deploy reproduzível (P3) deve incluir isso no entrypoint ou no runbook.
