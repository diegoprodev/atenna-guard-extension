import { icon } from '../icons';
import { clearMsgInterval, getLogoUrl } from './utils';
import { trackEvent } from '../../core/analytics';
import type { Advisory } from '../../dlp/types';

// ─── DLP Advisory (Layer 3 UX) ────────────────────────────────

export const SHIELD_SVG = icon('shield', { size: 16, stroke: 1.6 });

/**
 * Shows DLP advisory above the content area.
 * Returns a Promise that resolves true (proceed) or false (user wants to review).
 * For LOW/NONE resolves immediately without showing UI.
 */
export function showDlpAdvisory(
  advisory:  Advisory,
  container: HTMLElement,
): Promise<boolean> {
  return new Promise(resolve => {
    if (!advisory.show) { resolve(true); return; }

    const el = document.createElement('div');
    el.className = `atenna-dlp-advisory atenna-dlp-advisory--${advisory.riskLevel.toLowerCase()}`;

    const header = document.createElement('div');
    header.className = 'atenna-dlp-advisory__header';

    const icon = document.createElement('span');
    icon.className = 'atenna-dlp-advisory__icon';
    icon.innerHTML = SHIELD_SVG;

    const msg = document.createElement('p');
    msg.className = 'atenna-dlp-advisory__msg';
    msg.textContent = advisory.message;

    header.appendChild(icon);
    header.appendChild(msg);
    el.appendChild(header);

    // Entity pills
    if (advisory.entities.length > 0 && advisory.riskLevel !== 'LOW') {
      const pills = document.createElement('div');
      pills.className = 'atenna-dlp-advisory__entities';
      const seen = new Set<string>();
      advisory.entities.forEach(e => {
        if (!seen.has(e.type)) {
          seen.add(e.type);
          const pill = document.createElement('span');
          pill.className = 'atenna-dlp-advisory__pill';
          pill.textContent = e.type.replace('_', ' ');
          pills.appendChild(pill);
        }
      });
      el.appendChild(pills);
    }

    // Action buttons
    if (advisory.primaryCta) {
      const actions = document.createElement('div');
      actions.className = 'atenna-dlp-advisory__actions';

      const primary = document.createElement('button');
      primary.className = 'atenna-dlp-advisory__btn-primary';
      primary.textContent = advisory.primaryCta;
      primary.addEventListener('click', () => { el.remove(); resolve(true); });

      actions.appendChild(primary);

      if (advisory.secondaryCta) {
        const secondary = document.createElement('button');
        secondary.className = 'atenna-dlp-advisory__btn-secondary';
        secondary.textContent = advisory.secondaryCta;
        secondary.addEventListener('click', () => {
          void trackEvent('dlp_send_override');
          el.remove();
          resolve(true);
        });
        actions.appendChild(secondary);
      }

      el.appendChild(actions);
    }

    container.prepend(el);
  });
}


const ONB_ICON_CLARITY = icon('clock', { size: 20 });
const ONB_ICON_SHIELD  = icon('shield', { size: 20 });
const ONB_ICON_FLOW    = icon('sparkles', { size: 20 });

export function renderPreLoginOnboarding(container: HTMLElement, switchView: (view: string) => void): void {
  void trackEvent('onboarding_shown');
  chrome.storage.local.set({ atenna_onboarding_seen: true });
  clearMsgInterval();
  container.innerHTML = '';

  const logoUrl = getLogoUrl();
  const logoImg = logoUrl ? `<img src="${logoUrl}" width="200" height="200" alt="Atenna" style="display:block;margin:0 auto;width:200px;height:200px !important;"/>` : '<div style="width:200px;height:200px;margin:0 auto;background:#22c55e;border-radius:50%;"></div>';

  // Stage 1: Show ONLY the animated logo (in popup context)
  const popupContainer = document.getElementById('atenna-popup');
  if (popupContainer) {
    const logoOnlyDiv = document.createElement('div');
    logoOnlyDiv.className = 'atenna-modal__onboarding';
    logoOnlyDiv.style.cssText = 'display:flex;align-items:center;justify-content:center;min-height:300px;';

    const logodiv = document.createElement('div');
    logodiv.className = 'atenna-modal__onb-logo-anim';
    logodiv.innerHTML = logoImg;
    logodiv.style.cssText = 'margin:0;padding:0;';

    logoOnlyDiv.appendChild(logodiv);
    container.appendChild(logoOnlyDiv);

    // After logo animation (4000ms), replace with content
    setTimeout(() => {
      container.innerHTML = '';

      const wrap = document.createElement('div');
      wrap.className = 'atenna-modal__onboarding atenna-modal__onboarding--fade-in';

      wrap.innerHTML = `
        <div class="atenna-modal__onb-hero">
          <div class="atenna-modal__onb-wordmark">Atenna</div>
          <div class="atenna-modal__onb-headline">Clareza antes da inteligência.</div>
          <p class="atenna-modal__onb-sub">Uma camada entre você e a IA — para que suas intenções cheguem com precisão.</p>
        </div>
        <ul class="atenna-modal__onb-features">
          <li>
            <span class="atenna-modal__onb-icon">${ONB_ICON_CLARITY}</span>
            <div><strong>Organiza instruções complexas</strong><span>Estrutura sua intenção em versões claras e objetivas</span></div>
          </li>
          <li>
            <span class="atenna-modal__onb-icon">${ONB_ICON_SHIELD}</span>
            <div><strong>Detecta dados sensíveis</strong><span>Alerta sobre possíveis informações pessoais antes do envio</span></div>
          </li>
          <li>
            <span class="atenna-modal__onb-icon">${ONB_ICON_FLOW}</span>
            <div><strong>Melhora a comunicação com IA</strong><span>Solicitações mais claras geram respostas mais precisas</span></div>
          </li>
        </ul>
        <div class="atenna-modal__onb-free-tag">Disponível hoje · 5 utilizações · Sem cartão</div>
      `;

      const ctaBtn = document.createElement('button');
      ctaBtn.className = 'atenna-modal__onb-cta';
      ctaBtn.textContent = 'Começar';
      ctaBtn.addEventListener('click', () => {
        void trackEvent('onboarding_cta_clicked');
        switchView('signup');
      });

      const loginLink = document.createElement('button');
      loginLink.className = 'atenna-modal__onb-login';
      loginLink.textContent = 'Já tenho uma conta';
      loginLink.addEventListener('click', () => {
        void trackEvent('onboarding_login_clicked');
        switchView('login');
      });

      wrap.appendChild(ctaBtn);
      wrap.appendChild(loginLink);
      container.appendChild(wrap);
    }, 4000);
  } else {
    // Fallback for non-popup contexts: render with logo and content together
    const wrap = document.createElement('div');
    wrap.className = 'atenna-modal__onboarding';

    wrap.innerHTML = `
      <div class="atenna-modal__onb-hero">
        <div class="atenna-modal__onb-wordmark">Atenna</div>
        <div class="atenna-modal__onb-headline">Clareza antes da inteligência.</div>
        <p class="atenna-modal__onb-sub">Uma camada entre você e a IA — para que suas intenções cheguem com precisão.</p>
      </div>
      <ul class="atenna-modal__onb-features">
        <li>
          <span class="atenna-modal__onb-icon">${ONB_ICON_CLARITY}</span>
          <div><strong>Organiza instruções complexas</strong><span>Estrutura sua intenção em versões claras e objetivas</span></div>
        </li>
        <li>
          <span class="atenna-modal__onb-icon">${ONB_ICON_SHIELD}</span>
          <div><strong>Detecta dados sensíveis</strong><span>Alerta sobre possíveis informações pessoais antes do envio</span></div>
        </li>
        <li>
          <span class="atenna-modal__onb-icon">${ONB_ICON_FLOW}</span>
          <div><strong>Melhora a comunicação com IA</strong><span>Solicitações mais claras geram respostas mais precisas</span></div>
        </li>
      </ul>
      <div class="atenna-modal__onb-free-tag">Disponível hoje · 5 utilizações · Sem cartão</div>
    `;

    const ctaBtn = document.createElement('button');
    ctaBtn.className = 'atenna-modal__onb-cta';
    ctaBtn.textContent = 'Começar';
    ctaBtn.addEventListener('click', () => {
      void trackEvent('onboarding_cta_clicked');
      switchView('signup');
    });

    const loginLink = document.createElement('button');
    loginLink.className = 'atenna-modal__onb-login';
    loginLink.textContent = 'Já tenho uma conta';
    loginLink.addEventListener('click', () => {
      void trackEvent('onboarding_login_clicked');
      switchView('login');
    });

    wrap.appendChild(ctaBtn);
    wrap.appendChild(loginLink);
    container.appendChild(wrap);
  }
}

export function showProWelcomeOverlay(session: { email: string; display_name?: string }, onDismiss?: () => void): void {
  const existing = document.getElementById('atenna-pro-welcome');
  if (existing) return;

  const overlay = document.createElement('div');
  overlay.id = 'atenna-pro-welcome';
  overlay.style.cssText = [
    'position:fixed', 'inset:0', 'z-index:2147483647',
    'display:flex', 'align-items:center', 'justify-content:center',
    'background:rgba(0,0,0,0.55)', 'backdrop-filter:blur(4px)',
  ].join(';');

  const panel = document.createElement('div');
  panel.className = 'atenna-pro-welcome__panel';

  const logoUrl = getLogoUrl();
  const name = session.display_name || session.email.split('@')[0];

  panel.innerHTML = `
    <div class="atenna-pro-welcome__burst">
      ${logoUrl ? `<img src="${logoUrl}" class="atenna-pro-welcome__logo" alt="Atenna"/>` : ''}
    </div>
    <div class="atenna-pro-welcome__title">Parabéns, ${name}!</div>
    <div class="atenna-pro-welcome__sub">Você agora é Atenna Pro.</div>
    <ul class="atenna-pro-welcome__perks">
      <li><span class="atenna-pro-welcome__check">${icon('check', { size: 12, stroke: 3 })}</span> 300 refinamentos de prompt por mês</li>
      <li><span class="atenna-pro-welcome__check">${icon('check', { size: 12, stroke: 3 })}</span> Proteção DLP ilimitada em documentos</li>
      <li><span class="atenna-pro-welcome__check">${icon('check', { size: 12, stroke: 3 })}</span> Análise de PDF, DOCX e Excel sem cotas</li>
      <li><span class="atenna-pro-welcome__check">${icon('check', { size: 12, stroke: 3 })}</span> Histórico completo de prompts</li>
    </ul>
    <button class="atenna-pro-welcome__btn">Começar agora</button>
  `;

  panel.querySelector('.atenna-pro-welcome__btn')!.addEventListener('click', () => {
    overlay.remove();
    onDismiss?.();
  });

  overlay.addEventListener('click', e => {
    if (e.target === overlay) { overlay.remove(); onDismiss?.(); }
  });
  overlay.appendChild(panel);
  document.body.appendChild(overlay);
}
