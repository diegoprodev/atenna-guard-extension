# Supabase Email Templates — Atenna Safe Prompt

**Onde inserir:** Supabase Dashboard → Authentication → Email Templates

Para cada template: selecione o tipo, apague o conteúdo, cole o HTML, altere o **Subject** no campo acima, clique **Save**.

---

## T1 — Confirm signup

**Subject:**
```
{{if .Data.name}}{{.Data.name}}, confirme seu email — Atenna Safe Prompt{{else}}Confirme seu email — Atenna Safe Prompt{{end}}
```

**HTML:**
```html
<!DOCTYPE html><html lang="pt-BR"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Atenna Safe Prompt</title>
<style>
  *{box-sizing:border-box;margin:0;padding:0}
  body{background:#f5f5f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;color:#111;-webkit-font-smoothing:antialiased}
  .w{background:#f5f5f5;padding:40px 16px}
  .c{max-width:520px;margin:0 auto}
  .hd{text-align:center;padding-bottom:28px}
  .hd img{height:38px;width:auto}
  .card{background:#fff;border:1px solid #e5e5e5;border-radius:12px;padding:40px 36px}
  .ico{text-align:center;font-size:44px;margin-bottom:20px}
  h1{font-size:20px;font-weight:700;color:#111;line-height:1.3;margin-bottom:14px}
  p{font-size:15px;color:#555;line-height:1.7;margin-bottom:14px}
  strong{color:#111}
  .cta{text-align:center;margin:28px 0}
  .btn{display:inline-block;background:#22c55e;color:#fff!important;padding:13px 38px;border-radius:8px;font-size:15px;font-weight:700;text-decoration:none}
  .sep{border:none;border-top:1px solid #eee;margin:24px 0}
  .note{font-size:12px;color:#999;word-break:break-all;margin-top:8px}
  .note a{color:#22c55e;text-decoration:none}
  .ft{text-align:center;padding-top:24px}
  .ft p{font-size:12px;color:#aaa;margin-bottom:3px}
  .ft a{color:#aaa;text-decoration:none}
</style></head>
<body>
<div style="display:none;max-height:0;overflow:hidden">Confirme seu email para ativar sua conta</div>
<div class="w"><div class="c">
  <div class="hd"><img src="https://atennaplugin.maestro-n8n.site/static/admin/logo.png" alt="Atenna Safe Prompt"/></div>
  <div class="card">
    <div class="ico">✉️</div>
    <h1>{{if .Data.name}}Olá, {{.Data.name}}! Confirme seu email{{else}}Confirme seu email{{end}}</h1>
    <p>{{if .Data.name}}{{.Data.name}}, clique{{else}}Clique{{end}} no botão abaixo para confirmar o endereço <strong>{{ .Email }}</strong> e ativar sua conta no Atenna Safe Prompt.</p>
    <div class="cta"><a href="{{ .ConfirmationURL }}" class="btn">Confirmar meu email →</a></div>
    <hr class="sep">
    <p style="font-size:13px;color:#999">Este link expira em <strong>24 horas</strong>. Se você não criou uma conta, ignore este email.</p>
    <p class="note">Botão não funcionou? Copie:<br><a href="{{ .ConfirmationURL }}">{{ .ConfirmationURL }}</a></p>
  </div>
  <div class="ft"><p>© 2026 Atenna Safe Prompt · <a href="https://atennaplugin.maestro-n8n.site">maestro-n8n.site</a></p><p>Você recebeu este email porque criou uma conta.</p></div>
</div></div>
</body></html>
```

---

## T2 — Reset Password

**Subject:**
```
{{if .Data.name}}{{.Data.name}}, redefina sua senha — Atenna Safe Prompt{{else}}Redefina sua senha — Atenna Safe Prompt{{end}}
```

**HTML:**
```html
<!DOCTYPE html><html lang="pt-BR"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Atenna Safe Prompt</title>
<style>
  *{box-sizing:border-box;margin:0;padding:0}
  body{background:#f5f5f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;color:#111;-webkit-font-smoothing:antialiased}
  .w{background:#f5f5f5;padding:40px 16px}
  .c{max-width:520px;margin:0 auto}
  .hd{text-align:center;padding-bottom:28px}
  .hd img{height:38px;width:auto}
  .card{background:#fff;border:1px solid #e5e5e5;border-radius:12px;padding:40px 36px}
  .ico{text-align:center;font-size:44px;margin-bottom:20px}
  h1{font-size:20px;font-weight:700;color:#111;line-height:1.3;margin-bottom:14px}
  p{font-size:15px;color:#555;line-height:1.7;margin-bottom:14px}
  strong{color:#111}
  .cta{text-align:center;margin:28px 0}
  .btn{display:inline-block;background:#22c55e;color:#fff!important;padding:13px 38px;border-radius:8px;font-size:15px;font-weight:700;text-decoration:none}
  .sep{border:none;border-top:1px solid #eee;margin:24px 0}
  .note{font-size:12px;color:#999;word-break:break-all;margin-top:8px}
  .note a{color:#22c55e;text-decoration:none}
  .ft{text-align:center;padding-top:24px}
  .ft p{font-size:12px;color:#aaa;margin-bottom:3px}
  .ft a{color:#aaa;text-decoration:none}
</style></head>
<body>
<div style="display:none;max-height:0;overflow:hidden">Redefina sua senha do Atenna Safe Prompt</div>
<div class="w"><div class="c">
  <div class="hd"><img src="https://atennaplugin.maestro-n8n.site/static/admin/logo.png" alt="Atenna Safe Prompt"/></div>
  <div class="card">
    <div class="ico">🔐</div>
    <h1>{{if .Data.name}}{{.Data.name}}, redefina sua senha{{else}}Redefina sua senha{{end}}</h1>
    <p>Recebemos um pedido de redefinição de senha para <strong>{{ .Email }}</strong>.</p>
    <div class="cta"><a href="{{ .ConfirmationURL }}" class="btn">Redefinir minha senha →</a></div>
    <hr class="sep">
    <p style="font-size:13px;color:#999">Este link expira em <strong>1 hora</strong>. Se você não solicitou isso, ignore este email — sua senha está segura.</p>
    <p class="note">Botão não funcionou? Copie:<br><a href="{{ .ConfirmationURL }}">{{ .ConfirmationURL }}</a></p>
  </div>
  <div class="ft"><p>© 2026 Atenna Safe Prompt · <a href="https://atennaplugin.maestro-n8n.site">maestro-n8n.site</a></p><p>Você recebeu este email porque tem uma conta ativa.</p></div>
</div></div>
</body></html>
```

---

## T3 — Magic Link

**Subject:**
```
{{if .Data.name}}{{.Data.name}}, seu link de acesso — Atenna Safe Prompt{{else}}Seu link de acesso — Atenna Safe Prompt{{end}}
```

**HTML:**
```html
<!DOCTYPE html><html lang="pt-BR"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Atenna Safe Prompt</title>
<style>
  *{box-sizing:border-box;margin:0;padding:0}
  body{background:#f5f5f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;color:#111;-webkit-font-smoothing:antialiased}
  .w{background:#f5f5f5;padding:40px 16px}
  .c{max-width:520px;margin:0 auto}
  .hd{text-align:center;padding-bottom:28px}
  .hd img{height:38px;width:auto}
  .card{background:#fff;border:1px solid #e5e5e5;border-radius:12px;padding:40px 36px}
  .ico{text-align:center;font-size:44px;margin-bottom:20px}
  h1{font-size:20px;font-weight:700;color:#111;line-height:1.3;margin-bottom:14px}
  p{font-size:15px;color:#555;line-height:1.7;margin-bottom:14px}
  strong{color:#111}
  .cta{text-align:center;margin:28px 0}
  .btn{display:inline-block;background:#22c55e;color:#fff!important;padding:13px 38px;border-radius:8px;font-size:15px;font-weight:700;text-decoration:none}
  .sep{border:none;border-top:1px solid #eee;margin:24px 0}
  .ft{text-align:center;padding-top:24px}
  .ft p{font-size:12px;color:#aaa;margin-bottom:3px}
  .ft a{color:#aaa;text-decoration:none}
</style></head>
<body>
<div style="display:none;max-height:0;overflow:hidden">Seu link de acesso ao Atenna Safe Prompt</div>
<div class="w"><div class="c">
  <div class="hd"><img src="https://atennaplugin.maestro-n8n.site/static/admin/logo.png" alt="Atenna Safe Prompt"/></div>
  <div class="card">
    <div class="ico">⚡</div>
    <h1>{{if .Data.name}}{{.Data.name}}, seu link de acesso{{else}}Seu link de acesso{{end}}</h1>
    <p>Use o botão abaixo para entrar com <strong>{{ .Email }}</strong>. Sem precisar de senha.</p>
    <div class="cta"><a href="{{ .ConfirmationURL }}" class="btn">Acessar agora →</a></div>
    <hr class="sep">
    <p style="font-size:13px;color:#999">Este link expira em <strong>10 minutos</strong> e só pode ser usado uma vez.</p>
  </div>
  <div class="ft"><p>© 2026 Atenna Safe Prompt · <a href="https://atennaplugin.maestro-n8n.site">maestro-n8n.site</a></p><p>Você recebeu este email porque tem uma conta ativa.</p></div>
</div></div>
</body></html>
```

---

## T4 — Invite User (pós-checkout Asaas)

**Subject:**
```
Sua conta Atenna Safe Prompt Pro foi criada 🎉
```

**HTML:**
```html
<!DOCTYPE html><html lang="pt-BR"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Atenna Safe Prompt</title>
<style>
  *{box-sizing:border-box;margin:0;padding:0}
  body{background:#f5f5f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;color:#111;-webkit-font-smoothing:antialiased}
  .w{background:#f5f5f5;padding:40px 16px}
  .c{max-width:520px;margin:0 auto}
  .hd{text-align:center;padding-bottom:28px}
  .hd img{height:38px;width:auto}
  .card{background:#fff;border:1px solid #e5e5e5;border-radius:12px;padding:40px 36px}
  .ico{text-align:center;font-size:44px;margin-bottom:20px}
  .badge{display:inline-block;background:#f0fdf4;color:#16a34a;border:1px solid #bbf7d0;border-radius:20px;padding:4px 14px;font-size:12px;font-weight:600;margin-bottom:20px}
  h1{font-size:20px;font-weight:700;color:#111;line-height:1.3;margin-bottom:14px}
  p{font-size:15px;color:#555;line-height:1.7;margin-bottom:14px}
  strong{color:#111}
  .hi{color:#16a34a;font-weight:600}
  .cta{text-align:center;margin:28px 0}
  .btn{display:inline-block;background:#22c55e;color:#fff!important;padding:13px 38px;border-radius:8px;font-size:15px;font-weight:700;text-decoration:none}
  .sep{border:none;border-top:1px solid #eee;margin:24px 0}
  .feat{display:flex;align-items:flex-start;margin-bottom:10px}
  .fi{color:#22c55e;font-size:15px;margin-right:10px;flex-shrink:0;margin-top:2px}
  .ft{font-size:14px;color:#555;line-height:1.5}
  .ft strong{color:#111}
  .footer{text-align:center;padding-top:24px}
  .footer p{font-size:12px;color:#aaa;margin-bottom:3px}
  .footer a{color:#aaa;text-decoration:none}
</style></head>
<body>
<div style="display:none;max-height:0;overflow:hidden">Sua conta Pro foi criada — bem-vindo ao Atenna Safe Prompt</div>
<div class="w"><div class="c">
  <div class="hd"><img src="https://atennaplugin.maestro-n8n.site/static/admin/logo.png" alt="Atenna Safe Prompt"/></div>
  <div class="card">
    <div class="ico">🎉</div>
    <div style="text-align:center;margin-bottom:20px"><span class="badge">✦ Plano Pro ativado</span></div>
    <h1>{{if .Data.name}}{{.Data.name}}, sua conta Pro foi criada!{{else}}Sua conta Pro foi criada!{{end}}</h1>
    <p>Seu pagamento foi confirmado. Sua conta <strong>Atenna Safe Prompt</strong> com plano <span class="hi">Pro</span> já está ativa.</p>
    <p>Defina sua senha para começar a usar:</p>
    <div class="cta"><a href="{{ .ConfirmationURL }}" class="btn">Definir minha senha →</a></div>
    <hr class="sep">
    <div>
      <div class="feat"><div class="fi">✓</div><div class="ft"><strong>Mascaramento LGPD</strong> — CPF, email, telefone e dados sensíveis protegidos</div></div>
      <div class="feat"><div class="fi">✓</div><div class="ft"><strong>Geração de prompts</strong> — 3 versões otimizadas por IA</div></div>
      <div class="feat"><div class="fi">✓</div><div class="ft"><strong>ChatGPT, Claude, Gemini e Perplexity</strong></div></div>
      <div class="feat"><div class="fi">✓</div><div class="ft"><strong>Sem limite diário</strong></div></div>
    </div>
  </div>
  <div class="footer"><p>© 2026 Atenna Safe Prompt · <a href="https://atennaplugin.maestro-n8n.site">maestro-n8n.site</a></p><p>Você recebeu este email porque efetuou uma compra.</p></div>
</div></div>
</body></html>
```

---

## Sobre o checkout de renovação (Asaas)

O campo CPF + cartão que o cliente preenche é para o **Asaas emitir o recibo** — não para o sistema identificar quem é. A identidade já está embutida: o link de renovação é gerado com `externalReference=user_id`. Quando o pagamento é confirmado, o webhook recebe esse ID e renova o Pro automaticamente. Nenhuma informação adicional é necessária.

Se o cliente já é Pro → a data `plan_expires_at` é estendida. Se é Free → promovido a Pro com nova data de vencimento.
