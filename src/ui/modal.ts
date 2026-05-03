import { generatePrompts, type PromptVariant } from '../core/promptEngine';
import { getCurrentInput, getInputText, setInputText } from '../core/inputHandler';

const OVERLAY_ID = 'atenna-modal-overlay';

// SVG clipboard icon — universal copy symbol (Jakob's Law)
const COPY_ICON = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
  <rect x="9" y="9" width="13" height="13" rx="2"/>
  <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
</svg>`;

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
  const platformInput = getCurrentInput();
  const userText = platformInput ? getInputText(platformInput) : '';

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
    ? `<img src="${logoUrl}" width="22" height="22" alt="" aria-hidden="true"/>`
    : '';

  let currentVariants = generatePrompts(userText);

  modal.innerHTML = `
    <div class="atenna-modal__header">
      <span class="atenna-modal__title">${logoImg}Atenna Prompt</span>
      <div class="atenna-modal__toggle" role="tablist">
        <button class="atenna-modal__tab atenna-modal__tab--active" data-tab="prompts" role="tab" aria-selected="true">Criar Prompt</button>
        <button class="atenna-modal__tab" data-tab="edit" role="tab" aria-selected="false">Editar Texto</button>
      </div>
      <button class="atenna-modal__close" aria-label="Fechar">×</button>
    </div>

    <div class="atenna-modal__body">
      <div class="atenna-modal__view" data-view="prompts">
        <div class="atenna-modal__cards">${buildCardsHtml(currentVariants)}</div>
      </div>

      <div class="atenna-modal__view atenna-modal__view--hidden" data-view="edit">
        <div class="atenna-modal__edit-label">Seu texto</div>
        <textarea class="atenna-modal__editor" placeholder="Digite ou edite seu texto aqui...">${escapeHtml(userText)}</textarea>
        <button class="atenna-modal__regen">Gerar Prompts</button>
      </div>
    </div>
  `;

  // Close
  modal.querySelector('.atenna-modal__close')!
    .addEventListener('click', () => overlay.remove());

  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) overlay.remove();
  });

  // Tab toggle (Hick's Law: 2 clear options only)
  const tabs = modal.querySelectorAll<HTMLButtonElement>('.atenna-modal__tab');
  const views = modal.querySelectorAll<HTMLElement>('.atenna-modal__view');

  tabs.forEach(tab => {
    tab.addEventListener('click', () => {
      const target = tab.dataset.tab!;
      tabs.forEach(t => { t.classList.toggle('atenna-modal__tab--active', t.dataset.tab === target); t.setAttribute('aria-selected', String(t.dataset.tab === target)); });
      views.forEach(v => v.classList.toggle('atenna-modal__view--hidden', v.dataset.view !== target));
      if (target === 'edit') {
        (modal.querySelector('.atenna-modal__editor') as HTMLTextAreaElement | null)?.focus();
      }
    });
  });

  // Regen from edited text
  modal.querySelector('.atenna-modal__regen')!.addEventListener('click', () => {
    const textarea = modal.querySelector<HTMLTextAreaElement>('.atenna-modal__editor')!;
    const newText = textarea.value.trim();
    currentVariants = generatePrompts(newText);
    const cardsContainer = modal.querySelector<HTMLElement>('.atenna-modal__cards')!;
    cardsContainer.innerHTML = buildCardsHtml(currentVariants);
    bindCardActions(modal, () => currentVariants, platformInput, overlay);
    // Switch back to prompts view
    tabs.forEach(t => { t.classList.toggle('atenna-modal__tab--active', t.dataset.tab === 'prompts'); t.setAttribute('aria-selected', String(t.dataset.tab === 'prompts')); });
    views.forEach(v => v.classList.toggle('atenna-modal__view--hidden', v.dataset.view !== 'prompts'));
  });

  bindCardActions(modal, () => currentVariants, platformInput, overlay);

  overlay.appendChild(modal);
  document.body.appendChild(overlay);

  // ESC to close
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape') { overlay.remove(); document.removeEventListener('keydown', onKey); }
  };
  document.addEventListener('keydown', onKey);
  overlay.addEventListener('remove', () => document.removeEventListener('keydown', onKey));

  (modal.querySelector('.atenna-modal__close') as HTMLButtonElement | null)?.focus();
}

function buildCardsHtml(variants: PromptVariant[]): string {
  return variants.map((v, i) => `
    <div class="atenna-modal__card" data-card="${i}">
      <div class="atenna-modal__card-header">
        <div class="atenna-modal__card-meta">
          <span class="atenna-modal__card-badge">${escapeHtml(v.label)}</span>
          <span class="atenna-modal__card-desc">${escapeHtml(v.description)}</span>
        </div>
        <div class="atenna-modal__card-actions">
          <button class="atenna-modal__btn-copy" data-copy="${i}" aria-label="Copiar ${escapeHtml(v.label)}">${COPY_ICON}</button>
          <button class="atenna-modal__btn-use" data-use="${i}" aria-label="Usar ${escapeHtml(v.label)}">USAR</button>
        </div>
      </div>
      <div class="atenna-modal__card-text">${escapeHtml(v.text)}</div>
    </div>
  `).join('');
}

function bindCardActions(
  modal: HTMLElement,
  getVariants: () => PromptVariant[],
  input: HTMLElement | null,
  overlay: HTMLElement
): void {
  modal.querySelectorAll<HTMLButtonElement>('[data-copy]').forEach(btn => {
    btn.addEventListener('click', () => {
      const text = getVariants()[Number(btn.dataset.copy)].text;
      try {
        Promise.resolve(navigator.clipboard?.writeText(text))
          .then(() => showToast('Copiado ✓'))
          .catch(() => { fallbackCopy(text); showToast('Copiado ✓'); });
      } catch {
        fallbackCopy(text);
        showToast('Copiado ✓');
      }
    });
  });

  modal.querySelectorAll<HTMLButtonElement>('[data-use]').forEach(btn => {
    btn.addEventListener('click', () => {
      const text = getVariants()[Number(btn.dataset.use)].text;
      if (input) {
        setInputText(input, text);
        overlay.remove();
      } else {
        showToast('Input não encontrado — use Copiar');
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
