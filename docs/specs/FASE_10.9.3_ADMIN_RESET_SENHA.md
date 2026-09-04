# FASE 10.9.3 — Reset de senha no painel de admin

**Status:** em execução
**Origem:** o dono ficou sem a senha do admin. O painel (`/nexussafe/`) **não tinha** link de
"Esqueci a senha". Ao disparar o reset pelo dashboard do Supabase, o e-mail e a página de
redefinição falavam só em "extensão" — parecia que não servia pro admin.

## Problema

1. `admin/src/pages/Login.tsx` só tem email + senha. Zero recuperação.
2. `GET /auth/callback` (a página que redefine a senha) e o e-mail de reset assumem que o
   usuário é da **extensão** ("Volte à extensão", "Abra a extensão", "Solicite um novo na
   extensão"). Funciona pro admin — a conta Supabase é a mesma — mas a cópia confunde.

## Decisões

| # | Decisão |
|---|---------|
| 1 | Admin `Login.tsx` ganha "Esqueci minha senha" → chama `POST /auth/reset-password {email}` (a **mesma** rota da extensão). O link do e-mail cai em `/auth/callback`, que redefine a senha da conta Supabase — a mesma que o `/auth/admin-login` valida. **Nenhuma rota nova.** |
| 2 | Cópia de `/auth/callback` fica **neutra** ("sua conta Atenna", "na extensão ou no painel de admin") em vez de assumir extensão. |
| 3 | `reset-password` **não** checa se o email é admin — resposta sempre `{ok:true}`, não vaza. O gate de admin continua no `/auth/admin-login` (só quem tem role `super_admin` entra). |
| 4 | **Sem** endpoint pra "setar senha direto" (evita superfície de ataque). Recuperação é sempre por e-mail + token de recovery do Supabase. |

## Arquivos

- `admin/src/pages/Login.tsx` — modo `forgot` + tela "link enviado".
- `backend/routes/auth.py` — 5 strings da página `/auth/callback` neutralizadas.
- `docs/specs/FASE_10.9.3_ADMIN_RESET_SENHA.md` — este doc.
- `CHANGELOG.md`.

## Contrato

- `POST /auth/reset-password {email}` → `{ok:true}` sempre. Se o email existe no Supabase,
  envia e-mail com link `https://api.atennaia.com.br/auth/callback?token_hash=…&type=recovery`.
- A página `/auth/callback` com `type=recovery` mostra o form "Criar nova senha" → `PUT`
  em `SUPABASE_URL/auth/v1/user` com o token de recovery → senha trocada.
- Depois: `/nexussafe/` → login com a nova senha.

## Testes

- `admin` — `tsc --noEmit` limpo (sem suíte de componente no admin ainda).
- Manual: `/nexussafe/` → "Esqueci minha senha" → email → link → nova senha → login OK.
- `backend` — o fluxo `reset-password` já é coberto por testes existentes de `bff_auth`.

## Riscos

- Baixo. Reusa rota e página que já existem e funcionam. Só cópia + um form no admin.
- `_check_login_rate_limit` compartilhado: 5 chamadas de reset/email/60s. Se o dono já tentou
  várias vezes, esperar 1 min.

## Desbloqueio imediato (enquanto o deploy não sai)

O dono tem acesso ao dashboard do Supabase. Caminho que **já funciona hoje**:

1. Supabase → **Authentication → Users** → `devdiegopro@gmail.com` → menu → **Send recovery** /
   **Reset password**.
2. Abrir o link do e-mail → cai em `…/auth/callback` → form **"Criar nova senha"** → definir.
3. `https://api.atennaia.com.br/nexussafe/` → entrar com a senha nova.

Alternativa instantânea (SQL Editor do Supabase, sem e-mail):

```sql
update auth.users
set encrypted_password = crypt('UMA_SENHA_TEMPORARIA_FORTE', gen_salt('bf')),
    updated_at = now()
where email = 'devdiegopro@gmail.com';
```

Depois entrar no `/nexussafe/` com essa senha e trocá-la pelo fluxo normal.
