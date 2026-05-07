import { getCurrentInput, getInputText, setInputText } from '../core/inputHandler';
import { getUsage, incrementUsage, isAtLimit, isAtAnyLimit, DAILY_LIMIT, getTotalCount, incrementTotalCount, getMonthlyUsage, MONTHLY_LIMIT, incrementMonthlyUsage } from '../core/usageCounter';
import { isPro, syncPlanFromSupabase } from '../core/planManager';
import { getActiveSession, signInWithPassword, signUpWithPassword, resetPassword } from '../core/auth';
import { track, trackEvent } from '../core/analytics';
import { getHistory, addToHistory, toggleFavorite } from '../core/history';
import type { PromptOrigin, PromptType } from '../core/analytics';
import { scan } from '../dlp/detector';
import { buildAdvisory } from '../dlp/advisory';
import type { Advisory } from '../dlp/types';
import { updateBadgeDotRisk, setAutoBanner } from '../content/injectButton';
import { getDlpStats, syncDlpStats } from '../core/dlpStats';

const OVERLAY_ID  = 'atenna-modal-overlay';
const SUCCESS_MS  = 500;

const LOADING_MESSAGES = [
  'Organizando intenção...',
  'Refinando contexto...',
  'Preparando versões...',
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
  subtitle.textContent = 'Melhores instruções geram melhores respostas.';

  const description = document.createElement('p');
  description.className = 'atenna-modal__onb-description';
  description.textContent = 'Organize solicitações para IA com mais clareza.';

  wrap.appendChild(title);
  wrap.appendChild(subtitle);
  wrap.appendChild(description);
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
        showToast('Aplicado');
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
  title.textContent = 'Utilize sem restrições';

  const subtitle = document.createElement('p');
  subtitle.className = 'atenna-upgrade-modal__subtitle';
  subtitle.textContent = 'Acesso contínuo sem limites diários e processamento prioritário.';

  hero.appendChild(heroClose);
  hero.appendChild(badge);
  hero.appendChild(title);
  hero.appendChild(subtitle);

  // Body
  const body = document.createElement('div');
  body.className = 'atenna-upgrade-modal__body';

  const features: Array<[string, string]> = [
    ['Utilizações ilimitadas por dia', 'Sem restrição diária ou mensal'],
    ['Processamento prioritário', 'Respostas mais rápidas'],
    ['Histórico completo', 'Acesse todas as solicitações anteriores'],
    ['Suporte dedicado', 'Atendimento prioritário'],
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

  const cta = document.createElement('button');
  cta.className = 'atenna-upgrade-modal__cta';
  cta.textContent = 'Quero o Atenna Pro →';
  cta.addEventListener('click', () => {
    void trackEvent('upgrade_interest_registered');
    showToast('Interesse registrado! Entraremos em contato.');
    onClose();
  });

  const dismiss = document.createElement('button');
  dismiss.className = 'atenna-upgrade-modal__dismiss';
  dismiss.textContent = 'Continuar no plano gratuito';
  dismiss.addEventListener('click', onClose);

  body.appendChild(ul);
  body.appendChild(hr);
  body.appendChild(cta);
  body.appendChild(dismiss);

  box.appendChild(hero);
  box.appendChild(body);
  overlay.appendChild(box);

  return overlay;
}

// ─── Settings Dashboard Page ──────────────────────────────────

function makeProgressBar(value: number, max: number, color = '#22c55e'): HTMLElement {
  const wrap = document.createElement('div');
  wrap.className = 'atenna-settings__bar-wrap';
  const fill = document.createElement('div');
  fill.className = 'atenna-settings__bar-fill';
  const pct = max > 0 ? Math.min(100, Math.round(value / max * 100)) : 0;
  fill.style.width = `${pct}%`;
  fill.style.background = color;
  wrap.appendChild(fill);
  return wrap;
}

function makeStatRow(label: string, value: string, sub?: string): HTMLElement {
  const row = document.createElement('div');
  row.className = 'atenna-settings__stat-row';
  const l = document.createElement('span');
  l.className = 'atenna-settings__stat-label';
  l.textContent = label;
  const v = document.createElement('span');
  v.className = 'atenna-settings__stat-value';
  v.textContent = value;
  row.appendChild(l);
  row.appendChild(v);
  if (sub) {
    const s = document.createElement('span');
    s.className = 'atenna-settings__stat-sub';
    s.textContent = sub;
    row.appendChild(s);
  }
  return row;
}

function makeSectionTitle(text: string): HTMLElement {
  const h = document.createElement('div');
  h.className = 'atenna-settings__section-title';
  h.textContent = text;
  return h;
}

function renderSettingsPage(
  session: { email: string; access_token: string },
  pro: boolean,
  onBack: () => void,
): HTMLElement {
  const dark = isDark();
  const overlay = document.createElement('div');
  overlay.id = 'atenna-settings-overlay';
  overlay.className = 'atenna-modal-overlay';

  const box = document.createElement('div');
  box.className = dark ? 'atenna-modal atenna-modal--dark atenna-settings' : 'atenna-modal atenna-settings';

  // ── Header ───────────────────────────────────────────────
  const header = document.createElement('div');
  header.className = 'atenna-settings__header';

  const backBtn = document.createElement('button');
  backBtn.className = 'atenna-settings__back';
  backBtn.innerHTML = '← Voltar';
  backBtn.addEventListener('click', onBack);

  const logoutBtn = document.createElement('button');
  logoutBtn.className = 'atenna-settings__logout';
  logoutBtn.innerHTML = '⎋&nbsp;Sair';
  logoutBtn.addEventListener('click', async () => {
    void trackEvent('logout_clicked');
    const { signOut } = await import('../core/auth');
    await signOut();
    onBack();
    window.location.reload();
  });

  header.appendChild(backBtn);
  header.appendChild(logoutBtn);

  // ── User card ────────────────────────────────────────────
  const userCard = document.createElement('div');
  userCard.className = 'atenna-settings__user-card';

  const avatar = document.createElement('div');
  avatar.className = 'atenna-settings__avatar';
  avatar.textContent = (session.email?.[0] ?? 'A').toUpperCase();

  const userInfo = document.createElement('div');
  userInfo.className = 'atenna-settings__user-info';

  const emailEl = document.createElement('div');
  emailEl.className = 'atenna-settings__user-email';
  emailEl.textContent = session.email;

  const planBadge = document.createElement('span');
  planBadge.className = `atenna-settings__plan-badge${pro ? ' atenna-settings__plan-badge--pro' : ''}`;
  planBadge.textContent = pro ? 'Pro ✓' : 'Free';

  userInfo.appendChild(emailEl);
  userInfo.appendChild(planBadge);
  userCard.appendChild(avatar);
  userCard.appendChild(userInfo);

  // ── Scroll body ──────────────────────────────────────────
  const body = document.createElement('div');
  body.className = 'atenna-settings__body';

  // Skeleton while loading
  const skeleton = document.createElement('div');
  skeleton.className = 'atenna-skeleton-loading';
  skeleton.style.cssText = 'height:200px;border-radius:8px;margin:12px 0;';
  body.appendChild(skeleton);

  box.appendChild(header);
  box.appendChild(userCard);
  box.appendChild(body);
  overlay.appendChild(box);

  // ── Load all data async ──────────────────────────────────
  void (async () => {
    try {
      const [usage, monthly, total, dlpLocal] = await Promise.all([
        getUsage(),
        getMonthlyUsage(),
        getTotalCount(),
        getDlpStats(),
      ]);

      // Attempt Supabase sync (non-blocking)
      let dlp = dlpLocal;
      if (session.access_token) {
        try {
          // Extract user_id from JWT
          const { decodeJwtPayload } = await import('../core/auth');
          const payload = decodeJwtPayload(session.access_token);
          const userId = payload['sub'] as string | undefined;
          if (userId) dlp = await syncDlpStats(session.access_token, userId);
        } catch { /* offline */ }
      }

      const taxaProtecao = dlp.scansTotal > 0
        ? Math.min(100, Math.round(dlp.protectedCount / dlp.scansTotal * 100))
        : 0;
      const tokensK = dlp.tokensEstimated >= 1000
        ? `~${(dlp.tokensEstimated / 1000).toFixed(1)}k`
        : `~${dlp.tokensEstimated}`;
      const dailyLimit  = pro ? '∞' : String(DAILY_LIMIT);
      const monthlyLimit = pro ? '∞' : String(MONTHLY_LIMIT);

      skeleton.remove();

      // ── Seção: Uso de Prompts ──────────────────────────
      body.appendChild(makeSectionTitle('📊 Uso de Prompts'));

      const usageSection = document.createElement('div');
      usageSection.className = 'atenna-settings__section';

      const todayRow = makeStatRow('Hoje', `${usage.count} / ${dailyLimit}`);
      if (!pro) todayRow.appendChild(makeProgressBar(usage.count, DAILY_LIMIT));

      const monthRow = makeStatRow('Este mês', `${monthly} / ${monthlyLimit}`);
      if (!pro) monthRow.appendChild(makeProgressBar(monthly, MONTHLY_LIMIT, '#3b82f6'));

      usageSection.appendChild(todayRow);
      usageSection.appendChild(monthRow);
      usageSection.appendChild(makeStatRow('Total', `${total} refinamentos`));

      if (!pro) {
        const upgradeBtn = document.createElement('button');
        upgradeBtn.className = 'atenna-settings__upgrade-cta';
        upgradeBtn.textContent = '★ Upgrade para Pro — acesso ilimitado';
        upgradeBtn.addEventListener('click', () => {
          void trackEvent('upgrade_modal_shown');
          const up = renderUpgradeModal(() => up.remove());
          document.body.appendChild(up);
        });
        usageSection.appendChild(upgradeBtn);
      }

      body.appendChild(usageSection);

      // ── Seção: LGPD & Proteção ────────────────────────
      body.appendChild(makeSectionTitle('🛡 LGPD & Proteção de Dados'));

      const dlpSection = document.createElement('div');
      dlpSection.className = 'atenna-settings__section';

      dlpSection.appendChild(makeStatRow('Dados protegidos', String(dlp.protectedCount), 'substituições realizadas'));
      dlpSection.appendChild(makeStatRow('Scans DLP', String(dlp.scansTotal), 'verificações em tempo real'));
      dlpSection.appendChild(makeStatRow('Tokens economizados', tokensK, 'estimativa de dados ofuscados'));

      const taxaRow = document.createElement('div');
      taxaRow.className = 'atenna-settings__stat-row atenna-settings__stat-row--bar';
      const taxaLabel = document.createElement('span');
      taxaLabel.className = 'atenna-settings__stat-label';
      taxaLabel.textContent = 'Taxa de proteção';
      const taxaVal = document.createElement('span');
      taxaVal.className = 'atenna-settings__stat-value';
      taxaVal.textContent = `${taxaProtecao}%`;
      taxaRow.appendChild(taxaLabel);
      taxaRow.appendChild(taxaVal);
      dlpSection.appendChild(taxaRow);
      dlpSection.appendChild(makeProgressBar(taxaProtecao, 100, taxaProtecao >= 70 ? '#22c55e' : taxaProtecao >= 40 ? '#f59e0b' : '#ef4444'));

      body.appendChild(dlpSection);

      // ── Seção: Personalização ─────────────────────────
      body.appendChild(makeSectionTitle('⚙ Personalização'));

      const personalSection = document.createElement('div');
      personalSection.className = 'atenna-settings__section';

      const toggleRow = document.createElement('label');
      toggleRow.className = 'atenna-modal__account-toggle-row';
      toggleRow.style.padding = '8px 0';

      const toggleLabel = document.createElement('span');
      toggleLabel.textContent = 'Alerta automático de dados';

      const toggleInput = document.createElement('input');
      toggleInput.type = 'checkbox';
      toggleInput.className = 'atenna-modal__account-toggle';

      chrome.storage.local.get('atenna_settings', (res) => {
        const s = res['atenna_settings'] as { autoBanner?: boolean } | undefined;
        toggleInput.checked = s?.autoBanner !== false;
      });

      toggleInput.addEventListener('change', () => {
        setAutoBanner(toggleInput.checked);
      });

      toggleRow.appendChild(toggleLabel);
      toggleRow.appendChild(toggleInput);
      personalSection.appendChild(toggleRow);
      body.appendChild(personalSection);

    } catch {
      skeleton.textContent = 'Erro ao carregar dados.';
    }
  })();

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
  document.body.appendChild(overlay);

  // ── Close handler ────────────────────────────────────
  const close = () => { clearMsgInterval(); overlay.remove(); };
  overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape') { close(); document.removeEventListener('keydown', onKey); }
  };
  document.addEventListener('keydown', onKey);

  // Track daily return (async — non-blocking)
  const today = new Date().toISOString().split('T')[0];
  const lastOpen = await new Promise<string | null>(resolve => {
    try { chrome.storage.local.get('atenna_last_open_date', r => resolve(r['atenna_last_open_date'] as string | null)); }
    catch { resolve(null); }
  });
  if (lastOpen && lastOpen !== today) {
    void trackEvent('daily_return');
  }
  await new Promise(resolve => {
    try { chrome.storage.local.set({ atenna_last_open_date: today }, resolve); }
    catch { resolve(undefined); }
  });

  // ── Auth Gate: Check session FIRST ───────────────────
  const session = await getActiveSession();

  if (!session) {
    const logoUrl = getLogoUrl();
    const logoImg = logoUrl
      ? `<img src="${logoUrl}" width="22" height="22" alt="" aria-hidden="true"/>`
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
      <span class="atenna-modal__title">${logoImg}Atenna</span>
      <div class="atenna-modal__toggle" role="tablist">
        <button class="atenna-modal__tab${editActive}"    data-tab="edit"    role="tab" aria-selected="${editSelected}">Refinar</button>
        <button class="atenna-modal__tab${promptsActive}" data-tab="prompts" role="tab" aria-selected="${promptsSelected}">Histórico</button>
      </div>
      <div class="atenna-modal__header-right">
        <span class="atenna-modal__usage" aria-label="Uso diário">…</span>
        <div class="atenna-modal__account">
          <button class="atenna-modal__gear-btn" aria-label="Conta" data-gear>⚙</button>
        </div>
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
        <button class="atenna-modal__regen">Refinar</button>
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

    // Layer 1 — local DLP scan (<50ms, non-blocking)
    const scanResult = scan(text);
    const advisory   = buildAdvisory(scanResult);
    updateBadgeDotRisk(scanResult.riskLevel);

    if (advisory.riskLevel !== 'NONE') {
      void trackEvent('dlp_warning_shown', { risk_level: advisory.riskLevel } as Parameters<typeof trackEvent>[1]);
    }

    // Layer 3 — UX decision: show advisory if needed, then proceed
    void showDlpAdvisory(advisory, promptsView).then(proceed => {
      if (!proceed) return;
      void isPro().then(pro => runFlow(promptsView, usageBadge, text, platformInput, overlay, origin, pro));
    });
  });

  // ── Auto-generate / show cache / idle ─────────────────
  const [usage, pro, totalCount] = await Promise.all([getUsage(), isPro(), getTotalCount()]);
  await updateUsageBadge(usageBadge, usage.count, pro);

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
      );
      document.body.appendChild(settingsPage);
    });
  }

  if (cacheHit) {
    renderPrompts(promptsView, promptCache!.data, platformInput, overlay, 'manual');
  } else if (userText !== '') {
    renderLoading(promptsView);
    const shouldShowSuggestion = pro && (isVagueInput(userText) || shouldSuggestBuilder(userText));
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
  } else {
    // Always show onboarding when no text — guides first-timers and returning users
    switchTab('edit');
    renderOnboarding(promptsView, (example: string) => {
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

    await renderSuccess(container);

    if (!document.getElementById(OVERLAY_ID)) return;

    const [newUsage, newTotalCount] = await Promise.all([incrementUsage(), incrementTotalCount(), incrementMonthlyUsage()]) as [Awaited<ReturnType<typeof incrementUsage>>, number, number];
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

// ─── DLP Advisory (Layer 3 UX) ────────────────────────────────

const SHIELD_SVG = `<svg viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
  <path d="M8 1L2 3.5V8C2 11.3 4.7 14.3 8 15C11.3 14.3 14 11.3 14 8V3.5L8 1Z"
    stroke="currentColor" stroke-width="1.4" stroke-linejoin="round" fill="none"/>
</svg>`;

/**
 * Shows DLP advisory above the content area.
 * Returns a Promise that resolves true (proceed) or false (user wants to review).
 * For LOW/NONE resolves immediately without showing UI.
 */
function showDlpAdvisory(
  advisory:  Advisory,
  container: HTMLElement,
): Promise<boolean> {
  return new Promise(resolve => {
    if (!advisory.show) { resolve(true); return; }

    const el = document.createElement('div');
    el.className = `atenna-dlp-advisory atenna-dlp-advisory--${advisory.riskLevel.toLowerCase()}`;

    const header = document.createElement('div');
    header.className = 'atenna-dlp-advisory__header';

    const icon = document.createElement('span');
    icon.className = 'atenna-dlp-advisory__icon';
    icon.innerHTML = SHIELD_SVG;

    const msg = document.createElement('p');
    msg.className = 'atenna-dlp-advisory__msg';
    msg.textContent = advisory.message;

    header.appendChild(icon);
    header.appendChild(msg);
    el.appendChild(header);

    // Entity pills
    if (advisory.entities.length > 0 && advisory.riskLevel !== 'LOW') {
      const pills = document.createElement('div');
      pills.className = 'atenna-dlp-advisory__entities';
      const seen = new Set<string>();
      advisory.entities.forEach(e => {
        if (!seen.has(e.type)) {
          seen.add(e.type);
          const pill = document.createElement('span');
          pill.className = 'atenna-dlp-advisory__pill';
          pill.textContent = e.type.replace('_', ' ');
          pills.appendChild(pill);
        }
      });
      el.appendChild(pills);
    }

    // Action buttons
    if (advisory.primaryCta) {
      const actions = document.createElement('div');
      actions.className = 'atenna-dlp-advisory__actions';

      const primary = document.createElement('button');
      primary.className = 'atenna-dlp-advisory__btn-primary';
      primary.textContent = advisory.primaryCta;
      primary.addEventListener('click', () => { el.remove(); resolve(true); });

      actions.appendChild(primary);

      if (advisory.secondaryCta) {
        const secondary = document.createElement('button');
        secondary.className = 'atenna-dlp-advisory__btn-secondary';
        secondary.textContent = advisory.secondaryCta;
        secondary.addEventListener('click', () => {
          void trackEvent('dlp_send_override');
          el.remove();
          resolve(true);
        });
        actions.appendChild(secondary);
      }

      el.appendChild(actions);
    }

    container.prepend(el);
  });
}

// ─── Render: loading (premium skeleton, adaptive states) ─────

function renderLoading(container: HTMLElement): void {
  clearMsgInterval();
  container.innerHTML = '';

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

  let i = 0;
  msgIntervalId = setInterval(() => {
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
  wrap.className = 'atenna-modal__limit-reached';

  const msg = document.createElement('p');
  msg.className = 'atenna-modal__limit-msg';
  msg.textContent = 'Você já refinou 5 solicitações hoje.';

  const sub = document.createElement('p');
  sub.className = 'atenna-modal__limit-sub';
  sub.textContent = 'Volte amanhã para novas gerações ou continue refinando sem limites.';

  const btn = document.createElement('button');
  btn.className = 'atenna-modal__limit-btn';
  btn.textContent = 'Conhecer Pro';
  btn.addEventListener('click', () => {
    void trackEvent('upgrade_from_limit');
    showToast('Em breve! 🚀');
  });

  wrap.appendChild(msg);
  wrap.appendChild(sub);
  wrap.appendChild(btn);
  container.appendChild(wrap);
}

// Static SVG icons for onboarding — safe for innerHTML
const ONB_ICON_CLARITY = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/></svg>`;
const ONB_ICON_SHIELD  = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>`;
const ONB_ICON_FLOW    = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="9 11 12 14 22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/></svg>`;

function renderPreLoginOnboarding(container: HTMLElement, switchView: (view: string) => void): void {
  void trackEvent('onboarding_shown');
  chrome.storage.local.set({ atenna_onboarding_seen: true });
  clearMsgInterval();
  container.innerHTML = '';

  const wrap = document.createElement('div');
  wrap.className = 'atenna-modal__onboarding';

  wrap.innerHTML = `
    <div class="atenna-modal__onb-hero">
      <div class="atenna-modal__onb-wordmark">Atenna</div>
      <div class="atenna-modal__onb-headline">Clareza antes da inteligência.</div>
      <p class="atenna-modal__onb-sub">Uma camada entre você e a IA — para que suas intenções cheguem com precisão.</p>
    </div>
    <ul class="atenna-modal__onb-features">
      <li>
        <span class="atenna-modal__onb-icon">${ONB_ICON_CLARITY}</span>
        <div><strong>Organiza instruções complexas</strong><span>Estrutura sua intenção em versões claras e objetivas</span></div>
      </li>
      <li>
        <span class="atenna-modal__onb-icon">${ONB_ICON_SHIELD}</span>
        <div><strong>Detecta dados sensíveis</strong><span>Alerta sobre possíveis informações pessoais antes do envio</span></div>
      </li>
      <li>
        <span class="atenna-modal__onb-icon">${ONB_ICON_FLOW}</span>
        <div><strong>Melhora a comunicação com IA</strong><span>Solicitações mais claras geram respostas mais precisas</span></div>
      </li>
    </ul>
    <div class="atenna-modal__onb-free-tag">Disponível hoje · 5 utilizações · Sem cartão</div>
  `;

  const ctaBtn = document.createElement('button');
  ctaBtn.className = 'atenna-modal__onb-cta';
  ctaBtn.textContent = 'Começar';
  ctaBtn.addEventListener('click', () => {
    void trackEvent('onboarding_cta_clicked');
    switchView('signup');
  });

  const loginLink = document.createElement('button');
  loginLink.className = 'atenna-modal__onb-login';
  loginLink.textContent = 'Já tenho uma conta';
  loginLink.addEventListener('click', () => {
    void trackEvent('onboarding_login_clicked');
    switchView('login');
  });

  wrap.appendChild(ctaBtn);
  wrap.appendChild(loginLink);
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
  title.textContent = 'Bem-vindo ao Atenna.';

  const subtitle = document.createElement('p');
  subtitle.className = 'atenna-modal__login-subtitle';
  subtitle.textContent = 'Uma camada de clareza para suas solicitações de IA.';

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
  emailIcon.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="2" y="4" width="20" height="16" rx="2"/><path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7"/></svg>`;
  emailWrapper.appendChild(emailIcon);
  emailWrapper.appendChild(emailInput);

  // Senha com ícone + eye toggle
  const passwordWrapper = document.createElement('div');
  passwordWrapper.className = 'atenna-modal__input-wrapper';
  const passwordInput = document.createElement('input');
  passwordInput.type = 'password';
  passwordInput.className = 'atenna-modal__login-input';
  passwordInput.placeholder = 'Senha';
  passwordInput.autocomplete = 'current-password';
  const pwdIcon = document.createElement('span');
  pwdIcon.className = 'atenna-modal__input-icon-left';
  pwdIcon.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>`;
  const eyeToggle = document.createElement('button');
  eyeToggle.className = 'atenna-modal__input-icon-right';
  eyeToggle.type = 'button';
  eyeToggle.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>`;
  eyeToggle.title = 'Mostrar senha';
  eyeToggle.addEventListener('click', (e) => {
    e.preventDefault();
    const isPassword = passwordInput.type === 'password';
    passwordInput.type = isPassword ? 'text' : 'password';
    eyeToggle.title = isPassword ? 'Ocultar senha' : 'Mostrar senha';
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

    const result = await signInWithPassword(email, pwd);
    if (result.error) {
      void trackEvent('login_error', { error: result.error });
      status.textContent = result.error;
      status.classList.remove('atenna-modal__login-status--success');
      status.classList.add('atenna-modal__login-status--error');
      btn.disabled = false;
      btn.textContent = 'Entrar';
    } else {
      void trackEvent('login_success');
      status.textContent = 'Login realizado! Recarregando...';
      status.classList.remove('atenna-modal__login-status--error');
      status.classList.add('atenna-modal__login-status--success');
      emailInput.disabled = true;
      passwordInput.disabled = true;
      btn.disabled = true;
      setTimeout(() => window.location.reload(), 1000);
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
  emailIcon.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="2" y="4" width="20" height="16" rx="2"/><path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7"/></svg>`;
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
  pwdIcon.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>`;
  const eyeToggle = document.createElement('button');
  eyeToggle.className = 'atenna-modal__input-icon-right';
  eyeToggle.type = 'button';
  eyeToggle.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>`;
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
  confirmIcon.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>`;
  const eyeToggle2 = document.createElement('button');
  eyeToggle2.className = 'atenna-modal__input-icon-right';
  eyeToggle2.type = 'button';
  eyeToggle2.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>`;
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

  const setStatus = (msg: string, type: 'error' | 'warning' | 'success' | '') => {
    status.textContent = msg;
    status.classList.remove('atenna-modal__login-status--error', 'atenna-modal__login-status--warning', 'atenna-modal__login-status--success');
    if (type) status.classList.add(`atenna-modal__login-status--${type}`);
  };

  // Real-time confirm password check
  confirmInput.addEventListener('blur', () => {
    const pwd = passwordInput.value;
    const confirm = confirmInput.value;
    if (confirm && pwd !== confirm) setStatus('As senhas não conferem', 'warning');
    else if (confirm && pwd === confirm) setStatus('Senhas conferem ✓', 'success');
  });
  confirmInput.addEventListener('input', () => {
    const pwd = passwordInput.value;
    const confirm = confirmInput.value;
    if (confirm && pwd === confirm) setStatus('Senhas conferem ✓', 'success');
    else if (confirm) setStatus('As senhas não conferem', 'warning');
    else setStatus('', '');
  });

  const handleClick = async () => {
    const email = emailInput.value.trim();
    const pwd = passwordInput.value;
    const confirm = confirmInput.value;

    if (!email) { setStatus('Informe seu email', 'warning'); return; }
    if (pwd.length < 6) { setStatus('Senha deve ter no mínimo 6 caracteres', 'warning'); return; }
    if (pwd !== confirm) { setStatus('As senhas não conferem', 'warning'); return; }

    void trackEvent('signup_submitted', { input_length: email.length });

    btn.disabled = true;
    btn.textContent = 'Criando…';
    setStatus('', '');

    const result = await signUpWithPassword(email, pwd);
    if (result.error) {
      void trackEvent('signup_error', { error: result.error });
      setStatus(result.error, 'error');
      btn.disabled = false;
      btn.textContent = 'Criar conta';
    } else {
      void trackEvent('signup_success');
      setStatus('Conta criada! Verifique seu email e clique no link de confirmação.', 'success');
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
  card.className = 'atenna-modal__upgrade-trigger';

  const msg = document.createElement('p');
  msg.className = 'atenna-modal__upgrade-trigger-msg';
  msg.textContent = 'Você já criou 3 prompts.';

  const sub = document.createElement('p');
  sub.className = 'atenna-modal__upgrade-trigger-sub';
  sub.textContent = 'Usuários Pro refinam sem limite de iterações.';

  const btn = document.createElement('button');
  btn.className = 'atenna-modal__upgrade-trigger-btn';
  btn.textContent = 'Ver Pro';
  btn.addEventListener('click', () => {
    void trackEvent('upgrade_from_trigger');
    showToast('Em breve! 🚀');
  });

  card.appendChild(msg);
  card.appendChild(sub);
  card.appendChild(btn);
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

  const entries: Array<{ emoji: string; label: string; speed: string; description: string; text: string; preview?: string; prompt_type: PromptType; variant: 'primary' | 'secondary' | 'tertiary' }> = [
    { emoji: '●', label: 'Refinado',      speed: 'Rápido',       description: 'Claro e objetivo',      text: data.structured, preview: data.structured_preview, prompt_type: 'structured', variant: 'primary' },
    { emoji: '●', label: 'Estruturado',   speed: 'Equilibrado',   description: 'Organizado em seções', text: data.direct,     preview: data.direct_preview,     prompt_type: 'direct',     variant: 'secondary' },
    { emoji: '●', label: 'Estratégico',   speed: 'Profundo',      description: 'Aprofundado e preciso',text: data.technical,  preview: data.technical_preview,  prompt_type: 'technical',  variant: 'tertiary' },
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
        .then(() => showToast('Copiado!'))
        .catch(() => { fallbackCopy(text); showToast('Copiado!'); });
    } catch {
      fallbackCopy(text);
      showToast('Copiado!');
    }
  });

  useBtn.addEventListener('click', () => {
    void track('prompt_used', { prompt_type: v.prompt_type, card_variant: v.variant, origin });
    if (platformInput) {
      setInputText(platformInput, ta.value);
      clearMsgInterval();
      overlay.remove();
      showToast('Aplicado');
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
  const remaining = Math.max(0, DAILY_LIMIT - dailyCount);
  badge.textContent = `${remaining} gerações restantes`;
  badge.className   = 'atenna-modal__usage';
  if (dailyCount >= DAILY_LIMIT) badge.classList.add('atenna-modal__usage--danger');
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
