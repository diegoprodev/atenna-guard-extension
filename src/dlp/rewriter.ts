import type { DetectedEntity } from './types';

// Semantic replacement tokens — descriptive, not alarming
const ENTITY_TOKEN: Partial<Record<string, string>> = {
  CPF:         '[CPF]',
  CNPJ:        '[CNPJ]',
  EMAIL:       '[EMAIL]',
  PHONE:       '[TELEFONE]',
  API_KEY:     '[API_KEY]',
  TOKEN:       '[TOKEN]',
  PASSWORD:    '[SENHA]',
  CREDIT_CARD: '[CARTAO]',
  ADDRESS:     '[ENDERECO]',
  PROCESS_NUM: '[PROCESSO]',
  MEDICAL:     '[DADO_MEDICO]',
  LEGAL:       '[DADO_LEGAL]',
  GENERIC_PII: '[DADO]',
  NAME:        '[NOME]',
};

export function rewritePII(text: string, entities: DetectedEntity[]): string {
  if (entities.length === 0) return text;

  // Sort by start position descending — replace from end to preserve offsets
  const sorted = [...entities].sort((a, b) => b.start - a.start);
  let result = text;

  for (const entity of sorted) {
    const token = ENTITY_TOKEN[entity.type] ?? '[DADO]';
    result = result.slice(0, entity.start) + token + result.slice(entity.end);
  }

  return result;
}
