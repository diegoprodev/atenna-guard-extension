import type { DetectedEntity, EntityType } from './types';

interface PatternDef {
  type:       EntityType;
  pattern:    RegExp;
  confidence: number;
  validate?:  (raw: string) => boolean;
}

// ── CPF digit-verifier (frontend) ────────────────────────────

function validateCPF(raw: string): boolean {
  const d = raw.replace(/\D/g, '');
  if (d.length !== 11 || /^(\d)\1{10}$/.test(d)) return false;
  for (let i = 9; i <= 10; i++) {
    const sum = Array.from({ length: i }, (_, j) => parseInt(d[j]) * (i + 1 - j))
      .reduce((a, b) => a + b, 0);
    const expected = (sum * 10 % 11) % 10;
    if (parseInt(d[i]) !== expected) return false;
  }
  return true;
}

// ── CNPJ digit-verifier ───────────────────────────────────────

function validateCNPJ(raw: string): boolean {
  const d = raw.replace(/\D/g, '');
  if (d.length !== 14 || /^(\d)\1{13}$/.test(d)) return false;
  const w1 = [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
  const w2 = [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
  const check = (digits: string, weights: number[]) => {
    const rem = weights.reduce((s, w, i) => s + parseInt(digits[i]) * w, 0) % 11;
    return rem < 2 ? 0 : 11 - rem;
  };
  return check(d, w1) === parseInt(d[12]) && check(d, w2) === parseInt(d[13]);
}

// ── Luhn check (credit card) ──────────────────────────────────

function luhn(raw: string): boolean {
  const d = raw.replace(/\D/g, '');
  let sum = 0;
  let alt = false;
  for (let i = d.length - 1; i >= 0; i--) {
    let n = parseInt(d[i]);
    if (alt) { n *= 2; if (n > 9) n -= 9; }
    sum += n;
    alt = !alt;
  }
  return sum % 10 === 0;
}

// ── Pattern definitions ───────────────────────────────────────

const PATTERNS: PatternDef[] = [
  // CPF — with digit-verifier
  {
    type: 'CPF',
    pattern: /\b\d{3}[.\s]?\d{3}[.\s]?\d{3}[-\s]?\d{2}\b/g,
    confidence: 0.92,
    validate: validateCPF,
  },
  // CNPJ — with digit-verifier
  {
    type: 'CNPJ',
    pattern: /\b\d{2}[.\s]?\d{3}[.\s]?\d{3}[/\s]?\d{4}[-\s]?\d{2}\b/g,
    confidence: 0.92,
    validate: validateCNPJ,
  },
  // Email
  {
    type: 'EMAIL',
    pattern: /\b[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}\b/g,
    confidence: 0.85,
  },
  // Brazilian phone — multiple formats
  {
    type: 'PHONE',
    pattern: /(?:\+55\s?)?(?:\(?\d{2}\)?\s?)(?:9\s?)?\d{4}[-\s]?\d{4}\b/g,
    confidence: 0.72,
  },
  // OpenAI sk-proj- / sk-
  {
    type: 'API_KEY',
    pattern: /\bsk-proj-[A-Za-z0-9_\-]{20,}/g,
    confidence: 0.99,
  },
  // OpenAI / Stripe sk_live_ sk_test_
  {
    type: 'API_KEY',
    pattern: /\b(?:sk|pk)_(?:live|test)_[A-Za-z0-9_\-]{16,}/g,
    confidence: 0.99,
  },
  // Anthropic  sk-ant-
  {
    type: 'API_KEY',
    pattern: /\bsk-ant-[A-Za-z0-9_\-]{20,}/g,
    confidence: 0.99,
  },
  // AWS Access Key  AKIA…
  {
    type: 'API_KEY',
    pattern: /\bAKIA[0-9A-Z]{16}\b/g,
    confidence: 0.99,
  },
  // Google / Gemini  AIza…
  {
    type: 'API_KEY',
    pattern: /\bAIza[0-9A-Za-z_\-]{35}\b/g,
    confidence: 0.99,
  },
  // Generic api_key / api-key assignment
  {
    type: 'API_KEY',
    pattern: /\bapi[_-]?key\s*[=:]\s*["']?[A-Za-z0-9_\-]{16,}["']?/gi,
    confidence: 0.95,
  },
  // JWT  eyJ…
  {
    type: 'TOKEN',
    pattern: /\beyJ[A-Za-z0-9_\-]{20,}\.[A-Za-z0-9_\-]{20,}\.[A-Za-z0-9_\-]{20,}\b/g,
    confidence: 0.97,
  },
  // Bearer token
  {
    type: 'TOKEN',
    pattern: /\bBearer\s+[A-Za-z0-9\-._~+/]{20,}=*\b/gi,
    confidence: 0.95,
  },
  // Password assignment
  {
    type: 'PASSWORD',
    pattern: /\b(?:password|senha|pwd|pass|secret)\s*[=:]\s*["']?[^\s"']{6,}["']?/gi,
    confidence: 0.88,
  },
  // Credit card — 4×4 groups, with Luhn validation
  {
    type: 'CREDIT_CARD',
    pattern: /\b(?:\d{4}[\s\-]?){3}\d{4}\b/g,
    confidence: 0.82,
    validate: luhn,
  },
  // Brazilian CEP
  {
    type: 'ADDRESS',
    pattern: /\b\d{5}[-\s]?\d{3}\b/g,
    confidence: 0.60,
  },
];

export function scanPatterns(text: string): DetectedEntity[] {
  const entities: DetectedEntity[] = [];

  for (const def of PATTERNS) {
    const re = new RegExp(def.pattern.source, def.pattern.flags);
    let match: RegExpExecArray | null;

    while ((match = re.exec(text)) !== null) {
      // Apply digit-verifier if present — skip invalid matches
      if (def.validate && !def.validate(match[0])) continue;

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
