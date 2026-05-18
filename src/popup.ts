import { getActiveSession, clearSession } from './core/auth';
import { getPlan } from './core/planManager';
import { openSettingsOverlay, toggleModal } from './ui/modal';

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

function getPlatformLabel(host: string): { name: string; icon: string } {
  if (host.includes('chatgpt') || host.includes('openai')) return { name: 'ChatGPT', icon: '🤖' };
  if (host.includes('claude')) return { name: 'Claude.ai', icon: '⚡' };
  if (host.includes('gemini')) return { name: 'Gemini', icon: '✨' };
  if (host.includes('copilot')) return { name: 'Copilot', icon: '🪁' };
  return { name: host, icon: '🌐' };
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

function renderLogin(container: HTMLElement): void {
  container.innerHTML = `
    <div class="ap-login">
      <img src="${chrome.runtime.getURL('icons/icon128.png')}" class="ap-logo" alt="Atenna"/>
      <div class="ap-login__title">Bem-vindo ao Atenna</div>
      <div class="ap-login__sub">Uma camada de segurança para seus prompts de IA.</div>
      <button class="ap-btn ap-btn--primary" id="ap-open-login">Entrar / Criar conta</button>
    </div>
  `;
  document.getElementById('ap-open-login')!.addEventListener('click', () => {
    void toggleModal();
  });
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
      <!-- Header: logo + user -->
      <div class="ap-header">
        <img src="${logoUrl}" class="ap-header__logo" alt="Atenna"/>
        <div class="ap-header__info">
          <div class="ap-header__name">Atenna Safe</div>
          <div class="ap-header__email">${session.email}</div>
        </div>
        <span class="ap-badge ap-badge--${isPro ? 'pro' : 'free'}">${isPro ? 'PRO ✓' : 'FREE'}</span>
      </div>

      <!-- Platform status -->
      <div class="ap-platform ap-platform--${supported ? 'ok' : 'warn'}">
        ${supported
          ? `<span class="ap-platform__dot ap-platform__dot--green"></span>
             <span>${platform!.icon} ${platform!.name} — protegido e ativo</span>`
          : `<span class="ap-platform__dot ap-platform__dot--gray"></span>
             <span>Abra o ChatGPT, Claude.ai ou Gemini para ativar</span>`
        }
      </div>

      <!-- Main action -->
      <button class="ap-btn ap-btn--primary ap-btn--big" id="ap-open-modal" ${!supported ? 'disabled' : ''}>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M12 8v4l3 3"/></svg>
        ${supported ? 'Abrir Atenna' : 'Nenhuma plataforma ativa'}
      </button>

      <!-- Quick tips if no supported platform -->
      ${!supported ? `
        <div class="ap-tips">
          <div class="ap-tips__title">Plataformas suportadas</div>
          <div class="ap-tips__list">
            <span>🤖 chatgpt.com</span>
            <span>⚡ claude.ai</span>
            <span>✨ gemini.google.com</span>
          </div>
        </div>
      ` : `
        <div class="ap-features">
          <div class="ap-feature">
            <span class="ap-feature__icon">🛡️</span>
            <span>DLP — detecta CPF, cartão, senhas antes do envio</span>
          </div>
          <div class="ap-feature">
            <span class="ap-feature__icon">✍️</span>
            <span>Refine prompts com IA integrada</span>
          </div>
          <div class="ap-feature">
            <span class="ap-feature__icon">📄</span>
            <span>Scan de documentos PDF/CSV até 100 MB</span>
          </div>
        </div>
      `}

      <!-- Footer actions -->
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

  document.getElementById('ap-settings-btn')!.addEventListener('click', async () => {
    // Open settings inside popup context — uses the existing openSettingsOverlay which
    // detects #atenna-popup and renders inside it, not on the page
    await openSettingsOverlay();
  });

  document.getElementById('ap-logout-btn')!.addEventListener('click', async () => {
    await clearSession();
    // Remove all plan + onboarding cache so next login starts fresh
    await new Promise<void>(r => chrome.storage.local.remove(
      ['atenna_plan', 'atenna_app_onboarding_seen', 'atenna_onboarding_seen'],
      () => r()
    ));
    renderLogin(container);
  });
}

void initPopup();
