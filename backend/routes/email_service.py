"""
Atenna Safe Prompt — Email Service
Todos os templates HTML + funcao send_email() via Resend API.
"""
from __future__ import annotations
import os, logging, httpx
from datetime import datetime

logger = logging.getLogger(__name__)

RESEND_API_KEY = os.getenv("RESEND_API_KEY", "")
FROM_EMAIL     = os.getenv("RENEWAL_FROM_EMAIL", "Atenna Safe Prompt <noreply@pluginmail.atennaia.com.br>")
LOGO_URL       = "https://api.atennaia.com.br/static/admin/logo.png"
PRODUCT_NAME   = "Atenna Safe Prompt"
SITE_URL       = "https://api.atennaia.com.br"


# ---------------------------------------------------------------------------
# Base template — wrapper HTML com identidade visual
# ---------------------------------------------------------------------------

def _base(content: str, preheader: str = "") -> str:
    year = datetime.now().year
    return f"""<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light">
<meta name="supported-color-schemes" content="light">
<title>{PRODUCT_NAME}</title>
<!--[if mso]><noscript><xml><o:OfficeDocumentSettings><o:PixelsPerInch>96</o:PixelsPerInch></o:OfficeDocumentSettings></xml></noscript><![endif]-->
<style>
  /* Identidade visual clara — mesma do login/redefinição de senha */
  * {{ box-sizing: border-box; margin: 0; padding: 0; }}
  body {{ background: #f5f6fa; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; color: #111; -webkit-font-smoothing: antialiased; }}
  .wrapper {{ background: #f5f6fa; padding: 40px 16px; }}
  .container {{ max-width: 540px; margin: 0 auto; }}
  .header {{ text-align: center; padding-bottom: 24px; }}
  .header img {{ height: 34px; width: auto; }}
  .card {{ background: #ffffff; border: 1px solid #e8e8e8; border-radius: 14px; padding: 40px 36px; box-shadow: 0 1px 3px rgba(0,0,0,0.04); }}
  .icon-wrap {{ text-align: center; margin-bottom: 22px; }}
  .icon-wrap .icon {{ font-size: 46px; line-height: 1; }}
  h1 {{ font-size: 22px; font-weight: 800; color: #111; letter-spacing: -0.02em; line-height: 1.3; margin-bottom: 14px; }}
  p {{ font-size: 15px; color: #555; line-height: 1.7; margin-bottom: 14px; }}
  p strong, p b {{ color: #111; }}
  .highlight {{ color: #16a34a; font-weight: 700; }}
  .btn-wrap {{ text-align: center; margin: 30px 0; }}
  .btn {{ display: inline-block; background: #22c55e; color: #ffffff !important; padding: 13px 36px; border-radius: 9px; font-size: 15px; font-weight: 700; text-decoration: none; letter-spacing: -0.2px; box-shadow: 0 2px 8px rgba(34,197,94,0.28); }}
  .btn:hover {{ background: #16a34a; }}
  .btn-secondary {{ background: #ffffff; color: #444 !important; border: 1.5px solid #e5e5e5; box-shadow: none; }}
  .btn-secondary:hover {{ border-color: #22c55e; color: #16a34a !important; }}
  .divider {{ border: none; border-top: 1px solid #eee; margin: 26px 0; }}
  .features {{ margin: 22px 0; }}
  .feature {{ display: flex; align-items: flex-start; margin-bottom: 11px; }}
  .feature-icon {{ color: #16a34a; font-size: 16px; margin-right: 10px; flex-shrink: 0; margin-top: 2px; }}
  .feature-text {{ font-size: 14px; color: #555; line-height: 1.5; }}
  .feature-text strong {{ color: #111; }}
  .badge {{ display: inline-block; background: #f0fdf4; color: #16a34a; border: 1px solid #bbf7d0; border-radius: 20px; padding: 4px 13px; font-size: 12px; font-weight: 700; margin-bottom: 18px; }}
  .link-fallback {{ word-break: break-all; font-size: 12px; color: #999; margin-top: 8px; }}
  .link-fallback a {{ color: #16a34a; }}
  .fine {{ font-size: 13px; color: #999; }}
  .fine strong {{ color: #666; }}
  .footer {{ text-align: center; padding-top: 24px; }}
  .footer p {{ font-size: 12px; color: #aaa; line-height: 1.6; margin-bottom: 4px; }}
  .footer a {{ color: #aaa; text-decoration: none; }}
  .footer a:hover {{ color: #666; }}
  @media (max-width: 600px) {{
    .card {{ padding: 28px 20px; }}
    h1 {{ font-size: 20px; }}
  }}
</style>
</head>
<body>
{"" if not preheader else f'<div style="display:none;max-height:0;overflow:hidden;mso-hide:all">{preheader}&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;</div>'}
<div class="wrapper">
  <div class="container">
    <div class="header">
      <img src="{LOGO_URL}" alt="{PRODUCT_NAME}" />
    </div>
    <div class="card">
      {content}
    </div>
    <div class="footer">
      <p>© {year} {PRODUCT_NAME} · <a href="{SITE_URL}">atennaia.com.br</a></p>
      <p>Você está recebendo este email porque tem uma conta ativa.</p>
    </div>
  </div>
</div>
</body>
</html>"""


# ---------------------------------------------------------------------------
# Templates
# ---------------------------------------------------------------------------

def render_email_confirmation(confirmation_url: str, email: str) -> str:
    """T1 — Confirmação de cadastro."""
    content = f"""
<div class="icon-wrap"><div class="icon">✉️</div></div>
<h1>Confirme seu email</h1>
<p>Olá! Clique no botão abaixo para confirmar o endereço <strong>{email}</strong> e ativar sua conta no {PRODUCT_NAME}.</p>
<div class="btn-wrap">
  <a href="{confirmation_url}" class="btn">Confirmar meu email →</a>
</div>
<hr class="divider">
<p style="font-size:13px;color:#555">Este link expira em <strong style="color:#666">24 horas</strong>. Se você não criou uma conta, ignore este email.</p>
<p class="link-fallback">Se o botão não funcionar, copie este link:<br><a href="{confirmation_url}">{confirmation_url[:80]}...</a></p>
"""
    return _base(content, preheader=f"Confirme seu email para ativar sua conta no {PRODUCT_NAME}")


def render_reset_password(reset_url: str, email: str) -> str:
    """T2 — Redefinição de senha."""
    content = f"""
<div class="icon-wrap"><div class="icon">🔐</div></div>
<h1>Redefina sua senha</h1>
<p>Recebemos um pedido de redefinição de senha para <strong>{email}</strong>.</p>
<div class="btn-wrap">
  <a href="{reset_url}" class="btn">Redefinir minha senha →</a>
</div>
<hr class="divider">
<p style="font-size:13px;color:#555">Este link expira em <strong style="color:#666">1 hora</strong>. Se você não solicitou isso, sua senha continua segura — ignore este email.</p>
<p class="link-fallback">Se o botão não funcionar, copie este link:<br><a href="{reset_url}">{reset_url[:80]}...</a></p>
"""
    return _base(content, preheader="Redefina sua senha do Atenna Safe Prompt")


def render_magic_link(magic_url: str, email: str) -> str:
    """T3 — Magic link / login sem senha."""
    content = f"""
<div class="icon-wrap"><div class="icon">⚡</div></div>
<h1>Seu link de acesso</h1>
<p>Use o botão abaixo para entrar no {PRODUCT_NAME} com <strong>{email}</strong>. Sem precisar de senha.</p>
<div class="btn-wrap">
  <a href="{magic_url}" class="btn">Acessar agora →</a>
</div>
<hr class="divider">
<p style="font-size:13px;color:#555">Este link expira em <strong style="color:#666">10 minutos</strong> e só pode ser usado uma vez. Se você não solicitou acesso, ignore este email.</p>
"""
    return _base(content, preheader=f"Seu link de acesso ao {PRODUCT_NAME}")


def render_invite_checkout(email: str, plan_key: str) -> str:
    """T4 — Convite para usuário criado via checkout (pagou sem ter conta)."""
    plan_label = "Anual" if plan_key == "yearly" else "Mensal"
    content = f"""
<div class="icon-wrap"><div class="icon">🎉</div></div>
<div style="text-align:center"><span class="badge">✦ Plano Pro {plan_label} ativado</span></div>
<h1>Sua conta Pro foi criada!</h1>
<p>Seu pagamento foi confirmado e criamos sua conta <strong>{PRODUCT_NAME}</strong> com o plano <span class="highlight">Pro {plan_label}</span> já ativo.</p>
<p>Defina sua senha para acessar a plataforma e começar a usar a extensão:</p>
<div class="btn-wrap">
  <a href="{SITE_URL}" class="btn">Definir minha senha →</a>
</div>
<hr class="divider">
<div class="features">
  <div class="feature"><div class="feature-icon">✓</div><div class="feature-text"><strong>Mascaramento LGPD</strong> — proteja CPF, email, telefone e outros dados sensíveis</div></div>
  <div class="feature"><div class="feature-icon">✓</div><div class="feature-text"><strong>Geração de prompts</strong> — 3 versões otimizadas por IA</div></div>
  <div class="feature"><div class="feature-icon">✓</div><div class="feature-text"><strong>ChatGPT, Claude, Gemini e Perplexity</strong> — funciona onde você já trabalha</div></div>
  <div class="feature"><div class="feature-icon">✓</div><div class="feature-text"><strong>Sem limite diário</strong> — use quantas vezes quiser</div></div>
</div>
"""
    return _base(content, preheader=f"Sua conta Pro foi criada — bem-vindo ao {PRODUCT_NAME}")


def render_welcome(email: str) -> str:
    """L1 — Boas-vindas pós-confirmação de email."""
    content = f"""
<div class="icon-wrap"><div class="icon">🛡️</div></div>
<h1>Bem-vindo ao {PRODUCT_NAME}!</h1>
<p>Sua conta foi confirmada. Agora você tem acesso à proteção LGPD inteligente para todas as suas conversas com IA.</p>
<div class="btn-wrap">
  <a href="https://chromewebstore.google.com/search/Atenna" class="btn">Instalar extensão no Chrome →</a>
</div>
<hr class="divider">
<p><strong>Como funciona em 3 passos:</strong></p>
<div class="features" style="margin-top:16px">
  <div class="feature"><div class="feature-icon">①</div><div class="feature-text"><strong>Instale a extensão</strong> no Chrome e faça login com seu email</div></div>
  <div class="feature"><div class="feature-icon">②</div><div class="feature-text"><strong>Abra o ChatGPT, Claude ou Gemini</strong> — a extensão ativa automaticamente</div></div>
  <div class="feature"><div class="feature-icon">③</div><div class="feature-text"><strong>Digite seu prompt</strong> — o Atenna detecta e mascara dados sensíveis antes de enviar</div></div>
</div>
<hr class="divider">
<p style="font-size:13px;color:#555">Plano gratuito: 5 prompts/dia. Faça upgrade para Pro e use sem limites.</p>
"""
    return _base(content, preheader=f"Sua conta está pronta — instale a extensão e comece agora")


def render_onboarding_d1(email: str) -> str:
    """L2 — Lembrete D+1 para quem nao usou ainda."""
    content = f"""
<div class="icon-wrap"><div class="icon">🤔</div></div>
<h1>Você ainda não protegeu nenhum prompt</h1>
<p>Você criou sua conta ontem mas ainda não experimentou o {PRODUCT_NAME}. Leva menos de 2 minutos para começar.</p>
<div class="btn-wrap">
  <a href="https://chromewebstore.google.com/search/Atenna" class="btn">Instalar e experimentar →</a>
</div>
<hr class="divider">
<p><strong>O que você está perdendo:</strong></p>
<div class="features" style="margin-top:16px">
  <div class="feature"><div class="feature-icon">✓</div><div class="feature-text"><strong>Proteção automática de CPF, email e dados pessoais</strong> antes de enviar para qualquer IA</div></div>
  <div class="feature"><div class="feature-icon">✓</div><div class="feature-text"><strong>Prompts melhores</strong> — 3 versões otimizadas geradas em 1 clique</div></div>
  <div class="feature"><div class="feature-icon">✓</div><div class="feature-text"><strong>Conformidade LGPD</strong> — proteja sua empresa de vazamentos involuntários</div></div>
</div>
"""
    return _base(content, preheader="Você ainda não experimentou — leva 2 minutos para começar")


def render_upsell_free_to_pro(email: str, quota_count: int) -> str:
    """L3 — Upsell free → pro apos atingir cota."""
    content = f"""
<div class="icon-wrap"><div class="icon">🚀</div></div>
<div style="text-align:center"><span class="badge">Você já usou {quota_count} prompts este mês</span></div>
<h1>Você atingiu seu limite — hora de ir Pro</h1>
<p>Você está usando o {PRODUCT_NAME} com frequência. Com o plano Pro, você tem <strong>uso ilimitado</strong> todos os dias.</p>
<div class="features" style="margin:24px 0">
  <div class="feature"><div class="feature-icon">✓</div><div class="feature-text"><strong>Sem limite diário</strong> — gere quantos prompts precisar</div></div>
  <div class="feature"><div class="feature-icon">✓</div><div class="feature-text"><strong>API nativa Arckos</strong> — integração direta com a plataforma enterprise</div></div>
  <div class="feature"><div class="feature-icon">✓</div><div class="feature-text"><strong>Suporte prioritário</strong> por email</div></div>
</div>
<hr class="divider">
<p style="text-align:center;margin-bottom:8px"><strong>Escolha seu plano:</strong></p>
<div class="btn-wrap" style="display:flex;gap:12px;justify-content:center;flex-wrap:wrap">
  <a href="https://www.asaas.com/c/jy7seg55ba1w7d1f" class="btn btn-secondary" style="font-size:13px;padding:12px 20px">Mensal<br><span style="font-weight:400;font-size:12px">R$29,90/mês</span></a>
  <a href="https://www.asaas.com/c/48f6gz5zx2rl62d4" class="btn" style="font-size:13px;padding:12px 20px">Anual — 10x<br><span style="font-weight:400;font-size:12px">R$19,70/mês · economize 45%</span></a>
</div>
"""
    return _base(content, preheader=f"Você usou {quota_count} prompts — upgrade para Pro e use sem limites")


def render_pro_welcome(email: str, plan_key: str, expires_at: str) -> str:
    """L7 — Confirmacao de upgrade para Pro (via webhook pagamento)."""
    plan_label = "Anual" if plan_key == "yearly" else "Mensal"
    try:
        exp_dt    = datetime.fromisoformat(expires_at.replace("Z", "+00:00"))
        exp_str   = exp_dt.strftime("%d/%m/%Y")
    except Exception:
        exp_str   = expires_at[:10]
    content = f"""
<div class="icon-wrap"><div class="icon">🎉</div></div>
<div style="text-align:center"><span class="badge">✦ Plano Pro {plan_label} ativo</span></div>
<h1>Você agora é Atenna Pro!</h1>
<p>Seu pagamento foi confirmado. Seu plano <span class="highlight">Pro {plan_label}</span> está ativo até <strong>{exp_str}</strong>.</p>
<div class="features" style="margin:24px 0">
  <div class="feature"><div class="feature-icon">✓</div><div class="feature-text"><strong>Prompts ilimitados</strong> — sem restrição diária</div></div>
  <div class="feature"><div class="feature-icon">✓</div><div class="feature-text"><strong>Mascaramento LGPD avançado</strong> — proteção completa de dados sensíveis</div></div>
  <div class="feature"><div class="feature-icon">✓</div><div class="feature-text"><strong>API Arckos</strong> — acesso à plataforma enterprise</div></div>
  <div class="feature"><div class="feature-icon">✓</div><div class="feature-text"><strong>Suporte prioritário</strong> por email</div></div>
</div>
<div class="btn-wrap">
  <a href="https://chromewebstore.google.com/search/Atenna" class="btn">Abrir extensão →</a>
</div>
<hr class="divider">
<p style="font-size:13px;color:#555">Renovação automática em <strong style="color:#666">{exp_str}</strong>. Você receberá um aviso 30 dias antes.</p>
"""
    return _base(content, preheader=f"Bem-vindo ao Pro — seu acesso ilimitado está ativo")


def render_renewal(email: str, days_left: int, renewal_url: str, plan_key: str) -> str:
    """L4 — Lembrete de renovacao 30 dias antes."""
    plan_label  = "Anual" if plan_key == "yearly" else "Mensal"
    price_str   = "10x de R$19,70 no cartão" if plan_key == "yearly" else "R$29,90/mês"
    urgent = days_left <= 7
    urgency_color = "#d97706" if urgent else "#16a34a"
    badge_bg      = "#fffbeb" if urgent else "#f0fdf4"
    badge_border  = "#fde68a" if urgent else "#bbf7d0"
    content = f"""
<div class="icon-wrap"><div class="icon">{"⚠️" if urgent else "🔔"}</div></div>
<div style="text-align:center"><span class="badge" style="background:{badge_bg};color:{urgency_color};border-color:{badge_border}">Vence em {days_left} dias</span></div>
<h1>{"Urgente: sua" if days_left <= 7 else "Sua"} assinatura {PRODUCT_NAME} vence em {days_left} dias</h1>
<p>Seu plano <strong>Pro {plan_label}</strong> está expirando. Renove agora para continuar com proteção completa.</p>
<div class="btn-wrap">
  <a href="{renewal_url}" class="btn">Renovar agora — {price_str} →</a>
</div>
<hr class="divider">
<div class="features">
  <div class="feature"><div class="feature-icon">✓</div><div class="feature-text"><strong>Mascaramento LGPD</strong> mantido ativo</div></div>
  <div class="feature"><div class="feature-icon">✓</div><div class="feature-text"><strong>Prompts ilimitados</strong> sem interrupção</div></div>
  <div class="feature"><div class="feature-icon">✓</div><div class="feature-text"><strong>Após o pagamento</strong> — renovação automática em instantes</div></div>
</div>
<hr class="divider">
<p style="font-size:13px;color:#555">Se não renovar, seu acesso passa para o plano gratuito (5 prompts/dia) automaticamente.</p>
"""
    urgency = "⚠️ URGENTE — " if days_left <= 7 else ""
    return _base(content, preheader=f"{urgency}Sua assinatura {PRODUCT_NAME} vence em {days_left} dias")


def render_past_due(email: str) -> str:
    """L6 — Pagamento pendente / inadimplencia."""
    content = f"""
<div class="icon-wrap"><div class="icon">⚠️</div></div>
<h1>Problema com seu pagamento</h1>
<p>Identificamos um problema com o pagamento da sua assinatura {PRODUCT_NAME}. Sua conta ainda está ativa por alguns dias, mas você precisa regularizar para não perder o acesso.</p>
<div class="btn-wrap">
  <a href="https://www.asaas.com/c/48f6gz5zx2rl62d4" class="btn">Regularizar agora →</a>
</div>
<hr class="divider">
<p style="font-size:13px;color:#555">Após o pagamento, seu acesso é restaurado automaticamente em instantes. Em caso de dúvidas, responda este email.</p>
"""
    return _base(content, preheader="Ação necessária — regularize seu pagamento para manter o acesso")


# ---------------------------------------------------------------------------
# Funcao de envio
# ---------------------------------------------------------------------------

async def send_email(to: str, subject: str, html: str) -> bool:
    """Envia email via Resend API. Retorna True se enviado com sucesso."""
    if not RESEND_API_KEY:
        logger.warning(f"[EMAIL] No RESEND_API_KEY — skipping email to {to}")
        return False
    try:
        async with httpx.AsyncClient(timeout=10) as client:
            resp = await client.post(
                "https://api.resend.com/emails",
                headers={
                    "Authorization": f"Bearer {RESEND_API_KEY}",
                    "Content-Type":  "application/json",
                },
                json={"from": FROM_EMAIL, "to": [to], "subject": subject, "html": html},
            )
            if resp.status_code in (200, 201):
                logger.info(f"[EMAIL] Sent '{subject}' to {to}")
                return True
            logger.warning(f"[EMAIL] Resend error {resp.status_code}: {resp.text[:200]}")
    except Exception as e:
        logger.error(f"[EMAIL] Send failed to {to}: {e}")
    return False



def render_renewal_urgent(email: str, days_left: int, renewal_url: str) -> str:
    content = f"""
    <div class="icon-wrap"><span class="icon">&#9888;&#65039;</span></div>
    <div style="text-align:center"><span class="badge" style="background:#fffbeb;color:#d97706;border-color:#fde68a">Vence em {days_left} dias</span></div>
    <h1>Sua assinatura está prestes a vencer</h1>
    <p>Não deixe sua proteção expirar. Após o vencimento, seu acesso ao
      <strong>Atenna Safe Prompt Pro</strong> é suspenso e você volta ao plano gratuito
      (5 prompts/dia).</p>
    <div class="btn-wrap"><a href="{renewal_url}" class="btn">Renovar agora</a></div>
    <p class="fine">Após o pagamento, seu acesso é renovado automaticamente em instantes.</p>"""
    return _base(content, preheader=f"Sua assinatura vence em {days_left} dias — renove agora")
