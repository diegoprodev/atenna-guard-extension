export type RiskLevel = 'NONE' | 'LOW' | 'MEDIUM' | 'HIGH';

export type EntityType =
  | 'CPF' | 'CNPJ' | 'EMAIL' | 'PHONE'
  | 'API_KEY' | 'TOKEN' | 'PASSWORD' | 'CREDIT_CARD'
  | 'ADDRESS' | 'MEDICAL' | 'LEGAL' | 'GENERIC_PII'
  | 'PROCESS_NUM' | 'NAME';

export interface DetectedEntity {
  type:       EntityType;
  value:      string;
  start:      number;
  end:        number;
  confidence: number; // 0–1
}

export interface ScanResult {
  entities:   DetectedEntity[];
  riskLevel:  RiskLevel;
  score:      number;       // 0–100
  durationMs: number;
  hasContext: boolean;      // true when intent appears non-harmful
}

export interface Advisory {
  riskLevel:   RiskLevel;
  show:        boolean;
  message:     string;
  primaryCta:  string;
  secondaryCta: string | null;
  entities:    DetectedEntity[];
}

export interface DlpMetadata {
  dlp_enabled: boolean;
  dlp_risk_level: RiskLevel;
  dlp_entity_types: EntityType[];
  dlp_entity_count: number;
  dlp_was_rewritten: boolean;
  dlp_user_override: boolean;
  dlp_client_score: number;
}
