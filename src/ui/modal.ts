import { getCurrentInput, getInputText, setInputText } from '../core/inputHandler';
import { getUsage, incrementUsage, isAtLimit, DAILY_LIMIT, getTotalCount, incrementTotalCount, getMonthlyUsage, MONTHLY_LIMIT } from '../core/usageCounter';
import { isPro, syncPlanFromSupabase } from '../core/planManager';
import { getActiveSession, signInWithMagicLink, signUpWithPassword, resetPassword } from '../core/auth';
import { track, trackEvent } from '../core/analytics';
import { getHistory, addToHistory, toggleFavorite } from '../core/history';
import type { PromptOrigin, PromptType } from '../core/analytics';

const OVERLAY_ID  = 'atenna-modal-overlay';
const SUCCESS_MS  = 500;

const LOADING_MESSAGES = [
  'Analisando seu prompt...',
  'Estruturando a resposta...',
  'Refinando os detalhes...',
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

interface PromptData {
  direct: string; technical: string; structured: string;
  direct_preview?: string; technical_preview?: string; structured_preview?: string;
}

// Cache last generated prompts so reopening with the same text skips re-generation.
let promptCache: { forText: string; data: PromptData } | null = null;

let upgradeShown = false;
const UPGRADE_TRIGGER = 3; // show upgrade banner after this many total generations

export function clearPromptCache(): void { promptCache = null; upgradeShown = false; }

// ─── Input analysis ──────────────────────────────────────

function isVagueInput(text: string): boolean {
  const words = text.trim().split(/\s+/).filter(Boolean);
  return words.length === 1;
}

function shouldSuggestBuilder(text: string): boolean {
  const trimmed = text.trim();
  if (trimmed.length >= 80) return false;
  if (trimmed.includes('?')) return false;
  const actionVerbs = ['crie', 'explique', 'descreva', 'analise', 'gere', 'faça', 'escreva', 'organize', 'estruture'];
  return !actionVerbs.some(verb => trimmed.toLowerCase().includes(verb));
}

function renderOnboarding(
  container: HTMLElement,
  onChipClick: (suggestion: string) => void,
): void {
  container.innerHTML = '';
  const wrap = document.createElement('div');
  wrap.className = 'atenna-modal__empty-state';

  const title = document.createElement('h3');
  title.className = 'atenna-modal__empty-title';
  title.textContent = 'Comece com uma ideia simples.';

  const subtitle = document.createElement('p');
  subtitle.className = 'atenna-modal__empty-subtitle';
  subtitle.textContent = 'Escolha um exemplo ou escreva algo. Vamos transformar em um prompt estruturado.';

  const chipsContainer = document.createElement('div');
  chipsContainer.className = 'atenna-modal__empty-chips';

  const examples = [
    'Criar guia de estudo',
    'Post para LinkedIn',
    'Explicação técnica',
    'Proposta comercial',
    'Roteiro de aula',
    'Email profissional',
  ];

  examples.forEach(example => {
    const chip = document.createElement('button');
    chip.className = 'atenna-modal__empty-chip';
    chip.textContent = example;
    chip.type = 'button';
    chip.addEventListener('click', () => onChipClick(example));
    chipsContainer.appendChild(chip);
  });

  wrap.appendChild(title);
  wrap.appendChild(subtitle);
  wrap.appendChild(chipsContainer);
  container.appendChild(wrap);
}

function renderEmptyState(
  container: HTMLElement,
  onChipClick: (suggestion: string) => void,
): void {
  container.innerHTML = '';
  const wrap = document.createElement('div');
  wrap.className = 'atenna-modal__empty-state';

  const title = document.createElement('h3');
  title.className = 'atenna-modal__empty-title';
  title.textContent = 'O que você quer criar hoje?';

  const subtitle = document.createElement('p');
  subtitle.className = 'atenna-modal__empty-subtitle';
  subtitle.textContent = 'Escolha um ponto de partida ou escreva sua própria ideia.';

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

async function renderMeusPrompts(
  container: HTMLElement,
  platformInput: HTMLElement | null,
  overlay: HTMLElement,
): Promise<void> {
  container.innerHTML = '';
  const entries = await getHistory();

  if (entries.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'atenna-modal__empty-state';
    empty.innerHTML = `
      <h3 class="atenna-modal__empty-title">Histórico vazio</h3>
      <p class="atenna-modal__empty-subtitle">Seus prompts salvos aparecerão aqui.</p>
    `;
    container.appendChild(empty);
    return;
  }

  const wrap = document.createElement('div');
  wrap.className = 'atenna-modal__history';

  entries.forEach(entry => {
    const card = document.createElement('div');
    card.className = 'atenna-modal__history-card';

    const header = document.createElement('div');
    header.className = 'atenna-modal__history-header';

    const badge = document.createElement('span');
    badge.className = 'atenna-modal__history-badge';
    badge.textContent = entry.type === 'direct' ? 'Direto' : entry.type === 'structured' ? 'Estruturado' : 'Técnico';

    const date = document.createElement('span');
    date.className = 'atenna-modal__history-date';
    const d = new Date(entry.date);
    date.textContent = d.toLocaleDateString('pt-BR');

    const actions = document.createElement('div');
    actions.className = 'atenna-modal__history-actions';

    const starBtn = document.createElement('button');
    starBtn.className = entry.favorited ? 'atenna-modal__history-star atenna-modal__history-star--active' : 'atenna-modal__history-star';
    starBtn.textContent = entry.favorited ? '★' : '☆';
    starBtn.title = entry.favorited ? 'Remover favorito' : 'Adicionar favorito';
    starBtn.addEventListener('click', async () => {
      await toggleFavorite(entry.id);
      await renderMeusPrompts(container, platformInput, overlay);
    });

    const useBtn = document.createElement('button');
    useBtn.className = 'atenna-modal__history-use';
    useBtn.textContent = 'Usar';
    useBtn.addEventListener('click', () => {
      if (platformInput) {
        setInputText(platformInput, entry.text);
        overlay.remove();
        showToast('Prompt aplicado ✓');
      } else {
        showToast('Input não encontrado');
      }
    });

    const copyBtn = document.createElement('button');
    copyBtn.className = 'atenna-modal__history-copy';
    copyBtn.textContent = 'Copiar';
    copyBtn.addEventListener('click', () => {
      navigator.clipboard?.writeText(entry.text).then(() => showToast('Copiado!'));
    });

    actions.appendChild(starBtn);
    actions.appendChild(useBtn);
    actions.appendChild(copyBtn);

    header.appendChild(badge);
    header.appendChild(date);
    header.appendChild(actions);

    const preview = document.createElement('p');
    preview.className = 'atenna-modal__history-preview';
    preview.textContent = entry.text.substring(0, 100) + (entry.text.length > 100 ? '…' : '');

    card.appendChild(header);
    card.appendChild(preview);
    wrap.appendChild(card);
  });

  container.appendChild(wrap);
}

function renderUpgradeModal(onClose: () => void): HTMLElement {
  const overlay = document.createElement('div');
  overlay.className = 'atenna-modal-overlay';
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) onClose();
  });

  const modal = document.createElement('div');
  modal.className = 'atenna-modal';

  const close = document.createElement('button');
  close.className = 'atenna-modal__close';
  close.textContent = '×';
  close.addEventListener('click', onClose);

  const title = document.createElement('h2');
  title.className = 'atenna-modal__upgrade-title';
  title.textContent = 'Desbloqueie o Atenna Pro';

  const subtitle = document.createElement('p');
  subtitle.className = 'atenna-modal__upgrade-subtitle';
  subtitle.textContent = 'Limite mensal de 300 gerações com prioridade de processamento.';

  const comparison = document.createElement('div');
  comparison.className = 'atenna-modal__upgrade-comparison';

  const freeCol = document.createElement('div');
  freeCol.className = 'atenna-modal__upgrade-col';
  freeCol.innerHTML = `
    <h3>Plano Free</h3>
    <ul>
      <li>10 gerações/dia</li>
      <li>25 gerações/mês</li>
      <li>3 tipos de prompt</li>
      <li>Histórico limitado</li>
      <li class="atenna-modal__upgrade-item--disabled">Prioridade ❌</li>
      <li class="atenna-modal__upgrade-item--disabled">Suporte ❌</li>
    </ul>
  `;

  const proCol = document.createElement('div');
  proCol.className = 'atenna-modal__upgrade-col atenna-modal__upgrade-col--highlight';
  proCol.innerHTML = `
    <h3>Plano Pro</h3>
    <ul>
      <li>Gerações ilimitadas</li>
      <li>300 gerações/mês</li>
      <li>3 tipos de prompt</li>
      <li>Histórico completo</li>
      <li class="atenna-modal__upgrade-item--enabled">Prioridade ✓</li>
      <li class="atenna-modal__upgrade-item--enabled">Suporte ✓</li>
    </ul>
  `;

  comparison.appendChild(freeCol);
  comparison.appendChild(proCol);

  const ctaBtn = document.createElement('button');
  ctaBtn.className = 'atenna-modal__upgrade-btn';
  ctaBtn.textContent = 'Entrar na lista Pro';
  ctaBtn.addEventListener('click', () => {
    void trackEvent('upgrade_interest_registered');
    showToast('Interesse registrado! Em breve.');
    onClose();
  });

  const dismissBtn = document.createElement('button');
  dismissBtn.className = 'atenna-modal__upgrade-dismiss-btn';
  dismissBtn.textContent = 'Agora não';
  dismissBtn.addEventListener('click', onClose);

  modal.appendChild(close);
  modal.appendChild(title);
  modal.appendChild(subtitle);
  modal.appendChild(comparison);
  modal.appendChild(ctaBtn);
  modal.appendChild(dismissBtn);
  overlay.appendChild(modal);

  return overlay;
}

function renderSuggestion(
  container: HTMLElement,
  onImprove: () => void,
  onIgnore:  () => void,
): void {
  container.innerHTML = '';
  const wrap = document.createElement('div');
  wrap.className = 'atenna-modal__suggest';

  const icon = document.createElement('span');
  icon.className = 'atenna-modal__suggest-icon';
  icon.textContent = '→';

  const msg = document.createElement('p');
  msg.className = 'atenna-modal__suggest-text';
  msg.textContent = 'Posso melhorar seu prompt com o Builder — quer tentar?';

  const actions = document.createElement('div');
  actions.className = 'atenna-modal__suggest-actions';

  const improveBtn = document.createElement('button');
  improveBtn.className = 'atenna-modal__suggest-btn atenna-modal__suggest-btn--primary';
  improveBtn.textContent = 'Melhorar agora';
  improveBtn.addEventListener('click', onImprove);

  const ignoreBtn = document.createElement('button');
  ignoreBtn.className = 'atenna-modal__suggest-btn';
  ignoreBtn.textContent = 'Ignorar';
  ignoreBtn.addEventListener('click', onIgnore);

  actions.appendChild(improveBtn);
  actions.appendChild(ignoreBtn);
  wrap.appendChild(icon);
  wrap.appendChild(msg);
  wrap.appendChild(actions);
  container.appendChild(wrap);
}

// ─── Builder chip value helper ─────────────────────────────

function getBuilderVal(fieldEl: HTMLElement): string {
  const chip  = fieldEl.querySelector<HTMLButtonElement>('.atenna-modal__chip--active');
  const ta    = fieldEl.querySelector<HTMLTextAreaElement>('.atenna-modal__builder-q');
  const chipV = chip?.dataset.value ?? '';
  const taV   = ta?.value.trim() ?? '';
  if (chipV && taV) return `${chipV}: ${taV}`;
  return chipV || taV;
}

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
  void openModal();
}

// ─── Build modal skeleton ──────────────────────────────────

async function openModal(): Promise<void> {
  void trackEvent('modal_opened');

  const overlay = document.createElement('div');
  overlay.id = OVERLAY_ID;
  overlay.className = 'atenna-modal-overlay';

  const modal = document.createElement('div');
  modal.className = isDark() ? 'atenna-modal atenna-modal--dark' : 'atenna-modal';
  modal.setAttribute('role', 'dialog');
  modal.setAttribute('aria-modal', 'true');
  modal.setAttribute('aria-label', 'Atenna Prompt');

  overlay.appendChild(modal);
  document.body.appendChild(overlay);

  // ── Close handler ────────────────────────────────────
  const close = () => { clearMsgInterval(); overlay.remove(); };
  overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape') { close(); document.removeEventListener('keydown', onKey); }
  };
  document.addEventListener('keydown', onKey);

  // Show loading state
  renderLoading(modal);

  // ── Auth Gate: Check session FIRST ───────────────────
  const session = await getActiveSession();

  if (!session) {
    // No session: show ONLY login screen
    const logoUrl = getLogoUrl();
    const logoImg = logoUrl
      ? `<img src="${logoUrl}" width="22" height="22" alt="" aria-hidden="true"/>`
      : '';

    modal.innerHTML = `
      <div class="atenna-modal__header">
        <span class="atenna-modal__title">${logoImg}Atenna Prompt</span>
        <button class="atenna-modal__close" aria-label="Fechar">×</button>
      </div>
      <div class="atenna-modal__body">
        <div class="atenna-modal__view" data-view="login"></div>
      </div>
    `;

    const loginView = modal.querySelector<HTMLElement>('[data-view="login"]')!;
    const switchAuthView = (view: string) => {
      if (view === 'login') renderLoginView(loginView, switchAuthView);
      else if (view === 'signup') renderSignupView(loginView, switchAuthView);
      else if (view === 'reset') renderResetView(loginView, switchAuthView);
    };
    switchAuthView('login');

    modal.querySelector('.atenna-modal__close')!.addEventListener('click', close);
    return;
  }

  // ── Session exists: Render full app ──────────────────
  await syncPlanFromSupabase(session);

  const platformInput = getCurrentInput();
  const userText      = platformInput ? getInputText(platformInput).trim() : '';
  const cacheHit      = promptCache !== null && promptCache.forText === userText && userText !== '';
  const defaultTab    = (userText !== '' || cacheHit) ? 'prompts' : 'edit';

  const logoUrl = getLogoUrl();
  const logoImg = logoUrl
    ? `<img src="${logoUrl}" width="22" height="22" alt="" aria-hidden="true"/>`
    : '';

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
        <button class="atenna-modal__header-pro" data-pro style="display: none;">Pro</button>
        <button class="atenna-modal__close" aria-label="Fechar">×</button>
      </div>
    </div>
    <div class="atenna-modal__body">
      <div class="atenna-modal__view${defaultTab === 'prompts' ? '' : ' atenna-modal__view--hidden'}" data-view="prompts"></div>
      <div class="atenna-modal__view${defaultTab === 'edit'    ? '' : ' atenna-modal__view--hidden'}" data-view="edit">
        <div class="atenna-modal__edit-label">Seu texto</div>
        <textarea class="atenna-modal__editor" placeholder="Digite ou edite seu texto aqui..."></textarea>
        <button class="atenna-modal__builder-toggle" type="button">
          <span class="atenna-modal__builder-toggle-icon">✦</span>
          Builder Inteligente
          <span class="atenna-modal__builder-toggle-arrow">›</span>
        </button>
        <div class="atenna-modal__builder">
          <p class="atenna-modal__builder-hint">Escolha ou descreva — combinamos para gerar prompts superiores</p>
          <div class="atenna-modal__builder-item">
            <span class="atenna-modal__builder-num">1</span>
            <div class="atenna-modal__builder-field">
              <label class="atenna-modal__builder-label">Qual o objetivo?</label>
              <div class="atenna-modal__chips" data-group="objetivo">
                <button type="button" class="atenna-modal__chip" data-value="Aprender">Aprender</button>
                <button type="button" class="atenna-modal__chip" data-value="Resolver problema">Resolver</button>
                <button type="button" class="atenna-modal__chip" data-value="Entender profundamente">Entender</button>
                <button type="button" class="atenna-modal__chip" data-value="Criar algo novo">Criar</button>
                <button type="button" class="atenna-modal__chip" data-value="Analisar">Analisar</button>
              </div>
              <textarea class="atenna-modal__builder-q" rows="1" placeholder="Outro objetivo (opcional)"></textarea>
            </div>
          </div>
          <div class="atenna-modal__builder-item">
            <span class="atenna-modal__builder-num">2</span>
            <div class="atenna-modal__builder-field">
              <label class="atenna-modal__builder-label">Para quem? Qual o contexto?</label>
              <div class="atenna-modal__chips" data-group="contexto">
                <button type="button" class="atenna-modal__chip" data-value="Iniciante">Iniciante</button>
                <button type="button" class="atenna-modal__chip" data-value="Intermediário">Intermediário</button>
                <button type="button" class="atenna-modal__chip" data-value="Avançado">Avançado</button>
                <button type="button" class="atenna-modal__chip" data-value="Profissional">Profissional</button>
                <button type="button" class="atenna-modal__chip" data-value="Caso específico">Específico</button>
              </div>
              <textarea class="atenna-modal__builder-q" rows="1" placeholder="Contexto adicional (opcional)"></textarea>
            </div>
          </div>
          <div class="atenna-modal__builder-item">
            <span class="atenna-modal__builder-num">3</span>
            <div class="atenna-modal__builder-field">
              <label class="atenna-modal__builder-label">Formato e nível de detalhe?</label>
              <div class="atenna-modal__chips" data-group="formato">
                <button type="button" class="atenna-modal__chip" data-value="Explicação simples">Simples</button>
                <button type="button" class="atenna-modal__chip" data-value="Passo a passo">Passo a passo</button>
                <button type="button" class="atenna-modal__chip" data-value="Estruturado em seções">Estruturado</button>
                <button type="button" class="atenna-modal__chip" data-value="Profissional">Profissional</button>
                <button type="button" class="atenna-modal__chip" data-value="Técnico profundo">Técnico</button>
              </div>
              <textarea class="atenna-modal__builder-q" rows="1" placeholder="Formato personalizado (opcional)"></textarea>
            </div>
          </div>
        </div>
        <button class="atenna-modal__regen">Gerar Prompts</button>
      </div>
    </div>
  `;

  const editorEl    = modal.querySelector<HTMLTextAreaElement>('.atenna-modal__editor')!;
  editorEl.value    = platformInput ? getInputText(platformInput) : '';

  const promptsView = modal.querySelector<HTMLElement>('[data-view="prompts"]')!;
  const usageBadge  = modal.querySelector<HTMLElement>('.atenna-modal__usage')!;

  modal.querySelector('.atenna-modal__close')!.addEventListener('click', close);

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
      if (tab.dataset.tab === 'edit') {
        editorEl.focus();
      } else if (tab.dataset.tab === 'prompts') {
        void renderMeusPrompts(promptsView, platformInput, overlay);
      }
    });
  });

  // ── Builder toggle ─────────────────────────────────────
  const builderToggleEl = modal.querySelector<HTMLButtonElement>('.atenna-modal__builder-toggle')!;
  const builderEl       = modal.querySelector<HTMLElement>('.atenna-modal__builder')!;

  builderToggleEl.addEventListener('click', () => {
    const isOpen = builderEl.classList.contains('atenna-modal__builder--open');
    if (!isOpen) void track('builder_opened');
    builderEl.classList.toggle('atenna-modal__builder--open', !isOpen);
    builderToggleEl.classList.toggle('atenna-modal__builder-toggle--open', !isOpen);
  });

  // ── Chip selection (one active per group) ──────────────
  builderEl.querySelectorAll<HTMLElement>('.atenna-modal__chips').forEach(group => {
    group.querySelectorAll<HTMLButtonElement>('.atenna-modal__chip').forEach(chip => {
      chip.addEventListener('click', () => {
        group.querySelectorAll('.atenna-modal__chip')
          .forEach(c => c.classList.remove('atenna-modal__chip--active'));
        chip.classList.add('atenna-modal__chip--active');
      });
    });
  });

  // ── Gerar button (from "Criar Prompt" view) ────────────
  modal.querySelector('.atenna-modal__regen')!.addEventListener('click', () => {
    const baseText      = editorEl.value.trim();
    const isBuilderOpen = builderEl.classList.contains('atenna-modal__builder--open');

    let text: string;
    if (isBuilderOpen) {
      const fields   = modal.querySelectorAll<HTMLElement>('.atenna-modal__builder-field');
      const objetivo = getBuilderVal(fields[0]);
      const contexto = getBuilderVal(fields[1]);
      const formato  = getBuilderVal(fields[2]);
      if (!objetivo && !contexto && !formato && !baseText) return;
      text = buildStructuredInput(objetivo, contexto, formato, baseText);
    } else {
      if (!baseText) return;
      text = baseText;
    }
    const origin: PromptOrigin = isBuilderOpen ? 'builder' : 'manual';
    void trackEvent('prompt_generate_clicked', { input_length: text.length, origin });
    switchTab('prompts');
    void isPro().then(pro => runFlow(promptsView, usageBadge, text, platformInput, overlay, origin, pro));
  });

  // ── Auto-generate / show cache / idle ─────────────────
  const [usage, pro, totalCount] = await Promise.all([getUsage(), isPro(), getTotalCount()]);
  await updateUsageBadge(usageBadge, usage.count, pro);

  // Show/hide Pro button
  const proBtn = modal.querySelector<HTMLButtonElement>('[data-pro]');
  if (proBtn) {
    if (!pro) {
      proBtn.style.display = '';
      proBtn.addEventListener('click', () => {
        void trackEvent('upgrade_modal_shown');
        const upgradeOverlay = renderUpgradeModal(() => {
          void trackEvent('upgrade_modal_closed');
          upgradeOverlay.remove();
        });
        document.body.appendChild(upgradeOverlay);
      });
    }
  }

  if (cacheHit) {
    renderPrompts(promptsView, promptCache!.data, platformInput, overlay, 'manual');
  } else if (userText !== '') {
    if (!cacheHit && userText !== '') renderLoading(promptsView);
    const shouldShowSuggestion = (pro && isVagueInput(userText)) || (pro && shouldSuggestBuilder(userText));
    if (shouldShowSuggestion) {
      void trackEvent('auto_suggestion_shown');
      renderSuggestion(
        promptsView,
        () => {
          void trackEvent('auto_suggestion_accepted');
          switchTab('edit');
          builderEl.classList.add('atenna-modal__builder--open');
          builderToggleEl.classList.add('atenna-modal__builder-toggle--open');
        },
        () => runFlow(promptsView, usageBadge, userText, platformInput, overlay, 'auto', pro),
      );
    } else {
      void runFlow(promptsView, usageBadge, userText, platformInput, overlay, 'auto', pro);
    }
  } else if (totalCount === 0) {
    renderOnboarding(promptsView, (example: string) => {
      editorEl.value = example;
      editorEl.focus();
      switchTab('edit');
    });
  }

  (modal.querySelector('.atenna-modal__close') as HTMLButtonElement).focus();
}

// ─── Main async flow ───────────────────────────────────────

async function runFlow(
  container:     HTMLElement,
  usageBadge:    HTMLElement,
  userText:      string,
  platformInput: HTMLElement | null,
  overlay:       HTMLElement,
  origin:        PromptOrigin = 'manual',
  pro:           boolean = false,
): Promise<void> {
  renderLoading(container);

  const usage = await getUsage();
  await updateUsageBadge(usageBadge, usage.count, pro);

  if (!pro && isAtLimit(usage)) {
    void trackEvent('quota_limit_reached', { origin });
    renderLimitReached(container);
    return;
  }

  try {
    const data = await fetchPrompts(userText);

    if (!document.getElementById(OVERLAY_ID)) return;

    await renderSuccess(container);

    if (!document.getElementById(OVERLAY_ID)) return;

    const [newUsage, newTotalCount] = await Promise.all([incrementUsage(), incrementTotalCount()]);
    await updateUsageBadge(usageBadge, newUsage.count, pro);
    void trackEvent('prompt_generate_success', { input_length: userText.length, output_length: JSON.stringify(data).length, origin });

    // Save to history (direct as primary)
    void addToHistory(data.direct, 'direct', origin);

    // Milestone tracking
    if (newTotalCount === 1) {
      void trackEvent('first_prompt_generated');
      showToast('🎉 Primeiro prompt criado!');
    } else if (newTotalCount === 3) {
      void trackEvent('third_prompt_generated');
    } else if (newTotalCount === 5) {
      void trackEvent('fifth_prompt_generated');
    }

    promptCache = { forText: userText, data };

    renderPrompts(container, data, platformInput, overlay, origin, newTotalCount);
  } catch (error) {
    void trackEvent('prompt_generate_error', { origin, error: String(error) });
    if (document.getElementById(OVERLAY_ID)) {
      container.innerHTML = '<div style="padding: 20px; text-align: center;">Erro ao gerar prompts. Tente novamente.</div>';
    }
  }
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
  icon.textContent = '⊘';

  const msg = document.createElement('p');
  msg.className = 'atenna-modal__loading-msg';
  msg.textContent = 'Limite mensal atingido';

  const sub = document.createElement('p');
  sub.className = 'atenna-modal__loading-sub';
  sub.textContent = `Você atingiu ${DAILY_LIMIT} gerações hoje. O contador reseta à meia-noite.`;

  wrap.appendChild(icon);
  wrap.appendChild(msg);
  wrap.appendChild(sub);
  container.appendChild(wrap);
}

function renderLoginView(container: HTMLElement, switchView: (view: string) => void): void {
  void trackEvent('login_view_shown');
  clearMsgInterval();
  container.innerHTML = '';

  const wrap = document.createElement('div');
  wrap.className = 'atenna-modal__login';

  const title = document.createElement('h2');
  title.className = 'atenna-modal__login-title';
  title.textContent = 'A IA certa começa com o prompt certo';

  const subtitle = document.createElement('p');
  subtitle.className = 'atenna-modal__login-subtitle';
  subtitle.textContent = 'Crie prompts estruturados com precisão e clareza em segundos';

  const features = document.createElement('div');
  features.className = 'atenna-modal__login-features';
  features.innerHTML = `
    <div class="atenna-modal__feature">5 gerações gratuitas por dia</div>
    <div class="atenna-modal__feature">Estruturação inteligente automática</div>
    <div class="atenna-modal__feature">Otimizado para IA moderna</div>
  `;

  const inputGroup = document.createElement('div');
  inputGroup.className = 'atenna-modal__login-group';

  // Email com ícone
  const emailWrapper = document.createElement('div');
  emailWrapper.className = 'atenna-modal__input-wrapper';
  const emailInput = document.createElement('input');
  emailInput.type = 'email';
  emailInput.className = 'atenna-modal__login-input';
  emailInput.placeholder = 'seu@email.com';
  emailInput.autocomplete = 'email';
  const emailIcon = document.createElement('span');
  emailIcon.className = 'atenna-modal__input-icon-left';
  emailIcon.textContent = '✉';
  emailWrapper.appendChild(emailIcon);
  emailWrapper.appendChild(emailInput);

  // Senha com ícone + eye toggle
  const passwordWrapper = document.createElement('div');
  passwordWrapper.className = 'atenna-modal__input-wrapper';
  const passwordInput = document.createElement('input');
  passwordInput.type = 'password';
  passwordInput.className = 'atenna-modal__login-input';
  passwordInput.placeholder = 'Sua senha';
  passwordInput.autocomplete = 'current-password';
  const pwdIcon = document.createElement('span');
  pwdIcon.className = 'atenna-modal__input-icon-left';
  pwdIcon.textContent = '⚿';
  const eyeToggle = document.createElement('button');
  eyeToggle.className = 'atenna-modal__input-icon-right';
  eyeToggle.type = 'button';
  eyeToggle.textContent = '○';
  eyeToggle.title = 'Mostrar senha';
  eyeToggle.addEventListener('click', (e) => {
    e.preventDefault();
    const isPassword = passwordInput.type === 'password';
    passwordInput.type = isPassword ? 'text' : 'password';
    eyeToggle.title = isPassword ? 'Esconder senha' : 'Mostrar senha';
  });
  passwordWrapper.appendChild(pwdIcon);
  passwordWrapper.appendChild(passwordInput);
  passwordWrapper.appendChild(eyeToggle);

  const btn = document.createElement('button');
  btn.className = 'atenna-modal__login-btn';
  btn.textContent = 'Entrar';

  const status = document.createElement('div');
  status.className = 'atenna-modal__login-status';

  const handleClick = async () => {
    const email = emailInput.value.trim();
    const pwd = passwordInput.value;

    if (!email) {
      status.textContent = 'Informe seu email';
      status.classList.remove('atenna-modal__login-status--error', 'atenna-modal__login-status--success');
      status.classList.add('atenna-modal__login-status--warning');
      return;
    }
    if (!pwd) {
      status.textContent = 'Informe sua senha';
      status.classList.remove('atenna-modal__login-status--error', 'atenna-modal__login-status--success');
      status.classList.add('atenna-modal__login-status--warning');
      return;
    }

    void trackEvent('login_email_submitted', { input_length: email.length });

    btn.disabled = true;
    btn.textContent = 'Entrando…';
    status.textContent = '';

    const result = await signInWithMagicLink(email);
    if (result.error) {
      void trackEvent('login_error', { error: result.error });
      status.textContent = result.error;
      status.classList.remove('atenna-modal__login-status--success');
      status.classList.add('atenna-modal__login-status--error');
      btn.disabled = false;
      btn.textContent = 'Entrar';
    } else {
      void trackEvent('login_success');
      status.innerHTML = '<strong>Verifique seu email!</strong><br>Clique no link de confirmação para entrar.';
      status.classList.remove('atenna-modal__login-status--error');
      status.classList.add('atenna-modal__login-status--success');
      emailInput.disabled = true;
      passwordInput.disabled = true;
      btn.style.display = 'none';
    }
  };

  btn.addEventListener('click', handleClick);
  [emailInput, passwordInput].forEach(input => {
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') void handleClick();
    });
  });

  const linksDiv = document.createElement('div');
  linksDiv.className = 'atenna-modal__login-links';

  const signupLink = document.createElement('button');
  signupLink.className = 'atenna-modal__login-link';
  signupLink.textContent = 'Criar conta';
  signupLink.addEventListener('click', () => switchView('signup'));

  const resetLink = document.createElement('button');
  resetLink.className = 'atenna-modal__login-link';
  resetLink.textContent = 'Esqueci minha senha';
  resetLink.addEventListener('click', () => switchView('reset'));

  linksDiv.appendChild(signupLink);
  linksDiv.appendChild(resetLink);

  inputGroup.appendChild(emailWrapper);
  inputGroup.appendChild(passwordWrapper);
  inputGroup.appendChild(btn);

  wrap.appendChild(title);
  wrap.appendChild(subtitle);
  wrap.appendChild(features);
  wrap.appendChild(inputGroup);
  wrap.appendChild(status);
  wrap.appendChild(linksDiv);
  container.appendChild(wrap);

  emailInput.focus();
}

function renderSignupView(container: HTMLElement, switchView: (view: string) => void): void {
  void trackEvent('signup_clicked');
  clearMsgInterval();
  container.innerHTML = '';

  const wrap = document.createElement('div');
  wrap.className = 'atenna-modal__login';

  const backBtn = document.createElement('button');
  backBtn.className = 'atenna-modal__login-back';
  backBtn.textContent = '← Voltar';
  backBtn.addEventListener('click', () => switchView('login'));

  const title = document.createElement('h2');
  title.className = 'atenna-modal__login-title';
  title.textContent = 'Criar conta';

  const inputGroup = document.createElement('div');
  inputGroup.className = 'atenna-modal__login-group';

  // Email com ícone
  const emailWrapper = document.createElement('div');
  emailWrapper.className = 'atenna-modal__input-wrapper';
  const emailInput = document.createElement('input');
  emailInput.type = 'email';
  emailInput.className = 'atenna-modal__login-input';
  emailInput.placeholder = 'seu@email.com';
  emailInput.autocomplete = 'email';
  const emailIcon = document.createElement('span');
  emailIcon.className = 'atenna-modal__input-icon-left';
  emailIcon.textContent = '✉';
  emailWrapper.appendChild(emailIcon);
  emailWrapper.appendChild(emailInput);

  // Senha com ícone + eye toggle
  const passwordWrapper = document.createElement('div');
  passwordWrapper.className = 'atenna-modal__input-wrapper';
  const passwordInput = document.createElement('input');
  passwordInput.type = 'password';
  passwordInput.className = 'atenna-modal__login-input';
  passwordInput.placeholder = 'Senha (mín. 6 caracteres)';
  passwordInput.autocomplete = 'new-password';
  const pwdIcon = document.createElement('span');
  pwdIcon.className = 'atenna-modal__input-icon-left';
  pwdIcon.textContent = '🔒'.replace('🔒', '⚿');
  const eyeToggle = document.createElement('button');
  eyeToggle.className = 'atenna-modal__input-icon-right';
  eyeToggle.type = 'button';
  eyeToggle.textContent = '◯';
  eyeToggle.title = 'Mostrar senha';
  eyeToggle.addEventListener('click', (e) => {
    e.preventDefault();
    const isPassword = passwordInput.type === 'password';
    passwordInput.type = isPassword ? 'text' : 'password';
    eyeToggle.title = isPassword ? 'Esconder senha' : 'Mostrar senha';
  });
  passwordWrapper.appendChild(pwdIcon);
  passwordWrapper.appendChild(passwordInput);
  passwordWrapper.appendChild(eyeToggle);

  // Confirmar senha com ícone + eye toggle
  const confirmWrapper = document.createElement('div');
  confirmWrapper.className = 'atenna-modal__input-wrapper';
  const confirmInput = document.createElement('input');
  confirmInput.type = 'password';
  confirmInput.className = 'atenna-modal__login-input';
  confirmInput.placeholder = 'Confirme a senha';
  confirmInput.autocomplete = 'new-password';
  const confirmIcon = document.createElement('span');
  confirmIcon.className = 'atenna-modal__input-icon-left';
  confirmIcon.textContent = '⚿';
  const eyeToggle2 = document.createElement('button');
  eyeToggle2.className = 'atenna-modal__input-icon-right';
  eyeToggle2.type = 'button';
  eyeToggle2.textContent = '◯';
  eyeToggle2.title = 'Mostrar senha';
  eyeToggle2.addEventListener('click', (e) => {
    e.preventDefault();
    const isPassword = confirmInput.type === 'password';
    confirmInput.type = isPassword ? 'text' : 'password';
    eyeToggle2.title = isPassword ? 'Esconder senha' : 'Mostrar senha';
  });
  confirmWrapper.appendChild(confirmIcon);
  confirmWrapper.appendChild(confirmInput);
  confirmWrapper.appendChild(eyeToggle2);

  const btn = document.createElement('button');
  btn.className = 'atenna-modal__login-btn';
  btn.textContent = 'Criar conta';

  const status = document.createElement('div');
  status.className = 'atenna-modal__login-status';

  const handleClick = async () => {
    const email = emailInput.value.trim();
    const pwd = passwordInput.value;
    const confirm = confirmInput.value;

    if (!email) {
      status.textContent = 'Informe seu email';
      status.classList.add('atenna-modal__login-status--warning');
      return;
    }
    if (pwd.length < 6) {
      status.textContent = 'Senha deve ter no mínimo 6 caracteres';
      status.classList.add('atenna-modal__login-status--warning');
      return;
    }
    if (pwd !== confirm) {
      status.textContent = 'As senhas não conferem';
      status.classList.add('atenna-modal__login-status--warning');
      return;
    }

    void trackEvent('signup_submitted', { input_length: email.length });

    btn.disabled = true;
    btn.textContent = 'Criando…';
    status.textContent = '';
    status.classList.remove('atenna-modal__login-status--error', 'atenna-modal__login-status--warning');

    const result = await signUpWithPassword(email, pwd);
    if (result.error) {
      void trackEvent('signup_error', { error: result.error });
      status.textContent = result.error;
      status.classList.add('atenna-modal__login-status--error');
      btn.disabled = false;
      btn.textContent = 'Criar conta';
    } else {
      void trackEvent('signup_success');
      status.innerHTML = '<strong>Conta criada!</strong><br>Verifique seu email e clique no link de confirmação.';
      status.classList.add('atenna-modal__login-status--success');
      emailInput.disabled = true;
      passwordInput.disabled = true;
      confirmInput.disabled = true;
      btn.style.display = 'none';
    }
  };

  btn.addEventListener('click', handleClick);
  [emailInput, passwordInput, confirmInput].forEach(input => {
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') void handleClick();
    });
  });

  inputGroup.appendChild(emailWrapper);
  inputGroup.appendChild(passwordWrapper);
  inputGroup.appendChild(confirmWrapper);
  inputGroup.appendChild(btn);
  wrap.appendChild(backBtn);
  wrap.appendChild(title);
  wrap.appendChild(inputGroup);
  wrap.appendChild(status);
  container.appendChild(wrap);

  emailInput.focus();
}

function renderResetView(container: HTMLElement, switchView: (view: string) => void): void {
  void trackEvent('reset_clicked');
  clearMsgInterval();
  container.innerHTML = '';

  const wrap = document.createElement('div');
  wrap.className = 'atenna-modal__login';

  const backBtn = document.createElement('button');
  backBtn.className = 'atenna-modal__login-back';
  backBtn.textContent = '← Voltar';
  backBtn.addEventListener('click', () => switchView('login'));

  const title = document.createElement('h2');
  title.className = 'atenna-modal__login-title';
  title.textContent = 'Recuperar senha';

  const subtitle = document.createElement('p');
  subtitle.className = 'atenna-modal__login-subtitle';
  subtitle.textContent = 'Enviaremos um link para redefinir sua senha';

  const inputGroup = document.createElement('div');
  inputGroup.className = 'atenna-modal__login-group';

  const input = document.createElement('input');
  input.type = 'email';
  input.className = 'atenna-modal__login-input';
  input.placeholder = 'seu@email.com';
  input.autocomplete = 'email';

  const btn = document.createElement('button');
  btn.className = 'atenna-modal__login-btn';
  btn.textContent = 'Enviar link';

  const status = document.createElement('div');
  status.className = 'atenna-modal__login-status';

  const handleClick = async () => {
    const email = input.value.trim();
    if (!email) {
      status.textContent = 'Informe seu email';
      status.classList.add('atenna-modal__login-status--warning');
      return;
    }

    void trackEvent('reset_submitted', { input_length: email.length });

    btn.disabled = true;
    btn.textContent = 'Enviando…';
    status.textContent = '';
    status.classList.remove('atenna-modal__login-status--error', 'atenna-modal__login-status--warning');

    const result = await resetPassword(email);
    if (result.error) {
      void trackEvent('reset_error', { error: result.error });
      status.textContent = result.error;
      status.classList.add('atenna-modal__login-status--error');
      btn.disabled = false;
      btn.textContent = 'Enviar link';
    } else {
      void trackEvent('reset_success');
      status.innerHTML = '<strong>Link enviado!</strong><br>Verifique seu email para redefinir a senha.';
      status.classList.add('atenna-modal__login-status--success');
      input.disabled = true;
      btn.style.display = 'none';
    }
  };

  btn.addEventListener('click', handleClick);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') void handleClick();
  });

  inputGroup.appendChild(input);
  inputGroup.appendChild(btn);
  wrap.appendChild(backBtn);
  wrap.appendChild(title);
  wrap.appendChild(subtitle);
  wrap.appendChild(inputGroup);
  wrap.appendChild(status);
  container.appendChild(wrap);

  input.focus();
}

// ─── Render: upgrade trigger ──────────────────────────────

function renderUpgradeTrigger(): HTMLElement {
  const card = document.createElement('div');
  card.className = 'atenna-modal__upgrade';

  const icon = document.createElement('span');
  icon.className   = 'atenna-modal__upgrade-icon';
  icon.textContent = '↑';

  const msg = document.createElement('p');
  msg.className   = 'atenna-modal__upgrade-msg';
  msg.textContent = 'Você está criando prompts melhores que 90% das pessoas. Quer desbloquear o modo completo?';

  const btn = document.createElement('button');
  btn.className   = 'atenna-modal__upgrade-btn';
  btn.textContent = 'Desbloquear Pro';
  btn.addEventListener('click', () => {
    void track('upgrade_clicked');
    showToast('Em breve! 🚀');
  });

  const dismiss = document.createElement('button');
  dismiss.className   = 'atenna-modal__upgrade-dismiss';
  dismiss.textContent = 'Agora não';
  dismiss.addEventListener('click', () => card.remove());

  card.appendChild(icon);
  card.appendChild(msg);
  card.appendChild(btn);
  card.appendChild(dismiss);
  return card;
}

// ─── Render: prompt cards ──────────────────────────────────

function renderPrompts(
  container:     HTMLElement,
  data:          PromptData,
  platformInput: HTMLElement | null,
  overlay:       HTMLElement,
  origin:        PromptOrigin = 'manual',
  totalCount:    number = 0,
): void {
  clearMsgInterval();
  container.innerHTML = '';

  const entries: Array<{ emoji: string; label: string; speed: string; description: string; text: string; preview?: string; prompt_type: PromptType }> = [
    { emoji: '●', label: 'Direto',      speed: 'Rápido',      description: 'Claro e objetivo',      text: data.direct,     preview: data.direct_preview,     prompt_type: 'direct' },
    { emoji: '●', label: 'Estruturado', speed: 'Equilibrado',  description: 'Organizado em seções',  text: data.structured, preview: data.structured_preview, prompt_type: 'structured' },
    { emoji: '●', label: 'Técnico',     speed: 'Profundo',     description: 'Aprofundado e preciso', text: data.technical,  preview: data.technical_preview,  prompt_type: 'technical' },
  ];

  const cards = document.createElement('div');
  cards.className = 'atenna-modal__cards';
  entries.forEach((v, i) => cards.appendChild(buildCard(v, i, platformInput, overlay, origin)));

  if (!upgradeShown && totalCount >= UPGRADE_TRIGGER) {
    upgradeShown = true;
    cards.appendChild(renderUpgradeTrigger());
  }

  container.appendChild(cards);
}

function buildCard(
  v:             { emoji: string; label: string; speed: string; description: string; text: string; preview?: string; prompt_type: PromptType },
  index:         number,
  platformInput: HTMLElement | null,
  overlay:       HTMLElement,
  origin:        PromptOrigin,
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
  badge.textContent = `${v.emoji} ${v.label}`;  // textContent — safe

  const speed = document.createElement('span');
  speed.className = 'atenna-modal__card-speed';
  speed.textContent = v.speed;           // textContent — safe

  const desc = document.createElement('span');
  desc.className = 'atenna-modal__card-desc';
  desc.textContent = v.description;      // textContent — safe

  meta.appendChild(badge);
  meta.appendChild(speed);
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

  if (v.preview) {
    const previewEl = document.createElement('p');
    previewEl.className = 'atenna-modal__card-preview';
    previewEl.textContent = v.preview;   // textContent — safe
    card.appendChild(header);
    card.appendChild(previewEl);
  } else {
    card.appendChild(header);
  }

  const ta = document.createElement('textarea');
  ta.className = 'atenna-modal__card-textarea';
  ta.readOnly = true;
  ta.value = v.text;                     // .value — safe
  ta.rows = 4;
  ta.setAttribute('aria-label', `Prompt ${v.label}`);

  card.appendChild(ta);

  copyBtn.addEventListener('click', () => {
    const text = ta.value;
    void trackEvent('prompt_copied', { prompt_type: v.prompt_type, origin, output_length: text.length });
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
    void track('prompt_used', { prompt_type: v.prompt_type, origin });
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

async function updateUsageBadge(badge: HTMLElement, dailyCount: number, pro = false): Promise<void> {
  if (pro) {
    badge.textContent = 'Pro ✓';
    badge.className   = 'atenna-modal__usage atenna-modal__usage--pro';
    return;
  }
  const monthlyCount = await getMonthlyUsage();
  badge.textContent = `${dailyCount}/${DAILY_LIMIT} | ${monthlyCount}/${MONTHLY_LIMIT}`;
  badge.className   = 'atenna-modal__usage';
  if (dailyCount >= DAILY_LIMIT)           badge.classList.add('atenna-modal__usage--danger');
  else if (dailyCount >= DAILY_LIMIT - 3)  badge.classList.add('atenna-modal__usage--warning');
}

// ─── Backend fetch (via background worker to bypass CORS) ──

// ─── Builder: structured input assembler ──────────────────

function buildStructuredInput(objetivo: string, contexto: string, formato: string, baseText: string): string {
  const lines: string[] = [];
  if (objetivo) lines.push(`Objetivo: ${objetivo}`);
  if (contexto) lines.push(`Contexto: ${contexto}`);
  if (formato)  lines.push(`Formato preferido: ${formato}`);
  if (baseText) lines.push(`\nTexto base:\n${baseText}`);
  return lines.join('\n');
}

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
    console.warn('[Atenna] erro backend:', err);
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
