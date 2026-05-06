// Advisory engine — translates scan result into UX decision.
// Decides whether/how to surface the DLP warning.

import type { ScanResult, Advisory, RiskLevel } from './types';

const MESSAGES: Record<RiskLevel, string> = {
  NONE:   '',
  LOW:    'Verifique se há informações sensíveis antes de enviar.',
  MEDIUM: 'Possível informação sensível detectada. Revise antes de enviar.',
  HIGH:   'Informação sensível detectada. Revise antes de enviar.',
};

const PRIMARY_CTA: Record<RiskLevel, string> = {
  NONE:   '',
  LOW:    'Enviar',
  MEDIUM: 'Revisar',
  HIGH:   'Revisar',
};

const SECONDARY_CTA: Record<RiskLevel, string | null> = {
  NONE:   null,
  LOW:    null,
  MEDIUM: 'Enviar mesmo assim',
  HIGH:   'Enviar mesmo assim',
};

export function buildAdvisory(result: ScanResult): Advisory {
  const { riskLevel, entities } = result;

  return {
    riskLevel,
    show:         riskLevel !== 'NONE',
    message:      MESSAGES[riskLevel],
    primaryCta:   PRIMARY_CTA[riskLevel],
    secondaryCta: SECONDARY_CTA[riskLevel],
    entities,
  };
}
