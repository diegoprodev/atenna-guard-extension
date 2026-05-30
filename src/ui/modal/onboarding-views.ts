import { clearMsgInterval, getLogoUrl } from './utils';
import { trackEvent } from '../../core/analytics';
import type { Advisory } from '../../dlp/types';

// ─── DLP Advisory (Layer 3 UX) ────────────────────────────────

export const SHIELD_SVG = `<svg viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
  <path d="M8 1L2 3.5V8C2 11.3 4.7 14.3 8 15C11.3 14.3 14 11.3 14 8V3.5L8 1Z"
    stroke="currentColor" stroke-width="1.4" stroke-linejoin="round" fill="none"/>
</svg>`;

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

// ─── Onboarding constants ──────────────────────────────────

const ONB_ICON_CLARITY = `<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M12 8v4l3 3"/></svg>`;
const ONB_ICON_SHIELD  = `<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>`;
const ONB_ICON_FLOW    = `<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg>`;

const ONB_STEPS: Array<{
  icon: string;
  tag: string;
  title: string;
  desc: string;
  tip: string;
}> = [
  {
    icon: `<svg viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg"><circle cx="24" cy="24" r="22" fill="#22c55e" opacity=".12"/><path d="M24 12c-6.627 0-12 5.373-12 12s5.373 12 12 12 12-5.373 12-12S30.627 12 24 12zm0 4l2.5 5 5.5.8-4 3.9.95 5.5L24 28.8l-4.95 2.4.95-5.5-4-3.9 5.5-.8L24 16z" fill="#22c55e"/></svg>`,
    tag: 'Bem-vindo',
    title: 'Atenna Safe Prompt',
    desc: 'Seu co-piloto de segurança para ChatGPT, Claude e Gemini. Protege seus dados, refina seus prompts e digitaliza documentos — tudo antes do envio.',
    tip: '💡 Funciona em qualquer aba do Chrome com ChatGPT, Claude.ai ou Gemini.',
  },
  {
    icon: `<svg viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg"><circle cx="24" cy="24" r="22" fill="#22c55e" opacity=".12"/><rect x="12" y="30" width="24" height="3" rx="1.5" fill="#22c55e"/><circle cx="24" cy="20" r="6" stroke="#22c55e" stroke-width="2.2"/><path d="M20 26.5C17.5 27.5 15 29 15 30" stroke="#22c55e" stroke-width="2" stroke-linecap="round"/><path d="M28 26.5C30.5 27.5 33 29 33 30" stroke="#22c55e" stroke-width="2" stroke-linecap="round"/></svg>`,
    tag: 'Passo 1 de 4',
    title: 'Badge verde no campo de texto',
    desc: 'Abra o ChatGPT, Claude.ai ou Gemini. Um badge verde aparecerá acima do campo de entrada. Clique nele para abrir o painel Atenna.',
    tip: '💡 O badge só aparece quando você está autenticado. Se não aparecer, recarregue a página.',
  },
  {
    icon: `<svg viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg"><circle cx="24" cy="24" r="22" fill="#22c55e" opacity=".12"/><path d="M16 32l4-4 3 3 6-8 5 9H16z" fill="#22c55e" opacity=".3"/><path d="M12 20h4M12 24h6M12 28h4" stroke="#22c55e" stroke-width="2" stroke-linecap="round"/><rect x="20" y="13" width="16" height="22" rx="2" stroke="#22c55e" stroke-width="2"/><path d="M24 18h8M24 22h6M24 26h4" stroke="#22c55e" stroke-width="1.6" stroke-linecap="round"/></svg>`,
    tag: 'Passo 2 de 4',
    title: 'Upload e Scan de Documentos',
    desc: 'Envie PDFs, CSVs ou TXTs diretamente para o chat. O Atenna extrai o texto, escaneia PII (CPF, CNPJ, cartão) e aplica proteção antes de injetar como badge.',
    tip: '💡 Clique no ícone de upload no badge ou arraste o arquivo para a área de chat. Suporte a arquivos de até 100 MB.',
  },
  {
    icon: `<svg viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg"><circle cx="24" cy="24" r="22" fill="#22c55e" opacity=".12"/><path d="M14 34l3-3 4 4-7-1zm3-3l11-11" stroke="#22c55e" stroke-width="2.2" stroke-linecap="round"/><circle cx="33" cy="16" r="5" stroke="#22c55e" stroke-width="2.2"/><path d="M30 16h6M33 13v6" stroke="#22c55e" stroke-width="1.8" stroke-linecap="round"/></svg>`,
    tag: 'Passo 3 de 4',
    title: 'Proteção de Dados (DLP)',
    desc: 'O ponto colorido no badge muda de cor automaticamente: verde = seguro, amarelo = atenção, vermelho = dados sensíveis detectados. Você decide se protege ou envia.',
    tip: '💡 Detecta: CPF, CNPJ, cartão de crédito, chaves de API, senhas, emails, endereços e mais de 20 tipos de PII.',
  },
  {
    icon: `<svg viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg"><circle cx="24" cy="24" r="22" fill="#22c55e" opacity=".12"/><path d="M15 28c0-2 1.5-3.5 3-4l1.5-8 4 2 4-2 1.5 8c1.5.5 3 2 3 4" stroke="#22c55e" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/><path d="M18 31h12" stroke="#22c55e" stroke-width="2.2" stroke-linecap="round"/><path d="M21 24l2 2 4-4" stroke="#22c55e" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
    tag: 'Passo 4 de 4',
    title: 'Prompt Builder com IA',
    desc: 'Escreva sua solicitação no painel Atenna e clique em Refinar. A IA gera versões mais claras, precisas e seguras — sem expor dados sensíveis à plataforma.',
    tip: '💡 Acesse o histórico de prompts para reutilizar ou favoritar os melhores. Seus dados ficam locais no Chrome.',
  },
];

export function renderPostLoginOnboarding(modal: HTMLElement, close: () => void): void {
  const logoUrl = getLogoUrl();
  const logoImg = logoUrl ? `<img src="${logoUrl}" width="22" height="22" alt="" aria-hidden="true"/>` : '';

  let currentStep = 0;
  const total = ONB_STEPS.length;

  // Mark onboarding as seen on server when user finishes/skips
  async function markOnboardingSeen() {
    try {
      const { getActiveSession } = await import('../../core/auth');
      const session = await getActiveSession();
      if (session?.access_token) {
        await fetch('https://atennaplugin.maestro-n8n.site/auth/mark-onboarding-seen', {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${session.access_token}`, 'Content-Type': 'application/json' },
        });
      }
    } catch {
      // Silent fail — don't block user if server mark fails
    }
  }

  async function closeWithMark() {
    await markOnboardingSeen();
    close();
  }

  function render() {
    const step = ONB_STEPS[currentStep];
    const isFirst = currentStep === 0;
    const isLast = currentStep === total - 1;

    modal.innerHTML = `
      <div class="atenna-modal__header">
        <span class="atenna-modal__title">${logoImg}Atenna</span>
        <button class="atenna-modal__close" aria-label="Fechar">×</button>
      </div>
      <div class="atenna-modal__body">
        <div class="atenna-onb-wizard">
          <div class="atenna-onb-wizard__icon">${step.icon}</div>
          <div class="atenna-onb-wizard__tag">${step.tag}</div>
          <div class="atenna-onb-wizard__title">${step.title}</div>
          <p class="atenna-onb-wizard__desc">${step.desc}</p>
          <div class="atenna-onb-wizard__tip">${step.tip}</div>

          <div class="atenna-onb-wizard__dots">
            ${ONB_STEPS.map((_, i) => `<span class="atenna-onb-wizard__dot${i === currentStep ? ' atenna-onb-wizard__dot--active' : ''}"></span>`).join('')}
          </div>

          <div class="atenna-onb-wizard__nav">
            ${!isFirst ? `<button class="atenna-onb-wizard__btn atenna-onb-wizard__btn--back">← Voltar</button>` : `<span></span>`}
            <button class="atenna-onb-wizard__btn atenna-onb-wizard__btn--skip">Pular</button>
            <button class="atenna-onb-wizard__btn atenna-onb-wizard__btn--next ${isLast ? 'atenna-onb-wizard__btn--finish' : ''}">
              ${isLast ? '✓ Começar' : 'Próximo →'}
            </button>
          </div>
        </div>
      </div>
    `;

    modal.querySelector('.atenna-modal__close')!.addEventListener('click', closeWithMark);
    modal.querySelector('.atenna-onb-wizard__btn--skip')!.addEventListener('click', closeWithMark);
    modal.querySelector('.atenna-onb-wizard__btn--next')!.addEventListener('click', () => {
      if (isLast) { void closeWithMark(); return; }
      currentStep++;
      render();
    });
    const backBtn = modal.querySelector('.atenna-onb-wizard__btn--back');
    if (backBtn) backBtn.addEventListener('click', () => { currentStep--; render(); });
  }

  render();
}

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
      <li><span class="atenna-pro-welcome__check">✓</span> 300 refinamentos de prompt por mês</li>
      <li><span class="atenna-pro-welcome__check">✓</span> Proteção DLP ilimitada em documentos</li>
      <li><span class="atenna-pro-welcome__check">✓</span> Análise de PDF, DOCX e Excel sem cotas</li>
      <li><span class="atenna-pro-welcome__check">✓</span> Histórico completo de prompts</li>
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
