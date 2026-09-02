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
    - type=recovery  → exibe formulário de nova senha
    - qualquer outro → confirma login e fecha a aba
    Tokens chegam sempre como hash fragment (#access_token=...) nunca como query param.
    """
    supabase_url = SUPABASE_URL
    supabase_anon_key = SUPABASE_ANON_KEY

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
    /* Reset form */
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
  <!-- Loading -->
  <div id="v-loading">
    <div class="spinner"></div>
    <h1>Verificando…</h1>
    <p>Aguarde um instante.</p>
  </div>

  <!-- Recovery: nova senha -->
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

  <!-- Login confirmado -->
  <div id="v-success" class="hidden">
    <div class="ok-icon">✨</div>
    <h1>Acesso confirmado!</h1>
    <p>Você pode fechar esta aba e retornar à extensão.</p>
    <div class="countdown">Encerrando em <span id="cd-success">5</span>s…</div>
  </div>

  <!-- Senha redefinida -->
  <div id="v-reset-ok" class="hidden">
    <div class="ok-icon">✅</div>
    <h1>Senha redefinida!</h1>
    <p>Sua senha foi atualizada. Você já está conectado.</p>
    <p>Pode fechar esta aba e retornar à extensão.</p>
    <div class="countdown">Encerrando em <span id="cd-reset">5</span>s…</div>
  </div>

  <!-- Erro -->
  <div id="v-error" class="hidden">
    <div class="ok-icon">⚠️</div>
    <h1>Erro</h1>
    <p id="err-msg">Tente novamente.</p>
    <p style="font-size:13px;color:#999">Feche esta aba e tente novamente na extensão.</p>
  </div>
</div>

<script>
  const SUPABASE_URL = {repr(supabase_url)};
  const SUPABASE_ANON_KEY = {repr(supabase_anon_key)};

  const show = id => document.querySelectorAll('[id^="v-"]').forEach(el => el.classList[el.id===id?'remove':'add']('hidden'));
  const err  = msg => {{ show('v-error'); document.getElementById('err-msg').textContent = msg||'Erro desconhecido.'; }};

  function countdown(elId, secs) {{
    const el = document.getElementById(elId);
    const t = setInterval(()=>{{ secs--; el.textContent=Math.max(0,secs); if(secs<=0){{clearInterval(t);window.close();}} }},1000);
  }}

  function notifyExtension(access_token, refresh_token, expires_in) {{
    if (window.opener) {{
      window.opener.postMessage({{type:'ATENNA_AUTH_SUCCESS',access_token,refresh_token,expires_in}}, '*');
    }}
  }}

  // Strength bar
  document.getElementById('pw1')?.addEventListener('input', e => {{
    const v = e.target.value;
    let s = 0;
    if(v.length>=8) s+=25;
    if(/[A-Z]/.test(v)) s+=25;
    if(/[0-9]/.test(v)) s+=25;
    if(/[^A-Za-z0-9]/.test(v)) s+=25;
    const bar = document.getElementById('sbar');
    bar.style.width = s+'%';
    bar.style.background = s<=25?'#ef4444':s<=50?'#f59e0b':s<=75?'#3b82f6':'#22c55e';
  }});

  // Password reset submit
  document.getElementById('resetForm')?.addEventListener('submit', async e => {{
    e.preventDefault();
    const pw1 = document.getElementById('pw1').value;
    const pw2 = document.getElementById('pw2').value;
    const formErr = document.getElementById('formErr');

    if(pw1.length < 8) {{ formErr.textContent='Senha deve ter pelo menos 8 caracteres.'; formErr.classList.remove('hidden'); return; }}
    if(pw1 !== pw2) {{ formErr.textContent='As senhas não coincidem.'; formErr.classList.remove('hidden'); return; }}
    formErr.classList.add('hidden');

    const btn = document.getElementById('submitBtn');
    btn.disabled = true; btn.textContent = 'Salvando…';

    try {{
      const res = await fetch(SUPABASE_URL+'/auth/v1/user', {{
        method: 'PUT',
        headers: {{
          'Content-Type': 'application/json',
          'apikey': SUPABASE_ANON_KEY,
          'Authorization': 'Bearer '+window._recoveryToken,
        }},
        body: JSON.stringify({{password: pw1}}),
      }});
      if(!res.ok) {{
        const d = await res.json().catch(()=>({{}}));
        throw new Error(d.msg || d.message || 'Erro ao atualizar senha.');
      }}
      notifyExtension(window._recoveryToken, window._recoveryRefresh, 3600);
      show('v-reset-ok');
      countdown('cd-reset', 5);
    }} catch(ex) {{
      formErr.textContent = ex.message || 'Erro ao salvar. Tente novamente.';
      formErr.classList.remove('hidden');
      btn.disabled=false; btn.textContent='Redefinir senha';
    }}
  }});

  // Parse hash
  (function() {{
    const hash = window.location.hash.substring(1);
    const p = new URLSearchParams(hash);
    const access_token = p.get('access_token');
    const refresh_token = p.get('refresh_token');
    const expires_in = p.get('expires_in');
    const type = p.get('type');
    const error = p.get('error');
    const error_desc = p.get('error_description');

    if(error) {{ err(error_desc||error); return; }}
    if(!access_token) {{ err('Token não recebido. Tente novamente na extensão.'); return; }}

    if(type === 'recovery') {{
      window._recoveryToken = access_token;
      window._recoveryRefresh = refresh_token;
      show('v-reset');
    }} else {{
      notifyExtension(access_token, refresh_token, expires_in);
      show('v-success');
      countdown('cd-success', 5);
    }}
  }})();
</script>
</body>
</html>"""
