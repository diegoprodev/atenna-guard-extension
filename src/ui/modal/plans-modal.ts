// src/ui/modal/plans-modal.ts
// Pricing overlay, upgrade modal, and inline pricing cards.

import { openCheckout } from './network';
import { trackEvent } from '../../core/analytics';
import { UPGRADE_TRIGGER } from './state';

export const MONTHLY_PRICE = 29.90;
export const YEARLY_PRICE  = 197.00;
export const YEARLY_MONTHLY_EQUIV = YEARLY_PRICE / 12;                          // ~16,41
export const YEARLY_SAVINGS = (MONTHLY_PRICE * 12) - YEARLY_PRICE;             // 161,80
export const YEARLY_SAVINGS_PCT = Math.round((YEARLY_SAVINGS / (MONTHLY_PRICE * 12)) * 100); // ~45%

export function renderPlansModal(trigger: string): void {
  const existing = document.getElementById('atenna-plans-modal');
  if (existing) { existing.remove(); return; }

  const overlay = document.createElement('div');
  overlay.id = 'atenna-plans-modal';
  overlay.style.cssText = [
    'position:fixed;inset:0;z-index:2147483647',
    'background:rgba(0,0,0,0.72);backdrop-filter:blur(4px)',
    'display:flex;align-items:center;justify-content:center',
    'padding:16px;animation:atenna-fadein 180ms ease',
  ].join(';');

  const box = document.createElement('div');
  box.style.cssText = [
    'background:#111;border:1px solid #222;border-radius:16px',
    'width:100%;max-width:560px;padding:28px 24px 24px',
    'font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif',
    'position:relative;color:#e8e8e8',
  ].join(';');

  // Close
  const closeBtn = document.createElement('button');
  closeBtn.style.cssText = 'position:absolute;top:14px;right:16px;background:none;border:none;color:#666;font-size:18px;cursor:pointer;line-height:1;padding:4px 6px;';
  closeBtn.textContent = '×';
  closeBtn.addEventListener('click', () => overlay.remove());
  overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });

  // Header — curiosity + identity (não é "compre", é "o que profissionais fazem")
  const head = document.createElement('div');
  head.style.cssText = 'text-align:center;margin-bottom:22px;';
  head.innerHTML = `
    <div style="font-size:11px;letter-spacing:1.5px;color:#6366f1;font-weight:700;text-transform:uppercase;margin-bottom:8px;">Atenna Guardião</div>
    <h2 style="font-size:17px;font-weight:700;margin:0 0 6px;color:#fff;line-height:1.3;">Quem usa IA todos os dias<br>protege o que importa.</h2>
    <p style="font-size:12px;color:#888;margin:0;line-height:1.6;">Seus dados passam por dezenas de sistemas antes de chegar à IA.<br>A maioria das pessoas não sabe o que escapa.</p>
  `;

  // Cards wrapper — side by side
  const cards = document.createElement('div');
  cards.style.cssText = 'display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:16px;';

  // ── Card Mensal ──
  const cMonth = document.createElement('div');
  cMonth.style.cssText = [
    'border:1px solid #2a2a2a;border-radius:12px;padding:18px 16px',
    'display:flex;flex-direction:column;gap:4px;',
  ].join(';');
  cMonth.innerHTML = `
    <div style="font-size:11px;color:#888;font-weight:500;margin-bottom:2px;">Mensal</div>
    <div style="font-size:24px;font-weight:700;color:#fff;line-height:1;">R$${MONTHLY_PRICE.toFixed(2).replace('.',',')} <span style="font-size:11px;font-weight:400;color:#666;">/mês</span></div>
    <div style="font-size:10px;color:#555;margin:2px 0 10px;">Cartão · Cancele quando quiser</div>
    <div style="font-size:11px;color:#aaa;line-height:1.7;flex:1;">
      ✓ Prompts ilimitados<br>
      ✓ Proteção de dados automática<br>
      ✓ Histórico completo<br>
      ✓ PDF, DOCX, Excel
    </div>
  `;
  const btnMonth = document.createElement('button');
  btnMonth.style.cssText = 'margin-top:14px;width:100%;padding:10px;background:transparent;color:#aaa;border:1px solid #333;border-radius:8px;font-size:12px;font-weight:500;cursor:pointer;font-family:inherit;transition:border-color 150ms;';
  btnMonth.textContent = 'Começar mensal';
  btnMonth.dataset.label = 'Começar mensal';
  btnMonth.addEventListener('mouseenter', () => { btnMonth.style.borderColor = '#555'; });
  btnMonth.addEventListener('mouseleave', () => { btnMonth.style.borderColor = '#333'; });
  btnMonth.addEventListener('click', () => void openCheckout(`plans_modal_${trigger}`, btnMonth, 'monthly'));
  cMonth.appendChild(btnMonth);

  // ── Card Anual (destaque — ancoragem + perda) ──
  const cYear = document.createElement('div');
  cYear.style.cssText = [
    'border:2px solid #6366f1;border-radius:12px;padding:18px 16px',
    'display:flex;flex-direction:column;gap:4px;position:relative;',
    'background:linear-gradient(160deg,rgba(99,102,241,0.07) 0%,transparent 60%)',
  ].join(';');

  // Badge economia — loss aversion anchor
  const savingsBadge = document.createElement('div');
  savingsBadge.style.cssText = 'position:absolute;top:-11px;left:50%;transform:translateX(-50%);white-space:nowrap;background:#6366f1;color:#fff;font-size:10px;font-weight:700;padding:3px 10px;border-radius:20px;letter-spacing:0.3px;';
  savingsBadge.textContent = `Economize R$${YEARLY_SAVINGS.toFixed(2).replace('.',',')} (${YEARLY_SAVINGS_PCT}%)`;
  cYear.appendChild(savingsBadge);

  cYear.innerHTML += `
    <div style="font-size:11px;color:#6366f1;font-weight:600;margin-bottom:2px;">Anual · Melhor escolha</div>
    <div style="font-size:24px;font-weight:700;color:#fff;line-height:1;">R$${YEARLY_MONTHLY_EQUIV.toFixed(2).replace('.',',')} <span style="font-size:11px;font-weight:400;color:#888;">/mês</span></div>
    <div style="font-size:10px;color:#888;margin:2px 0 4px;">
      <span style="text-decoration:line-through;color:#555;">R$${(MONTHLY_PRICE * 12).toFixed(2).replace('.',',')}</span>
      &nbsp;→&nbsp;
      <span style="color:#22c55e;font-weight:600;">R$${YEARLY_PRICE.toFixed(2).replace('.',',')} /ano</span>
    </div>
    <div style="font-size:10px;color:#888;margin-bottom:10px;">PIX ou cartão · Um pagamento</div>
    <div style="font-size:11px;color:#aaa;line-height:1.7;flex:1;">
      ✓ Prompts ilimitados<br>
      ✓ Proteção de dados automática<br>
      ✓ Histórico completo<br>
      ✓ PDF, DOCX, Excel<br>
      <span style="color:#6366f1;">✓ 300 gerações garantidas/mês</span>
    </div>
  `;
  const btnYear = document.createElement('button');
  btnYear.style.cssText = 'margin-top:14px;width:100%;padding:10px;background:#6366f1;color:#fff;border:none;border-radius:8px;font-size:12px;font-weight:700;cursor:pointer;font-family:inherit;transition:background 150ms;';
  btnYear.textContent = 'Quero proteger e gerar sem limites';
  btnYear.dataset.label = 'Quero proteger e gerar sem limites';
  btnYear.addEventListener('mouseenter', () => { btnYear.style.background = '#5254cc'; });
  btnYear.addEventListener('mouseleave', () => { btnYear.style.background = '#6366f1'; });
  btnYear.addEventListener('click', () => void openCheckout(`plans_modal_${trigger}`, btnYear, 'yearly'));
  cYear.appendChild(btnYear);

  cards.appendChild(cMonth);
  cards.appendChild(cYear);

  // Footer — identidade + LGPD (não é "oferta", é "responsabilidade")
  const footer = document.createElement('p');
  footer.style.cssText = 'text-align:center;font-size:10px;color:#555;margin:0;line-height:1.6;';
  footer.innerHTML = 'Nenhum dado seu é armazenado na IA. Tudo processado localmente e protegido conforme a LGPD.<br>Cancele quando quiser. Sem fidelidade.';

  box.appendChild(closeBtn);
  box.appendChild(head);
  box.appendChild(cards);
  box.appendChild(footer);
  overlay.appendChild(box);

  const popupContainer = document.getElementById('atenna-popup');
  (popupContainer || document.body).appendChild(overlay);

  void trackEvent('plans_modal_shown', { trigger } as Parameters<typeof trackEvent>[1]);
}

export function renderUpgradeModal(onClose: () => void): HTMLElement {
  const overlay = document.createElement('div');
  overlay.className = 'atenna-upgrade-modal';
  overlay.addEventListener('click', (e) => { if (e.target === overlay) onClose(); });

  const box = document.createElement('div');
  box.className = 'atenna-upgrade-modal__box';

  // Hero
  const hero = document.createElement('div');
  hero.className = 'atenna-upgrade-modal__hero';

  const heroClose = document.createElement('button');
  heroClose.className = 'atenna-upgrade-modal__hero-close';
  heroClose.textContent = '×';
  heroClose.addEventListener('click', onClose);

  const badge = document.createElement('div');
  badge.className = 'atenna-upgrade-modal__badge';
  badge.textContent = 'Atenna Pro';

  const title = document.createElement('h2');
  title.className = 'atenna-upgrade-modal__title';
  title.textContent = 'Proteja e gere prompts sem restrições';

  const subtitle = document.createElement('p');
  subtitle.className = 'atenna-upgrade-modal__subtitle';
  subtitle.textContent = 'Sem limites diários. Seus dados sensíveis protegidos antes de chegar a qualquer IA.';

  const priceAnchor = document.createElement('p');
  priceAnchor.className = 'atenna-upgrade-modal__price-anchor';
  priceAnchor.innerHTML = '<strong>R$&nbsp;19/mês</strong> · ou <strong>R$&nbsp;149/ano</strong> <span style="opacity:0.6;font-size:11px;">(≈ R$&nbsp;12,41/mês)</span>';

  hero.appendChild(heroClose);
  hero.appendChild(badge);
  hero.appendChild(title);
  hero.appendChild(subtitle);
  hero.appendChild(priceAnchor);

  // Body
  const body = document.createElement('div');
  body.className = 'atenna-upgrade-modal__body';

  const features: Array<[string, string]> = [
    ['Prompts ilimitados por dia', 'Sem restrição diária ou mensal'],
    ['Proteção de dados em arquivos', 'PDF, DOCX e Excel — ilimitado'],
    ['Histórico completo', 'Acesse todos os prompts gerados anteriormente'],
    ['Proteção automática de dados sensíveis', 'CPF, e-mails, chaves de API e mais'],
  ];

  const ul = document.createElement('ul');
  ul.className = 'atenna-upgrade-modal__features';

  features.forEach(([main, sub]) => {
    const li = document.createElement('li');
    li.className = 'atenna-upgrade-modal__feature';

    const check = document.createElement('div');
    check.className = 'atenna-upgrade-modal__feature-check';
    check.textContent = '✓';

    const text = document.createElement('div');
    text.className = 'atenna-upgrade-modal__feature-text';
    text.innerHTML = `<strong>${main}</strong><small>${sub}</small>`;

    li.appendChild(check);
    li.appendChild(text);
    ul.appendChild(li);
  });

  const hr = document.createElement('hr');
  hr.className = 'atenna-upgrade-modal__divider';

  const dismiss = document.createElement('button');
  dismiss.className = 'atenna-upgrade-modal__dismiss';
  dismiss.textContent = 'Continuar no plano gratuito';
  dismiss.addEventListener('click', onClose);

  const pricingWrap = document.createElement('div');
  renderPricingCards(pricingWrap, 'upgrade_modal');

  body.appendChild(ul);
  body.appendChild(hr);
  body.appendChild(pricingWrap);
  body.appendChild(dismiss);

  box.appendChild(hero);
  box.appendChild(body);
  overlay.appendChild(box);

  return overlay;
}

export function renderPricingCards(container: HTMLElement, source: string): void {
  const wrap = document.createElement('div');
  wrap.style.cssText = 'padding:16px 14px;display:flex;flex-direction:column;gap:10px;';

  const heading = document.createElement('div');
  heading.style.cssText = 'font-size:13px;font-weight:600;color:var(--at-text,#e8e8e8);margin-bottom:2px;';
  heading.textContent = 'Escolha seu plano';
  wrap.appendChild(heading);

  const sub = document.createElement('div');
  sub.style.cssText = 'font-size:11px;color:var(--at-muted,#888);margin-bottom:6px;';
  sub.textContent = 'Cancele quando quiser. Renovação automática.';
  wrap.appendChild(sub);

  // ── Card Anual (destaque) ──
  const cardYear = document.createElement('div');
  cardYear.style.cssText = 'background:var(--at-surface,#1a1a1a);border:1.5px solid #6366f1;border-radius:10px;padding:14px 16px;cursor:pointer;position:relative;';
  cardYear.innerHTML = `
    <div style="position:absolute;top:-10px;right:14px;background:#6366f1;color:#fff;font-size:10px;font-weight:700;padding:2px 8px;border-radius:20px;letter-spacing:0.5px;">MELHOR VALOR</div>
    <div style="font-size:12px;font-weight:600;color:var(--at-text,#e8e8e8);margin-bottom:4px;">Pro Anual</div>
    <div style="font-size:22px;font-weight:700;color:#fff;line-height:1;">R$197 <span style="font-size:12px;font-weight:400;color:#888;">/ano</span></div>
    <div style="font-size:10px;color:#6366f1;margin:2px 0 8px;">5% off no PIX · ~R$16/mês</div>
    <div style="font-size:11px;color:var(--at-muted,#888);line-height:1.6;">300 prompts/mês · Proteção de dados ilimitada · Arquivos PDF, DOCX e Excel</div>
  `;
  const btnYear = document.createElement('button');
  btnYear.style.cssText = 'margin-top:10px;width:100%;padding:9px;background:#6366f1;color:#fff;border:none;border-radius:7px;font-size:12px;font-weight:600;cursor:pointer;font-family:inherit;';
  btnYear.textContent = 'Quero proteger e gerar prompts ilimitados';
  btnYear.dataset.label = 'Quero proteger e gerar prompts ilimitados';
  btnYear.addEventListener('click', () => void openCheckout(source, btnYear, 'yearly'));
  cardYear.appendChild(btnYear);
  wrap.appendChild(cardYear);

  // ── Card Mensal ──
  const cardMonth = document.createElement('div');
  cardMonth.style.cssText = 'background:var(--at-surface,#1a1a1a);border:1px solid var(--at-border,#2a2a2a);border-radius:10px;padding:14px 16px;cursor:pointer;';
  cardMonth.innerHTML = `
    <div style="font-size:12px;font-weight:600;color:var(--at-text,#e8e8e8);margin-bottom:4px;">Pro Mensal</div>
    <div style="font-size:22px;font-weight:700;color:#fff;line-height:1;">R$29,90 <span style="font-size:12px;font-weight:400;color:#888;">/mês</span></div>
    <div style="font-size:10px;color:#888;margin:2px 0 8px;">Cartão · Renovação automática · Cancele quando quiser</div>
    <div style="font-size:11px;color:var(--at-muted,#888);line-height:1.6;">Prompts ilimitados · Proteção de dados avançada · Histórico completo</div>
  `;
  const btnMonth = document.createElement('button');
  btnMonth.style.cssText = 'margin-top:10px;width:100%;padding:9px;background:transparent;color:var(--at-text,#e8e8e8);border:1px solid var(--at-border,#333);border-radius:7px;font-size:12px;font-weight:500;cursor:pointer;font-family:inherit;';
  btnMonth.textContent = 'Começar mensal';
  btnMonth.dataset.label = 'Começar mensal';
  btnMonth.addEventListener('click', () => void openCheckout(source, btnMonth, 'monthly'));
  cardMonth.appendChild(btnMonth);
  wrap.appendChild(cardMonth);

  container.appendChild(wrap);
}

export function renderUpgradeTrigger(): HTMLElement {
  const card = document.createElement('div');
  card.className = 'atenna-modal__upgrade-trigger';

  const msg = document.createElement('p');
  msg.className = 'atenna-modal__upgrade-trigger-msg';
  msg.textContent = `Você já criou ${UPGRADE_TRIGGER} prompts.`;

  const sub = document.createElement('p');
  sub.className = 'atenna-modal__upgrade-trigger-sub';
  sub.textContent = 'Continue gerando e proteja seus dados sensíveis sem restrição.';

  renderPricingCards(card, 'usage_trigger');
  card.appendChild(msg);
  card.appendChild(sub);
  return card;
}
