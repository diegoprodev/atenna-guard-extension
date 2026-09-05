import { describe, it, expect } from 'vitest';
import { scanPatterns } from '../patterns';
import { rewritePII } from '../rewriter';

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

describe('scanPatterns — NAME_LOWER removal + CEP contextual label', () => {
  it('does not detect lowercase common words as names ("meu erro de lógica")', () => {
    const result = scanPatterns('meu erro de lógica');
    expect(result.filter(e => e.type === 'NAME')).toEqual([]);
  });

  it('does not detect CEP without label ("12345-678" alone)', () => {
    const result = scanPatterns('12345-678');
    expect(result.filter(e => e.type === 'ADDRESS')).toEqual([]);
  });

  it('detects CEP with label ("CEP: 12345-678")', () => {
    const result = scanPatterns('CEP: 12345-678');
    const cep = result.find(e => e.type === 'ADDRESS');
    expect(cep).toBeDefined();
    expect(cep?.value).toMatch(/CEP.*12345-678/i);
  });

  it('detects CEP with spacing ("CEP 12345 678")', () => {
    const result = scanPatterns('CEP 12345 678');
    const cep = result.find(e => e.type === 'ADDRESS');
    expect(cep).toBeDefined();
  });
});

describe('scanPatterns — PIX chave aleatória', () => {
  it('should detect PIX chave aleatória with label "chave pix:"', () => {
    const result = scanPatterns('minha chave pix: a1b2c3d4-e5f6-7890-abcd-ef1234567890');
    const pix = result.filter(m => m.type === 'PIX');
    expect(pix.length).toBeGreaterThan(0);
  });

  it('should detect PIX with label "pix:"', () => {
    const result = scanPatterns('pix: a1b2c3d4-e5f6-7890-abcd-ef1234567890');
    const pix = result.filter(m => m.type === 'PIX');
    expect(pix.length).toBeGreaterThan(0);
  });

  it('should NOT detect bare UUID as PIX without label', () => {
    const result = scanPatterns('id: a1b2c3d4-e5f6-7890-abcd-ef1234567890');
    const pix = result.filter(m => m.type === 'PIX');
    expect(pix).toHaveLength(0);
  });

  it('should rewrite PIX chave with [PIX] token', () => {
    const text = 'minha chave pix: a1b2c3d4-e5f6-7890-abcd-ef1234567890';
    const entities = scanPatterns(text).filter(m => m.type === 'PIX');
    expect(entities.length).toBeGreaterThan(0);
    const rewritten = rewritePII(text, entities);
    expect(rewritten).toContain('[PIX]');
    expect(rewritten).not.toContain('a1b2c3d4');
  });
});

// FASE 10.9.4 — "sempre no DLP, quando houver um rótulo/abreviação (RG, CPF,
// CNPJ, OAB, CREA, CREF, CRM, conta, tel...) seguido de sequência numérica,
// tem que ser identificado" (achado real: "tel 8331234567" não batia no
// regex de telefone com formato fixo/DDD).
describe('scanPatterns — rótulo + número (achado real do dono: "tel <número>")', () => {
  it('detects phone abbreviation "tel" + raw digit run without DDD/formatting', () => {
    const result = scanPatterns('me liga no tel 8331234567 assim que puder');
    const phone = result.find(e => e.type === 'PHONE' && /8331234567/.test(e.value));
    expect(phone).toBeDefined();
  });

  it('does not swallow trailing text after the labeled phone number', () => {
    const result = scanPatterns('tempo de deslocamento tel 8331234567 (voos, traslados)');
    const phone = result.find(e => e.type === 'PHONE' && /8331234567/.test(e.value));
    expect(phone).toBeDefined();
    expect(phone!.value).not.toMatch(/voos/);
  });

  it('detects "whatsapp:" + digits', () => {
    const result = scanPatterns('whatsapp: 999998888 pra contato');
    expect(result.some(e => e.type === 'PHONE' && /999998888/.test(e.value))).toBe(true);
  });

  it('detects "cel" abbreviation + digits', () => {
    const result = scanPatterns('cel 92233-4455');
    expect(result.some(e => e.type === 'PHONE')).toBe(true);
  });

  it('does not detect a bare unlabeled short number as phone via the label pattern', () => {
    // sem rótulo, esse trecho já não bate no regex de rótulo (só no genérico existente, se aplicável)
    const result = scanPatterns('reunião às 14h32');
    expect(result.some(e => e.type === 'PHONE')).toBe(false);
  });

  it('detects CREF with explicit label', () => {
    const result = scanPatterns('meu CREF: 012345-G/SP');
    expect(result.some(e => e.type === 'CREF')).toBe(true);
  });

  it('does not detect CREF without the label', () => {
    const result = scanPatterns('código 012345-G/SP');
    expect(result.some(e => e.type === 'CREF')).toBe(false);
  });

  it('detects bank account with "número da conta" label', () => {
    const result = scanPatterns('número da conta: 00112233-4');
    expect(result.some(e => e.type === 'BANK_ACCOUNT')).toBe(true);
  });

  it('detects bank account with bare "conta" label', () => {
    const result = scanPatterns('minha conta 98765432');
    expect(result.some(e => e.type === 'BANK_ACCOUNT')).toBe(true);
  });

  it('does not detect a bank account without any label', () => {
    const result = scanPatterns('paguei 98765432 no boleto');
    expect(result.some(e => e.type === 'BANK_ACCOUNT')).toBe(false);
  });
});
