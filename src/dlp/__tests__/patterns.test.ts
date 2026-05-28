import { describe, it, expect } from 'vitest';
import { scanPatterns } from '../patterns';

describe('scanPatterns — regex reuse', () => {
  it('detects CPF correctly after multiple calls', () => {
    const r1 = scanPatterns('Meu CPF é 123.456.789-09');
    const r2 = scanPatterns('CPF: 123.456.789-09 obrigado');
    expect(r1.some(e => e.type === 'CPF')).toBe(true);
    expect(r2.some(e => e.type === 'CPF')).toBe(true);
  });

  it('detects EMAIL correctly on successive calls', () => {
    const r1 = scanPatterns('email: joao@empresa.com.br');
    const r2 = scanPatterns('contato: maria@test.org e joao@empresa.com.br');
    expect(r1.some(e => e.type === 'EMAIL')).toBe(true);
    expect(r2.filter(e => e.type === 'EMAIL').length).toBe(2);
  });

  it('detects PHONE correctly on successive calls', () => {
    const r1 = scanPatterns('Meu telefone é (11) 98765-4321');
    const r2 = scanPatterns('Ligue (21) 3456-7890 agora');
    expect(r1.some(e => e.type === 'PHONE')).toBe(true);
    expect(r2.some(e => e.type === 'PHONE')).toBe(true);
  });
});
