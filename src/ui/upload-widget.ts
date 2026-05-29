import { trackEvent } from '../core/analytics';
import { isPro } from '../core/planManager';
import { getSession } from '../auth/sessionManager';

import { sk } from '../core/scopedStorage';

const UPLOAD_LIMIT_FREE = 5;
const UPLOAD_COUNT_KEY  = 'atenna_upload_count';

const LOADING_PHRASES = [
  'Lendo documento…',
  'Verificando dados sensíveis…',
  'Analisando conteúdo…',
  'Identificando entidades…',
  'Um momento…',
  'Quase pronto…',
];

const PROGRESS_MESSAGES: Array<{ after: number; text: string }> = [
  { after: 5,  text: 'Analisando estrutura do documento…' },
  { after: 15, text: 'Extraindo texto e tabelas…' },
  { after: 30, text: 'Processando com OCR avançado…' },
  { after: 50, text: 'Documento grande — quase lá…' },
  { after: 80, text: 'Finalizando análise de dados sensíveis…' },
];

async function getUploadUsage(): Promise<number> {
  return new Promise(resolve => {
    try {
      const key = sk(UPLOAD_COUNT_KEY);
      chrome.storage.local.get(key, r => {
        const data = r[key] as { count: number; date: string } | undefined;
        const today = new Date().toISOString().slice(0, 10);
        if (!data || data.date !== today) { resolve(0); return; }
        resolve(data.count);
      });
    } catch { resolve(0); }
  });
}

async function incrementUploadUsage(): Promise<number> {
  const current = await getUploadUsage();
  const next = current + 1;
  const today = new Date().toISOString().slice(0, 10);
  return new Promise(resolve => {
    try {
      chrome.storage.local.set({ [sk(UPLOAD_COUNT_KEY)]: { count: next, date: today } }, () => resolve(next));
    } catch { resolve(next); }
  });
}

export interface UploadWidgetConfig {
  targetElement: HTMLElement;
  maxSize: Record<string, number>;
  userName?: string;
  onReady: (content: string, preview: string, riskLevel: string, rewritten?: string, fileName?: string) => void;
  onError: (error: string) => void;
  onCancel: () => void;
  onUpgrade?: (plan: 'yearly' | 'monthly') => void;
}

interface ProtectPayload {
  masked_text: string;
  risk_level: string;
  findings: Array<{ entity_type: string; count: number; value?: string | null }>;
  findings_count: number;
  blocked: boolean;
  char_count: number;
}

interface UploadState {
  phase: 'loading' | 'ready' | 'error' | 'quota';
  _rawError?: string;
  file?: File;
  dlpRisk?: 'NONE' | 'LOW' | 'MEDIUM' | 'HIGH';
  findings?: Array<{ entity_type: string; count: number; value?: string | null }>;
  extractedContent?: string;
  originalContent?: string;
  isBinary?: boolean;
  error?: string;
}

const FILE_EXTENSIONS: Record<string, string> = {
  txt:  'text/plain',
  md:   'text/markdown',
  csv:  'text/csv',
  json: 'application/json',
  pdf:  'application/pdf',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  doc:  'application/msword',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  xls:  'application/vnd.ms-excel',
};

const BINARY_TYPES = new Set(['pdf', 'docx', 'doc', 'xlsx', 'xls', 'csv']);

const ENTITY_LABELS: Record<string, string> = {
  CPF: 'CPF', CNPJ: 'CNPJ', RG: 'RG', EMAIL: 'E-mail',
  PHONE: 'Telefone', CREDIT_CARD: 'Cartão de crédito',
  API_KEY: 'Chave de API', JWT: 'Token JWT', SECRET: 'Segredo',
  TOKEN: 'Token', BANK_ACCOUNT: 'Conta bancária', PIX: 'Chave Pix',
  NAME: 'Nome', ADDRESS: 'Endereço', MEDICAL_DATA: 'Dado de saúde',
  PASSPORT: 'Passaporte', PIS_PASEP: 'PIS/PASEP', TITULO_ELEITOR: 'Título de eleitor',
  VEHICLE_PLATE: 'Placa veicular', PROCESS_NUMBER: 'Número de processo',
  LEGAL_CONTEXT: 'Contexto jurídico', CONFIDENTIAL_DOCUMENT: 'Documento confidencial',
};

export class UploadWidget {
  private config: UploadWidgetConfig;
  private state: UploadState = { phase: 'loading' };
  private container: HTMLElement;
  private phraseInterval?: ReturnType<typeof setInterval>;
  private progressInterval?: ReturnType<typeof setInterval>;

  constructor(config: UploadWidgetConfig) {
    this.config = config;
    this.container = config.targetElement;
  }

  handleFileSelect(file: File): void {
    const validation = this.validateFile(file);
    if (!validation.valid) {
      this.state = { phase: 'error', error: validation.error };
      this.render();
      return;
    }
    this.state = { phase: 'loading', file };
    this.render();
    this.checkLimitThenUpload(file).catch(err => {
      this.state = { phase: 'error', file, error: err instanceof Error ? err.message : String(err) };
      this.render();
    });
  }

  private validateFile(file: File): { valid: boolean; error?: string } {
    const ext = file.name.split('.').pop()?.toLowerCase();
    if (!ext || !FILE_EXTENSIONS[ext]) {
      return { valid: false, error: 'Tipo não suportado. Formatos aceitos: PDF, DOCX, Excel, CSV, TXT, JSON' };
    }
    const maxBytes = BINARY_TYPES.has(ext) ? 100 * 1024 * 1024 : 10 * 1024 * 1024;
    if (file.size > maxBytes) {
      return { valid: false, error: `Arquivo muito grande. Máximo: ${maxBytes / (1024 * 1024)} MB` };
    }
    return { valid: true };
  }

  private async checkLimitThenUpload(file: File): Promise<void> {
    // Upload não tem cota própria — segue a cota de prompts do fluxo chamador.
    // Bloquear upload separadamente confunde o usuário que ainda tem gerações restantes.
    return this.uploadFile(file);
  }

  private async uploadFile(file: File): Promise<void> {
    const ext = file.name.split('.').pop()?.toLowerCase() || 'txt';
    try {
      // Todos os tipos usam /document/protect — retorna texto completo mascarado
      const payload = await this.protectViaBackend(file);
      const risk = (payload.risk_level as 'NONE' | 'LOW' | 'MEDIUM' | 'HIGH') || 'NONE';
      this.state = {
        phase: 'ready',
        file,
        dlpRisk: risk,
        findings: payload.findings,
        extractedContent: payload.masked_text, // texto completo com PII substituída
        isBinary: BINARY_TYPES.has(ext),
      };
      this.render();
      void trackEvent('document_upload_success', { file_type: ext, dlp_risk: risk, chars: payload.char_count });
    } catch (err) {
      const raw = err instanceof Error ? err.message : String(err);
      const msg = this.friendlyError(raw);
      this.state = { phase: 'error', file, error: msg, _rawError: raw };
      this.render();
      void trackEvent('document_upload_error', { error: raw });
    }
  }

  private async protectViaBackend(file: File): Promise<ProtectPayload> {
    const token = await this.getAuthToken();
    if (!token) throw new Error('Sessão expirada. Faça login novamente.');

    // Converte para base64 antes de enviar pelo background (ArrayBuffer corrompe em
    // mensagens grandes via structured clone; base64 string é sempre seguro)
    const arrayBuf = await file.arrayBuffer();
    const uint8 = new Uint8Array(arrayBuf);
    let binary = '';
    for (let i = 0; i < uint8.length; i++) binary += String.fromCharCode(uint8[i]);
    const fileBase64 = btoa(binary);

    return new Promise((resolve, reject) => {
      const timeoutId = setTimeout(() => reject(new Error('timeout')), 270_000);

      try {
        chrome.runtime.sendMessage(
          {
            type: 'ATENNA_PROTECT_FILE',
            fileBase64,
            fileName: file.name,
            mimeType: file.type || 'application/octet-stream',
            token,
          },
          (resp: { ok: boolean; status: number; body?: string; error?: string } | undefined) => {
            clearTimeout(timeoutId);
            if (chrome.runtime.lastError || !resp) {
              reject(new Error('network'));
              return;
            }
            if (!resp.ok) {
              const detail = resp.body ? (() => { try { return (JSON.parse(resp.body!) as { detail?: string }).detail ?? ''; } catch { return resp.body!.slice(0, 120); } })() : '';
              reject(new Error(`server:${resp.status}:${detail}`));
              return;
            }
            try {
              resolve(JSON.parse(resp.body!) as ProtectPayload);
            } catch {
              reject(new Error('server:parse:resposta inválida do servidor'));
            }
          },
        );
      } catch (e) {
        clearTimeout(timeoutId);
        reject(new Error('network'));
      }
    });
  }

  private async readFile(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = () => reject(new Error('Falha ao ler arquivo'));
      reader.readAsText(file, 'utf-8');
    });
  }

  private isValidUtf8(str: string): boolean {
    try {
      new TextDecoder('utf-8', { fatal: true }).decode(new TextEncoder().encode(str));
      return true;
    } catch { return false; }
  }

  private normalizeText(raw: string, ext: string): string {
    let c = raw.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, ' ').trim();
    if (c.charCodeAt(0) === 0xFEFF) c = c.slice(1);
    if (ext === 'json') { try { c = JSON.stringify(JSON.parse(c), null, 2); } catch { /* keep as-is */ } }
    if (ext === 'md') c = c.replace(/\n\n\n+/g, '\n\n');
    return c;
  }

  private get backendUrl(): string { return 'https://atennaplugin.maestro-n8n.site'; }

  private async getAuthToken(): Promise<string | null> {
    // BFF session (new auth system) — returns opaque token accepted by all backend routes
    try {
      const session = await getSession();
      if (session?.token) return session.token;
    } catch { /* fall through */ }

    // Fallback: ask background service worker (handles cross-context access)
    return new Promise(resolve => {
      try {
        chrome.runtime.sendMessage({ type: 'GET_BFF_TOKEN' }, (resp) => {
          if (chrome.runtime.lastError) { resolve(null); return; }
          resolve((resp as { token?: string })?.token ?? null);
        });
      } catch { resolve(null); }
    });
  }

  private friendlyError(raw: string): string {
    if (raw === 'timeout') return 'O processamento demorou mais que o esperado. Tente novamente — PDFs grandes com OCR podem levar até 2 minutos.';
    if (raw === 'network') return 'Não foi possível conectar ao servidor. Verifique sua conexão e tente novamente.';
    if (raw.startsWith('server:429')) return 'Limite de OCR atingido momentaneamente. Aguarde alguns instantes e tente novamente.';
    if (raw.startsWith('server:401') || raw === 'Sessão expirada. Faça login novamente.') return 'Sessão expirada. Saia e entre novamente para continuar.';
    if (raw.startsWith('server:403')) return 'Você não tem permissão para esta ação. Verifique seu plano.';
    if (raw.startsWith('server:400')) return 'Arquivo não reconhecido ou corrompido. Tente com outro arquivo.';
    if (raw.startsWith('server:413')) return 'Arquivo muito grande. O limite é 100 MB.';
    if (raw.startsWith('server:5') || raw.startsWith('server:502') || raw.startsWith('server:503')) return 'Ocorreu um erro em nossos servidores. Estamos cientes e trabalhando na correção.';
    if (raw.startsWith('server:')) return 'Erro inesperado ao processar o arquivo. Tente novamente.';
    return 'Não foi possível processar o arquivo. Tente novamente.';
  }

  // ── Render ────────────────────────────────────────────────────────────────

  render(): void {
    if (this.phraseInterval) { clearInterval(this.phraseInterval); this.phraseInterval = undefined; }
    if (this.progressInterval) { clearInterval(this.progressInterval); this.progressInterval = undefined; }
    this.container.innerHTML = '';
    this.container.className = 'atenna-upw';

    // Privacy notice at the top (appears on all phases)
    if (this.state.phase === 'loading') {
      const privacyNotice = document.createElement('div');
      privacyNotice.className = 'atenna-upw__privacy-notice';
      privacyNotice.style.cssText = [
        'font-size:12px', 'color:var(--at-text-muted,#888)', 'margin-bottom:12px',
        'line-height:1.4', 'text-align:center',
      ].join(';');
      privacyNotice.textContent = 'Seus dados são processados de forma segura. Nenhum arquivo é armazenado em nossos servidores.';
      this.container.appendChild(privacyNotice);
    }

    if (this.state.phase === 'loading') this.renderLoading();
    else if (this.state.phase === 'quota') this.renderQuota();
    else if (this.state.phase === 'error') this.renderError();
    else this.renderReady();
  }

  private renderLoading(): void {
    const wrap = document.createElement('div');
    wrap.className = 'atenna-upw__loading';

    // ── Orbit animation ──────────────────────────────────────
    const orbit = document.createElement('div');
    orbit.className = 'atenna-upw__orbit';

    const logoWrap = document.createElement('div');
    logoWrap.className = 'atenna-upw__orbit-logo';
    const logoImg = document.createElement('img');
    try { logoImg.src = chrome.runtime.getURL('icons/icon32.png'); } catch { logoImg.src = ''; }
    logoImg.alt = '';
    logoWrap.appendChild(logoImg);

    const ring = document.createElement('div');
    ring.className = 'atenna-upw__orbit-ring';
    const orbitDot = document.createElement('span');
    orbitDot.className = 'atenna-upw__orbit-dot';
    ring.appendChild(orbitDot);

    orbit.appendChild(logoWrap);
    orbit.appendChild(ring);
    wrap.appendChild(orbit);

    // ── File name ─────────────────────────────────────────────
    if (this.state.file) {
      const fname = document.createElement('div');
      fname.className = 'atenna-upw__fname';
      fname.textContent = this.state.file.name;
      wrap.appendChild(fname);
    }

    // ── Progress bar ─────────────────────────────────────────
    const barOuter = document.createElement('div');
    barOuter.className = 'atenna-upw__bar-outer';
    const barInner = document.createElement('div');
    barInner.className = 'atenna-upw__bar-inner';
    barOuter.appendChild(barInner);
    wrap.appendChild(barOuter);

    // ── Status text ───────────────────────────────────────────
    const status = document.createElement('div');
    status.className = 'atenna-upw__phrase';
    status.textContent = PROGRESS_MESSAGES[0].text;
    wrap.appendChild(status);

    const startTime = Date.now();
    let msgIdx = 0;

    this.progressInterval = setInterval(() => {
      const elapsed = Math.floor((Date.now() - startTime) / 1000);
      // Animate bar: cap at 90% until done
      const pct = Math.min(90, (elapsed / 120) * 100);
      barInner.style.width = `${pct}%`;

      let nextIdx = msgIdx;
      while (nextIdx < PROGRESS_MESSAGES.length - 1 && elapsed >= PROGRESS_MESSAGES[nextIdx + 1].after) {
        nextIdx++;
      }
      if (nextIdx !== msgIdx) {
        msgIdx = nextIdx;
        status.style.opacity = '0';
        setTimeout(() => {
          status.textContent = PROGRESS_MESSAGES[msgIdx].text;
          status.style.opacity = '1';
        }, 180);
      }
    }, 1000);

    this.container.appendChild(wrap);
  }

  private async renderReady(): Promise<void> {
    const { file, dlpRisk, findings = [], isBinary, extractedContent } = this.state;
    const hasRisk = dlpRisk === 'MEDIUM' || dlpRisk === 'HIGH';

    // Show ALL findings (no truncation) — important for debugging false positives
    const filtered = findings.filter(f => f.count > 0);

    // Header row: filename + risk badge
    const head = document.createElement('div');
    head.className = 'atenna-upw__head';

    const fname = document.createElement('div');
    fname.className = 'atenna-upw__fname';
    fname.textContent = file?.name ?? 'Documento';
    fname.title = file?.name ?? '';

    const badge = document.createElement('span');
    badge.className = `atenna-upw__badge atenna-upw__badge--${hasRisk ? 'warn' : 'ok'}`;
    badge.textContent = hasRisk ? 'Dados sensíveis' : 'Limpo';

    head.appendChild(fname);
    head.appendChild(badge);
    this.container.appendChild(head);

    // Findings list — show ALL types (no truncation)
    if (filtered.length > 0) {
      const list = document.createElement('ul');
      list.className = 'atenna-upw__findings';
      for (const f of filtered) {
        const li = document.createElement('li');
        li.className = 'atenna-upw__finding';
        const label = ENTITY_LABELS[f.entity_type] ?? f.entity_type;
        // Only show detected value for actual PII types, not contextual classifiers
        const CONTEXT_TYPES = new Set(['LEGAL_CONTEXT', 'CONFIDENTIAL_DOCUMENT']);
        const tooltipText = (!CONTEXT_TYPES.has(f.entity_type) && f.value)
          ? `Detectado: ${f.value}`
          : null;
        const typeSpan = document.createElement('span');
        typeSpan.className = 'atenna-upw__finding-type';
        typeSpan.textContent = label;
        if (tooltipText) typeSpan.title = tooltipText;
        const countSpan = document.createElement('span');
        countSpan.className = 'atenna-upw__finding-count';
        countSpan.textContent = `${f.count}×`;
        li.appendChild(typeSpan);
        li.appendChild(countSpan);
        list.appendChild(li);
      }
      this.container.appendChild(list);
    } else if (!hasRisk) {
      const ok = document.createElement('div');
      ok.className = 'atenna-upw__ok-msg';
      ok.textContent = 'Nenhum dado sensível encontrado.';
      this.container.appendChild(ok);
    }

    // Hick: action bar — deliberate hierarchy, ação destrutiva visualmente menor
    const bar = document.createElement('div');
    bar.className = 'atenna-upw__bar';

    if (hasRisk) {
      const LOCK_SVG = `<svg class="atenna-upw__btn-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>`;
      const protectBtn = this.makeBtn('Proteger documento', 'primary', 'Substitui dados sensíveis por marcadores antes de enviar', LOCK_SVG);
      protectBtn.classList.add('atenna-upw__btn--protect', 'atenna-upw__bar-half');
      protectBtn.addEventListener('click', () => {
        const content = extractedContent ?? '';
        const fileName = this.state.file?.name ?? 'documento.txt';
        this.showSuccess(() => this.config.onReady(content, content.slice(0, 300), dlpRisk ?? 'HIGH', content, fileName));
      });
      bar.appendChild(protectBtn);

      const DL_SVG = `<svg class="atenna-upw__btn-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>`;
      const proValue = await import('../core/planManager').then(m => m.isPro());
      const dlLabel = proValue ? 'Baixar protegido' : 'Baixar · Pro';
      const dlBtn = this.makeBtn(dlLabel, 'secondary', proValue ? 'Baixar arquivo com dados sensíveis removidos' : 'Disponível no plano Pro', DL_SVG);
      dlBtn.classList.add('atenna-upw__btn--dl-action', 'atenna-upw__bar-half');
      if (!proValue) {
        dlBtn.disabled = true;
        dlBtn.classList.add('atenna-upw__btn--pro-locked');
      } else {
        dlBtn.addEventListener('click', () => void this.downloadProtected(dlBtn));
      }
      bar.appendChild(dlBtn);
    } else {
      // Clean document — show celebration animation then auto-apply
      this.showCleanAnimation(extractedContent ?? '', this.state.file?.name ?? 'documento.txt');
      return; // Don't append bar
    }

    if (hasRisk) {
      this.container.appendChild(bar);
    }
  }

  private showCleanAnimation(content: string, fileName: string): void {
    if (this.phraseInterval)  { clearInterval(this.phraseInterval);  this.phraseInterval  = undefined; }
    if (this.progressInterval){ clearInterval(this.progressInterval); this.progressInterval = undefined; }
    this.container.innerHTML = '';

    const name = this.config.userName
      ? this.config.userName.split(' ')[0]
      : null;

    const wrap = document.createElement('div');
    wrap.className = 'atenna-upw__clean';

    // Shield icon — safe with innerHTML (SVG from hardcoded HTML, no user input)
    const shield = document.createElement('div');
    shield.className = 'atenna-upw__clean-shield';
    shield.innerHTML = `<svg viewBox="0 0 56 56" fill="none" xmlns="http://www.w3.org/2000/svg">
      <circle cx="28" cy="28" r="27" stroke="#22c55e" stroke-width="2" class="atenna-upw__clean-ring"/>
      <path d="M17 29l8 8 14-14" stroke="#22c55e" stroke-width="2.5"
        stroke-linecap="round" stroke-linejoin="round" class="atenna-upw__clean-check"/>
    </svg>`;
    wrap.appendChild(shield);

    // Title — SAFE: use textContent for user input (name)
    const titleEl = document.createElement('div');
    titleEl.className = 'atenna-upw__clean-title';
    if (name) {
      const strong = document.createElement('strong');
      strong.textContent = name; // ← textContent prevents XSS
      titleEl.appendChild(strong);
      titleEl.appendChild(document.createTextNode(', seu documento passou limpo!'));
    } else {
      titleEl.textContent = 'Documento passou limpo!';
    }
    wrap.appendChild(titleEl);

    // Subtitle — safe (static text)
    const subEl = document.createElement('div');
    subEl.className = 'atenna-upw__clean-sub';
    subEl.textContent = 'Nenhum dado sensível encontrado. Pode usar à vontade.';
    wrap.appendChild(subEl);

    // Tip — safe (static text with emoji)
    const tipEl = document.createElement('div');
    tipEl.className = 'atenna-upw__clean-direct-tip';
    tipEl.textContent = '💡 Seu documento é seguro para envio direto — arraste no ChatGPT, Gemini, Claude ou Perplexity.';
    wrap.appendChild(tipEl);

    const applyBtn = document.createElement('button');
    applyBtn.className = 'atenna-doc-action-btn atenna-doc-action-btn--primary atenna-upw__btn--primary atenna-upw__clean-apply';
    applyBtn.textContent = 'Aplicar no chat';
    applyBtn.addEventListener('click', () => {
      // Vai direto para onReady — sem tela "Pronto." intermediária (evita duplicação)
      this.config.onReady(content, content.slice(0, 300), 'NONE', undefined, fileName);
    });

    wrap.appendChild(applyBtn);
    this.container.appendChild(wrap);
  }

  // Peak-End: estado de sucesso explícito antes de fechar (o "end" da experiência)
  private showSuccess(then: () => void): void {
    if (this.phraseInterval) { clearInterval(this.phraseInterval); this.phraseInterval = undefined; }
    if (this.progressInterval) { clearInterval(this.progressInterval); this.progressInterval = undefined; }
    this.container.innerHTML = '';
    const wrap = document.createElement('div');
    wrap.className = 'atenna-upw__success';
    const icon = document.createElement('div');
    icon.className = 'atenna-upw__success-icon';
    icon.textContent = '✓';
    const msg = document.createElement('div');
    msg.className = 'atenna-upw__success-msg';
    msg.textContent = 'Pronto.';
    wrap.appendChild(icon);
    wrap.appendChild(msg);
    this.container.appendChild(wrap);
    setTimeout(then, 600);
  }

  private renderQuota(): void {
    const wrap = document.createElement('div');
    wrap.className = 'atenna-upw__quota';

    // X vermelho animado
    const xWrap = document.createElement('div');
    xWrap.className = 'atenna-upw__quota-x';
    xWrap.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>`;

    const title = document.createElement('div');
    title.className = 'atenna-upw__quota-title';
    title.textContent = 'Cota diária atingida';

    const msg = document.createElement('div');
    msg.className = 'atenna-upw__quota-msg';
    msg.textContent = 'Você usou todas as análises gratuitas de hoje. Volte amanhã ou torne-se Atenna Pro para continuar sem restrições.';

    wrap.appendChild(xWrap);
    wrap.appendChild(title);
    wrap.appendChild(msg);

    // Cards de plano inline
    const cardsWrap = document.createElement('div');
    cardsWrap.className = 'atenna-upw__quota-cards';

    const plans: Array<{ id: 'yearly' | 'monthly'; label: string; price: string; period: string; tag?: string; desc: string; btnLabel: string; primary: boolean }> = [
      {
        id: 'yearly', label: 'Pro Anual', price: 'R$197', period: '/ano',
        tag: 'MELHOR VALOR', desc: '~R$16/mês · 300 prompts · arquivos ilimitados',
        btnLabel: 'Assinar anual', primary: true,
      },
      {
        id: 'monthly', label: 'Pro Mensal', price: 'R$29,90', period: '/mês',
        desc: 'Cancele quando quiser · prompts ilimitados',
        btnLabel: 'Assinar mensal', primary: false,
      },
    ];

    for (const p of plans) {
      const card = document.createElement('div');
      card.className = `atenna-upw__quota-card${p.primary ? ' atenna-upw__quota-card--featured' : ''}`;

      if (p.tag) {
        const tag = document.createElement('span');
        tag.className = 'atenna-upw__quota-tag';
        tag.textContent = p.tag;
        card.appendChild(tag);
      }

      const planName = document.createElement('div');
      planName.className = 'atenna-upw__quota-plan';
      planName.textContent = p.label;

      const priceRow = document.createElement('div');
      priceRow.className = 'atenna-upw__quota-price';
      priceRow.innerHTML = `<strong>${p.price}</strong><span>${p.period}</span>`;

      const desc = document.createElement('div');
      desc.className = 'atenna-upw__quota-desc';
      desc.textContent = p.desc;

      const btn = document.createElement('button');
      btn.className = `atenna-upw__quota-btn${p.primary ? ' atenna-upw__quota-btn--primary' : ''}`;
      btn.textContent = p.btnLabel;
      btn.addEventListener('click', () => {
        if (this.config.onUpgrade) {
          this.config.onUpgrade(p.id);
        }
      });

      card.appendChild(planName);
      card.appendChild(priceRow);
      card.appendChild(desc);
      card.appendChild(btn);
      cardsWrap.appendChild(card);
    }

    wrap.appendChild(cardsWrap);
    this.container.appendChild(wrap);
  }

  private renderError(): void {
    const wrap = document.createElement('div');
    wrap.className = 'atenna-upw__error';

    // Animated ✗ icon
    const icon = document.createElement('div');
    icon.className = 'atenna-upw__error-icon';
    icon.innerHTML = `<svg viewBox="0 0 52 52" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" class="atenna-upw__error-svg">
      <circle cx="26" cy="26" r="25" stroke="#ef4444" stroke-width="2" class="atenna-upw__err-circle"/>
      <line x1="16" y1="16" x2="36" y2="36" stroke="#ef4444" stroke-width="3" stroke-linecap="round" class="atenna-upw__err-cross1"/>
      <line x1="36" y1="16" x2="16" y2="36" stroke="#ef4444" stroke-width="3" stroke-linecap="round" class="atenna-upw__err-cross2"/>
    </svg>`;

    const msg = document.createElement('div');
    msg.className = 'atenna-upw__error-msg';
    msg.textContent = this.state.error ?? 'Erro inesperado. Tente novamente.';

    // Log raw error to console for debugging, never expose to UI
    console.error('[Atenna] Document error (raw):', this.state._rawError ?? this.state.error);
    // Track to admin analytics
    void trackEvent('document_upload_error_displayed', { friendly_msg: this.state.error, raw_error: this.state._rawError });

    const retry = this.makeBtn('Escolher outro arquivo', 'secondary', 'Selecionar um arquivo diferente');
    retry.addEventListener('click', () => {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = '.txt,.md,.csv,.json,.pdf,.docx,.doc,.xlsx,.xls';
      input.style.display = 'none';
      document.body.appendChild(input);
      input.addEventListener('change', () => {
        const file = input.files?.[0];
        input.remove();
        if (file) this.handleFileSelect(file);
      });
      input.click();
    });

    // Botão minimalista de report — só aparece em erros de servidor ou timeout (não validação)
    const errorText = this.state.error ?? '';
    const isServerError = errorText.includes('servidor') || errorText.includes('OCR')
      || errorText.includes('indisponível') || errorText.includes('demorou')
      || errorText.includes('processamento') || errorText.includes('500')
      || errorText.includes('502') || errorText.includes('503')
      || errorText.includes('Tente novamente') || errorText.includes('conectar')
      || errorText.includes('esperado') || errorText.includes('correção');

    const reportBtn = document.createElement('button');
    reportBtn.className = 'atenna-upw__report-btn';
    reportBtn.textContent = 'Reportar problema';
    reportBtn.title = 'Enviar este erro para a equipe Atenna';
    let reported = false;
    reportBtn.addEventListener('click', async () => {
      if (reported) return;
      reported = true;
      reportBtn.textContent = 'Enviando…';
      reportBtn.disabled = true;
      try {
        await this.sendProblemReport(errorText);
        reportBtn.textContent = '✓ Reportado';
      } catch {
        reportBtn.textContent = 'Reportar problema';
        reportBtn.disabled = false;
        reported = false;
      }
    });

    wrap.appendChild(icon);
    wrap.appendChild(msg);
    wrap.appendChild(retry);
    if (isServerError) wrap.appendChild(reportBtn);
    this.container.appendChild(wrap);
  }

  private async sendProblemReport(errorMessage: string): Promise<void> {
    const token = await this.getAuthToken();
    if (!token) return;
    const resp = await fetch(`${this.backendUrl}/report-problem`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        error_code: 'document_processing_error',
        error_message: errorMessage,
        page_url: window.location.href,
        extension_version: (chrome.runtime.getManifest?.() as { version?: string })?.version ?? 'unknown',
        context: { file_name: this.state.file?.name, file_size: this.state.file?.size },
      }),
    });
    if (!resp.ok) throw new Error('report failed');
  }

  private async downloadProtected(btn: HTMLButtonElement): Promise<void> {
    const file = this.state.file;
    if (!file) return;

    // Show spinner in button
    const originalHtml = btn.innerHTML;
    btn.disabled = true;
    btn.innerHTML = `<span class="atenna-upw__dl-spinner"></span><span>Preparando…</span>`;

    const setProgress = (msg: string) => {
      const span = btn.querySelector('span:last-child');
      if (span) span.textContent = msg;
    };

    const token = await this.getAuthToken();
    if (!token) {
      btn.innerHTML = originalHtml;
      btn.disabled = false;
      return;
    }

    setProgress('Lendo arquivo…');
    const ab = await file.arrayBuffer();
    const u8 = new Uint8Array(ab);
    let bin = '';
    for (let i = 0; i < u8.length; i++) bin += String.fromCharCode(u8[i]);
    const b64 = btoa(bin);

    setProgress('Removendo dados sensíveis…');

    return new Promise((resolve) => {
      chrome.runtime.sendMessage(
        { type: 'ATENNA_EXPORT_PROTECTED', fileBase64: b64, fileName: file.name, mimeType: file.type || 'application/octet-stream', token },
        (resp: { ok: boolean; resultB64?: string; contentType?: string; disposition?: string; fallback?: boolean; body?: string } | undefined) => {
          btn.innerHTML = originalHtml;
          btn.disabled = false;

          if (chrome.runtime.lastError || !resp || !resp.ok) { resolve(); return; }

          const resultBin = atob(resp.resultB64!);
          const bytes = new Uint8Array(resultBin.length);
          for (let i = 0; i < resultBin.length; i++) bytes[i] = resultBin.charCodeAt(i);
          const blob = new Blob([bytes], { type: resp.contentType ?? 'application/octet-stream' });

          let dlName = '';
          const disp = resp.disposition ?? '';
          const fnMatch = disp.match(/filename\*=UTF-8''([^;]+)/i) || disp.match(/filename="([^"]+)"/i);
          if (fnMatch) dlName = decodeURIComponent(fnMatch[1]);
          if (!dlName) {
            const base = file.name.replace(/\.[^.]+$/, '');
            const ext = file.name.split('.').pop() ?? 'txt';
            dlName = `${base}_protegido.${ext}`;
          }

          const url = URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url; a.download = dlName;
          document.body.appendChild(a); a.click();
          setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 2000);
          resolve();
        },
      );
    });
  }

  private makeBtn(label: string, variant: 'primary' | 'secondary' | 'danger', tooltip: string, icon?: string): HTMLButtonElement {
    const btn = document.createElement('button');
    btn.className = `atenna-doc-action-btn${variant === 'primary' ? ' atenna-doc-action-btn--primary atenna-upw__btn--primary' : ''}${variant === 'danger' ? ' atenna-upw__btn--danger' : ''}`;
    // sem title — evita tooltip nativo duplicado com o CSS tooltip

    if (icon) {
      btn.innerHTML = `${icon}<span>${label}</span>`;
    } else {
      btn.textContent = label;
    }

    const tip = document.createElement('span');
    tip.className = 'atenna-doc-action-btn__tooltip';
    tip.textContent = tooltip;
    btn.appendChild(tip);

    btn.addEventListener('mouseenter', () => tip.classList.add('atenna-doc-action-btn__tooltip--visible'));
    btn.addEventListener('mouseleave', () => tip.classList.remove('atenna-doc-action-btn__tooltip--visible'));

    return btn;
  }
}
