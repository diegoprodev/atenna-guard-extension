// Semantic hint analysis — lightweight NLP-free context detection.
// Classifies user INTENT to reduce false positives intelligently.

export type SemanticHint =
  | 'IS_TECHNICAL_QUESTION'  // "como validar CPF em JS" — intent is code, not data
  | 'IS_PROTECTION_QUERY'    // "como proteger dados médicos"
  | 'IS_REGULATORY_QUESTION' // "o que é LGPD"
  | 'IS_EXAMPLE_REQUEST'     // "gere um CPF de exemplo"
  | 'IS_REAL_DATA'           // "meu CPF é...", "use esse email: ..."
  | 'IS_MEDICAL_CONTEXT'     // "paciente com diabetes"
  | 'IS_LEGAL_CONTEXT'       // "processo judicial 123456"
  | 'NEUTRAL';

const TECH_KEYWORDS = [
  'regex', 'validar', 'validação', 'javascript', 'python', 'typescript',
  'código', 'function', 'algoritmo', 'script', 'validate', 'format',
  'parse', 'library', 'npm', 'pip', 'package', 'como implementar',
  'como fazer', 'como criar', 'como gerar', 'exemplo de código',
];

const PROTECTION_KEYWORDS = [
  'como proteger', 'como criptografar', 'best practices', 'segurança',
  'proteção de dados', 'compliance', 'política', 'lgpd', 'gdpr', 'hipaa',
  'mascarar', 'anonimizar', 'ofuscar',
];

const REGULATORY_KEYWORDS = [
  'o que é lgpd', 'lgpd', 'gdpr', 'hipaa', 'regulamentação',
  'lei de proteção', 'artigo', 'lei geral', 'conformidade',
];

const EXAMPLE_KEYWORDS = [
  'exemplo', 'fictício', 'ficticia', 'teste', 'dummy', 'fake', 'mock',
  'inventado', 'placeholder', 'gere um', 'crie um exemplo',
  'número de teste', 'dados fictícios',
];

const REAL_DATA_SIGNALS = [
  'meu cpf', 'meu cnpj', 'meu email', 'meu telefone', 'meu endereço',
  'minha senha', 'meu token', 'minha chave', 'use esse', 'use o seguinte',
  'esse é o', 'esse é meu', 'esse aqui é', 'segue os dados',
  'seguem os dados', 'dados do cliente', 'dados pessoais do',
];

const MEDICAL_SIGNALS = [
  'paciente', 'diagnóstico', 'prontuário', 'exame', 'medicamento',
  'prescrição', 'cid-', 'sintoma', 'tratamento', 'consulta médica',
  'resultado do exame', 'laudo',
];

const LEGAL_SIGNALS = [
  'processo judicial', 'processo nº', 'advogado', 'réu', 'autor',
  'sentença', 'decisão judicial', 'petição', 'habeas corpus',
  'contrato de', 'cláusula', 'rescisão',
];

function containsAny(text: string, keywords: string[]): boolean {
  const lower = text.toLowerCase();
  return keywords.some(k => lower.includes(k));
}

export function detectSemanticHints(text: string): SemanticHint[] {
  const hints: SemanticHint[] = [];

  if (containsAny(text, TECH_KEYWORDS))       hints.push('IS_TECHNICAL_QUESTION');
  if (containsAny(text, PROTECTION_KEYWORDS)) hints.push('IS_PROTECTION_QUERY');
  if (containsAny(text, REGULATORY_KEYWORDS)) hints.push('IS_REGULATORY_QUESTION');
  if (containsAny(text, EXAMPLE_KEYWORDS))    hints.push('IS_EXAMPLE_REQUEST');
  if (containsAny(text, REAL_DATA_SIGNALS))   hints.push('IS_REAL_DATA');
  if (containsAny(text, MEDICAL_SIGNALS))     hints.push('IS_MEDICAL_CONTEXT');
  if (containsAny(text, LEGAL_SIGNALS))       hints.push('IS_LEGAL_CONTEXT');

  return hints.length > 0 ? hints : ['NEUTRAL'];
}

// True when intent strongly reduces risk (technical/protection/regulatory)
export function isLowRiskIntent(hints: SemanticHint[]): boolean {
  return hints.some(h =>
    h === 'IS_TECHNICAL_QUESTION' ||
    h === 'IS_PROTECTION_QUERY' ||
    h === 'IS_REGULATORY_QUESTION' ||
    h === 'IS_EXAMPLE_REQUEST'
  );
}

// True when intent signals real personal data exposure
export function isHighRiskIntent(hints: SemanticHint[]): boolean {
  return hints.some(h => h === 'IS_REAL_DATA');
}
