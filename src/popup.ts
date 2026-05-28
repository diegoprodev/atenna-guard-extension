import { signUpWithPassword } from './core/auth';
import { bffLogin, bffLogout, bffMe, bffResetPassword, bffGoogleLogin } from './auth/bffClient';
import { openSettingsOverlay } from './ui/modal';

self.addEventListener('unhandledrejection', (event: PromiseRejectionEvent) => {
  console.error('[Atenna] unhandledrejection:', event.reason);
});

const SUPPORTED_HOSTS = ['chatgpt.com', 'chat.openai.com', 'claude.ai', 'gemini.google.com', 'perplexity.ai'];

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

function relayToggleModal(tabId: number): void {
  chrome.runtime.sendMessage({ type: 'RELAY_TOGGLE_MODAL', tabId }, () => void chrome.runtime.lastError);
}

function relayInjectBadge(tabId: number): void {
  chrome.runtime.sendMessage({ type: 'RELAY_INJECT_BADGE', tabId }, () => void chrome.runtime.lastError);
}

async function getActiveTabId(): Promise<number | null> {
  return new Promise(resolve => {
    chrome.tabs.query({ active: true }, tabs => {
      // Find the non-popup tab (popup has url chrome-extension://)
      const tab = tabs.find(t => t.url && !t.url.startsWith('chrome-extension://')) ?? tabs[0];
      resolve(tab?.id ?? null);
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
  if (host.includes('perplexity')) return { name: 'Perplexity', svg: SVG_GLOBE };
  return { name: host, svg: SVG_GLOBE };
}

export function renderSkeleton(container: HTMLElement): void {
  container.innerHTML = '';
  const sk = document.createElement('div');
  sk.className = 'ap-skeleton';
  for (const w of ['60', '40']) {
    const line = document.createElement('div');
    line.className = `ap-sk-line ap-sk-w${w}`;
    sk.appendChild(line);
  }
  container.appendChild(sk);
}

export function replaceSkeleton(container: HTMLElement, content: HTMLElement): void {
  container.innerHTML = '';
  container.appendChild(content);
}

async function isOnboarded(): Promise<boolean> {
  return new Promise(resolve => {
    chrome.storage.local.get('atenna_onboarded', r => resolve(!!r['atenna_onboarded']));
  });
}

async function markOnboarded(): Promise<void> {
  return new Promise(resolve => {
    chrome.storage.local.set({ atenna_onboarded: true }, resolve);
  });
}

export async function initPopup(): Promise<void> {
  const container = document.getElementById('atenna-popup')!;
  renderSkeleton(container);

  const [me, tabInfo, tabId] = await Promise.all([bffMe(), getActiveTabInfo(), getActiveTabId()]);

  if (!me) {
    renderLogin(container, tabId, tabInfo?.supported ?? false);
    return;
  }

  const onboarded = await isOnboarded();
  if (!onboarded) {
    renderFirstRunOnboarding(container, () => renderHome(container, me, tabInfo, tabId));
    return;
  }

  renderHome(container, me, tabInfo, tabId);
}

const EYE_OPEN  = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>`;
const EYE_CLOSE = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94"/><path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19"/><line x1="1" y1="1" x2="23" y2="23"/></svg>`;

export function renderPasswordResetConfirmation(container: HTMLElement, email: string): void {
  container.innerHTML = '';
  const wrap = document.createElement('div');
  wrap.className = 'ap-root ap-root--login';

  const icon = document.createElement('div');
  icon.style.cssText = 'font-size:32px;text-align:center;margin-bottom:8px';
  icon.textContent = '✉️';

  const title = document.createElement('h2');
  title.className = 'ap-title';
  title.textContent = 'Email enviado';

  const body = document.createElement('p');
  body.className = 'ap-subtitle';
  body.textContent = `Verifique sua caixa de entrada em ${email} e clique no link para redefinir a senha.`;

  const backBtn = document.createElement('button');
  backBtn.className = 'ap-link-btn';
  backBtn.textContent = '← Voltar ao login';
  backBtn.addEventListener('click', () => renderLogin(container, null));

  wrap.append(icon, title, body, backBtn);
  container.appendChild(wrap);
}

function renderOnboarding(container: HTMLElement): void {
  container.innerHTML = '';
  const wrap = document.createElement('div');
  wrap.className = 'ap-root ap-root--login';
  wrap.style.cssText = 'display:flex;flex-direction:column;align-items:center;gap:16px;padding:28px 20px;text-align:center;';

  wrap.innerHTML = `
    <div style="width:56px;height:56px;border-radius:50%;background:rgba(34,197,94,0.15);display:flex;align-items:center;justify-content:center;">
      <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#22c55e" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>
    </div>
    <h3 style="margin:0;font-size:16px;font-weight:700;color:#f0f0f0;">Você está protegido! 🛡️</h3>
    <p style="margin:0;font-size:13px;color:#888;line-height:1.6;">
      Abra uma das plataformas abaixo.<br/>
      O badge Atenna aparecerá automaticamente no campo de texto.
    </p>
    <div style="display:flex;flex-direction:column;gap:8px;width:100%;">
      <a id="ob-chatgpt" href="https://chatgpt.com" target="_blank" rel="noopener noreferrer"
         style="display:flex;align-items:center;gap:10px;padding:10px 14px;border-radius:8px;background:#1a1a1a;border:1px solid #2a2a2a;text-decoration:none;color:#f0f0f0;font-size:13px;font-weight:500;cursor:pointer;">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#10a37f" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
        Abrir ChatGPT
        <span style="margin-left:auto;color:#555;font-size:11px;">chatgpt.com</span>
      </a>
      <a id="ob-claude" href="https://claude.ai" target="_blank" rel="noopener noreferrer"
         style="display:flex;align-items:center;gap:10px;padding:10px 14px;border-radius:8px;background:#1a1a1a;border:1px solid #2a2a2a;text-decoration:none;color:#f0f0f0;font-size:13px;font-weight:500;cursor:pointer;">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#cc785c" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2l2.4 7.4H22l-6.2 4.5 2.4 7.4L12 17l-6.2 4.3 2.4-7.4L2 9.4h7.6z"/></svg>
        Abrir Claude.ai
        <span style="margin-left:auto;color:#555;font-size:11px;">claude.ai</span>
      </a>
      <a id="ob-gemini" href="https://gemini.google.com" target="_blank" rel="noopener noreferrer"
         style="display:flex;align-items:center;gap:10px;padding:10px 14px;border-radius:8px;background:#1a1a1a;border:1px solid #2a2a2a;text-decoration:none;color:#f0f0f0;font-size:13px;font-weight:500;cursor:pointer;">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#4285f4" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M12 8v4l3 3"/></svg>
        Abrir Gemini
        <span style="margin-left:auto;color:#555;font-size:11px;">gemini.google.com</span>
      </a>
      <a id="ob-perplexity" href="https://www.perplexity.ai" target="_blank" rel="noopener noreferrer"
         style="display:flex;align-items:center;gap:10px;padding:10px 14px;border-radius:8px;background:#1a1a1a;border:1px solid #2a2a2a;text-decoration:none;color:#f0f0f0;font-size:13px;font-weight:500;cursor:pointer;">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#20b2aa" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
        Abrir Perplexity
        <span style="margin-left:auto;color:#555;font-size:11px;">perplexity.ai</span>
      </a>
    </div>
    <p style="margin:0;font-size:11px;color:#555;">
      Ao abrir a plataforma, o badge <strong style="color:#22c55e">⚡ Atenna</strong> aparece no canto do campo de chat.
    </p>
  `;

  container.appendChild(wrap);

  // Close popup when user clicks any platform link
  ['ob-chatgpt', 'ob-claude', 'ob-gemini', 'ob-perplexity'].forEach(id => {
    wrap.querySelector(`#${id}`)?.addEventListener('click', () => {
      setTimeout(() => window.close(), 300);
    });
  });
}

function renderLogin(container: HTMLElement, tabId: number | null, tabSupported = false): void {
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
      <div class="ap-login-divider"><span>ou</span></div>
      <button class="ap-btn ap-btn--google" id="ap-google-btn">
        <svg width="16" height="16" viewBox="0 0 48 48" aria-hidden="true"><path fill="#EA4335" d="M24 9.5c3.14 0 5.95 1.08 8.17 2.86l6.1-6.1C34.46 3.01 29.5 1 24 1 14.85 1 7.08 6.48 3.69 14.24l7.1 5.52C12.53 13.1 17.83 9.5 24 9.5z"/><path fill="#4285F4" d="M46.52 24.5c0-1.64-.15-3.22-.43-4.75H24v9h12.7c-.55 2.99-2.2 5.53-4.68 7.24l7.18 5.58C43.44 37.44 46.52 31.42 46.52 24.5z"/><path fill="#FBBC05" d="M10.8 28.5A14.52 14.52 0 0 1 9.5 24c0-1.57.27-3.09.76-4.5l-7.1-5.52A23.94 23.94 0 0 0 0 24c0 3.87.93 7.53 2.57 10.76l8.23-6.26z"/><path fill="#34A853" d="M24 47c5.5 0 10.12-1.83 13.49-4.96l-7.18-5.58C28.54 37.77 26.38 38.5 24 38.5c-6.17 0-11.47-3.6-13.2-8.76l-8.23 6.26C6.08 43.52 14.45 47 24 47z"/></svg>
        Entrar com Google
      </button>
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
    try {
      await bffResetPassword(email);
      renderPasswordResetConfirmation(container, email);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Erro ao enviar email.';
      errEl.textContent = msg; errEl.style.display = 'block';
    }
  });

  const doAction = async () => {
    const email = emailEl.value.trim();
    const pass  = passEl.value;
    errEl.style.color = ''; errEl.style.background = ''; errEl.style.borderColor = '';
    if (!email) { errEl.textContent = 'Digite seu email.'; errEl.style.display = 'block'; emailEl.focus(); return; }
    if (!pass && mode !== 'forgot') { errEl.textContent = 'Digite sua senha.'; errEl.style.display = 'block'; passEl.focus(); return; }
    btn.disabled = true; btn.textContent = mode === 'signup' ? 'Criando…' : 'Entrando…';
    errEl.style.display = 'none';
    try {
      if (mode === 'signup') {
        const name = nameEl.value.trim();
        const { error } = await signUpWithPassword(email, pass, name || undefined);
        if (error) throw new Error(error);
        container.innerHTML = `
          <div style="display:flex;flex-direction:column;align-items:center;gap:16px;padding:28px 20px;text-align:center;">
            <div style="width:56px;height:56px;border-radius:50%;background:rgba(59,130,246,0.12);display:flex;align-items:center;justify-content:center;">
              <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#3b82f6" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="4" width="20" height="16" rx="2"/><path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7"/></svg>
            </div>
            <h3 style="margin:0;font-size:15px;font-weight:600;color:#1a1a2e;">Verifique seu email</h3>
            <p style="margin:0;font-size:12px;color:#666;line-height:1.5;">Enviamos um link de confirmação para<br><strong>${email}</strong>.<br>Clique no link para ativar sua conta.</p>
            <a href="https://mail.google.com/" target="_blank" rel="noopener noreferrer"
               style="display:flex;align-items:center;gap:6px;background:#3b82f6;color:#fff;padding:9px 18px;border-radius:8px;text-decoration:none;font-size:13px;font-weight:500;">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="4" width="20" height="16" rx="2"/><path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7"/></svg>
              Abrir Gmail
            </a>
            <button id="ap-back-to-login" style="background:none;border:none;color:#3b82f6;cursor:pointer;font-size:12px;text-decoration:underline;">Voltar ao login</button>
          </div>`;
        const backBtn = container.querySelector('#ap-back-to-login') as HTMLButtonElement | null;
        if (backBtn) {
          backBtn.addEventListener('click', () => renderLogin(container, tabId));
        }
        return;
      } else {
        await bffLogin(email, pass);
        if (tabId && tabSupported) {
          relayInjectBadge(tabId);
          window.close();
        } else {
          renderOnboarding(container);
        }
      }
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Erro.';
      if (msg.includes('email_not_found') || msg.includes('user_not_found')) {
        errEl.textContent = 'Email não encontrado. Verifique o endereço ou crie uma conta.';
      } else if (msg.includes('wrong_password') || msg.includes('Invalid login credentials') || msg.includes('invalid_credentials')) {
        errEl.textContent = 'Senha incorreta. Verifique sua senha e tente novamente.';
      } else if (msg.includes('email_not_confirmed') || msg.includes('Email not confirmed')) {
        errEl.textContent = 'Conta não confirmada. Verifique seu email e clique no link de ativação.';
      } else if (msg.includes('too_many_requests') || msg.includes('rate_limit')) {
        errEl.textContent = 'Muitas tentativas. Aguarde alguns minutos.';
      } else {
        errEl.textContent = msg || 'Erro inesperado. Tente novamente.';
      }
      errEl.style.display = 'block';
      btn.disabled = false; btn.textContent = mode === 'signup' ? 'Criar conta' : 'Entrar';
    }
  };

  btn.addEventListener('click', () => void doAction());
  passEl.addEventListener('keydown', e => { if (e.key === 'Enter') void doAction(); });

  const googleBtn = document.getElementById('ap-google-btn') as HTMLButtonElement;
  googleBtn.addEventListener('click', async () => {
    googleBtn.disabled = true;
    googleBtn.textContent = 'Aguardando Google…';
    errEl.style.display = 'none';
    try {
      await bffGoogleLogin();
      if (tabId && tabSupported) { relayInjectBadge(tabId); window.close(); }
      else { renderOnboarding(container); }
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Erro no login com Google.';
      errEl.textContent = msg.includes('NETWORK') ? 'Sem conexão ou login cancelado.' : msg;
      errEl.style.display = 'block';
      googleBtn.disabled = false;
      googleBtn.innerHTML = `<svg width="16" height="16" viewBox="0 0 48 48" aria-hidden="true"><path fill="#EA4335" d="M24 9.5c3.14 0 5.95 1.08 8.17 2.86l6.1-6.1C34.46 3.01 29.5 1 24 1 14.85 1 7.08 6.48 3.69 14.24l7.1 5.52C12.53 13.1 17.83 9.5 24 9.5z"/><path fill="#4285F4" d="M46.52 24.5c0-1.64-.15-3.22-.43-4.75H24v9h12.7c-.55 2.99-2.2 5.53-4.68 7.24l7.18 5.58C43.44 37.44 46.52 31.42 46.52 24.5z"/><path fill="#FBBC05" d="M10.8 28.5A14.52 14.52 0 0 1 9.5 24c0-1.57.27-3.09.76-4.5l-7.1-5.52A23.94 23.94 0 0 0 0 24c0 3.87.93 7.53 2.57 10.76l8.23-6.26z"/><path fill="#34A853" d="M24 47c5.5 0 10.12-1.83 13.49-4.96l-7.18-5.58C28.54 37.77 26.38 38.5 24 38.5c-6.17 0-11.47-3.6-13.2-8.76l-8.23 6.26C6.08 43.52 14.45 47 24 47z"/></svg> Entrar com Google`;
    }
  });
}

function renderFirstRunOnboarding(
  container: HTMLElement,
  onDone: () => void,
): void {
  container.innerHTML = '';

  const slides = [
    { icon: '🛡️', title: 'Seus dados ficam no seu dispositivo', body: 'O DLP escaneia localmente antes de qualquer envio. Nenhuma informação sensível sai do Chrome.' },
    { icon: '✨', title: 'Prompts mais eficazes', body: 'A IA transforma seu rascunho em 3 versões profissionais: direta, estruturada e técnica.' },
    { icon: '👤', title: 'Ativo em 4 plataformas', body: 'O badge Atenna aparece automaticamente no ChatGPT, Claude.ai, Gemini e Perplexity.' },
  ];

  const wrap = document.createElement('div');
  wrap.className = 'ap-root ap-root--login';
  wrap.style.cssText = 'display:flex;flex-direction:column;align-items:center;gap:12px;padding:24px 20px;text-align:center;';

  const slideList = document.createElement('div');
  slideList.style.cssText = 'display:flex;flex-direction:column;gap:12px;width:100%;';

  slides.forEach(({ icon, title, body }) => {
    const slide = document.createElement('div');
    slide.className = 'ap-onboarding__slide';
    slide.style.cssText = 'padding:12px 14px;border-radius:8px;background:#1a1a1a;border:1px solid #2a2a2a;text-align:left;';

    const header = document.createElement('div');
    header.style.cssText = 'display:flex;align-items:center;gap:8px;margin-bottom:4px;';

    const iconEl = document.createElement('span');
    iconEl.style.cssText = 'font-size:18px;line-height:1;';
    iconEl.textContent = icon;

    const titleEl = document.createElement('strong');
    titleEl.style.cssText = 'font-size:13px;color:#f0f0f0;font-family:inherit;';
    titleEl.textContent = title;

    header.appendChild(iconEl);
    header.appendChild(titleEl);

    const bodyEl = document.createElement('p');
    bodyEl.style.cssText = 'margin:0;font-size:12px;color:#888;line-height:1.5;font-family:inherit;';
    bodyEl.textContent = body;

    slide.appendChild(header);
    slide.appendChild(bodyEl);
    slideList.appendChild(slide);
  });

  const cta = document.createElement('button');
  cta.id = 'ap-onboarding-cta';
  cta.className = 'ap-btn ap-btn--primary';
  cta.style.cssText = 'width:100%;margin-top:4px;';
  cta.textContent = 'Entendi, começar →';
  cta.addEventListener('click', () => {
    void markOnboarded().then(onDone);
  });

  wrap.appendChild(slideList);
  wrap.appendChild(cta);
  container.appendChild(wrap);
}

function renderHome(
  container: HTMLElement,
  me: { email: string; plan: string },
  tabInfo: { host: string; supported: boolean } | null,
  tabId: number | null,
): void {
  const isPro = me.plan === 'pro';
  const supported = tabInfo?.supported ?? false;
  const platform = tabInfo ? getPlatformLabel(tabInfo.host) : null;
  const logoUrl = chrome.runtime.getURL('icons/icon128.png');

  container.innerHTML = `
    <div class="ap-root">
      <div class="ap-header">
        <img src="${logoUrl}" class="ap-header__logo" alt="Atenna"/>
        <div class="ap-header__info">
          <div class="ap-header__name">Atenna Safe</div>
          <div class="ap-header__email" id="ap-header-email"></div>
        </div>
        <span class="ap-badge ap-badge--${isPro ? 'pro' : 'free'}">${isPro ? 'PRO ✓' : 'FREE'}</span>
      </div>

      <div class="ap-platform ap-platform--${supported ? 'ok' : 'warn'}">
        ${supported
          ? `<span class="ap-platform__dot ap-platform__dot--green"></span>
             <span class="ap-platform__icon">${platform!.svg}</span>
             <span>${platform!.name} — protegido e ativo</span>`
          : `<span class="ap-platform__dot ap-platform__dot--gray"></span>
             <span>Abra o ChatGPT, Claude.ai, Gemini ou Perplexity para ativar</span>`
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
            <span>chatgpt.com</span><span>claude.ai</span><span>gemini.google.com</span><span>perplexity.ai</span>
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

  // Set user-controlled data via textContent to prevent XSS
  const emailEl = document.getElementById('ap-header-email');
  if (emailEl) emailEl.textContent = me.email;

  document.getElementById('ap-open-modal')?.addEventListener('click', () => {
    if (tabId) relayToggleModal(tabId);
    window.close();
  });

  document.getElementById('ap-settings-btn')!.addEventListener('click', () => {
    void openSettingsOverlay();
  });

  document.getElementById('ap-logout-btn')!.addEventListener('click', async () => {
    if (!confirm('Deseja sair da sua conta Atenna?')) return;
    await bffLogout();
    await new Promise<void>(r => chrome.storage.local.remove(
      ['atenna_plan', 'atenna_app_onboarding_seen', 'atenna_onboarding_seen'],
      () => r()
    ));
    window.location.reload();
  });
}

void initPopup();
