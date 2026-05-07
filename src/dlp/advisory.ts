// Advisory engine — translates scan result into UX decision.
// Tone: intelligent and responsible, never alarmist or juridical.

import type { ScanResult, Advisory, RiskLevel } from './types';

// No emojis — clean, premium, contextual
const MESSAGES: Record<RiskLevel, string> = {
  NONE:   '',
  LOW:    'Verifique se há informações sensíveis antes de enviar.',
  MEDIUM: 'Detectamos um possível dado sensível. Revise antes de continuar.',
  HIGH:   'Identificamos informação pessoal no texto. Revise antes de enviar.',
};

// Subtitle per level — more context, less alarm
const SUBTITLES: Record<RiskLevel, string> = {
  NONE:   '',
  LOW:    'Pode ser seguro — confirme antes de prosseguir.',
  MEDIUM: 'Considere remover ou substituir os dados identificados.',
  HIGH:   'Dados pessoais expostos podem comprometer sua privacidade.',
};

const PRIMARY_CTA: Record<RiskLevel, string> = {
  NONE:   '',
  LOW:    'Continuar',
  MEDIUM: 'Revisar texto',
  HIGH:   'Revisar texto',
};

const SECONDARY_CTA: Record<RiskLevel, string | null> = {
  NONE:   null,
  LOW:    null,
  MEDIUM: 'Enviar assim mesmo',
  HIGH:   'Enviar assim mesmo',
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

// Subtitle exposed for modal rendering
export function getAdvisorySubtitle(level: RiskLevel): string {
  return SUBTITLES[level];
}
