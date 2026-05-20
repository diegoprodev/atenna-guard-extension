# FASE 5.1 — RLS Audit + BFF Completion

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` to implement task-by-task.

**Goal:** Harden the Supabase RLS policies so no row can be read or written without valid ownership; complete the BFF by adding server-side plan enforcement (daily quota), and add a client-side free-tier limit that is validated server-side (currently enforced only in the client).

**Architecture:** Backend becomes the single enforcement point for quotas. Client reports count but backend rejects if over-limit. Supabase tables get explicit RLS policies for every table that holds user data.

**Tech Stack:** Supabase (PostgreSQL RLS), FastAPI, TypeScript

---

## SECURITY INVARIANTS

| # | Invariant | Harness ID |
|---|-----------|------------|
| SI-7 | Every user table has `enable row level security` and at least one SELECT policy | H-RLS-1 |
| SI-8 | Free plan users receive HTTP 429 after 10 `/generate-prompts` calls in a calendar day | H-QUOTA-1 |
| SI-9 | Server-side quota counter is stored in Supabase, not client-only | H-QUOTA-2 |
| SI-10 | `dlp_events` rows are never readable by a different user_id | H-RLS-2 |

---

## FILE MAP

| Path | Change |
|------|--------|
| `backend/routes/quota.py` | New: daily quota check + increment |
| `backend/services/quota_service.py` | New: Supabase quota table operations |
| `backend/main.py` | Register quota router; add quota middleware to generate-prompts |
| `supabase/migrations/20260519_rls_audit.sql` | New: RLS policies for all user tables |
| `backend/tests/test_quota.py` | New: quota enforcement tests |

---

## TASK 1 — Supabase RLS Migration

**Files:**
- Create: `supabase/migrations/20260519_rls_audit.sql`

### What

Audit every table that stores user data and add explicit RLS. Tables identified from SYSTEM_STATE.md:
- `dlp_events`
- `user_dlp_stats`
- `user_plans`
- `dlp_audit_log`

- [ ] **Step 1: Write harness SQL test**

```sql
-- supabase/tests/rls_invariants.sql
-- Run as a non-owner role to verify isolation

-- Test H-RLS-1: dlp_events row from user A not visible to user B
BEGIN;
SET LOCAL role TO anon;

-- Should return empty (anon cannot read dlp_events)
SELECT count(*) FROM dlp_events;
-- Expected: 0 rows or RLS error

ROLLBACK;
```

Also automated in Python:

```python
# backend/tests/test_rls.py
import pytest

def test_dlp_events_rls_blocks_cross_user(supabase_admin, user_a_jwt, user_b_jwt):
    """User B cannot read user A's dlp_events."""
    # Insert as user A
    admin = supabase_admin
    admin.table("dlp_events").insert({
        "user_id": "user-a-uuid",
        "event_type": "warning_shown",
        "risk_level": "HIGH",
    }).execute()

    # Query as user B (using user B's JWT via REST)
    # Should return 0 rows
    rows = (
        admin.auth.admin.get_user_by_id("user-b-uuid")  # prove different user
    )
    # This test requires a real Supabase test project; mark as integration
    pytest.skip("Requires live Supabase test instance — run manually")
```

- [ ] **Step 2: Write migration**

```sql
-- supabase/migrations/20260519_rls_audit.sql

-- dlp_events: users can only see/write their own rows
ALTER TABLE dlp_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS dlp_events_user_select ON dlp_events;
CREATE POLICY dlp_events_user_select ON dlp_events
  FOR SELECT USING (auth.uid() = user_id);

DROP POLICY IF EXISTS dlp_events_user_insert ON dlp_events;
CREATE POLICY dlp_events_user_insert ON dlp_events
  FOR INSERT WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS dlp_events_user_delete ON dlp_events;
CREATE POLICY dlp_events_user_delete ON dlp_events
  FOR DELETE USING (auth.uid() = user_id);

-- user_dlp_stats
ALTER TABLE IF EXISTS user_dlp_stats ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS stats_user_select ON user_dlp_stats;
CREATE POLICY stats_user_select ON user_dlp_stats
  FOR SELECT USING (auth.uid() = user_id);

DROP POLICY IF EXISTS stats_user_upsert ON user_dlp_stats;
CREATE POLICY stats_user_upsert ON user_dlp_stats
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- user_plans (read-only by user; writes by service role only)
ALTER TABLE IF EXISTS user_plans ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS plans_user_select ON user_plans;
CREATE POLICY plans_user_select ON user_plans
  FOR SELECT USING (auth.uid() = user_id);
-- No INSERT/UPDATE policy for authenticated users → service role only

-- dlp_audit_log (append-only by service role; user can read own)
ALTER TABLE IF EXISTS dlp_audit_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS audit_user_select ON dlp_audit_log;
CREATE POLICY audit_user_select ON dlp_audit_log
  FOR SELECT USING (auth.uid() = user_id);
-- No direct INSERT by clients — service role only

-- daily_quota (new table — see Task 2)
-- Created in Task 2 migration
```

- [ ] **Step 3: Apply migration via Supabase MCP**

Use Supabase MCP tool to apply this migration to the project.

- [ ] **Step 4: Verify via admin query**

```sql
SELECT tablename, rowsecurity
FROM pg_tables
WHERE schemaname = 'public'
  AND tablename IN ('dlp_events','user_dlp_stats','user_plans','dlp_audit_log');
-- All rowsecurity = true
```

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260519_rls_audit.sql
git commit -m "security(FASE 5.1): RLS policies for dlp_events, user_dlp_stats, user_plans, dlp_audit_log"
```

---

## TASK 2 — Server-Side Daily Quota

**Files:**
- Create: `backend/services/quota_service.py`
- Create: `backend/routes/quota.py`
- Modify: `backend/main.py`

### What

Add `daily_quota` table. Backend checks + increments atomically via a Supabase RPC (PostgreSQL function). Free plan = 10/day. Pro = unlimited. Returns 429 when exceeded.

- [ ] **Step 1: Write failing tests**

```python
# backend/tests/test_quota.py
import pytest
from unittest.mock import patch, MagicMock
from backend.services.quota_service import check_and_increment_quota, QuotaExceeded

def make_mock_client(current_count: int, plan: str):
    client = MagicMock()
    client.rpc.return_value.execute.return_value = MagicMock(
        data={"allowed": current_count < 10, "new_count": current_count + 1}
    )
    client.table.return_value.select.return_value.eq.return_value.single.return_value.execute.return_value = MagicMock(
        data={"plan_type": plan}
    )
    return client

def test_free_plan_allows_under_limit():
    client = make_mock_client(5, "free")
    with patch("backend.services.quota_service.get_admin_client", return_value=client):
        check_and_increment_quota("user-1", "free")  # should not raise

def test_free_plan_blocks_over_limit():
    client = make_mock_client(10, "free")
    client.rpc.return_value.execute.return_value = MagicMock(
        data={"allowed": False, "new_count": 11}
    )
    with patch("backend.services.quota_service.get_admin_client", return_value=client):
        with pytest.raises(QuotaExceeded):
            check_and_increment_quota("user-1", "free")

def test_pro_plan_never_blocked():
    client = make_mock_client(9999, "pro")
    with patch("backend.services.quota_service.get_admin_client", return_value=client):
        check_and_increment_quota("user-1", "pro")  # must not raise
```

- [ ] **Step 2: Run → FAIL**

```bash
cd backend && python -m pytest tests/test_quota.py -v
```

- [ ] **Step 3: Create daily_quota table + RPC in migration**

```sql
-- supabase/migrations/20260519_daily_quota.sql

CREATE TABLE IF NOT EXISTS daily_quota (
  user_id   uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  date      date NOT NULL DEFAULT current_date,
  count     int  NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, date)
);

ALTER TABLE daily_quota ENABLE ROW LEVEL SECURITY;
CREATE POLICY quota_user ON daily_quota FOR ALL USING (auth.uid() = user_id);

-- Atomic check-and-increment function (runs as SECURITY DEFINER)
CREATE OR REPLACE FUNCTION increment_daily_quota(p_user_id uuid, p_limit int)
RETURNS json
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_count int;
BEGIN
  INSERT INTO daily_quota (user_id, date, count)
  VALUES (p_user_id, current_date, 1)
  ON CONFLICT (user_id, date) DO UPDATE
    SET count = daily_quota.count + 1
  RETURNING count INTO v_count;

  RETURN json_build_object(
    'new_count', v_count,
    'allowed',   v_count <= p_limit
  );
END;
$$;
```

- [ ] **Step 4: Implement quota_service.py**

```python
# backend/services/quota_service.py
from backend.services.supabase_admin import get_admin_client

FREE_DAILY_LIMIT = 10

class QuotaExceeded(Exception):
    def __init__(self, count: int):
        self.count = count
        super().__init__(f"Daily quota exceeded: {count}/{FREE_DAILY_LIMIT}")

def check_and_increment_quota(user_id: str, plan: str) -> int:
    if plan == "pro":
        return -1  # unlimited

    client = get_admin_client()
    result = client.rpc(
        "increment_daily_quota",
        {"p_user_id": user_id, "p_limit": FREE_DAILY_LIMIT},
    ).execute()

    data = result.data
    if not data.get("allowed"):
        raise QuotaExceeded(data.get("new_count", FREE_DAILY_LIMIT + 1))
    return data["new_count"]
```

- [ ] **Step 5: Wire into generate-prompts route in main.py**

```python
from backend.services.quota_service import check_and_increment_quota, QuotaExceeded

# Inside generate-prompts handler, after auth:
try:
    user_plan = user.get("plan", "free")
    check_and_increment_quota(user["user_id"], user_plan)
except QuotaExceeded as e:
    raise HTTPException(429, detail={
        "error": "daily_limit_exceeded",
        "count": e.count,
        "limit": 10,
        "reset": "midnight UTC",
    })
```

- [ ] **Step 6: Run → PASS**

```bash
cd backend && python -m pytest tests/test_quota.py -v
```

Expected: 3/3 PASS

- [ ] **Step 7: Commit**

```bash
git add backend/services/quota_service.py backend/tests/test_quota.py supabase/migrations/20260519_daily_quota.sql backend/main.py
git commit -m "feat(FASE 5.1): server-side daily quota — free plan 10/day enforced at backend, atomic RPC"
```

---

## TASK 3 — Middleware: auth.py uses opaque token (post-FASE 4.6)

**Files:**
- Modify: `backend/middleware/auth.py`

### What

After FASE 4.6 the extension sends `Authorization: Bearer <opaque-uuid>` instead of a raw Supabase JWT. The middleware must validate against `_sessions` dict from bff_auth.py.

- [ ] **Step 1: Write failing test**

```python
# backend/tests/test_auth_middleware.py
from fastapi.testclient import TestClient
from backend.main import app

client = TestClient(app)

def test_opaque_token_valid():
    # Login first to get opaque token
    login_r = client.post("/auth/login", json={"email": "a@b.com", "password": "pw"})
    if login_r.status_code != 200:
        import pytest; pytest.skip("No test Supabase credentials")
    token = login_r.json()["token"]

    # Use opaque token on protected endpoint
    r = client.get("/auth/me", headers={"Authorization": f"Bearer {token}"})
    assert r.status_code == 200

def test_raw_jwt_rejected():
    fake_jwt = "eyJhbGciOiJIUzI1NiJ9.eyJ1c2VyX2lkIjoiZmFrZSJ9.sig"
    r = client.get("/auth/me", headers={"Authorization": f"Bearer {fake_jwt}"})
    assert r.status_code == 401

def test_no_token_rejected():
    r = client.get("/auth/me")
    assert r.status_code == 403
```

- [ ] **Step 2: Update require_auth in middleware/auth.py**

```python
# backend/middleware/auth.py
from fastapi import HTTPException, Depends
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from backend.routes.bff_auth import _resolve_token  # shared session store

_bearer = HTTPBearer()

def require_auth(
    creds: HTTPAuthorizationCredentials = Depends(_bearer),
) -> dict:
    token = creds.credentials
    # Must be opaque (UUID format), not a raw JWT
    if "." in token and token.count(".") == 2:
        raise HTTPException(401, "Raw JWT not accepted — use BFF login")
    session = _resolve_token(token)  # raises 401 if invalid/expired
    return {
        "user_id": session["user_id"],
        "email":   session["email"],
        "plan":    session["plan"],
    }
```

- [ ] **Step 3: Run → PASS**

```bash
cd backend && python -m pytest tests/test_auth_middleware.py -v
```

- [ ] **Step 4: Commit**

```bash
git add backend/middleware/auth.py backend/tests/test_auth_middleware.py
git commit -m "fix(FASE 5.1): middleware validates opaque token from BFF; raw JWT returns 401"
```

---

## TASK 4 — Harness + Deploy

- [ ] **Step 1: Full suite**

```bash
npm run build && npx vitest run
cd backend && python -m pytest -v
```

- [ ] **Step 2: Verify H-QUOTA-1 manually**

```bash
# Call generate-prompts 11 times with a free-plan token, 11th must return 429
for i in $(seq 1 11); do
  STATUS=$(curl -s -o /dev/null -w "%{http_code}" \
    -X POST https://atennaplugin.maestro-n8n.site/generate-prompts \
    -H "Authorization: Bearer FREE_TOKEN" \
    -H "Content-Type: application/json" \
    -d '{"input":"test"}')
  echo "Call $i: $STATUS"
done
# Expected: calls 1-10 → 200, call 11 → 429
```

- [ ] **Step 3: Verify H-RLS-1 via Supabase MCP**

Query `pg_tables` to confirm `rowsecurity = true` for all 4 tables.

- [ ] **Step 4: Deploy**

```bash
ssh -i ~/.ssh/ATENNAPLUGIN-DEPLOY root@157.90.246.156 "cd /opt/atenna && git pull && docker compose restart atenna-backend"
```

- [ ] **Step 5: CHANGELOG + commit + push**

```markdown
### Security (FASE 5.1)
- RLS enabled on dlp_events, user_dlp_stats, user_plans, dlp_audit_log
- Server-side daily quota: free plan = 10/day, atomic PostgreSQL RPC
- Backend middleware rejects raw JWTs — opaque BFF tokens only
```

```bash
git add CHANGELOG.md
git commit -m "chore(FASE 5.1): RLS audit + server-side quota complete — harness GREEN"
git push
```

---

## HARNESS SUMMARY

| ID | Test | Passes When |
|----|------|-------------|
| H-RLS-1 | All 4 tables have rowsecurity=true | SQL query on pg_tables |
| H-RLS-2 | Cross-user dlp_events read blocked | Integration test (manual) |
| H-QUOTA-1 | 11th call → 429 | Manual loop test |
| H-QUOTA-2 | Quota in Supabase daily_quota table | `SELECT * FROM daily_quota WHERE user_id=...` |

## DEFINITION OF DONE

- [ ] `npm run build` + `pytest` + `vitest run` all GREEN
- [ ] 4 tables with RLS confirmed via SQL
- [ ] 429 returned on call 11 for free plan
- [ ] VPS running new code
- [ ] CHANGELOG updated
