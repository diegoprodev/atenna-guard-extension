/**
 * Coach mark de primeira vez — um único balão ancorado no badge, mostrado
 * uma vez por perfil. Explica onde o Atenna age. Dependency-free (roda no
 * content.js em toda página de IA).
 *
 * Padrão: card escuro auto-contido (mesma tinta do herói da welcome), lê bem
 * em página clara ou escura sem depender do tema do site. Some no "Entendi",
 * no clique fora, ou sozinho em 12s.
 */
import { getLogoUrl } from './injectButton';

const CM_ID = 'atenna-coachmark';
const SEEN_KEY = 'atenna_coachmark_seen';

function hasSeen(): Promise<boolean> {
  return new Promise((resolve) => {
    try {
      chrome.storage.local.get(SEEN_KEY, (r) => resolve(r?.[SEEN_KEY] === true));
    } catch {
      resolve(true); // fora de contexto de extensão — não mostra
    }
  });
}

function markSeen(): void {
  try {
    chrome.storage.local.set({ [SEEN_KEY]: true });
  } catch { /* noop */ }
  // Persiste no servidor também (cross-device); best-effort.
  try {
    chrome.runtime.sendMessage({ type: 'MARK_ONBOARDING_SEEN' }, () => void chrome.runtime.lastError);
  } catch { /* noop */ }
}

let _teardown: (() => void) | undefined;

function remove(): void {
  _teardown?.();
  _teardown = undefined;
  document.getElementById(CM_ID)?.remove();
}

function position(card: HTMLElement, badge: HTMLElement): void {
  const b = badge.getBoundingClientRect();
  const c = card.getBoundingClientRect();
  const gap = 18;
  // Preferência: à esquerda do badge, centrado verticalmente nele.
  let left = b.left - c.width - gap;
  let arrow: 'right' | 'bottom' = 'right';
  let top = b.top + b.height / 2 - c.height / 2;

  if (left < 12) {
    // Sem espaço à esquerda — vai por cima, alinhado à direita do badge.
    left = Math.max(12, b.right - c.width);
    top = b.top - c.height - gap;
    arrow = 'bottom';
  }
  top = Math.max(12, Math.min(top, window.innerHeight - c.height - 12));

  card.style.left = `${Math.round(left)}px`;
  card.style.top = `${Math.round(top)}px`;
  card.setAttribute('data-arrow', arrow);
  if (arrow === 'right') {
    const y = Math.min(Math.max(b.top + b.height / 2 - top, 16), c.height - 16);
    card.style.setProperty('--cm-arrow-y', `${Math.round(y)}px`);
  } else {
    const x = Math.min(Math.max(b.left + b.width / 2 - left, 16), c.width - 16);
    card.style.setProperty('--cm-arrow-x', `${Math.round(x)}px`);
  }
}

const CSS = `
#${CM_ID}{
  position:fixed;z-index:2147482998;width:270px;
  background:#0A2E23;color:#F4F3EE;
  border:1px solid rgba(244,243,238,.10);border-radius:12px;
  padding:15px 15px 13px;
  font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;
  box-shadow:0 12px 40px rgba(10,46,35,.34),0 3px 10px rgba(0,0,0,.20);
  opacity:0;transform:translateY(5px) scale(.985);
  animation:atn-cm-in .26s cubic-bezier(.2,.7,.3,1) forwards;
}
@keyframes atn-cm-in{to{opacity:1;transform:none}}
#${CM_ID}::after{
  content:"";position:absolute;width:11px;height:11px;
  background:#0A2E23;border:1px solid rgba(244,243,238,.10);
  transform:rotate(45deg);
}
#${CM_ID}[data-arrow="right"]::after{
  right:-6px;top:var(--cm-arrow-y,22px);
  border-left:none;border-bottom:none;
}
#${CM_ID}[data-arrow="bottom"]::after{
  bottom:-6px;left:var(--cm-arrow-x,50%);
  border-left:none;border-top:none;
}
#${CM_ID} .atn-cm-hd{display:flex;align-items:center;gap:8px;margin-bottom:7px}
#${CM_ID} .atn-cm-hd img{width:17px;height:17px;border-radius:5px;opacity:.95}
#${CM_ID} .atn-cm-t{font-size:12.5px;font-weight:650;letter-spacing:-.005em}
#${CM_ID} .atn-cm-b{font-size:12px;line-height:1.6;color:#9DB5AC;margin-bottom:12px}
#${CM_ID} .atn-cm-b b{color:#CFE6D9;font-weight:600}
#${CM_ID} .atn-cm-btn{
  display:block;margin-left:auto;
  padding:6px 14px;border:none;border-radius:7px;
  background:#0B6E4B;color:#fff;font-family:inherit;font-size:12px;font-weight:600;
  cursor:pointer;transition:background 120ms;
}
#${CM_ID} .atn-cm-btn:hover{background:#095B3E}
#${CM_ID} .atn-cm-btn:focus-visible{outline:2px solid #7FD8AE;outline-offset:2px}
@media (prefers-reduced-motion:reduce){
  #${CM_ID}{animation:none;opacity:1;transform:none}
}
`;

/**
 * Mostra o coach mark se ainda não foi visto. Chamar depois que o badge REAL
 * (não o de espera) estiver no DOM.
 */
export async function maybeShowCoachmark(badge: HTMLElement): Promise<void> {
  if (await hasSeen()) return;
  if (document.getElementById(CM_ID)) return;

  const style = document.createElement('style');
  style.id = `${CM_ID}-style`;
  style.textContent = CSS;
  document.head.appendChild(style);

  const card = document.createElement('div');
  card.id = CM_ID;
  card.setAttribute('role', 'dialog');
  card.setAttribute('aria-label', 'Como usar o Atenna');

  const logo = getLogoUrl();
  card.innerHTML = `
    <div class="atn-cm-hd">
      ${logo ? `<img src="${logo}" alt="" aria-hidden="true">` : ''}
      <span class="atn-cm-t">O Atenna está ativo aqui</span>
    </div>
    <p class="atn-cm-b">Passe o mouse no botão para gerar um <b>prompt melhor</b> ou proteger <b>dados sensíveis</b> antes de enviar.</p>
    <button class="atn-cm-btn" type="button">Entendi</button>
  `;
  document.body.appendChild(card);

  requestAnimationFrame(() => position(card, badge));

  const dismiss = (): void => {
    markSeen();
    remove();
    style.remove();
  };

  card.querySelector('.atn-cm-btn')?.addEventListener('click', dismiss);

  const onDocClick = (e: MouseEvent): void => {
    if (!card.contains(e.target as Node) && e.target !== badge && !badge.contains(e.target as Node)) dismiss();
  };
  const onReposition = (): void => position(card, badge);
  const autoTimer = window.setTimeout(dismiss, 12_000);

  // Registra tarde pra não pegar o próprio clique que abriu isto.
  window.setTimeout(() => document.addEventListener('click', onDocClick, true), 0);
  window.addEventListener('scroll', onReposition, { passive: true });
  window.addEventListener('resize', onReposition, { passive: true });

  _teardown = (): void => {
    window.clearTimeout(autoTimer);
    document.removeEventListener('click', onDocClick, true);
    window.removeEventListener('scroll', onReposition);
    window.removeEventListener('resize', onReposition);
  };
}
