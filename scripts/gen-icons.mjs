// scripts/gen-icons.mjs
// Regenera os inner paths em src/ui/icons.ts a partir do pacote `lucide-static`.
// Uso: node scripts/gen-icons.mjs
import lucide from 'lucide-static/lib/index.js';
import { readFileSync, writeFileSync } from 'fs';

// nome interno -> nome Lucide (PascalCase)
const MAP = {
  shield: 'Shield', sparkles: 'Sparkles', fileText: 'FileText', globe: 'Globe',
  check: 'Check', checkCircle: 'CircleCheck', mail: 'Mail', eye: 'Eye', eyeOff: 'EyeOff',
  clock: 'Clock', star: 'Star', settings: 'Settings', upload: 'Upload', wand: 'WandSparkles',
  arrowLeft: 'ArrowLeft', arrowUp: 'ArrowUp', x: 'X', chevronRight: 'ChevronRight',
  chevronDown: 'ChevronDown', logOut: 'LogOut', loader: 'LoaderCircle', alert: 'TriangleAlert',
  folder: 'Folder', chart: 'ChartColumn', badgeCheck: 'BadgeCheck', lock: 'Lock',
  copy: 'Copy', trash: 'Trash2', refresh: 'RefreshCw', send: 'Send', info: 'Info',
};

const entries = Object.entries(MAP).map(([k, v]) => {
  const svg = lucide[v];
  if (!svg) throw new Error(`ícone Lucide ausente: ${v}`);
  const inner = svg
    .replace(/^[\s\S]*?<svg[^>]*>/, '')
    .replace(/<\/svg>\s*$/, '')
    .replace(/\s*\n\s*/g, '')
    .trim();
  return `  ${k}: ${JSON.stringify(inner)},`;
});

const file = readFileSync('src/ui/icons.ts', 'utf-8');
const out = file.replace(
  /const PATHS = \{[\s\S]*?\} as const;/,
  `const PATHS = {\n${entries.join('\n')}\n} as const;`,
);
writeFileSync('src/ui/icons.ts', out);
console.log(`[icons] ✓ ${entries.length} ícones Lucide regenerados em src/ui/icons.ts`);
