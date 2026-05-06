// Risk scoring — combines entity detection with semantic context.
// Outputs a 0-100 score and a RiskLevel enum.

import type { DetectedEntity, RiskLevel } from './types';
import type { SemanticHint } from './semantic';
import { isLowRiskIntent, isHighRiskIntent } from './semantic';

const ENTITY_BASE_SCORES: Record<string, number> = {
  API_KEY:     90,
  TOKEN:       85,
  PASSWORD:    85,
  CPF:         75,
  CNPJ:        70,
  CREDIT_CARD: 75,
  EMAIL:       40,
  PHONE:       40,
  ADDRESS:     30,
  MEDICAL:     55,
  LEGAL:       50,
  GENERIC_PII: 35,
};

// Bonuses/penalties based on semantic intent
const INTENT_MULTIPLIER: Partial<Record<SemanticHint, number>> = {
  IS_TECHNICAL_QUESTION:  0.10, // "como validar CPF em JS" → drastically reduce
  IS_PROTECTION_QUERY:    0.15,
  IS_REGULATORY_QUESTION: 0.10,
  IS_EXAMPLE_REQUEST:     0.20,
  IS_REAL_DATA:           1.30, // "meu CPF é..." → increase
  IS_MEDICAL_CONTEXT:     1.20,
  IS_LEGAL_CONTEXT:       1.15,
};

function scoreToLevel(score: number): RiskLevel {
  if (score <= 0)  return 'NONE';
  if (score < 30)  return 'LOW';
  if (score < 65)  return 'MEDIUM';
  return 'HIGH';
}

export function computeScore(
  entities:  DetectedEntity[],
  hints:     SemanticHint[],
): { score: number; riskLevel: RiskLevel } {
  if (entities.length === 0) return { score: 0, riskLevel: 'NONE' };

  // Max entity base score drives the risk (worst case, not sum)
  const maxBase = Math.max(
    ...entities.map(e => (ENTITY_BASE_SCORES[e.type] ?? 40) * e.confidence)
  );

  // Apply intent multiplier — take the most impactful one
  let multiplier = 1.0;
  for (const hint of hints) {
    const m = INTENT_MULTIPLIER[hint];
    if (m !== undefined) {
      if (m < multiplier || isLowRiskIntent([hint])) multiplier = m;
      if (isHighRiskIntent([hint]) && m > multiplier) multiplier = m;
    }
  }

  // Low-risk intent hard-cap: never exceed MEDIUM when technical/example
  const rawScore = Math.min(100, Math.round(maxBase * multiplier));
  const finalScore = (isLowRiskIntent(hints) && rawScore > 59)
    ? Math.min(rawScore, 45)
    : rawScore;

  return { score: finalScore, riskLevel: scoreToLevel(finalScore) };
}
