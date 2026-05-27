import { describe, it, expect, vi, beforeEach } from 'vitest';

let _uid: string | null = null;

vi.mock('../scopedStorage', () => ({
  sk: (base: string) => _uid ? `${base}__${_uid}` : base,
  getStorageUser: () => _uid,
}));

const bffTrackDlpMock = vi.fn();
vi.mock('../../auth/bffClient', () => ({
  bffTrackDlp: bffTrackDlpMock,
}));

const storageMock: Record<string, unknown> = {};
vi.stubGlobal('chrome', {
  storage: {
    local: {
      get: vi.fn((key: string, cb: (r: Record<string, unknown>) => void) => {
        cb({ [key]: storageMock[key] });
      }),
      set: vi.fn((obj: Record<string, unknown>, cb?: () => void) => {
        Object.assign(storageMock, obj);
        cb?.();
      }),
    },
  },
});

describe('dlpStats guard', () => {
  beforeEach(() => {
    _uid = null;
    bffTrackDlpMock.mockClear();
    for (const k of Object.keys(storageMock)) delete storageMock[k];
    vi.resetModules();
  });

  it('incrementScan é no-op quando uid é null', async () => {
    _uid = null;
    const { incrementScan } = await import('../dlpStats');
    await incrementScan(['CPF'], 1);
    expect(bffTrackDlpMock).not.toHaveBeenCalled();
    expect(Object.keys(storageMock)).toHaveLength(0);
  });

  it('incrementProtected é no-op quando uid é null', async () => {
    _uid = null;
    const { incrementProtected } = await import('../dlpStats');
    await incrementProtected(100, ['EMAIL'], 2);
    expect(bffTrackDlpMock).not.toHaveBeenCalled();
    expect(Object.keys(storageMock)).toHaveLength(0);
  });

  it('incrementScan funciona normalmente quando uid está setado', async () => {
    _uid = 'user-123';
    const { incrementScan } = await import('../dlpStats');
    await incrementScan(['CPF'], 1);
    expect(bffTrackDlpMock).toHaveBeenCalledWith({
      event_type: 'dlp_scan',
      entity_types: ['CPF'],
      entity_count: 1,
    });
    expect(Object.keys(storageMock).some(k => k.includes('user-123'))).toBe(true);
  });

  it('incrementProtected funciona normalmente quando uid está setado', async () => {
    _uid = 'user-123';
    const { incrementProtected } = await import('../dlpStats');
    await incrementProtected(50, ['EMAIL'], 1);
    expect(bffTrackDlpMock).toHaveBeenCalledWith({
      event_type: 'dlp_protect',
      entity_types: ['EMAIL'],
      entity_count: 1,
      was_rewritten: true,
    });
  });
});
