import { makeProgressBar, makeStatRow, makeSectionTitle, isDark, showToast, S_ROW, S_LABEL, S_VALUE } from './utils';
import { renderUpgradeModal, renderPricingCards } from './plans-modal';
import { openCheckout } from './network';
import { DAILY_LIMIT, MONTHLY_LIMIT, getUsage, getMonthlyUsage, getTotalCount } from '../../core/usageCounter';
import { bffUsage } from '../../auth/bffClient';
import { getBadgeColor, saveBadgeColor, applyBadgeColorToDom } from '../../core/userSettings';
import type { BadgeColor } from '../../core/userSettings';
import { getDlpStats } from '../../core/dlpStats';
import { renderPrivacyDataSection } from '../privacy-data';
import { trackEvent } from '../../core/analytics';
import { getFlag } from '../../core/featureFlags';
import { sk } from '../../core/scopedStorage';
import { saveDisplayName } from '../../core/auth';
import { setAutoBanner } from '../../content/injectButton';
import { UploadWidget } from '../upload-widget';
export function renderSettingsPage(
  session: { email: string; access_token?: string; display_name?: string },
  pro: boolean,
  onBack: () => void,
  renderDocumentActionBar: (container: HTMLElement, content: string) => void,
): HTMLElement {
  const dark = isDark();
  const overlay = document.createElement('div');
  overlay.id = 'atenna-settings-overlay';
  overlay.className = 'atenna-modal-overlay';

  // Inject into document.head so it wins over host page !important rules.
  // A <style> inside a <div> is not guaranteed to be processed after host styles in all browsers.
  const _tc = isDark() ? '#e8e8e8' : '#1a1a1a';
  const FORCE_STYLE_ID = 'atenna-force-settings-style';
  let forceStyle = document.getElementById(FORCE_STYLE_ID) as HTMLStyleElement | null;
  if (!forceStyle) {
    forceStyle = document.createElement('style');
    forceStyle.id = FORCE_STYLE_ID;
    document.head.appendChild(forceStyle);
  }
  forceStyle.textContent = `
    #atenna-settings-overlay .atenna-stat-row {
      display: flex !important; align-items: center !important; gap: 8px !important;
      padding: 9px 14px !important; flex-wrap: wrap !important;
      min-height: 38px !important; box-sizing: border-box !important;
      border-bottom: 1px solid rgba(128,128,128,0.10) !important;
      width: 100% !important; visibility: visible !important; opacity: 1 !important;
    }
    #atenna-settings-overlay .atenna-stat-label {
      flex: 1 !important; font-size: 13px !important; line-height: 1.4 !important;
      font-family: inherit !important; visibility: visible !important;
      display: inline !important; color: ${_tc} !important; opacity: 0.78 !important;
    }
    #atenna-settings-overlay .atenna-stat-value {
      font-size: 13px !important; font-weight: 700 !important;
      font-variant-numeric: tabular-nums !important; font-family: inherit !important;
      visibility: visible !important; display: inline !important; color: ${_tc} !important;
    }
    #atenna-settings-overlay .atenna-stat-sub {
      width: 100% !important; font-size: 10px !important; display: block !important;
      margin-top: -3px !important; padding-bottom: 2px !important;
      visibility: visible !important; color: ${_tc} !important; opacity: 0.40 !important;
    }
    #atenna-settings-overlay .atenna-stat-bar-wrap {
      height: 5px !important; border-radius: 3px !important; overflow: hidden !important;
      margin: 0 14px 10px !important; display: block !important; width: auto !important;
    }
    #atenna-settings-overlay .atenna-stat-bar-fill {
      height: 100% !important; border-radius: 3px !important; display: block !important;
      min-width: 0 !important;
    }
    #atenna-settings-overlay .atenna-color-row {
      display: flex !important; align-items: center !important;
      justify-content: space-between !important; padding: 12px 14px !important;
      gap: 12px !important; box-sizing: border-box !important;
      visibility: visible !important; opacity: 1 !important;
    }
    #atenna-settings-overlay .atenna-color-swatches {
      display: flex !important; gap: 8px !important; align-items: center !important;
      flex-wrap: wrap !important; visibility: visible !important;
    }
    #atenna-settings-overlay .atenna-settings__section {
      display: block !important; visibility: visible !important; opacity: 1 !important;
      overflow: visible !important;
    }
  `;

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
    const { signOut } = await import('../../core/auth');
    await signOut();
    onBack();
    window.location.reload();
  });

  header.appendChild(backBtn);
  header.appendChild(logoutBtn);

  // ── User card ────────────────────────────────────────────
  const userCard = document.createElement('div');
  userCard.className = 'atenna-settings__user-card';

  const displayName = session.display_name || session.email;
  const avatar = document.createElement('div');
  avatar.className = 'atenna-settings__avatar';
  avatar.textContent = (displayName[0] ?? 'A').toUpperCase();

  const userInfo = document.createElement('div');
  userInfo.className = 'atenna-settings__user-info';

  const emailEl = document.createElement('div');
  emailEl.className = 'atenna-settings__user-email';
  emailEl.textContent = session.display_name || session.email;

  const planBadge = document.createElement('span');
  planBadge.className = `atenna-settings__plan-badge${pro ? ' atenna-settings__plan-badge--pro' : ''}`;
  planBadge.textContent = pro ? 'Pro ✓' : 'Grátis';

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
      const [usageLocal, monthlyLocal, totalLocal, dlpLocal, serverUsage] = await Promise.all([
        getUsage(),
        getMonthlyUsage(),
        getTotalCount(),
        getDlpStats(),
        bffUsage(),
      ]);

      // Server data is cross-device truth; use max(local, server) so nothing appears to go backwards
      const dlp = dlpLocal;
      const usage   = { ...usageLocal,  count: Math.max(usageLocal.count,   serverUsage?.today   ?? 0) };
      const monthly = Math.max(monthlyLocal, serverUsage?.monthly ?? 0);
      const total   = Math.max(totalLocal,   serverUsage?.total   ?? 0);
      if (serverUsage) {
        dlp.protectedCount  = Math.max(dlp.protectedCount,  serverUsage.protected_count);
        dlp.scansTotal      = Math.max(dlp.scansTotal,      serverUsage.scans_total);
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

      const S_SECTION = `background:${dark ? '#2a2a2a' : '#f0f0f0'};border:1px solid rgba(128,128,128,0.15);border-radius:10px;overflow:hidden;display:block;box-sizing:border-box;`;
      const usageSection = document.createElement('div');
      usageSection.className = 'atenna-settings__section';
      usageSection.style.cssText = S_SECTION;


      const todayRow = makeStatRow(
        'Hoje',
        `${usage.count} / ${dailyLimit}`,
        undefined,
        `Prompts gerados hoje. Limite diário: ${dailyLimit}.`,
      );
      if (!pro) todayRow.appendChild(makeProgressBar(usage.count, DAILY_LIMIT));

      const monthRow = makeStatRow(
        'Este mês',
        `${monthly} / ${monthlyLimit}`,
        undefined,
        `Prompts gerados no mês atual. Limite mensal: ${monthlyLimit}.`,
      );
      if (!pro) monthRow.appendChild(makeProgressBar(monthly, MONTHLY_LIMIT, '#3b82f6'));

      usageSection.appendChild(todayRow);
      usageSection.appendChild(monthRow);
      usageSection.appendChild(makeStatRow(
        'Total acumulado',
        total > 0 ? `${total} refinamentos` : '— nenhum ainda',
        undefined,
        'Total de prompts refinados desde a instalação.',
      ));

      if (!pro) {
        renderPricingCards(usageSection, 'settings_panel');
      }

      body.appendChild(usageSection);

      // ── Seção: LGPD & Proteção ────────────────────────
      body.appendChild(makeSectionTitle('🛡 LGPD & Proteção de Dados'));

      const dlpSection = document.createElement('div');
      dlpSection.className = 'atenna-settings__section';
      dlpSection.style.cssText = S_SECTION;


      dlpSection.appendChild(makeStatRow(
        'Dados protegidos',
        dlp.protectedCount > 0 ? String(dlp.protectedCount) : '—',
        dlp.protectedCount > 0 ? 'substituições realizadas' : 'Clique em "Proteger dados" para registrar',
        'Número de vezes que dados sensíveis foram mascarados antes do envio.',
      ));
      dlpSection.appendChild(makeStatRow(
        'Verificações de proteção',
        dlp.scansTotal > 0 ? String(dlp.scansTotal) : '—',
        dlp.scansTotal > 0 ? 'análises em tempo real' : 'Aguardando primeira verificação',
        'Total de análises automáticas de dados sensíveis realizadas.',
      ));
      dlpSection.appendChild(makeStatRow(
        'Tokens economizados',
        dlp.tokensEstimated > 0 ? tokensK : '—',
        dlp.tokensEstimated > 0 ? 'estimativa de dados ofuscados' : 'Será calculado após o primeiro uso',
        'Estimativa de tokens de dados sensíveis que não foram enviados aos LLMs.',
      ));

      const taxaRow = document.createElement('div');
      taxaRow.style.cssText = S_ROW;
      const taxaLabel = document.createElement('span');
      taxaLabel.style.cssText = S_LABEL;
      taxaLabel.textContent = 'Cobertura de proteção';
      const taxaVal = document.createElement('span');
      taxaVal.style.cssText = S_VALUE;
      taxaVal.textContent = dlp.scansTotal > 0 ? `${taxaProtecao}%` : '—';
      taxaRow.appendChild(taxaLabel);
      taxaRow.appendChild(taxaVal);
      dlpSection.appendChild(taxaRow);
      dlpSection.appendChild(makeProgressBar(taxaProtecao, 100, taxaProtecao >= 70 ? '#22c55e' : taxaProtecao >= 40 ? '#f59e0b' : '#ef4444'));

      body.appendChild(dlpSection);

      // ── Seção: Personalização ─────────────────────────
      body.appendChild(makeSectionTitle('⚙ Personalização'));

      const personalSection = document.createElement('div');
      personalSection.className = 'atenna-settings__section';
      personalSection.style.cssText = S_SECTION;

      // ── Nome de exibição ─────────────────────────────
      {
        const nameRow = document.createElement('div');
        nameRow.style.cssText = 'display:flex;align-items:center;justify-content:space-between;padding:12px 14px;gap:12px;box-sizing:border-box;';

        const nameLabel = document.createElement('span');
        nameLabel.style.cssText = `font-size:13px;color:${_tc};font-weight:500;white-space:nowrap;opacity:0.85;font-family:inherit;`;
        nameLabel.textContent = 'Seu nome';

        const nameRight = document.createElement('div');
        nameRight.style.cssText = 'display:flex;align-items:center;gap:8px;';

        const nameField = document.createElement('input');
        nameField.type = 'text';
        nameField.className = 'atenna-modal__login-input';
        nameField.style.cssText = 'padding:6px 10px;font-size:12px;width:160px;';
        nameField.placeholder = 'Como posso te chamar?';
        nameField.value = session.display_name || '';

        const saveNameBtn = document.createElement('button');
        saveNameBtn.className = 'atenna-doc-action-btn';
        saveNameBtn.textContent = 'Salvar';
        saveNameBtn.style.cssText = 'padding:5px 12px;font-size:12px;';
        saveNameBtn.addEventListener('click', async () => {
          const val = nameField.value.trim();
          if (!val) return;
          saveNameBtn.disabled = true;
          saveNameBtn.textContent = 'Salvando…';
          try {
            await saveDisplayName(session, val);
            const avatarEl = document.querySelector('.atenna-settings__avatar') as HTMLElement | null;
            if (avatarEl) avatarEl.textContent = val[0].toUpperCase();
            const emailEl2 = document.querySelector('.atenna-settings__user-email') as HTMLElement | null;
            if (emailEl2) emailEl2.textContent = val;
            saveNameBtn.textContent = 'Salvo ✓';
            setTimeout(() => { saveNameBtn.disabled = false; saveNameBtn.textContent = 'Salvar'; }, 1500);
          } catch {
            saveNameBtn.disabled = false;
            saveNameBtn.textContent = 'Salvar';
          }
        });

        nameRight.appendChild(nameField);
        nameRight.appendChild(saveNameBtn);
        nameRow.appendChild(nameLabel);
        nameRow.appendChild(nameRight);
        personalSection.appendChild(nameRow);
      }

      // ── Badge color picker ────────────────────────────
      {
        const colorRow = document.createElement('div');
        colorRow.className = 'atenna-color-row';
        colorRow.style.cssText = 'display:flex;align-items:center;justify-content:space-between;padding:12px 14px;gap:12px;box-sizing:border-box;';

        const colorLabel = document.createElement('span');
        colorLabel.style.cssText = `font-size:13px;color:${_tc};font-weight:500;white-space:nowrap;opacity:0.85;font-family:inherit;`;
        colorLabel.textContent = 'Cor do badge';
        colorRow.appendChild(colorLabel);

        const colorPicker = document.createElement('div');
        colorPicker.className = 'atenna-color-swatches';
        colorPicker.style.cssText = 'display:flex;gap:8px;align-items:center;flex-wrap:wrap;';

        type BC = BadgeColor;

        const COLORS: { id: BC; label: string; bg: string }[] = [
          { id: 'transparent', label: 'Transparente', bg: 'linear-gradient(135deg,rgba(255,255,255,.35),rgba(255,255,255,.08))' },
          { id: 'green',       label: 'Verde',        bg: '#22c55e' },
          { id: 'blue',        label: 'Azul',         bg: '#3b82f6' },
          { id: 'yellow',      label: 'Amarelo',      bg: '#eab308' },
          { id: 'red',         label: 'Vermelho',     bg: '#ef4444' },
          { id: 'white',       label: 'Branco',       bg: '#ffffff' },
        ];

        let currentColor: BC = await getBadgeColor();
        const settingsUserId = (session as { user_id?: string }).user_id;

        const savedFeedback = document.createElement('span');
        savedFeedback.style.cssText = 'font-size:11px;color:#22c55e;font-weight:500;opacity:0;transition:opacity 200ms ease;white-space:nowrap;';
        savedFeedback.textContent = 'Salvo ✓';

        COLORS.forEach(({ id, label, bg }) => {
          const sw = document.createElement('button');
          sw.style.cssText = `width:28px;height:28px;border-radius:50%;border:2px solid transparent;cursor:pointer;padding:0;background:${bg};transition:transform 150ms cubic-bezier(0.34,1.4,0.64,1),box-shadow 150ms ease;flex-shrink:0;outline:none;`;
          if (id === 'transparent') sw.style.border = '1.5px solid rgba(255,255,255,0.4)';
          if (id === 'white') sw.style.border = '1.5px solid rgba(0,0,0,0.15)';
          sw.setAttribute('aria-label', label);
          sw.setAttribute('title', label);
          sw.setAttribute('data-color', id);

          const markActive = (el: HTMLButtonElement) => {
            el.style.transform = 'scale(1.15)';
            el.style.boxShadow = '0 0 0 2px var(--at-card-bg,#2a2a2a), 0 0 0 4px var(--at-text,#e8e8e8)';
          };
          const markInactive = (el: HTMLButtonElement) => {
            el.style.transform = 'scale(1)';
            el.style.boxShadow = 'none';
          };

          if (id === currentColor) markActive(sw);

          sw.addEventListener('mouseenter', () => { if (id !== currentColor) sw.style.transform = 'scale(1.12)'; });
          sw.addEventListener('mouseleave', () => { if (id !== currentColor) markInactive(sw); });

          sw.addEventListener('click', () => {
            colorPicker.querySelectorAll<HTMLButtonElement>('[data-color]').forEach(s => markInactive(s));
            markActive(sw);
            currentColor = id;
            void saveBadgeColor(id, session.access_token, settingsUserId);
            applyBadgeColorToDom(id);
            savedFeedback.style.opacity = '1';
            setTimeout(() => { savedFeedback.style.opacity = '0'; }, 1500);
          });

          colorPicker.appendChild(sw);
        });

        colorRow.appendChild(colorPicker);
        colorRow.appendChild(savedFeedback);
        personalSection.appendChild(colorRow);
      }

      const toggleRow = document.createElement('label');
      toggleRow.className = 'atenna-modal__account-toggle-row';
      toggleRow.style.padding = '8px 0';

      const toggleLabel = document.createElement('span');
      toggleLabel.textContent = 'Alerta automático de dados';

      const toggleInput = document.createElement('input');
      toggleInput.type = 'checkbox';
      toggleInput.className = 'atenna-modal__account-toggle';

      const settingsKey = sk('atenna_settings');
      chrome.storage.local.get(settingsKey, (res) => {
        const s = res[settingsKey] as { autoBanner?: boolean } | undefined;
        toggleInput.checked = s?.autoBanner !== false;
      });

      toggleInput.addEventListener('change', () => {
        setAutoBanner(toggleInput.checked);
      });

      toggleRow.appendChild(toggleLabel);
      toggleRow.appendChild(toggleInput);
      personalSection.appendChild(toggleRow);
      body.appendChild(personalSection);

      // ── Seção: Documentos (FASE 4.1 Multimodal) ───────────
      const multimodalEnabled = await getFlag('MULTIMODAL_ENABLED');
      if (multimodalEnabled) {
        body.appendChild(makeSectionTitle('📎 Documentos'));

        const docSection = document.createElement('div');
        docSection.className = 'atenna-settings__section';
      // inline fallback for host CSS isolation

        docSection.id = 'upload-widget-container';

        const uploadWidget = new UploadWidget({
          targetElement: docSection,
          maxSize: {
            'txt': 1024 * 1024,
            'md': 1024 * 1024,
            'csv': 5 * 1024 * 1024,
            'json': 1024 * 1024,
          },
          onReady: (content: string, _preview: string, riskLevel: string, rewritten?: string) => {
            void trackEvent('document_ready_to_send', {
              content_length: content.length,
              risk_level: riskLevel,
              was_rewritten: !!rewritten,
            });
            renderDocumentActionBar(docSection, content);
          },
          onError: (error: string) => {
            void trackEvent('document_upload_error', { error });
          },
          onCancel: () => {
            void trackEvent('document_upload_cancelled');
          },
          onUpgrade: (plan) => {
            void openCheckout('upload_quota_gate_settings', undefined, plan);
          },
        });

        body.appendChild(docSection);
      }

      // ── Seção: Privacidade e Dados (FASE 3.1B) ──────
      body.appendChild(makeSectionTitle('Privacidade e Dados'));
      const privacySection = renderPrivacyDataSection(session, pro);
      body.appendChild(privacySection);

      // ── Link de Privacidade ───────────────────────────────
      const privacyLink = document.createElement('div');
      privacyLink.style.cssText = 'margin-top: 16px; text-align: center;';
      const privacyAnchor = document.createElement('a');
      privacyAnchor.href = 'https://atennaplugin.maestro-n8n.site/privacy';
      privacyAnchor.target = '_blank';
      privacyAnchor.rel = 'noopener noreferrer';
      privacyAnchor.textContent = 'Política de Privacidade';
      privacyAnchor.style.cssText = 'font-size: 11px; color: var(--at-text); opacity: 0.45; text-decoration: none;';
      privacyAnchor.onmouseover = function() { privacyAnchor.style.opacity = '0.8'; };
      privacyAnchor.onmouseout  = function() { privacyAnchor.style.opacity = '0.45'; };
      privacyLink.appendChild(privacyAnchor);
      body.appendChild(privacyLink);

      // ── Botão de Reativação (Troubleshooting) ──────────────
      // Se badge desaparecer por qualquer motivo (offline, timeout, etc)
      // user pode reativar via este botão
      const troubleshootingSection = document.createElement('div');
      troubleshootingSection.style.cssText = `
        margin-top: 24px;
        padding-top: 14px;
        border-top: 1px solid var(--at-border);
        display: flex;
        justify-content: center;
      `;

      const reactivateBtn = document.createElement('button');
      reactivateBtn.className = 'atenna-settings__reactivate';
      reactivateBtn.innerHTML = '⟳ Reativar Atenna';
      reactivateBtn.style.cssText = `
        background: none;
        border: none;
        color: var(--at-text);
        opacity: 0.5;
        font-size: 11px;
        font-family: inherit;
        cursor: pointer;
        padding: 4px 8px;
        border-radius: 4px;
        transition: all 150ms ease;
      `;
      reactivateBtn.onmouseover = function() {
        this.style.opacity = '1';
        this.style.background = 'rgba(34, 197, 94, 0.1)';
      };
      reactivateBtn.onmouseout = function() {
        this.style.opacity = '0.5';
        this.style.background = 'none';
      };
      reactivateBtn.addEventListener('click', () => {
        window.location.reload();
      });
      troubleshootingSection.appendChild(reactivateBtn);

      // Botão "Reportar problema" — sempre visível em Configurações
      const reportProblemBtn = document.createElement('button');
      reportProblemBtn.style.cssText = `
        background: none; border: none;
        color: var(--at-text); opacity: 0.4;
        font-size: 11px; font-family: inherit;
        cursor: pointer; padding: 4px 8px;
        border-radius: 4px; transition: all 150ms ease;
        margin-left: 8px;
      `;
      reportProblemBtn.textContent = 'Reportar problema';
      reportProblemBtn.title = 'Enviar feedback de problema à equipe Atenna';
      reportProblemBtn.onmouseover = function() { (this as HTMLElement).style.opacity = '0.85'; };
      reportProblemBtn.onmouseout  = function() { (this as HTMLElement).style.opacity = '0.4'; };
      let settingsReported = false;
      reportProblemBtn.addEventListener('click', async () => {
        if (settingsReported) return;
        settingsReported = true;
        reportProblemBtn.textContent = 'Enviando…';
        reportProblemBtn.style.opacity = '0.4';
        try {
          const { getSession: _gs } = await import('../../auth/sessionManager');
          const _bff = await _gs();
          const resp = await fetch('https://atennaplugin.maestro-n8n.site/report-problem', {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${_bff?.token ?? ''}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({
              error_code: 'user_feedback',
              error_message: 'Usuário reportou problema via Configurações',
              page_url: window.location.href,
              extension_version: (chrome.runtime.getManifest?.() as { version?: string })?.version ?? 'unknown',
            }),
          });
          if (resp.ok) {
            reportProblemBtn.textContent = '✓ Enviado';
          } else {
            throw new Error('failed');
          }
        } catch {
          reportProblemBtn.textContent = 'Reportar problema';
          reportProblemBtn.style.opacity = '0.4';
          settingsReported = false;
        }
      });
      troubleshootingSection.appendChild(reportProblemBtn);
      body.appendChild(troubleshootingSection);

    } catch {
      skeleton.textContent = 'Erro ao carregar dados.';
    }
  })();

  return overlay;
}

// ─── Usage badge ───────────────────────────────────────────

export async function updateUsageBadge(badge: HTMLElement, dailyCount: number, pro = false): Promise<void> {
  if (pro) {
    badge.style.display = 'none'; // Pro badge já aparece no título — sem redundância
    return;
  }
  badge.innerHTML = '';
  const remaining = Math.max(0, DAILY_LIMIT - dailyCount);
  const text = document.createElement('span');
  text.textContent = dailyCount >= DAILY_LIMIT ? 'Limite atingido' : `${remaining} gerações restantes`;
  badge.appendChild(text);
  badge.className = 'atenna-modal__usage';
  if (dailyCount >= DAILY_LIMIT) badge.classList.add('atenna-modal__usage--danger');

  if (dailyCount >= Math.floor(DAILY_LIMIT * 0.6)) {
    const nudge = document.createElement('button');
    nudge.className = 'atenna-modal__upgrade-nudge';
    nudge.textContent = '↑ Pro';
    nudge.setAttribute('title', 'Remover limite diário');
    nudge.addEventListener('click', () => {
      const upgradeOverlay = renderUpgradeModal(() => upgradeOverlay.remove());
      document.body.appendChild(upgradeOverlay);
    });
    badge.appendChild(nudge);
  }
}
