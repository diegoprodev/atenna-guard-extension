import type { DetectedEntity, EntityType } from './types';

interface PatternDef {
  type:       EntityType;
  pattern:    RegExp;
  confidence: number;
}

const PATTERNS: PatternDef[] = [
  // CPF — xxx.xxx.xxx-xx or xxxxxxxxxxx
  {
    type: 'CPF',
    pattern: /\b\d{3}[.\s]?\d{3}[.\s]?\d{3}[-\s]?\d{2}\b/g,
    confidence: 0.90,
  },
  // CNPJ — xx.xxx.xxx/xxxx-xx or xxxxxxxxxxxxxx
  {
    type: 'CNPJ',
    pattern: /\b\d{2}[.\s]?\d{3}[.\s]?\d{3}[/\s]?\d{4}[-\s]?\d{2}\b/g,
    confidence: 0.90,
  },
  // Email
  {
    type: 'EMAIL',
    pattern: /\b[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}\b/g,
    confidence: 0.85,
  },
  // Brazilian phone (+55 11 99999-9999 or (11)99999-9999 or 11999999999)
  {
    type: 'PHONE',
    pattern: /(\+55\s?)?(\(?\d{2}\)?\s?)[\s9]?\d{4,5}[-\s]?\d{4}\b/g,
    confidence: 0.75,
  },
  // API keys / tokens (sk_live_, sk_test_, Bearer, etc.)
  {
    type: 'API_KEY',
    pattern: /\b(?:sk_live_|sk_test_|pk_live_|pk_test_|api[_-]?key\s*[=:]\s*)[A-Za-z0-9_\-]{16,}/gi,
    confidence: 0.95,
  },
  // Generic long secrets (Bearer token, hex secret, base64 block)
  {
    type: 'TOKEN',
    pattern: /\bBearer\s+[A-Za-z0-9\-._~+/]+=*\b/gi,
    confidence: 0.92,
  },
  // Password assignment patterns
  {
    type: 'PASSWORD',
    pattern: /\b(?:password|senha|pwd|pass)\s*[=:]\s*["']?[^\s"']{6,}["']?/gi,
    confidence: 0.88,
  },
  // Credit card (4-group 16 digits)
  {
    type: 'CREDIT_CARD',
    pattern: /\b(?:\d{4}[\s\-]?){3}\d{4}\b/g,
    confidence: 0.80,
  },
  // Brazilian CEP / address hints
  {
    type: 'ADDRESS',
    pattern: /\b\d{5}[-\s]?\d{3}\b/g,
    confidence: 0.65,
  },
];

// Scan text with all patterns — returns raw hits before scoring
export function scanPatterns(text: string): DetectedEntity[] {
  const entities: DetectedEntity[] = [];

  for (const def of PATTERNS) {
    const re = new RegExp(def.pattern.source, def.pattern.flags);
    let match: RegExpExecArray | null;

    while ((match = re.exec(text)) !== null) {
      entities.push({
        type:       def.type,
        value:      match[0],
        start:      match.index,
        end:        match.index + match[0].length,
        confidence: def.confidence,
      });
    }
  }

  return entities;
}
