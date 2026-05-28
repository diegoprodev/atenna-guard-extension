import { describe, it, expect, vi, beforeEach } from 'vitest';

const storageData: Record<string, unknown> = {};

vi.stubGlobal('chrome', {
  storage: {
    local: {
      get: vi.fn((key: string, cb: (r: Record<string, unknown>) => void) => {
        cb({ [key]: storageData[key] });
      }),
      set: vi.fn((data: Record<string, unknown>, cb: () => void) => {
        Object.assign(storageData, data);
        cb();
      }),
    },
  },
  runtime: { id: 'test-ext-id' },
});

beforeEach(() => {
  Object.keys(storageData).forEach(k => delete storageData[k]);
  vi.clearAllMocks();
});

describe('addGroupToHistory — PII masking', () => {
  it('masks CPF in question before persisting', async () => {
    vi.resetModules();
    const { addGroupToHistory, getHistory } = await import('../history');
    await addGroupToHistory('Meu CPF é 123.456.789-09', {}, 'manual');
    const history = await getHistory();
    const q = (history[0] as { question: string }).question;
    expect(q).not.toContain('123.456.789-09');
    expect(q).toContain('[CPF]');
  });

  it('masks EMAIL in question before persisting', async () => {
    vi.resetModules();
    const { addGroupToHistory, getHistory } = await import('../history');
    await addGroupToHistory('Contato: joao@empresa.com.br por favor', {}, 'manual');
    const history = await getHistory();
    const q = (history[0] as { question: string }).question;
    expect(q).not.toContain('joao@empresa.com.br');
    expect(q).toContain('[EMAIL]');
  });

  it('leaves non-PII text unchanged', async () => {
    vi.resetModules();
    const { addGroupToHistory, getHistory } = await import('../history');
    await addGroupToHistory('Como fazer um bolo de cenoura?', {}, 'manual');
    const history = await getHistory();
    const q = (history[0] as { question: string }).question;
    expect(q).toBe('Como fazer um bolo de cenoura?');
  });
});
