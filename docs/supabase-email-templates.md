# Supabase Email Templates — Atenna Safe Prompt

Cole cada HTML no dashboard:
**Supabase → Authentication → Email Templates**

Variáveis disponíveis no Supabase:
- `{{ .ConfirmationURL }}` — link de ação (confirmar / redefinir / etc.)
- `{{ .Email }}` — email do usuário
- `{{ .Data.name }}` — nome definido no user_metadata durante signup

---

## Como inserir

1. Acesse [supabase.com/dashboard](https://supabase.com/dashboard) → seu projeto
2. Vá em **Authentication → Email Templates**
3. Selecione o template (Confirm signup, Reset Password, etc.)
4. Apague o conteúdo existente e cole o HTML abaixo
5. Altere o **Subject** conforme indicado
6. Clique **Save**

---

## T1 — Confirm signup

**Subject:** `{{if .Data.name}}{{.Data.name}}, confirme seu email — Atenna Safe Prompt{{else}}Confirme seu email — Atenna Safe Prompt{{end}}`

```html
<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="dark">
<title>Atenna Safe Prompt</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { background: #0a0a0a; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif; color: #f0f0f0; -webkit-font-smoothing: antialiased; }
  .wrapper { background: #0a0a0a; padding: 40px 16px; }
  .container { max-width: 560px; margin: 0 auto; }
  .header { text-align: center; padding-bottom: 32px; }
  .header img { height: 36px; width: auto; }
  .card { background: #111111; border: 1px solid #1e1e1e; border-radius: 12px; padding: 40px 36px; }
  .icon-wrap { text-align: center; margin-bottom: 24px; font-size: 48px; line-height: 1; }
  h1 { font-size: 22px; font-weight: 700; color: #ffffff; line-height: 1.3; margin-bottom: 16px; }
  p { font-size: 15px; color: #aaaaaa; line-height: 1.7; margin-bottom: 16px; }
  p strong { color: #f0f0f0; }
  .btn-wrap { text-align: center; margin: 32px 0; }
  .btn { display: inline-block; background: #22c55e; color: #000000 !important; padding: 14px 36px; border-radius: 8px; font-size: 15px; font-weight: 700; text-decoration: none; }
  .divider { border: none; border-top: 1px solid #1e1e1e; margin: 28px 0; }
  .link-fallback { word-break: break-all; font-size: 12px; color: #555555; margin-top: 8px; }
  .link-fallback a { color: #22c55e; }
  .footer { text-align: center; padding-top: 28px; }
  .footer p { font-size: 12px; color: #444444; line-height: 1.6; margin-bottom: 4px; }
  .footer a { color: #555555; text-decoration: none; }
</style>
</head>
<body>
<div style="display:none;max-height:0;overflow:hidden">Confirme seu email para ativar sua conta no Atenna Safe Prompt</div>
<div class="wrapper">
  <div class="container">
    <div class="header">
      <img src="https://atennaplugin.maestro-n8n.site/static/admin/logo.png" alt="Atenna Safe Prompt" />
    </div>
    <div class="card">
      <div class="icon-wrap">✉️</div>
      <h1>{{if .Data.name}}Olá, {{.Data.name}}! Confirme seu email{{else}}Confirme seu email{{end}}</h1>
      <p>{{if .Data.name}}{{.Data.name}}, clique{{else}}Clique{{end}} no botão abaixo para confirmar o endereço <strong>{{ .Email }}</strong> e ativar sua conta no Atenna Safe Prompt.</p>
      <div class="btn-wrap">
        <a href="{{ .ConfirmationURL }}" class="btn">Confirmar meu email →</a>
      </div>
      <hr class="divider">
      <p style="font-size:13px;color:#555">Este link expira em <strong style="color:#888">24 horas</strong>. Se você não criou uma conta, ignore este email.</p>
      <p class="link-fallback">Se o botão não funcionar, copie este link:<br><a href="{{ .ConfirmationURL }}">{{ .ConfirmationURL }}</a></p>
    </div>
    <div class="footer">
      <p>© 2026 Atenna Safe Prompt · <a href="https://atennaplugin.maestro-n8n.site">maestro-n8n.site</a></p>
      <p>Você está recebendo este email porque criou uma conta.</p>
    </div>
  </div>
</div>
</body>
</html>
```

---

## T2 — Reset Password

**Subject:** `{{if .Data.name}}{{.Data.name}}, redefina sua senha — Atenna Safe Prompt{{else}}Redefina sua senha — Atenna Safe Prompt{{end}}`

```html
<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="dark">
<title>Atenna Safe Prompt</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { background: #0a0a0a; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif; color: #f0f0f0; -webkit-font-smoothing: antialiased; }
  .wrapper { background: #0a0a0a; padding: 40px 16px; }
  .container { max-width: 560px; margin: 0 auto; }
  .header { text-align: center; padding-bottom: 32px; }
  .header img { height: 36px; width: auto; }
  .card { background: #111111; border: 1px solid #1e1e1e; border-radius: 12px; padding: 40px 36px; }
  .icon-wrap { text-align: center; margin-bottom: 24px; font-size: 48px; line-height: 1; }
  h1 { font-size: 22px; font-weight: 700; color: #ffffff; line-height: 1.3; margin-bottom: 16px; }
  p { font-size: 15px; color: #aaaaaa; line-height: 1.7; margin-bottom: 16px; }
  p strong { color: #f0f0f0; }
  .btn-wrap { text-align: center; margin: 32px 0; }
  .btn { display: inline-block; background: #22c55e; color: #000000 !important; padding: 14px 36px; border-radius: 8px; font-size: 15px; font-weight: 700; text-decoration: none; }
  .divider { border: none; border-top: 1px solid #1e1e1e; margin: 28px 0; }
  .link-fallback { word-break: break-all; font-size: 12px; color: #555555; margin-top: 8px; }
  .link-fallback a { color: #22c55e; }
  .footer { text-align: center; padding-top: 28px; }
  .footer p { font-size: 12px; color: #444444; line-height: 1.6; margin-bottom: 4px; }
  .footer a { color: #555555; text-decoration: none; }
</style>
</head>
<body>
<div style="display:none;max-height:0;overflow:hidden">Redefina sua senha do Atenna Safe Prompt</div>
<div class="wrapper">
  <div class="container">
    <div class="header">
      <img src="https://atennaplugin.maestro-n8n.site/static/admin/logo.png" alt="Atenna Safe Prompt" />
    </div>
    <div class="card">
      <div class="icon-wrap">🔐</div>
      <h1>{{if .Data.name}}{{.Data.name}}, redefina sua senha{{else}}Redefina sua senha{{end}}</h1>
      <p>Recebemos um pedido de redefinição de senha para <strong>{{ .Email }}</strong>.</p>
      <div class="btn-wrap">
        <a href="{{ .ConfirmationURL }}" class="btn">Redefinir minha senha →</a>
      </div>
      <hr class="divider">
      <p style="font-size:13px;color:#555">Este link expira em <strong style="color:#888">1 hora</strong>. Se você não solicitou isso, sua senha continua segura — ignore este email.</p>
      <p class="link-fallback">Se o botão não funcionar, copie este link:<br><a href="{{ .ConfirmationURL }}">{{ .ConfirmationURL }}</a></p>
    </div>
    <div class="footer">
      <p>© 2026 Atenna Safe Prompt · <a href="https://atennaplugin.maestro-n8n.site">maestro-n8n.site</a></p>
      <p>Você está recebendo este email porque tem uma conta ativa.</p>
    </div>
  </div>
</div>
</body>
</html>
```

---

## T3 — Magic Link

**Subject:** `{{if .Data.name}}{{.Data.name}}, seu link de acesso — Atenna Safe Prompt{{else}}Seu link de acesso — Atenna Safe Prompt{{end}}`

```html
<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="dark">
<title>Atenna Safe Prompt</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { background: #0a0a0a; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif; color: #f0f0f0; -webkit-font-smoothing: antialiased; }
  .wrapper { background: #0a0a0a; padding: 40px 16px; }
  .container { max-width: 560px; margin: 0 auto; }
  .header { text-align: center; padding-bottom: 32px; }
  .header img { height: 36px; width: auto; }
  .card { background: #111111; border: 1px solid #1e1e1e; border-radius: 12px; padding: 40px 36px; }
  .icon-wrap { text-align: center; margin-bottom: 24px; font-size: 48px; line-height: 1; }
  h1 { font-size: 22px; font-weight: 700; color: #ffffff; line-height: 1.3; margin-bottom: 16px; }
  p { font-size: 15px; color: #aaaaaa; line-height: 1.7; margin-bottom: 16px; }
  p strong { color: #f0f0f0; }
  .btn-wrap { text-align: center; margin: 32px 0; }
  .btn { display: inline-block; background: #22c55e; color: #000000 !important; padding: 14px 36px; border-radius: 8px; font-size: 15px; font-weight: 700; text-decoration: none; }
  .divider { border: none; border-top: 1px solid #1e1e1e; margin: 28px 0; }
  .footer { text-align: center; padding-top: 28px; }
  .footer p { font-size: 12px; color: #444444; line-height: 1.6; margin-bottom: 4px; }
  .footer a { color: #555555; text-decoration: none; }
</style>
</head>
<body>
<div style="display:none;max-height:0;overflow:hidden">Seu link de acesso ao Atenna Safe Prompt</div>
<div class="wrapper">
  <div class="container">
    <div class="header">
      <img src="https://atennaplugin.maestro-n8n.site/static/admin/logo.png" alt="Atenna Safe Prompt" />
    </div>
    <div class="card">
      <div class="icon-wrap">⚡</div>
      <h1>{{if .Data.name}}{{.Data.name}}, seu link de acesso{{else}}Seu link de acesso{{end}}</h1>
      <p>Use o botão abaixo para entrar no Atenna Safe Prompt com <strong>{{ .Email }}</strong>. Sem precisar de senha.</p>
      <div class="btn-wrap">
        <a href="{{ .ConfirmationURL }}" class="btn">Acessar agora →</a>
      </div>
      <hr class="divider">
      <p style="font-size:13px;color:#555">Este link expira em <strong style="color:#888">10 minutos</strong> e só pode ser usado uma vez. Se você não solicitou acesso, ignore este email.</p>
    </div>
    <div class="footer">
      <p>© 2026 Atenna Safe Prompt · <a href="https://atennaplugin.maestro-n8n.site">maestro-n8n.site</a></p>
      <p>Você está recebendo este email porque tem uma conta ativa.</p>
    </div>
  </div>
</div>
</body>
</html>
```

---

## T4 — Invite User (pós-checkout)

**Subject:** `Sua conta Atenna Safe Prompt Pro foi criada 🎉`

> **Nota:** O T4 é disparado pelo Supabase quando `invite_user_by_email()` é chamado no webhook do Asaas (pagamento confirmado por quem não tinha conta). O `{{ .Data.name }}` pode estar vazio — o email do Asaas nem sempre tem o nome completo disponível.

```html
<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="dark">
<title>Atenna Safe Prompt</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { background: #0a0a0a; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif; color: #f0f0f0; -webkit-font-smoothing: antialiased; }
  .wrapper { background: #0a0a0a; padding: 40px 16px; }
  .container { max-width: 560px; margin: 0 auto; }
  .header { text-align: center; padding-bottom: 32px; }
  .header img { height: 36px; width: auto; }
  .card { background: #111111; border: 1px solid #1e1e1e; border-radius: 12px; padding: 40px 36px; }
  .icon-wrap { text-align: center; margin-bottom: 24px; font-size: 48px; line-height: 1; }
  h1 { font-size: 22px; font-weight: 700; color: #ffffff; line-height: 1.3; margin-bottom: 16px; }
  p { font-size: 15px; color: #aaaaaa; line-height: 1.7; margin-bottom: 16px; }
  p strong { color: #f0f0f0; }
  .highlight { color: #22c55e; font-weight: 600; }
  .badge { display: inline-block; background: #0d2818; color: #22c55e; border: 1px solid #1a4a2e; border-radius: 20px; padding: 4px 12px; font-size: 12px; font-weight: 600; margin-bottom: 20px; }
  .btn-wrap { text-align: center; margin: 32px 0; }
  .btn { display: inline-block; background: #22c55e; color: #000000 !important; padding: 14px 36px; border-radius: 8px; font-size: 15px; font-weight: 700; text-decoration: none; }
  .divider { border: none; border-top: 1px solid #1e1e1e; margin: 28px 0; }
  .feature { display: flex; align-items: flex-start; margin-bottom: 12px; }
  .feature-icon { color: #22c55e; font-size: 16px; margin-right: 10px; flex-shrink: 0; margin-top: 2px; }
  .feature-text { font-size: 14px; color: #aaaaaa; line-height: 1.5; }
  .feature-text strong { color: #f0f0f0; }
  .footer { text-align: center; padding-top: 28px; }
  .footer p { font-size: 12px; color: #444444; line-height: 1.6; margin-bottom: 4px; }
  .footer a { color: #555555; text-decoration: none; }
</style>
</head>
<body>
<div style="display:none;max-height:0;overflow:hidden">Sua conta Pro foi criada — bem-vindo ao Atenna Safe Prompt</div>
<div class="wrapper">
  <div class="container">
    <div class="header">
      <img src="https://atennaplugin.maestro-n8n.site/static/admin/logo.png" alt="Atenna Safe Prompt" />
    </div>
    <div class="card">
      <div class="icon-wrap">🎉</div>
      <div style="text-align:center"><span class="badge">✦ Plano Pro ativado</span></div>
      <h1>{{if .Data.name}}{{.Data.name}}, sua conta Pro foi criada!{{else}}Sua conta Pro foi criada!{{end}}</h1>
      <p>Seu pagamento foi confirmado e criamos sua conta <strong>Atenna Safe Prompt</strong> com o plano <span class="highlight">Pro</span> já ativo.</p>
      <p>Defina sua senha para acessar a extensão:</p>
      <div class="btn-wrap">
        <a href="{{ .ConfirmationURL }}" class="btn">Definir minha senha →</a>
      </div>
      <hr class="divider">
      <div>
        <div class="feature"><div class="feature-icon">✓</div><div class="feature-text"><strong>Mascaramento LGPD</strong> — proteja CPF, email, telefone e outros dados sensíveis</div></div>
        <div class="feature"><div class="feature-icon">✓</div><div class="feature-text"><strong>Geração de prompts</strong> — 3 versões otimizadas por IA</div></div>
        <div class="feature"><div class="feature-icon">✓</div><div class="feature-text"><strong>ChatGPT, Claude, Gemini e Perplexity</strong> — funciona onde você já trabalha</div></div>
        <div class="feature"><div class="feature-icon">✓</div><div class="feature-text"><strong>Sem limite diário</strong> — use quantas vezes quiser</div></div>
      </div>
    </div>
    <div class="footer">
      <p>© 2026 Atenna Safe Prompt · <a href="https://atennaplugin.maestro-n8n.site">maestro-n8n.site</a></p>
      <p>Você está recebendo este email porque efetuou uma compra.</p>
    </div>
  </div>
</div>
</body>
</html>
```

---

## Observações importantes

### Variável `{{ .Data.name }}`
- Disponível quando o usuário cadastrou com nome (via `signUp({ data: { name: 'João' } })`)
- **Vazia** para usuários Google OAuth (o nome vem do perfil Google, não do metadata)
- Para Google, use `{{ .Data.full_name }}` como fallback: `{{if .Data.full_name}}{{.Data.full_name}}{{else if .Data.name}}{{.Data.name}}{{else}}Olá{{end}}`

### Supabase não aceita CSS externo
Todos os estilos devem ser inline ou em `<style>` no `<head>` — como está nesses templates.

### Testar antes de salvar
No dashboard, clique em **"Send test email"** após salvar para verificar a renderização.
