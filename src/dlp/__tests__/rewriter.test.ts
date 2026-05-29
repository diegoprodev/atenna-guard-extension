import { describe, it, expect } from 'vitest';
import { rewritePII } from '../rewriter';
import { scanPatterns } from '../patterns';

describe('rewritePII — PLACA and PIS token mapping', () => {
  it('rewrites PLACA with correct token', () => {
    const text = 'Placa ABC1D23';
    const entities = scanPatterns(text);
    const result = rewritePII(text, entities);
    expect(result).toContain('[PLACA]');
    expect(result).not.toContain('ABC1D23');
  });

  it('rewrites PIS with correct token using formatted PIS', () => {
    // PIS pattern expects: PIS [label] DDD.DDDDD.DD-D format
    const text = 'PIS 170.33259.50-4';
    const entities = scanPatterns(text);
    const result = rewritePII(text, entities);
    expect(result).toContain('[PIS]');
    expect(result).not.toContain('170.33259.50-4');
  });

  it('rewrites PLACA in old format (ABC-1234)', () => {
    const text = 'Placa ABC-1234';
    const entities = scanPatterns(text);
    const result = rewritePII(text, entities);
    expect(result).toContain('[PLACA]');
    expect(result).not.toContain('ABC-1234');
  });

  it('handles empty entity list gracefully', () => {
    const text = 'Texto sem dados sensíveis';
    const result = rewritePII(text, []);
    expect(result).toBe(text);
  });
});
