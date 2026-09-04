# FASE 10.9.7 — os e-mails de LGPD não saíam

**Status:** feito, pendente de deploy do backend.
**Origem:** o dono clicou "Solicitar relatório", a extensão disse "email enviado", **nenhum
e-mail chegou**.

## Problema

`export.py` e `deletion.py` respondiam `{"message": "Email de confirmação enviado para …"}`
mas **nenhum dos dois chamava `send_email`**. `export_manager.request_export` e
`deletion_manager.initiate_deletion` criam a linha no banco (via RPC) e retornam — sem tocar
em e-mail. Era uma mensagem mentirosa.

Além disso: o link do e-mail seria um GET, mas os únicos endpoints de confirmação eram
`POST /user/export/confirm` e `POST /user/deletion/confirm` (sem página).

## Decisões

| # | Decisão |
|---|---------|
| 1 | `email_service.py` ganha `render_data_export_confirmation()` e `render_account_deletion_confirmation()` (mesmo estilo dos outros templates). |
| 2 | As rotas `request_export` / `initiate_deletion` mandam o e-mail de verdade (Resend, via `send_email`), com o token que o manager já devolve. |
| 3 | Novos `GET /user/export/confirm` e `GET /user/deletion/confirm` — landing do link: chamam `confirm_*` do manager e devolvem uma página HTML simples (paleta Atenna). |
| 4 | A resposta da API passa a incluir `email_sent: bool`. Se o Resend falhar, a mensagem é honesta: "Pedido registrado. Se o email não chegar…". |

## Arquivos

- `backend/routes/email_service.py` — 2 templates.
- `backend/routes/export.py` — envia e-mail + `GET /confirm` + helper `_confirm_page`.
- `backend/routes/deletion.py` — envia e-mail + `GET /confirm` + helper `_page`.
- `docs/specs/FASE_10.9.7_LGPD_EMAILS.md` · `CHANGELOG.md`.

## Contrato

- `POST /user/export/request` → 200 `{success, message, email_sent, expires_in}`.
  Manda e-mail com link `{SITE_URL}/user/export/confirm?token=<download_token>`.
- `GET /user/export/confirm?token=…` → 200 HTML "Relatório confirmado" ou 400 HTML "Link inválido".
- `POST /user/deletion/initiate` → 200, e-mail com link `.../user/deletion/confirm?token=<confirmation_token>`.
- `GET /user/deletion/confirm?token=…` → 200 HTML "Exclusão confirmada (7 dias)" ou 400.

## Testes

- `py_compile` OK.
- Pós-deploy (curl com token do harness):
  1. `POST /user/export/request` → `email_sent: true`
  2. abrir o link do e-mail → página "Relatório confirmado", status vira `confirmed`
  3. idem deleção
- Limpar as linhas de teste do harness depois.

## Riscos

- Depende de `RESEND_API_KEY` na VPS. Se estiver vazia, `send_email` retorna `False` e a
  resposta é honesta (`email_sent:false`) — não quebra o fluxo.
- `GET /confirm` não exige auth (o token é o segredo, igual `/auth/callback`). O token é
  `gen_random_bytes(32)` / `token_urlsafe(32)` e de uso único (a função de confirm só age em
  `pending_confirmation` / `requested`).

## Rollout

Deploy do backend (aprovação manual no GitHub). Depois: teste ponta a ponta + o dono clica
"Solicitar relatório" e o e-mail chega.
