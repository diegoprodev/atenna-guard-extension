import { generatePrompts, type PromptVariant } from '../core/promptEngine';
import { getCurrentInput, getInputText, setInputText } from '../core/inputHandler';

const OVERLAY_ID = 'atenna-modal-overlay';

function getLogoUrl(): string {
  try { return chrome.runtime.getURL('icons/icon128.png'); }
  catch { return ''; }
}

function isDark(): boolean {
  const bg = getComputedStyle(document.body).backgroundColor;
  const m = bg.match(/\d+/g);
  if (m && m.length >= 3) {
    return 0.299 * +m[0] + 0.587 * +m[1] + 0.114 * +m[2] < 128;
  }
  return window.matchMedia('(prefers-color-scheme: dark)').matches;
}

export function toggleModal(): void {
  const existing = document.getElementById(OVERLAY_ID);
  if (existing) { existing.remove(); return; }
  openModal();
}

function openModal(): void {
  const input = getCurrentInput();
  const userText = input ? getInputText(input) : '';

  const overlay = document.createElement('div');
  overlay.id = OVERLAY_ID;
  overlay.className = 'atenna-modal-overlay';

  const dark = isDark();
  const modal = document.createElement('div');
  modal.className = dark ? 'atenna-modal atenna-modal--dark' : 'atenna-modal';
  modal.setAttribute('role', 'dialog');
  modal.setAttribute('aria-modal', 'true');
  modal.setAttribute('aria-label', 'Atenna Prompt');

  const logoUrl = getLogoUrl();
  const logoImg = logoUrl
    ? `<img src="${logoUrl}" width="24" height="24" alt="" aria-hidden="true"/>`
    : '';

  const variants = generatePrompts(userText);
  const cardsHtml = variants.map((v, i) => buildCardHtml(v, i)).join('');

  const previewText = userText
    ? escapeHtml(userText)
    : `<span class="atenna-modal__input-empty">Nenhum texto no input ainda</span>`;

  modal.innerHTML = `
    <div class="atenna-modal__header">
      <span class="atenna-modal__title">${logoImg}Atenna Prompt</span>
      <button class="atenna-modal__close" aria-label="Fechar">×</button>
    </div>
    <div class="atenna-modal__subtitle">Escolha uma versão otimizada do seu prompt</div>

    <div class="atenna-modal__input-label">Seu texto atual</div>
    <div class="atenna-modal__input-preview">${previewText}</div>

    <div class="atenna-modal__section-label">Prompts gerados</div>
    <div class="atenna-modal__cards">${cardsHtml}</div>
  `;

  modal.querySelector('.atenna-modal__close')!
    .addEventListener('click', () => overlay.remove());

  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) overlay.remove();
  });

  bindCardActions(modal, variants, input, overlay);

  overlay.appendChild(modal);
  document.body.appendChild(overlay);

  // ESC to close
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape') { overlay.remove(); document.removeEventListener('keydown', onKey); }
  };
  document.addEventListener('keydown', onKey);
  overlay.addEventListener('remove', () => document.removeEventListener('keydown', onKey));

  // Focus close button for a11y
  (modal.querySelector('.atenna-modal__close') as HTMLButtonElement | null)?.focus();
}

function buildCardHtml(v: PromptVariant, index: number): string {
  return `
    <div class="atenna-modal__card" data-card="${index}">
      <div class="atenna-modal__card-header">
        <div class="atenna-modal__card-title">
          <span class="atenna-modal__card-badge">${escapeHtml(v.label)}</span>
          <span class="atenna-modal__card-desc">${escapeHtml(v.description)}</span>
        </div>
        <div class="atenna-modal__card-actions">
          <button class="atenna-modal__btn atenna-modal__btn--copy" data-copy="${index}" aria-label="Copiar prompt ${escapeHtml(v.label)}">
            Copiar
          </button>
          <button class="atenna-modal__btn atenna-modal__btn--use" data-use="${index}" aria-label="Usar prompt ${escapeHtml(v.label)}">
            USAR
          </button>
        </div>
      </div>
      <div class="atenna-modal__card-text">${escapeHtml(v.text)}</div>
    </div>
  `;
}

function bindCardActions(
  modal: HTMLElement,
  variants: PromptVariant[],
  input: HTMLElement | null,
  overlay: HTMLElement
): void {
  modal.querySelectorAll<HTMLButtonElement>('[data-copy]').forEach(btn => {
    btn.addEventListener('click', () => {
      const idx = Number(btn.dataset.copy);
      const text = variants[idx].text;
      try {
        Promise.resolve(navigator.clipboard?.writeText(text))
          .then(() => showToast('Copiado para a área de transferência ✓'))
          .catch(() => { fallbackCopy(text); showToast('Copiado ✓'); });
      } catch {
        fallbackCopy(text);
        showToast('Copiado ✓');
      }
    });
  });

  modal.querySelectorAll<HTMLButtonElement>('[data-use]').forEach(btn => {
    btn.addEventListener('click', () => {
      const idx = Number(btn.dataset.use);
      if (input) {
        setInputText(input, variants[idx].text);
        overlay.remove();
      } else {
        showToast('Input não encontrado — copie manualmente');
      }
    });
  });
}

function fallbackCopy(text: string): void {
  const ta = document.createElement('textarea');
  ta.value = text;
  ta.style.cssText = 'position:fixed;top:-9999px;left:-9999px;opacity:0';
  document.body.appendChild(ta);
  ta.select();
  document.execCommand('copy');
  ta.remove();
}

function showToast(message: string): void {
  document.querySelector('.atenna-modal-toast')?.remove();
  const toast = document.createElement('div');
  toast.className = 'atenna-modal-toast';
  toast.textContent = message;
  document.body.appendChild(toast);
  setTimeout(() => toast.remove(), 1900);
}

function escapeHtml(str: string): string {
  return str.replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] ?? c)
  );
}
