import { getCurrentInput, getInputText, setInputText } from '../core/inputHandler';
import { getUsage, incrementUsage, isAtLimit, isAtAnyLimit, DAILY_LIMIT, getTotalCount, incrementTotalCount, getMonthlyUsage, MONTHLY_LIMIT, incrementMonthlyUsage, syncUsageFromServer } from '../core/usageCounter';
import { isPro, consumeProWelcome } from '../core/planManager';
import { consumeProWelcome as _consumeProWelcomeOnboarding, resolveWelcomeState, setProWelcomeFlag } from './modal/onboarding';
import { bffMe } from '../auth/bffClient';
import { track, trackEvent } from '../core/analytics';
import { getHistory, addToHistory, addGroupToHistory, toggleFavorite, isGroup } from '../core/history';
import type { HistoryGroup, PromptEntry } from '../core/history';
import type { PromptOrigin, PromptType } from '../core/analytics';
import { scan } from '../dlp/detector';
import { buildAdvisory } from '../dlp/advisory';
import type { Advisory } from '../dlp/types';
import { updateBadgeDotRisk, setAutoBanner } from '../content/injectButton';
import { getDlpStats } from '../core/dlpStats';
import { renderPrivacyDataSection } from './privacy-data';
import { UploadWidget } from './upload-widget';
import { getFlag } from '../core/featureFlags';
import { getBadgeColor, saveBadgeColor, applyBadgeColorToDom } from '../core/userSettings';
import type { BadgeColor } from '../core/userSettings';
import { sk } from '../core/scopedStorage';

import {
  OVERLAY_ID, SUCCESS_MS, LOADING_MESSAGES, CHECK_SVG, COPY_SVG,
  isVagueInput, shouldSuggestBuilder, trapFocus,
  makeProgressBar, makeStatRow, makeSectionTitle,
  clearMsgInterval, getLogoUrl, isDark, fallbackCopy, showToast,
} from './modal/utils';

// ─── Network / fetch layer ────────────────────────────────
import {
  syncPlanFromBff,
  fetchPrompts, sendToBackground, openCheckout,
} from './modal/network';
import type { PromptResponse } from './modal/network';
export { QuotaExceededError, fetchPrompts } from './modal/network';
export type { PromptResponse } from './modal/network';

// ─── Module-level state ────────────────────────────────────

import { modalState, clearPromptCache, UPGRADE_TRIGGER } from './modal/state';
import type { PromptData } from './modal/state';
export type { PromptData };
export { clearPromptCache };

import {
  MONTHLY_PRICE, YEARLY_PRICE, YEARLY_MONTHLY_EQUIV, YEARLY_SAVINGS, YEARLY_SAVINGS_PCT,
  renderPlansModal, renderUpgradeModal, renderPricingCards, renderUpgradeTrigger,
} from './modal/plans-modal';

import { renderSettingsPage, updateUsageBadge } from './modal/settings';
export { updateUsageBadge } from './modal/settings';

import { renderLoginView, renderSignupView, renderResetView } from './modal/auth-views';
export { renderSignupView } from './modal/auth-views';

import { showDlpAdvisory, renderPostLoginOnboarding, renderPreLoginOnboarding, showProWelcomeOverlay } from './modal/onboarding-views';

function renderOnboarding(
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

function renderEmptyState(
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

function makeVariantRow(
  label: string,
  text: string,
  platformInput: HTMLElement | null,
  overlay: HTMLElement,
): HTMLElement {
  const row = document.createElement('div');
  row.className = 'atenna-modal__variant-row';

  const lbl = document.createElement('span');
  lbl.className = 'atenna-modal__variant-label';
  lbl.textContent = label;

  const txt = document.createElement('p');
  txt.className = 'atenna-modal__variant-text';
  txt.textContent = text;

  const acts = document.createElement('div');
  acts.className = 'atenna-modal__variant-actions';

  const copyBtn = document.createElement('button');
  copyBtn.className = 'atenna-modal__history-copy';
  copyBtn.textContent = 'Copiar';
  copyBtn.addEventListener('click', () => {
    navigator.clipboard?.writeText(text).then(() => showToast('Copiado!', 'success'));
  });

  const useBtn = document.createElement('button');
  useBtn.className = 'atenna-modal__history-use';
  useBtn.textContent = 'Aplicar';
  useBtn.addEventListener('click', () => {
    if (platformInput) {
      setInputText(platformInput, text);
      overlay.remove();
      showToast('Prompt aplicado com sucesso!', 'success');
    } else {
      showToast('Abra o ChatGPT, Claude ou Gemini para aplicar o prompt.', 'warning');
    }
  });

  acts.appendChild(copyBtn);
  acts.appendChild(useBtn);
  row.appendChild(lbl);
  row.appendChild(txt);
  row.appendChild(acts);
  return row;
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
      <p class="atenna-modal__empty-subtitle">Suas solicitações salvas aparecerão aqui.</p>
    `;
    container.appendChild(empty);
    return;
  }

  const wrap = document.createElement('div');
  wrap.className = 'atenna-modal__history';

  entries.forEach(entry => {
    const card = document.createElement('div');
    card.className = 'atenna-modal__history-card';

    if (isGroup(entry)) {
      // HistoryGroup: show question, expand on click to reveal variants
      const g = entry as HistoryGroup;
      const header = document.createElement('div');
      header.className = 'atenna-modal__history-header';

      const questionText = document.createElement('span');
      questionText.className = 'atenna-modal__history-question';
      questionText.textContent = g.question;

      const metaRow = document.createElement('div');
      metaRow.className = 'atenna-modal__history-meta';

      const date = document.createElement('span');
      date.className = 'atenna-modal__history-date';
      date.textContent = new Date(g.date).toLocaleDateString('pt-BR');

      const arrow = document.createElement('span');
      arrow.className = 'atenna-modal__history-arrow';
      arrow.innerHTML = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>`;

      const starBtn = document.createElement('button');
      starBtn.className = g.favorited ? 'atenna-modal__history-star atenna-modal__history-star--active' : 'atenna-modal__history-star';
      starBtn.textContent = g.favorited ? '★' : '☆';
      starBtn.addEventListener('click', async (e) => {
        e.stopPropagation();
        await toggleFavorite(g.id);
        await renderMeusPrompts(container, platformInput, overlay);
      });

      metaRow.appendChild(date);
      metaRow.appendChild(starBtn);
      metaRow.appendChild(arrow);
      header.appendChild(questionText);
      header.appendChild(metaRow);

      const variantsDiv = document.createElement('div');
      variantsDiv.className = 'atenna-modal__variants';

      const VARIANT_LABELS: Record<string, string> = {
        direct: 'Direto',
        structured: 'Estruturado',
        technical: 'Técnico',
      };
      for (const [key, label] of Object.entries(VARIANT_LABELS)) {
        const text = g.variants[key as keyof typeof g.variants];
        if (text) {
          variantsDiv.appendChild(makeVariantRow(label, text, platformInput, overlay));
        }
      }

      let expanded = false;
      header.addEventListener('click', () => {
        expanded = !expanded;
        card.classList.toggle('atenna-modal__history-card--expanded', expanded);
        variantsDiv.classList.toggle('atenna-modal__variants--open', expanded);
      });

      card.appendChild(header);
      card.appendChild(variantsDiv);
    } else {
      // Legacy PromptEntry
      const e = entry as PromptEntry;
      const header = document.createElement('div');
      header.className = 'atenna-modal__history-header';

      const badge = document.createElement('span');
      badge.className = 'atenna-modal__history-badge';
      badge.textContent = e.type === 'direct' ? 'Direto' : e.type === 'structured' ? 'Estruturado' : 'Técnico';

      const date = document.createElement('span');
      date.className = 'atenna-modal__history-date';
      date.textContent = new Date(e.date).toLocaleDateString('pt-BR');

      const actions = document.createElement('div');
      actions.className = 'atenna-modal__history-actions';

      const starBtn = document.createElement('button');
      starBtn.className = e.favorited ? 'atenna-modal__history-star atenna-modal__history-star--active' : 'atenna-modal__history-star';
      starBtn.textContent = e.favorited ? '★' : '☆';
      starBtn.addEventListener('click', async () => {
        await toggleFavorite(e.id);
        await renderMeusPrompts(container, platformInput, overlay);
      });

      const useBtn = document.createElement('button');
      useBtn.className = 'atenna-modal__history-use';
      useBtn.textContent = 'Usar';
      useBtn.addEventListener('click', () => {
        if (platformInput) { setInputText(platformInput, e.text); overlay.remove(); showToast('Prompt aplicado com sucesso!', 'success'); }
        else showToast('Abra o ChatGPT, Claude ou Gemini para aplicar o prompt.', 'warning');
      });

      const copyBtn = document.createElement('button');
      copyBtn.className = 'atenna-modal__history-copy';
      copyBtn.textContent = 'Copiar';
      copyBtn.addEventListener('click', () => { navigator.clipboard?.writeText(e.text).then(() => showToast('Copiado!', 'success')); });

      actions.appendChild(starBtn);
      actions.appendChild(useBtn);
      actions.appendChild(copyBtn);
      header.appendChild(badge);
      header.appendChild(date);
      header.appendChild(actions);

      const preview = document.createElement('p');
      preview.className = 'atenna-modal__history-preview';
      preview.textContent = e.text.substring(0, 100) + (e.text.length > 100 ? '…' : '');

      card.appendChild(header);
      card.appendChild(preview);
    }

    wrap.appendChild(card);
  });

  container.appendChild(wrap);
}


// ─── Settings Dashboard Page ──────────────────────────────────
// (renderSettingsPage moved to ./modal/settings.ts)

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

export function openUploadFromBadge(): void {
  // Capture active element before file picker steals focus (synchronous)
  const activeTarget = document.activeElement as HTMLTextAreaElement | HTMLElement | null;

  // Create and click file input immediately — MUST be synchronous to keep user activation context
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = '.txt,.md,.csv,.json,.pdf,.docx,.doc,.xlsx,.xls';
  input.style.display = 'none';
  document.body.appendChild(input);
  input.click(); // Must happen synchronously within user gesture

  input.addEventListener('change', async () => {
    const file = input.files?.[0];
    input.remove();
    if (!file) return;

    // Session/plan checks happen AFTER file is selected (async is fine here)
    const me = await bffMe();
    if (!me) return;

    const { upgradedToPro } = await syncPlanFromBff(me);
    if (upgradedToPro) {
      showProWelcomeOverlay(me);
      return;
    }

    // Show a minimal result overlay only after file is selected and processed
    const { UploadWidget } = await import('./upload-widget');

    const overlay = document.createElement('div');
    overlay.id = 'atenna-upload-overlay';
    overlay.style.cssText = [
      'position:fixed', 'inset:0', 'z-index:2147483646',
      'display:flex', 'align-items:center', 'justify-content:center',
      'background:rgba(0,0,0,0.45)', 'backdrop-filter:blur(2px)',
    ].join(';');

    const panel = document.createElement('div');
    panel.style.cssText = [
      'background:var(--at-card-bg,#1a1a2e)', 'border-radius:12px',
      'padding:20px', 'width:340px', 'max-width:90vw',
      'box-shadow:0 8px 32px rgba(0,0,0,0.5)',
      'border:1px solid var(--at-border,rgba(255,255,255,0.08))',
      'position:relative',
    ].join(';');

    const close = document.createElement('button');
    close.textContent = '×';
    close.style.cssText = 'position:absolute;top:10px;right:12px;background:none;border:none;color:var(--at-text-muted,#888);font-size:18px;cursor:pointer;line-height:1;';
    close.addEventListener('click', () => overlay.remove());

    const widgetContainer = document.createElement('div');
    widgetContainer.id = 'upload-widget-container';

    panel.appendChild(close);
    panel.appendChild(widgetContainer);
    overlay.appendChild(panel);
    overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });
    document.body.appendChild(overlay);

    const widget = new UploadWidget({
      targetElement: widgetContainer,
      maxSize: {
        txt: 1024 * 1024,
        md: 1024 * 1024,
        csv: 5 * 1024 * 1024,
        json: 1024 * 1024,
        pdf: 10 * 1024 * 1024,
        docx: 10 * 1024 * 1024,
        xlsx: 10 * 1024 * 1024,
      },
      onReady: (content: string, _preview: string, riskLevel: string, rewritten?: string, fileName?: string) => {
        void trackEvent('document_ready_to_send', { risk_level: riskLevel, was_rewritten: !!rewritten });

        // Try to inject text as a file attachment (shows as badge above input).
        // Always use .txt extension so platforms treat content as plain text, not binary Word doc.
        const applyAsFileAttachment = async (text: string, originalName: string): Promise<boolean> => {
          const baseName = originalName.replace(/\.[^.]+$/, '');
          // Timestamp + random suffix evita deduplicação do ChatGPT (mesmo nome = "já carregou este arquivo")
          const ts = Date.now();
          const rnd = Math.random().toString(36).slice(2, 6);
          const safeFileName = `${baseName}_${ts}_${rnd}.txt`;
          const file = new File([new TextEncoder().encode(text)], safeFileName, { type: 'text/plain;charset=utf-8' });
          const dt = new DataTransfer();
          dt.items.add(file);

          const dismissDragOverlay = () => {
            // Fire dragleave on document + body to dismiss any platform drop overlay
            try {
              document.dispatchEvent(new DragEvent('dragleave', { bubbles: false }));
              document.body.dispatchEvent(new DragEvent('dragleave', { bubbles: true }));
            } catch { /* ignore */ }
          };

          // Strategy 1: synthetic drop on the platform's known drop zone
          // Dispatch drop directly without dragenter/dragover to avoid triggering sticky drop overlays.
          const dropZoneSelectors = [
            '#prompt-textarea',                              // ChatGPT
            'div[contenteditable="true"][data-placeholder]',// Claude.ai
            '.ql-editor',                                   // Gemini
            'div[contenteditable="true"]',                  // generic
            'textarea',
          ];
          for (const sel of dropZoneSelectors) {
            const el = document.querySelector(sel);
            if (!el) continue;
            try {
              // dragover with preventDefault is required for drop to fire in some browsers
              const overEv = new DragEvent('dragover', { dataTransfer: dt, bubbles: true, cancelable: true });
              el.dispatchEvent(overEv);
              const dropEv = new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true });
              el.dispatchEvent(dropEv);
              // Always dismiss any drag overlay the platform might have shown
              dismissDragOverlay();
              await new Promise(r => setTimeout(r, 400));
              // Verify badge appeared by checking for file/attachment elements
              const attached = document.querySelector(
                '[data-testid*="file-upload"], [class*="file-chip"], [class*="attachment"]'
              );
              if (attached) return true;
            } catch { /* continue */ }
          }
          dismissDragOverlay();

          // Strategy 2: set files directly on the platform's file input
          const fileInputSelectors = [
            'input[type="file"][multiple]',   // ChatGPT
            'input[type="file"]',             // Claude, Gemini
            'input[accept]',                  // Gemini alternate
          ];
          for (const sel of fileInputSelectors) {
            const inp = document.querySelector(sel) as HTMLInputElement | null;
            if (!inp) continue;
            try {
              inp.files = dt.files;
              inp.dispatchEvent(new Event('change', { bubbles: true }));
              inp.dispatchEvent(new Event('input',  { bubbles: true }));
              await new Promise(r => setTimeout(r, 400));
              return true;
            } catch { /* continue */ }
          }

          return false;
        };

        const setTA = (ta: HTMLTextAreaElement, text: string): void => {
          const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value')?.set;
          if (setter) setter.call(ta, text); else ta.value = text;
          ['input', 'change', 'keyup'].forEach(t => ta.dispatchEvent(new Event(t, { bubbles: true })));
          ta.focus();
        };

        const setCE = (el: HTMLElement, text: string): void => {
          el.focus();
          const sel = window.getSelection();
          if (sel) {
            const range = document.createRange();
            range.selectNodeContents(el);
            sel.removeAllRanges();
            sel.addRange(range);
          }
          // execCommand works while user activation is alive (call before overlay.remove())
          const ok = document.execCommand('insertText', false, text);
          if (!ok) {
            // Fallback: beforeinput event (Lexical/ProseMirror respond to this)
            const dt = new DataTransfer();
            dt.setData('text/plain', text);
            el.dispatchEvent(new InputEvent('beforeinput', {
              bubbles: true, cancelable: true,
              inputType: 'insertFromPaste', dataTransfer: dt,
            }));
            el.textContent = text;
            el.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertReplacementText', data: text }));
          }
          el.dispatchEvent(new Event('change', { bubbles: true }));
        };

        // Find the most-likely visible chat input on the page
        const findChatInput = (): HTMLElement | null => {
          // Named inputs first (most reliable)
          const chatgpt = document.querySelector<HTMLElement>('#prompt-textarea');
          if (chatgpt) return chatgpt;
          // Visible textareas (Perplexity) — skip hidden/disabled ones
          const textareas = Array.from(document.querySelectorAll<HTMLTextAreaElement>('textarea'));
          const visibleTA = textareas.find(t => !t.disabled && !t.readOnly && t.offsetParent !== null && t.offsetWidth > 50);
          if (visibleTA) return visibleTA;
          // Contenteditable (Claude, Gemini)
          for (const sel of ['div[contenteditable="true"][data-placeholder]', '.ql-editor', 'div[contenteditable="true"]']) {
            const el = document.querySelector<HTMLElement>(sel);
            if (el && el.offsetParent !== null) return el;
          }
          return null;
        };

        const injectText = (text: string): boolean => {
          const el = findChatInput();
          if (!el) return false;
          if ((el as HTMLTextAreaElement).tagName === 'TEXTAREA') {
            setTA(el as HTMLTextAreaElement, text);
          } else {
            setCE(el, text);
          }
          return true;
        };

        const applyToTarget = (text: string, fileName?: string) => {
          const host = location.hostname;
          const isChatGPT = host.includes('chatgpt.com') || host.includes('chat.openai.com');

          if (isChatGPT) {
            // ChatGPT: file attachment first (shows badge above input), fallback to text
            overlay.remove();
            void applyAsFileAttachment(text, fileName ?? 'documento.txt').then(ok => {
              if (!ok) {
                if (!injectText(text)) showToast('Não foi possível aplicar o texto. Use o botão Copiar.', 'warning');
              }
            });
          } else {
            // All other platforms: inject text BEFORE removing overlay so user activation
            // is still valid for execCommand (Claude Lexical) and focus is predictable
            const ok = injectText(text);
            overlay.remove();
            if (!ok) showToast('Não foi possível aplicar o texto. Use o botão Copiar.', 'warning');
          }
        };

        // Document with PII: inject as file attachment; clean doc from widget: apply directly
        if (rewritten !== undefined || riskLevel === 'NONE') {
          applyToTarget(rewritten ?? content, fileName);
          return;
        }
        // Show Copiar/Aplicar bar for other flows
        const barContainer = document.createElement('div');
        panel.appendChild(barContainer);
        renderDocumentActionBar(barContainer, content);
        const applyBtn = barContainer.querySelector<HTMLButtonElement>('.atenna-doc-action-btn--primary');
        if (applyBtn) {
          applyBtn.addEventListener('click', () => applyToTarget(content, fileName));
        }
      },
      onError: (error: string) => {
        void trackEvent('document_upload_error', { error });
      },
      onCancel: () => {
        overlay.remove();
      },
      onUpgrade: (plan) => {
        overlay.remove();
        void openCheckout('upload_quota_gate', undefined, plan);
      },
    });

    // Trigger processing immediately with the selected file
    widget.handleFileSelect(file);
  });
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
  if (lastOpen && lastOpen !== today) {
    void trackEvent('daily_return');
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
      void isPro().then(pro => runFlow(resultsView, usageBadge, text, platformInput, overlay, origin, pro));
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
        session,
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
          () => runFlow(resultsView, usageBadge, userText, platformInput, overlay, 'manual', pro),
        );
      } else {
        void runFlow(resultsView, usageBadge, userText, platformInput, overlay, 'manual', pro);
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

// ─── Render: loading (premium skeleton, adaptive states) ─────

function renderLoading(container: HTMLElement): void {
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

function renderSuccess(container: HTMLElement): Promise<void> {
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

function renderLimitReached(container: HTMLElement): void {
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

  const entries: Array<{ emoji: string; label: string; speed: string; description: string; text: string; preview?: string; prompt_type: PromptType; variant: 'primary' | 'secondary' | 'tertiary' }> = [
    { emoji: '●', label: 'Direto',        speed: 'Rápido',        description: 'Claro e objetivo',      text: data.direct,     preview: data.direct_preview,     prompt_type: 'direct',     variant: 'primary' },
    { emoji: '●', label: 'Estruturado',  speed: 'Equilibrado',   description: 'Organizado em seções',  text: data.structured, preview: data.structured_preview, prompt_type: 'structured', variant: 'secondary' },
    { emoji: '●', label: 'Estratégico',  speed: 'Profundo',      description: 'Aprofundado e preciso', text: data.technical,  preview: data.technical_preview,  prompt_type: 'technical',  variant: 'tertiary' },
  ];

  const cards = document.createElement('div');
  cards.className = 'atenna-modal__cards';
  entries.forEach((v, i) => cards.appendChild(buildCard(v, i, platformInput, overlay, origin)));

  if (!modalState.upgradeShown && totalCount >= UPGRADE_TRIGGER) {
    modalState.upgradeShown = true;
    cards.appendChild(renderUpgradeTrigger());
  }

  container.appendChild(cards);

  // Scroll results into view after rendering
  requestAnimationFrame(() => {
    container.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  });
}

function buildCard(
  v:             { emoji: string; label: string; speed: string; description: string; text: string; preview?: string; prompt_type: PromptType; variant: 'primary' | 'secondary' | 'tertiary' },
  index:         number,
  platformInput: HTMLElement | null,
  overlay:       HTMLElement,
  origin:        PromptOrigin,
): HTMLElement {
  const card = document.createElement('div');
  card.className = `atenna-modal__card atenna-modal__card--${v.variant}`;
  card.dataset.card = String(index);
  card.style.animationDelay = `${index * 100}ms`;

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
    void trackEvent('prompt_copied', { prompt_type: v.prompt_type, card_variant: v.variant, origin, output_length: text.length });
    try {
      Promise.resolve(navigator.clipboard?.writeText(text))
        .then(() => showToast('Copiado!', 'success'))
        .catch(() => { fallbackCopy(text); showToast('Copiado!', 'success'); });
    } catch {
      fallbackCopy(text);
      showToast('Copiado!', 'success');
    }
  });

  useBtn.addEventListener('click', () => {
    void track('prompt_used', { prompt_type: v.prompt_type, card_variant: v.variant, origin });
    if (platformInput) {
      setInputText(platformInput, ta.value);
      clearMsgInterval();
      overlay.remove();
      showToast('Prompt aplicado com sucesso!', 'success');
    } else {
      showToast('Abra o ChatGPT, Claude ou Gemini para aplicar o prompt.', 'warning');
    }
  });

  return card;
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

function renderDocumentActionBar(container: HTMLElement, content: string): void {
  // Remove any previous action bar
  container.querySelector('.atenna-doc-action-bar')?.remove();

  const bar = document.createElement('div');
  bar.className = 'atenna-doc-action-bar';

  // ── Copiar ────────────────────────────────────────────
  const copyBtn = document.createElement('button');
  copyBtn.className = 'atenna-doc-action-btn';
  copyBtn.title = 'Copiar conteúdo sanitizado';
  copyBtn.innerHTML = `
    <svg class="atenna-doc-action-btn__icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8">
      <rect x="9" y="9" width="13" height="13" rx="2"/>
      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
    </svg>
    <span>Copiar</span>
  `;
  const copyTooltip = document.createElement('span');
  copyTooltip.className = 'atenna-doc-action-btn__tooltip';
  copyTooltip.textContent = 'Copiado!';
  copyBtn.appendChild(copyTooltip);

  copyBtn.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(content);
    } catch {
      fallbackCopy(content);
    }
    // Switch to checkmark
    copyBtn.innerHTML = `
      <svg class="atenna-doc-action-btn__icon atenna-doc-action-btn__icon--success" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2">
        <polyline points="20 6 9 17 4 12"/>
      </svg>
      <span>Copiar</span>
    `;
    copyBtn.appendChild(copyTooltip);
    copyTooltip.classList.add('atenna-doc-action-btn__tooltip--visible');
    copyBtn.classList.add('atenna-doc-action-btn--copied');
    setTimeout(() => {
      copyTooltip.classList.remove('atenna-doc-action-btn__tooltip--visible');
      copyBtn.classList.remove('atenna-doc-action-btn--copied');
      copyBtn.innerHTML = `
        <svg class="atenna-doc-action-btn__icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8">
          <rect x="9" y="9" width="13" height="13" rx="2"/>
          <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
        </svg>
        <span>Copiar</span>
      `;
      copyBtn.appendChild(copyTooltip);
    }, 2000);
    void trackEvent('document_copied_to_clipboard', { char_count: content.length });
  });

  // ── Aplicar ───────────────────────────────────────────
  const applyBtn = document.createElement('button');
  applyBtn.className = 'atenna-doc-action-btn atenna-doc-action-btn--primary';
  applyBtn.title = 'Inserir no chat ativo (ChatGPT, Claude, Gemini)';
  applyBtn.innerHTML = `
    <svg class="atenna-doc-action-btn__icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8">
      <line x1="22" y1="2" x2="11" y2="13"/>
      <polygon points="22 2 15 22 11 13 2 9 22 2"/>
    </svg>
    <span>Aplicar no chat</span>
  `;
  applyBtn.addEventListener('click', () => {
    try {
      chrome.tabs.query({ active: true, currentWindow: true }, tabs => {
        const tabId = tabs[0]?.id;
        if (!tabId) { showToast('Nenhuma aba ativa encontrada.', 'warning'); return; }
        chrome.tabs.sendMessage(tabId, { type: 'INJECT_CONTENT_TO_CHAT', content }, () => {
          if (chrome.runtime.lastError) {
            showToast('Abra o ChatGPT, Claude ou Gemini antes de aplicar.', 'warning');
            return;
          }
          applyBtn.innerHTML = `
            <svg class="atenna-doc-action-btn__icon atenna-doc-action-btn__icon--success" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2">
              <polyline points="20 6 9 17 4 12"/>
            </svg>
            <span>Aplicado!</span>
          `;
          applyBtn.disabled = true;
          setTimeout(() => {
            applyBtn.disabled = false;
            applyBtn.innerHTML = `
              <svg class="atenna-doc-action-btn__icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8">
                <line x1="22" y1="2" x2="11" y2="13"/>
                <polygon points="22 2 15 22 11 13 2 9 22 2"/>
              </svg>
              <span>Aplicar no chat</span>
            `;
          }, 2500);
        });
      });
    } catch { showToast('Não foi possível aplicar o conteúdo. Tente novamente.', 'error'); }
    void trackEvent('document_applied_to_chat', { char_count: content.length });
  });

  bar.appendChild(copyBtn);
  bar.appendChild(applyBtn);
  container.appendChild(bar);
}
