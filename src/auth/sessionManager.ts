const STORAGE_KEY = 'atenna_session';
const SALT_KEY    = 'atenna_enc_salt';

export interface Session {
  token: string;
  expires_at: number;
  plan: string;
  email?: string;
  user_id?: string;
}

// AES-GCM helpers
// Key derivation design:
// - Base material: chrome.runtime.id (public, but not guessable without knowing extension ID)
// - Salt: crypto.getRandomValues (16 bytes, stored per-device in chrome.storage.local)
// - Combined via PBKDF2 / 100k iterations → AES-GCM-256
//
// Protection model: the random salt makes the key non-derivable from runtime.id alone.
// An attacker needs BOTH the extension ID AND the salt from chrome.storage.local.
// chrome.storage.local is isolated per extension — other extensions/pages cannot read it.
// This defends against: devtools inspection, storage dump from Chrome profile backup.
// This does NOT defend against: malware with full Chrome profile filesystem access.
async function getDerivedKey(): Promise<CryptoKey> {
  const saltRaw = await new Promise<number[] | undefined>(r =>
    chrome.storage.local.get(SALT_KEY, res => r(res[SALT_KEY] as number[] | undefined))
  );
  let salt: Uint8Array;
  if (!saltRaw) {
    salt = crypto.getRandomValues(new Uint8Array(16));
    await new Promise<void>(r => chrome.storage.local.set({ [SALT_KEY]: Array.from(salt) }, r));
  } else {
    salt = new Uint8Array(saltRaw);
  }
  const baseKey = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(chrome.runtime.id),
    { name: 'PBKDF2' },
    false,
    ['deriveKey'],
  );
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations: 100_000, hash: 'SHA-256' },
    baseKey,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

async function encrypt(plaintext: string): Promise<{ iv: number[]; data: number[] }> {
  const key = await getDerivedKey();
  const iv  = crypto.getRandomValues(new Uint8Array(12));
  const enc = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    new TextEncoder().encode(plaintext),
  );
  return { iv: Array.from(iv), data: Array.from(new Uint8Array(enc)) };
}

async function decrypt(stored: { iv: number[]; data: number[] }): Promise<string> {
  const key = await getDerivedKey();
  const dec = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: new Uint8Array(stored.iv) },
    key,
    new Uint8Array(stored.data),
  );
  return new TextDecoder().decode(dec);
}

export async function setSession(session: Session): Promise<void> {
  const enc = await encrypt(JSON.stringify(session));
  await new Promise<void>(r => chrome.storage.local.set({ [STORAGE_KEY]: enc }, r));
}

export async function clearSession(): Promise<void> {
  await new Promise<void>(r => chrome.storage.local.remove([STORAGE_KEY], r));
}

// Serialize concurrent refresh calls
let _pendingRefresh: (() => Promise<Session>) | null = null;
let _refreshPromise: Promise<Session | null> | null  = null;

/** For testing only — inject a mock refresh function (pass null to clear) */
export function _setPendingRefresh(fn: (() => Promise<Session>) | null): void {
  _pendingRefresh = fn;
}

export async function getSession(): Promise<Session | null> {
  const raw = await new Promise<unknown>(r =>
    chrome.storage.local.get(STORAGE_KEY, res => r(res[STORAGE_KEY]))
  );
  if (!raw) return null;

  try {
    const json    = await decrypt(raw as { iv: number[]; data: number[] });
    const session: Session = JSON.parse(json);
    if (session.expires_at < Math.floor(Date.now() / 1000)) {
      if (_pendingRefresh) {
        if (!_refreshPromise) {
          _refreshPromise = _pendingRefresh()
            .then(async s => { await setSession(s); return s; })
            .finally(() => { _refreshPromise = null; });
        }
        return _refreshPromise;
      }
      await clearSession();
      return null;
    }
    return session;
  } catch {
    await clearSession();
    return null;
  }
}
