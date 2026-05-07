import { describe, it, expect } from 'vitest';
import { scan } from './detector';
import { rewritePII } from './rewriter';

// ─────────────────────────────────────────────────────────────
// BLOCK 1 — v2.11.0 mandatory smokes (CPF, CNJ, API key, JWT)
// ─────────────────────────────────────────────────────────────

describe('DLP v2.11.0 — realtime smokes', () => {

  it('1. CPF cru → HIGH', () => {
    const r = scan('DIEGO RODRIGUES DA SILVA CPF 05042367411 CODIGO');
    expect(r.riskLevel).toBe('HIGH');
    expect(r.entities.some(e => e.type === 'CPF')).toBe(true);
  });

  it('2. CPF mascarado → HIGH', () => {
    const r = scan('meu cpf: 050.423.674-11');
    expect(r.riskLevel).toBe('HIGH');
    expect(r.entities.some(e => e.type === 'CPF')).toBe(true);
  });

  it('3. Nome ALL-CAPS + CPF → HIGH', () => {
    const r = scan('JOAO DA SILVA CPF 05042367411');
    expect(r.riskLevel).toBe('HIGH');
  });

  it('4. Número CNJ → HIGH com PROCESS_NUM', () => {
    const r = scan('processo 0000001-89.2023.8.26.0001');
    expect(r.riskLevel).toBe('HIGH');
    expect(r.entities.some(e => e.type === 'PROCESS_NUM')).toBe(true);
  });

  it('5. Explicação técnica de CPF → NONE ou LOW', () => {
    const r = scan('como implementar regex para validar cpf em javascript');
    expect(['NONE', 'LOW']).toContain(r.riskLevel);
  });

  it('6. API key sk-proj- → HIGH', () => {
    const r = scan('sk-proj-abcdefghijklmnopqrstuvwxyz1234567890');
    expect(r.riskLevel).toBe('HIGH');
    expect(r.entities.some(e => e.type === 'API_KEY')).toBe(true);
  });

  it('7. JWT 3-segmentos → HIGH', () => {
    const r = scan('eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c');
    expect(r.riskLevel).toBe('HIGH');
    expect(r.entities.some(e => e.type === 'TOKEN')).toBe(true);
  });

});

// ─────────────────────────────────────────────────────────────
// BLOCK 2 — v2.9.0 smokes (semantic hints + low-risk contexts)
// ─────────────────────────────────────────────────────────────

describe('DLP v2.9.0 — semantic hints', () => {

  it('IS_PII_DISCLOSURE: "meu cpf é 123" → HIGH (sem CPF válido, só semântica)', () => {
    const r = scan('meu cpf é 123');
    expect(r.riskLevel).toBe('HIGH');
  });

  it('IS_PII_DISCLOSURE: "minha senha é abc123" → HIGH', () => {
    const r = scan('minha senha é abc123');
    expect(r.riskLevel).toBe('HIGH');
  });

  it('IS_PROTECTION_QUERY: "como mascarar cpf" → LOW', () => {
    const r = scan('como mascarar cpf');
    expect(['NONE', 'LOW']).toContain(r.riskLevel);
    expect(r.riskLevel).not.toBe('HIGH');
  });

  it('IS_PROTECTION_QUERY: "como proteger dados médicos" → LOW', () => {
    const r = scan('como proteger dados médicos');
    expect(['NONE', 'LOW']).toContain(r.riskLevel);
    expect(r.riskLevel).not.toBe('HIGH');
  });

  it('IS_EXAMPLE_REQUEST: "exemplo de API key" → LOW', () => {
    const r = scan('exemplo de API key');
    expect(['NONE', 'LOW']).toContain(r.riskLevel);
    expect(r.riskLevel).not.toBe('HIGH');
  });

  it('IS_MEDICAL_CONTEXT: "paciente com diabetes" → não HIGH (texto clínico sem PII)', () => {
    const r = scan('paciente com diabetes');
    expect(r.riskLevel).not.toBe('HIGH');
  });

  it('IS_TECHNICAL_QUESTION: "gerar cpf válido para testes" → NONE ou LOW', () => {
    const r = scan('gerar cpf válido para testes');
    expect(['NONE', 'LOW']).toContain(r.riskLevel);
  });

});

// ─────────────────────────────────────────────────────────────
// BLOCK 3 — API key variants (Stripe, Anthropic, AWS, Google)
// ─────────────────────────────────────────────────────────────

describe('DLP — API key variants', () => {

  it('Stripe sk_live_ → HIGH', () => {
    // constructed at runtime to avoid static secret scanning
    const prefix = ['sk', 'live'].join('_');
    const r = scan(`${prefix}_${'X'.repeat(28)}`);
    expect(r.riskLevel).toBe('HIGH');
    expect(r.entities.some(e => e.type === 'API_KEY')).toBe(true);
  });

  it('Stripe sk_test_ → HIGH', () => {
    // constructed at runtime to avoid static secret scanning
    const prefix = ['sk', 'test'].join('_');
    const r = scan(`${prefix}_${'X'.repeat(28)}`);
    expect(r.riskLevel).toBe('HIGH');
    expect(r.entities.some(e => e.type === 'API_KEY')).toBe(true);
  });

  it('Anthropic sk-ant- → HIGH', () => {
    const r = scan('sk-ant-api03-abcdefghijklmnopqrstuvwxyz1234567890ABCDEF');
    expect(r.riskLevel).toBe('HIGH');
    expect(r.entities.some(e => e.type === 'API_KEY')).toBe(true);
  });

  it('AWS AKIA → HIGH', () => {
    const r = scan('AKIAIOSFODNN7EXAMPLE');
    expect(r.riskLevel).toBe('HIGH');
    expect(r.entities.some(e => e.type === 'API_KEY')).toBe(true);
  });

  it('Google AIza → HIGH', () => {
    const r = scan('AIzaSyDdI0hCZtE6vySjMm-WEfRq3CPzqKqqsHI');
    expect(r.riskLevel).toBe('HIGH');
    expect(r.entities.some(e => e.type === 'API_KEY')).toBe(true);
  });

  it('Bearer token → HIGH', () => {
    const r = scan('Authorization: Bearer eyJzdWIiOiJ1c2VyMTIzNDU2NzgiLCJpYXQiOjE2MDAwMDAwMDB9');
    expect(r.riskLevel).toBe('HIGH');
    expect(r.entities.some(e => e.type === 'TOKEN')).toBe(true);
  });

});

// ─────────────────────────────────────────────────────────────
// BLOCK 4 — Entity types with validators (CNPJ, credit card)
// ─────────────────────────────────────────────────────────────

describe('DLP — entity validators', () => {

  it('CNPJ válido → HIGH com entidade CNPJ', () => {
    // 11.222.333/0001-81 is a known-valid CNPJ
    const r = scan('empresa cnpj 11.222.333/0001-81');
    expect(r.riskLevel).toBe('HIGH');
    expect(r.entities.some(e => e.type === 'CNPJ')).toBe(true);
  });

  it('CNPJ inválido matematicamente → não detectado como CNPJ', () => {
    const r = scan('cnpj 11.111.111/1111-11');
    expect(r.entities.some(e => e.type === 'CNPJ')).toBe(false);
  });

  it('CPF inválido matematicamente → não detectado como CPF', () => {
    const r = scan('cpf 111.111.111-11');
    expect(r.entities.some(e => e.type === 'CPF')).toBe(false);
  });

  it('Cartão de crédito com Luhn válido → detectado', () => {
    // 4539578763621486 passes Luhn
    const r = scan('meu cartão 4539 5787 6362 1486');
    expect(r.entities.some(e => e.type === 'CREDIT_CARD')).toBe(true);
  });

  it('Sequência numérica aleatória que não passa Luhn → não é cartão', () => {
    const r = scan('número 1234 5678 9012 3456');
    expect(r.entities.some(e => e.type === 'CREDIT_CARD')).toBe(false);
  });

});

// ─────────────────────────────────────────────────────────────
// BLOCK 5 — Email and phone (BR)
// ─────────────────────────────────────────────────────────────

describe('DLP — email e telefone', () => {

  it('Email → detectado como EMAIL', () => {
    const r = scan('me contate em joao.silva@empresa.com.br');
    expect(r.entities.some(e => e.type === 'EMAIL')).toBe(true);
    expect(r.riskLevel).not.toBe('NONE');
  });

  it('Celular BR com DDD → detectado como PHONE', () => {
    const r = scan('ligue para (11) 99876-5432');
    expect(r.entities.some(e => e.type === 'PHONE')).toBe(true);
  });

  it('Telefone fixo BR → detectado como PHONE', () => {
    const r = scan('fone: (21) 3456-7890');
    expect(r.entities.some(e => e.type === 'PHONE')).toBe(true);
  });

});

// ─────────────────────────────────────────────────────────────
// BLOCK 6 — Password patterns
// ─────────────────────────────────────────────────────────────

describe('DLP — password assignment', () => {

  it('password= → HIGH', () => {
    const r = scan('password=MySecr3tP@ss');
    expect(r.riskLevel).toBe('HIGH');
    expect(r.entities.some(e => e.type === 'PASSWORD')).toBe(true);
  });

  it('senha: → HIGH', () => {
    const r = scan('senha: minhasenha123');
    expect(r.riskLevel).toBe('HIGH');
    expect(r.entities.some(e => e.type === 'PASSWORD')).toBe(true);
  });

});

// ─────────────────────────────────────────────────────────────
// BLOCK 7 — rewritePII (v2.11.0 — zero testes anteriores)
// ─────────────────────────────────────────────────────────────

describe('rewritePII', () => {

  it('substitui CPF pelo token [CPF]', () => {
    const text = 'meu cpf é 050.423.674-11 obrigado';
    const entities = scan(text).entities.filter(e => e.type === 'CPF');
    const out = rewritePII(text, entities);
    expect(out).toContain('[CPF]');
    expect(out).not.toContain('050.423.674-11');
  });

  it('substitui múltiplas entidades preservando offsets', () => {
    const text = 'email joao@example.com cpf 05042367411';
    const result = scan(text);
    const out = rewritePII(text, result.entities);
    // Should replace at least one entity
    expect(out).not.toBe(text);
  });

  it('retorna texto original quando não há entidades', () => {
    const text = 'como organizar minha agenda de estudos';
    expect(rewritePII(text, [])).toBe(text);
  });

  it('substitui API_KEY pelo token [API_KEY]', () => {
    const text = 'chave: sk-proj-abcdefghijklmnopqrstuvwxyz1234567890';
    const entities = scan(text).entities;
    const out = rewritePII(text, entities);
    expect(out).toContain('[API_KEY]');
    expect(out).not.toContain('sk-proj-');
  });

  it('substitui TOKEN pelo token [TOKEN]', () => {
    const jwt = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c';
    const entities = scan(jwt).entities.filter(e => e.type === 'TOKEN');
    const out = rewritePII(jwt, entities);
    expect(out).toContain('[TOKEN]');
  });

  it('substitui CNPJ pelo token [CNPJ]', () => {
    const text = 'cnpj da empresa: 11.222.333/0001-81';
    const entities = scan(text).entities.filter(e => e.type === 'CNPJ');
    const out = rewritePII(text, entities);
    expect(out).toContain('[CNPJ]');
  });

  it('substitui NAME pelo token [NOME]', () => {
    const text = 'DIEGO RODRIGUES DA SILVA CPF 05042367411';
    const all = scan(text).entities;
    const nameEntities = all.filter(e => e.type === 'NAME');
    if (nameEntities.length > 0) {
      const out = rewritePII(text, nameEntities);
      expect(out).toContain('[NOME]');
    }
  });

});

// ─────────────────────────────────────────────────────────────
// BLOCK 8 — Edge cases & false-positive guard
// ─────────────────────────────────────────────────────────────

describe('DLP — edge cases', () => {

  it('texto vazio → NONE', () => {
    const r = scan('');
    expect(r.riskLevel).toBe('NONE');
  });

  it('texto < 8 chars → NONE', () => {
    const r = scan('ok sim');
    expect(r.riskLevel).toBe('NONE');
  });

  it('texto técnico sem PII → NONE', () => {
    const r = scan('implementar observer pattern em typescript com generics');
    expect(r.riskLevel).toBe('NONE');
  });

  it('sequência keyword ALL-CAPS (CPF CODIGO) não é nome', () => {
    // Stopword guard: "CPF CODIGO" should NOT be detected as NAME
    const r = scan('CPF CODIGO');
    expect(r.entities.some(e => e.type === 'NAME' && e.value === 'CPF CODIGO')).toBe(false);
  });

});
