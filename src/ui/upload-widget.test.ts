import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { UploadWidget } from './upload-widget';

describe('UploadWidget - XSS Protection', () => {
  let container: HTMLElement;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
  });

  afterEach(() => {
    container.remove();
  });

  it('prevents XSS when userName contains HTML with event handler', () => {
    const config = {
      targetElement: container,
      maxSize: { txt: 10 * 1024 * 1024 },
      userName: '<img src=x onerror="alert(1)">',
      onReady: () => {},
      onError: () => {},
      onCancel: () => {},
    };

    const widget = new UploadWidget(config);

    // Mock internal state to be ready with clean document
    (widget as any).state = {
      phase: 'ready',
      file: new File(['test content'], 'test.txt'),
      dlpRisk: 'NONE',
      findings: [],
      extractedContent: 'test content',
      isBinary: false,
    };

    widget.render();

    // Verify: innerHTML should NOT contain the script tag or event handler
    const titleEl = container.querySelector('.atenna-upw__clean-title');
    expect(titleEl).not.toBeNull();
    expect(titleEl!.innerHTML).not.toContain('onerror');
    expect(titleEl!.innerHTML).not.toContain('src=x');

    // Verify: textContent should contain the injected text literally (not executed)
    // The first "word" is '<img' due to split(' ')[0]
    expect(titleEl!.textContent).toContain('<img');
    expect(titleEl!.textContent).not.toContain('onerror'); // ← Proof of safe handling
    expect(titleEl!.textContent).toContain('seu documento passou limpo!');
  });

  it('handles special characters safely in userName', () => {
    const config = {
      targetElement: container,
      maxSize: { txt: 10 * 1024 * 1024 },
      userName: "O'Reilly & Co.",
      onReady: () => {},
      onError: () => {},
      onCancel: () => {},
    };

    const widget = new UploadWidget(config);

    (widget as any).state = {
      phase: 'ready',
      file: new File(['test content'], 'test.txt'),
      dlpRisk: 'NONE',
      findings: [],
      extractedContent: 'test content',
      isBinary: false,
    };

    widget.render();

    const titleEl = container.querySelector('.atenna-upw__clean-title');
    expect(titleEl).not.toBeNull();

    // Verify special chars are preserved literally
    // Note: split(' ')[0] extracts only first word "O'Reilly"
    expect(titleEl!.textContent).toContain("O'Reilly");
    expect(titleEl!.textContent).toContain("seu documento passou limpo!");
  });

  it('displays clean title correctly with safe userName', () => {
    const config = {
      targetElement: container,
      maxSize: { txt: 10 * 1024 * 1024 },
      userName: 'João Silva',
      onReady: () => {},
      onError: () => {},
      onCancel: () => {},
    };

    const widget = new UploadWidget(config);

    (widget as any).state = {
      phase: 'ready',
      file: new File(['test content'], 'test.txt'),
      dlpRisk: 'NONE',
      findings: [],
      extractedContent: 'test content',
      isBinary: false,
    };

    widget.render();

    const titleEl = container.querySelector('.atenna-upw__clean-title');
    expect(titleEl).not.toBeNull();
    expect(titleEl!.textContent).toContain('João');
    expect(titleEl!.textContent).toContain('seu documento passou limpo!');
  });

  it('displays default title when userName is null', () => {
    const config = {
      targetElement: container,
      maxSize: { txt: 10 * 1024 * 1024 },
      userName: null,
      onReady: () => {},
      onError: () => {},
      onCancel: () => {},
    };

    const widget = new UploadWidget(config);

    (widget as any).state = {
      phase: 'ready',
      file: new File(['test content'], 'test.txt'),
      dlpRisk: 'NONE',
      findings: [],
      extractedContent: 'test content',
      isBinary: false,
    };

    widget.render();

    const titleEl = container.querySelector('.atenna-upw__clean-title');
    expect(titleEl).not.toBeNull();
    expect(titleEl!.textContent).toBe('Documento passou limpo!');
  });
});
