import { bffLogin, bffGoogleLogin, bffResetPassword } from '../auth/bffClient';
import { getSession } from '../auth/sessionManager';
import { AppError, E } from '../core/errors';

// ── helpers ──────────────────────────────────────────────────────────────────
function $<T extends HTMLElement = HTMLElement>(id: string): T {
  return document.getElementById(id) as T;
}
function setErr(msg: string)  { const el = $('w-err');  el.textContent = msg; el.style.display = msg ? '' : 'none'; }
function setInfo(msg: string) { const el = $('w-info'); el.textContent = msg; el.style.display = msg ? '' : 'none'; }

function clearErrors() {
  ['login-email','login-pass','signup-name','signup-email','signup-pass','forgot-email'].forEach(id => {
    const e = $(`${id}-err`); if (e) e.textContent = '';
    const i = $(id); if (i) i.classList.remove('err');
  });
  setErr(''); setInfo('');
}

function fieldErr(id: string, msg: string) {
  const e = $(`${id}-err`); if (e) e.textContent = msg;
  const i = $(id); if (i && msg) { i.classList.add('err'); i.focus(); }
}

function errMsg(err: unknown): string {
  if (err instanceof AppError) {
    if (err.code === E.INVALID_CREDENTIALS) return 'Email ou senha incorretos.';
    if (err.code === E.SESSION_EXPIRED)     return 'Sessão expirada. Faça login novamente.';
    if (err.code === E.NETWORK)             return 'Erro de conexão. Verifique sua internet.';
    if (err.code === E.RATE_LIMIT)          return 'Muitas tentativas. Aguarde alguns minutos.';
  }
  return 'Ocorreu um erro. Tente novamente.';
}

type Tab = 'login' | 'signup' | 'forgot';
let currentTab: Tab = 'login';

// ── session check ─────────────────────────────────────────────────────────────
async function checkExistingSession() {
  try {
    const s = await getSession();
    if (s) showSuccess(s.email ?? '');
  } catch { /* not in extension context */ }
}

// ── tabs ──────────────────────────────────────────────────────────────────────
function switchTab(tab: Tab) {
  currentTab = tab;
  const isForgot = tab === 'forgot';
  // Restore main content area and hide verify/success states
  $('w-main-content').style.display = '';
  $('w-verify').style.display       = 'none';
  $('w-success').style.display      = 'none';
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
    login:  ['Bem-vindo de volta!',     'Entre para continuar protegendo seus dados.'],
    signup: ['Crie sua conta grátis',   'Sem cartão de crédito. Ativo em 30 segundos.'],
    forgot: ['Recuperar senha',         'Enviaremos um link para redefinir sua senha.'],
  };
  $('w-title').textContent = titles[tab][0];
  $('w-sub').textContent   = titles[tab][1];
}

// ── password eye ──────────────────────────────────────────────────────────────
function togglePass(inputId: string, btn: HTMLButtonElement) {
  const inp = $<HTMLInputElement>(inputId);
  if (!inp) return;
  inp.type = inp.type === 'password' ? 'text' : 'password';
  const svg = btn.querySelector('svg');
  if (!svg) return;
  svg.innerHTML = inp.type === 'text'
    ? '<path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94"/><path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19"/><line x1="1" y1="1" x2="23" y2="23"/>'
    : '<path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/>';
}

// ── Google OAuth ──────────────────────────────────────────────────────────────
async function loginGoogle() {
  const btn   = $<HTMLButtonElement>('w-google-btn');
  const label = $('w-google-label');
  btn.disabled = true;
  label.textContent = 'Aguarde…';
  clearErrors();
  try {
    const session = await bffGoogleLogin();
    showSuccess(session.email ?? '');
  } catch (err) {
    btn.disabled = false;
    label.textContent = 'Tentar novamente com Google';
    const msg = err instanceof AppError && err.code === E.NETWORK ? '' : errMsg(err);
    if (msg) setErr(msg);
  }
}

// ── Login ────────────────────────────────────────────────────────────────────
async function submitLogin() {
  clearErrors();
  const email = $<HTMLInputElement>('login-email').value.trim();
  const pass  = $<HTMLInputElement>('login-pass').value;
  if (!email) { fieldErr('login-email', 'Informe o email'); return; }
  if (!pass)  { fieldErr('login-pass',  'Informe a senha'); return; }

  const btn = $<HTMLButtonElement>('login-btn');
  btn.disabled = true;
  btn.innerHTML = '<span class="w-spin"></span>Entrando…';
  try {
    const session = await bffLogin(email, pass);
    showSuccess(session.email ?? email);
  } catch (err) {
    btn.disabled = false; btn.textContent = 'Entrar';
    setErr(errMsg(err));
  }
}

// ── Signup (Supabase direct — email confirmation flow, no BFF session yet) ────
async function submitSignup() {
  clearErrors();
  const name  = $<HTMLInputElement>('signup-name').value.trim();
  const email = $<HTMLInputElement>('signup-email').value.trim();
  const pass  = $<HTMLInputElement>('signup-pass').value;
  if (!name)          { fieldErr('signup-name',  'Informe seu nome'); return; }
  if (!email)         { fieldErr('signup-email', 'Informe o email'); return; }
  if (pass.length < 6){ fieldErr('signup-pass',  'Mínimo 6 caracteres'); return; }

  const btn = $<HTMLButtonElement>('signup-btn');
  btn.disabled = true;
  btn.innerHTML = '<span class="w-spin"></span>Criando conta…';
  try {
    const res  = await fetch('https://kezbssjmgwtrunqeoyir.supabase.co/auth/v1/signup', {
      method:  'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey': 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImtlemJzc2ptZ3d0cnVucWVveWlyIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NDcwMDQ5MTAsImV4cCI6MjA2MjU4MDkxMH0.FVTep4LmpPh2bVB5_f8CQ4JEYhoCb21mlzj3eSXJQoU',
        'Authorization': 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImtlemJzc2ptZ3d0cnVucWVveWlyIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NDcwMDQ5MTAsImV4cCI6MjA2MjU4MDkxMH0.FVTep4LmpPh2bVB5_f8CQ4JEYhoCb21mlzj3eSXJQoU',
      },
      body: JSON.stringify({ email, password: pass, data: { name } }),
    });
    const data = await res.json() as { error?: string; error_description?: string; msg?: string };
    if (!res.ok) {
      btn.disabled = false; btn.textContent = 'Criar conta grátis';
      const m = data.error_description ?? data.msg ?? data.error ?? '';
      setErr(m.includes('already') ? 'Este email já está cadastrado. Tente entrar.' : (m || 'Erro ao criar conta.'));
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
  const email = $<HTMLInputElement>('forgot-email').value.trim();
  if (!email) { fieldErr('forgot-email', 'Informe o email'); return; }

  const btn = $<HTMLButtonElement>('forgot-btn');
  btn.disabled = true;
  btn.innerHTML = '<span class="w-spin"></span>Enviando…';
  try {
    await bffResetPassword(email);
    btn.disabled = false; btn.textContent = 'Reenviar link';
    setInfo('Link enviado! Verifique seu email (incluindo spam).');
  } catch {
    btn.disabled = false; btn.textContent = 'Enviar link de redefinição';
    setErr('Erro ao enviar. Tente novamente.');
  }
}

// ── states ────────────────────────────────────────────────────────────────────
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

// ── init ──────────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  void checkExistingSession();

  $('tab-login').addEventListener('click',  () => switchTab('login'));
  $('tab-signup').addEventListener('click', () => switchTab('signup'));

  $('w-google-btn').addEventListener('click', () => void loginGoogle());

  $('login-btn').addEventListener('click', () => void submitLogin());
  $<HTMLInputElement>('login-email').addEventListener('keydown', e => { if (e.key === 'Enter') void submitLogin(); });
  $<HTMLInputElement>('login-pass').addEventListener('keydown',  e => { if (e.key === 'Enter') void submitLogin(); });
  $('forgot-link').addEventListener('click', () => switchTab('forgot'));

  $('eye-login').addEventListener('click',  e => togglePass('login-pass',  e.currentTarget as HTMLButtonElement));
  $('eye-signup').addEventListener('click', e => togglePass('signup-pass', e.currentTarget as HTMLButtonElement));

  $('signup-btn').addEventListener('click', () => void submitSignup());
  $<HTMLInputElement>('signup-name').addEventListener('keydown',  e => { if (e.key === 'Enter') void submitSignup(); });
  $<HTMLInputElement>('signup-email').addEventListener('keydown', e => { if (e.key === 'Enter') void submitSignup(); });
  $<HTMLInputElement>('signup-pass').addEventListener('keydown',  e => { if (e.key === 'Enter') void submitSignup(); });
  $('to-login-link').addEventListener('click',  () => switchTab('login'));
  $('to-signup-link').addEventListener('click', () => switchTab('signup'));

  $('forgot-btn').addEventListener('click', () => void submitForgot());
  $<HTMLInputElement>('forgot-email').addEventListener('keydown', e => { if (e.key === 'Enter') void submitForgot(); });
  $('back-to-login').addEventListener('click', () => switchTab('login'));

  $('verify-back').addEventListener('click', () => switchTab('login'));
});
