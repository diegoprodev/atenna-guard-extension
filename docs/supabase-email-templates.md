# Supabase Email Templates — Atenna Safe Prompt

Cole cada HTML no dashboard:
**Supabase → Authentication → Email Templates**

## Como inserir

1. Acesse [supabase.com/dashboard](https://supabase.com/dashboard) → seu projeto
2. Vá em **Authentication → Email Templates**
3. Selecione o template (Confirm signup, Reset Password, etc.)
4. Apague o conteúdo existente, cole o HTML abaixo
5. No campo **Subject** (acima do HTML), cole o subject indicado
6. Clique **Save** → **Send test email**

> **Variáveis Supabase:** `{{ .ConfirmationURL }}`, `{{ .Email }}`, `{{ .Data.name }}` (nome do user_metadata), `{{ .Data.full_name }}` (Google OAuth)

---

## T1 — Confirm signup

**Subject:**
```
{{if .Data.name}}{{.Data.name}}, confirme seu email — Atenna Safe Prompt{{else}}Confirme seu email — Atenna Safe Prompt{{end}}
```

**HTML:**
```html
<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Atenna Safe Prompt</title>
<style>
  *{box-sizing:border-box;margin:0;padding:0}
  body{background:#0f0f0f;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;color:#f0f0f0;-webkit-font-smoothing:antialiased}
  .wrap{background:#0f0f0f;padding:40px 16px}
  .box{max-width:520px;margin:0 auto}
  .hdr{text-align:center;padding-bottom:28px}
  .hdr img{height:40px;width:auto}
  .card{background:#161616;border:1px solid #222;border-radius:14px;padding:40px 36px}
  .ico{text-align:center;font-size:44px;margin-bottom:20px}
  h1{font-size:21px;font-weight:700;color:#fff;line-height:1.3;margin-bottom:14px}
  p{font-size:15px;color:#aaa;line-height:1.7;margin-bottom:14px}
  strong{color:#f0f0f0}
  .cta{text-align:center;margin:28px 0}
  .btn{display:inline-block;background:#22c55e;color:#fff!important;padding:14px 40px;border-radius:9px;font-size:15px;font-weight:700;text-decoration:none;letter-spacing:-.2px}
  .sep{border:none;border-top:1px solid #222;margin:24px 0}
  .note{font-size:12px;color:#555;word-break:break-all;margin-top:8px}
  .note a{color:#22c55e;text-decoration:none}
  .ftr{text-align:center;padding-top:24px}
  .ftr p{font-size:12px;color:#444;line-height:1.6;margin-bottom:3px}
  .ftr a{color:#555;text-decoration:none}
</style>
</head>
<body>
<div style="display:none;max-height:0;overflow:hidden">Confirme seu email para ativar sua conta no Atenna Safe Prompt</div>
<div class="wrap"><div class="box">
  <div class="hdr">
    <img src="data:image/png;base64,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" alt="Atenna Safe Prompt" />
  </div>
  <div class="card">
    <div class="ico">✉️</div>
    <h1>{{if .Data.name}}Olá, {{.Data.name}}! Confirme seu email{{else}}Confirme seu email{{end}}</h1>
    <p>{{if .Data.name}}{{.Data.name}}, clique{{else}}Clique{{end}} no botão abaixo para confirmar o endereço <strong>{{ .Email }}</strong> e ativar sua conta.</p>
    <div class="cta"><a href="{{ .ConfirmationURL }}" class="btn">Confirmar meu email →</a></div>
    <hr class="sep">
    <p style="font-size:13px;color:#555">Este link expira em <strong style="color:#888">24 horas</strong>. Se você não criou uma conta, ignore este email.</p>
    <p class="note">Botão não funcionou? Copie o link:<br><a href="{{ .ConfirmationURL }}">{{ .ConfirmationURL }}</a></p>
  </div>
  <div class="ftr">
    <p>© 2026 Atenna Safe Prompt · <a href="https://atennaplugin.maestro-n8n.site">maestro-n8n.site</a></p>
    <p>Você recebeu este email porque criou uma conta.</p>
  </div>
</div></div>
</body>
</html>
```

---

## T2 — Reset Password

**Subject:**
```
{{if .Data.name}}{{.Data.name}}, redefina sua senha — Atenna Safe Prompt{{else}}Redefina sua senha — Atenna Safe Prompt{{end}}
```

**HTML:**
```html
<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Atenna Safe Prompt</title>
<style>
  *{box-sizing:border-box;margin:0;padding:0}
  body{background:#0f0f0f;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;color:#f0f0f0;-webkit-font-smoothing:antialiased}
  .wrap{background:#0f0f0f;padding:40px 16px}
  .box{max-width:520px;margin:0 auto}
  .hdr{text-align:center;padding-bottom:28px}
  .hdr img{height:40px;width:auto}
  .card{background:#161616;border:1px solid #222;border-radius:14px;padding:40px 36px}
  .ico{text-align:center;font-size:44px;margin-bottom:20px}
  h1{font-size:21px;font-weight:700;color:#fff;line-height:1.3;margin-bottom:14px}
  p{font-size:15px;color:#aaa;line-height:1.7;margin-bottom:14px}
  strong{color:#f0f0f0}
  .cta{text-align:center;margin:28px 0}
  .btn{display:inline-block;background:#22c55e;color:#fff!important;padding:14px 40px;border-radius:9px;font-size:15px;font-weight:700;text-decoration:none}
  .sep{border:none;border-top:1px solid #222;margin:24px 0}
  .note{font-size:12px;color:#555;word-break:break-all;margin-top:8px}
  .note a{color:#22c55e;text-decoration:none}
  .ftr{text-align:center;padding-top:24px}
  .ftr p{font-size:12px;color:#444;line-height:1.6;margin-bottom:3px}
  .ftr a{color:#555;text-decoration:none}
</style>
</head>
<body>
<div style="display:none;max-height:0;overflow:hidden">Redefina sua senha do Atenna Safe Prompt</div>
<div class="wrap"><div class="box">
  <div class="hdr">
    <img src="data:image/png;base64,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" alt="Atenna Safe Prompt" />
  </div>
  <div class="card">
    <div class="ico">🔐</div>
    <h1>{{if .Data.name}}{{.Data.name}}, redefina sua senha{{else}}Redefina sua senha{{end}}</h1>
    <p>Recebemos um pedido de redefinição de senha para <strong>{{ .Email }}</strong>.</p>
    <div class="cta"><a href="{{ .ConfirmationURL }}" class="btn">Redefinir minha senha →</a></div>
    <hr class="sep">
    <p style="font-size:13px;color:#555">Este link expira em <strong style="color:#888">1 hora</strong>. Se você não solicitou isso, sua senha continua segura — ignore este email.</p>
    <p class="note">Botão não funcionou? Copie o link:<br><a href="{{ .ConfirmationURL }}">{{ .ConfirmationURL }}</a></p>
  </div>
  <div class="ftr">
    <p>© 2026 Atenna Safe Prompt · <a href="https://atennaplugin.maestro-n8n.site">maestro-n8n.site</a></p>
    <p>Você recebeu este email porque tem uma conta ativa.</p>
  </div>
</div></div>
</body>
</html>
```

---

## T3 — Magic Link

**Subject:**
```
{{if .Data.name}}{{.Data.name}}, seu link de acesso — Atenna Safe Prompt{{else}}Seu link de acesso — Atenna Safe Prompt{{end}}
```

**HTML:**
```html
<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Atenna Safe Prompt</title>
<style>
  *{box-sizing:border-box;margin:0;padding:0}
  body{background:#0f0f0f;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;color:#f0f0f0;-webkit-font-smoothing:antialiased}
  .wrap{background:#0f0f0f;padding:40px 16px}
  .box{max-width:520px;margin:0 auto}
  .hdr{text-align:center;padding-bottom:28px}
  .hdr img{height:40px;width:auto}
  .card{background:#161616;border:1px solid #222;border-radius:14px;padding:40px 36px}
  .ico{text-align:center;font-size:44px;margin-bottom:20px}
  h1{font-size:21px;font-weight:700;color:#fff;line-height:1.3;margin-bottom:14px}
  p{font-size:15px;color:#aaa;line-height:1.7;margin-bottom:14px}
  strong{color:#f0f0f0}
  .cta{text-align:center;margin:28px 0}
  .btn{display:inline-block;background:#22c55e;color:#fff!important;padding:14px 40px;border-radius:9px;font-size:15px;font-weight:700;text-decoration:none}
  .sep{border:none;border-top:1px solid #222;margin:24px 0}
  .ftr{text-align:center;padding-top:24px}
  .ftr p{font-size:12px;color:#444;line-height:1.6;margin-bottom:3px}
  .ftr a{color:#555;text-decoration:none}
</style>
</head>
<body>
<div style="display:none;max-height:0;overflow:hidden">Seu link de acesso ao Atenna Safe Prompt</div>
<div class="wrap"><div class="box">
  <div class="hdr">
    <img src="data:image/png;base64,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" alt="Atenna Safe Prompt" />
  </div>
  <div class="card">
    <div class="ico">⚡</div>
    <h1>{{if .Data.name}}{{.Data.name}}, seu link de acesso{{else}}Seu link de acesso{{end}}</h1>
    <p>Use o botão abaixo para entrar com <strong>{{ .Email }}</strong>. Sem precisar de senha.</p>
    <div class="cta"><a href="{{ .ConfirmationURL }}" class="btn">Acessar agora →</a></div>
    <hr class="sep">
    <p style="font-size:13px;color:#555">Este link expira em <strong style="color:#888">10 minutos</strong> e só pode ser usado uma vez.</p>
  </div>
  <div class="ftr">
    <p>© 2026 Atenna Safe Prompt · <a href="https://atennaplugin.maestro-n8n.site">maestro-n8n.site</a></p>
    <p>Você recebeu este email porque tem uma conta ativa.</p>
  </div>
</div></div>
</body>
</html>
```

---

## T4 — Invite User (pós-checkout Asaas)

**Subject:**
```
Sua conta Atenna Safe Prompt Pro foi criada 🎉
```

**HTML:**
```html
<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Atenna Safe Prompt</title>
<style>
  *{box-sizing:border-box;margin:0;padding:0}
  body{background:#0f0f0f;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;color:#f0f0f0;-webkit-font-smoothing:antialiased}
  .wrap{background:#0f0f0f;padding:40px 16px}
  .box{max-width:520px;margin:0 auto}
  .hdr{text-align:center;padding-bottom:28px}
  .hdr img{height:40px;width:auto}
  .card{background:#161616;border:1px solid #222;border-radius:14px;padding:40px 36px}
  .ico{text-align:center;font-size:44px;margin-bottom:20px}
  .badge{display:inline-block;background:#0d2818;color:#22c55e;border:1px solid #1a4a2e;border-radius:20px;padding:4px 14px;font-size:12px;font-weight:600;margin-bottom:20px}
  h1{font-size:21px;font-weight:700;color:#fff;line-height:1.3;margin-bottom:14px}
  p{font-size:15px;color:#aaa;line-height:1.7;margin-bottom:14px}
  strong{color:#f0f0f0}
  .hi{color:#22c55e;font-weight:600}
  .cta{text-align:center;margin:28px 0}
  .btn{display:inline-block;background:#22c55e;color:#fff!important;padding:14px 40px;border-radius:9px;font-size:15px;font-weight:700;text-decoration:none}
  .sep{border:none;border-top:1px solid #222;margin:24px 0}
  .feat{display:flex;align-items:flex-start;margin-bottom:10px}
  .feat-i{color:#22c55e;font-size:15px;margin-right:10px;flex-shrink:0;margin-top:2px}
  .feat-t{font-size:14px;color:#aaa;line-height:1.5}
  .feat-t strong{color:#f0f0f0}
  .ftr{text-align:center;padding-top:24px}
  .ftr p{font-size:12px;color:#444;line-height:1.6;margin-bottom:3px}
  .ftr a{color:#555;text-decoration:none}
</style>
</head>
<body>
<div style="display:none;max-height:0;overflow:hidden">Sua conta Pro foi criada — bem-vindo ao Atenna Safe Prompt</div>
<div class="wrap"><div class="box">
  <div class="hdr">
    <img src="data:image/png;base64,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" alt="Atenna Safe Prompt" />
  </div>
  <div class="card">
    <div class="ico">🎉</div>
    <div style="text-align:center;margin-bottom:20px"><span class="badge">✦ Plano Pro ativado</span></div>
    <h1>{{if .Data.name}}{{.Data.name}}, sua conta Pro foi criada!{{else}}Sua conta Pro foi criada!{{end}}</h1>
    <p>Seu pagamento foi confirmado. Sua conta <strong>Atenna Safe Prompt</strong> com plano <span class="hi">Pro</span> já está ativa.</p>
    <p>Clique abaixo para definir sua senha e começar a usar:</p>
    <div class="cta"><a href="{{ .ConfirmationURL }}" class="btn">Definir minha senha →</a></div>
    <hr class="sep">
    <div>
      <div class="feat"><div class="feat-i">✓</div><div class="feat-t"><strong>Mascaramento LGPD</strong> — CPF, email, telefone e dados sensíveis protegidos</div></div>
      <div class="feat"><div class="feat-i">✓</div><div class="feat-t"><strong>Geração de prompts</strong> — 3 versões otimizadas por IA</div></div>
      <div class="feat"><div class="feat-i">✓</div><div class="feat-t"><strong>ChatGPT, Claude, Gemini e Perplexity</strong></div></div>
      <div class="feat"><div class="feat-i">✓</div><div class="feat-t"><strong>Sem limite diário</strong></div></div>
    </div>
  </div>
  <div class="ftr">
    <p>© 2026 Atenna Safe Prompt · <a href="https://atennaplugin.maestro-n8n.site">maestro-n8n.site</a></p>
    <p>Você recebeu este email porque efetuou uma compra.</p>
  </div>
</div></div>
</body>
</html>
```

---

## Como o sistema identifica quem está renovando (Asaas)

O link de renovação é gerado com `externalReference=user_id` embutido na URL do Asaas.
Quando o cliente paga, o Asaas dispara o webhook com esse ID — o backend localiza o usuário e renova o Pro automaticamente.
**O cliente não precisa preencher nada além de CPF + cartão** — a identidade já está no link.

Sobre plan changes: o webhook `_promote_to_pro()` sempre atualiza `plan_expires_at` com a nova data, independente do estado atual (Free vira Pro, Pro tem data estendida).
