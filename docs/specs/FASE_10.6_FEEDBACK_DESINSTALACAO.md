# FASE 10.6 — Feedback de desinstalação (off-boarding)

**Status:** implementado · **Não bloqueia:** republicar

## Problema
Quando o usuário remove a extensão, não sabemos por quê. Concorrentes redirecionam
para um Google Form no `uninstall`. Queremos o mesmo — porém minimalista, na nossa
identidade e com os dados na nossa base (o admin vê depois).

## Decisões
| Tema | Decisão | Porquê |
|---|---|---|
| Gatilho | `chrome.runtime.setUninstallURL(\`${BFF_BASE}/desinstalado\`)` no `background.ts` (top-level, idempotente) | Chrome abre a URL ao remover a extensão |
| Onde a página vive | FastAPI serve `GET /desinstalado` de `backend/static/uninstall.html` | reusa o padrão de `/privacy`; 0 nginx, 0 host separado |
| Coleta | `POST /uninstall-feedback` **público** (sem auth — a extensão já foi removida) | não dá pra autenticar pós-uninstall |
| Anti-abuso | honeypot (`website`), `reason` numa allowlist, `detail`≤2000, rate-limit 5/10min por IP (in-process) | endpoint público |
| Armazenamento | tabela Supabase `uninstall_feedback` via service role (padrão `error_reporter`) + RLS ligada sem policies | só o backend lê/escreve |
| Notificação | webhook opcional (`ADMIN_ALERT_WEBHOOK_URL`) reusando `_notify_webhook` | dono sabe na hora |
| Página | 1 pergunta obrigatória (7 motivos), 1 textarea + 1 email opcionais, sem libs, tokens visuais do Atenna, estado "Obrigado" | fricção mínima = mais respostas |
| PII | email é opcional e explícito; nada é logado em texto de log; `detail` capado | LGPD |

## Arquivos
```
src/background/background.ts                     # + setUninstallURL
backend/routes/uninstall_feedback.py             # GET /desinstalado + POST /uninstall-feedback (novo)
backend/services/error_reporter.py               # + log_uninstall_feedback()
backend/static/uninstall.html                    # página (novo)
backend/main.py                                   # + router
backend/supabase/migrations/20260903_uninstall_feedback.sql   # tabela (novo)
backend/tests/test_uninstall_feedback.py         # 6 casos (novo)
src/__tests__/uninstall-url.test.ts              # background registra a URL (novo)
```

## Contrato
`POST /uninstall-feedback` → `{ reason: <allowlist>, detail?, email?, ext_version?, website? }`
→ `200 {received:true}` sempre que aceito (honeypot também responde 200, sem gravar).
`422` reason fora da allowlist / detail > 2000. `429` acima do rate-limit.

`reason` ∈ `nao_melhorou | confuso | bugs | faltou_recurso | caro | nao_preciso | outro`.

## Rollout
1. Migration `20260903_uninstall_feedback.sql` no Supabase (MCP ou psql).
2. `ADMIN_ALERT_WEBHOOK_URL` já existe no `.env` → notificação automática.
3. Deploy backend (pipeline) → `GET /desinstalado` no ar.
4. Próxima publicação da extensão na CWS carrega o `setUninstallURL`.

## Riscos
| Risco | Mitigação |
|---|---|
| Endpoint público → flood / lixo | honeypot + allowlist + rate-limit + caps de tamanho |
| `ext_version` é hardcoded na página (`2.3.0`) | aceitável — é telemetria best-effort; atualizar junto com o bump de versão |
| Rate-limit in-process reseta no restart do container | suficiente contra abuso trivial; não é dado crítico |

## Validação
- `vitest` 318 ✓ (novo: `uninstall-url.test.ts`)
- `pytest backend/tests/test_uninstall_feedback.py` — 6 casos (roda no CI)
- `py_compile` limpo nos arquivos novos/alterados
- screenshots: formulário + estado "Obrigado" (identidade do welcome/popup)
