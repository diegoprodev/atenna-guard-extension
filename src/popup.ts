import { getActiveSession, clearSession, signInWithPassword, signUpWithPassword, resetPassword } from './core/auth';
import { getPlan } from './core/planManager';
import { openSettingsOverlay } from './ui/modal';

const SUPPORTED_HOSTS = ['chatgpt.com', 'chat.openai.com', 'claude.ai', 'gemini.google.com', 'copilot.microsoft.com'];

async function getActiveTabInfo(): Promise<{ url: string; host: string; supported: boolean } | null> {
  return new Promise(resolve => {
    chrome.tabs.query({ active: true, currentWindow: true }, tabs => {
      const tab = tabs[0];
      if (!tab?.url) { resolve(null); return; }
      try {
        const url = new URL(tab.url);
        resolve({ url: tab.url, host: url.hostname, supported: SUPPORTED_HOSTS.some(h => url.hostname.includes(h)) });
      } catch { resolve(null); }
    });
  });
}

async function openModalOnActiveTab(): Promise<void> {
  return new Promise(resolve => {
    chrome.tabs.query({ active: true, currentWindow: true }, tabs => {
      const tab = tabs[0];
      if (tab?.id) {
        chrome.tabs.sendMessage(tab.id, { type: 'TOGGLE_MODAL' }, () => {
          void chrome.runtime.lastError;
          resolve();
        });
      } else { resolve(); }
    });
  });
}

const SVG_SHIELD = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>`;
const SVG_SPARKLE = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2l2.4 7.4H22l-6.2 4.5 2.4 7.4L12 17l-6.2 4.3 2.4-7.4L2 9.4h7.6z"/></svg>`;
const SVG_FILE = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>`;
const SVG_GLOBE = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>`;

function getPlatformLabel(host: string): { name: string; svg: string } {
  if (host.includes('chatgpt') || host.includes('openai')) return { name: 'ChatGPT', svg: `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>` };
  if (host.includes('claude')) return { name: 'Claude.ai', svg: SVG_SPARKLE };
  if (host.includes('gemini')) return { name: 'Gemini', svg: SVG_SPARKLE };
  if (host.includes('copilot')) return { name: 'Copilot', svg: SVG_GLOBE };
  return { name: host, svg: SVG_GLOBE };
}

async function initPopup(): Promise<void> {
  const container = document.getElementById('atenna-popup')!;
  container.innerHTML = `<div class="ap-loading"><div class="ap-spinner"></div></div>`;

  const [session, tabInfo] = await Promise.all([getActiveSession(), getActiveTabInfo()]);

  if (!session) {
    renderLogin(container);
    return;
  }

  const plan = await getPlan();
  renderHome(container, session, plan, tabInfo);
}

const EYE_OPEN  = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>`;
const EYE_CLOSE = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94"/><path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19"/><line x1="1" y1="1" x2="23" y2="23"/></svg>`;

function renderLogin(container: HTMLElement): void {
  const logoUrl = chrome.runtime.getURL('icons/icon128.png');
  container.innerHTML = `
    <div class="ap-root ap-root--login">
      <div class="ap-login-logo">
        <img src="${logoUrl}" alt="Atenna" style="width:56px;height:56px;"/>
      </div>
      <div class="ap-login-title" id="ap-login-title">Bem-vindo ao Atenna</div>
      <div id="ap-login-err" class="ap-login-err" style="display:none"></div>
      <div class="ap-login-form">
        <input id="ap-name" type="text" placeholder="Seu nome" autocomplete="name" style="display:none"/>
        <input id="ap-email" type="email" placeholder="seu@email.com" autocomplete="email"/>
        <div class="ap-pass-wrap">
          <input id="ap-pass" type="password" placeholder="Senha" autocomplete="current-password"/>
          <button type="button" id="ap-eye" class="ap-eye-btn" title="Mostrar/ocultar senha">${EYE_OPEN}</button>
        </div>
        <button class="ap-btn ap-btn--primary" id="ap-login-btn">Entrar</button>
      </div>
      <div class="ap-login-links">
        <button class="ap-link-btn" id="ap-signup-link">Criar conta</button>
        <span style="color:#ccc">·</span>
        <button class="ap-link-btn" id="ap-forgot-link">Esqueci minha senha</button>
      </div>
    </div>
  `;

  const nameEl  = document.getElementById('ap-name')  as HTMLInputElement;
  const emailEl = document.getElementById('ap-email') as HTMLInputElement;
  const passEl  = document.getElementById('ap-pass')  as HTMLInputElement;
  const errEl   = document.getElementById('ap-login-err')!;
  const btn     = document.getElementById('ap-login-btn') as HTMLButtonElement;
  const titleEl = document.getElementById('ap-login-title')!;
  const eyeBtn  = document.getElementById('ap-eye') as HTMLButtonElement;

  let mode: 'login' | 'signup' | 'forgot' = 'login';

  eyeBtn.addEventListener('click', () => {
    const visible = passEl.type === 'text';
    passEl.type = visible ? 'password' : 'text';
    eyeBtn.innerHTML = visible ? EYE_OPEN : EYE_CLOSE;
  });

  document.getElementById('ap-signup-link')!.addEventListener('click', () => {
    mode = mode === 'signup' ? 'login' : 'signup';
    const isSignup = mode === 'signup';
    titleEl.textContent = isSignup ? 'Criar conta' : 'Bem-vindo ao Atenna';
    nameEl.style.display = isSignup ? '' : 'none';
    passEl.style.display = '';
    document.getElementById('ap-pass-wrap' as string)?.style;
    btn.textContent = isSignup ? 'Criar conta' : 'Entrar';
    errEl.style.display = 'none';
    (document.getElementById('ap-signup-link') as HTMLButtonElement).textContent = isSignup ? 'Já tenho conta' : 'Criar conta';
    (document.getElementById('ap-forgot-link') as HTMLButtonElement).style.display = isSignup ? 'none' : '';
  });

  document.getElementById('ap-forgot-link')!.addEventListener('click', async () => {
    const email = emailEl.value.trim();
    if (!email) { errEl.textContent = 'Digite seu email primeiro.'; errEl.style.display = 'block'; return; }
    errEl.style.display = 'none';
    const { error } = await resetPassword(email);
    if (error) { errEl.textContent = error; errEl.style.display = 'block'; }
    else { errEl.style.color = '#16a34a'; errEl.style.background = '#f0fdf4'; errEl.style.borderColor = '#bbf7d0'; errEl.textContent = 'Email de recuperação enviado!'; errEl.style.display = 'block'; }
  });

  const doAction = async () => {
    const email = emailEl.value.trim();
    const pass  = passEl.value;
    errEl.style.color = ''; errEl.style.background = ''; errEl.style.borderColor = '';
    if (!email || (!pass && mode !== 'forgot')) { errEl.textContent = 'Preencha email e senha.'; errEl.style.display = 'block'; return; }
    btn.disabled = true; btn.textContent = mode === 'signup' ? 'Criando…' : 'Entrando…';
    errEl.style.display = 'none';
    try {
      if (mode === 'signup') {
        const name = nameEl.value.trim();
        const { error } = await signUpWithPassword(email, pass, name || undefined);
        if (error) throw new Error(error);
        errEl.style.color = '#16a34a'; errEl.style.background = '#f0fdf4'; errEl.style.borderColor = '#bbf7d0';
        errEl.textContent = 'Conta criada! Verifique seu email.'; errEl.style.display = 'block';
        btn.disabled = false; btn.textContent = 'Criar conta';
      } else {
        await signInWithPassword(email, pass);
        window.location.reload();
      }
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Erro.';
      errEl.textContent = msg.includes('Invalid') ? 'Email ou senha incorretos.' : msg;
      errEl.style.display = 'block';
      btn.disabled = false; btn.textContent = mode === 'signup' ? 'Criar conta' : 'Entrar';
    }
  };

  btn.addEventListener('click', () => void doAction());
  passEl.addEventListener('keydown', e => { if (e.key === 'Enter') void doAction(); });
}

function renderHome(
  container: HTMLElement,
  session: { email: string },
  plan: { type: string },
  tabInfo: { host: string; supported: boolean } | null,
): void {
  const isPro = plan.type === 'pro';
  const supported = tabInfo?.supported ?? false;
  const platform = tabInfo ? getPlatformLabel(tabInfo.host) : null;
  const logoUrl = chrome.runtime.getURL('icons/icon128.png');

  container.innerHTML = `
    <div class="ap-root">
      <div class="ap-header">
        <img src="${logoUrl}" class="ap-header__logo" alt="Atenna"/>
        <div class="ap-header__info">
          <div class="ap-header__name">Atenna Safe</div>
          <div class="ap-header__email">${session.email}</div>
        </div>
        <span class="ap-badge ap-badge--${isPro ? 'pro' : 'free'}">${isPro ? 'PRO ✓' : 'FREE'}</span>
      </div>

      <div class="ap-platform ap-platform--${supported ? 'ok' : 'warn'}">
        ${supported
          ? `<span class="ap-platform__dot ap-platform__dot--green"></span>
             <span class="ap-platform__icon">${platform!.svg}</span>
             <span>${platform!.name} — protegido e ativo</span>`
          : `<span class="ap-platform__dot ap-platform__dot--gray"></span>
             <span>Abra o ChatGPT, Claude.ai ou Gemini para ativar</span>`
        }
      </div>

      <button class="ap-btn ap-btn--primary ap-btn--big" id="ap-open-modal" ${!supported ? 'disabled' : ''}>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M12 8v4l3 3"/></svg>
        ${supported ? 'Abrir Atenna' : 'Nenhuma plataforma ativa'}
      </button>

      ${!supported ? `
        <div class="ap-tips">
          <div class="ap-tips__title">Plataformas suportadas</div>
          <div class="ap-tips__list">
            <span>chatgpt.com</span><span>claude.ai</span><span>gemini.google.com</span>
          </div>
        </div>
      ` : `
        <div class="ap-features">
          <div class="ap-feature"><span class="ap-feature__icon">${SVG_SHIELD}</span><span>DLP — detecta CPF, cartão, senhas antes do envio</span></div>
          <div class="ap-feature"><span class="ap-feature__icon">${SVG_SPARKLE}</span><span>Refine prompts com IA integrada</span></div>
          <div class="ap-feature"><span class="ap-feature__icon">${SVG_FILE}</span><span>Scan de documentos PDF/CSV até 100 MB</span></div>
        </div>
      `}

      <div class="ap-footer">
        <button class="ap-footer__btn" id="ap-settings-btn">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>
          Configurações
        </button>
        <button class="ap-footer__btn ap-footer__btn--danger" id="ap-logout-btn">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>
          Sair
        </button>
      </div>
    </div>
  `;

  document.getElementById('ap-open-modal')?.addEventListener('click', async () => {
    await openModalOnActiveTab();
    window.close();
  });

  document.getElementById('ap-settings-btn')!.addEventListener('click', () => {
    void openSettingsOverlay();
  });

  document.getElementById('ap-logout-btn')!.addEventListener('click', async () => {
    if (!confirm('Deseja sair da sua conta Atenna?')) return;
    await clearSession();
    await new Promise<void>(r => chrome.storage.local.remove(
      ['atenna_plan', 'atenna_app_onboarding_seen', 'atenna_onboarding_seen'],
      () => r()
    ));
    await openModalOnActiveTab();
    window.close();
  });
}

void initPopup();
