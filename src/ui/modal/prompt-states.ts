// ─── Prompt States — empty/loading/success/limit views ────────────────────────
// Extracted from modal.ts. Renders the four main result-area states.

import { LOADING_MESSAGES, CHECK_SVG, SUCCESS_MS, clearMsgInterval } from './utils';
import { modalState } from './state';
import { renderPlansModal, renderPricingCards } from './plans-modal';

export function renderOnboarding(
  container: HTMLElement,
  _onChipClick: (suggestion: string) => void,
): void {
  container.innerHTML = '';
  const wrap = document.createElement('div');
  wrap.className = 'atenna-modal__onboarding-minimal';

  const title = document.createElement('h2');
  title.className = 'atenna-modal__onb-title';
  title.textContent = 'Atenna';

  const subtitle = document.createElement('p');
  subtitle.className = 'atenna-modal__onb-subtitle';
  subtitle.textContent = 'Proteja seus dados e comunique com mais precisão à IA.';

  const description = document.createElement('p');
  description.className = 'atenna-modal__onb-description';
  description.textContent = 'Seus dados trafegam por dezenas de sistemas antes de chegar à IA. O Atenna protege o que é sensível e estrutura o que você quer dizer — para que nada vaze e tudo chegue certo.';

  // CTA para usuários Free — gatilho de identidade, não de preço
  const ctaWrap = document.createElement('div');
  ctaWrap.style.cssText = 'margin-top:20px;display:flex;justify-content:center;';
  const cta = document.createElement('button');
  cta.className = 'atenna-modal__onb-cta-green';
  cta.textContent = 'Quero prompts ilimitados e proteger meus dados 100% conforme LGPD';
  cta.addEventListener('click', () => renderPlansModal('onboarding_screen'));
  ctaWrap.appendChild(cta);

  wrap.appendChild(title);
  wrap.appendChild(subtitle);
  wrap.appendChild(description);
  wrap.appendChild(ctaWrap);
  container.appendChild(wrap);
}

export function renderEmptyState(
  container: HTMLElement,
  onChipClick: (suggestion: string) => void,
): void {
  container.innerHTML = '';
  const wrap = document.createElement('div');
  wrap.className = 'atenna-modal__empty-state';

  const title = document.createElement('h3');
  title.className = 'atenna-modal__empty-title';
  title.textContent = 'O que você quer organizar?';

  const subtitle = document.createElement('p');
  subtitle.className = 'atenna-modal__empty-subtitle';
  subtitle.textContent = 'Escolha um ponto de partida ou descreva sua intenção.';

  const chipsContainer = document.createElement('div');
  chipsContainer.className = 'atenna-modal__empty-chips';

  const suggestions = [
    'Plano de estudos',
    'Conteúdo para redes sociais',
    'Explicação técnica',
    'Estratégia de vendas',
    'Aula ou treinamento',
    'Documento profissional',
  ];

  suggestions.forEach(suggestion => {
    const chip = document.createElement('button');
    chip.className = 'atenna-modal__empty-chip';
    chip.textContent = suggestion;
    chip.type = 'button';
    chip.addEventListener('click', () => onChipClick(suggestion));
    chipsContainer.appendChild(chip);
  });

  wrap.appendChild(title);
  wrap.appendChild(subtitle);
  wrap.appendChild(chipsContainer);
  container.appendChild(wrap);
}

// ─── Render: loading (premium skeleton, adaptive states) ─────

export function renderLoading(container: HTMLElement): void {
  clearMsgInterval();
  container.innerHTML = '';
  container.parentElement?.querySelector<HTMLElement>('.atenna-modal__builder-toggle')
    ?.classList.add('atenna-modal__builder-toggle--loading');

  const wrap = document.createElement('div');
  wrap.className = 'atenna-skeleton-loading';

  const msg = document.createElement('p');
  msg.className = 'atenna-skeleton-loading__msg';
  msg.setAttribute('data-loading-msg', '');
  msg.textContent = LOADING_MESSAGES[0];

  wrap.appendChild(msg);

  // 3 skeleton cards
  for (let j = 0; j < 3; j++) {
    const skeleton = document.createElement('div');
    skeleton.className = 'atenna-skeleton-card';
    wrap.appendChild(skeleton);
  }

  container.appendChild(wrap);

  // Scroll to loading indicator
  requestAnimationFrame(() => {
    container.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  });

  let i = 0;
  modalState.msgIntervalId = setInterval(() => {
    if (!msg.isConnected) { clearMsgInterval(); return; }
    i = (i + 1) % LOADING_MESSAGES.length;
    msg.textContent = LOADING_MESSAGES[i];
    msg.style.opacity = '0.5';
    setTimeout(() => { msg.style.opacity = '0.7'; }, 100);
  }, 1200);
}

// ─── Render: success ───────────────────────────────────────

export function renderSuccess(container: HTMLElement): Promise<void> {
  clearMsgInterval();
  container.innerHTML = '';
  container.parentElement?.querySelector<HTMLElement>('.atenna-modal__builder-toggle')
    ?.classList.remove('atenna-modal__builder-toggle--loading');

  const wrap = document.createElement('div');
  wrap.className = 'atenna-modal__loading';

  const check = document.createElement('div');
  check.className = 'atenna-modal__check';
  check.innerHTML = CHECK_SVG; // static SVG, not user content

  const msg = document.createElement('p');
  msg.className = 'atenna-modal__loading-msg';
  msg.textContent = 'Pronto!';

  wrap.appendChild(check);
  wrap.appendChild(msg);
  container.appendChild(wrap);

  return new Promise(resolve => setTimeout(resolve, SUCCESS_MS));
}

// ─── Render: limit reached ─────────────────────────────────

export function renderLimitReached(container: HTMLElement, limitType: 'daily' | 'monthly' = 'daily'): void {
  clearMsgInterval();
  container.innerHTML = '';
  container.parentElement?.querySelector<HTMLElement>('.atenna-modal__builder-toggle')
    ?.classList.remove('atenna-modal__builder-toggle--loading');

  const isMonthly = limitType === 'monthly';

  const wrap = document.createElement('div');
  wrap.className = 'atenna-modal__limit-reached';
  wrap.style.cssText = 'display:flex;flex-direction:column;align-items:center;text-align:center;padding:20px 16px 8px;gap:6px;';

  // Icon
  const icon = document.createElement('div');
  icon.style.cssText = 'font-size:32px;margin-bottom:2px;';
  icon.textContent = isMonthly ? '📅' : '⚡';
  wrap.appendChild(icon);

  // Title
  const title = document.createElement('p');
  title.style.cssText = 'font-size:15px;font-weight:700;color:var(--at-text,#f0f0f0);margin:0;';
  title.textContent = isMonthly ? 'Limite mensal atingido' : 'Suas 5 gerações de hoje foram usadas';
  wrap.appendChild(title);

  // Subtitle
  const sub = document.createElement('p');
  sub.style.cssText = 'font-size:12px;color:var(--at-muted,#888);margin:0 0 8px;line-height:1.5;max-width:260px;';
  sub.textContent = isMonthly
    ? 'Você usou os 25 prompts gratuitos deste mês. Renova no dia 1º — ou desbloqueie agora.'
    : 'O limite reinicia à meia-noite. Com o Pro você gera sem restrições, todos os dias.';
  wrap.appendChild(sub);

  // What Pro unlocks — 3 bullets
  const bullets = document.createElement('div');
  bullets.style.cssText = 'background:var(--at-surface,#1a1a1a);border:1px solid var(--at-border,#2a2a2a);border-radius:8px;padding:10px 14px;text-align:left;width:100%;margin-bottom:4px;';
  bullets.innerHTML = [
    '✨ Prompts ilimitados todos os dias',
    '🛡️ Proteção de dados sem restrição',
    '📄 Arquivos PDF, DOCX e Excel',
  ].map(b => `<div style="font-size:11px;color:var(--at-muted,#aaa);padding:3px 0;">${b}</div>`).join('');
  wrap.appendChild(bullets);

  renderPricingCards(wrap, isMonthly ? 'monthly_limit_screen' : 'daily_limit_screen');
  container.appendChild(wrap);
}
