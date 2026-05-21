import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { attachImageInterceptor } from './imageInterceptor';

const BLANK_PNG_BYTES = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
  0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
  0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
  0x08, 0x02, 0x00, 0x00, 0x00, 0x90, 0x77, 0x53,
  0xde, 0x00, 0x00, 0x00, 0x0c, 0x49, 0x44, 0x41,
  0x54, 0x08, 0xd7, 0x63, 0xf8, 0xcf, 0xc0, 0x00,
  0x00, 0x00, 0x02, 0x00, 0x01, 0xe2, 0x21, 0xbc,
  0x33, 0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4e,
  0x44, 0xae, 0x42, 0x60, 0x82,
]);

function makeImageFile(name = 'screenshot.png', type = 'image/png'): File {
  return new File([BLANK_PNG_BYTES], name, { type });
}

vi.mock('../auth/sessionManager', () => ({
  getSession: vi.fn().mockResolvedValue({ token: 'fake-bff-token', expires_at: 9999999999, plan: 'free' }),
}));

function makeClipboardEvent(file: File | null): Event {
  const items = file ? [{ kind: 'file', type: file.type, getAsFile: () => file }] : [];
  return Object.assign(new Event('paste'), { clipboardData: { items } });
}

function makeDragEvent(file: File | null): Event {
  const items = file ? [{ kind: 'file', type: file.type, getAsFile: () => file }] : [];
  const ev = new Event('drop');
  Object.defineProperty(ev, 'dataTransfer', { value: { items }, configurable: true });
  return ev;
}

describe('attachImageInterceptor', () => {
  let textarea: HTMLTextAreaElement;
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    textarea = document.createElement('textarea');
    textarea.id = 'prompt-textarea';
    document.body.appendChild(textarea);
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    document.body.innerHTML = '';
    vi.clearAllMocks();
    vi.unstubAllGlobals();
  });

  it('shows banner when image paste yields HIGH risk', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        risk_level: 'HIGH', show_warning: true,
        entities: [{ type: 'CPF', value: '123.456.789-09', start: 0, end: 14, score: 0.99 }],
        advisory: 'CPF detectado', score: 0.95, duration_ms: 50,
      }),
    });
    attachImageInterceptor('#prompt-textarea');
    textarea.dispatchEvent(makeClipboardEvent(makeImageFile()));
    await new Promise(r => setTimeout(r, 50));
    const banner = document.getElementById('atenna-protection-banner');
    expect(banner).not.toBeNull();
    expect(banner!.textContent).toContain('Dados sensíveis');
  });

  it('does NOT show banner when image has no PII', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ risk_level: 'NONE', show_warning: false, entities: [], advisory: '', score: 0, duration_ms: 20 }),
    });
    attachImageInterceptor('#prompt-textarea');
    textarea.dispatchEvent(makeClipboardEvent(makeImageFile()));
    await new Promise(r => setTimeout(r, 50));
    expect(document.getElementById('atenna-protection-banner')).toBeNull();
  });

  it('ignores paste events with no image files', async () => {
    attachImageInterceptor('#prompt-textarea');
    const textFile = new File(['hello'], 'notes.txt', { type: 'text/plain' });
    textarea.dispatchEvent(makeClipboardEvent(textFile));
    await new Promise(r => setTimeout(r, 50));
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('shows banner on drop event with HIGH risk image', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ risk_level: 'HIGH', show_warning: true, entities: [], advisory: 'RG detectado', score: 0.9, duration_ms: 30 }),
    });
    attachImageInterceptor('#prompt-textarea');
    textarea.dispatchEvent(makeDragEvent(makeImageFile()));
    await new Promise(r => setTimeout(r, 50));
    expect(document.getElementById('atenna-protection-banner')).not.toBeNull();
  });

  it('silently swallows fetch errors without throwing', async () => {
    fetchMock.mockRejectedValueOnce(new Error('Network error'));
    attachImageInterceptor('#prompt-textarea');
    expect(() => textarea.dispatchEvent(makeClipboardEvent(makeImageFile()))).not.toThrow();
    await new Promise(r => setTimeout(r, 50));
  });
});
