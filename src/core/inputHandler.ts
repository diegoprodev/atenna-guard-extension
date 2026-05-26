export function getCurrentInput(): HTMLElement | null {
  const chatgpt = document.getElementById('prompt-textarea');
  if (chatgpt) return chatgpt as HTMLElement;
  const ce = document.querySelector<HTMLElement>('div[contenteditable="true"]');
  return ce ?? null;
}

export function getInputText(input: HTMLElement): string {
  if (input instanceof HTMLTextAreaElement || input instanceof HTMLInputElement) {
    return input.value;
  }
  return input.innerText || input.textContent || '';
}

export function setInputText(input: HTMLElement, text: string): void {
  if (input instanceof HTMLTextAreaElement || input instanceof HTMLInputElement) {
    // Focus first so React sees the element as active before the value change
    input.focus();
    const proto = input instanceof HTMLTextAreaElement
      ? window.HTMLTextAreaElement.prototype
      : window.HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
    if (setter) setter.call(input, text); else (input as HTMLTextAreaElement).value = text;
    // React 16+ requires InputEvent (not generic Event) with inputType to reconcile internal state
    input.dispatchEvent(new InputEvent('beforeinput', { bubbles: true, cancelable: true, inputType: 'insertReplacementText', data: text }));
    input.dispatchEvent(new InputEvent('input', { bubbles: true, cancelable: true, inputType: 'insertReplacementText', data: text }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
  } else {
    // contenteditable (Lexical / ProseMirror / Draft.js / plain)
    input.focus();

    // Select all existing content
    const sel = window.getSelection();
    if (sel) {
      const range = document.createRange();
      range.selectNodeContents(input);
      sel.removeAllRanges();
      sel.addRange(range);
    }

    // Strategy 1: execCommand('insertText') — works for most contenteditables,
    // including Lexical when focus + selection is live (user activation required).
    const ok = document.execCommand('insertText', false, text);

    if (!ok || input.textContent === text.slice(0, -1) || (input.innerText || input.textContent || '') !== text) {
      // Strategy 2: DataTransfer beforeinput — Lexical/ProseMirror intercept this
      const dt = new DataTransfer();
      dt.setData('text/plain', text);
      input.dispatchEvent(new InputEvent('beforeinput', {
        bubbles: true, cancelable: true,
        inputType: 'insertFromPaste',
        dataTransfer: dt,
      }));

      // Strategy 3: direct write + input event (React/Vue)
      if ((input.innerText || input.textContent || '') !== text) {
        input.textContent = text;
        input.dispatchEvent(new InputEvent('input', {
          bubbles: true, cancelable: true,
          inputType: 'insertReplacementText', data: text,
        }));
      }
    }

    input.dispatchEvent(new Event('change', { bubbles: true }));
    input.focus();
  }
}
