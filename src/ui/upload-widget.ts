import { trackEvent } from '../core/analytics';
import { isPro } from '../core/planManager';

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

async function getUploadUsage(): Promise<number> {
  return new Promise(resolve => {
    try {
      chrome.storage.local.get(UPLOAD_COUNT_KEY, r => {
        const data = r[UPLOAD_COUNT_KEY] as { count: number; date: string } | undefined;
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
      chrome.storage.local.set({ [UPLOAD_COUNT_KEY]: { count: next, date: today } }, () => resolve(next));
    } catch { resolve(next); }
  });
}

export interface UploadWidgetConfig {
  targetElement: HTMLElement;
  maxSize: Record<string, number>;
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
    const pro = await isPro();
    if (!pro) {
      const used = await getUploadUsage();
      if (used >= UPLOAD_LIMIT_FREE) {
        this.state = { phase: 'quota', file };
        this.render();
        return;
      }
    }
    await incrementUploadUsage();
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
      const msg = err instanceof Error ? err.message : String(err);
      this.state = { phase: 'error', file, error: msg };
      this.render();
      void trackEvent('document_upload_error', { error: msg });
    }
  }

  private async protectViaBackend(file: File): Promise<ProtectPayload> {
    const token = await this.getAuthToken();
    if (!token) throw new Error('Sessão expirada. Faça login novamente.');
    const formData = new FormData();
    formData.append('file', file, file.name);
    const resp = await fetch(`${this.backendUrl}/document/protect`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${token}` },
      body: formData,
    });
    if (!resp.ok) {
      let detail = '';
      try { detail = (await resp.json()).detail ?? ''; } catch { detail = await resp.text().catch(() => ''); }
      throw new Error(`Falha ao processar arquivo (${resp.status}). ${String(detail).slice(0, 120)}`);
    }
    return resp.json() as Promise<ProtectPayload>;
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
    // Try direct storage first (works in top-level content scripts)
    try {
      const r = await chrome.storage.local.get('atenna_jwt');
      const session = r['atenna_jwt'] as { access_token?: string } | undefined;
      if (session?.access_token) return session.access_token;
    } catch { /* storage not available in this context (iframe) — fall through */ }

    // Fallback: ask background service worker (always has storage access)
    return new Promise(resolve => {
      try {
        chrome.runtime.sendMessage({ type: 'GET_AUTH_TOKEN' }, (resp) => {
          if (chrome.runtime.lastError) { resolve(null); return; }
          resolve((resp as { token?: string })?.token ?? null);
        });
      } catch { resolve(null); }
    });
  }

  // ── Render ────────────────────────────────────────────────────────────────

  render(): void {
    if (this.phraseInterval) { clearInterval(this.phraseInterval); this.phraseInterval = undefined; }
    if (this.progressInterval) { clearInterval(this.progressInterval); this.progressInterval = undefined; }
    this.container.innerHTML = '';
    this.container.className = 'atenna-upw';

    if (this.state.phase === 'loading') this.renderLoading();
    else if (this.state.phase === 'quota') this.renderQuota();
    else if (this.state.phase === 'error') this.renderError();
    else this.renderReady();
  }

  private renderLoading(): void {
    const wrap = document.createElement('div');
    wrap.className = 'atenna-upw__loading';

    if (this.state.file) {
      const fname = document.createElement('div');
      fname.className = 'atenna-upw__fname';
      fname.textContent = this.state.file.name;
      wrap.appendChild(fname);
    }

    // Spinner com logo no centro
    const spinWrap = document.createElement('div');
    spinWrap.className = 'atenna-upw__spin-wrap';

    const ring = document.createElement('div');
    ring.className = 'atenna-upw__ring';

    const logoImg = document.createElement('img');
    try { logoImg.src = chrome.runtime.getURL('icons/icon32.png'); } catch { logoImg.src = ''; }
    logoImg.className = 'atenna-upw__spin-logo';
    logoImg.alt = '';

    spinWrap.appendChild(ring);
    spinWrap.appendChild(logoImg);

    const phrase = document.createElement('div');
    phrase.className = 'atenna-upw__phrase';
    phrase.textContent = LOADING_PHRASES[0];

    const progress = document.createElement('div');
    progress.className = 'atenna-upw__progress';
    progress.textContent = 'Processando...';

    let i = 0;
    this.phraseInterval = setInterval(() => {
      i = (i + 1) % LOADING_PHRASES.length;
      phrase.style.opacity = '0';
      setTimeout(() => {
        phrase.textContent = LOADING_PHRASES[i];
        phrase.style.opacity = '1';
      }, 180);
    }, 1800);

    // Animate progress feedback
    let progressCount = 0;
    this.progressInterval = setInterval(() => {
      progressCount = (progressCount + 1) % 4;
      progress.textContent = 'Processando' + '.'.repeat(progressCount + 1);
    }, 500);

    wrap.appendChild(spinWrap);
    wrap.appendChild(phrase);
    wrap.appendChild(progress);
    this.container.appendChild(wrap);
  }

  private renderReady(): void {
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
      // Primary: large, green — ação recomendada (Fitts: maior alvo)
      const LOCK_SVG = `<svg class="atenna-upw__btn-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>`;
      const protectBtn = this.makeBtn(
        'Proteger documento',
        'primary',
        'Substitui dados sensíveis por marcadores antes de enviar',
        LOCK_SVG
      );
      protectBtn.classList.add('atenna-upw__btn--protect');
      protectBtn.addEventListener('click', () => {
        const content = extractedContent ?? '';
        const fileName = this.state.file?.name ?? 'documento.txt';
        this.showSuccess(() => this.config.onReady(content, content.slice(0, 300), dlpRisk ?? 'HIGH', content, fileName));
      });
      bar.appendChild(protectBtn);

      // Secondary: só para arquivos texto onde temos o original — visualmente recessivo
      if (!isBinary && this.state.originalContent) {
        const origBtn = this.makeBtn(
          'Usar sem alteração',
          'danger',
          'Envia o documento sem remover os dados sensíveis identificados'
        );
        origBtn.addEventListener('click', () => {
          const orig = this.state.originalContent!;
          const fName = this.state.file?.name ?? 'documento.txt';
          this.showSuccess(() => this.config.onReady(orig, orig.slice(0, 300), dlpRisk ?? 'HIGH', undefined, fName));
        });
        bar.appendChild(origBtn);
      }
    } else {
      // Arquivo sem risco — APENAS Aplicar (redundância removida)
      const applyBtn = this.makeBtn('Aplicar no texto', 'primary', 'Insere o conteúdo extraído no campo de texto ativo');
      applyBtn.addEventListener('click', () => {
        const content = extractedContent ?? this.state.originalContent ?? '';
        const fName = this.state.file?.name ?? 'documento.txt';
        this.showSuccess(() => this.config.onReady(content, content.slice(0, 300), dlpRisk ?? 'NONE', undefined, fName));
      });
      bar.appendChild(applyBtn);
      // Removed: copyBtn (redundante — Aplicar já injeta no campo de texto)
    }

    this.container.appendChild(bar);
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

    const msg = document.createElement('div');
    msg.className = 'atenna-upw__error-msg';
    msg.textContent = this.state.error ?? 'Erro desconhecido.';

    // Hick: 1 ação clara no estado de erro
    const retry = this.makeBtn('Escolher outro arquivo', 'secondary', 'Selecionar um arquivo diferente');
    retry.addEventListener('click', () => {
      // Reabre o file picker em vez de fechar o overlay
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

    wrap.appendChild(msg);
    wrap.appendChild(retry);
    this.container.appendChild(wrap);
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
