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

  it('dist/manifest.json usa project ref específico do Supabase', () => {
    if (!existsSync(DIST_MANIFEST)) return;
    const manifest = JSON.parse(readFileSync(DIST_MANIFEST, 'utf-8'));
    expect(manifest.host_permissions).not.toContain('https://*.supabase.co/*');
    expect(manifest.host_permissions).toContain('https://kezbssjmgwtrunqeoyir.supabase.co/*');
  });

  it('manifest.json fonte tem homepage_url válida', () => {
    const src = JSON.parse(readFileSync(resolve(process.cwd(), 'manifest.json'), 'utf-8'));
    expect(src.homepage_url).toBeTruthy();
    expect(src.homepage_url).toMatch(/^https:\/\//);
  });

  it('FASE B13.2 — permissões mínimas: activeTab no lugar de tabs', () => {
    const src = JSON.parse(readFileSync(resolve(process.cwd(), 'manifest.json'), 'utf-8'));
    // `tabs` gera o aviso "Ler seu histórico de navegação" na instalação
    expect(src.permissions).not.toContain('tabs');
    expect(src.permissions).toContain('activeTab');
    expect(src.permissions).toContain('storage');
    expect(src.permissions).toContain('identity');
  });

  it('FASE B13.2 — chat.openai.com (legado) fora do manifest', () => {
    const src = JSON.parse(readFileSync(resolve(process.cwd(), 'manifest.json'), 'utf-8'));
    const all = [
      ...(src.host_permissions ?? []),
      ...(src.content_scripts?.[0]?.matches ?? []),
      ...(src.web_accessible_resources?.[0]?.matches ?? []),
    ];
    expect(all.some((p: string) => p.includes('chat.openai.com'))).toBe(false);
    expect(all.some((p: string) => p.includes('chatgpt.com'))).toBe(true);
  });
});
