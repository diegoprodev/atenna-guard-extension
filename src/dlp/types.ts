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
