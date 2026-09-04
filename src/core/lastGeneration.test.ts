import { describe, it, expect, vi, beforeEach } from 'vitest';
import { normalizeForCompare, signatureOf, isSameAsLastGeneration, setLastGenSignature } from './lastGeneration';
import { setStorageUser } from './scopedStorage';

const store: Record<string, unknown> = {};
vi.stubGlobal('chrome', {
  storage: { local: {
    get: vi.fn((k: string, cb: (r: Record<string, unknown>) => void) => cb({ [k]: store[k] })),
    set: vi.fn((d: Record<string, unknown>, cb: () => void) => { Object.assign(store, d); cb(); }),
  } },
});

beforeEach(() => { Object.keys(store).forEach(k => delete store[k]); setStorageUser('u1'); });

describe('lastGeneration — FASE 10.9.2 B7/B8', () => {
  it('normaliza: caixa, espaços, pontuação', () => {
    expect(normalizeForCompare('  Meu   Projeto!! ')).toBe('meu projeto');
  });

  it('pré-DLP e pós-DLP normalizam igual', () => {
    const cru = normalizeForCompare('meu CPF é 123.456.789-00 e preciso de ajuda');
    const dlp = normalizeForCompare('meu CPF é [CPF] e preciso de ajuda');
    expect(cru).toBe(dlp);
  });

  it('assinatura estável e igual pra conteúdo equivalente', () => {
    const a = signatureOf('Escreve um email formal pro RH');
    const b = signatureOf('escreve um email   formal pro rh.');
    expect(a).toBe(b);
    expect(a).not.toBe('');
  });

  it('texto muito curto → sem assinatura (não conta como "gerado antes")', () => {
    expect(signatureOf('oi')).toBe('');
  });

  it('isSameAsLastGeneration: bate depois de salvar, mesmo com DLP no meio', async () => {
    await setLastGenSignature(signatureOf('meu CPF é 111.222.333-44, resuma isso'));
    expect(await isSameAsLastGeneration('meu CPF é [CPF], resuma isso')).toBe(true);
    expect(await isSameAsLastGeneration('outra pergunta totalmente diferente aqui')).toBe(false);
  });

  it('assinatura é escopada por usuário', async () => {
    setStorageUser('u1');
    await setLastGenSignature(signatureOf('pergunta do usuario A sobre contratos'));
    setStorageUser('u2');
    expect(await isSameAsLastGeneration('pergunta do usuario A sobre contratos')).toBe(false);
  });
});
