// Risk scoring — combines entity detection with semantic context.
// Outputs a 0-100 score and a RiskLevel enum.

import type { DetectedEntity, RiskLevel } from './types';
import type { SemanticHint } from './semantic';
import { isLowRiskIntent, isHighRiskIntent, isPiiDisclosure } from './semantic';

const ENTITY_BASE_SCORES: Record<string, number> = {
  API_KEY:     92,
  TOKEN:       88,
  PASSWORD:    87,
  CPF:         78,
  CNPJ:        72,
  CREDIT_CARD: 78,
  EMAIL:       42,
  PHONE:       42,
  ADDRESS:     28,
  MEDICAL:     55,
  LEGAL:       50,
  GENERIC_PII: 35,
  PROCESS_NUM: 72,
  NAME:        30,
};

// Intent multipliers — applied to the max entity score
const INTENT_MULTIPLIER: Partial<Record<SemanticHint, number>> = {
  IS_PII_DISCLOSURE:      2.00, // "meu cpf é..." → force HIGH
  IS_REAL_DATA:           1.35,
  IS_MEDICAL_CONTEXT:     1.20,
  IS_LEGAL_CONTEXT:       1.15,
  IS_EXAMPLE_REQUEST:     0.18, // "exemplo de API key" → LOW
  IS_PROTECTION_QUERY:    0.12, // "como mascarar cpf" → LOW
  IS_TECHNICAL_QUESTION:  0.10, // "regex validar cpf" → NONE/LOW
  IS_REGULATORY_QUESTION: 0.10,
};

// PII_DISCLOSURE with no pattern match still triggers MEDIUM
// (user typed "meu cpf é" but digit was too short to match regex)
const PII_DISCLOSURE_FLOOR = 68; // → HIGH

function scoreToLevel(score: number): RiskLevel {
  if (score <= 0)  return 'NONE';
  if (score < 28)  return 'LOW';
  if (score < 65)  return 'MEDIUM';
  return 'HIGH';
}

// Sensitive concept mentions (no regex match but topic is PII-adjacent)
const PII_CONCEPT_TERMS = [
  'cpf', 'cnpj', 'senha', 'api key', 'api_key', 'token', 'cartão de crédito',
  'dados médicos', 'dados pessoais', 'informação sensível', 'dado sensível',
  'chave secreta', 'secret key', 'bearer', 'jwt', 'número do processo', 'processo judicial',
];

function mentionsPiiConcept(hints: SemanticHint[], text?: string): boolean {
  if (!text) return false;
  const lower = text.toLowerCase();
  return PII_CONCEPT_TERMS.some(t => lower.includes(t));
}

export function computeScore(
  entities: DetectedEntity[],
  hints:    SemanticHint[],
  rawText?: string,
): { score: number; riskLevel: RiskLevel } {

  // PII disclosure phrase detected — always HIGH regardless of pattern match
  if (isPiiDisclosure(hints)) {
    const base = entities.length > 0
      ? Math.max(...entities.map(e => (ENTITY_BASE_SCORES[e.type] ?? 40) * e.confidence))
      : 50;
    const score = Math.min(100, Math.round(Math.max(base * 2.0, PII_DISCLOSURE_FLOOR)));
    return { score, riskLevel: 'HIGH' };
  }

  if (entities.length === 0) {
    // No regex match but user is discussing sensitive concepts in educational/protection context
    const isLowContext = hints.some(h =>
      h === 'IS_PROTECTION_QUERY' ||
      h === 'IS_EXAMPLE_REQUEST' ||
      h === 'IS_MEDICAL_CONTEXT' ||
      h === 'IS_REGULATORY_QUESTION'
    );
    if (isLowContext && mentionsPiiConcept(hints, rawText)) {
      return { score: 22, riskLevel: 'LOW' };
    }
    return { score: 0, riskLevel: 'NONE' };
  }

  // Worst-case entity drives the score
  const maxBase = Math.max(
    ...entities.map(e => (ENTITY_BASE_SCORES[e.type] ?? 40) * e.confidence)
  );

  // Resolve multiplier: low-risk hints take priority; high-risk amplify
  let multiplier = 1.0;
  let hasLow  = false;
  let hasHigh = false;

  for (const hint of hints) {
    const m = INTENT_MULTIPLIER[hint];
    if (m === undefined) continue;
    if (isLowRiskIntent([hint]))  { hasLow  = true; if (m < multiplier) multiplier = m; }
    if (isHighRiskIntent([hint])) { hasHigh = true; if (m > multiplier) multiplier = m; }
  }

  // Low-risk wins over high-risk if both present (protection beats exposure signal)
  if (hasLow && hasHigh) multiplier = Math.min(multiplier, 0.20);

  const rawScore = Math.min(100, Math.round(maxBase * multiplier));

  // Hard cap: pure low-risk context → never HIGH
  const finalScore = (hasLow && !hasHigh && rawScore > 59)
    ? Math.min(rawScore, 45)
    : rawScore;

  return { score: finalScore, riskLevel: scoreToLevel(finalScore) };
}
