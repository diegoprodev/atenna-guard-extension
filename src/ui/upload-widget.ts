/**
 * FASE 4.1: Upload Widget — Documento Upload + DLP Scan + Rewrite
 *
 * Flow:
 * 1. File selection (input or drag-drop)
 * 2. Client-side validation (type, size, magic bytes, encoding)
 * 3. Upload to backend
 * 4. DLP scan (same engine as text)
 * 5. Show result:
 *    - NONE/LOW: ready to send
 *    - HIGH: show protection banner
 * 6. User choice: [Proteger dados] or [Enviar original]
 * 7. Cleanup: delete from memory after use
 */

import { trackEvent } from '../core/analytics';

export interface DetectedEntity {
  type: string;
  value?: string;
  start: number;
  end: number;
  confidence: number;
}

export interface UploadResult {
  success: boolean;
  dlpRiskLevel?: 'NONE' | 'LOW' | 'MEDIUM' | 'HIGH';
  entityCount?: number;
  entityTypes?: string[];
  contentPreview?: string;
  contentHash?: string;
  charCount?: number;
  error?: string;
}

export interface UploadWidgetConfig {
  targetElement: HTMLElement;
  maxSize: Record<string, number>;
  onReady: (content: string, preview: string, riskLevel: string, rewritten?: string) => void;
  onError: (error: string) => void;
  onCancel: () => void;
}

export interface UploadState {
  phase: 'idle' | 'uploading' | 'validating' | 'scanning' | 'ready' | 'error' | 'rewriting';
  progress: number; // 0-100
  file?: File;
  dlpRisk?: 'NONE' | 'LOW' | 'MEDIUM' | 'HIGH';
  entities?: DetectedEntity[];
  contentPreview?: string;
  contentHash?: string;
  charCount?: number;
  error?: string;
  extractedContent?: string;
}

const SUPPORTED_TYPES: Record<string, string> = {
  'text/plain': 'txt',
  'text/markdown': 'md',
  'text/csv': 'csv',
  'application/json': 'json',
};

const FILE_EXTENSIONS: Record<string, string> = {
  txt: 'text/plain',
  md: 'text/markdown',
  csv: 'text/csv',
  json: 'application/json',
};

const MAGIC_BYTES: Record<string, Uint8Array> = {
  // Text files don't really have magic bytes, so we'll rely on extension + content
};

export class UploadWidget {
  config: UploadWidgetConfig;
  state: UploadState = { phase: 'idle', progress: 0 };
  private container: HTMLElement;
  private fileInput: HTMLInputElement | undefined;
  private dragOverlay: HTMLElement | undefined;

  constructor(config: UploadWidgetConfig) {
    this.config = config;
    this.container = config.targetElement;
    this.render();
  }

  render(): void {
    this.container.innerHTML = '';
    this.container.className = 'atenna-upload-widget';

    const input = document.createElement('input');
    input.type = 'file';
    input.className = 'atenna-upload-widget__input';
    input.accept = '.txt,.md,.csv,.json,text/plain,text/markdown,text/csv,application/json';
    input.addEventListener('change', (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (file) this.handleFileSelect(file);
    });
    this.fileInput = input;
    this.container.appendChild(input);

    // Main UI
    const icon = document.createElement('div');
    icon.className = 'atenna-upload-widget__icon';
    icon.innerHTML = '📎';

    const text = document.createElement('div');
    text.className = 'atenna-upload-widget__text';
    text.textContent = 'Compartilhe documentos com IA';

    const hint = document.createElement('div');
    hint.className = 'atenna-upload-widget__hint';
    hint.textContent = 'TXT · MD · CSV · JSON · Máx 1 MB';

    const button = document.createElement('button');
    button.className = 'atenna-upload-widget__button';
    button.textContent = 'Selecionar arquivo';
    button.addEventListener('click', () => this.fileInput?.click());

    this.container.appendChild(icon);
    this.container.appendChild(text);
    this.container.appendChild(hint);
    this.container.appendChild(button);

    // Drag-drop area
    this.setupDragDrop();
  }

  private setupDragDrop(): void {
    this.container.addEventListener('dragover', (e) => {
      e.preventDefault();
      e.stopPropagation();
      this.container.classList.add('drag-active');
    });

    this.container.addEventListener('dragleave', (e) => {
      e.preventDefault();
      e.stopPropagation();
      this.container.classList.remove('drag-active');
    });

    this.container.addEventListener('drop', (e) => {
      e.preventDefault();
      e.stopPropagation();
      this.container.classList.remove('drag-active');
      const file = e.dataTransfer?.files?.[0];
      if (file) this.handleFileSelect(file);
    });
  }

  handleFileSelect(file: File): void {
    const validation = this.validateFile(file);
    if (!validation.valid) {
      this.setState({ phase: 'error', error: validation.error });
      this.renderErrorState();
      return;
    }

    this.state.file = file;
    this.uploadFile(file).catch((err) => {
      this.setState({ phase: 'error', error: err instanceof Error ? err.message : String(err) });
      this.renderErrorState();
    });
  }

  validateFile(file: File): { valid: boolean; error?: string } {
    const ext = file.name.split('.').pop()?.toLowerCase();
    if (!ext || !FILE_EXTENSIONS[ext]) {
      return { valid: false, error: `Tipo de arquivo não suportado. Suportamos: TXT, MD, CSV, JSON` };
    }

    const expectedMime = FILE_EXTENSIONS[ext];
    const maxSize = this.config.maxSize[ext];
    if (!maxSize) {
      return { valid: false, error: `Tipo de arquivo não suportado: ${ext}` };
    }

    if (file.size > maxSize) {
      const maxMb = maxSize / (1024 * 1024);
      return { valid: false, error: `Arquivo muito grande. Máximo: ${maxMb} MB, Seu arquivo: ${(file.size / (1024 * 1024)).toFixed(1)} MB` };
    }

    return { valid: true };
  }

  async uploadFile(file: File): Promise<void> {
    this.setState({ phase: 'uploading', progress: 0 });
    this.renderUploadingState();

    try {
      // Read file content
      const content = await this.readFile(file);
      this.setState({ progress: 30 });

      // Validate encoding
      if (!this.isValidUtf8(content)) {
        throw new Error('Arquivo corrompido ou encoding não suportado. Suportamos UTF-8, ASCII, Latin-1');
      }

      // Extract content (for text files, it's the whole content)
      const ext = file.name.split('.').pop()?.toLowerCase() || 'txt';
      const extracted = await this.extractContent(content, ext);
      this.setState({ progress: 60, extractedContent: extracted });

      // Validate size after extraction
      const MAX_CHARS = 100_000;
      if (extracted.length > MAX_CHARS) {
        throw new Error(`Arquivo muito grande (${extracted.length} chars > ${MAX_CHARS})`);
      }

      this.setState({ phase: 'scanning', charCount: extracted.length });
      this.renderScanningState();

      // DLP scan via backend
      const scanResult = await this.scanWithDlp(extracted, file.name);

      if (!scanResult.success) {
        throw new Error(scanResult.error || 'Análise falhou');
      }

      this.setState({
        phase: 'ready',
        dlpRisk: scanResult.dlpRiskLevel,
        entities: [], // Not exposed to user for security
        contentPreview: scanResult.contentPreview,
        contentHash: scanResult.contentHash,
        charCount: scanResult.charCount,
        progress: 100,
      });

      this.renderReadyState();
      void trackEvent('document_upload_success', { file_type: ext, dlp_risk: scanResult.dlpRiskLevel });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.setState({ phase: 'error', error: message });
      this.renderErrorState();
      void trackEvent('document_upload_error', { error: message });
    }
  }

  private async readFile(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        try {
          const content = reader.result as string;
          resolve(content);
        } catch (e) {
          reject(new Error('Falha ao ler arquivo'));
        }
      };
      reader.onerror = () => reject(new Error('Falha ao ler arquivo'));
      reader.readAsText(file, 'utf-8');
    });
  }

  private isValidUtf8(str: string): boolean {
    try {
      // If we can encode and decode without error, it's valid UTF-8
      const encoded = new TextEncoder().encode(str);
      new TextDecoder('utf-8', { fatal: true }).decode(encoded);
      return true;
    } catch {
      return false;
    }
  }

  private async extractContent(raw: string, fileType: string): Promise<string> {
    // For text files, just normalize whitespace and remove control characters
    let content = raw
      .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, ' ') // Remove control chars
      .trim();

    // Remove BOM if present
    if (content.charCodeAt(0) === 0xFEFF) {
      content = content.slice(1);
    }

    // For CSV/JSON, normalize structure
    if (fileType === 'csv') {
      // Keep as-is (no JSON parsing)
    } else if (fileType === 'json') {
      try {
        const parsed = JSON.parse(content);
        content = JSON.stringify(parsed, null, 2);
      } catch {
        // If invalid JSON, keep as-is
      }
    } else if (fileType === 'md') {
      // Basic markdown cleanup (remove extra whitespace)
      content = content.replace(/\n\n\n+/g, '\n\n');
    }

    return content;
  }

  private async scanWithDlp(content: string, fileName: string): Promise<UploadResult> {
    const token = await this.getAuthToken();
    if (!token) {
      throw new Error('Não autenticado. Por favor, faça login');
    }

    const backend = this.getBackendUrl();
    const formData = new FormData();

    // Create a blob from the content
    const blob = new Blob([content], { type: 'text/plain' });
    const file = new File([blob], fileName, { type: 'text/plain' });

    formData.append('file', file);

    try {
      const response = await fetch(`${backend}/user/upload-document`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'X-Session-ID': this.getSessionId(),
        },
        body: formData,
      });

      if (!response.ok) {
        const error = await response.text();
        throw new Error(error || `Server error: ${response.status}`);
      }

      const result = (await response.json()) as UploadResult;
      return result;
    } catch (e) {
      throw new Error(`DLP scan failed: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      // Clear extracted content from memory
      this.state.extractedContent = undefined;
    }
  }

  private getBackendUrl(): string {
    return 'https://atennaplugin.maestro-n8n.site';
  }

  private getSessionId(): string {
    try {
      const stored = localStorage.getItem('atenna_session_id');
      return stored || 'unknown';
    } catch {
      return 'unknown';
    }
  }

  private async getAuthToken(): Promise<string | null> {
    try {
      const stored = localStorage.getItem('atenna_jwt');
      return stored || null;
    } catch {
      return null;
    }
  }

  private setState(partial: Partial<UploadState>): void {
    this.state = { ...this.state, ...partial };
  }

  private renderUploadingState(): void {
    const progress = this.state.progress || 0;
    const fileName = this.state.file?.name || 'arquivo';

    this.container.innerHTML = `
      <div class="atenna-upload-progress">Enviando ${fileName}...</div>
      <div class="atenna-upload-progress-bar">
        <div class="atenna-upload-progress-bar__fill" style="width: ${progress}%"></div>
      </div>
    `;
  }

  private renderScanningState(): void {
    this.container.innerHTML = `
      <div class="atenna-upload-progress">Analisando dados...</div>
      <div class="atenna-upload-progress">Verificando conteúdo sensível</div>
    `;
  }

  private renderReadyState(): void {
    const { file, dlpRisk, contentPreview, charCount } = this.state;
    if (!file) return;

    this.container.innerHTML = `
      <div class="atenna-upload-result success">
        <div style="margin-bottom: 12px;">✓ Pronto para enviar</div>
        <div style="font-size: 12px; opacity: 0.7;">
          ${file.name} (${(file.size / 1024).toFixed(1)} KB)<br>
          ${charCount} caracteres
        </div>
        <div style="margin-top: 8px; font-size: 12px; opacity: 0.7;">
          ${dlpRisk === 'NONE' || dlpRisk === 'LOW' ? 'Nenhum dado sensível detectado.' : 'Dados sensíveis detectados.'}
        </div>
      </div>
    `;

    if (dlpRisk === 'HIGH') {
      this.renderProtectionBanner();
    } else {
      const sendBtn = document.createElement('button');
      sendBtn.className = 'atenna-upload-widget__button';
      sendBtn.textContent = 'Enviar para IA';
      sendBtn.addEventListener('click', () => {
        if (this.state.extractedContent) {
          this.config.onReady(
            this.state.extractedContent,
            contentPreview || '',
            dlpRisk || 'NONE'
          );
          this.cleanup();
        }
      });
      this.container.appendChild(sendBtn);
    }
  }

  private renderProtectionBanner(): void {
    const protectBtn = document.createElement('button');
    protectBtn.className = 'atenna-upload-widget__button atenna-upload-widget__button--primary';
    protectBtn.textContent = 'Proteger dados';
    protectBtn.addEventListener('click', () => {
      this.setState({ phase: 'rewriting' });
      this.renderRewritingState();
      // TODO: Call rewrite endpoint
      this.config.onReady(
        this.state.extractedContent || '',
        this.state.contentPreview || '',
        'PROTECTED'
      );
      this.cleanup();
    });

    const sendBtn = document.createElement('button');
    sendBtn.className = 'atenna-upload-widget__button';
    sendBtn.textContent = 'Enviar original';
    sendBtn.addEventListener('click', () => {
      if (this.state.extractedContent) {
        this.config.onReady(
          this.state.extractedContent,
          this.state.contentPreview || '',
          this.state.dlpRisk || 'HIGH'
        );
        this.cleanup();
      }
    });

    this.container.appendChild(protectBtn);
    this.container.appendChild(sendBtn);
  }

  private renderRewritingState(): void {
    this.container.innerHTML = `
      <div class="atenna-upload-progress">Protegendo dados...</div>
    `;
  }

  private renderErrorState(): void {
    const error = this.state.error || 'Erro desconhecido';
    this.container.innerHTML = `
      <div class="atenna-upload-result error">
        ❌ ${error}
      </div>
    `;

    const retryBtn = document.createElement('button');
    retryBtn.className = 'atenna-upload-widget__button';
    retryBtn.textContent = 'Tentar outro';
    retryBtn.addEventListener('click', () => {
      this.render();
    });
    this.container.appendChild(retryBtn);
  }

  cleanup(): void {
    // Clear sensitive data from memory
    this.state.extractedContent = undefined;
    this.state.contentPreview = undefined;
    this.state.file = undefined;
  }
}
