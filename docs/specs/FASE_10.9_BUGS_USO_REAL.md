# FASE 10.9 — Bugs encontrados no uso real (lote do dono)

**Status:** em execução
**Origem:** sessão de teste manual do dono (criar conta, reset de senha, login com senha errada,
DLP em texto técnico, exportar relatório/documento, badge após gerar prompt).

---

## Problema

O dono rodou o fluxo completo e encontrou um lote de defeitos. Alguns são de segurança/privacidade
(tratados fora desta fase — ver rodapé), o resto está aqui. Divididos por severidade e por "cabe
neste PR" vs "vira fase própria".

---

## Decisões

| # | Bug | Causa raiz | Decisão | Neste PR? |
|---|-----|-----------|---------|-----------|
| B1 | Login com senha errada mostra **"INVALID_CREDENTIALS"** em inglês | `bffLogin` lança `AppError` cujo `.message` é só o código; `popup.ts` renderiza `e.message` cru. `welcome.ts` já mapeava certo. | `errors.messageFor(err)` canônico; `popup.ts` (login, Google, reset) passa por ele. Padrão global: **"Email ou senha incorretos."** | ✅ |
| B2 | "Solicitar relatório" e "Solicitar exclusão" (LGPD) → **400 "User info incomplete"** | `require_auth` devolve dict com `user_id`; `export.py`/`deletion.py`/`documents.py`/`protect.py`/`retention.py`/`report_problem.py` leem `_user.get("id")`/`_user.get("sub")` → `None` → 400. | `require_auth` passa a expor `id` e `sub` como aliases de `user_id`. Correção num lugar só, conserta ~8 rotas. | ✅ |
| B3 | "Exportar documento após análise" → erro + 400 | Mesmo B2 (`documents.py:120,226` usam `_user.get("sub")`). | Coberto pelo alias de B2. | ✅ |
| B4 | DLP confunde **"cloud"** com nome; "Google Cloud Platform" vira `[NOME]` | Pattern `NAME` (Title Case, conf 0.62) casa qualquer sequência de 2–4 palavras capitalizadas; `validateName` só barra `NAME_STOPWORDS`. | Adiciona termos de cloud/infra/vendor + as palavras do exemplo à `NAME_STOPWORDS` (padrão anti-loop #8 do CLAUDE.md). | ✅ parcial |
| B5 | `[TELEFONE]`/`[ENDERECO]` injetados em texto benigno ("comece pelos fundamentos") | Pattern `PHONE` de conf 0.72 casa qualquer 8–10 dígitos; suspeita de o texto do exemplo ter números soltos. **Precisa do input exato** pra reproduzir. | Investigar com o prompt real. Endurecer o PHONE 0.72 (exigir separador/DDD) + teste de regressão. | ⏳ fase 10.9.1 |
| B6 | Rate limit de brute force no login | **Já existe:** `_check_login_rate_limit` = 5 tentativas/email/60s → 429 + `log_security_event("login_rate_limited")`. | Manter. Hardening (IP-based + store persistente compartilhado entre workers) é P4/P5 do plano macro. | ➖ já existe |
| B7 | Canetinha do badge re-abre o dialog e **regenera o mesmo prompt** após já ter gerado | `generateFromBadge()` sempre abre com `autoGenerate=true`. Não checa se já existe geração pro conteúdo atual. | Badge memoriza hash do último conteúdo gerado. Clique com conteúdo == último → abre modal **sem** auto-gerar, mostra o resultado anterior. | ⏳ fase 10.9.2 |
| B8 | Após 1ª geração, se a caixa da plataforma tem texto, **não** pergunta se quer regerar | Sem detecção de "mesmo conteúdo". | Alerta obrigatório: `"<nome>, você já gerou um prompt com o mesmo conteúdo. Deseja gerar novamente?"` (Sim/Não). Hash do conteúdo **após normalização** (trim, colapso de espaço) e **após DLP aplicado** (compara texto protegido também). | ⏳ fase 10.9.2 |
| B9 | Botão **"Reverter proteção"** no badge após aplicar DLP | Feature nova. | Após DLP reescrever a caixa, badge mostra "Reverter proteção" por ~15s / até o próximo envio. Guarda o texto original em memória (nunca em storage). | ⏳ fase 10.9.2 |
| B10 | Preferência **"sempre gerar [direto/estruturado/estratégico]"** | Feature nova. | Em Configurações → Personalização: seletor. Se setado, `generateFromBadge` pula a escolha e usa o estilo fixo. Default = perguntar (fricção proposital do free mantida). | ⏳ fase 10.9.2 |
| B11 | Gemini mais lento pra refinar | Percepção; sem métrica. | Medir p50/p95 do `/generate-prompts` (backend já loga latência). Comparar provider. Sem número real, não mexe. | ⏳ fase 10.9.1 (medição) |
| B12 | 46× `Unchecked runtime.lastError: Access to storage is not allowed from this context` | Algum caminho acessa `chrome.storage` de um contexto sem permissão (iframe/página sandbox da plataforma). Ruído, mas polui o console e viola "nenhum erro pro user". | Auditar chamadas `chrome.storage` fora do service worker / content script isolado. Provável no `observability` ou `sessionManager` rodando em subframe. | ⏳ fase 10.9.1 |

---

## Arquivos (deste PR)

- `backend/middleware/auth.py` — `require_auth` expõe `id` + `sub` (aliases de `user_id`).
- `src/core/errors.ts` — `messageFor(err)` canônico.
- `src/popup.ts` — login / Google / reset de senha renderizam `messageFor()`, nunca `err.message` cru.
- `src/dlp/patterns.ts` — `NAME_STOPWORDS` += cloud/infra/vendor + palavras do exemplo.
- `docs/specs/FASE_10.9_BUGS_USO_REAL.md` — este doc.
- `CHANGELOG.md`.

## Contrato

- `POST /user/export/request` com sessão BFF válida → **200** (`success:true`) ou **503**
  (falha do `export_manager`), **nunca 400** por "User info incomplete".
- `POST /user/deletion/initiate` idem.
- `POST /auth/login` com senha errada → front mostra **"Email ou senha incorretos."** (pt-BR),
  em qualquer superfície (popup, welcome).
- `scanPatterns("Google Cloud Platform")` → **0** entidades `NAME`.

## Testes

- `backend/tests/test_privacy_auth_alias.py` — mocka `resolve_token`, chama `/user/export/request`
  e `/user/deletion/initiate`; assert status ≠ 400. Falha antes do alias.
- `tests/dlp/patterns.test.ts` — `"Google Cloud Platform"`, `"Comece pelos fundamentos"` não
  viram `NAME`; um nome real (`"Diego Rodrigues"`) ainda vira. Regressão B4.
- `tests/popup-login-error.test.ts` — `messageFor(new AppError(E.INVALID_CREDENTIALS))` ===
  `"Email ou senha incorretos. Verifique e tente novamente."`; nunca devolve o código cru.

## Riscos

- Alias `id`/`sub` no `require_auth`: só **adiciona** chaves, nenhuma rota perde `user_id`. Risco baixo.
- Stopwords de nome: `"Google"`/`"Claude"` viram stopword → um nome real "Maria Google" (raríssimo)
  não seria pego. Trade-off aceito e documentado (padrão #8).
- `messageFor` no popup: mensagens específicas de signup (pt-BR) continuam passando direto — só
  código em CAIXA_ALTA e strings com "error/fail" caem no mapa canônico.

## Rollout

`vitest` + `pytest` verdes → `npm run build` → PR → merge → deploy backend na VPS
(`docker compose up -d --build backend`) → smoke: login errado no popup, "Solicitar relatório".

---

## Fora desta fase (rastreado à parte)

- **Blindagem de privacidade / anti-insider** (RLS server-side, limpar storage escopado no logout,
  auditoria de todo caller de `sk()`, política anti-insider) → `docs/specs/FASE_P-ZT_BLINDAGEM.md`
  (a criar). O vazamento de histórico entre contas já foi corrigido no PR #40.
- **Hardening de rate limit** (IP-based, store compartilhado) → plano macro P4/P5.
- **B5, B11, B12** → FASE 10.9.1 (investigação com repro real).
- **B7, B8, B9, B10** → FASE 10.9.2 (features do badge + detecção de conteúdo repetido).
