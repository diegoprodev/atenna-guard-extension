import { initObservability } from './core/observability';
initObservability('popup');
import { signUpWithPassword } from './core/auth';
import { messageFor } from './core/errors';
import { bffLogin, bffLogout, bffMe, bffResetPassword, bffGoogleLogin } from './auth/bffClient';
import { openSettingsOverlay } from './ui/modal';
import { icon } from './ui/icons';

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

const SVG_SHIELD = icon('shield', { size: 13 });
const SVG_SPARKLE = icon('sparkles', { size: 13 });
const SVG_FILE = icon('fileText', { size: 13 });
const SVG_GLOBE = icon('globe', { size: 13 });

function getPlatformLabel(host: string): { name: string; svg: string } {
  if (host.includes('chatgpt') || host.includes('openai')) return { name: 'ChatGPT', svg: SVG_SPARKLE };
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

export async function initPopup(): Promise<void> {
  const container = document.getElementById('atenna-popup')!;
  renderSkeleton(container);

  const [me, tabInfo, tabId] = await Promise.all([bffMe(), getActiveTabInfo(), getActiveTabId()]);

  if (!me) {
    // Sem sessão → login DENTRO do popup, com a mensagem amigável de valor
    // (não depender do content script nem fechar o popup — bug "abre skeleton
    // e some"). O welcome de boas-vindas é aberto pelo onInstalled do background.
    renderLogin(container, tabId, tabInfo?.supported ?? false);
    return;
  }

  // Check if first-run onboarding has been seen
  const onboardingStorage = await new Promise<Record<string, unknown>>(resolve => {
    chrome.storage.local.get('atenna_onboarded', resolve);
  });
  const isOnboarded = onboardingStorage['atenna_onboarded'] === true;

  if (!isOnboarded) {
    renderOnboarding(container);
  } else {
    renderHome(container, me, tabInfo, tabId);
  }
}

const EYE_OPEN  = icon('eye', { size: 16 });
const EYE_CLOSE = icon('eyeOff', { size: 16 });

export function renderPasswordResetConfirmation(container: HTMLElement, email: string): void {
  container.innerHTML = '';
  const wrap = document.createElement('div');
  wrap.className = 'ap-state';

  const icon = document.createElement('div');
  icon.className = 'ap-state__icon';
  icon.innerHTML = SVG_MAIL;

  const title = document.createElement('div');
  title.className = 'ap-state__title';
  title.textContent = 'Link enviado';

  const body = document.createElement('p');
  body.className = 'ap-state__text';
  body.append('Abra o email em ');
  const strong = document.createElement('strong');
  strong.textContent = email;
  body.append(strong, ' e clique no link para redefinir a senha.');

  const backBtn = document.createElement('button');
  backBtn.className = 'ap-link-btn';
  backBtn.textContent = 'Voltar ao login';
  backBtn.addEventListener('click', () => renderLogin(container, null));

  wrap.append(icon, title, body, backBtn);
  container.appendChild(wrap);
}

const PLATFORMS = [
  { id: 'ob-chatgpt',    name: 'ChatGPT',    url: 'https://chatgpt.com',        host: 'chatgpt.com',        icon: 'icons/openai.svg' },
  { id: 'ob-claude',     name: 'Claude',     url: 'https://claude.ai',          host: 'claude.ai',          icon: 'icons/anthropic.svg' },
  { id: 'ob-gemini',     name: 'Gemini',     url: 'https://gemini.google.com',  host: 'gemini.google.com',  icon: 'icons/gemini.svg' },
  { id: 'ob-perplexity', name: 'Perplexity', url: 'https://www.perplexity.ai',  host: 'perplexity.ai',      icon: 'icons/perplexity.svg' },
];

function platformLinksHtml(): string {
  return PLATFORMS.map(p => `
      <a id="${p.id}" class="ap-link-row" href="${p.url}" target="_blank" rel="noopener noreferrer">
        <span class="ap-link-row__ico"><img src="${chrome.runtime.getURL(p.icon)}" width="16" height="16" alt=""></span>
        ${p.name}
        <span class="ap-link-row__host">${p.host}</span>
      </a>`).join('');
}

const SVG_CHECK_CIRCLE = icon('checkCircle', { size: 26, stroke: 1.8 });
const SVG_MAIL = icon('mail', { size: 24, stroke: 1.8 });

function renderOnboarding(container: HTMLElement): void {
  container.innerHTML = `
    <div class="ap-state">
      <div class="ap-state__icon">${SVG_CHECK_CIRCLE}</div>
      <div class="ap-state__title">Tudo pronto</div>
      <p class="ap-state__text">Abra uma das plataformas abaixo.<br>O botão da Atenna aparece sozinho no campo de mensagem.</p>
      <div class="ap-links">${platformLinksHtml()}</div>
      <button id="ap-onboarding-cta" class="ap-cta">Continuar</button>
    </div>
  `;
  const wrap = container.firstElementChild as HTMLElement;

  // Mark onboarding as seen when CTA is clicked
  const ctaBtn = wrap.querySelector('#ap-onboarding-cta') as HTMLButtonElement;
  if (ctaBtn) {
    ctaBtn.addEventListener('click', async () => {
      await new Promise<void>(resolve => {
        chrome.storage.local.set({ atenna_onboarded: true }, resolve);
      });
      // After marking as seen, reinit to show home
      const [me, tabInfo, tabId] = await Promise.all([bffMe(), getActiveTabInfo(), getActiveTabId()]);
      if (me) renderHome(container, me, tabInfo, tabId);
    });
  }

  // Close popup when user clicks any platform link
  PLATFORMS.forEach(({ id }) => {
    wrap.querySelector(`#${id}`)?.addEventListener('click', () => {
      // marca onboarding como visto também ao abrir uma plataforma (não só no CTA)
      chrome.storage.local.set({ atenna_onboarded: true });
      setTimeout(() => window.close(), 300);
    });
  });
}

function renderLogin(container: HTMLElement, tabId: number | null, tabSupported = false): void {
  const logoUrl = chrome.runtime.getURL('icons/icon128.png');
  container.innerHTML = `
    <div class="ap-root ap-root--login">
      <div class="ap-login-logo">
        <img src="${logoUrl}" alt="Atenna" width="52" height="52"/>
      </div>
      <div class="ap-login-title" id="ap-login-title">Entrar na sua conta</div>
      <p class="ap-login-sub" id="ap-login-sub">Faça login para liberar a proteção de dados e a geração de prompts da Atenna Safe Prompt.</p>
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
        <span aria-hidden="true">·</span>
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
    titleEl.textContent = isSignup ? 'Criar conta grátis' : 'Entrar na sua conta';
    const subEl = document.getElementById('ap-login-sub');
    if (subEl) subEl.textContent = isSignup
      ? 'Leva 30 segundos. Sem cartão. Você já sai protegido.'
      : 'Faça login para liberar a proteção de dados e a geração de prompts da Atenna Safe Prompt.';
    nameEl.style.display = isSignup ? '' : 'none';
    passEl.style.display = '';
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
      errEl.textContent = messageFor(err); errEl.style.display = 'block';
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
        // Tela de confirmação — DOM APIs, nunca interpolar dado do usuário em innerHTML
        container.innerHTML = '';
        const confirmWrapper = document.createElement('div');
        confirmWrapper.className = 'ap-state';

        const iconWrap = document.createElement('div');
        iconWrap.className = 'ap-state__icon';
        iconWrap.innerHTML = SVG_MAIL;
        confirmWrapper.appendChild(iconWrap);

        const h3 = document.createElement('div');
        h3.className = 'ap-state__title';
        h3.textContent = 'Confirme seu email';
        confirmWrapper.appendChild(h3);

        const p = document.createElement('p');
        p.className = 'ap-state__text';
        p.append('Enviamos um link de confirmação para ');
        const strong = document.createElement('strong');
        strong.textContent = email; // textContent = seguro, nunca executa HTML
        p.append(strong, '. Clique no link para ativar a conta.');
        confirmWrapper.appendChild(p);

        const backBtn = document.createElement('button');
        backBtn.id = 'ap-back-to-login';
        backBtn.className = 'ap-link-btn';
        backBtn.textContent = 'Voltar ao login';
        confirmWrapper.appendChild(backBtn);

        container.appendChild(confirmWrapper);
        backBtn.addEventListener('click', () => renderLogin(container, tabId));
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
      // signUpWithPassword já devolve mensagem em pt-BR (via new Error(texto)).
      // bffLogin lança AppError, cujo .message é só o código ("INVALID_CREDENTIALS")
      // — nunca renderizar cru: passa por messageFor() pra virar pt-BR.
      const raw = e instanceof Error ? e.message : '';
      const isCode = /^[A-Z_]+$/.test(raw);
      if (!isCode && raw.includes('email_not_confirmed')) {
        errEl.textContent = 'Conta não confirmada. Verifique seu email e clique no link de ativação.';
      } else if (!isCode && raw && !/error|fail|exception/i.test(raw)) {
        errEl.textContent = raw; // mensagem pt-BR do signUpWithPassword
      } else {
        errEl.textContent = messageFor(e);
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
      const raw = e instanceof Error ? e.message : '';
      errEl.textContent = raw.includes('NETWORK') ? 'Sem conexão ou login cancelado.' : messageFor(e);
      errEl.style.display = 'block';
      googleBtn.disabled = false;
      googleBtn.innerHTML = `<svg width="16" height="16" viewBox="0 0 48 48" aria-hidden="true"><path fill="#EA4335" d="M24 9.5c3.14 0 5.95 1.08 8.17 2.86l6.1-6.1C34.46 3.01 29.5 1 24 1 14.85 1 7.08 6.48 3.69 14.24l7.1 5.52C12.53 13.1 17.83 9.5 24 9.5z"/><path fill="#4285F4" d="M46.52 24.5c0-1.64-.15-3.22-.43-4.75H24v9h12.7c-.55 2.99-2.2 5.53-4.68 7.24l7.18 5.58C43.44 37.44 46.52 31.42 46.52 24.5z"/><path fill="#FBBC05" d="M10.8 28.5A14.52 14.52 0 0 1 9.5 24c0-1.57.27-3.09.76-4.5l-7.1-5.52A23.94 23.94 0 0 0 0 24c0 3.87.93 7.53 2.57 10.76l8.23-6.26z"/><path fill="#34A853" d="M24 47c5.5 0 10.12-1.83 13.49-4.96l-7.18-5.58C28.54 37.77 26.38 38.5 24 38.5c-6.17 0-11.47-3.6-13.2-8.76l-8.23 6.26C6.08 43.52 14.45 47 24 47z"/></svg> Entrar com Google`;
    }
  });
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
        <span class="ap-badge ap-badge--${isPro ? 'pro' : 'free'}">${isPro ? 'PRO' : 'FREE'}</span>
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
        ${icon('clock', { size: 16, stroke: 2.2 })}
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
          ${icon('settings', { size: 14 })}
          Configurações
        </button>
        <button class="ap-footer__btn ap-footer__btn--danger" id="ap-logout-btn">
          ${icon('logOut', { size: 14 })}
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
