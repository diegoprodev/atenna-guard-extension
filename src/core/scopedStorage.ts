/**
 * User-scoped chrome.storage.local
 *
 * All user-specific data is stored under keys suffixed with the authenticated
 * user's Supabase UUID. This guarantees complete data isolation when multiple
 * accounts share the same Chrome profile.
 *
 * Global keys (onboarding flags, JWT) remain unscoped intentionally.
 */

let _uid: string | null = null;

/** Called by storeSession() immediately after writing the JWT. */
export function setStorageUser(uid: string | null): void {
  _uid = uid;
}

export function getStorageUser(): string | null {
  return _uid;
}

/**
 * Returns `${base}__${uid}` when authenticated, or `${base}__nouser` otherwise.
 *
 * SEGURANÇA: NUNCA cai na chave global crua — se `_uid` está null, os dados vão
 * para um namespace `__nouser` que nenhum usuário real lê. Assim um usuário nunca
 * enxerga dados escritos sob outra identidade (ou sem identidade). Todo ponto de
 * entrada que lê dado de usuário DEVE chamar setStorageUser(me.user_id) antes.
 */
export function sk(base: string): string {
  return `${base}__${_uid ?? 'nouser'}`;
}

/**
 * Returns a list of all user-scoped key patterns for `uid`.
 * Used during logout to clear stale data.
 */
export function userScopedKeys(uid: string, bases: string[]): string[] {
  return bases.map(b => `${b}__${uid}`);
}
