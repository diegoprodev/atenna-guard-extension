import type { DetectedEntity } from './types';

// Placeholders canônicos — devem coincidir exatamente com backend/dlp/types.py PLACEHOLDERS.
// Qualquer divergência entre frontend e backend quebra a rastreabilidade dos findings.
const ENTITY_TOKEN: Partial<Record<string, string>> = {
  CPF:                   '[CPF]',
  CNPJ:                  '[CNPJ]',
  RG:                    '[RG]',
  PIS_PASEP:             '[PIS_PASEP]',
  TITULO_ELEITOR:        '[TITULO_ELEITOR]',
  EMAIL:                 '[EMAIL]',
  PHONE:                 '[TELEFONE]',
  API_KEY:               '[API_KEY]',
  JWT:                   '[TOKEN]',
  TOKEN:                 '[TOKEN]',
  SECRET:                '[SEGREDO]',
  PASSWORD:              '[SEGREDO]',
  CREDIT_CARD:           '[CARTAO]',
  ADDRESS:               '[ENDERECO]',
  VEHICLE_PLATE:         '[PLACA]',
  PROCESS_NUM:           '[PROCESSO_JUDICIAL]',
  PROCESS_NUMBER:        '[PROCESSO_JUDICIAL]',
  MEDICAL:               '[DADO_MEDICO]',
  MEDICAL_DATA:          '[DADO_MEDICO]',
  LEGAL:                 '[CONTEXTO_JURIDICO]',
  LEGAL_CONTEXT:         '[CONTEXTO_JURIDICO]',
  CONFIDENTIAL_DOCUMENT: '[DOCUMENTO_CONFIDENCIAL]',
  NAME:                  '[NOME]',
  GENERIC_PII:           '[DADO]',
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
