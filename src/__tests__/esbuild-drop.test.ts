import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'fs';
import { resolve } from 'path';

const DIST_DIR = resolve(process.cwd(), 'dist');

describe('esbuild.drop - console removal in production builds', () => {
  it('dist/background.js não contém console.log', () => {
    const bgPath = resolve(DIST_DIR, 'background.js');
    if (!existsSync(bgPath)) {
      console.warn('dist/background.js não encontrado — pulando teste');
      return;
    }
    const content = readFileSync(bgPath, 'utf-8');
    expect(content).not.toMatch(/console\.log\s*\(/);
  });

  it('dist/popup.js não contém console.log', () => {
    const popupPath = resolve(DIST_DIR, 'popup.js');
    if (!existsSync(popupPath)) {
      console.warn('dist/popup.js não encontrado — pulando teste');
      return;
    }
    const content = readFileSync(popupPath, 'utf-8');
    expect(content).not.toMatch(/console\.log\s*\(/);
  });

  it('dist/welcome.js não contém console.log', () => {
    const welcomePath = resolve(DIST_DIR, 'welcome.js');
    if (!existsSync(welcomePath)) {
      console.warn('dist/welcome.js não encontrado — pulando teste');
      return;
    }
    const content = readFileSync(welcomePath, 'utf-8');
    expect(content).not.toMatch(/console\.log\s*\(/);
  });

  it('dist/background.js não contém debugger', () => {
    const bgPath = resolve(DIST_DIR, 'background.js');
    if (!existsSync(bgPath)) return;
    const content = readFileSync(bgPath, 'utf-8');
    expect(content).not.toMatch(/\bdebugger\b/);
  });

  it('dist/popup.js não contém debugger', () => {
    const popupPath = resolve(DIST_DIR, 'popup.js');
    if (!existsSync(popupPath)) return;
    const content = readFileSync(popupPath, 'utf-8');
    expect(content).not.toMatch(/\bdebugger\b/);
  });

  it('dist/welcome.js não contém debugger', () => {
    const welcomePath = resolve(DIST_DIR, 'welcome.js');
    if (!existsSync(welcomePath)) return;
    const content = readFileSync(welcomePath, 'utf-8');
    expect(content).not.toMatch(/\bdebugger\b/);
  });
});
