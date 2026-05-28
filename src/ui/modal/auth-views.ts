// ─── Auth Views — login / signup / reset / email confirmation ─────────────────
// Extracted from modal.ts. Contains all authentication-related views.

import { getLogoUrl, clearMsgInterval } from './utils';
import { bffLogin, bffGoogleLogin, bffResetPassword } from '../../auth/bffClient';
import { signUpWithPassword } from '../../core/auth';
import { friendlyError } from '../../core/errors';
import { trackEvent } from '../../core/analytics';

export function renderLoginView(container: HTMLElement, switchView: (view: string) => void): void {
  void trackEvent('login_view_shown');
  clearMsgInterval();
  container.innerHTML = '';

  const wrap = document.createElement('div');
  wrap.className = 'atenna-modal__login';

  // Add logo in popup context
  const logoUrl = getLogoUrl();
  if (logoUrl && document.getElementById('atenna-popup')) {
    const logoDiv = document.createElement('div');
    logoDiv.style.cssText = 'width:100%;display:flex;justify-content:center;margin-bottom:8px;';
    logoDiv.innerHTML = `<img src="${logoUrl}" width="96" height="96" alt="Atenna" style="border-radius:50%;margin-bottom:16px;"/>`;
    wrap.appendChild(logoDiv);
  }

  const title = document.createElement('h2');
  title.className = 'atenna-modal__login-title';
  title.textContent = 'Bem-vindo ao Atenna.';

  const subtitle = document.createElement('p');
  subtitle.className = 'atenna-modal__login-subtitle';
  subtitle.textContent = 'Uma camada de clareza para suas solicitações de IA.';

  const inputGroup = document.createElement('div');
  inputGroup.className = 'atenna-modal__login-group';

  // Email com ícone
  const emailWrapper = document.createElement('div');
  emailWrapper.className = 'atenna-modal__input-wrapper';
  const emailInput = document.createElement('input');
  emailInput.type = 'email';
  emailInput.className = 'atenna-modal__login-input';
  emailInput.placeholder = 'seu@email.com';
  emailInput.autocomplete = 'email';
  const emailIcon = document.createElement('span');
  emailIcon.className = 'atenna-modal__input-icon-left';
  emailIcon.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="2" y="4" width="20" height="16" rx="2"/><path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7"/></svg>`;
  emailWrapper.appendChild(emailIcon);
  emailWrapper.appendChild(emailInput);

  // Senha com ícone + eye toggle
  const passwordWrapper = document.createElement('div');
  passwordWrapper.className = 'atenna-modal__input-wrapper';
  const passwordInput = document.createElement('input');
  passwordInput.type = 'password';
  passwordInput.className = 'atenna-modal__login-input';
  passwordInput.placeholder = 'Senha';
  passwordInput.autocomplete = 'current-password';
  const pwdIcon = document.createElement('span');
  pwdIcon.className = 'atenna-modal__input-icon-left';
  pwdIcon.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>`;
  const eyeToggle = document.createElement('button');
  eyeToggle.className = 'atenna-modal__input-icon-right';
  eyeToggle.type = 'button';
  eyeToggle.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>`;
  eyeToggle.title = 'Mostrar senha';
  eyeToggle.addEventListener('click', (e) => {
    e.preventDefault();
    const isPassword = passwordInput.type === 'password';
    passwordInput.type = isPassword ? 'text' : 'password';
    eyeToggle.title = isPassword ? 'Ocultar senha' : 'Mostrar senha';
  });
  passwordWrapper.appendChild(pwdIcon);
  passwordWrapper.appendChild(passwordInput);
  passwordWrapper.appendChild(eyeToggle);

  const btn = document.createElement('button');
  btn.className = 'atenna-modal__login-btn';
  btn.textContent = 'Entrar';

  const status = document.createElement('div');
  status.className = 'atenna-modal__login-status';

  const handleClick = async () => {
    const email = emailInput.value.trim();
    const pwd = passwordInput.value;

    if (!email) {
      status.textContent = 'Informe seu email';
      status.classList.remove('atenna-modal__login-status--error', 'atenna-modal__login-status--success');
      status.classList.add('atenna-modal__login-status--warning');
      return;
    }
    if (!pwd) {
      status.textContent = 'Informe sua senha';
      status.classList.remove('atenna-modal__login-status--error', 'atenna-modal__login-status--success');
      status.classList.add('atenna-modal__login-status--warning');
      return;
    }

    void trackEvent('login_email_submitted', { input_length: email.length });

    btn.disabled = true;
    btn.textContent = 'Entrando…';
    status.textContent = '';

    try {
      await bffLogin(email, pwd);
      void trackEvent('login_success');
      status.textContent = 'Login realizado! Recarregando...';
      status.classList.remove('atenna-modal__login-status--error');
      status.classList.add('atenna-modal__login-status--success');
      emailInput.disabled = true;
      passwordInput.disabled = true;
      btn.disabled = true;
      setTimeout(() => window.location.reload(), 1000);
    } catch (err: unknown) {
      const msg = friendlyError(err);
      void trackEvent('login_error', { error: err instanceof Error ? err.message : String(err) });
      status.textContent = msg;
      status.classList.remove('atenna-modal__login-status--success');
      status.classList.add('atenna-modal__login-status--error');
      btn.disabled = false;
      btn.textContent = 'Entrar';
    }
  };

  btn.addEventListener('click', handleClick);
  [emailInput, passwordInput].forEach(input => {
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') void handleClick();
    });
  });

  const linksDiv = document.createElement('div');
  linksDiv.className = 'atenna-modal__login-links';

  const signupLink = document.createElement('button');
  signupLink.className = 'atenna-modal__login-link';
  signupLink.textContent = 'Criar conta';
  signupLink.addEventListener('click', () => switchView('signup'));

  const resetLink = document.createElement('button');
  resetLink.className = 'atenna-modal__login-link';
  resetLink.textContent = 'Esqueci minha senha';
  resetLink.addEventListener('click', () => switchView('reset'));

  linksDiv.appendChild(signupLink);
  linksDiv.appendChild(resetLink);

  inputGroup.appendChild(emailWrapper);
  inputGroup.appendChild(passwordWrapper);
  inputGroup.appendChild(btn);

  // ── Google OAuth ────────────────────────────────────────────────────────────
  const GOOGLE_G = `<svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true" focusable="false"><path fill="#EA4335" d="M24 9.5c3.14 0 5.95 1.08 8.17 2.86l6.1-6.1C34.46 3.01 29.5 1 24 1 14.85 1 7.08 6.48 3.69 14.24l7.1 5.52C12.53 13.1 17.83 9.5 24 9.5z"/><path fill="#4285F4" d="M46.52 24.5c0-1.64-.15-3.22-.43-4.75H24v9h12.7c-.55 2.99-2.2 5.53-4.68 7.24l7.18 5.58C43.44 37.44 46.52 31.42 46.52 24.5z"/><path fill="#FBBC05" d="M10.8 28.5A14.52 14.52 0 0 1 9.5 24c0-1.57.27-3.09.76-4.5l-7.1-5.52A23.94 23.94 0 0 0 0 24c0 3.87.93 7.53 2.57 10.76l8.23-6.26z"/><path fill="#34A853" d="M24 47c5.5 0 10.12-1.83 13.49-4.96l-7.18-5.58C28.54 37.77 26.38 38.5 24 38.5c-6.17 0-11.47-3.6-13.2-8.76l-8.23 6.26C6.08 43.52 14.45 47 24 47z"/></svg>`;

  const divider = document.createElement('div');
  divider.className = 'atenna-modal__login-divider';
  divider.innerHTML = '<span>ou</span>';

  const googleBtn = document.createElement('button');
  googleBtn.type = 'button';
  googleBtn.className = 'atenna-modal__login-btn--google';
  googleBtn.innerHTML = `${GOOGLE_G}Entrar com Google`;

  const googleStatus = document.createElement('div');
  googleStatus.className = 'atenna-modal__login-status';

  googleBtn.addEventListener('click', async () => {
    googleBtn.disabled = true;
    googleBtn.textContent = 'Aguardando Google…';
    googleStatus.textContent = '';
    googleStatus.className = 'atenna-modal__login-status';
    try {
      await bffGoogleLogin();
      void trackEvent('login_google_success');
      googleStatus.textContent = 'Login realizado!';
      googleStatus.classList.add('atenna-modal__login-status--success');
      setTimeout(() => window.location.reload(), 800);
    } catch (err: unknown) {
      void trackEvent('login_google_error', { error: err instanceof Error ? err.message : String(err) });
      googleStatus.textContent = friendlyError(err);
      googleStatus.classList.add('atenna-modal__login-status--error');
      googleBtn.disabled = false;
      googleBtn.innerHTML = `${GOOGLE_G}Entrar com Google`;
    }
  });
  // ────────────────────────────────────────────────────────────────────────────

  wrap.appendChild(title);
  wrap.appendChild(subtitle);
  wrap.appendChild(inputGroup);
  wrap.appendChild(status);
  wrap.appendChild(divider);
  wrap.appendChild(googleBtn);
  wrap.appendChild(googleStatus);
  wrap.appendChild(linksDiv);
  container.appendChild(wrap);

  emailInput.focus();
}

export function renderEmailConfirmationScreen(container: HTMLElement, email: string, switchView: (view: string) => void): void {
  container.innerHTML = '';
  const wrap = document.createElement('div');
  wrap.className = 'atenna-modal__login';
  wrap.style.cssText = 'display:flex;flex-direction:column;align-items:center;gap:20px;padding:32px 24px;text-align:center;';

  const iconWrap = document.createElement('div');
  iconWrap.style.cssText = 'width:64px;height:64px;border-radius:50%;background:rgba(59,130,246,0.12);display:flex;align-items:center;justify-content:center;flex-shrink:0;';
  iconWrap.innerHTML = `<svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#3b82f6" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="2" y="4" width="20" height="16" rx="2"/><path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7"/></svg>`;

  const titleEl = document.createElement('h3');
  titleEl.style.cssText = 'margin:0;font-size:16px;font-weight:600;color:var(--at-text,#e8e8e8);';
  titleEl.textContent = 'Verifique seu email';

  const desc = document.createElement('p');
  desc.style.cssText = 'margin:0;font-size:13px;color:var(--at-text-secondary,rgba(232,232,232,0.65));line-height:1.5;max-width:260px;';
  desc.textContent = 'Enviamos um link de confirmação para ';
  const emailStrong = document.createElement('strong');
  emailStrong.style.color = 'var(--at-text,#e8e8e8)';
  emailStrong.textContent = email;
  desc.appendChild(emailStrong);
  desc.appendChild(document.createTextNode('. Clique no link para ativar sua conta.'));

  const gmailBtn = document.createElement('a');
  gmailBtn.href = 'https://mail.google.com/';
  gmailBtn.target = '_blank';
  gmailBtn.rel = 'noopener noreferrer';
  gmailBtn.className = 'atenna-modal__login-btn';
  gmailBtn.style.cssText = 'display:flex;align-items:center;justify-content:center;gap:8px;text-decoration:none;padding:10px 20px;';
  gmailBtn.innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="2" y="4" width="20" height="16" rx="2"/><path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7"/></svg> Abrir Gmail`;

  const backBtn2 = document.createElement('button');
  backBtn2.className = 'atenna-modal__login-link';
  backBtn2.style.cssText = 'margin-top:4px;font-size:13px;';
  backBtn2.textContent = 'Voltar ao login';
  backBtn2.addEventListener('click', () => switchView('login'));

  wrap.appendChild(iconWrap);
  wrap.appendChild(titleEl);
  wrap.appendChild(desc);
  wrap.appendChild(gmailBtn);
  wrap.appendChild(backBtn2);
  container.appendChild(wrap);
}

export function renderSignupView(container: HTMLElement, switchView: (view: string) => void): void {
  void trackEvent('signup_clicked');
  clearMsgInterval();
  container.innerHTML = '';

  const wrap = document.createElement('div');
  wrap.className = 'atenna-modal__login';

  // Add logo in popup context
  const logoUrl = getLogoUrl();
  if (logoUrl && document.getElementById('atenna-popup')) {
    const logoDiv = document.createElement('div');
    logoDiv.style.cssText = 'width:100%;display:flex;justify-content:center;margin-bottom:8px;';
    logoDiv.innerHTML = `<img src="${logoUrl}" width="96" height="96" alt="Atenna" style="border-radius:50%;margin-bottom:16px;"/>`;
    wrap.appendChild(logoDiv);
  }

  const backBtn = document.createElement('button');
  backBtn.className = 'atenna-modal__login-back';
  backBtn.textContent = '← Voltar';
  backBtn.addEventListener('click', () => switchView('login'));

  const title = document.createElement('h2');
  title.className = 'atenna-modal__login-title';
  title.textContent = 'Criar conta';

  const inputGroup = document.createElement('div');
  inputGroup.className = 'atenna-modal__login-group';

  // Nome
  const nameWrapper = document.createElement('div');
  nameWrapper.className = 'atenna-modal__input-wrapper';
  const nameInput = document.createElement('input');
  nameInput.type = 'text';
  nameInput.className = 'atenna-modal__login-input';
  nameInput.placeholder = 'Seu nome';
  nameInput.autocomplete = 'name';
  const nameIcon = document.createElement('span');
  nameIcon.className = 'atenna-modal__input-icon-left';
  nameIcon.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>`;
  nameWrapper.appendChild(nameIcon);
  nameWrapper.appendChild(nameInput);

  // Email com ícone
  const emailWrapper = document.createElement('div');
  emailWrapper.className = 'atenna-modal__input-wrapper';
  const emailInput = document.createElement('input');
  emailInput.type = 'email';
  emailInput.className = 'atenna-modal__login-input';
  emailInput.placeholder = 'seu@email.com';
  emailInput.autocomplete = 'email';
  const emailIcon = document.createElement('span');
  emailIcon.className = 'atenna-modal__input-icon-left';
  emailIcon.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="2" y="4" width="20" height="16" rx="2"/><path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7"/></svg>`;
  emailWrapper.appendChild(emailIcon);
  emailWrapper.appendChild(emailInput);

  // Senha com ícone + eye toggle
  const passwordWrapper = document.createElement('div');
  passwordWrapper.className = 'atenna-modal__input-wrapper';
  const passwordInput = document.createElement('input');
  passwordInput.type = 'password';
  passwordInput.className = 'atenna-modal__login-input';
  passwordInput.placeholder = 'Senha (mín. 6 caracteres)';
  passwordInput.autocomplete = 'new-password';
  const pwdIcon = document.createElement('span');
  pwdIcon.className = 'atenna-modal__input-icon-left';
  pwdIcon.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>`;
  const eyeToggle = document.createElement('button');
  eyeToggle.className = 'atenna-modal__input-icon-right';
  eyeToggle.type = 'button';
  eyeToggle.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>`;
  eyeToggle.title = 'Mostrar senha';
  eyeToggle.addEventListener('click', (e) => {
    e.preventDefault();
    const isPassword = passwordInput.type === 'password';
    passwordInput.type = isPassword ? 'text' : 'password';
    eyeToggle.title = isPassword ? 'Esconder senha' : 'Mostrar senha';
  });
  passwordWrapper.appendChild(pwdIcon);
  passwordWrapper.appendChild(passwordInput);
  passwordWrapper.appendChild(eyeToggle);

  // Confirmar senha com ícone + eye toggle
  const confirmWrapper = document.createElement('div');
  confirmWrapper.className = 'atenna-modal__input-wrapper';
  const confirmInput = document.createElement('input');
  confirmInput.type = 'password';
  confirmInput.className = 'atenna-modal__login-input';
  confirmInput.placeholder = 'Confirme a senha';
  confirmInput.autocomplete = 'new-password';
  const confirmIcon = document.createElement('span');
  confirmIcon.className = 'atenna-modal__input-icon-left';
  confirmIcon.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>`;
  const eyeToggle2 = document.createElement('button');
  eyeToggle2.className = 'atenna-modal__input-icon-right';
  eyeToggle2.type = 'button';
  eyeToggle2.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>`;
  eyeToggle2.title = 'Mostrar senha';
  eyeToggle2.addEventListener('click', (e) => {
    e.preventDefault();
    const isPassword = confirmInput.type === 'password';
    confirmInput.type = isPassword ? 'text' : 'password';
    eyeToggle2.title = isPassword ? 'Esconder senha' : 'Mostrar senha';
  });
  confirmWrapper.appendChild(confirmIcon);
  confirmWrapper.appendChild(confirmInput);
  confirmWrapper.appendChild(eyeToggle2);

  const btn = document.createElement('button');
  btn.className = 'atenna-modal__login-btn';
  btn.textContent = 'Criar conta';

  const status = document.createElement('div');
  status.className = 'atenna-modal__login-status';

  const setStatus = (msg: string, type: 'error' | 'warning' | 'success' | '') => {
    status.textContent = msg;
    status.classList.remove('atenna-modal__login-status--error', 'atenna-modal__login-status--warning', 'atenna-modal__login-status--success');
    if (type) status.classList.add(`atenna-modal__login-status--${type}`);
  };

  // Real-time confirm password check
  confirmInput.addEventListener('blur', () => {
    const pwd = passwordInput.value;
    const confirm = confirmInput.value;
    if (confirm && pwd !== confirm) setStatus('As senhas não conferem', 'warning');
    else if (confirm && pwd === confirm) setStatus('Senhas conferem ✓', 'success');
  });
  confirmInput.addEventListener('input', () => {
    const pwd = passwordInput.value;
    const confirm = confirmInput.value;
    if (confirm && pwd === confirm) setStatus('Senhas conferem ✓', 'success');
    else if (confirm) setStatus('As senhas não conferem', 'warning');
    else setStatus('', '');
  });

  const handleClick = async () => {
    const name    = nameInput.value.trim();
    const email   = emailInput.value.trim();
    const pwd     = passwordInput.value;
    const confirm = confirmInput.value;

    if (!name)  { setStatus('Informe seu nome', 'warning'); nameInput.focus(); return; }
    if (!email) { setStatus('Informe seu email', 'warning'); emailInput.focus(); return; }
    if (pwd.length < 6) { setStatus('Senha deve ter no mínimo 6 caracteres', 'warning'); passwordInput.focus(); return; }
    if (pwd !== confirm) { setStatus('As senhas não conferem', 'warning'); confirmInput.focus(); return; }

    void trackEvent('signup_submitted', { input_length: email.length });

    btn.disabled = true;
    btn.textContent = 'Criando…';
    setStatus('', '');

    const result = await signUpWithPassword(email, pwd, name);
    if (result.error) {
      void trackEvent('signup_error', { error: result.error });
      setStatus(result.error, 'error');
      btn.disabled = false;
      btn.textContent = 'Criar conta';
    } else {
      void trackEvent('signup_success');
      renderEmailConfirmationScreen(container, email, switchView);
    }
  };

  btn.addEventListener('click', handleClick);
  [nameInput, emailInput, passwordInput, confirmInput].forEach(input => {
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') void handleClick();
    });
  });

  inputGroup.appendChild(nameWrapper);
  inputGroup.appendChild(emailWrapper);
  inputGroup.appendChild(passwordWrapper);
  inputGroup.appendChild(confirmWrapper);
  inputGroup.appendChild(btn);
  wrap.appendChild(backBtn);
  wrap.appendChild(title);
  wrap.appendChild(inputGroup);
  wrap.appendChild(status);
  container.appendChild(wrap);

  emailInput.focus();
}

export function renderResetView(container: HTMLElement, switchView: (view: string) => void): void {
  void trackEvent('reset_clicked');
  clearMsgInterval();
  container.innerHTML = '';

  const wrap = document.createElement('div');
  wrap.className = 'atenna-modal__login';

  // Add logo in popup context
  const logoUrl = getLogoUrl();
  if (logoUrl && document.getElementById('atenna-popup')) {
    const logoDiv = document.createElement('div');
    logoDiv.style.cssText = 'width:100%;display:flex;justify-content:center;margin-bottom:8px;';
    logoDiv.innerHTML = `<img src="${logoUrl}" width="96" height="96" alt="Atenna" style="border-radius:50%;margin-bottom:16px;"/>`;
    wrap.appendChild(logoDiv);
  }

  const backBtn = document.createElement('button');
  backBtn.className = 'atenna-modal__login-back';
  backBtn.textContent = '← Voltar';
  backBtn.addEventListener('click', () => switchView('login'));

  const title = document.createElement('h2');
  title.className = 'atenna-modal__login-title';
  title.textContent = 'Recuperar senha';

  const subtitle = document.createElement('p');
  subtitle.className = 'atenna-modal__login-subtitle';
  subtitle.textContent = 'Enviaremos um link para redefinir sua senha';

  const inputGroup = document.createElement('div');
  inputGroup.className = 'atenna-modal__login-group';

  const input = document.createElement('input');
  input.type = 'email';
  input.className = 'atenna-modal__login-input';
  input.placeholder = 'seu@email.com';
  input.autocomplete = 'email';

  const btn = document.createElement('button');
  btn.className = 'atenna-modal__login-btn';
  btn.textContent = 'Enviar link';

  const status = document.createElement('div');
  status.className = 'atenna-modal__login-status';

  const handleClick = async () => {
    const email = input.value.trim();
    if (!email) {
      status.textContent = 'Informe seu email';
      status.classList.add('atenna-modal__login-status--warning');
      return;
    }

    void trackEvent('reset_submitted', { input_length: email.length });

    btn.disabled = true;
    btn.textContent = 'Enviando…';
    status.textContent = '';
    status.classList.remove('atenna-modal__login-status--error', 'atenna-modal__login-status--warning');

    try {
      await bffResetPassword(email);
      void trackEvent('reset_success');
      status.innerHTML = '<strong>Link enviado!</strong><br>Verifique seu email para redefinir a senha.';
      status.classList.add('atenna-modal__login-status--success');
      input.disabled = true;
      btn.style.display = 'none';
    } catch (err: unknown) {
      void trackEvent('reset_error', { error: err instanceof Error ? err.message : String(err) });
      status.textContent = friendlyError(err);
      status.classList.add('atenna-modal__login-status--error');
      btn.disabled = false;
      btn.textContent = 'Enviar link';
    }
  };

  btn.addEventListener('click', handleClick);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') void handleClick();
  });

  inputGroup.appendChild(input);
  inputGroup.appendChild(btn);
  wrap.appendChild(backBtn);
  wrap.appendChild(title);
  wrap.appendChild(subtitle);
  wrap.appendChild(inputGroup);
  wrap.appendChild(status);
  container.appendChild(wrap);

  input.focus();
}
