// scripts/add-localhost-e2e.mjs
// Restores localhost patterns in dist/manifest.json for E2E testing.
// Production builds strip these via strip-localhost.mjs (for Chrome Web Store compliance).
// E2E tests run on http://localhost:4200 — the content script must be injected there.
import { readFileSync, writeFileSync } from 'fs';
import { resolve } from 'path';

const MANIFEST_PATH = resolve('dist/manifest.json');
const LOCAL_PATTERNS = ['http://localhost/*', 'http://127.0.0.1/*'];

const manifest = JSON.parse(readFileSync(MANIFEST_PATH, 'utf-8'));

// Add localhost to host_permissions (deduped)
const existingHP = manifest.host_permissions ?? [];
manifest.host_permissions = [
  ...existingHP.filter(p => !LOCAL_PATTERNS.includes(p)),
  ...LOCAL_PATTERNS,
];

// Add localhost to content_scripts matches (deduped)
if (manifest.content_scripts?.[0]?.matches) {
  const existing = manifest.content_scripts[0].matches;
  manifest.content_scripts[0].matches = [
    ...existing.filter(p => !LOCAL_PATTERNS.includes(p)),
    ...LOCAL_PATTERNS,
  ];
}

writeFileSync(MANIFEST_PATH, JSON.stringify(manifest, null, 2));
console.log('[e2e] ✓ localhost restaurado no dist/manifest.json para testes E2E');
