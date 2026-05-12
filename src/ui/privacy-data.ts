/**
 * FASE 3.1B — Privacy & Data Governance UI
 *
 * Two-card interface for user data export and account deletion requests.
 * All operations require authentication and follow LGPD Art. 17 (right to be forgotten).
 */

interface Session {
  email: string;
  access_token: string;
}

const BACKEND = 'https://atennaplugin.maestro-n8n.site';

async function backendFetch(
  path: string,
  method: string,
  token: string,
  body?: unknown,
): Promise<Response> {
  const url = `${BACKEND}${path}`;
  const options: RequestInit = {
    method,
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`,
    },
  };

  if (body) {
    options.body = JSON.stringify(body);
  }

  try {
    return await fetch(url, options);
  } catch (e) {
    console.error(`[privacy-data] fetch error: ${path}`, e);
    throw e;
  }
}

function formatTimeRemaining(expiresAt: string | number): string {
  const expiresDate = typeof expiresAt === 'string' ? new Date(expiresAt) : new Date(expiresAt);
  const now = new Date();
  const diff = expiresDate.getTime() - now.getTime();
  const hours = Math.floor(diff / (1000 * 60 * 60));

  if (hours <= 0) return 'Expirou';
  if (hours < 1) return 'Menos de 1 hora';
  if (hours === 1) return 'Mais de 1 hora';
  if (hours <= 24) return `Mais de ${hours} horas`;
  const days = Math.ceil(hours / 24);
  return `Mais de ${days} dias`;
}

function formatDaysRemaining(scheduledAt: string | number): string {
  const scheduledDate = typeof scheduledAt === 'string' ? new Date(scheduledAt) : new Date(scheduledAt);
  const now = new Date();
  const diff = scheduledDate.getTime() - now.getTime();
  const daysRemaining = Math.ceil(diff / (1000 * 60 * 60 * 24));

  if (daysRemaining <= 0) return 'Agora';
  if (daysRemaining === 1) return '1 dia';
  return `${daysRemaining} dias`;
}

function setCardLoading(card: HTMLElement, isLoading: boolean): void {
  const btn = card.querySelector('.atenna-privacy__btn') as HTMLButtonElement;
  if (btn) {
    btn.disabled = isLoading;
    btn.style.opacity = isLoading ? '0.6' : '1';
  }
}

async function updateExportCardState(card: HTMLElement, token: string): Promise<void> {
  try {
    const res = await backendFetch('/user/export/status', 'GET', token);

    if (!res.ok) {
      console.error(`[privacy-data] export status failed: ${res.status}`);
      return;
    }

    const data = await res.json() as Record<string, unknown>;
    const hasPending = data.has_pending_request as boolean;
    const status = data.status as string | null;
    const expiresAt = data.expires_at as string | null;
    const downloadCount = data.download_count as number | null;

    const statusEl = card.querySelector('[data-export-status]') as HTMLElement;
    const actionEl = card.querySelector('[data-export-action]') as HTMLElement;

    if (!statusEl || !actionEl) return;

    if (!hasPending) {
      statusEl.innerHTML = '<div class="atenna-privacy__status-text" style="color: var(--at-muted);">Nenhuma solicitação ativa.</div>';
      actionEl.innerHTML = '<button class="atenna-privacy__btn">Solicitar relatório</button>';
      const btn = actionEl.querySelector('button') as HTMLButtonElement;
      btn?.addEventListener('click', () => void handleRequestExport(card, token));
    } else if (status === 'requested') {
      statusEl.innerHTML = '<div class="atenna-privacy__status-text">Confirmação enviada para seu email.<br><span style="font-size: 11px; color: var(--at-muted);">Verifique sua caixa de entrada.</span></div>';
      actionEl.innerHTML = '';
    } else if (status === 'ready') {
      const remaining = formatTimeRemaining(expiresAt || '');
      const downloads = `${downloadCount} download${(downloadCount ?? 0) !== 1 ? 's' : ''} restante${(downloadCount ?? 0) !== 1 ? 's' : ''}`;
      statusEl.innerHTML = `<div class="atenna-privacy__status-text">Relatório disponível.<br><span style="font-size: 11px; color: var(--at-muted);">Disponível por mais ${remaining} · ${downloads}</span></div>`;
      actionEl.innerHTML = '<button class="atenna-privacy__btn">Fazer download</button>';
      const btn = actionEl.querySelector('button') as HTMLButtonElement;
      btn?.addEventListener('click', () => void handleDownloadExport(card, token));
    } else if (status === 'expired') {
      statusEl.innerHTML = '<div class="atenna-privacy__status-text" style="color: var(--at-muted);">Este relatório expirou.</div>';
      actionEl.innerHTML = '<button class="atenna-privacy__btn">Solicitar novo</button>';
      const btn = actionEl.querySelector('button') as HTMLButtonElement;
      btn?.addEventListener('click', () => void handleRequestExport(card, token));
    }
  } catch (e) {
    console.error('[privacy-data] updateExportCardState error:', e);
  }
}

async function handleRequestExport(card: HTMLElement, token: string): Promise<void> {
  setCardLoading(card, true);

  try {
    const res = await backendFetch('/user/export/request', 'POST', token);
    if (!res.ok) {
      console.error(`[privacy-data] export request failed: ${res.status}`);
      return;
    }
    await new Promise(resolve => setTimeout(resolve, 500));
    await updateExportCardState(card, token);
  } catch (e) {
    console.error('[privacy-data] handleRequestExport error:', e);
  } finally {
    setCardLoading(card, false);
  }
}

async function handleDownloadExport(card: HTMLElement, token: string): Promise<void> {
  setCardLoading(card, true);

  try {
    const statusRes = await backendFetch('/user/export/status', 'GET', token);
    if (!statusRes.ok) {
      console.error(`[privacy-data] failed to get download token`);
      return;
    }

    const statusData = await statusRes.json() as Record<string, unknown>;
    const downloadToken = (statusData as Record<string, unknown>).download_token as string | undefined;

    if (!downloadToken) {
      console.error(`[privacy-data] no download token in status`);
      return;
    }

    const downloadUrl = `${BACKEND}/user/export/download?token=${encodeURIComponent(downloadToken)}`;
    const a = document.createElement('a');
    a.href = downloadUrl;
    a.download = `relatorio-dados-${new Date().toISOString().split('T')[0]}.pdf`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);

    await new Promise(resolve => setTimeout(resolve, 500));
    await updateExportCardState(card, token);
  } catch (e) {
    console.error('[privacy-data] handleDownloadExport error:', e);
  } finally {
    setCardLoading(card, false);
  }
}

function buildExportCard(token: string): HTMLElement {
  const card = document.createElement('div');
  card.className = 'atenna-privacy__card';

  const title = document.createElement('div');
  title.className = 'atenna-privacy__card-title';
  title.textContent = 'Seus dados';

  const desc = document.createElement('div');
  desc.className = 'atenna-privacy__card-desc';
  desc.textContent = 'Você pode solicitar uma cópia estruturada dos dados associados à sua conta.';

  const statusRow = document.createElement('div');
  statusRow.setAttribute('data-export-status', '');
  statusRow.style.marginTop = '12px';

  const actionRow = document.createElement('div');
  actionRow.setAttribute('data-export-action', '');
  actionRow.style.marginTop = '8px';
  actionRow.style.display = 'flex';
  actionRow.style.justifyContent = 'flex-end';

  card.appendChild(title);
  card.appendChild(desc);
  card.appendChild(statusRow);
  card.appendChild(actionRow);

  void updateExportCardState(card, token);
  return card;
}

async function updateDeletionCardState(card: HTMLElement, token: string): Promise<void> {
  try {
    const res = await backendFetch('/user/deletion/status', 'GET', token);

    if (!res.ok) {
      console.error(`[privacy-data] deletion status failed: ${res.status}`);
      return;
    }

    const data = await res.json() as Record<string, unknown>;
    const hasPending = data.has_pending_request as boolean;
    const status = data.status as string | null;
    const scheduledAt = data.deletion_scheduled_at as string | null;

    const statusEl = card.querySelector('[data-deletion-status]') as HTMLElement;
    const actionEl = card.querySelector('[data-deletion-action]') as HTMLElement;

    if (!statusEl || !actionEl) return;

    if (!hasPending) {
      statusEl.innerHTML = '<div class="atenna-privacy__status-text" style="color: var(--at-muted);">Nenhuma solicitação ativa.</div>';
      actionEl.innerHTML = '<button class="atenna-privacy__btn atenna-privacy__danger-btn">Solicitar exclusão</button>';
      const btn = actionEl.querySelector('button') as HTMLButtonElement;
      btn?.addEventListener('click', () => void handleRequestDeletion(card, token));
    } else if (status === 'pending_confirmation') {
      statusEl.innerHTML = '<div class="atenna-privacy__status-text">Confirmação enviada para seu email.<br><span style="font-size: 11px; color: var(--at-muted);">Esta solicitação pode ser cancelada.</span></div>';
      actionEl.innerHTML = '';
    } else if (status === 'deletion_scheduled') {
      const daysRemaining = formatDaysRemaining(scheduledAt || '');
      const formattedDate = scheduledAt
        ? new Date(scheduledAt).toLocaleDateString('pt-BR')
        : 'data desconhecida';

      statusEl.innerHTML = `<div class="atenna-privacy__status-text">Exclusão agendada para ${formattedDate}.<br><span style="font-size: 11px; color: var(--at-muted);">Restam ${daysRemaining} para cancelar.</span></div>`;
      actionEl.innerHTML = '<button class="atenna-privacy__btn">Cancelar solicitação</button>';
      const btn = actionEl.querySelector('button') as HTMLButtonElement;
      btn?.addEventListener('click', () => void handleCancelDeletion(card, token));
    }
  } catch (e) {
    console.error('[privacy-data] updateDeletionCardState error:', e);
  }
}

async function handleRequestDeletion(card: HTMLElement, token: string): Promise<void> {
  setCardLoading(card, true);

  try {
    const res = await backendFetch('/user/deletion/initiate', 'POST', token);
    if (!res.ok) {
      console.error(`[privacy-data] deletion initiate failed: ${res.status}`);
      return;
    }
    await new Promise(resolve => setTimeout(resolve, 500));
    await updateDeletionCardState(card, token);
  } catch (e) {
    console.error('[privacy-data] handleRequestDeletion error:', e);
  } finally {
    setCardLoading(card, false);
  }
}

async function handleCancelDeletion(card: HTMLElement, token: string): Promise<void> {
  setCardLoading(card, true);

  try {
    const res = await backendFetch('/user/deletion/cancel', 'POST', token);
    if (!res.ok) {
      console.error(`[privacy-data] deletion cancel failed: ${res.status}`);
      return;
    }
    await new Promise(resolve => setTimeout(resolve, 500));
    await updateDeletionCardState(card, token);
  } catch (e) {
    console.error('[privacy-data] handleCancelDeletion error:', e);
  } finally {
    setCardLoading(card, false);
  }
}

function buildDeletionCard(token: string): HTMLElement {
  const card = document.createElement('div');
  card.className = 'atenna-privacy__card';
  card.style.borderTop = '1px solid var(--at-border)';

  const title = document.createElement('div');
  title.className = 'atenna-privacy__card-title';
  title.textContent = 'Exclusão de conta';

  const desc = document.createElement('div');
  desc.className = 'atenna-privacy__card-desc';
  desc.textContent = 'Solicitações de exclusão possuem período de reversão de 7 dias.';

  const statusRow = document.createElement('div');
  statusRow.setAttribute('data-deletion-status', '');
  statusRow.style.marginTop = '12px';

  const actionRow = document.createElement('div');
  actionRow.setAttribute('data-deletion-action', '');
  actionRow.style.marginTop = '8px';
  actionRow.style.display = 'flex';
  actionRow.style.justifyContent = 'flex-end';

  card.appendChild(title);
  card.appendChild(desc);
  card.appendChild(statusRow);
  card.appendChild(actionRow);

  void updateDeletionCardState(card, token);
  return card;
}

export function renderPrivacyDataSection(session: Session, _pro: boolean): HTMLElement {
  const section = document.createElement('div');
  section.className = 'atenna-privacy';

  const exportCard = buildExportCard(session.access_token);
  const deletionCard = buildDeletionCard(session.access_token);

  section.appendChild(exportCard);
  section.appendChild(deletionCard);

  return section;
}
