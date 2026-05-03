import { describe, it, expect } from 'vitest';
import { generatePrompts } from './promptEngine';

describe('generatePrompts', () => {
  it('returns exactly 3 variants', () => {
    const variants = generatePrompts('Hello');
    expect(variants).toHaveLength(3);
  });

  it('returns Direto, Técnico, Estruturado types', () => {
    const types = generatePrompts('test').map(v => v.type);
    expect(types).toEqual(['Direto', 'Técnico', 'Estruturado']);
  });

  it('Direto includes original input', () => {
    const v = generatePrompts('minha pergunta').find(v => v.type === 'Direto')!;
    expect(v.text).toContain('minha pergunta');
    expect(v.text).toContain('clara');
  });

  it('Técnico includes original input and technical context', () => {
    const v = generatePrompts('minha pergunta').find(v => v.type === 'Técnico')!;
    expect(v.text).toContain('minha pergunta');
    expect(v.text).toContain('técnica');
  });

  it('Estruturado includes original input and sections', () => {
    const v = generatePrompts('minha pergunta').find(v => v.type === 'Estruturado')!;
    expect(v.text).toContain('minha pergunta');
    expect(v.text).toContain('Contexto');
    expect(v.text).toContain('Solução');
  });

  it('handles empty input gracefully', () => {
    const variants = generatePrompts('');
    expect(variants).toHaveLength(3);
    variants.forEach(v => expect(v.text.length).toBeGreaterThan(0));
  });

  it('each variant has label and description', () => {
    generatePrompts('test').forEach(v => {
      expect(v.label).toBeTruthy();
      expect(v.description).toBeTruthy();
    });
  });
});
