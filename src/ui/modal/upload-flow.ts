import { syncPlanFromBff } from './network';
import { showProWelcomeOverlay } from './onboarding-views';
import { bffMe } from '../../auth/bffClient';
import { trackEvent } from '../../core/analytics';
import { showToast } from './utils';
import { openCheckout } from './network';
import { renderDocumentActionBar } from './prompt-cards';

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
    const { UploadWidget } = await import('../upload-widget');

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
