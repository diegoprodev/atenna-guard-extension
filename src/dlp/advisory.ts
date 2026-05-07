// Advisory engine — SINGLE SOURCE OF TRUTH for risk semantics.
// Centralizes: copy, colors, visual states, behavior policy, severity mapping.
// Used by: badge, banner, modal, telemetry, strict mode, enterprise policies.

import type { ScanResult, Advisory, RiskLevel } from './types';

/**
 * RISK SEMANTICS — Single source of truth
 * Every UI element derives from this central definition.
 */
export interface RiskDefinition {
  // Identity
  level: RiskLevel;
  severity: number;  // 0=NONE, 1=LOW, 2=MEDIUM, 3=HIGH — for sorting/aggregation

  // Visual states
  badgeDotClass: string;           // CSS class for badge dot
  bannerBackgroundColor: string;   // Light/dark agnostic
  bannerBgDark: string;            // Dark mode override
  bannerBgLight: string;           // Light mode override

  // Copy
  bannerTitle: string;
  bannerSubtitle: string;
  dotTooltip: string;
  primaryCta: string;
  secondaryCta: string | null;

  // Behavior
  showBanner: boolean;             // Should banner auto-appear?
  requiresUserReview: boolean;     // User must interact before send?
  blockSend: boolean;              // Strict mode: prevents send?
  allowOverride: boolean;          // Can user ignore warning?

  // Telemetry
  telemetrySeverity: string;       // for logging/dashboarding
  telemetryActionRequired: boolean;

  // Protection policy
  autoRewriteInStrictMode: boolean;
}

// ── RISK DEFINITIONS (comprehensive semantics) ────────────────

const RISK_DEFINITIONS: Record<RiskLevel, RiskDefinition> = {
  NONE: {
    level: 'NONE',
    severity: 0,
    badgeDotClass: '',
    bannerBackgroundColor: '',
    bannerBgDark: '',
    bannerBgLight: '',
    bannerTitle: '',
    bannerSubtitle: '',
    dotTooltip: '✓ Tudo seguro',
    primaryCta: '',
    secondaryCta: null,
    showBanner: false,
    requiresUserReview: false,
    blockSend: false,
    allowOverride: true,
    telemetrySeverity: 'none',
    telemetryActionRequired: false,
    autoRewriteInStrictMode: false,
  },

  LOW: {
    level: 'LOW',
    severity: 1,
    badgeDotClass: 'atenna-btn__dot--low',
    bannerBackgroundColor: '#fff8e1',
    bannerBgDark: '#2c2613',
    bannerBgLight: '#fff8e1',
    bannerTitle: 'Dados potencialmente sensíveis detectados',
    bannerSubtitle: 'Pode ser seguro — confirme antes de prosseguir.',
    dotTooltip: '✓ Baixo risco',
    primaryCta: 'Continuar',
    secondaryCta: null,
    showBanner: false,  // LOW: apenas badge, sem banner automático
    requiresUserReview: false,
    blockSend: false,
    allowOverride: true,
    telemetrySeverity: 'low',
    telemetryActionRequired: false,
    autoRewriteInStrictMode: false,
  },

  MEDIUM: {
    level: 'MEDIUM',
    severity: 2,
    badgeDotClass: 'atenna-btn__dot--medium',
    bannerBackgroundColor: '#fff3cd',
    bannerBgDark: '#332911',
    bannerBgLight: '#fff3cd',
    bannerTitle: 'Dados sensíveis detectados',
    bannerSubtitle: 'Considere remover ou substituir os dados identificados.',
    dotTooltip: '◉ Possível dado sensível',
    primaryCta: 'Revisar texto',
    secondaryCta: 'Enviar assim mesmo',
    showBanner: true,   // MEDIUM: banner automático se autoBannerEnabled
    requiresUserReview: true,
    blockSend: false,
    allowOverride: true,
    telemetrySeverity: 'medium',
    telemetryActionRequired: true,
    autoRewriteInStrictMode: false,
  },

  HIGH: {
    level: 'HIGH',
    severity: 3,
    badgeDotClass: 'atenna-btn__dot--high',
    bannerBackgroundColor: '#f8d7da',
    bannerBgDark: '#3d2426',
    bannerBgLight: '#f8d7da',
    bannerTitle: 'Informação pessoal detectada',
    bannerSubtitle: 'Dados pessoais expostos podem comprometer sua privacidade.',
    dotTooltip: '⚠ Informação pessoal detectada',
    primaryCta: 'Proteger dados',
    secondaryCta: 'Enviar original',
    showBanner: true,   // HIGH: sempre mostra banner
    requiresUserReview: true,
    blockSend: false,   // v2.16 ainda permite send; strict mode bloqueia
    allowOverride: true,
    telemetrySeverity: 'high',
    telemetryActionRequired: true,
    autoRewriteInStrictMode: true,  // Strict: rewrite automático
  },
};

/**
 * Get complete risk definition.
 * Single source for: colors, copy, behavior, telemetry.
 */
export function getRiskDefinition(level: RiskLevel): RiskDefinition {
  return RISK_DEFINITIONS[level];
}

/**
 * Legacy API — for backward compat with existing code.
 * All callers should migrate to getRiskDefinition().
 */
export function buildAdvisory(result: ScanResult): Advisory {
  const { riskLevel, entities } = result;
  const def = getRiskDefinition(riskLevel);

  return {
    riskLevel,
    show: def.showBanner,
    message: def.bannerTitle,
    primaryCta: def.primaryCta,
    secondaryCta: def.secondaryCta,
    entities,
  };
}

/**
 * Get banner subtitle copy.
 */
export function getAdvisorySubtitle(level: RiskLevel): string {
  return getRiskDefinition(level).bannerSubtitle;
}

/**
 * Get dot tooltip text.
 * Called by badge to set data-tip attribute.
 */
export function getDotTooltip(level: RiskLevel, count?: number): string {
  const def = getRiskDefinition(level);
  if (level === 'HIGH' && count) {
    return `⚠ ${count === 1 ? '1 dado sensível' : `${count} dados sensíveis`}`;
  }
  return def.dotTooltip;
}

/**
 * Get CSS class for badge dot.
 * Called by badge to set visual state.
 */
export function getDotClass(level: RiskLevel): string {
  return getRiskDefinition(level).badgeDotClass;
}

/**
 * Should banner auto-appear for this risk level?
 * Respects autoBannerEnabled setting.
 */
export function shouldShowBanner(level: RiskLevel, autoBannerEnabled: boolean): boolean {
  const def = getRiskDefinition(level);
  return autoBannerEnabled && def.showBanner;
}

/**
 * Get banner background color based on color scheme.
 */
export function getBannerBackgroundColor(level: RiskLevel, isDark: boolean): string {
  const def = getRiskDefinition(level);
  return isDark ? def.bannerBgDark : def.bannerBgLight;
}

/**
 * Should strict mode auto-rewrite this risk level?
 */
export function shouldAutoRewriteInStrictMode(level: RiskLevel): boolean {
  return getRiskDefinition(level).autoRewriteInStrictMode;
}

/**
 * Get telemetry severity for logging.
 */
export function getTelemetrySeverity(level: RiskLevel): string {
  return getRiskDefinition(level).telemetrySeverity;
}

/**
 * Should this risk level require user action?
 */
export function requiresUserAction(level: RiskLevel): boolean {
  return getRiskDefinition(level).telemetryActionRequired;
}
