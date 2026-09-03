#!/usr/bin/env node
/**
 * Ratchet de cobertura: falha se a cobertura nova cair abaixo do baseline
 * (com margem de 0.5 p/ ruído). Se subir >= 1 ponto, avisa p/ atualizar o baseline.
 *
 *   node scripts/coverage-ratchet.mjs <pct-atual> <arquivo-baseline>
 */
import { readFileSync, existsSync } from 'node:fs';

const [pctRaw, baselineFile] = process.argv.slice(2);
const pct = parseFloat(pctRaw);
if (Number.isNaN(pct)) { console.error(`cobertura inválida: "${pctRaw}"`); process.exit(2); }

const baseline = existsSync(baselineFile) ? parseFloat(readFileSync(baselineFile, 'utf8')) : 0;
const MARGIN = 0.5;

console.log(`cobertura: ${pct.toFixed(2)}%  ·  baseline: ${baseline.toFixed(2)}%`);

if (pct < baseline - MARGIN) {
  console.error(`❌ cobertura caiu ${(baseline - pct).toFixed(2)} pontos. Adicione teste ou justifique.`);
  process.exit(1);
}
if (pct >= baseline + 1) {
  console.log(`⬆️  subiu ${(pct - baseline).toFixed(2)} pontos — atualize ${baselineFile} p/ ${pct.toFixed(1)}`);
}
console.log('✅ ratchet ok');
