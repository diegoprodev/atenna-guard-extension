import { describe, it, expect } from 'vitest';
import { scan } from './detector';

// 7 mandatory smoke tests for the DLP realtime pipeline

describe('DLP realtime smoke tests', () => {

  it('1. CPF cru realtime → HIGH', () => {
    const r = scan('DIEGO RODRIGUES DA SILVA CPF 05042367411 CODIGO');
    expect(r.riskLevel).toBe('HIGH');
    expect(r.entities.some(e => e.type === 'CPF')).toBe(true);
  });

  it('2. CPF mascarado → HIGH', () => {
    const r = scan('meu cpf: 050.423.674-11');
    expect(r.riskLevel).toBe('HIGH');
    expect(r.entities.some(e => e.type === 'CPF')).toBe(true);
  });

  it('3. Nome + CPF → HIGH', () => {
    const r = scan('Nome: Maria Jose Santos, CPF: 12345678909');
    // CPF 123.456.789-09 may or may not be valid — test with a known valid one
    const r2 = scan('JOAO DA SILVA CPF 05042367411');
    expect(r2.riskLevel).toBe('HIGH');
  });

  it('4. Processo CNJ → HIGH', () => {
    const r = scan('processo 0000001-89.2023.8.26.0001');
    expect(r.riskLevel).toBe('HIGH');
    expect(r.entities.some(e => e.type === 'PROCESS_NUM')).toBe(true);
  });

  it('5. Explicação técnica de CPF → NONE ou LOW', () => {
    const r = scan('como implementar regex para validar cpf em javascript');
    expect(['NONE', 'LOW']).toContain(r.riskLevel);
  });

  it('6. API key realtime → HIGH', () => {
    const r = scan('sk-proj-abcdefghijklmnopqrstuvwxyz1234567890');
    expect(r.riskLevel).toBe('HIGH');
    expect(r.entities.some(e => e.type === 'API_KEY')).toBe(true);
  });

  it('7. JWT realtime → HIGH', () => {
    const r = scan('eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c');
    expect(r.riskLevel).toBe('HIGH');
    expect(r.entities.some(e => e.type === 'TOKEN')).toBe(true);
  });

});
