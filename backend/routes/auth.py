import os
from fastapi import APIRouter
from fastapi.responses import HTMLResponse

router = APIRouter(prefix="/auth", tags=["Auth"])

SUPABASE_URL = os.getenv("SUPABASE_URL", "")
SUPABASE_ANON_KEY = os.getenv("SUPABASE_ANON_KEY", "")


@router.get("/callback", response_class=HTMLResponse)
async def auth_callback():
    """
    Callback universal do Supabase.

    Dois modos:
    - `?token_hash=...&type=recovery` (query) → fluxo PKCE-like: mostra um botão e só
      chama /auth/v1/verify no CLIQUE do usuário. Isso evita que scanners de e-mail
      (Gmail/antivírus) consumam o token de uso único ("link expirado").
    - `#access_token=...&type=...` (hash fragment) → fluxo legado (magic link direto).
    """
    return f"""<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Atenna — Verificando acesso</title>
  <style>
    *{{margin:0;padding:0;box-sizing:border-box}}
    body{{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh;background:linear-gradient(135deg,#667eea 0%,#764ba2 100%)}}
    .box{{background:#fff;border-radius:14px;padding:40px 36px;text-align:center;max-width:420px;width:90%;box-shadow:0 20px 60px rgba(0,0,0,.3)}}
    .spinner{{width:38px;height:38px;border:3px solid #f0f0f0;border-top:3px solid #22c55e;border-radius:50%;animation:spin 1s linear infinite;margin:0 auto 16px}}
    @keyframes spin{{to{{transform:rotate(360deg)}}}}
    h1{{font-size:22px;color:#111;margin-bottom:8px}}
    p{{color:#666;font-size:14px;line-height:1.5;margin-bottom:12px}}
    .hidden{{display:none!important}}
    .form-group{{text-align:left;margin-bottom:14px}}
    label{{font-size:13px;font-weight:500;color:#333;display:block;margin-bottom:4px}}
    input[type=password]{{width:100%;padding:10px 12px;border:1.5px solid #ddd;border-radius:8px;font-size:14px;outline:none;transition:border-color .2s}}
    input[type=password]:focus{{border-color:#667eea}}
    .btn{{display:inline-block;width:100%;padding:12px;background:#667eea;color:#fff;border:none;border-radius:8px;font-size:15px;font-weight:600;cursor:pointer;margin-top:4px;transition:background .2s}}
    .btn:hover{{background:#5a6fd6}}
    .btn:disabled{{opacity:.6;cursor:not-allowed}}
    .err{{color:#ef4444;font-size:13px;margin-top:8px;text-align:left}}
    .ok-icon{{font-size:40px;margin-bottom:12px}}
    .countdown{{font-size:12px;color:#999;margin-top:14px}}
    .strength{{height:4px;border-radius:2px;background:#f0f0f0;margin:6px 0 0;overflow:hidden}}
    .strength-bar{{height:100%;width:0;border-radius:2px;transition:width .3s,background .3s}}
  </style>
</head>
<body>
<div class="box">
  <div id="v-loading">
    <div class="spinner"></div>
    <h1>Verificando…</h1>
    <p>Aguarde um instante.</p>
  </div>

  <!-- Recovery: passo 1 — confirmar (evita consumo por scanner) -->
  <div id="v-confirm" class="hidden">
    <div class="ok-icon">🔑</div>
    <h1>Redefinir senha</h1>
    <p>Clique abaixo para continuar a redefinição da senha da sua conta Atenna.</p>
    <button type="button" class="btn" id="confirmBtn">Continuar</button>
    <div class="err hidden" id="confirmErr"></div>
  </div>

  <!-- Recovery: passo 2 — nova senha -->
  <div id="v-reset" class="hidden">
    <div class="ok-icon">🔑</div>
    <h1>Criar nova senha</h1>
    <p>Digite sua nova senha para redefinir o acesso à sua conta Atenna.</p>
    <form id="resetForm">
      <div class="form-group">
        <label for="pw1">Nova senha</label>
        <input type="password" id="pw1" placeholder="Mínimo 8 caracteres" autocomplete="new-password"/>
        <div class="strength"><div class="strength-bar" id="sbar"></div></div>
      </div>
      <div class="form-group">
        <label for="pw2">Confirmar senha</label>
        <input type="password" id="pw2" placeholder="Repita a senha" autocomplete="new-password"/>
      </div>
      <div class="err hidden" id="formErr"></div>
      <button type="submit" class="btn" id="submitBtn">Redefinir senha</button>
    </form>
  </div>

  <div id="v-success" class="hidden">
    <div class="ok-icon">✨</div>
    <h1>Acesso confirmado!</h1>
    <p>Você pode fechar esta aba e retornar à extensão.</p>
    <div class="countdown">Encerrando em <span id="cd-success">5</span>s…</div>
  </div>

  <div id="v-reset-ok" class="hidden">
    <div class="ok-icon">✅</div>
    <h1>Senha redefinida!</h1>
    <p>Sua senha foi atualizada. Volte à extensão e faça login com a nova senha.</p>
    <div class="countdown">Encerrando em <span id="cd-reset">5</span>s…</div>
  </div>

  <div id="v-error" class="hidden">
    <div class="ok-icon">⚠️</div>
    <h1>Link inválido ou expirado</h1>
    <p id="err-msg">Solicite um novo link de redefinição na extensão.</p>
  </div>
</div>

<script>
  const SUPABASE_URL = {repr(SUPABASE_URL)};
  const SUPABASE_ANON_KEY = {repr(SUPABASE_ANON_KEY)};

  const show = id => document.querySelectorAll('[id^="v-"]').forEach(el => el.classList[el.id===id?'remove':'add']('hidden'));
  const err  = msg => {{ show('v-error'); document.getElementById('err-msg').textContent = msg||'Solicite um novo link.'; }};

  function countdown(elId, secs) {{
    const el = document.getElementById(elId);
    const t = setInterval(()=>{{ secs--; el.textContent=Math.max(0,secs); if(secs<=0){{clearInterval(t);window.close();}} }},1000);
  }}
  function notifyExtension(access_token, refresh_token, expires_in) {{
    if (window.opener) window.opener.postMessage({{type:'ATENNA_AUTH_SUCCESS',access_token,refresh_token,expires_in}}, '*');
  }}

  document.getElementById('pw1')?.addEventListener('input', e => {{
    const v = e.target.value; let s = 0;
    if(v.length>=8) s+=25; if(/[A-Z]/.test(v)) s+=25; if(/[0-9]/.test(v)) s+=25; if(/[^A-Za-z0-9]/.test(v)) s+=25;
    const bar = document.getElementById('sbar');
    bar.style.width = s+'%';
    bar.style.background = s<=25?'#ef4444':s<=50?'#f59e0b':s<=75?'#3b82f6':'#22c55e';
  }});

  async function verifyTokenHash(token_hash) {{
    const res = await fetch(SUPABASE_URL+'/auth/v1/verify', {{
      method: 'POST',
      headers: {{'Content-Type':'application/json','apikey':SUPABASE_ANON_KEY}},
      body: JSON.stringify({{type:'recovery', token_hash}}),
    }});
    if(!res.ok) {{
      const d = await res.json().catch(()=>({{}}));
      throw new Error(d.msg || d.error_description || d.message || 'expirado');
    }}
    return res.json();
  }}

  document.getElementById('confirmBtn')?.addEventListener('click', async () => {{
    const btn = document.getElementById('confirmBtn');
    btn.disabled = true; btn.textContent = 'Verificando…';
    try {{
      const s = await verifyTokenHash(window._tokenHash);
      window._recoveryToken = s.access_token;
      window._recoveryRefresh = s.refresh_token;
      show('v-reset');
    }} catch(ex) {{
      err('Este link expirou ou já foi usado. Solicite um novo na extensão.');
    }}
  }});

  document.getElementById('resetForm')?.addEventListener('submit', async e => {{
    e.preventDefault();
    const pw1 = document.getElementById('pw1').value, pw2 = document.getElementById('pw2').value;
    const formErr = document.getElementById('formErr');
    if(pw1.length < 8) {{ formErr.textContent='Senha deve ter pelo menos 8 caracteres.'; formErr.classList.remove('hidden'); return; }}
    if(pw1 !== pw2) {{ formErr.textContent='As senhas não coincidem.'; formErr.classList.remove('hidden'); return; }}
    formErr.classList.add('hidden');
    const btn = document.getElementById('submitBtn');
    btn.disabled = true; btn.textContent = 'Salvando…';
    try {{
      const res = await fetch(SUPABASE_URL+'/auth/v1/user', {{
        method: 'PUT',
        headers: {{'Content-Type':'application/json','apikey':SUPABASE_ANON_KEY,'Authorization':'Bearer '+window._recoveryToken}},
        body: JSON.stringify({{password: pw1}}),
      }});
      if(!res.ok) {{ const d = await res.json().catch(()=>({{}})); throw new Error(d.msg || d.message || 'Erro ao atualizar senha.'); }}
      show('v-reset-ok');
      countdown('cd-reset', 5);
    }} catch(ex) {{
      formErr.textContent = ex.message || 'Erro ao salvar. Tente novamente.';
      formErr.classList.remove('hidden');
      btn.disabled=false; btn.textContent='Redefinir senha';
    }}
  }});

  (function() {{
    const q = new URLSearchParams(window.location.search);
    const h = new URLSearchParams(window.location.hash.substring(1));

    // Modo novo: ?token_hash=...&type=recovery  → botão, verify só no clique
    const th = q.get('token_hash');
    if (th && q.get('type') === 'recovery') {{
      window._tokenHash = th;
      show('v-confirm');
      return;
    }}

    // Modo legado: #access_token=...
    const error = h.get('error');
    if(error) {{ err(h.get('error_description')||error); return; }}
    const access_token = h.get('access_token');
    if(!access_token) {{ err('Link inválido. Solicite um novo na extensão.'); return; }}
    if(h.get('type') === 'recovery') {{
      window._recoveryToken = access_token;
      window._recoveryRefresh = h.get('refresh_token');
      show('v-reset');
    }} else {{
      notifyExtension(access_token, h.get('refresh_token'), h.get('expires_in'));
      show('v-success');
      countdown('cd-success', 5);
    }}
  }})();
</script>
</body>
</html>"""
