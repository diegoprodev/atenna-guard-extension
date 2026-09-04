import { describe, it, expect, vi, beforeEach } from 'vitest';
import { getAutoGenStyle, saveAutoGenStyle, autoGenStyleKey, DEFAULT_AUTOGEN } from './userSettings';
import { setStorageUser } from './scopedStorage';

const store: Record<string, unknown> = {};
vi.stubGlobal('chrome', {
  storage: { local: {
    get: vi.fn((k: string, cb: (r: Record<string, unknown>) => void) => cb({ [k]: store[k] })),
    set: vi.fn((d: Record<string, unknown>, cb?: () => void) => { Object.assign(store, d); cb?.(); }),
  } },
});
beforeEach(() => { Object.keys(store).forEach(k => delete store[k]); setStorageUser('u1'); });

describe('userSettings.autoGenStyle — FASE 10.9.2 B10', () => {
  it('default é "ask"', async () => {
    expect(DEFAULT_AUTOGEN).toBe('ask');
    expect(await getAutoGenStyle()).toBe('ask');
  });

  it('salva e lê', async () => {
    await saveAutoGenStyle('structured');
    expect(await getAutoGenStyle()).toBe('structured');
  });

  it('autoGenStyleKey mapeia pro campo do payload (strategic → technical)', () => {
    expect(autoGenStyleKey('ask')).toBeNull();
    expect(autoGenStyleKey('direct')).toBe('direct');
    expect(autoGenStyleKey('structured')).toBe('structured');
    expect(autoGenStyleKey('strategic')).toBe('technical');
  });

  it('é escopado por usuário', async () => {
    setStorageUser('u1');
    await saveAutoGenStyle('direct');
    setStorageUser('u2');
    expect(await getAutoGenStyle()).toBe('ask');
  });
});
