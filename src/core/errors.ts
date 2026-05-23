/**
 * Centralized error classification and user-facing messages.
 * Rule: HTTP status codes and stack traces NEVER reach the UI.
 * All user-visible text lives here; technical detail goes to console only.
 */

export const E = {
  INVALID_CREDENTIALS: 'INVALID_CREDENTIALS',
  SESSION_EXPIRED:     'SESSION_EXPIRED',
  EMAIL_EXISTS:        'EMAIL_EXISTS',
  EMAIL_INVALID:       'EMAIL_INVALID',
  PASSWORD_WEAK:       'PASSWORD_WEAK',
  NETWORK:             'NETWORK',
  RATE_LIMIT:          'RATE_LIMIT',
  SERVER:              'SERVER',
  UNKNOWN:             'UNKNOWN',
} as const;

export type AppErrorCode = typeof E[keyof typeof E];

const MESSAGES: Record<AppErrorCode, string> = {
  INVALID_CREDENTIALS: 'Email ou senha incorretos. Verifique e tente novamente.',
  SESSION_EXPIRED:     'Sua sessão expirou. Faça login novamente para continuar.',
  EMAIL_EXISTS:        'Este email já está cadastrado. Tente entrar ou recuperar a senha.',
  EMAIL_INVALID:       'Endereço de email inválido. Verifique e tente novamente.',
  PASSWORD_WEAK:       'A senha precisa ter pelo menos 8 caracteres.',
  NETWORK:             'Sem conexão. Verifique sua internet e tente novamente.',
  RATE_LIMIT:          'Muitas tentativas. Aguarde um momento e tente novamente.',
  SERVER:              'Serviço temporariamente indisponível. Tente em alguns instantes.',
  UNKNOWN:             'Algo deu errado. Tente novamente.',
};

export class AppError extends Error {
  constructor(public readonly code: AppErrorCode) {
    super(code);
    this.name = 'AppError';
  }
}

export function classifyError(err: unknown): AppErrorCode {
  if (err instanceof AppError) return err.code;
  if (!(err instanceof Error)) return E.UNKNOWN;
  const msg = err.message;
  // Semantic codes thrown by bffClient / auth
  if (Object.keys(E).includes(msg)) return msg as AppErrorCode;
  // Legacy HTTP-status fallback (should not reach here once callers are updated)
  if (msg.includes('401') || msg.toLowerCase().includes('invalid') || msg.toLowerCase().includes('failed')) return E.INVALID_CREDENTIALS;
  if (msg.includes('429'))                      return E.RATE_LIMIT;
  if (msg.includes('500') || msg.includes('502') || msg.includes('503')) return E.SERVER;
  if (msg.toLowerCase().includes('failed to fetch') || msg.toLowerCase().includes('networkerror')) return E.NETWORK;
  return E.UNKNOWN;
}

export function friendlyError(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err);
  if (msg.includes('email_not_found') || msg.includes('user_not_found'))
    return 'Email não encontrado. Verifique o endereço ou crie uma conta.';
  if (msg.includes('wrong_password') || msg.includes('invalid_credentials') || msg.includes('Invalid login credentials'))
    return 'Senha incorreta. Verifique sua senha e tente novamente.';
  if (msg.includes('email_not_confirmed') || msg.includes('Email not confirmed'))
    return 'Conta não confirmada. Verifique seu email e clique no link de confirmação.';
  if (msg.includes('too_many_requests') || msg.includes('rate_limit'))
    return 'Muitas tentativas. Aguarde alguns minutos e tente novamente.';
  if (msg.includes('NETWORK') || msg.includes('fetch'))
    return 'Sem conexão. Verifique sua internet e tente novamente.';
  return msg || 'Erro inesperado. Tente novamente.';
}
