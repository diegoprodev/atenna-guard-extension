/**
 * FASE 3.1B-UI: Privacy Data Governance Component
 * - Export request, confirmation, download
 * - Account deletion request, grace period, cancellation
 * - State-driven rendering (idle, requested, ready, scheduled, etc.)
 */

const BACKEND_URL = 'https://atennaplugin.maestro-n8n.site';

// ─── Authenticated fetch helper ────────────────────────────
async function backendFetch(
  path: string,
  method: 'GET' | 'POST',
  token: string,
  body?: unknown,
): Promise<Response> {
  const opts: RequestInit = {
    method,
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
  };
  if (body) opts.body = JSON.stringify(body);
  return fetch(`${BACKEND_URL}${path}`, opts);
}

// ─── Render main privacy section ────────────────────────────
export function renderPrivacyDataSection(
  session: { email: string; access_token: string },
  pro: boolean,
): HTMLElement {
  const container = document.createElement('div');
  container.className = 'atenna-privacy';

  // Export Card
  const exportCard = buildExportCard(session.access_token, session.email);
  container.appendChild(exportCard);

  // Deletion Card
  const deletionCard = buildDeletionCard(session.access_token, session.email);
  container.appendChild(deletionCard);

  // Load initial state async
  void updateExportCardState(exportCard, session.access_token);
  void updateDeletionCardState(deletionCard, session.access_token);

  return container;
}

// ─── Build Export Card ────────────────────────────────────────
function buildExportCard(token: string, email: string): HTMLElement {
  const card = document.createElement('div');
  card.className = 'atenna-privacy__card';
  card.dataset.cardType = 'export';

  const title = document.createElement('div');
  title.className = 'atenna-privacy__card-title';
  title.textContent = 'Seus dados';

  const desc = document.createElement('div');
  desc.className = 'atenna-privacy__card-desc';
  desc.textContent = 'Você pode solicitar uma cópia estruturada dos dados associados à sua conta.';

  const status = document.createElement('div');
  status.className = 'atenna-privacy__status-row';
  status.innerHTML = `
    <span class="atenna-privacy__status-dot" style="background: #d1d5db;"></span>
    <span class="atenna-privacy__status-text">Carregando...</span>
  `;

  const actions = document.createElement('div');
  actions.className = 'atenna-privacy__actions';

  const requestBtn = document.createElement('button');
  requestBtn.className = 'atenna-privacy__btn';
  requestBtn.textContent = 'Solicitar relatório';
  requestBtn.addEventListener('click', () => {
    requestBtn.disabled = true;
    void handleRequestExport(card, token, email, requestBtn);
  });
  actions.appendChild(requestBtn);

  card.appendChild(title);
  card.appendChild(desc);
  card.appendChild(status);
  card.appendChild(actions);

  // Store references
  (card as any)._statusEl = status;
  (card as any)._actionsEl = actions;
  (card as any)._requestBtn = requestBtn;

  return card;
}

// ─── Build Deletion Card ──────────────────────────────────────
function buildDeletionCard(token: string, email: string): HTMLElement {
  const card = document.createElement('div');
  card.className = 'atenna-privacy__card';
  card.dataset.cardType = 'deletion';

  const title = document.createElement('div');
  title.className = 'atenna-privacy__card-title';
  title.textContent = 'Exclusão de conta';

  const desc = document.createElement('div');
  desc.className = 'atenna-privacy__card-desc';
  desc.textContent = 'Solicitações de exclusão possuem período de reversão de 7 dias.';

  const status = document.createElement('div');
  status.className = 'atenna-privacy__status-row';
  status.innerHTML = `
    <span class="atenna-privacy__status-dot" style="background: #d1d5db;"></span>
    <span class="atenna-privacy__status-text">Carregando...</span>
  `;

  const actions = document.createElement('div');
  actions.className = 'atenna-privacy__actions';

  const requestBtn = document.createElement('button');
  requestBtn.className = 'atenna-privacy__btn';
  requestBtn.textContent = 'Solicitar exclusão';
  requestBtn.addEventListener('click', () => {
    requestBtn.disabled = true;
    void handleRequestDeletion(card, token, email, requestBtn);
  });
  actions.appendChild(requestBtn);

  card.appendChild(title);
  card.appendChild(desc);
  card.appendChild(status);
  card.appendChild(actions);

  // Store references
  (card as any)._statusEl = status;
  (card as any)._actionsEl = actions;
  (card as any)._requestBtn = requestBtn;

  return card;
}

// ─── Update Export Card State ──────────────────────────────────
async function updateExportCardState(card: HTMLElement, token: string): Promise<void> {
  const statusEl = (card as any)._statusEl as HTMLElement;
  const actionsEl = (card as any)._actionsEl as HTMLElement;
  const requestBtn = (card as any)._requestBtn as HTMLButtonElement;

  try {
    const response = await backendFetch('/user/export/status', 'GET', token);
    if (!response.ok) {
      statusEl.innerHTML = `
        <span class="atenna-privacy__status-dot" style="background: #d1d5db;"></span>
        <span class="atenna-privacy__status-text">Nenhuma solicitação ativa.</span>
      `;
      requestBtn.disabled = false;
      return;
    }

    const status = await response.json();

    if (!status.has_pending_request) {
      // idle
      statusEl.innerHTML = `
        <span class="atenna-privacy__status-dot" style="background: #d1d5db;"></span>
        <span class="atenna-privacy__status-text">Nenhuma solicitação ativa.</span>
      `;
      requestBtn.disabled = false;
      requestBtn.textContent = 'Solicitar relatório';
    } else if (status.status === 'requested') {
      // waiting for confirmation
      statusEl.innerHTML = `
        <span class="atenna-privacy__status-dot" style="background: #f59e0b;"></span>
        <span class="atenna-privacy__status-text">Confirmação enviada para seu email. Verifique sua caixa de entrada.</span>
      `;
      requestBtn.disabled = true;
      requestBtn.textContent = 'Aguardando confirmação...';
    } else if (status.status === 'processing' || status.status === 'ready') {
      // processing or ready for download
      const expiresAt = new Date(status.expires_at);
      const now = new Date();
      const hoursLeft = Math.ceil((expiresAt.getTime() - now.getTime()) / (1000 * 60 * 60));

      statusEl.innerHTML = `
        <span class="atenna-privacy__status-dot" style="background: #22c55e;"></span>
        <span class="atenna-privacy__status-text">Relatório disponível.</span>
      `;

      const meta = document.createElement('div');
      meta.className = 'atenna-privacy__meta';
      meta.textContent = `Disponível por mais ${hoursLeft}h • ${status.download_count}/${status.max_downloads} downloads`;
      statusEl.appendChild(meta);

      // Replace button with download
      actionsEl.innerHTML = '';
      const downloadBtn = document.createElement('button');
      downloadBtn.className = 'atenna-privacy__btn';
      downloadBtn.textContent = 'Fazer download';
      downloadBtn.addEventListener('click', () => {
        void handleDownloadExport(card, token, status.download_token);
      });
      actionsEl.appendChild(downloadBtn);
    } else if (status.status === 'expired') {
      // expired
      statusEl.innerHTML = `
        <span class="atenna-privacy__status-dot" style="background: #ef4444;"></span>
        <span class="atenna-privacy__status-text">Este relatório expirou.</span>
      `;
      actionsEl.innerHTML = '';
      requestBtn.disabled = false;
      requestBtn.textContent = 'Solicitar novo';
      actionsEl.appendChild(requestBtn);
    }
  } catch {
    statusEl.innerHTML = `
      <span class="atenna-privacy__status-dot" style="background: #d1d5db;"></span>
      <span class="atenna-privacy__status-text">Nenhuma solicitação ativa.</span>
    `;
    requestBtn.disabled = false;
  }
}

// ─── Update Deletion Card State ────────────────────────────────
async function updateDeletionCardState(card: HTMLElement, token: string): Promise<void> {
  const statusEl = (card as any)._statusEl as HTMLElement;
  const actionsEl = (card as any)._actionsEl as HTMLElement;
  const requestBtn = (card as any)._requestBtn as HTMLButtonElement;

  try {
    const response = await backendFetch('/user/deletion/status', 'GET', token);
    if (!response.ok) {
      statusEl.innerHTML = `
        <span class="atenna-privacy__status-dot" style="background: #d1d5db;"></span>
        <span class="atenna-privacy__status-text">Nenhuma solicitação ativa.</span>
      `;
      requestBtn.disabled = false;
      return;
    }

    const status = await response.json();

    if (!status.has_pending_request) {
      // idle
      statusEl.innerHTML = `
        <span class="atenna-privacy__status-dot" style="background: #d1d5db;"></span>
        <span class="atenna-privacy__status-text">Nenhuma solicitação ativa.</span>
      `;
      requestBtn.disabled = false;
      requestBtn.textContent = 'Solicitar exclusão';
    } else if (status.status === 'pending_confirmation') {
      // waiting for email confirmation
      statusEl.innerHTML = `
        <span class="atenna-privacy__status-dot" style="background: #f59e0b;"></span>
        <span class="atenna-privacy__status-text">Confirmação enviada para seu email. Esta solicitação pode ser cancelada.</span>
      `;
      requestBtn.disabled = true;
      requestBtn.textContent = 'Aguardando confirmação...';
    } else if (status.status === 'deletion_scheduled') {
      // grace period active
      const scheduledDate = new Date(status.scheduled_deletion_at);
      const now = new Date();
      const daysLeft = Math.ceil((scheduledDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
      const formattedDate = scheduledDate.toLocaleDateString('pt-BR');

      statusEl.innerHTML = `
        <span class="atenna-privacy__status-dot" style="background: #ef4444;"></span>
        <span class="atenna-privacy__status-text">Exclusão agendada para ${formattedDate}.</span>
      `;

      const meta = document.createElement('div');
      meta.className = 'atenna-privacy__meta';
      meta.textContent = `Restam ${daysLeft} dias para cancelar.`;
      statusEl.appendChild(meta);

      // Replace with cancel button
      actionsEl.innerHTML = '';
      const cancelBtn = document.createElement('button');
      cancelBtn.className = 'atenna-privacy__danger-btn';
      cancelBtn.textContent = 'Cancelar solicitação';
      cancelBtn.addEventListener('click', () => {
        void handleCancelDeletion(card, token, cancelBtn);
      });
      actionsEl.appendChild(cancelBtn);
    }
  } catch {
    statusEl.innerHTML = `
      <span class="atenna-privacy__status-dot" style="background: #d1d5db;"></span>
      <span class="atenna-privacy__status-text">Nenhuma solicitação ativa.</span>
    `;
    requestBtn.disabled = false;
  }
}

// ─── Handle Request Export ─────────────────────────────────────
async function handleRequestExport(
  card: HTMLElement,
  token: string,
  email: string,
  button: HTMLButtonElement,
): Promise<void> {
  try {
    const response = await backendFetch('/user/export/request', 'POST', token);

    if (response.ok) {
      // Success - update state to "requested"
      const statusEl = (card as any)._statusEl as HTMLElement;
      statusEl.innerHTML = `
        <span class="atenna-privacy__status-dot" style="background: #f59e0b;"></span>
        <span class="atenna-privacy__status-text">Confirmação enviada para ${email}. Verifique sua caixa de entrada.</span>
      `;
      button.disabled = true;
      button.textContent = 'Aguardando confirmação...';
    } else {
      const err = await response.json();
      alert(`Erro: ${err.message || 'Falha ao solicitar export'}`);
      button.disabled = false;
    }
  } catch (err) {
    alert('Erro de conexão. Tente novamente.');
    button.disabled = false;
  }
}

// ─── Handle Download Export ────────────────────────────────────
async function handleDownloadExport(
  card: HTMLElement,
  token: string,
  downloadToken: string,
): Promise<void> {
  try {
    const response = await backendFetch(
      `/user/export/download?token=${encodeURIComponent(downloadToken)}`,
      'GET',
      token,
    );

    if (response.ok) {
      // Trigger download
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `relatorio_dados_${Date.now()}.pdf`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      window.URL.revokeObjectURL(url);

      // Refresh card state
      const accessToken = token;
      void updateExportCardState(card, accessToken);
    } else {
      const err = await response.json();
      alert(`Erro: ${err.message || 'Falha ao fazer download'}`);
    }
  } catch (err) {
    alert('Erro de conexão. Tente novamente.');
  }
}

// ─── Handle Request Deletion ───────────────────────────────────
async function handleRequestDeletion(
  card: HTMLElement,
  token: string,
  email: string,
  button: HTMLButtonElement,
): Promise<void> {
  try {
    const response = await backendFetch('/user/deletion/initiate', 'POST', token);

    if (response.ok) {
      // Success - update state to "pending_confirmation"
      const statusEl = (card as any)._statusEl as HTMLElement;
      statusEl.innerHTML = `
        <span class="atenna-privacy__status-dot" style="background: #f59e0b;"></span>
        <span class="atenna-privacy__status-text">Confirmação enviada para ${email}. Esta solicitação pode ser cancelada.</span>
      `;
      button.disabled = true;
      button.textContent = 'Aguardando confirmação...';
    } else {
      const err = await response.json();
      alert(`Erro: ${err.message || 'Falha ao solicitar exclusão'}`);
      button.disabled = false;
    }
  } catch (err) {
    alert('Erro de conexão. Tente novamente.');
    button.disabled = false;
  }
}

// ─── Handle Cancel Deletion ────────────────────────────────────
async function handleCancelDeletion(
  card: HTMLElement,
  token: string,
  button: HTMLButtonElement,
): Promise<void> {
  const confirmed = window.confirm(
    'Tem certeza que deseja cancelar a solicitação de exclusão da conta?',
  );
  if (!confirmed) return;

  button.disabled = true;
  button.textContent = 'Cancelando...';

  try {
    const response = await backendFetch('/user/deletion/cancel', 'POST', token);

    if (response.ok) {
      // Success - back to idle state
      const statusEl = (card as any)._statusEl as HTMLElement;
      const actionsEl = (card as any)._actionsEl as HTMLElement;
      statusEl.innerHTML = `
        <span class="atenna-privacy__status-dot" style="background: #22c55e;"></span>
        <span class="atenna-privacy__status-text">Solicitação de exclusão cancelada.</span>
      `;
      actionsEl.innerHTML = '';
      const newBtn = document.createElement('button');
      newBtn.className = 'atenna-privacy__btn';
      newBtn.textContent = 'Solicitar exclusão';
      newBtn.addEventListener('click', () => {
        newBtn.disabled = true;
        void handleRequestDeletion(card, token, '', newBtn);
      });
      actionsEl.appendChild(newBtn);
    } else {
      const err = await response.json();
      alert(`Erro: ${err.message || 'Falha ao cancelar exclusão'}`);
      button.disabled = false;
      button.textContent = 'Cancelar solicitação';
    }
  } catch (err) {
    alert('Erro de conexão. Tente novamente.');
    button.disabled = false;
    button.textContent = 'Cancelar solicitação';
  }
}
