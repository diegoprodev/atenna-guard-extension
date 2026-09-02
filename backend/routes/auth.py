import os
from fastapi import APIRouter
from fastapi.responses import HTMLResponse

router = APIRouter(prefix="/auth", tags=["Auth"])

SUPABASE_URL = os.getenv("SUPABASE_URL", "")
SUPABASE_ANON_KEY = os.getenv("SUPABASE_ANON_KEY", "")
LOGO_URL = "https://api.atennaia.com.br/static/admin/logo.png"

_EYE = ('<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" '
        'stroke-width="2" stroke-linecap="round" stroke-linejoin="round">'
        '<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z"/><circle cx="12" cy="12" r="3"/></svg>')
_EYE_OFF = ('<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" '
            'stroke-width="2" stroke-linecap="round" stroke-linejoin="round">'
            '<path d="M9.9 4.24A9.1 9.1 0 0 1 12 4c6.5 0 10 8 10 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/>'
            '<path d="M1 1l22 22"/><path d="M4.6 4.6C2.5 6.2 1 12 1 12s3.5 7 10 7a9.7 9.7 0 0 0 5.4-1.6"/></svg>')


@router.get("/callback", response_class=HTMLResponse)
async def auth_callback():
    """
    Callback do Supabase — redefinição de senha e confirmação de login.

    - `?token_hash=...&type=recovery` (query) → fluxo à prova de scanner: mostra um
      botão e só chama /auth/v1/verify no CLIQUE (scanners de e-mail que fazem GET
      não consomem o token de uso único → sem "link expirado").
    - `#access_token=...` (hash) → fluxo legado (magic link direto).
    """
    return f"""<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta name="robots" content="noindex,nofollow">
<title>Atenna Safe Prompt — Redefinir senha</title>
<style>
  *{{box-sizing:border-box;margin:0;padding:0}}
  html,body{{height:100%;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;background:#f5f6fa;color:#111}}
  .root{{display:flex;min-height:100vh}}

  /* ── LEFT: brand panel ── */
  .left{{
    flex:0 0 400px;position:relative;overflow:hidden;color:#fff;
    background:linear-gradient(150deg,#16a34a 0%,#15803d 50%,#14532d 100%);
    display:flex;flex-direction:column;justify-content:space-between;padding:40px 44px;
  }}
  .wm{{position:absolute;bottom:-130px;right:-130px;width:520px;height:520px;opacity:.07;
    background:url('{LOGO_URL}') center/contain no-repeat;filter:brightness(10);pointer-events:none}}
  .brand{{display:flex;align-items:center;gap:12px;position:relative;z-index:1}}
  .brand img{{width:42px;height:42px;border-radius:11px;background:#fff;padding:4px}}
  .brand b{{font-size:16px;font-weight:800;letter-spacing:-.02em;display:block}}
  .brand span{{font-size:10px;opacity:.7;letter-spacing:.05em;text-transform:uppercase}}
  .pitch{{position:relative;z-index:1}}
  .pitch h2{{font-size:24px;font-weight:800;line-height:1.2;letter-spacing:-.03em;margin-bottom:12px}}
  .pitch h2 em{{font-style:normal;color:#bbf7d0}}
  .pitch p{{font-size:13px;opacity:.82;line-height:1.65;max-width:280px}}
  .foot{{position:relative;z-index:1;font-size:11px;opacity:.55}}

  /* ── RIGHT: form panel ── */
  .right{{flex:1;display:flex;align-items:center;justify-content:center;padding:40px 32px;background:#fff}}
  .card{{width:100%;max-width:360px}}
  .hidden{{display:none!important}}

  .ico{{font-size:40px;margin-bottom:14px}}
  h1{{font-size:22px;font-weight:800;color:#111;letter-spacing:-.03em;margin-bottom:6px}}
  .sub{{font-size:13px;color:#888;line-height:1.55;margin-bottom:22px}}

  .field{{margin-bottom:14px}}
  .field label{{display:block;font-size:12px;font-weight:600;color:#444;margin-bottom:5px}}
  .pw-wrap{{position:relative}}
  .field input{{width:100%;padding:11px 42px 11px 13px;border:1.5px solid #e5e5e5;border-radius:8px;
    font-family:inherit;font-size:14px;color:#111;outline:none;transition:border-color .14s,box-shadow .14s}}
  .field input:focus{{border-color:#22c55e;box-shadow:0 0 0 3px rgba(34,197,94,.08)}}
  .field input.bad{{border-color:#ef4444}}
  .field input.good{{border-color:#22c55e}}
  .eye{{position:absolute;right:10px;top:50%;transform:translateY(-50%);background:none;border:none;
    cursor:pointer;color:#bbb;display:flex;padding:4px}}
  .eye:hover{{color:#555}}
  .ferr{{font-size:11px;color:#ef4444;margin-top:4px;min-height:14px}}
  .fok{{font-size:11px;color:#16a34a;margin-top:4px;min-height:14px}}

  .strength{{height:4px;border-radius:2px;background:#f0f0f0;margin:6px 0 2px;overflow:hidden}}
  .strength-bar{{height:100%;width:0;border-radius:2px;transition:width .3s,background .3s}}
  .req{{font-size:11px;color:#999;line-height:1.7;margin-top:2px}}
  .req span{{display:inline-block;margin-right:10px}}
  .req span.ok{{color:#16a34a}}
  .req span.ok::before{{content:'✓ '}}
  .req span::before{{content:'• '}}

  .btn{{width:100%;padding:12px;border:none;border-radius:9px;background:#22c55e;color:#fff;
    font-family:inherit;font-size:14px;font-weight:700;cursor:pointer;
    transition:background .13s,transform .13s;box-shadow:0 2px 8px rgba(34,197,94,.28)}}
  .btn:hover:not(:disabled){{background:#16a34a;transform:translateY(-1px)}}
  .btn:disabled{{background:#d1d5db;color:#9ca3af;box-shadow:none;cursor:not-allowed;transform:none}}
  .spin{{display:inline-block;width:14px;height:14px;border:2px solid rgba(255,255,255,.35);
    border-top-color:#fff;border-radius:50%;animation:s .7s linear infinite;vertical-align:middle;margin-right:7px}}
  @keyframes s{{to{{transform:rotate(360deg)}}}}

  .alert{{padding:10px 13px;border-radius:8px;font-size:13px;margin-bottom:16px}}
  .alert.err{{background:#fff5f5;border:1px solid #fecaca;color:#dc2626}}

  .state{{text-align:center}}
  .state p{{font-size:13px;color:#555;line-height:1.6;margin-bottom:8px}}
  .muted{{font-size:12px;color:#aaa;margin-top:12px}}

  @media (max-width:820px){{ .left{{display:none}} .right{{padding:28px 20px}} }}
</style>
</head>
<body>
<div class="root">
  <div class="left">
    <div class="wm"></div>
    <div class="brand">
      <img src="{LOGO_URL}" alt="Atenna">
      <div><b>Atenna Safe Prompt</b><span>Proteção de dados em IA</span></div>
    </div>
    <div class="pitch">
      <h2>Sua conta,<br><em>sua segurança</em>.</h2>
      <p>Defina uma nova senha para voltar a proteger seus dados sensíveis no ChatGPT, Claude, Gemini e Perplexity.</p>
    </div>
    <div class="foot">© 2026 Atenna Safe Prompt · atennaia.com.br</div>
  </div>

  <div class="right">
    <div class="card">

      <div id="v-loading" class="state">
        <div class="ico">🔒</div><h1>Verificando…</h1><p class="sub">Aguarde um instante.</p>
      </div>

      <div id="v-confirm" class="hidden">
        <div class="ico">🔑</div>
        <h1>Redefinir senha</h1>
        <p class="sub">Confirme para continuar a redefinição da senha da sua conta Atenna.</p>
        <button type="button" class="btn" id="confirmBtn">Continuar</button>
      </div>

      <div id="v-reset" class="hidden">
        <div class="ico">🔑</div>
        <h1>Criar nova senha</h1>
        <p class="sub">Escolha uma senha forte. Você vai usá-la para entrar na extensão.</p>
        <form id="resetForm" novalidate>
          <div class="field">
            <label for="pw1">Nova senha</label>
            <div class="pw-wrap">
              <input type="password" id="pw1" placeholder="Mínimo 8 caracteres" autocomplete="new-password">
              <button type="button" class="eye" id="eye1" aria-label="Mostrar senha">{_EYE}</button>
            </div>
            <div class="strength"><div class="strength-bar" id="sbar"></div></div>
            <div class="req" id="req">
              <span id="r-len">8+ caracteres</span><span id="r-upper">1 maiúscula</span>
              <span id="r-num">1 número</span>
            </div>
          </div>
          <div class="field">
            <label for="pw2">Confirmar senha</label>
            <div class="pw-wrap">
              <input type="password" id="pw2" placeholder="Repita a senha" autocomplete="new-password">
              <button type="button" class="eye" id="eye2" aria-label="Mostrar senha">{_EYE}</button>
            </div>
            <div class="ferr" id="matchErr"></div>
          </div>
          <div class="ferr" id="formErr"></div>
          <button type="submit" class="btn" id="submitBtn" disabled>Redefinir senha</button>
        </form>
      </div>

      <div id="v-reset-ok" class="hidden state">
        <div class="ico">✅</div>
        <h1>Senha redefinida!</h1>
        <p>Volte à extensão e faça login com a sua nova senha.</p>
        <div class="muted">Pode fechar esta aba.</div>
      </div>

      <div id="v-success" class="hidden state">
        <div class="ico">✨</div>
        <h1>Acesso confirmado</h1>
        <p>Você pode fechar esta aba e retornar à extensão.</p>
      </div>

      <div id="v-error" class="hidden state">
        <div class="alert err" id="err-msg">Este link expirou ou já foi usado.</div>
        <p>Abra a extensão, clique em <strong>“Esqueci a senha”</strong> e use o link mais recente do e-mail.</p>
      </div>

    </div>
  </div>
</div>

<script>
  const SUPABASE_URL = {repr(SUPABASE_URL)};
  const SUPABASE_ANON_KEY = {repr(SUPABASE_ANON_KEY)};
  const EYE = {repr(_EYE)}, EYE_OFF = {repr(_EYE_OFF)};

  const $ = id => document.getElementById(id);
  const show = id => document.querySelectorAll('[id^="v-"]').forEach(el => el.classList[el.id===id?'remove':'add']('hidden'));
  const err  = msg => {{ show('v-error'); if(msg) $('err-msg').textContent = msg; }};

  function toggleEye(inputId, btnId) {{
    $(btnId).addEventListener('click', () => {{
      const i = $(inputId), showing = i.type === 'text';
      i.type = showing ? 'password' : 'text';
      $(btnId).innerHTML = showing ? EYE : EYE_OFF;
    }});
  }}
  toggleEye('pw1','eye1'); toggleEye('pw2','eye2');

  function validate() {{
    const p1 = $('pw1').value, p2 = $('pw2').value;
    const len = p1.length >= 8, upper = /[A-Z]/.test(p1), num = /[0-9]/.test(p1);
    $('r-len').classList.toggle('ok', len);
    $('r-upper').classList.toggle('ok', upper);
    $('r-num').classList.toggle('ok', num);

    let s = 0;
    if(len) s+=25; if(upper) s+=25; if(num) s+=25; if(/[^A-Za-z0-9]/.test(p1)) s+=25;
    const bar = $('sbar');
    bar.style.width = s+'%';
    bar.style.background = s<=25?'#ef4444':s<=50?'#f59e0b':s<=75?'#3b82f6':'#22c55e';

    const match = p2.length > 0 && p1 === p2;
    if(p2.length === 0) {{ $('matchErr').textContent=''; $('pw2').classList.remove('bad','good'); }}
    else if(match) {{ $('matchErr').textContent=''; $('pw2').classList.remove('bad'); $('pw2').classList.add('good'); }}
    else {{ $('matchErr').textContent='As senhas não coincidem.'; $('pw2').classList.remove('good'); $('pw2').classList.add('bad'); }}

    $('submitBtn').disabled = !(len && upper && num && match);
  }}
  $('pw1').addEventListener('input', validate);
  $('pw2').addEventListener('input', validate);

  async function verifyTokenHash(token_hash) {{
    const r = await fetch(SUPABASE_URL+'/auth/v1/verify', {{
      method:'POST', headers:{{'Content-Type':'application/json','apikey':SUPABASE_ANON_KEY}},
      body: JSON.stringify({{type:'recovery', token_hash}}),
    }});
    if(!r.ok) throw new Error((await r.json().catch(()=>({{}}))).msg || 'expirado');
    return r.json();
  }}

  $('confirmBtn')?.addEventListener('click', async () => {{
    const b = $('confirmBtn'); b.disabled = true; b.innerHTML = '<span class="spin"></span>Verificando…';
    try {{
      const sess = await verifyTokenHash(window._th);
      window._rt = sess.access_token;
      show('v-reset'); $('pw1').focus();
    }} catch {{ err('Este link expirou ou já foi usado.'); }}
  }});

  $('resetForm')?.addEventListener('submit', async e => {{
    e.preventDefault();
    validate();
    if($('submitBtn').disabled) return;
    const b = $('submitBtn'); b.disabled = true; b.innerHTML = '<span class="spin"></span>Salvando…';
    try {{
      const r = await fetch(SUPABASE_URL+'/auth/v1/user', {{
        method:'PUT',
        headers:{{'Content-Type':'application/json','apikey':SUPABASE_ANON_KEY,'Authorization':'Bearer '+window._rt}},
        body: JSON.stringify({{password: $('pw1').value}}),
      }});
      if(!r.ok) throw new Error((await r.json().catch(()=>({{}}))).msg || 'Erro ao salvar a senha.');
      show('v-reset-ok');
    }} catch(ex) {{
      $('formErr').textContent = ex.message || 'Erro ao salvar. Tente novamente.';
      b.disabled = false; b.textContent = 'Redefinir senha';
    }}
  }});

  (function() {{
    const q = new URLSearchParams(location.search);
    const h = new URLSearchParams(location.hash.substring(1));
    if (q.get('token_hash') && q.get('type') === 'recovery') {{
      window._th = q.get('token_hash'); show('v-confirm'); return;
    }}
    if (h.get('error')) {{ err(h.get('error_description') || h.get('error')); return; }}
    const at = h.get('access_token');
    if (!at) {{ err('Link inválido. Solicite um novo na extensão.'); return; }}
    if (h.get('type') === 'recovery') {{ window._rt = at; show('v-reset'); $('pw1').focus(); }}
    else {{
      if (window.opener) window.opener.postMessage({{type:'ATENNA_AUTH_SUCCESS',access_token:at,refresh_token:h.get('refresh_token'),expires_in:h.get('expires_in')}}, '*');
      show('v-success');
    }}
  }})();
</script>
</body>
</html>"""
