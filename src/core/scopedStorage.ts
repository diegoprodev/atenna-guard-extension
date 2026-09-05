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

/**
 * Todo dado escrito sob a conta de um usuário. Fonte única — mora aqui (junto
 * da lógica de scoping), não em auth.ts, porque tem que ser purgado de DOIS
 * lugares: o logout explícito (signOut) E o auto-clear de sessão expirada
 * dentro de bffFetch (401 + refresh falhou). Antes só o signOut purgava →
 * sessão que expirava sozinha deixava histórico/uso/plano pra trás.
 */
export const USER_SCOPED_BASES = [
  'atenna_history',
  'atenna_usage',
  'atenna_total_count',
  'atenna_monthly_usage',
  'atenna_dlp_stats',
  'atenna_badge_color',
  'atenna_settings',
  'atenna_upload_count',
  'atenna_plan',
  'atenna_pro_welcome_pending',
  'atenna_last_gen_sig',
  'atenna_autogen_style',
];

/**
 * Apaga do chrome.storage.local todo dado escopado no `uid`. Idempotente e
 * seguro se `uid` for null/vazio (nesse caso não faz nada — nunca apaga
 * chave global crua).
 */
export function purgeScopedData(uid: string | null | undefined): Promise<void> {
  return new Promise(resolve => {
    if (!uid) { resolve(); return; }
    try {
      chrome.storage.local.remove(userScopedKeys(uid, USER_SCOPED_BASES), () => resolve());
    } catch {
      resolve();
    }
  });
}
