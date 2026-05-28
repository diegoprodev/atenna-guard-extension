import type { DetectedEntity, EntityType } from './types';

interface PatternDef {
  type:       EntityType;
  pattern:    RegExp;
  confidence: number;
  validate?:  (raw: string) => boolean;
}

// ── CPF validator ─────────────────────────────────────────────
// Brazilian heuristic: 11 digits where digit[2] != '9'
// (mobile phones: DDD + 9 + 8 digits → digit[2] is always '9')
// Mathematical verifier is intentionally skipped — it rejects typos and test CPFs,
// both of which still represent sensitive data that should be protected.

function validateCPF(raw: string): boolean {
  const d = raw.replace(/\D/g, '');
  if (d.length !== 11) return false;
  if (/^(\d)\1{10}$/.test(d)) return false; // all same digit
  // If digit[2] === '9' → Brazilian mobile phone format, not a CPF
  if (d[2] === '9') return false;
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

// ── Brazilian name validator ──────────────────────────────────
// Must: ≥1 word with 4+ chars, ≤1 word of only stopwords, not a known keyword sequence

const NAME_STOPWORDS = new Set([
  // Tech keywords
  'CPF', 'CNPJ', 'CEP', 'API', 'KEY', 'JWT', 'SQL', 'HTTP', 'HTTPS', 'URL',
  'GET', 'POST', 'PUT', 'DEL', 'AWS', 'RDS', 'IAM', 'VPC', 'PDF', 'CSV',
  'XML', 'JSON', 'HTML', 'CSS', 'OAB', 'CRM', 'RG', 'CNH', 'CTF', 'STF', 'STJ',
  'CRN', 'CRO', 'CREA', 'CRP', 'COREN', 'PIS', 'PASEP', 'NIT', 'PASSAPORTE',
  'CODIGO', 'CODE', 'TOKEN', 'BEARER', 'SECRET', 'SENHA', 'EMAIL', 'USER',
  // Programming / framework terms
  'OBSERVER', 'PATTERN', 'TYPESCRIPT', 'JAVASCRIPT', 'GENERICS', 'IMPLEMENTAR',
  'IMPLEMENTACAO', 'INTERFACE', 'FUNCTION', 'CLASS', 'ASYNC', 'AWAIT', 'IMPORT',
  'EXPORT', 'RETURN', 'CONST', 'REACT', 'ANGULAR', 'NODEJS', 'PYTHON', 'GOLANG',
  // Portuguese common words that must not be interpreted as name parts
  'NOME', 'MEU', 'TEU', 'SEU', 'MINHA', 'MEUS', 'SEUS', 'TEUS',
  'EU', 'ELE', 'ELA', 'OU', 'OS', 'AS', 'UM', 'UMA', 'COM',
  'NO', 'NA', 'NOS', 'NAS', 'NUM', 'NUMA',
  'POR', 'PARA', 'SEM', 'SOB', 'AOS', 'AO',
]);

function validateName(raw: string): boolean {
  const words = raw.trim().split(/\s+/);
  if (words.length < 2) return false;
  // At least one word must be >= 4 chars (filters "DA DE DO")
  if (!words.some(w => w.length >= 4)) return false;
  // Reject if ANY word is a known tech/stopword (uppercase comparison)
  const hasStopword = words.some(w => NAME_STOPWORDS.has(w.toUpperCase()));
  if (hasStopword) return false;
  return true;
}

// ── RG validator ──────────────────────────────────────────────
// RG: 7-9 digits. Must not be all-same digit.
function validateRG(raw: string): boolean {
  const d = raw.replace(/\D/g, '');
  return d.length >= 7 && d.length <= 9 && !/^(\d)\1+$/.test(d);
}

// ── CNH validator ─────────────────────────────────────────────
// CNH: exactly 11 digits, not all-same
function validateCNH(raw: string): boolean {
  const d = raw.replace(/\D/g, '');
  return d.length === 11 && !/^(\d)\1{10}$/.test(d);
}

// ── Pattern definitions ───────────────────────────────────────

const PATTERNS: PatternDef[] = [
  // Phone with explicit DDD in parentheses — always a phone, never a CPF
  // Matches: (83) 99665-0717  (11) 98765-4321  (21) 3456-7890
  {
    type: 'PHONE',
    pattern: /\(\d{2}\)\s?\d{4,5}[-\s]?\d{4}\b/g,
    confidence: 0.97,
  },
  // CPF — 11 digits where digit[2] != '9'
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
  // RG — requires label "RG:" OR dotted format XX.XXX.XXX-X
  {
    type: 'RG',
    pattern: /\b(?:RG|R\.G\.)[:\s.]*\d{1,2}[.\s]?\d{3}[.\s]?\d{3}[-\s]?\d?\b|\b\d{2}\.\d{3}\.\d{3}-\d\b/gi,
    confidence: 0.88,
    validate: validateRG,
  },
  // CNH — requires label "CNH" or "habilitação"; confidence > CPF (0.92) so label wins dedup
  {
    type: 'CNH',
    pattern: /\b(?:CNH|C\.N\.H\.|habilitação|habilitacao)[:\s.]*\d[\d\s]{9,12}\d\b/gi,
    confidence: 0.96,
    validate: validateCNH,
  },
  // OAB — must include state code: OAB/SP 123456 or OAB-RJ 98765
  {
    type: 'OAB',
    pattern: /\bOAB[/\-][A-Z]{2}\s*\d{4,6}\b/gi,
    confidence: 0.95,
  },
  // Placa Veicular — Mercosul (ABC1D23) or old format (ABC-1234)
  {
    type: 'PLACA',
    pattern: /\b[A-Z]{3}\d[A-Z]\d{2}\b|\b[A-Z]{3}-\d{4}\b/g,
    confidence: 0.85,
    validate: (raw: string) => {
      const s = raw.replace(/[^A-Z0-9]/gi, '').toUpperCase();
      if (s.length === 7) return /^[A-Z]{3}\d[A-Z]\d{2}$/.test(s) || /^[A-Z]{3}\d{4}$/.test(s);
      return false;
    },
  },
  // CRM — must include state code: CRM/SP 123456 or CRM-RS 98765
  {
    type: 'CRM',
    pattern: /\bCRM[/\-][A-Z]{2}\s*\d{4,6}\b/gi,
    confidence: 0.95,
  },
  // CRN — Nutrição: CRN-3 12345 or CRN/SP 12345
  {
    type: 'CRN',
    pattern: /\bCRN[-/][A-Z0-9]{1,2}\s*\d{3,6}\b/gi,
    confidence: 0.95,
  },
  // CRO — Odontologia: CRO/SP 54321
  {
    type: 'CRO',
    pattern: /\bCRO[/\-][A-Z]{2}\s*\d{4,6}\b/gi,
    confidence: 0.95,
  },
  // CREA — Engenharia: CREA/SP 0601234-5 or CREA-RJ 12345
  {
    type: 'CREA',
    pattern: /\bCREA[/\-][A-Z]{2}\s*\d{4,8}[-]?\d?\b/gi,
    confidence: 0.95,
  },
  // CRP — Psicologia: CRP 06/12345
  {
    type: 'CRP',
    pattern: /\bCRP\s*\d{1,2}[/\-]\d{3,6}\b/gi,
    confidence: 0.95,
  },
  // COREN — Enfermagem: COREN/SP 123456 or COREN-GO 98765
  {
    type: 'COREN',
    pattern: /\bCOREN[/\-][A-Z]{2}\s*\d{4,7}\b/gi,
    confidence: 0.95,
  },
  // PIS / PASEP / NIT — 11 digits, with or without dots/hyphens
  // Format: DDD.DDDDD.DD-D  or 11 raw digits with context label
  {
    type: 'PIS',
    pattern: /\b(?:PIS|PASEP|NIT)[:\s./-]*\d{3}[.\s]?\d{5}[.\s]?\d{2}[-\s]?\d\b|\b\d{3}[.\s]\d{5}[.\s]\d{2}[-]\d\b/gi,
    confidence: 0.90,
    validate: (raw: string) => {
      const d = raw.replace(/\D/g, '');
      return d.length === 11 && !/^(\d)\1{10}$/.test(d);
    },
  },
  // Título de Eleitor — 12 digits (optional spacing/dots)
  {
    type: 'TITULO_ELEITOR',
    pattern: /\b(?:título\s+de\s+eleitor|título\s+eleitor|titulo\s+eleitor|n[uú]mero\s+do\s+t[ií]tulo)[:\s]*[\d.\s-]{12,18}\b|\b\d{4}\s?\d{4}\s?\d{4}\b(?=\s*(?:zona|seção|se[çc][aã]o|título|eleitor))/gi,
    confidence: 0.88,
    validate: (raw: string) => {
      const d = raw.replace(/\D/g, '');
      return d.length === 12 && !/^(\d)\1{11}$/.test(d);
    },
  },
  // Passaporte Brasileiro — 2 letras + 6 dígitos (ex: AA123456) com contexto
  {
    type: 'PASSAPORTE',
    pattern: /\b(?:passaporte|passport)[:\s.#]*[A-Z]{2}\d{6}\b|\b[A-Z]{2}\d{6}\b(?=\s*(?:passaporte|passport|validade|emiss[aã]o))/gi,
    confidence: 0.92,
  },
  // Brazilian CEP
  {
    type: 'ADDRESS',
    pattern: /\b\d{5}[-\s]?\d{3}\b/g,
    confidence: 0.60,
  },
  // CNJ process number — NNNNNNN-DD.AAAA.J.TR.OOOO
  {
    type: 'PROCESS_NUM',
    pattern: /\b\d{7}-\d{2}\.\d{4}\.\d\.\d{2}\.\d{4}\b/g,
    confidence: 0.97,
  },
  // Brazilian full name — Title Case: "Diego Rodrigues da Silva"
  {
    type: 'NAME',
    pattern: /\b(?:[A-ZÁÉÍÓÚÃÕÇÂÊÎÔÛÀÈÙÄËÏÖÜ][a-záéíóúãõçâêîôûàèùäëïöü]{1,}\s+){1,3}[A-ZÁÉÍÓÚÃÕÇÂÊÎÔÛÀÈÙÄËÏÖÜ][a-záéíóúãõçâêîôûàèùäëïöü]{1,}\b/g,
    confidence: 0.62,
    validate: validateName,
  },
  // Brazilian full name — ALL_CAPS: "DIEGO RODRIGUES DA SILVA"
  {
    type: 'NAME',
    pattern: /\b(?:[A-ZÁÉÍÓÚÃÕÇÂÊÎÔÛÀÈÙÄËÏÖÜ]{2,}\s+){1,3}[A-ZÁÉÍÓÚÃÕÇÂÊÎÔÛÀÈÙÄËÏÖÜ]{2,}\b/g,
    confidence: 0.65,
    validate: validateName,
  },
  // Brazilian full name — lowercase: "diego rodrigues da silva"
  {
    type: 'NAME',
    pattern: /\b(?:[a-záéíóúãõçâêîôûàèùäëïöü]{2,}\s+){1,3}[a-záéíóúãõçâêîôûàèùäëïöü]{2,}\b/g,
    confidence: 0.55,
    validate: validateName,
  },
];

export const DLP_PATTERNS = PATTERNS;

export function scanPatterns(text: string): DetectedEntity[] {
  const raw: DetectedEntity[] = [];

  for (const def of PATTERNS) {
    const re = def.pattern;
    re.lastIndex = 0;
    let match: RegExpExecArray | null;

    while ((match = re.exec(text)) !== null) {
      if (def.validate && !def.validate(match[0])) {
        // For NAME patterns: if match starts with a stopword, retry from next word
        // so "cpf diego rodrigues" → rejected, then tries "diego rodrigues"
        if (def.type === 'NAME') {
          const spaceIdx = match[0].indexOf(' ');
          if (spaceIdx > 0) re.lastIndex = match.index + spaceIdx + 1;
        }
        continue;
      }
      raw.push({
        type:       def.type,
        value:      match[0],
        start:      match.index,
        end:        match.index + match[0].length,
        confidence: def.confidence,
      });
    }
  }

  // Deduplicate overlapping matches — keep highest-confidence entity per position
  // This prevents CPF digits from being re-classified as PHONE
  raw.sort((a, b) => b.confidence - a.confidence);
  const entities: DetectedEntity[] = [];
  for (const candidate of raw) {
    const overlaps = entities.some(
      e => candidate.start < e.end && candidate.end > e.start
    );
    if (!overlaps) entities.push(candidate);
  }

  return entities;
}
