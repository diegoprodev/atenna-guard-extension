// Main DLP detector — orchestrates the full local pipeline.
// Target: < 50ms for inputs up to 10 000 chars.

import type { ScanResult } from './types';
import { scanPatterns } from './patterns';
import { detectSemanticHints, isLowRiskIntent } from './semantic';
import { computeScore } from './scorer';

// Minimum text length worth scanning (avoids noise on short fragments)
const MIN_SCAN_LENGTH = 8;

export function scan(text: string): ScanResult {
  const t0 = performance.now();

  if (!text || text.trim().length < MIN_SCAN_LENGTH) {
    return {
      entities:   [],
      riskLevel:  'NONE',
      score:      0,
      durationMs: 0,
      hasContext: true,
    };
  }

  const entities = scanPatterns(text);
  const hints    = detectSemanticHints(text);
  const { score, riskLevel } = computeScore(entities, hints);

  return {
    entities,
    riskLevel,
    score,
    durationMs: Math.round(performance.now() - t0),
    hasContext: isLowRiskIntent(hints),
  };
}
