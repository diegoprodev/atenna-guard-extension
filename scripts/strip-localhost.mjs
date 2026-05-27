// scripts/strip-localhost.mjs
import { readFileSync, writeFileSync } from 'fs';
import { resolve } from 'path';

const MANIFEST_PATH = resolve('dist/manifest.json');
const LOCAL_PATTERNS = ['http://localhost/*', 'http://127.0.0.1/*'];

const manifest = JSON.parse(readFileSync(MANIFEST_PATH, 'utf-8'));

manifest.host_permissions = (manifest.host_permissions ?? []).filter(
  (p) => !LOCAL_PATTERNS.includes(p)
);

if (manifest.content_scripts?.[0]?.matches) {
  manifest.content_scripts[0].matches = manifest.content_scripts[0].matches.filter(
    (p) => !LOCAL_PATTERNS.includes(p)
  );
}

writeFileSync(MANIFEST_PATH, JSON.stringify(manifest, null, 2));
console.log('[build] ✓ localhost removido do dist/manifest.json');
