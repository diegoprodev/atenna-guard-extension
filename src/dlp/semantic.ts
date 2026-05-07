// Semantic hint analysis — lightweight, NLP-free intent detection.
// Classifies user INTENT to reduce false positives intelligently.

export type SemanticHint =
  | 'IS_TECHNICAL_QUESTION'  // "como validar CPF em JS" → code intent, not data
  | 'IS_PROTECTION_QUERY'    // "como mascarar CPF", "como proteger dados"
  | 'IS_REGULATORY_QUESTION' // "o que é LGPD"
  | 'IS_EXAMPLE_REQUEST'     // "gere um CPF de exemplo", "exemplo de API key"
  | 'IS_PII_DISCLOSURE'      // "meu CPF é ...", "minha senha é ..."
  | 'IS_REAL_DATA'           // legacy — explicit real data signals
  | 'IS_MEDICAL_CONTEXT'     // "paciente com diabetes"
  | 'IS_LEGAL_CONTEXT'       // "processo judicial"
  | 'NEUTRAL';

// ── Keyword lists ─────────────────────────────────────────────

const TECH_KEYWORDS = [
  'regex', 'validar', 'validação', 'javascript', 'python', 'typescript',
  'código', 'function', 'algoritmo', 'script', 'validate', 'format',
  'parse', 'library', 'npm', 'pip', 'package', 'como implementar',
  'como fazer', 'como criar', 'como gerar', 'exemplo de código',
  'unit test', 'teste unitário', 'mock', 'stub', 'faker', 'cpf inválido',
  'cpf válido', 'gerar cpf', 'calcular dígito', 'dígito verificador',
];

// Protection/masking: user wants to protect data, not expose it
const PROTECTION_KEYWORDS = [
  'como proteger', 'como criptografar', 'como mascarar', 'mascarar cpf',
  'mascarar cartão', 'como anonimizar', 'anonimizar', 'ofuscar',
  'best practices', 'segurança de dados', 'proteção de dados',
  'compliance', 'política de privacidade', 'lgpd', 'gdpr', 'hipaa',
  'data protection', 'sanitizar', 'redact', 'pseudonimizar',
];

const REGULATORY_KEYWORDS = [
  'o que é lgpd', 'lgpd', 'gdpr', 'hipaa', 'regulamentação',
  'lei de proteção', 'artigo', 'lei geral', 'conformidade', 'norma',
];

// Example/educational: clear intent to generate fictional data
const EXAMPLE_KEYWORDS = [
  'exemplo de', 'exemplo fictício', 'fictício', 'ficticia', 'dados fictícios',
  'número de teste', 'dummy', 'fake', 'mock', 'inventado', 'placeholder',
  'gere um exemplo', 'crie um exemplo', 'usar como exemplo',
  'como funciona', 'para fins de teste', 'apenas para teste',
  'ilustrar', 'demonstrar', 'mostrar como', 'api key de exemplo',
  'token de exemplo', 'cpf de exemplo',
];

// Explicit disclosure signals: "meu X é ..." = user is sharing their own data
const PII_DISCLOSURE_SIGNALS = [
  'meu cpf é', 'meu cpf:', 'cpf é', 'cpf:',
  'meu cnpj é', 'meu cnpj:',
  'meu email é', 'meu e-mail é',
  'meu telefone é', 'meu celular é',
  'minha senha é', 'minha senha:', 'senha é',
  'meu token é', 'meu token:', 'token é',
  'minha chave é', 'minha chave:',
  'meu cartão é', 'número do cartão',
  'use esse cpf', 'use esse email', 'use esse token',
  'esse é meu cpf', 'esse é meu email',
];

// Broader real-data signals (lower priority than PII_DISCLOSURE)
const REAL_DATA_SIGNALS = [
  'use esse', 'use o seguinte', 'esse é o', 'esse é meu', 'esse aqui é',
  'segue os dados', 'seguem os dados', 'dados do cliente',
  'dados pessoais do', 'informações do usuário', 'preencher com',
];

const MEDICAL_SIGNALS = [
  'paciente', 'diagnóstico', 'prontuário', 'exame', 'medicamento',
  'prescrição', 'cid-', 'sintoma', 'tratamento', 'consulta médica',
  'resultado do exame', 'laudo', 'anamnese', 'histórico médico',
];

const LEGAL_SIGNALS = [
  'processo judicial', 'processo nº', 'advogado', 'réu', 'autor',
  'sentença', 'decisão judicial', 'petição', 'habeas corpus',
  'contrato de', 'cláusula', 'rescisão',
];

// ── Helpers ───────────────────────────────────────────────────

function containsAny(text: string, keywords: string[]): boolean {
  const lower = text.toLowerCase();
  return keywords.some(k => lower.includes(k));
}

// ── Public API ────────────────────────────────────────────────

export function detectSemanticHints(text: string): SemanticHint[] {
  const hints: SemanticHint[] = [];

  if (containsAny(text, PII_DISCLOSURE_SIGNALS)) hints.push('IS_PII_DISCLOSURE');
  if (containsAny(text, TECH_KEYWORDS))          hints.push('IS_TECHNICAL_QUESTION');
  if (containsAny(text, PROTECTION_KEYWORDS))    hints.push('IS_PROTECTION_QUERY');
  if (containsAny(text, REGULATORY_KEYWORDS))    hints.push('IS_REGULATORY_QUESTION');
  if (containsAny(text, EXAMPLE_KEYWORDS))       hints.push('IS_EXAMPLE_REQUEST');
  if (containsAny(text, REAL_DATA_SIGNALS))      hints.push('IS_REAL_DATA');
  if (containsAny(text, MEDICAL_SIGNALS))        hints.push('IS_MEDICAL_CONTEXT');
  if (containsAny(text, LEGAL_SIGNALS))          hints.push('IS_LEGAL_CONTEXT');

  return hints.length > 0 ? hints : ['NEUTRAL'];
}

// IS_PII_DISCLOSURE overrides everything → always HIGH
export function isPiiDisclosure(hints: SemanticHint[]): boolean {
  return hints.includes('IS_PII_DISCLOSURE');
}

// True when intent strongly suggests code/learning/protection (not data exposure)
export function isLowRiskIntent(hints: SemanticHint[]): boolean {
  // If user is disclosing their own data, it's never low risk
  if (isPiiDisclosure(hints)) return false;
  return hints.some(h =>
    h === 'IS_TECHNICAL_QUESTION' ||
    h === 'IS_PROTECTION_QUERY'    ||
    h === 'IS_REGULATORY_QUESTION' ||
    h === 'IS_EXAMPLE_REQUEST'
  );
}

export function isHighRiskIntent(hints: SemanticHint[]): boolean {
  return hints.some(h => h === 'IS_REAL_DATA' || h === 'IS_PII_DISCLOSURE');
}
