import { describe, it, expect } from 'vitest';
import { AppError, E, messageFor } from './errors';

describe('errors.messageFor — FASE 10.9 B1', () => {
  it('AppError(INVALID_CREDENTIALS) → pt-BR, nunca o código cru', () => {
    const msg = messageFor(new AppError(E.INVALID_CREDENTIALS));
    expect(msg).toBe('Email ou senha incorretos. Verifique e tente novamente.');
    expect(msg).not.toContain('INVALID_CREDENTIALS');
  });

  it('AppError(RATE_LIMIT) → aviso de tentativas em pt-BR', () => {
    expect(messageFor(new AppError(E.RATE_LIMIT))).toMatch(/tentativas/i);
  });

  it('AppError(NETWORK) → aviso de conexão', () => {
    expect(messageFor(new AppError(E.NETWORK))).toMatch(/conex|internet/i);
  });

  it('erro desconhecido → fallback genérico pt-BR', () => {
    expect(messageFor(new Error('boom'))).toBe('Algo deu errado. Tente novamente.');
    expect(messageFor('string solta')).toBe('Algo deu errado. Tente novamente.');
  });

  it('nunca devolve string vazia', () => {
    for (const code of Object.values(E)) {
      expect(messageFor(new AppError(code)).length).toBeGreaterThan(5);
    }
  });
});
