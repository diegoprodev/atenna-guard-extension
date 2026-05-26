const SUPABASE_URL  = 'https://kezbssjmgwtrunqeoyir.supabase.co';
const SUPABASE_ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImtlemJzc2ptZ3d0cnVucWVveWlyIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NDcwMDQ5MTAsImV4cCI6MjA2MjU4MDkxMH0.FVTep4LmpPh2bVB5_f8CQ4JEYhoCb21mlzj3eSXJQoU';
const BFF           = 'https://atennaplugin.maestro-n8n.site';

type Tab = 'login' | 'signup' | 'forgot';
let currentTab: Tab = 'login';

// ── helpers ──────────────────────────────────────────────────────────────────
function $<T extends HTMLElement>(id: string): T {
  return document.getElementById(id) as T;
}

function setErr(msg: string) {
  const el = $('w-err');
  el.textContent = msg;
  el.style.display = msg ? '' : 'none';
}

function setInfo(msg: string) {
  const el = $('w-info');
  el.textContent = msg;
  el.style.display = msg ? '' : 'none';
}

function fieldErr(baseId: string, msg: string) {
  const errEl = $(`${baseId}-err`);
  const inp   = $<HTMLInputElement>(baseId);
  if (errEl) errEl.textContent = msg;
  if (inp && msg) { inp.classList.add('err'); inp.focus(); }
}

function clearErrors() {
  ['login-email','login-pass','signup-name','signup-email','signup-pass','forgot-email'].forEach(id => {
    const errEl = $(`${id}-err`);
    const inp   = $(id);
    if (errEl) errEl.textContent = '';
    if (inp) inp.classList.remove('err');
  });
  setErr(''); setInfo('');
}

// ── session check ────────────────────────────────────────────────────────────
function checkExistingSession() {
  try {
    chrome.storage.local.get(['atenna_session'], (res) => {
      if (chrome.runtime.lastError || !res['atenna_session']) return;
      const s = res['atenna_session'] as { token: string; expires_at: number; email: string };
      if (s.token && s.expires_at && s.expires_at > Math.floor(Date.now() / 1000)) {
        showSuccess(s.email || '');
      }
    });
  } catch { /* not in extension context */ }
}

// ── tab switching ────────────────────────────────────────────────────────────
function switchTab(tab: Tab) {
  currentTab = tab;

  const isForgot = tab === 'forgot';
  $('form-login').style.display   = tab === 'login'  ? '' : 'none';
  $('form-signup').style.display  = tab === 'signup' ? '' : 'none';
  $('form-forgot').style.display  = isForgot          ? '' : 'none';
  $('w-tabs').style.display       = isForgot ? 'none' : '';
  $('w-google-btn').style.display = isForgot ? 'none' : '';
  $('w-divider').style.display    = isForgot ? 'none' : '';
  $('tab-login').classList.toggle('active',  tab === 'login');
  $('tab-signup').classList.toggle('active', tab === 'signup');

  clearErrors();

  const titles: Record<Tab, [string, string]> = {
    login:  ['Bem-vindo de volta!', 'Entre para continuar protegendo seus dados.'],
    signup: ['Crie sua conta grátis', 'Sem cartão de crédito. Ativo em 30 segundos.'],
    forgot: ['Recuperar senha', 'Enviaremos um link para redefinir sua senha.'],
  };
  $('w-title').textContent = titles[tab][0];
  $('w-sub').textContent   = titles[tab][1];
}

// ── password toggle ───────────────────────────────────────────────────────────
function togglePass(inputId: string, btn: HTMLButtonElement) {
  const inp = $<HTMLInputElement>(inputId);
  if (!inp) return;
  const isPass = inp.type === 'password';
  inp.type = isPass ? 'text' : 'password';
  const svg = btn.querySelector('svg');
  if (!svg) return;
  svg.innerHTML = isPass
    ? '<path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94"/><path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19"/><line x1="1" y1="1" x2="23" y2="23"/>'
    : '<path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/>';
}

// ── Google OAuth ─────────────────────────────────────────────────────────────
async function loginGoogle() {
  const btn   = $<HTMLButtonElement>('w-google-btn');
  const label = $('w-google-label');
  btn.disabled = true;
  label.textContent = 'Aguarde…';
  clearErrors();
  try {
    const redirectUri = chrome.identity.getRedirectURL('auth-callback');
    const authUrl = `${SUPABASE_URL}/auth/v1/authorize?provider=google&redirect_to=${encodeURIComponent(redirectUri)}`;
    const redirectUrl = await new Promise<string | undefined>(resolve =>
      chrome.identity.launchWebAuthFlow({ url: authUrl, interactive: true }, resolve)
    );
    if (!redirectUrl) throw new Error('cancelled');
    const hash = new URLSearchParams(new URL(redirectUrl).hash.slice(1));
    const accessToken = hash.get('access_token');
    const expiresIn   = hash.get('expires_in');
    if (!accessToken) throw new Error('no_token');
    await exchangeWithBff(accessToken, expiresIn ?? '3600');
  } catch (e: unknown) {
    btn.disabled = false;
    label.textContent = 'Tentar novamente com Google';
    const msg = e instanceof Error ? e.message : '';
    if (msg !== 'cancelled') setErr('Não foi possível conectar ao Google. Tente novamente.');
  }
}

async function exchangeWithBff(accessToken: string, expiresIn: string) {
  const res = await fetch(`${BFF}/auth/me`, {
    headers: { Authorization: `Bearer ${accessToken}` }
  });
  if (!res.ok) throw new Error('bff_error');
  const me = await res.json() as { email?: string; plan?: string };
  const expiresAt = Math.floor(Date.now() / 1000) + parseInt(expiresIn, 10);
  const session = { token: accessToken, email: me.email ?? '', expires_at: expiresAt, plan: me.plan ?? 'free' };
  chrome.storage.local.set({ atenna_session: session });
  showSuccess(me.email ?? '');
}

// ── Login ────────────────────────────────────────────────────────────────────
async function submitLogin() {
  clearErrors();
  const email = ($<HTMLInputElement>('login-email')).value.trim();
  const pass  = ($<HTMLInputElement>('login-pass')).value;
  if (!email) { fieldErr('login-email', 'Informe o email'); return; }
  if (!pass)  { fieldErr('login-pass', 'Informe a senha'); return; }

  const btn = $<HTMLButtonElement>('login-btn');
  btn.disabled = true;
  btn.innerHTML = '<span class="w-spin"></span>Entrando…';

  try {
    const res  = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey: SUPABASE_ANON },
      body: JSON.stringify({ email, password: pass }),
    });
    const data = await res.json() as { access_token?: string; expires_in?: number; error_description?: string; msg?: string };
    if (!res.ok) {
      btn.disabled = false; btn.textContent = 'Entrar';
      const m = data.error_description ?? data.msg ?? '';
      if (m.includes('Invalid login') || m.includes('invalid')) setErr('Email ou senha incorretos.');
      else if (m.includes('confirm')) setErr('Confirme seu email antes de entrar. Verifique sua caixa de entrada.');
      else setErr(m || 'Erro ao entrar. Tente novamente.');
      return;
    }
    await exchangeWithBff(data.access_token!, String(data.expires_in ?? 3600));
  } catch {
    btn.disabled = false; btn.textContent = 'Entrar';
    setErr('Erro de conexão. Verifique sua internet.');
  }
}

// ── Signup ───────────────────────────────────────────────────────────────────
async function submitSignup() {
  clearErrors();
  const name  = ($<HTMLInputElement>('signup-name')).value.trim();
  const email = ($<HTMLInputElement>('signup-email')).value.trim();
  const pass  = ($<HTMLInputElement>('signup-pass')).value;
  if (!name)        { fieldErr('signup-name', 'Informe seu nome'); return; }
  if (!email)       { fieldErr('signup-email', 'Informe o email'); return; }
  if (pass.length < 6) { fieldErr('signup-pass', 'Mínimo 6 caracteres'); return; }

  const btn = $<HTMLButtonElement>('signup-btn');
  btn.disabled = true;
  btn.innerHTML = '<span class="w-spin"></span>Criando conta…';

  try {
    const res  = await fetch(`${SUPABASE_URL}/auth/v1/signup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey: SUPABASE_ANON },
      body: JSON.stringify({ email, password: pass, data: { name } }),
    });
    const data = await res.json() as { error_description?: string; msg?: string };
    if (!res.ok) {
      btn.disabled = false; btn.textContent = 'Criar conta grátis';
      const m = data.error_description ?? data.msg ?? '';
      if (m.includes('already')) setErr('Este email já está cadastrado. Tente entrar.');
      else setErr(m || 'Erro ao criar conta. Tente novamente.');
      return;
    }
    showVerify(email);
  } catch {
    btn.disabled = false; btn.textContent = 'Criar conta grátis';
    setErr('Erro de conexão. Verifique sua internet.');
  }
}

// ── Forgot password ───────────────────────────────────────────────────────────
async function submitForgot() {
  clearErrors();
  const email = ($<HTMLInputElement>('forgot-email')).value.trim();
  if (!email) { fieldErr('forgot-email', 'Informe o email'); return; }

  const btn = $<HTMLButtonElement>('forgot-btn');
  btn.disabled = true;
  btn.innerHTML = '<span class="w-spin"></span>Enviando…';

  try {
    await fetch(`${SUPABASE_URL}/auth/v1/recover`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey: SUPABASE_ANON },
      body: JSON.stringify({ email }),
    });
    btn.disabled = false; btn.textContent = 'Enviar link de redefinição';
    setInfo('Link enviado! Verifique seu email.');
  } catch {
    btn.disabled = false; btn.textContent = 'Enviar link de redefinição';
    setErr('Erro ao enviar. Tente novamente.');
  }
}

// ── show states ───────────────────────────────────────────────────────────────
function showVerify(email: string) {
  $('w-main-content').style.display = 'none';
  $('w-google-btn').style.display   = 'none';
  $('w-divider').style.display      = 'none';
  $('w-tabs').style.display         = 'none';
  $('w-verify').style.display       = '';
  $('verify-email-val').textContent  = email;
  $('w-title').textContent = 'Verifique seu email';
  $('w-sub').textContent   = 'Clique no link que enviamos para ativar sua conta.';
}

function showSuccess(email: string) {
  $('w-main-content').style.display = 'none';
  $('w-google-btn').style.display   = 'none';
  $('w-divider').style.display      = 'none';
  $('w-tabs').style.display         = 'none';
  $('w-verify').style.display       = 'none';
  $('w-success').style.display      = '';
  $('w-title').textContent = 'Proteção ativada! 🛡️';
  $('w-sub').textContent   = email ? `Logado como ${email}` : 'Sua extensão está pronta.';
}

// ── wire up all event listeners on DOMContentLoaded ─────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  checkExistingSession();

  // Tabs
  $('tab-login').addEventListener('click', () => switchTab('login'));
  $('tab-signup').addEventListener('click', () => switchTab('signup'));

  // Google
  $('w-google-btn').addEventListener('click', () => void loginGoogle());

  // Login form
  $('login-btn').addEventListener('click', () => void submitLogin());
  $<HTMLInputElement>('login-email').addEventListener('keydown', e => { if (e.key === 'Enter') void submitLogin(); });
  $<HTMLInputElement>('login-pass').addEventListener('keydown', e => { if (e.key === 'Enter') void submitLogin(); });
  $('forgot-link').addEventListener('click', () => switchTab('forgot'));

  // Password eye toggles
  $('eye-login').addEventListener('click', e => togglePass('login-pass', e.currentTarget as HTMLButtonElement));
  $('eye-signup').addEventListener('click', e => togglePass('signup-pass', e.currentTarget as HTMLButtonElement));

  // Signup form
  $('signup-btn').addEventListener('click', () => void submitSignup());
  $<HTMLInputElement>('signup-name').addEventListener('keydown', e => { if (e.key === 'Enter') void submitSignup(); });
  $<HTMLInputElement>('signup-email').addEventListener('keydown', e => { if (e.key === 'Enter') void submitSignup(); });
  $<HTMLInputElement>('signup-pass').addEventListener('keydown', e => { if (e.key === 'Enter') void submitSignup(); });
  $('to-login-link').addEventListener('click', () => switchTab('login'));
  $('to-signup-link').addEventListener('click', () => switchTab('signup'));

  // Forgot form
  $('forgot-btn').addEventListener('click', () => void submitForgot());
  $<HTMLInputElement>('forgot-email').addEventListener('keydown', e => { if (e.key === 'Enter') void submitForgot(); });
  $('back-to-login').addEventListener('click', () => switchTab('login'));

  // Verify back
  $('verify-back').addEventListener('click', () => switchTab('login'));
});
