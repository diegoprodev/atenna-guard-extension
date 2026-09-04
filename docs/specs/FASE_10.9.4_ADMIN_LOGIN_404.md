# FASE 10.9.4 — `POST /auth/admin-login` sumiu do backend (404)

**Status:** em execução — precisa de merge + **deploy aprovado** (GitHub Environments `production`).
**Severidade:** ALTA — o painel de admin (`/nexussafe/`) está **100% inacessível** em produção.

## Problema

O painel de admin chama `POST https://api.atennaia.com.br/auth/admin-login` e recebe **404**.
O endpoint **não existe** no backend em produção nem no repositório — só era citado no
`CHANGELOG` (v ~2.19) e na mensagem de erro do `middleware/admin_auth.py`.

Causa: quando a infra caiu e foi migrada pra `api.atennaia.com.br` (set/2026), o backend
foi de um snapshot parcial. O módulo que servia `/auth/admin-login` ficou pra trás (é o
mesmo problema macro da FASE P4 — "backend real ≠ repo"). Resultado: trocar a senha do
Supabase não adianta, porque não há rota que aceite o login do admin.

## Decisões

| # | Decisão |
|---|---------|
| 1 | Recriar `POST /auth/admin-login` em `routes/bff_auth.py` (mesmo router `/auth`, reusa `get_auth_client`, `_issue_token`, `_check_login_rate_limit`). |
| 2 | Valida a senha no Supabase **e** exige `email ∈ ADMIN_EMAILS` **antes** de checar a credencial (não vaza se a senha está certa pra não-admin). Emite token opaco normal. |
| 3 | `require_super_admin` passa a **revalidar o gate por `ADMIN_EMAILS`** em toda rota `/admin/*` — não depende mais só de `session["role"]=="super_admin"` (a coluna `role` nunca é escrita pelo `issue_token`, e no fallback in-memory nem existe). Aceita role explícita OU e-mail na allowlist. |
| 4 | `ADMIN_EMAILS` cai pra default `devdiegopro@gmail.com` quando a env não está setada — igual `checkout.py` e `security/monitor.py` já fazem. (Remover esse default é hardening da FASE P-ZT / S8, não desta.) |
| 5 | `require_super_admin` também injeta `id` no dict da sessão (rotas admin leem `admin["id"]`). |

## Arquivos

- `backend/routes/bff_auth.py` — `admin_login()` + `_admin_emails()`.
- `backend/middleware/admin_auth.py` — gate por `ADMIN_EMAILS`, `id` no dict, default do env.
- `backend/tests/test_admin_login.py` — 5 testes.
- `docs/specs/FASE_10.9.4_ADMIN_LOGIN_404.md` · `CHANGELOG.md`.

## Contrato

- `POST /auth/admin-login {email,password}`
  - `email ∉ ADMIN_EMAILS` → **403** `"Acesso restrito a administradores."`
  - senha errada → **401** `"Credenciais inválidas."`
  - > 5 tentativas/email/60s → **429**
  - ok → **200** `{token, expires_at, plan}` (mesmo shape do `/auth/login`)
- Toda rota `/admin/*` com token cujo e-mail não está em `ADMIN_EMAILS` → **403**.

## Testes

`backend/tests/test_admin_login.py`:
1. e-mail não-admin → 403
2. e-mail admin + senha ok → token emitido
3. senha errada → 401
4. `require_super_admin` aceita sessão sem `role` se e-mail ∈ `ADMIN_EMAILS`
5. `require_super_admin` nega e-mail fora da allowlist → 403

## Riscos

- **Deploy:** só sobe depois de merge → CI verde → **aprovação manual** no GitHub
  (`environment: production` no `deploy.yml`). Enquanto não aprovar, o painel segue 404.
- `require_super_admin` mudou de critério. Se alguma sessão de admin legada dependia de
  `role`, continua funcionando (o `or` cobre). Sem regressão de acesso.
- Default `devdiegopro@gmail.com`: se a env `ADMIN_EMAILS` na VPS estiver setada com outro
  conjunto, ela vence (o default só age quando a env é vazia).

## Rollout

1. Merge deste PR → CI.
2. **Dono aprova o deploy** em GitHub → Actions → "Deploy backend (prod)" → Review deployments.
3. `deploy.sh` faz build + health check (rollback automático se falhar).
4. Smoke: `curl -X POST https://api.atennaia.com.br/auth/admin-login -d '{"email":"…","password":"…"}'`
   → 200 com `token`. Depois `/nexussafe/` → entra.

## Desbloqueio da senha (parte do dono, em paralelo)

A senha do `devdiegopro@gmail.com` no Supabase é **uma só** (extensão e admin usam a mesma).
Redefinir por qualquer caminho serve. Opção sem esperar nada:

```sql
-- Supabase Dashboard → SQL Editor
update auth.users
set encrypted_password = crypt('NOVA_SENHA_FORTE', gen_salt('bf')),
    updated_at = now()
where email = 'devdiegopro@gmail.com';
```

Ou: welcome da extensão → "Esqueci a senha" → e-mail → `/auth/callback` (essa página **está no
ar**, responde 200) → definir. Depois é só esperar o deploy do endpoint pra entrar no painel.
