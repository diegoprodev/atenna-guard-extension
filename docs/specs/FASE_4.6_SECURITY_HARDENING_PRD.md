# FASE 4.6 — Security Architecture Hardening

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` to implement task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Eliminate the four critical security vulnerabilities identified in the May 2026 audit: ANON key exposure in extension ZIP, JWT plaintext in chrome.storage, absent sender-origin validation, and XSS via innerHTML.

**Architecture:** Introduce a BFF (Backend For Frontend) auth proxy so the Chrome extension never holds a Supabase JWT or ANON key — only an opaque AES-GCM encrypted session token. All Supabase calls move to the backend service.

**Tech Stack:** FastAPI (Python 3.12), SubtleCrypto (Web Crypto API), chrome.storage.local (encrypted), TypeScript strict mode

---

## SECURITY INVARIANTS (non-negotiable, tested by harness)

| # | Invariant | Harness ID |
|---|-----------|------------|
| SI-1 | Extension ZIP contains zero occurrences of `SUPABASE_ANON_KEY` or `supabase.co` URLs | H-ZIP-1 |
| SI-2 | `chrome.storage.local` never contains a raw JWT (3-segment base64) | H-STORE-1 |
| SI-3 | Every `chrome.runtime.onMessage` handler validates `sender.id === chrome.runtime.id` | H-MSG-1 |
| SI-4 | `popup.ts` and `modal.ts` never call `innerHTML` with user-controlled data | H-XSS-1 |
| SI-5 | Backend `/auth/*` routes never log or return raw Supabase SERVICE_ROLE key | H-LOG-1 |
| SI-6 | Token refresh is serialized — concurrent calls resolve from one pending promise | H-RACE-1 |

---

## FILE MAP

### New Files

| Path | Responsibility |
|------|---------------|
| `backend/routes/bff_auth.py` | BFF auth endpoints: login, refresh, logout, profile, plan |
| `backend/services/supabase_admin.py` | Supabase admin client (SERVICE_ROLE only, never exported) |
| `src/auth/sessionManager.ts` | Opaque token lifecycle: encrypt, store, retrieve, refresh |
| `src/auth/bffClient.ts` | Typed fetch wrapper for BFF endpoints |

### Modified Files

| Path | Change |
|------|--------|
| `backend/main.py` | Register `bff_auth` router |
| `backend/middleware/auth.py` | Validate opaque token instead of raw JWT |
| `src/background/background.ts` | Add sender origin guard; remove direct Supabase calls |
| `src/popup.ts` | Use `bffClient`; fix innerHTML → textContent |
| `src/ui/modal.ts` | Fix innerHTML → textContent for user data |
| `manifest.json` | Add `content_security_policy`; remove `*.supabase.co` from `host_permissions` |

### Deleted Files

| Path | Reason |
|------|--------|
| `src/auth/supabaseClient.ts` | Replaced by BFF; client must not hold ANON key |

---

## TASK 1 — Backend: BFF Auth Service

**Files:**
- Create: `backend/services/supabase_admin.py`
- Create: `backend/routes/bff_auth.py`
- Modify: `backend/main.py`

### What

Four endpoints:

```
POST /auth/login     { email, password } → { token, expires_at, plan }
POST /auth/refresh   { token }           → { token, expires_at }
POST /auth/logout    { token }           → { ok: true }
GET  /auth/me        (Bearer token)      → { user_id, email, plan }
```

The `token` is an opaque identifier (UUID v4) stored server-side in a fast in-memory dict with TTL. It maps to the Supabase JWT internally. The client never sees the JWT.

### Implementation

- [ ] **Step 1: Write failing tests for supabase_admin.py**

```python
# backend/tests/test_bff_auth.py
import pytest
from unittest.mock import patch, MagicMock
from backend.services.supabase_admin import get_admin_client

def test_admin_client_never_exposes_key():
    """SERVICE_ROLE key must not appear in any returned dict."""
    with patch.dict("os.environ", {"SUPABASE_URL": "https://x.supabase.co",
                                    "SUPABASE_SERVICE_ROLE_KEY": "super-secret"}):
        client = get_admin_client()
        as_str = str(client.__dict__)
        assert "super-secret" not in as_str

def test_login_returns_opaque_token(client):
    resp = client.post("/auth/login", json={"email": "a@b.com", "password": "pw"})
    assert resp.status_code == 200
    data = resp.json()
    assert "token" in data
    # opaque: must NOT look like JWT (3 segments separated by dots)
    assert data["token"].count(".") != 2, "token must not be a raw JWT"
    assert "expires_at" in data
    assert "plan" in data

def test_refresh_rotates_token(client):
    """After refresh the old token must be invalid."""
    login = client.post("/auth/login", json={"email": "a@b.com", "password": "pw"}).json()
    old = login["token"]
    refresh = client.post("/auth/refresh", json={"token": old}).json()
    new = refresh["token"]
    assert new != old
    # old token → 401
    r = client.get("/auth/me", headers={"Authorization": f"Bearer {old}"})
    assert r.status_code == 401

def test_logout_invalidates_token(client):
    login = client.post("/auth/login", json={"email": "a@b.com", "password": "pw"}).json()
    tok = login["token"]
    client.post("/auth/logout", json={"token": tok})
    r = client.get("/auth/me", headers={"Authorization": f"Bearer {tok}"})
    assert r.status_code == 401
```

- [ ] **Step 2: Run tests → expect FAIL (module does not exist)**

```bash
cd backend && python -m pytest tests/test_bff_auth.py -v
```

Expected: `ModuleNotFoundError: No module named 'backend.services.supabase_admin'`

- [ ] **Step 3: Implement supabase_admin.py**

```python
# backend/services/supabase_admin.py
import os
from supabase import create_client, Client

_client: Client | None = None

def get_admin_client() -> Client:
    global _client
    if _client is None:
        url = os.environ["SUPABASE_URL"]
        key = os.environ["SUPABASE_SERVICE_ROLE_KEY"]
        _client = create_client(url, key)
    return _client
```

- [ ] **Step 4: Implement bff_auth.py**

```python
# backend/routes/bff_auth.py
import os
import uuid
import time
from fastapi import APIRouter, HTTPException, Depends
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from pydantic import BaseModel
from backend.services.supabase_admin import get_admin_client

router = APIRouter(prefix="/auth", tags=["BFF Auth"])
_bearer = HTTPBearer()

# In-memory token store: opaque_token → { supabase_jwt, expires_at, user_id, email, plan }
# Production: replace with Redis for multi-instance
_sessions: dict[str, dict] = {}
_TOKEN_TTL = 3600  # 1 hour

class LoginRequest(BaseModel):
    email: str
    password: str

class RefreshRequest(BaseModel):
    token: str

class LogoutRequest(BaseModel):
    token: str

def _issue_token(supabase_jwt: str, user_id: str, email: str, plan: str) -> dict:
    opaque = str(uuid.uuid4())
    expires_at = int(time.time()) + _TOKEN_TTL
    _sessions[opaque] = {
        "supabase_jwt": supabase_jwt,
        "expires_at": expires_at,
        "user_id": user_id,
        "email": email,
        "plan": plan,
    }
    return {"token": opaque, "expires_at": expires_at, "plan": plan}

def _resolve_token(opaque: str) -> dict:
    session = _sessions.get(opaque)
    if not session:
        raise HTTPException(401, "Invalid or expired token")
    if session["expires_at"] < int(time.time()):
        del _sessions[opaque]
        raise HTTPException(401, "Token expired")
    return session

def _get_plan(user_id: str) -> str:
    try:
        client = get_admin_client()
        r = client.table("user_plans").select("plan_type").eq("user_id", user_id).single().execute()
        return r.data.get("plan_type", "free") if r.data else "free"
    except Exception:
        return "free"

@router.post("/login")
async def login(req: LoginRequest):
    try:
        client = get_admin_client()
        r = client.auth.sign_in_with_password({"email": req.email, "password": req.password})
    except Exception as e:
        raise HTTPException(401, "Invalid credentials")
    jwt = r.session.access_token
    uid = r.user.id
    email = r.user.email or req.email
    plan = _get_plan(uid)
    return _issue_token(jwt, uid, email, plan)

@router.post("/refresh")
async def refresh(req: RefreshRequest):
    session = _resolve_token(req.token)
    try:
        client = get_admin_client()
        r = client.auth.refresh_session(session["supabase_jwt"])
        new_jwt = r.session.access_token
    except Exception:
        raise HTTPException(401, "Could not refresh session")
    # Invalidate old token
    del _sessions[req.token]
    return _issue_token(new_jwt, session["user_id"], session["email"], session["plan"])

@router.post("/logout")
async def logout(req: LogoutRequest):
    _sessions.pop(req.token, None)
    return {"ok": True}

@router.get("/me")
async def me(creds: HTTPAuthorizationCredentials = Depends(_bearer)):
    session = _resolve_token(creds.credentials)
    return {
        "user_id": session["user_id"],
        "email": session["email"],
        "plan": session["plan"],
        "expires_at": session["expires_at"],
    }
```

- [ ] **Step 5: Register router in main.py**

Add after existing router registrations:

```python
from backend.routes.bff_auth import router as bff_auth_router
app.include_router(bff_auth_router)
```

- [ ] **Step 6: Run tests → expect PASS**

```bash
cd backend && python -m pytest tests/test_bff_auth.py -v
```

Expected: 4/4 PASS

- [ ] **Step 7: Commit**

```bash
git add backend/services/supabase_admin.py backend/routes/bff_auth.py backend/main.py backend/tests/test_bff_auth.py
git commit -m "feat(FASE 4.6): BFF auth proxy — opaque token, never exposes Supabase JWT to client"
```

---

## TASK 2 — Frontend: sessionManager + bffClient

**Files:**
- Create: `src/auth/sessionManager.ts`
- Create: `src/auth/bffClient.ts`

### What

`sessionManager.ts` — single source of truth for the opaque token in `chrome.storage.local`. Encrypts token with AES-GCM using a per-installation key derived from `chrome.runtime.id` + a stored salt. Serializes refresh calls so concurrent callers get the same promise.

`bffClient.ts` — thin typed wrapper around `fetch` targeting BFF endpoints. Automatically attaches `Authorization: Bearer <opaque>` and handles 401 by attempting one refresh.

- [ ] **Step 1: Write failing tests**

```typescript
// src/auth/__tests__/sessionManager.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock chrome APIs
const storage: Record<string, unknown> = {};
vi.stubGlobal('chrome', {
  storage: {
    local: {
      get: (keys: string[], cb: (r: Record<string, unknown>) => void) =>
        cb(Object.fromEntries(keys.map(k => [k, storage[k]]))),
      set: (obj: Record<string, unknown>, cb?: () => void) => {
        Object.assign(storage, obj);
        cb?.();
      },
    },
  },
  runtime: { id: 'test-extension-id' },
});

describe('sessionManager', () => {
  beforeEach(() => Object.keys(storage).forEach(k => delete storage[k]));

  it('stores token in encrypted form (not raw JWT)', async () => {
    const { setSession } = await import('../sessionManager');
    await setSession({ token: 'header.payload.sig', expires_at: 9999999999, plan: 'free' });
    const raw = storage['atenna_session'];
    // stored value must not contain the raw JWT segments
    expect(JSON.stringify(raw)).not.toContain('header.payload.sig');
  });

  it('retrieves and decrypts session correctly', async () => {
    const { setSession, getSession } = await import('../sessionManager');
    await setSession({ token: 'opaque-uuid-token', expires_at: 9999999999, plan: 'pro' });
    const s = await getSession();
    expect(s?.token).toBe('opaque-uuid-token');
    expect(s?.plan).toBe('pro');
  });

  it('returns null if token is expired', async () => {
    const { setSession, getSession } = await import('../sessionManager');
    await setSession({ token: 'tok', expires_at: 1000, plan: 'free' }); // past
    const s = await getSession();
    expect(s).toBeNull();
  });

  it('concurrent getSession calls share one refresh promise', async () => {
    const { getSession, _setPendingRefresh } = await import('../sessionManager');
    let resolveCount = 0;
    const mockRefresh = vi.fn().mockImplementation(() => {
      resolveCount++;
      return Promise.resolve({ token: 'new', expires_at: 9999999999, plan: 'free' });
    });
    _setPendingRefresh(mockRefresh);
    await Promise.all([getSession(), getSession(), getSession()]);
    expect(mockRefresh).toHaveBeenCalledTimes(1); // serialized
  });
});
```

- [ ] **Step 2: Run tests → expect FAIL**

```bash
npx vitest run src/auth/__tests__/sessionManager.test.ts
```

Expected: `Cannot find module '../sessionManager'`

- [ ] **Step 3: Implement sessionManager.ts**

```typescript
// src/auth/sessionManager.ts
const STORAGE_KEY = 'atenna_session';
const SALT_KEY    = 'atenna_enc_salt';

interface Session {
  token: string;
  expires_at: number;
  plan: string;
}

// AES-GCM helpers
async function getDerivedKey(): Promise<CryptoKey> {
  const saltRaw = await new Promise<string | undefined>(r =>
    chrome.storage.local.get(SALT_KEY, res => r(res[SALT_KEY] as string | undefined))
  );
  let salt: Uint8Array;
  if (!saltRaw) {
    salt = crypto.getRandomValues(new Uint8Array(16));
    await new Promise<void>(r => chrome.storage.local.set({ [SALT_KEY]: Array.from(salt) }, r));
  } else {
    salt = new Uint8Array(saltRaw as unknown as number[]);
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
  await new Promise<void>(r => chrome.storage.local.remove(STORAGE_KEY, r));
}

// Serialize concurrent refresh calls
let _pendingRefresh: (() => Promise<Session>) | null = null;
let _refreshPromise: Promise<Session | null> | null  = null;

export function _setPendingRefresh(fn: () => Promise<Session>): void {
  _pendingRefresh = fn;
}

export async function getSession(): Promise<Session | null> {
  const raw = await new Promise<unknown>(r =>
    chrome.storage.local.get(STORAGE_KEY, res => r(res[STORAGE_KEY]))
  );
  if (!raw) return null;

  try {
    const json   = await decrypt(raw as { iv: number[]; data: number[] });
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
```

- [ ] **Step 4: Implement bffClient.ts**

```typescript
// src/auth/bffClient.ts
import { getSession, setSession, clearSession } from './sessionManager';

const BFF_BASE = 'https://atennaplugin.maestro-n8n.site';

interface BffSession { token: string; expires_at: number; plan: string; }
interface MeResponse  { user_id: string; email: string; plan: string; expires_at: number; }

async function bffFetch<T>(
  path: string,
  init: RequestInit = {},
  retry = true,
): Promise<T> {
  const session = await getSession();
  const headers: HeadersInit = {
    'Content-Type': 'application/json',
    ...(init.headers ?? {}),
    ...(session ? { Authorization: `Bearer ${session.token}` } : {}),
  };
  const r = await fetch(`${BFF_BASE}${path}`, { ...init, headers });
  if (r.status === 401 && retry && session) {
    const refreshed = await bffRefresh(session.token);
    if (refreshed) return bffFetch<T>(path, init, false);
    await clearSession();
    throw new Error('SESSION_EXPIRED');
  }
  if (!r.ok) throw new Error(`BFF ${path} → ${r.status}`);
  return r.json() as Promise<T>;
}

export async function bffLogin(email: string, password: string): Promise<BffSession> {
  const s = await bffFetch<BffSession>('/auth/login', {
    method: 'POST',
    body: JSON.stringify({ email, password }),
  }, false);
  await setSession(s);
  return s;
}

async function bffRefresh(token: string): Promise<boolean> {
  try {
    const s = await bffFetch<BffSession>('/auth/refresh', {
      method: 'POST',
      body: JSON.stringify({ token }),
    }, false);
    await setSession(s);
    return true;
  } catch {
    return false;
  }
}

export async function bffLogout(): Promise<void> {
  const session = await getSession();
  if (session) {
    await bffFetch('/auth/logout', {
      method: 'POST',
      body: JSON.stringify({ token: session.token }),
    }, false).catch(() => {});
  }
  await clearSession();
}

export async function bffMe(): Promise<MeResponse | null> {
  try {
    return await bffFetch<MeResponse>('/auth/me');
  } catch {
    return null;
  }
}

export { bffFetch };
```

- [ ] **Step 5: Run tests → expect PASS**

```bash
npx vitest run src/auth/__tests__/sessionManager.test.ts
```

Expected: 4/4 PASS

- [ ] **Step 6: Commit**

```bash
git add src/auth/sessionManager.ts src/auth/bffClient.ts src/auth/__tests__/sessionManager.test.ts
git commit -m "feat(FASE 4.6): AES-GCM session encryption + BFF client; client never holds raw Supabase JWT"
```

---

## TASK 3 — Remove ANON Key; Fix XSS; Patch sender origin

**Files:**
- Modify: `src/background/background.ts`
- Modify: `src/popup.ts`
- Modify: `src/ui/modal.ts`
- Modify: `manifest.json`

### What

1. Remove all `supabase.co` direct calls and `SUPABASE_ANON_KEY` from frontend.
2. Add sender origin guard to every `chrome.runtime.onMessage` handler.
3. Replace every `element.innerHTML = session.email` (or similar) with `element.textContent`.
4. Add CSP to `manifest.json`.

- [ ] **Step 1: Write harness tests**

```typescript
// src/__tests__/security.harness.test.ts
import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';
import { describe, it, expect } from 'vitest';

const DIST = join(__dirname, '../../dist');
const SRC  = join(__dirname, '..');

function readAll(dir: string, ext: string): string {
  return readdirSync(dir)
    .filter(f => f.endsWith(ext))
    .map(f => readFileSync(join(dir, f), 'utf-8'))
    .join('\n');
}

describe('Security Harness', () => {
  it('H-ZIP-1: dist contains no supabase.co URL or ANON key pattern', () => {
    const dist = readAll(DIST, '.js');
    expect(dist).not.toMatch(/supabase\.co/);
    expect(dist).not.toMatch(/eyJ[A-Za-z0-9_-]{20,}/); // JWT-like base64 blob
  });

  it('H-XSS-1: source never assigns innerHTML with dynamic user string', () => {
    const src = readAll(SRC, '.ts');
    // Detect: .innerHTML = ... where RHS is not a template literal containing only static strings
    // Simple heuristic: innerHTML = ` should only contain ${} with known-safe values
    const danger = /\.innerHTML\s*=\s*[^`'"][^;]+(?:email|name|input|value)/g;
    expect(src).not.toMatch(danger);
  });

  it('H-MSG-1: background.ts validates sender.id', () => {
    const bg = readFileSync(join(SRC, 'background/background.ts'), 'utf-8');
    expect(bg).toContain('sender.id');
    expect(bg).toContain('chrome.runtime.id');
  });
});
```

- [ ] **Step 2: Run harness → expect FAIL (reveals existing issues)**

```bash
npx vitest run src/__tests__/security.harness.test.ts
```

- [ ] **Step 3: Add sender origin guard to background.ts**

At the TOP of the `chrome.runtime.onMessage.addListener` callback (before any `if` blocks):

```typescript
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  // Guard: only accept messages from this extension
  if (sender.id !== chrome.runtime.id) {
    sendResponse({ ok: false, error: 'unauthorized' });
    return false;
  }
  // ... rest of handlers unchanged
```

- [ ] **Step 4: Remove direct Supabase calls from background.ts**

Search for any `fetch('https://...supabase.co...')` calls in background.ts.  
Replace with calls to `bffClient.ts` equivalents.

If `getStoredJWT()` reads `atenna_jwt`, update to call `getSession()` from `sessionManager.ts` instead. The function now returns the opaque token, passed as `Authorization: Bearer <opaque>` to backend.

- [ ] **Step 5: Fix innerHTML XSS in popup.ts and modal.ts**

Search for `innerHTML` assignments where user data (email, name, plan display) is interpolated. Replace pattern:

```typescript
// Before (XSS risk)
element.innerHTML = `<span>${session.email}</span>`;

// After (safe)
const span = document.createElement('span');
span.textContent = session.email;
element.appendChild(span);
```

- [ ] **Step 6: Add CSP to manifest.json**

```json
"content_security_policy": {
  "extension_pages": "script-src 'self'; object-src 'none'; base-uri 'none'"
}
```

Remove `https://*.supabase.co/*` from `host_permissions` (extension no longer calls Supabase directly).

- [ ] **Step 7: Run harness → expect PASS**

```bash
npm run build && npx vitest run src/__tests__/security.harness.test.ts
```

Expected: 3/3 PASS

- [ ] **Step 8: Commit**

```bash
git add src/background/background.ts src/popup.ts src/ui/modal.ts manifest.json src/__tests__/security.harness.test.ts
git commit -m "fix(FASE 4.6): sender origin guard, innerHTML→textContent XSS fix, remove ANON key, CSP added"
```

---

## TASK 4 — Wire popup.ts and modal.ts to bffClient

**Files:**
- Modify: `src/popup.ts`
- Modify: `src/ui/modal.ts`

### What

Replace all `signInWithPassword`, `signUpWithPassword`, `resetPassword`, `getActiveSession`, `getPlan` calls with BFF equivalents.

- [ ] **Step 1: Update popup.ts login flow**

```typescript
// src/popup.ts — login handler
import { bffLogin, bffLogout, bffMe } from './auth/bffClient';

// Replace signInWithPassword:
async function handleLogin(email: string, password: string): Promise<void> {
  try {
    await bffLogin(email, password);
    relayToggleModal(tabId);
    window.location.reload();
  } catch (e) {
    showLoginError('Email ou senha inválidos');
  }
}

// Replace getActiveSession:
async function initPopup(): Promise<void> {
  const [me, tabId] = await Promise.all([bffMe(), getActiveTabId()]);
  if (!me) { renderLogin(container, tabId); return; }
  renderHome(container, me, tabId);
}
```

- [ ] **Step 2: Update modal.ts plan sync**

Replace `syncPlanFromSupabase()` with call to `bffMe()`.  
The returned `plan` field drives the same plan-gating logic.

- [ ] **Step 3: Run full test suite**

```bash
npm run build && npx vitest run
```

Expected: all existing tests PASS (no regressions)

- [ ] **Step 4: Commit**

```bash
git add src/popup.ts src/ui/modal.ts
git commit -m "refactor(FASE 4.6): popup + modal use BFF client; zero direct Supabase calls in extension"
```

---

## TASK 5 — Final Harness Validation + VPS Deploy

**Files:**
- Modify: `backend/.env.example` (document new env var `SESSION_TTL_SECONDS`)
- Modify: `docs/VPS_ACCESS_GUIDE.md`

### What

1. Run full harness suite (unit + security + build).
2. Deploy to VPS.
3. Smoke-test login → modal → DLP scan → logout flow.

- [ ] **Step 1: Run complete validation**

```bash
npm run build
npx vitest run
cd backend && python -m pytest -v
cd .. && npx vitest run src/__tests__/security.harness.test.ts
```

All suites must be GREEN.

- [ ] **Step 2: Verify ZIP cleanliness**

```bash
cd dist && grep -r "supabase.co" . && echo "FAIL" || echo "PASS: no supabase.co in dist"
grep -r "eyJ" . --include="*.js" | head -5 && echo "CHECK for JWT blobs" || echo "PASS"
```

- [ ] **Step 3: Deploy to VPS**

```bash
ssh -i ~/.ssh/ATENNAPLUGIN-DEPLOY root@157.90.246.156 "cd /opt/atenna && git pull && docker compose restart atenna-backend"
```

- [ ] **Step 4: Smoke test**

```bash
# Login
curl -X POST https://atennaplugin.maestro-n8n.site/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"devdiegopro@gmail.com","password":"TEST"}' | jq .

# Me (replace TOKEN with returned opaque token)
curl https://atennaplugin.maestro-n8n.site/auth/me \
  -H "Authorization: Bearer TOKEN" | jq .
```

Expected: `{ "user_id": "...", "email": "devdiegopro@gmail.com", "plan": "pro" }`

- [ ] **Step 5: Update CHANGELOG**

Add under `## [Unreleased]`:

```markdown
### Security (FASE 4.6)
- BFF auth proxy: extension never holds Supabase JWT or ANON key
- AES-GCM token encryption in chrome.storage.local
- Sender origin validation on all chrome.runtime.onMessage handlers
- innerHTML → textContent fix (XSS prevention)
- CSP added to manifest.json
- Removed *.supabase.co from extension host_permissions
```

- [ ] **Step 6: Final commit**

```bash
git add CHANGELOG.md backend/.env.example docs/VPS_ACCESS_GUIDE.md
git commit -m "chore(FASE 4.6): harness GREEN, VPS deployed, CHANGELOG updated — security hardening complete"
git push
```

---

## HARNESS SUMMARY

| ID | Test | File | Passes When |
|----|------|------|-------------|
| H-ZIP-1 | No supabase.co in dist | `security.harness.test.ts` | `grep supabase.co dist/*.js` → empty |
| H-STORE-1 | Encrypted token ≠ raw JWT | `sessionManager.test.ts` | stored blob ≠ 3-segment base64 |
| H-MSG-1 | Sender origin guard present | `security.harness.test.ts` | `sender.id === chrome.runtime.id` in background.ts |
| H-XSS-1 | No unsafe innerHTML | `security.harness.test.ts` | zero regex matches in src/*.ts |
| H-LOG-1 | SERVICE_ROLE not in logs | `test_bff_auth.py` | key not in stringified client dict |
| H-RACE-1 | Concurrent refresh → 1 call | `sessionManager.test.ts` | mockRefresh called exactly once |

**All 6 harness IDs must be GREEN before Task 5 closes.**

---

## DEFINITION OF DONE

- [ ] `npm run build` exits 0
- [ ] `npx vitest run` — all existing tests pass + 4 new sessionManager tests
- [ ] `pytest` — all existing tests pass + 4 new bff_auth tests
- [ ] Security harness: 6/6 GREEN
- [ ] `grep -r "supabase.co" dist/` → empty
- [ ] VPS smoke test: `/auth/login` → opaque token, `/auth/me` → user data
- [ ] CHANGELOG updated
- [ ] No regressions in DLP scan, modal, badge flows
