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

export function renderLimitReached(container: HTMLElement): void {
  clearMsgInterval();
  container.innerHTML = '';
  container.parentElement?.querySelector<HTMLElement>('.atenna-modal__builder-toggle')
    ?.classList.remove('atenna-modal__builder-toggle--loading');

  const wrap = document.createElement('div');
  wrap.className = 'atenna-modal__limit-reached';

  const msg = document.createElement('p');
  msg.className = 'atenna-modal__limit-msg';
  msg.textContent = 'Limite diário atingido.';

  const sub = document.createElement('p');
  sub.className = 'atenna-modal__limit-sub';
  sub.textContent = 'Você utilizou as 5 gerações gratuitas de hoje. O limite reinicia à meia-noite — ou continue sem restrições.';

  wrap.appendChild(msg);
  wrap.appendChild(sub);
  renderPricingCards(wrap, 'limit_screen');
  container.appendChild(wrap);
}
