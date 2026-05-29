// src/ui/modal/core.ts
// Core orchestrator: openModal lifecycle, runFlow, and public entry points.

// State and utils
import {
  OVERLAY_ID, trapFocus, clearMsgInterval, getLogoUrl, isDark,
  isVagueInput, shouldSuggestBuilder, showToast,
} from './utils';
import { modalState, clearPromptCache, UPGRADE_TRIGGER } from './state';

// Network
import { syncPlanFromBff, fetchPrompts, openCheckout, QuotaExceededError } from './network';
import type { PromptResponse } from './network';

// Sub-views
import { renderPlansModal, renderUpgradeModal } from './plans-modal';
import { renderSettingsPage, updateUsageBadge } from './settings';
import { renderLoginView, renderSignupView, renderResetView } from './auth-views';
import {
  showDlpAdvisory, renderPostLoginOnboarding, renderPreLoginOnboarding, showProWelcomeOverlay,
} from './onboarding-views';
import {
  makeVariantRow, renderMeusPrompts, renderSuggestion, getBuilderVal,
  buildStructuredInput, renderPrompts, buildCard, renderDocumentActionBar,
} from './prompt-cards';
import {
  renderOnboarding, renderEmptyState, renderLoading, renderSuccess, renderLimitReached,
} from './prompt-states';

// External
import { getCurrentInput, getInputText, setInputText } from '../../core/inputHandler';
import {
  getUsage, incrementUsage, isAtLimit, isAtAnyLimit, DAILY_LIMIT, getTotalCount,
  incrementTotalCount, getMonthlyUsage, MONTHLY_LIMIT, incrementMonthlyUsage, syncUsageFromServer,
} from '../../core/usageCounter';
import { isPro, consumeProWelcome, getPlan, setPlan } from '../../core/planManager';
import {
  consumeProWelcome as _consumeProWelcomeOnboarding,
  resolveWelcomeState,
  setProWelcomeFlag,
} from './onboarding';
import { bffMe } from '../../auth/bffClient';
import { track, trackEvent } from '../../core/analytics';
import type { PromptOrigin } from '../../core/analytics';
import { getHistory, addToHistory, addGroupToHistory } from '../../core/history';
import type { HistoryGroup } from '../../core/history';
import { scan } from '../../dlp/detector';
import { buildAdvisory } from '../../dlp/advisory';
import { updateBadgeDotRisk, setAutoBanner, getDlpMetadata } from '../../content/injectButton';
import { getFlag } from '../../core/featureFlags';
import { sk } from '../../core/scopedStorage';

export { clearPromptCache };

// ─── Public ───────────────────────────────────────────────

export function toggleModal(): Promise<void> | void {
  const existing = document.getElementById(OVERLAY_ID);
  if (existing) { clearMsgInterval(); existing.remove(); return; }
  return openModal();
}

// Called by the magic wand badge action — opens modal and auto-generates.
// Only called when the platform input already has content (checked by injectButton).
export function generateFromBadge(): Promise<void> | void {
  const existing = document.getElementById(OVERLAY_ID);
  if (existing) { clearMsgInterval(); existing.remove(); return; }
  return openModal(true);
}

export async function openSettingsOverlay(): Promise<void> {
  const existing = document.getElementById('atenna-settings-overlay');
  if (existing) { existing.remove(); return; }

  const me = await bffMe();
  if (!me) return;

  // Always sync plan from BFF before rendering — ensures pro users see correct badge
  await syncPlanFromBff(me);
  const pro = await isPro();
  const settingsPage = renderSettingsPage(
    me,
    pro,
    () => document.getElementById('atenna-settings-overlay')?.remove(),
    renderDocumentActionBar,
  );
  document.body.appendChild(settingsPage);
}

// ─── Build modal skeleton ──────────────────────────────────

async function openModal(autoGenerate = false): Promise<void> {
  void trackEvent('modal_opened');
  const _modalOpenTime = Date.now();

  // Create and mount overlay synchronously — tests and UX see it immediately.
  const overlay = document.createElement('div');
  overlay.id = OVERLAY_ID;
  overlay.className = 'atenna-modal-overlay';

  const modal = document.createElement('div');
  modal.className = isDark() ? 'atenna-modal atenna-modal--dark' : 'atenna-modal';
  modal.setAttribute('role', 'dialog');
  modal.setAttribute('aria-modal', 'true');
  modal.setAttribute('aria-label', 'Atenna');

  overlay.appendChild(modal);

  // Mount to #atenna-popup (popup context) if it exists, otherwise to body (content script)
  const popupContainer = document.getElementById('atenna-popup');
  if (popupContainer) {
    popupContainer.appendChild(overlay);
  } else {
    document.body.appendChild(overlay);
  }

  // ── Close handler ────────────────────────────────────
  const close = () => { cleanupFocusTrap(); clearMsgInterval(); overlay.remove(); };
  overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
  const cleanupFocusTrap = trapFocus(overlay, close);

  // Track daily return (async — non-blocking)
  const today = new Date().toISOString().split('T')[0];
  const lastOpenKey = sk('atenna_last_open_date');
  const lastOpen = await new Promise<string | null>(resolve => {
    try { chrome.storage.local.get(lastOpenKey, r => resolve(r[lastOpenKey] as string | null)); }
    catch { resolve(null); }
  });
  if (lastOpen) {
    void trackEvent('returning_user_detected');
    if (lastOpen !== today) void trackEvent('daily_return');
  }
  await new Promise(resolve => {
    try { chrome.storage.local.set({ [lastOpenKey]: today }, resolve); }
    catch { resolve(undefined); }
  });

  // ── Auth Gate: Check session FIRST ───────────────────
  const me = await bffMe();

  if (!me) {
    const logoUrl = getLogoUrl();
    const logoImg = logoUrl
      ? `<img src="${logoUrl}" width="28" height="28" alt="" aria-hidden="true"/>`
      : '';

    modal.innerHTML = `
      <div class="atenna-modal__header">
        <span class="atenna-modal__title">${logoImg}Atenna</span>
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
      else if (view === 'onboarding') renderPreLoginOnboarding(loginView, switchAuthView);
    };

    // First-ever click → show onboarding. Subsequent → go straight to login.
    const seen = await new Promise<boolean>(resolve => {
      try { chrome.storage.local.get('atenna_onboarding_seen', r => resolve(!!r['atenna_onboarding_seen'])); }
      catch { resolve(true); }
    });
    switchAuthView(seen ? 'login' : 'onboarding');

    modal.querySelector('.atenna-modal__close')!.addEventListener('click', close);
    return;
  }

  // ── Session exists: sync plan + check welcome ──────────
  const { upgradedToPro } = await syncPlanFromBff(me);
  const showWelcome = upgradedToPro || await consumeProWelcome();
  if (upgradedToPro) await consumeProWelcome(); // always clear flag, even when upgradedToPro triggered first
  if (showWelcome) {
    close(); // remove empty modal overlay before showing welcome
    showProWelcomeOverlay(me, () => openModal(autoGenerate));
    return;
  }

  const appOnbKey = sk('atenna_app_onboarding_seen');
  const appOnboardingSeen = await new Promise<boolean>(resolve => {
    try { chrome.storage.local.get(appOnbKey, r => resolve(!!r[appOnbKey])); }
    catch { resolve(true); }
  });

  if (!appOnboardingSeen) {
    chrome.storage.local.set({ [appOnbKey]: true });
    renderPostLoginOnboarding(modal, close);
    modal.querySelector('.atenna-modal__close')?.addEventListener('click', close);
    return;
  }

  const platformInput = getCurrentInput();
  const userText      = platformInput ? getInputText(platformInput).trim() : '';

  const logoUrl = getLogoUrl();
  const logoImg = logoUrl
    ? `<img src="${logoUrl}" width="28" height="28" alt="" aria-hidden="true"/>`
    : '';

  const editActive    = ' atenna-modal__tab--active';
  const promptsActive = '';
  const editSelected    = 'true';
  const promptsSelected = 'false';

  const builderLogoImg = logoUrl ? `<img src="${logoUrl}" width="14" height="14" alt="" aria-hidden="true" style="border-radius:50%;vertical-align:middle;filter:none;opacity:0.9;"/>` : '✦';

  modal.innerHTML = `
    <div class="atenna-modal__header">
      <span class="atenna-modal__title">${logoImg}Atenna</span>
      <div class="atenna-modal__toggle" role="tablist">
        <button class="atenna-modal__tab atenna-modal__tab--active" data-tab="edit"    role="tab" aria-selected="true">Refinar</button>
        <button class="atenna-modal__tab"                           data-tab="history" role="tab" aria-selected="false">Histórico</button>
      </div>
      <div class="atenna-modal__header-right">
        <span class="atenna-modal__usage" aria-label="Uso diário">…</span>
        <div class="atenna-modal__account">
          <button class="atenna-modal__gear-btn" aria-label="Conta" data-gear><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg></button>
        </div>
        <button class="atenna-modal__close" aria-label="Fechar">×</button>
      </div>
    </div>
    <div class="atenna-modal__body">
      <div class="atenna-modal__view" data-view="edit">
        <div class="atenna-modal__edit-label">Seu texto</div>
        <textarea class="atenna-modal__editor" placeholder="Digite ou edite seu texto aqui..."></textarea>
        <button class="atenna-modal__builder-toggle" type="button">
          <span class="atenna-modal__builder-toggle-icon">${builderLogoImg}</span>
          Builder Inteligente
          <span class="atenna-modal__builder-toggle-arrow">›</span>
        </button>
        <div class="atenna-modal__builder">
          <p class="atenna-modal__builder-hint">Descreva sua intenção — combinamos para estruturar com clareza</p>
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
        <button class="atenna-modal__regen atenna-modal__regen--compact">Refinar</button>
        <div class="atenna-modal__results" data-results></div>
      </div>
      <div class="atenna-modal__view atenna-modal__view--hidden" data-view="history"></div>
    </div>
  `;

  const editorEl    = modal.querySelector<HTMLTextAreaElement>('.atenna-modal__editor')!;
  editorEl.value    = platformInput ? getInputText(platformInput) : '';

  const resultsView = modal.querySelector<HTMLElement>('[data-results]')!;
  const historyView = modal.querySelector<HTMLElement>('[data-view="history"]')!;
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
    views.forEach(v => {
      const hidden = v.dataset.view !== target;
      v.classList.toggle('atenna-modal__view--hidden', hidden);
      v.style.display = hidden ? 'none' : '';
    });
  };

  tabs.forEach(tab => {
    tab.addEventListener('click', () => {
      switchTab(tab.dataset.tab!);
      if (tab.dataset.tab === 'history') {
        void renderMeusPrompts(historyView, platformInput, overlay);
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
    // results stay in edit tab;

    // Layer 1 — local DLP scan (<50ms, non-blocking)
    const scanResult = scan(text);
    const advisory   = buildAdvisory(scanResult);
    updateBadgeDotRisk(scanResult.riskLevel);

    if (advisory.riskLevel !== 'NONE') {
      void trackEvent('dlp_warning_shown', { risk_level: advisory.riskLevel } as Parameters<typeof trackEvent>[1]);
    }

    // Layer 3 — UX decision: show advisory if needed, then proceed
    void showDlpAdvisory(advisory, resultsView).then(proceed => {
      if (!proceed) return;
      void isPro().then(pro => runFlow(resultsView, usageBadge, text, platformInput, overlay, origin, pro, _modalOpenTime));
    });
  });

  // ── Auto-generate / show cache / idle ─────────────────
  const [usage, pro, totalCount] = await Promise.all([getUsage(), isPro(), getTotalCount()]);
  await updateUsageBadge(usageBadge, usage.count, pro);

  // Pro badge no título do navbar
  if (pro) {
    const titleEl = modal.querySelector<HTMLElement>('.atenna-modal__title');
    if (titleEl && !titleEl.querySelector('.atenna-modal__pro-badge')) {
      const proBadge = document.createElement('span');
      proBadge.className = 'atenna-modal__pro-badge';
      proBadge.textContent = 'Pro';
      titleEl.appendChild(proBadge);
    }
  }

  // Gear button → opens full Settings Dashboard page
  const gearBtn = modal.querySelector<HTMLButtonElement>('[data-gear]');
  if (gearBtn) {
    gearBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      const existing = document.getElementById('atenna-settings-overlay');
      if (existing) { existing.remove(); return; }
      const settingsPage = renderSettingsPage(
        me,
        pro,
        () => { document.getElementById('atenna-settings-overlay')?.remove(); },
        renderDocumentActionBar,
      );
      document.body.appendChild(settingsPage);
    });
  }

  if (autoGenerate && userText !== '') {
    // Magic wand path: run generation directly in the edit tab (results appear there)
    switchTab('edit');

    // Cache hit: same text was generated before — render instantly, skip backend
    if (modalState.promptCache && modalState.promptCache.forText === userText) {
      void renderSuccess(resultsView).then(() =>
        renderPrompts(resultsView, modalState.promptCache!.data, platformInput, overlay, 'manual', 0)
      );
    } else {
      renderLoading(resultsView);
      const shouldShowSuggestion = pro && (isVagueInput(userText) || shouldSuggestBuilder(userText));
      if (shouldShowSuggestion) {
        void trackEvent('auto_suggestion_shown');
        renderSuggestion(
          resultsView,
          () => {
            void trackEvent('auto_suggestion_accepted');
            switchTab('edit');
            builderEl.classList.add('atenna-modal__builder--open');
            builderToggleEl.classList.add('atenna-modal__builder-toggle--open');
          },
          () => runFlow(resultsView, usageBadge, userText, platformInput, overlay, 'manual', pro, _modalOpenTime),
        );
      } else {
        void runFlow(resultsView, usageBadge, userText, platformInput, overlay, 'manual', pro, _modalOpenTime);
      }
    }
  } else {
    // Normal badge click: always open in edit tab
    switchTab('edit');
    if (userText !== '') editorEl.value = userText;
    renderOnboarding(resultsView, (example: string) => {
      editorEl.value = example;
      editorEl.focus();
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
  openTime:      number = Date.now(),
): Promise<void> {
  renderLoading(container);

  const usage = await getUsage();
  await updateUsageBadge(usageBadge, usage.count, pro);

  if (!pro && await isAtAnyLimit(usage)) {
    void trackEvent('quota_limit_reached', { origin });
    renderLimitReached(container);
    return;
  }

  try {
    const data = await fetchPrompts(userText);

    if (!document.getElementById(OVERLAY_ID)) return;

    if (!data._fromApi || data._is_fallback) {
      // API unavailable — render template prompts without decrementing usage
      console.warn('[Atenna] API unavailable, showing template prompts (usage not deducted)');
      void trackEvent('prompt_generate_api_failed', { origin, input_length: userText.length });
      await renderSuccess(container);
      if (!document.getElementById(OVERLAY_ID)) return;
      renderPrompts(container, data, platformInput, overlay, origin, 0);
      return;
    }

    // Only decrement usage if API actually succeeded
    const [newUsage, newTotalCount] = await Promise.all([incrementUsage(), incrementTotalCount(), incrementMonthlyUsage()]) as [Awaited<ReturnType<typeof incrementUsage>>, number, number];
    await updateUsageBadge(usageBadge, newUsage.count, pro);
    void syncUsageFromServer().then(synced => {
      if (synced && synced.todayCount !== newUsage.count) {
        void updateUsageBadge(usageBadge, synced.todayCount, pro);
      }
    });

    await renderSuccess(container);

    if (!document.getElementById(OVERLAY_ID)) return;

    void trackEvent('prompt_generate_success', { input_length: userText.length, output_length: JSON.stringify(data).length, origin });
    void trackEvent('modal_time_to_first_generate', { latency_ms: Date.now() - openTime, origin });

    // Save all 3 variants grouped under the user's original question
    void addGroupToHistory(userText, { direct: data.direct, structured: data.structured, technical: data.technical }, origin);

    // Milestone tracking
    if (newTotalCount === 1) {
      void trackEvent('first_prompt_generated');
      showToast('🎉 Primeiro prompt criado!', 'success');
    } else if (newTotalCount === 3) {
      void trackEvent('third_prompt_generated');
    } else if (newTotalCount === 5) {
      void trackEvent('fifth_prompt_generated');
    }

    modalState.promptCache = { forText: userText, data };

    renderPrompts(container, data, platformInput, overlay, origin, newTotalCount);
  } catch (error) {
    if (error instanceof QuotaExceededError) {
      // Server-side quota exceeded — user bypassed client-side limit
      void trackEvent('quota_limit_reached_server', { origin, count: error.count, limit: error.limit });
      renderLimitReached(container);
      return;
    }
    void trackEvent('prompt_generate_error', { origin, error: String(error) });
    if (document.getElementById(OVERLAY_ID)) {
      container.innerHTML = '<div style="padding: 20px; text-align: center;">Erro ao gerar prompts. Tente novamente.</div>';
    }
  }
}
