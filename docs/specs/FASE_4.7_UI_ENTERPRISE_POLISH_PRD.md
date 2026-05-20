# FASE 4.7 — UI/UX Enterprise Polish

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` to implement task-by-task.

**Goal:** Close four UX regressions and one architectural debt item from Phases 4.4–4.6: plan-sync flicker on popup open, token refresh race condition producing duplicate API calls, modal.ts split into manageable files, missing "Esqueci senha" email confirmation screen, and inconsistent loading states across badge/popup/modal.

**Architecture:** No new dependencies. Decompose modal.ts (3300+ lines) into focused modules; add a React-free micro state machine for loading states.

**Tech Stack:** TypeScript strict, Chrome Extension MV3, Vitest

---

## FILE MAP

### Modified/Split Files

| Path | Change |
|------|--------|
| `src/ui/modal.ts` | Split into sub-modules below; becomes thin orchestrator |
| `src/ui/modal/tabs.ts` | Tab switching logic + render |
| `src/ui/modal/settings.ts` | Settings tab rendering + plan display |
| `src/ui/modal/upload.ts` | Upload widget + download flow |
| `src/ui/modal/onboarding.ts` | Onboarding overlay + pro welcome |
| `src/auth/refreshLock.ts` | Serialized token refresh (single in-flight promise) |
| `src/popup.ts` | Plan-sync after BFF session restore; skeleton loading |

---

## TASK 1 — Token Refresh Race Condition Fix

**Files:**
- Create: `src/auth/refreshLock.ts`
- Modify: `src/auth/bffClient.ts`

### What

Currently if the popup opens and three async functions all call `bffMe()` while the token is near-expiry, all three fire `POST /auth/refresh` simultaneously. The backend creates three new tokens and invalidates the old ones, causing a cascade of 401s. Fix: single in-flight refresh promise.

- [ ] **Step 1: Write failing test**

```typescript
// src/auth/__tests__/refreshLock.test.ts
import { describe, it, expect, vi } from 'vitest';
import { withRefreshLock } from '../refreshLock';

describe('withRefreshLock', () => {
  it('concurrent callers share one pending refresh', async () => {
    let callCount = 0;
    const refresh = vi.fn().mockImplementation(() => {
      callCount++;
      return new Promise<string>(r => setTimeout(() => r(`token-${callCount}`), 20));
    });

    const results = await Promise.all([
      withRefreshLock(refresh),
      withRefreshLock(refresh),
      withRefreshLock(refresh),
    ]);

    expect(refresh).toHaveBeenCalledTimes(1);
    expect(new Set(results).size).toBe(1); // all got the same result
  });

  it('sequential callers each trigger a refresh', async () => {
    const refresh = vi.fn()
      .mockResolvedValueOnce('a')
      .mockResolvedValueOnce('b');

    const r1 = await withRefreshLock(refresh);
    const r2 = await withRefreshLock(refresh);

    expect(refresh).toHaveBeenCalledTimes(2);
    expect(r1).toBe('a');
    expect(r2).toBe('b');
  });
});
```

- [ ] **Step 2: Run → FAIL**

```bash
npx vitest run src/auth/__tests__/refreshLock.test.ts
```

- [ ] **Step 3: Implement refreshLock.ts**

```typescript
// src/auth/refreshLock.ts
let _pending: Promise<unknown> | null = null;

export async function withRefreshLock<T>(fn: () => Promise<T>): Promise<T> {
  if (_pending) return _pending as Promise<T>;
  _pending = fn().finally(() => { _pending = null; });
  return _pending as Promise<T>;
}
```

- [ ] **Step 4: Wire into bffClient.ts**

In `bffFetch`, replace the inline refresh call:

```typescript
// Before
const refreshed = await bffRefresh(session.token);

// After
import { withRefreshLock } from './refreshLock';
const refreshed = await withRefreshLock(() => bffRefresh(session.token));
```

- [ ] **Step 5: Run → PASS**

```bash
npx vitest run src/auth/__tests__/refreshLock.test.ts
```

Expected: 2/2 PASS

- [ ] **Step 6: Commit**

```bash
git add src/auth/refreshLock.ts src/auth/bffClient.ts src/auth/__tests__/refreshLock.test.ts
git commit -m "fix(FASE 4.7): serialize token refresh — concurrent callers share one in-flight promise"
```

---

## TASK 2 — Popup Plan-Sync Skeleton Loading

**Files:**
- Modify: `src/popup.ts`

### What

Current: popup renders home immediately with stale cached plan, then syncs asynchronously — causing a visible plan label flicker (Free → Pro). Fix: render a skeleton while `bffMe()` resolves, then render final state.

- [ ] **Step 1: Write failing test**

```typescript
// src/__tests__/popup.plan-sync.test.ts
import { describe, it, expect, vi } from 'vitest';

// Mock chrome
vi.stubGlobal('chrome', {
  storage: { local: { get: vi.fn((_k, cb) => cb({})), set: vi.fn((_obj, cb) => cb?.()) } },
  runtime: { id: 'ext', lastError: null },
  tabs: { query: vi.fn((_q, cb) => cb([])) },
});

describe('renderHome skeleton', () => {
  it('shows skeleton before bffMe resolves', async () => {
    const { renderSkeleton } = await import('../popup');
    const container = document.createElement('div');
    renderSkeleton(container);
    expect(container.querySelector('.ap-skeleton')).toBeTruthy();
  });

  it('removes skeleton after data loads', async () => {
    const { renderSkeleton, replaceSkeleton } = await import('../popup');
    const container = document.createElement('div');
    renderSkeleton(container);
    replaceSkeleton(container, document.createElement('div'));
    expect(container.querySelector('.ap-skeleton')).toBeNull();
  });
});
```

- [ ] **Step 2: Run → FAIL**

- [ ] **Step 3: Add renderSkeleton + replaceSkeleton exports to popup.ts**

```typescript
// src/popup.ts
export function renderSkeleton(container: HTMLElement): void {
  container.innerHTML = '';
  const sk = document.createElement('div');
  sk.className = 'ap-skeleton';
  sk.innerHTML = '<div class="ap-sk-line ap-sk-w60"></div><div class="ap-sk-line ap-sk-w40"></div>';
  container.appendChild(sk);
}

export function replaceSkeleton(container: HTMLElement, content: HTMLElement): void {
  container.innerHTML = '';
  container.appendChild(content);
}

// Updated initPopup
async function initPopup(): Promise<void> {
  const container = document.getElementById('root')!;
  renderSkeleton(container);
  const [me, tabId] = await Promise.all([bffMe(), getActiveTabId()]);
  if (!me) { replaceSkeleton(container, buildLoginView(tabId)); return; }
  replaceSkeleton(container, buildHomeView(me, tabId));
}
```

Add skeleton CSS to `popup.html`:

```css
.ap-skeleton { padding: 24px; display: flex; flex-direction: column; gap: 10px; }
.ap-sk-line  { height: 12px; border-radius: 6px; background: #2a2a2a; animation: ap-sk-pulse 1.4s ease infinite; }
.ap-sk-w60   { width: 60%; }
.ap-sk-w40   { width: 40%; }
@keyframes ap-sk-pulse { 0%,100%{opacity:.4} 50%{opacity:.8} }
```

- [ ] **Step 4: Run → PASS**

```bash
npx vitest run src/__tests__/popup.plan-sync.test.ts
```

- [ ] **Step 5: Commit**

```bash
git add src/popup.ts popup.html
git commit -m "fix(FASE 4.7): popup skeleton loading — no plan-label flicker on open"
```

---

## TASK 3 — modal.ts Decomposition (Phase 1 of Split)

**Files:**
- Create: `src/ui/modal/onboarding.ts`
- Modify: `src/ui/modal.ts` (extract onboarding + pro-welcome)

### What

modal.ts at 3300+ lines is a maintenance hazard. Split out the highest-churn section first: onboarding overlays and pro welcome card. This is the section that had the double-welcome bug. Isolating it makes future changes safe.

- [ ] **Step 1: Identify onboarding functions in modal.ts**

Grep for functions containing `onboarding`, `proWelcome`, `showProWelcomeOverlay`, `consumeProWelcome`:

```bash
grep -n "function\|const.*=.*(" src/ui/modal.ts | grep -i "onboard\|proWelcome\|welcome\|consume"
```

Note the line numbers.

- [ ] **Step 2: Write tests to pin current behavior**

```typescript
// src/ui/modal/__tests__/onboarding.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.stubGlobal('chrome', {
  storage: {
    local: {
      get: vi.fn((_k, cb) => cb({})),
      set: vi.fn((_obj, cb) => cb?.()),
      remove: vi.fn((_k, cb) => cb?.()),
    },
  },
});

describe('consumeProWelcome', () => {
  it('returns true once then false', async () => {
    const { setProWelcomeFlag, consumeProWelcome } = await import('../onboarding');
    await setProWelcomeFlag();
    expect(await consumeProWelcome()).toBe(true);
    expect(await consumeProWelcome()).toBe(false);
  });

  it('upgradedToPro=true always clears flag', async () => {
    const { setProWelcomeFlag, resolveWelcomeState } = await import('../onboarding');
    await setProWelcomeFlag();
    const { showWelcome } = await resolveWelcomeState(true); // upgradedToPro
    expect(showWelcome).toBe(true);
    // flag must be cleared — second call returns false
    const { showWelcome: second } = await resolveWelcomeState(false);
    expect(second).toBe(false);
  });
});
```

- [ ] **Step 3: Run → FAIL**

- [ ] **Step 4: Create src/ui/modal/onboarding.ts**

Extract from modal.ts:

```typescript
// src/ui/modal/onboarding.ts
const PRO_WELCOME_KEY = 'atenna_pro_welcome_pending';

export async function setProWelcomeFlag(): Promise<void> {
  await new Promise<void>(r => chrome.storage.local.set({ [PRO_WELCOME_KEY]: true }, r));
}

export async function consumeProWelcome(): Promise<boolean> {
  const val = await new Promise<boolean>(r =>
    chrome.storage.local.get(PRO_WELCOME_KEY, res => r(!!res[PRO_WELCOME_KEY]))
  );
  if (val) await new Promise<void>(r => chrome.storage.local.remove(PRO_WELCOME_KEY, r));
  return val;
}

export async function resolveWelcomeState(
  upgradedToPro: boolean,
): Promise<{ showWelcome: boolean }> {
  const showWelcome = upgradedToPro || (await consumeProWelcome());
  if (upgradedToPro) await consumeProWelcome(); // always clear
  return { showWelcome };
}
```

- [ ] **Step 5: In modal.ts, replace inline PRO_WELCOME_KEY logic with imports**

```typescript
import { resolveWelcomeState } from './modal/onboarding';

// In openModal() replace the block:
const { showWelcome } = await resolveWelcomeState(upgradedToPro);
if (showWelcome) {
  close();
  showProWelcomeOverlay(session, () => openModal(autoGenerate));
  return;
}
```

- [ ] **Step 6: Run tests → PASS**

```bash
npx vitest run src/ui/modal/__tests__/onboarding.test.ts
npx vitest run  # full suite — no regressions
```

- [ ] **Step 7: Commit**

```bash
git add src/ui/modal/onboarding.ts src/ui/modal.ts src/ui/modal/__tests__/onboarding.test.ts
git commit -m "refactor(FASE 4.7): extract onboarding/pro-welcome from modal.ts into modal/onboarding.ts"
```

---

## TASK 4 — "Esqueci Senha" Confirmation Screen

**Files:**
- Modify: `src/popup.ts`

### What

Currently `resetPassword(email)` is called but the popup shows nothing after — user doesn't know if the email was sent. Add an inline confirmation view inside the popup.

- [ ] **Step 1: Write test**

```typescript
// src/__tests__/popup.reset.test.ts
import { describe, it, expect, vi } from 'vitest';

describe('renderPasswordResetConfirmation', () => {
  it('renders success message with email', async () => {
    const { renderPasswordResetConfirmation } = await import('../popup');
    const container = document.createElement('div');
    renderPasswordResetConfirmation(container, 'user@test.com');
    expect(container.textContent).toContain('user@test.com');
    expect(container.textContent).toContain('email');
  });
});
```

- [ ] **Step 2: Run → FAIL**

- [ ] **Step 3: Implement renderPasswordResetConfirmation in popup.ts**

```typescript
export function renderPasswordResetConfirmation(container: HTMLElement, email: string): void {
  container.innerHTML = '';
  const wrap = document.createElement('div');
  wrap.className = 'ap-root ap-root--login';

  const icon = document.createElement('div');
  icon.textContent = '✉️';
  icon.style.fontSize = '32px';

  const title = document.createElement('h2');
  title.className = 'ap-title';
  title.textContent = 'Email enviado';

  const body = document.createElement('p');
  body.className = 'ap-subtitle';
  // textContent only — no innerHTML with user data
  body.textContent = `Verifique sua caixa de entrada em ${email} e clique no link para redefinir a senha.`;

  const backBtn = document.createElement('button');
  backBtn.className = 'ap-link-btn';
  backBtn.textContent = '← Voltar ao login';
  backBtn.addEventListener('click', () => renderLogin(container, null));

  wrap.append(icon, title, body, backBtn);
  container.appendChild(wrap);
}
```

Update the `resetPassword` handler in `renderLogin`:

```typescript
forgotBtn.addEventListener('click', async () => {
  if (!emailInput.value) return;
  forgotBtn.disabled = true;
  forgotBtn.textContent = 'Enviando…';
  await bffResetPassword(emailInput.value);
  renderPasswordResetConfirmation(container, emailInput.value);
});
```

Add `bffResetPassword` to bffClient.ts:

```typescript
export async function bffResetPassword(email: string): Promise<void> {
  await bffFetch('/auth/reset-password', {
    method: 'POST',
    body: JSON.stringify({ email }),
  }, false).catch(() => {});
}
```

Add backend endpoint to bff_auth.py:

```python
class ResetRequest(BaseModel):
    email: str

@router.post("/reset-password")
async def reset_password(req: ResetRequest):
    try:
        get_admin_client().auth.reset_password_email(req.email)
    except Exception:
        pass  # always 200 to avoid user enumeration
    return {"ok": True}
```

- [ ] **Step 4: Run → PASS**

```bash
npx vitest run src/__tests__/popup.reset.test.ts
```

- [ ] **Step 5: Commit**

```bash
git add src/popup.ts src/auth/bffClient.ts backend/routes/bff_auth.py
git commit -m "feat(FASE 4.7): forgot-password confirmation screen; /auth/reset-password BFF endpoint"
```

---

## TASK 5 — Full Build + Harness + VPS Deploy

- [ ] **Step 1: Run complete suite**

```bash
npm run build
npx vitest run
cd backend && python -m pytest -v
```

Expected: all GREEN, 0 TypeScript errors.

- [ ] **Step 2: Manual smoke test**

Open extension popup:
1. Click "Esqueci minha senha" → type email → click → confirm screen appears with email visible
2. Back to login → login → home renders with skeleton briefly → plan label stable
3. Open modal → DLP scan works

- [ ] **Step 3: Deploy to VPS**

```bash
ssh -i ~/.ssh/ATENNAPLUGIN-DEPLOY root@157.90.246.156 "cd /opt/atenna && git pull && docker compose restart atenna-backend"
```

- [ ] **Step 4: Update CHANGELOG**

```markdown
### Changed (FASE 4.7)
- Popup skeleton loading — eliminates plan-label flicker on open
- Token refresh serialized — no duplicate /auth/refresh calls
- modal.ts Phase 1 decomposition — onboarding extracted to modal/onboarding.ts
- "Esqueci senha" inline confirmation screen
- /auth/reset-password BFF endpoint (no user enumeration risk)
```

- [ ] **Step 5: Final commit + push**

```bash
git add CHANGELOG.md
git commit -m "chore(FASE 4.7): changelog, harness GREEN, VPS deployed"
git push
```

---

## HARNESS SUMMARY

| ID | Test | Passes When |
|----|------|-------------|
| H-RACE-2 | `withRefreshLock` concurrent → 1 call | `refreshLock.test.ts` 2/2 |
| H-SKEL-1 | Skeleton renders + removes | `popup.plan-sync.test.ts` 2/2 |
| H-ONBOARD-1 | `consumeProWelcome` one-shot | `onboarding.test.ts` 2/2 |
| H-RESET-1 | Confirmation screen shows email via textContent | `popup.reset.test.ts` 1/1 |

## DEFINITION OF DONE

- [ ] `npm run build` exits 0
- [ ] All 4 harness IDs GREEN
- [ ] No regressions in full `npx vitest run`
- [ ] VPS smoke test passes
- [ ] modal.ts line count reduced by ≥ 150 lines (onboarding extracted)
- [ ] CHANGELOG updated
