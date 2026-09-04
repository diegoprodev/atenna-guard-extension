/**
 * FASE 3.1B — Privacy & Data Governance UI
 *
 * Two-card interface for user data export and account deletion requests.
 * All operations require authentication and follow LGPD Art. 17 (right to be forgotten).
 */

import { BFF_BASE } from '../config';

interface Session {
  email: string;
  access_token: string;
}

const BACKEND = BFF_BASE;

function safeText(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

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
  if (body) options.body = JSON.stringify(body);

  // Tenta fetch direto primeiro
  try {
    return await fetch(url, options);
  } catch {
    // CSP/ServiceWorker da plataforma bloqueou — roteia pelo background
  }

  return new Promise((resolve, reject) => {
    try {
      chrome.runtime.sendMessage(
        { type: 'ATENNA_PROXY_FETCH', url, method, token, body },
        (resp: { ok: boolean; status: number; body?: string; error?: string } | undefined) => {
          if (chrome.runtime.lastError || !resp) {
            reject(new Error(chrome.runtime.lastError?.message ?? 'proxy unavailable'));
            return;
          }
          // Reconstrói um objeto Response a partir da resposta do background
          const responseBody = resp.body ?? '';
          resolve(new Response(responseBody, {
            status: resp.status,
            headers: { 'Content-Type': 'application/json' },
          }));
        },
      );
    } catch (e) {
      reject(e);
    }
  });
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

/**
 * Mostra uma mensagem no card. NUNCA falhar em silêncio — a regra do produto é
 * "jamais um erro só no console". `kind` controla a cor.
 */
function showCardMessage(card: HTMLElement, msg: string, kind: 'error' | 'ok' | 'info' = 'error'): void {
  const statusEl = card.querySelector('[data-export-status], [data-deletion-status]') as HTMLElement | null;
  if (!statusEl) return;
  const color = kind === 'error' ? 'var(--at-danger, #B23A30)'
    : kind === 'ok' ? 'var(--at-accent, #0B6E4B)'
    : 'var(--at-text)';
  statusEl.innerHTML = `<div class="atenna-privacy__status-text" style="color:${color}">${safeText(msg)}</div>`;
}

/** Traduz uma resposta de erro do backend numa frase pt-BR pro usuário. */
async function friendlyBackendError(res: Response): Promise<string> {
  let detail = '';
  try {
    const body = await res.clone().json() as { detail?: unknown };
    detail = typeof body.detail === 'string' ? body.detail : JSON.stringify(body.detail ?? '');
  } catch { /* corpo não-JSON */ }
  const d = detail.toLowerCase();
  if (res.status === 401 || res.status === 403) return 'Sua sessão expirou. Saia e entre de novo.';
  if (d.includes('already has an active export')) return 'Você já tem um relatório em preparo. Verifique seu email — enviamos o link de confirmação.';
  if (d.includes('already') && d.includes('deletion')) return 'Você já tem uma solicitação de exclusão em andamento.';
  if (res.status === 429) return 'Muitas tentativas. Aguarde um minuto e tente de novo.';
  if (res.status >= 500) return 'O serviço está instável agora. Tente de novo em alguns minutos.';
  return 'Não foi possível concluir. Tente de novo em instantes.';
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
      statusEl.innerHTML = '<div class="atenna-privacy__status-text">Confirmação enviada para seu email.<br><span style="font-size: 11px; color: var(--at-muted);">Verifique a caixa de entrada e o spam.</span></div>';
      actionEl.innerHTML = '<button class="atenna-privacy__btn">Reenviar email</button>';
      actionEl.querySelector('button')?.addEventListener('click',
        () => void handleResend(card, token, '/user/export/resend'));
    } else if (status === 'ready') {
      const remaining = formatTimeRemaining(expiresAt || '');
      const downloads = `${downloadCount} download${(downloadCount ?? 0) !== 1 ? 's' : ''} restante${(downloadCount ?? 0) !== 1 ? 's' : ''}`;
      statusEl.innerHTML = `<div class="atenna-privacy__status-text">Relatório disponível.<br><span style="font-size: 11px; color: var(--at-muted);">Disponível por mais ${safeText(remaining)} · ${safeText(downloads)}</span></div>`;
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

/** Reenvia o e-mail de confirmação (export ou exclusão) — B: "deve ter opção de reenviar". */
async function handleResend(card: HTMLElement, token: string, path: string): Promise<void> {
  setCardLoading(card, true);
  try {
    const res = await backendFetch(path, 'POST', token);
    const body = await res.json().catch(() => ({})) as { message?: string; email_sent?: boolean };
    if (!res.ok) {
      showCardMessage(card, await friendlyBackendError(res));
      return;
    }
    showCardMessage(card, body.message ?? 'Email reenviado. Verifique a caixa de entrada e o spam.',
      body.email_sent === false ? 'error' : 'ok');
  } catch {
    showCardMessage(card, 'Sem conexão. Verifique sua internet e tente de novo.');
  } finally {
    setCardLoading(card, false);
  }
}

async function handleRequestExport(card: HTMLElement, token: string): Promise<void> {
  setCardLoading(card, true);

  try {
    const res = await backendFetch('/user/export/request', 'POST', token);
    if (!res.ok) {
      console.error(`[privacy-data] export request failed: ${res.status}`);
      showCardMessage(card, await friendlyBackendError(res));
      return;
    }
    showCardMessage(card, 'Enviamos um email de confirmação. Clique no link para gerar o relatório.', 'ok');
    await new Promise(resolve => setTimeout(resolve, 500));
    await updateExportCardState(card, token);
  } catch (e) {
    console.error('[privacy-data] handleRequestExport error:', e);
    showCardMessage(card, 'Sem conexão. Verifique sua internet e tente de novo.');
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
      showCardMessage(card, await friendlyBackendError(statusRes));
      return;
    }

    const statusData = await statusRes.json() as Record<string, unknown>;
    const downloadToken = (statusData as Record<string, unknown>).download_token as string | undefined;

    if (!downloadToken) {
      console.error(`[privacy-data] no download token in status`);
      showCardMessage(card, 'O relatório ainda não está pronto. Você recebe um email quando estiver.');
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
    showCardMessage(card, 'Não foi possível baixar agora. Tente de novo em instantes.');
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
  // botão padrão (otimista) — updateExportCardState só o substitui se houver
  // solicitação pendente; se o backend falhar, o botão continua clicável.
  actionRow.innerHTML = '<button class="atenna-privacy__btn">Solicitar relatório</button>';
  actionRow.querySelector('button')?.addEventListener('click', () => void handleRequestExport(card, token));

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
      statusEl.innerHTML = '<div class="atenna-privacy__status-text">Confirmação enviada para seu email.<br><span style="font-size: 11px; color: var(--at-muted);">Verifique a caixa de entrada e o spam. Nada acontece sem você confirmar.</span></div>';
      actionEl.innerHTML = '<button class="atenna-privacy__btn">Reenviar email</button>';
      actionEl.querySelector('button')?.addEventListener('click',
        () => void handleResend(card, token, '/user/deletion/resend'));
    } else if (status === 'deletion_scheduled') {
      const daysRemaining = formatDaysRemaining(scheduledAt || '');
      const formattedDate = scheduledAt
        ? new Date(scheduledAt).toLocaleDateString('pt-BR')
        : 'data desconhecida';

      statusEl.innerHTML = `<div class="atenna-privacy__status-text">Exclusão agendada para ${safeText(formattedDate)}.<br><span style="font-size: 11px; color: var(--at-muted);">Restam ${safeText(daysRemaining)} para cancelar.</span></div>`;
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
      showCardMessage(card, await friendlyBackendError(res));
      return;
    }
    showCardMessage(card, 'Enviamos um email de confirmação. A exclusão só começa depois que você confirmar.', 'ok');
    await new Promise(resolve => setTimeout(resolve, 500));
    await updateDeletionCardState(card, token);
  } catch (e) {
    console.error('[privacy-data] handleRequestDeletion error:', e);
    showCardMessage(card, 'Sem conexão. Verifique sua internet e tente de novo.');
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
      showCardMessage(card, await friendlyBackendError(res));
      return;
    }
    showCardMessage(card, 'Solicitação de exclusão cancelada.', 'ok');
    await new Promise(resolve => setTimeout(resolve, 500));
    await updateDeletionCardState(card, token);
  } catch (e) {
    console.error('[privacy-data] handleCancelDeletion error:', e);
    showCardMessage(card, 'Sem conexão. Verifique sua internet e tente de novo.');
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
  // botão padrão (otimista) — ver comentário no card de exportação
  actionRow.innerHTML = '<button class="atenna-privacy__btn atenna-privacy__danger-btn">Solicitar exclusão</button>';
  actionRow.querySelector('button')?.addEventListener('click', () => void handleRequestDeletion(card, token));

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
