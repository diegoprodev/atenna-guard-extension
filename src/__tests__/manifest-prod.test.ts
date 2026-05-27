import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'fs';
import { resolve } from 'path';

const DIST_MANIFEST = resolve(process.cwd(), 'dist/manifest.json');

describe('manifest.json de produção', () => {
  it('dist/manifest.json não contém localhost nem 127.0.0.1', () => {
    if (!existsSync(DIST_MANIFEST)) {
      console.warn('dist/manifest.json não encontrado — pulando teste de produção');
      return;
    }
    const manifest = JSON.parse(readFileSync(DIST_MANIFEST, 'utf-8'));
    const allPerms = [
      ...(manifest.host_permissions ?? []),
      ...(manifest.content_scripts?.[0]?.matches ?? []),
    ];
    expect(allPerms.some((p: string) => p.includes('localhost'))).toBe(false);
    expect(allPerms.some((p: string) => p.includes('127.0.0.1'))).toBe(false);
  });

  it('manifest.json fonte pode conter localhost', () => {
    const src = JSON.parse(readFileSync(resolve(process.cwd(), 'manifest.json'), 'utf-8'));
    expect(Array.isArray(src.host_permissions)).toBe(true);
  });
});
