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
 * Returns `${base}__${uid}` when authenticated, or `${base}` otherwise.
 * Never call this from code that runs before session load — the uid will be null
 * and you'll write to the global key, which leaks across accounts.
 */
export function sk(base: string): string {
  return _uid ? `${base}__${_uid}` : base;
}

/**
 * Returns a list of all user-scoped key patterns for `uid`.
 * Used during logout to clear stale data.
 */
export function userScopedKeys(uid: string, bases: string[]): string[] {
  return bases.map(b => `${b}__${uid}`);
}
