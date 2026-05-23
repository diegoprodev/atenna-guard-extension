import { describe, it, expect } from 'vitest';
import fs from 'fs';

describe('popup.ts — no Copilot references', () => {
  it('SUPPORTED_HOSTS should not include copilot', () => {
    const src = fs.readFileSync('src/popup.ts', 'utf-8');
    expect(src).not.toContain('copilot.microsoft.com');
    expect(src).not.toContain("'Copilot'");
  });
});
