import { getCurrentInput, getInputText, setInputText } from '../core/inputHandler';
import { getUsage, incrementUsage, isAtLimit, MONTHLY_LIMIT } from '../core/usageCounter';

const OVERLAY_ID  = 'atenna-modal-overlay';
const SUCCESS_MS  = 500;

const LOADING_MESSAGES = [
  'Gerando seus prompts com engenharia de IA...',
  'Analisando seu contexto...',
  'Refinando estrutura...',
  'Só um momento...',
];

// Static SVGs — never contain user content, safe for innerHTML
const CHECK_SVG = `<svg viewBox="0 0 52 52" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
  <circle cx="26" cy="26" r="25" stroke="#22c55e" stroke-width="2"/>
  <polyline points="14,27 22,35 38,17" stroke="#22c55e" stroke-width="3"
    stroke-linecap="round" stroke-linejoin="round"/>
</svg>`;

const COPY_SVG = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none"
  stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
  <rect x="9" y="9" width="13" height="13" rx="2"/>
  <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
</svg>`;

// ─── Module-level state ────────────────────────────────────

let msgIntervalId: ReturnType<typeof setInterval> | undefined;

interface PromptData { direct: string; technical: string; structured: string }

// Cache last generated prompts so reopening with the same text skips re-generation.
let promptCache: { forText: string; data: PromptData } | null = null;

export function clearPromptCache(): void { promptCache = null; }

// ─── Helpers ───────────────────────────────────────────────

function clearMsgInterval(): void {
  if (msgIntervalId !== undefined) { clearInterval(msgIntervalId); msgIntervalId = undefined; }
}

function getLogoUrl(): string {
  try { return chrome.runtime.getURL('icons/icon128.png'); }
  catch { return ''; }
}

function isDark(): boolean {
  const bg = getComputedStyle(document.body).backgroundColor;
  const m = bg.match(/\d+/g);
  if (m && m.length >= 3) return 0.299 * +m[0] + 0.587 * +m[1] + 0.114 * +m[2] < 128;
  return window.matchMedia('(prefers-color-scheme: dark)').matches;
}

// ─── Public ───────────────────────────────────────────────

export function toggleModal(): void {
  const existing = document.getElementById(OVERLAY_ID);
  if (existing) { clearMsgInterval(); existing.remove(); return; }
  openModal();
}

// ─── Build modal skeleton ──────────────────────────────────

function openModal(): void {
  const platformInput = getCurrentInput();
  const userText      = platformInput ? getInputText(platformInput).trim() : '';
  const cacheHit      = promptCache !== null && promptCache.forText === userText && userText !== '';
  // 'edit'    = "Criar Prompt" tab (user writes/edits text + clicks Gerar)
  // 'prompts' = "Meus Prompts" tab (shows the 3 generated cards)
  const defaultTab    = (userText !== '' || cacheHit) ? 'prompts' : 'edit';

  const overlay = document.createElement('div');
  overlay.id = OVERLAY_ID;
  overlay.className = 'atenna-modal-overlay';

  const modal = document.createElement('div');
  modal.className = isDark() ? 'atenna-modal atenna-modal--dark' : 'atenna-modal';
  modal.setAttribute('role', 'dialog');
  modal.setAttribute('aria-modal', 'true');
  modal.setAttribute('aria-label', 'Atenna Prompt');

  const logoUrl = getLogoUrl();
  const logoImg = logoUrl
    ? `<img src="${logoUrl}" width="22" height="22" alt="" aria-hidden="true"/>`
    : '';

  // Tab labels swapped from original:
  // data-tab="edit"    → "Criar Prompt" (write text, click Gerar)
  // data-tab="prompts" → "Meus Prompts" (3 generated cards)
  const editActive    = defaultTab === 'edit'    ? ' atenna-modal__tab--active' : '';
  const promptsActive = defaultTab === 'prompts' ? ' atenna-modal__tab--active' : '';
  const editSelected    = String(defaultTab === 'edit');
  const promptsSelected = String(defaultTab === 'prompts');

  modal.innerHTML = `
    <div class="atenna-modal__header">
      <span class="atenna-modal__title">${logoImg}Atenna Prompt</span>
      <div class="atenna-modal__toggle" role="tablist">
        <button class="atenna-modal__tab${editActive}"    data-tab="edit"    role="tab" aria-selected="${editSelected}">Criar Prompt</button>
        <button class="atenna-modal__tab${promptsActive}" data-tab="prompts" role="tab" aria-selected="${promptsSelected}">Meus Prompts</button>
      </div>
      <div class="atenna-modal__header-right">
        <span class="atenna-modal__usage" aria-label="Uso mensal">…</span>
        <button class="atenna-modal__close" aria-label="Fechar">×</button>
      </div>
    </div>
    <div class="atenna-modal__body">
      <div class="atenna-modal__view${defaultTab === 'prompts' ? '' : ' atenna-modal__view--hidden'}" data-view="prompts"></div>
      <div class="atenna-modal__view${defaultTab === 'edit'    ? '' : ' atenna-modal__view--hidden'}" data-view="edit">
        <div class="atenna-modal__edit-label">Seu texto</div>
        <textarea class="atenna-modal__editor" placeholder="Digite ou edite seu texto aqui..."></textarea>
        <button class="atenna-modal__regen">Gerar Prompts</button>
      </div>
    </div>
  `;

  // User text goes via .value — never innerHTML
  const editorEl    = modal.querySelector<HTMLTextAreaElement>('.atenna-modal__editor')!;
  editorEl.value    = platformInput ? getInputText(platformInput) : '';

  const promptsView = modal.querySelector<HTMLElement>('[data-view="prompts"]')!;
  const usageBadge  = modal.querySelector<HTMLElement>('.atenna-modal__usage')!;

  // ── Close ──────────────────────────────────────────────
  const close = () => { clearMsgInterval(); overlay.remove(); };
  modal.querySelector('.atenna-modal__close')!.addEventListener('click', close);
  overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape') { close(); document.removeEventListener('keydown', onKey); }
  };
  document.addEventListener('keydown', onKey);

  // ── Tab toggle ─────────────────────────────────────────
  const tabs  = modal.querySelectorAll<HTMLButtonElement>('.atenna-modal__tab');
  const views = modal.querySelectorAll<HTMLElement>('.atenna-modal__view');

  const switchTab = (target: string) => {
    tabs.forEach(t  => {
      t.classList.toggle('atenna-modal__tab--active', t.dataset.tab === target);
      t.setAttribute('aria-selected', String(t.dataset.tab === target));
    });
    views.forEach(v => v.classList.toggle('atenna-modal__view--hidden', v.dataset.view !== target));
  };

  tabs.forEach(tab => {
    tab.addEventListener('click', () => {
      switchTab(tab.dataset.tab!);
      if (tab.dataset.tab === 'edit') editorEl.focus();
    });
  });

  // ── Gerar button (from "Criar Prompt" view) ────────────
  modal.querySelector('.atenna-modal__regen')!.addEventListener('click', () => {
    const text = editorEl.value.trim();
    if (!text) return; // nothing to generate
    switchTab('prompts');
    runFlow(promptsView, usageBadge, text, platformInput, overlay);
  });

  overlay.appendChild(modal);
  document.body.appendChild(overlay);

  // ── Auto-generate / show cache / idle ─────────────────
  if (cacheHit) {
    // Same text, already generated — show immediately, no spinner
    void getUsage().then(u => updateUsageBadge(usageBadge, u.count));
    renderPrompts(promptsView, promptCache!.data, platformInput, overlay);
  } else if (userText !== '') {
    // New text — auto-generate
    runFlow(promptsView, usageBadge, userText, platformInput, overlay);
  } else {
    // Empty input — just show usage badge, stay on "Criar Prompt" tab
    void getUsage().then(u => updateUsageBadge(usageBadge, u.count));
  }

  (modal.querySelector('.atenna-modal__close') as HTMLButtonElement).focus();
}

// ─── Main async flow ───────────────────────────────────────

async function runFlow(
  container:     HTMLElement,
  usageBadge:    HTMLElement,
  userText:      string,
  platformInput: HTMLElement | null,
  overlay:       HTMLElement
): Promise<void> {
  renderLoading(container);

  const usage = await getUsage();
  updateUsageBadge(usageBadge, usage.count);

  if (isAtLimit(usage)) {
    renderLimitReached(container);
    return;
  }

  const data = await fetchPrompts(userText);

  if (!document.getElementById(OVERLAY_ID)) return; // closed during fetch

  await renderSuccess(container);

  if (!document.getElementById(OVERLAY_ID)) return; // closed during animation

  const newUsage = await incrementUsage();
  updateUsageBadge(usageBadge, newUsage.count);

  // Cache the result for this text
  promptCache = { forText: userText, data };

  renderPrompts(container, data, platformInput, overlay);
}

// ─── Render: loading ───────────────────────────────────────

function renderLoading(container: HTMLElement): void {
  clearMsgInterval();
  container.innerHTML = '';

  const wrap    = document.createElement('div');
  wrap.className = 'atenna-modal__loading';

  const spinner = document.createElement('div');
  spinner.className = 'atenna-modal__spinner';

  const msg = document.createElement('p');
  msg.className = 'atenna-modal__loading-msg';
  msg.textContent = LOADING_MESSAGES[0];

  wrap.appendChild(spinner);
  wrap.appendChild(msg);
  container.appendChild(wrap);

  let i = 0;
  msgIntervalId = setInterval(() => {
    if (!msg.isConnected) { clearMsgInterval(); return; }
    i = (i + 1) % LOADING_MESSAGES.length;
    msg.textContent = LOADING_MESSAGES[i];
  }, 1500);
}

// ─── Render: success ───────────────────────────────────────

function renderSuccess(container: HTMLElement): Promise<void> {
  clearMsgInterval();
  container.innerHTML = '';

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

function renderLimitReached(container: HTMLElement): void {
  clearMsgInterval();
  container.innerHTML = '';

  const wrap = document.createElement('div');
  wrap.className = 'atenna-modal__loading';

  const icon = document.createElement('div');
  icon.className = 'atenna-modal__limit-icon';
  icon.textContent = '🔒';

  const msg = document.createElement('p');
  msg.className = 'atenna-modal__loading-msg';
  msg.textContent = 'Limite mensal atingido';

  const sub = document.createElement('p');
  sub.className = 'atenna-modal__loading-sub';
  sub.textContent = `Você usou ${MONTHLY_LIMIT} gerações este mês. O contador reseta automaticamente em 30 dias.`;

  wrap.appendChild(icon);
  wrap.appendChild(msg);
  wrap.appendChild(sub);
  container.appendChild(wrap);
}

// ─── Render: prompt cards ──────────────────────────────────

function renderPrompts(
  container:     HTMLElement,
  data:          PromptData,
  platformInput: HTMLElement | null,
  overlay:       HTMLElement
): void {
  clearMsgInterval();
  container.innerHTML = '';

  const entries = [
    { label: 'Direto',      description: 'Claro e objetivo',      text: data.direct },
    { label: 'Técnico',     description: 'Aprofundado e preciso', text: data.technical },
    { label: 'Estruturado', description: 'Organizado em seções',  text: data.structured },
  ];

  const cards = document.createElement('div');
  cards.className = 'atenna-modal__cards';
  entries.forEach((v, i) => cards.appendChild(buildCard(v, i, platformInput, overlay)));
  container.appendChild(cards);
}

function buildCard(
  v:             { label: string; description: string; text: string },
  index:         number,
  platformInput: HTMLElement | null,
  overlay:       HTMLElement
): HTMLElement {
  const card = document.createElement('div');
  card.className = 'atenna-modal__card';
  card.dataset.card = String(index);

  const header  = document.createElement('div');
  header.className = 'atenna-modal__card-header';

  const meta  = document.createElement('div');
  meta.className = 'atenna-modal__card-meta';

  const badge = document.createElement('span');
  badge.className = 'atenna-modal__card-badge';
  badge.textContent = v.label;           // textContent — safe

  const desc = document.createElement('span');
  desc.className = 'atenna-modal__card-desc';
  desc.textContent = v.description;      // textContent — safe

  meta.appendChild(badge);
  meta.appendChild(desc);

  const actions = document.createElement('div');
  actions.className = 'atenna-modal__card-actions';

  const copyBtn = document.createElement('button');
  copyBtn.className = 'atenna-modal__btn-copy';
  copyBtn.setAttribute('aria-label', `Copiar ${v.label}`);
  copyBtn.innerHTML = COPY_SVG;          // static SVG — safe

  const useBtn = document.createElement('button');
  useBtn.className = 'atenna-modal__btn-use';
  useBtn.setAttribute('aria-label', `Usar ${v.label}`);
  useBtn.textContent = 'USAR';           // textContent — safe

  actions.appendChild(copyBtn);
  actions.appendChild(useBtn);
  header.appendChild(meta);
  header.appendChild(actions);

  const ta = document.createElement('textarea');
  ta.className = 'atenna-modal__card-textarea';
  ta.readOnly = true;
  ta.value = v.text;                     // .value — safe
  ta.rows = 4;
  ta.setAttribute('aria-label', `Prompt ${v.label}`);

  card.appendChild(header);
  card.appendChild(ta);

  copyBtn.addEventListener('click', () => {
    const text = ta.value;
    try {
      Promise.resolve(navigator.clipboard?.writeText(text))
        .then(() => showToast('Copiado!'))
        .catch(() => { fallbackCopy(text); showToast('Copiado!'); });
    } catch {
      fallbackCopy(text);
      showToast('Copiado!');
    }
  });

  useBtn.addEventListener('click', () => {
    if (platformInput) {
      setInputText(platformInput, ta.value);
      clearMsgInterval();
      overlay.remove();
      showToast('Prompt aplicado ✓');
    } else {
      showToast('Input não encontrado — use Copiar');
    }
  });

  return card;
}

// ─── Usage badge ───────────────────────────────────────────

function updateUsageBadge(badge: HTMLElement, count: number): void {
  badge.textContent = `${count}/${MONTHLY_LIMIT}`;
  badge.className = 'atenna-modal__usage';
  if (count >= MONTHLY_LIMIT)           badge.classList.add('atenna-modal__usage--danger');
  else if (count >= MONTHLY_LIMIT - 5)  badge.classList.add('atenna-modal__usage--warning');
}

// ─── Backend fetch (via background worker to bypass CORS) ──

export async function fetchPrompts(inputText: string): Promise<PromptData> {
  const fallback: PromptData = {
    direct:      `Explique de forma clara e objetiva:\n\n${inputText}`,
    technical:   `Você é um especialista. Analise profundamente:\n\n${inputText}`,
    structured:  `Responda com contexto, solução e conclusão:\n\n${inputText}`,
  };
  try {
    const response = await sendToBackground(inputText);
    if (!response || !response.ok) throw new Error('backend error');
    return response.data as PromptData;
  } catch (err) {
    console.error('[Atenna] erro backend:', err);
    return fallback;
  }
}

function sendToBackground(inputText: string): Promise<{ ok: boolean; data: unknown } | null> {
  return new Promise((resolve) => {
    try {
      chrome.runtime.sendMessage(
        { type: 'ATENNA_FETCH', input: inputText },
        (response: { ok: boolean; data: unknown } | null | undefined) => {
          if (chrome.runtime.lastError) { resolve(null); return; }
          resolve(response ?? null);
        }
      );
    } catch { resolve(null); }
  });
}

// ─── Helpers ───────────────────────────────────────────────

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
