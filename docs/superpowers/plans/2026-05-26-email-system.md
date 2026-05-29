# Atenna Safe Prompt — Sistema de Email Completo

## Visão Geral

Sistema de emails transacionais e lifecycle usando **Resend** como provedor único.
Supabase configurado com SMTP customizado (Resend) — elimina limite de 2-3 emails/5min.

---

## Identidade Visual nos Emails

| Elemento | Valor |
|---|---|
| Nome do produto | **Atenna Safe Prompt** |
| Background | `#0a0a0a` |
| Card | `#111111` / borda `#1e1e1e` |
| Primária (verde) | `#22c55e` |
| Texto principal | `#f0f0f0` |
| Texto secundário | `#888888` |
| Logo | `https://atennaplugin.maestro-n8n.site/static/admin/logo.png` |
| Fonte | `-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif` |
| Rodapé | `© Atenna Safe Prompt · maestro-n8n.site` |

---

## Emails Transacionais (via Supabase → Resend SMTP)

Disparados automaticamente pelo Supabase Auth. Templates customizados no dashboard.

### T1 — Confirmação de Cadastro
- **Gatilho:** `signUp()` com email/senha
- **Assunto:** `Confirme seu email — Atenna Safe Prompt`
- **Conteúdo:** CTA "Confirmar email" → link do Supabase
- **Após confirmar:** redireciona para extensão / página de boas-vindas

### T2 — Redefinição de Senha
- **Gatilho:** `resetPasswordForEmail()`
- **Assunto:** `Redefina sua senha — Atenna Safe Prompt`
- **Conteúdo:** CTA "Redefinir senha" + aviso de 1h de validade

### T3 — Magic Link / Login sem senha
- **Gatilho:** `signInWithOtp()`
- **Assunto:** `Seu link de acesso — Atenna Safe Prompt`
- **Conteúdo:** CTA "Acessar agora" + aviso de 10min de validade

### T4 — Convite (novo usuário via checkout)
- **Gatilho:** `invite_user_by_email()` no webhook do Asaas
- **Assunto:** `Sua conta Atenna Safe Prompt foi criada 🎉`
- **Conteúdo:** informa que a conta Pro foi ativada após pagamento, CTA "Definir minha senha"

---

## Emails Lifecycle (via BFF + Resend API)

Disparados pelo backend conforme eventos de negócio.

### L1 — Boas-vindas (pós-confirmação)
- **Gatilho:** Webhook Supabase `email.confirmed` → `POST /internal/email/welcome`
- **Assunto:** `Bem-vindo ao Atenna Safe Prompt! 🛡️`
- **Conteúdo:**
  - Como instalar a extensão (link Chrome Web Store)
  - Como funciona (3 passos visuais)
  - Link para tutorial em vídeo (se disponível)
  - CTA: "Instalar extensão"

### L2 — Onboarding D+1 (não usou ainda)
- **Gatilho:** Cron diário — verifica quem criou conta há 1 dia e nunca gerou prompt
- **Assunto:** `Você ainda não protegeu nenhum prompt 🤔`
- **Conteúdo:** lembrete de valor, passo a passo rápido, CTA "Experimentar agora"

### L3 — Upsell Free → Pro (D+3 após limite atingido)
- **Gatilho:** Cron diário — verifica quem bateu cota free nos últimos 3 dias
- **Assunto:** `Você atingiu seu limite — hora de ser Pro`
- **Conteúdo:** benefícios do Pro, preço mensal e anual, CTA "Assinar agora"
- **Links:** botões diretos para os links estáticos Asaas

### L4 — Renovação (D-30 do vencimento) ✅ JÁ IMPLEMENTADO
- **Gatilho:** Cron diário 09:00 BRT
- **Assunto:** `Sua assinatura Atenna Safe Prompt vence em 30 dias`

### L5 — Renovação urgente (D-7 do vencimento)
- **Gatilho:** Cron diário — janela 6-8 dias
- **Assunto:** `⚠️ Sua assinatura vence em 7 dias — renove agora`
- **Conteúdo:** mais urgente, desconto se aplicável

### L6 — Pós-cancelamento (grace period)
- **Gatilho:** Webhook Asaas `PAYMENT_OVERDUE` → após marcar `past_due`
- **Assunto:** `Sua assinatura está com pagamento pendente`
- **Conteúdo:** instrução para atualizar forma de pagamento, link para novo checkout

### L7 — Confirmação de upgrade para Pro
- **Gatilho:** `_promote_to_pro()` no webhook Asaas
- **Assunto:** `🎉 Você agora é Atenna Pro!`
- **Conteúdo:** confirmação do plano, data de renovação, lista de benefícios

---

## Configuração Supabase SMTP (Resend)

### Passos no Supabase Dashboard

1. **Settings → Auth → SMTP Settings**
2. Habilitar "Enable Custom SMTP"
3. Configurar:
   ```
   Host:     smtp.resend.com
   Port:     465
   User:     resend
   Password: REVOKED_RESEND_KEY
   Sender:   Atenna Safe Prompt <noreply@maestro-n8n.site>
   ```
4. **Settings → Auth → Email Templates** — substituir cada template pelos HTMLs desta spec

### Rate limit após configuração
- Supabase padrão: ~3 emails/5min (muito restritivo)
- Com Resend SMTP: **3.000 emails/mês** no plano free, sem limite de rate

---

## Arquitetura de Implementação

```
routes/
  email_service.py     ← templates HTML + função send_email()
  renewal.py           ← L4 já implementado (atualizar com novo template)
  lifecycle_emails.py  ← L1, L2, L3, L5, L6, L7
main.py                ← scheduler com todos os jobs
```

### `email_service.py` — responsabilidades
- `BASE_TEMPLATE` — HTML wrapper com logo, cores, rodapé
- `send_email(to, subject, html)` — wrapper Resend API
- `render_welcome(email)` → HTML do L1
- `render_confirmation(link)` → HTML do T1 (para Supabase template)
- `render_reset_password(link)` → HTML do T2
- `render_magic_link(link)` → HTML do T3
- `render_invite_checkout(email, plan)` → HTML do T4
- `render_renewal(email, days_left, url, plan_key)` → HTML do L4 (já existe, melhorar)
- `render_renewal_urgent(email, days_left, url)` → HTML do L5
- `render_pro_welcome(email, plan_key, expires_at)` → HTML do L7
- `render_upsell(email, quota_count)` → HTML do L3

### Endpoints adicionados
```
POST /internal/email/welcome        ← chamado pelo webhook Supabase após confirmação
POST /internal/email/pro-welcome    ← chamado por _promote_to_pro()
GET  /internal/email/preview/{type} ← preview de template (admin only)
```

---

## Jobs do Scheduler (APScheduler)

| Job | Cron | Descrição |
|---|---|---|
| `daily_renewal_30d` | `09:00 BRT` | L4 — vence em 30 dias ✅ |
| `daily_renewal_7d` | `09:00 BRT` | L5 — vence em 7 dias |
| `daily_onboarding_d1` | `10:00 BRT` | L2 — sem uso após 1 dia |
| `daily_upsell` | `11:00 BRT` | L3 — atingiu cota free |

---

## Templates Supabase (copiar para o dashboard)

Os HTMLs completos dos templates T1-T4 são gerados pelo `email_service.py`
e devem ser copiados manualmente para:
`Supabase → Authentication → Email Templates`

Variáveis que o Supabase injeta: `{{ .ConfirmationURL }}`, `{{ .Email }}`

---

## Métricas a acompanhar (Resend Dashboard)

- Open rate por tipo de email
- Click rate nos CTAs
- Conversão renewal → pagamento (cruzar com checkout_events)
- Conversão upsell → Pro (cruzar com profiles.plan)
