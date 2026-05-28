// ─── Modal Prompt Cards — card rendering extracted from modal.ts ──────────────

import { showToast, fallbackCopy, clearMsgInterval, COPY_SVG } from './utils';
import { modalState, UPGRADE_TRIGGER } from './state';
import type { PromptData } from './state';
import { renderUpgradeTrigger } from './plans-modal';
import { setInputText, getInputText } from '../../core/inputHandler';
import { toggleFavorite, isGroup, getHistory } from '../../core/history';
import type { HistoryGroup, PromptEntry } from '../../core/history';
import { track, trackEvent } from '../../core/analytics';
import type { PromptOrigin, PromptType } from '../../core/analytics';

export function makeVariantRow(
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

export async function renderMeusPrompts(
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

export function renderSuggestion(
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

export function getBuilderVal(fieldEl: HTMLElement): string {
  const chip  = fieldEl.querySelector<HTMLButtonElement>('.atenna-modal__chip--active');
  const ta    = fieldEl.querySelector<HTMLTextAreaElement>('.atenna-modal__builder-q');
  const chipV = chip?.dataset.value ?? '';
  const taV   = ta?.value.trim() ?? '';
  if (chipV && taV) return `${chipV}: ${taV}`;
  return chipV || taV;
}

export function buildStructuredInput(objetivo: string, contexto: string, formato: string, baseText: string): string {
  const lines: string[] = [];
  if (objetivo) lines.push(`Objetivo: ${objetivo}`);
  if (contexto) lines.push(`Contexto: ${contexto}`);
  if (formato)  lines.push(`Formato preferido: ${formato}`);
  if (baseText) lines.push(`\nTexto base:\n${baseText}`);
  return lines.join('\n');
}

export function renderPrompts(
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

export function buildCard(
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

export function renderDocumentActionBar(container: HTMLElement, content: string): void {
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
