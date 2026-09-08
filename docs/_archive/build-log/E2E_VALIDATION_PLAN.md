# TASK 5: End-to-End Validation Plan

**Status:** Planning & Documentation  
**Target:** All critical flows validated before TASK 6  
**Authority:** Production API endpoints

---

## OVERVIEW

This document defines TASK 5 validation criteria and testing procedures for the complete DLP pipeline:

```
Extension → Backend → DLP Engine → LLM → Response
```

Validation covers:
1. ✅ Frontend DLP detection accuracy
2. ✅ Server-side revalidation
3. ✅ Strict Mode enforcement
4. ✅ Telemetry persistence
5. ✅ Export/Deletion workflows
6. ✅ Error handling & fallbacks

---

## TEST MATRIX

### Scenario 1: CPF Detection (HIGH Risk)

| Layer | Test | Expected | Status |
|-------|------|----------|--------|
| **Frontend** | Local scan detects CPF pattern | Badge shows HIGH (red) | 🔄 Need to run |
| **Frontend** | DLP metadata created | `{risk: "HIGH", entity_types: ["BR_CPF"]}` | 🔄 Need to run |
| **Backend** | Server revalidation confirms | Same or higher risk | 🔄 Need to run |
| **Backend** | Strict Mode observes (false) | Logs "dlp_strict_would_apply" | 🔄 Need to run |
| **Backend** | LLM receives original | "CPF 123.456.789-10" (unchanged) | 🔄 Need to run |
| **Telemetry** | Event logged | `dlp_strict_evaluated` event stored | 🔄 Need to run |

### Scenario 2: Email Detection (MEDIUM Risk)

| Layer | Test | Expected | Status |
|-------|------|----------|--------|
| **Frontend** | Local scan detects email | Badge shows MEDIUM | 🔄 Need to run |
| **Backend** | Server analysis | Risk = MEDIUM or lower | 🔄 Need to run |
| **Backend** | Not HIGH, so no rewrite | Input unchanged | 🔄 Need to run |
| **Telemetry** | Medium-risk event logged | Entity type = EMAIL_ADDRESS | 🔄 Need to run |

### Scenario 3: API Key Detection (HIGH Risk)

| Layer | Test | Expected | Status |
|-------|------|----------|--------|
| **Frontend** | Local scan detects sk_live_* | Badge shows HIGH | 🔄 Need to run |
| **Backend** | Strict mode OFF | Original sent to LLM | 🔄 Need to run |
| **Telemetry** | HIGH-risk alert | Event risk_level = HIGH | 🔄 Need to run |

### Scenario 4: Client-Server Mismatch

| Layer | Test | Expected | Status |
|-------|------|----------|--------|
| **Backend** | Client says LOW, server says HIGH | Mismatch detected | 🔄 Need to run |
| **Backend** | Mismatch logged | `dlp_client_server_divergence` event | 🔄 Need to run |
| **Backend** | Server risk used for enforcement | HIGH risk enforced, not client LOW | 🔄 Need to run |
| **Telemetry** | Divergence event recorded | confidence score, divergence_type | 🔄 Need to run |

### Scenario 5: Multiple Entities

| Layer | Test | Expected | Status |
|-------|------|----------|--------|
| **Frontend** | Input: "CPF X, email Y, API key Z" | All 3 detected | 🔄 Need to run |
| **Backend** | Server analysis | 3 entities found | 🔄 Need to run |
| **Telemetry** | Aggregated count | entity_count = 3 | 🔄 Need to run |

### Scenario 6: Export Request

| Layer | Test | Expected | Status |
|-------|------|----------|--------|
| **Frontend** | User clicks "Export Data" | Modal shows email confirmation | 🔄 Need to run |
| **Backend** | POST /user/export/request | 200 OK, export_id returned | 🔄 Need to run |
| **Telemetry** | Export initiated | Event type = "export_initiated" | 🔄 Need to run |
| **Workflow** | User confirms via email | Export processing starts | ⚠️ Manual approval needed |
| **Workflow** | Download ready | Clickable link sent | ⚠️ Email verification needed |

### Scenario 7: Deletion Request

| Layer | Test | Expected | Status |
|-------|------|----------|--------|
| **Frontend** | User clicks "Delete Account" | Confirmation modal shown | 🔄 Need to run |
| **Backend** | POST /user/deletion/initiate | 200 OK, deletion_id returned | 🔄 Need to run |
| **Workflow** | Grace period starts | 7-day countdown | 🔄 Need to run |
| **Telemetry** | Deletion tracked | deletion_status = "pending_confirmation" | 🔄 Need to run |
| **Workflow** | User cancels | DELETE /user/deletion/cancel → 200 OK | 🔄 Need to run |

---

## TESTING PROCEDURE

### Pre-Test Setup

```bash
# 1. Get test JWT from Supabase (or create test user)
# Required: Supabase project access with test credentials

# 2. Set environment
export BACKEND_URL="https://atennaplugin.maestro-n8n.site"
export JWT_TOKEN="<valid JWT from Supabase>"

# 3. Verify health
curl $BACKEND_URL/health
# Expected: {"status": "ok"}
```

### Test 1: CPF Detection Flow

```bash
#!/bin/bash
# tests/e2e/validate_cpf_flow.sh

BACKEND_URL="https://atennaplugin.maestro-n8n.site"
JWT="Bearer $JWT_TOKEN"

echo "=== TASK 5.1: CPF Detection ==="

# Step 1: Send HIGH-risk CPF input
curl -X POST "$BACKEND_URL/generate-prompts" \
  -H "Authorization: $JWT" \
  -H "Content-Type: application/json" \
  -d '{
    "input": "Please help fix my code. My CPF is 529.982.247-25.",
    "dlp": {
      "dlp_risk_level": "HIGH",
      "dlp_entity_count": 1,
      "dlp_entity_types": ["BR_CPF"],
      "dlp_session_id": "test-cpf-123"
    }
  }' > response.json

# Step 2: Validate response
echo "Response status: $(jq '.status' response.json)"
echo "Response has 3 prompts: $(jq '.prompts | length' response.json)"

# Step 3: Check logs for telemetry
echo ""
echo "Expected in logs:"
echo "  - dlp_prompt_received (entity_types: [BR_CPF])"
echo "  - dlp_strict_evaluated (would_apply: true, applied: false)"
echo "  - dlp_strict_would_apply (mode=false)"
```

### Test 2: Mismatch Detection

```bash
#!/bin/bash
# tests/e2e/validate_mismatch_flow.sh

BACKEND_URL="https://atennaplugin.maestro-n8n.site"
JWT="Bearer $JWT_TOKEN"

echo "=== TASK 5.2: Client-Server Mismatch ==="

# Client says LOW, but text contains HIGH-risk CPF
curl -X POST "$BACKEND_URL/generate-prompts" \
  -H "Authorization: $JWT" \
  -H "Content-Type: application/json" \
  -d '{
    "input": "Code review needed. CPF 529.982.247-25",
    "dlp": {
      "dlp_risk_level": "LOW",
      "dlp_entity_count": 0,
      "dlp_entity_types": [],
      "dlp_session_id": "test-mismatch-456"
    }
  }' > response.json

# Expected: Server detects HIGH, logs divergence
echo "Mismatch should be detected in logs:"
echo "  Event: dlp_client_server_divergence"
echo "  client_risk: LOW"
echo "  server_risk: HIGH"
```

### Test 3: Export Request

```bash
#!/bin/bash
# tests/e2e/validate_export_flow.sh

BACKEND_URL="https://atennaplugin.maestro-n8n.site"
JWT="Bearer $JWT_TOKEN"

echo "=== TASK 5.3: Export Request ==="

# Step 1: Initiate export
curl -X POST "$BACKEND_URL/user/export/request" \
  -H "Authorization: $JWT" \
  -H "Content-Type: application/json" \
  -d '{"email": "test@example.com"}' > export_response.json

export_id=$(jq -r '.export_id' export_response.json)
echo "Export ID: $export_id"
echo "Status: $(jq -r '.status' export_response.json)"

# Step 2: Check export status
curl -X GET "$BACKEND_URL/user/export/status/$export_id" \
  -H "Authorization: $JWT" > status_response.json

echo "Export status: $(jq -r '.status' status_response.json)"
```

### Test 4: Deletion Request

```bash
#!/bin/bash
# tests/e2e/validate_deletion_flow.sh

BACKEND_URL="https://atennaplugin.maestro-n8n.site"
JWT="Bearer $JWT_TOKEN"

echo "=== TASK 5.4: Deletion Request ==="

# Step 1: Initiate deletion
curl -X POST "$BACKEND_URL/user/deletion/initiate" \
  -H "Authorization: $JWT" \
  -H "Content-Type: application/json" \
  -d '{"reason": "Testing"}' > deletion_response.json

deletion_id=$(jq -r '.deletion_id' deletion_response.json)
echo "Deletion ID: $deletion_id"
echo "Grace period days: $(jq -r '.grace_period_days' deletion_response.json)"

# Step 2: Confirm deletion via email (requires manual step)
echo "Note: User must confirm via email link"

# Step 3: Check deletion status
curl -X GET "$BACKEND_URL/user/deletion/status/$deletion_id" \
  -H "Authorization: $JWT" > status_response.json

echo "Deletion status: $(jq -r '.status' status_response.json)"

# Step 4: Cancel deletion (within grace period)
curl -X POST "$BACKEND_URL/user/deletion/cancel/$deletion_id" \
  -H "Authorization: $JWT" > cancel_response.json

echo "Cancellation: $(jq -r '.status' cancel_response.json)"
```

---

## VALIDATION CRITERIA

### Success Criteria

```
✅ All test scenarios complete without errors
✅ HTTP 200 responses for all endpoints
✅ Response schemas match specification
✅ Telemetry events logged correctly
✅ No PII appears in plain-text logs
✅ Server risk scores are accurate
✅ Mismatch detection triggers correctly
```

### Failure Criteria

```
❌ Any endpoint returns 5xx error
❌ JWT validation fails
❌ Pydantic validation fails (422)
❌ PII appears in plain text in logs
❌ DLP detection misses entities
❌ Export/Deletion status never transitions
❌ Timeout > 5 seconds
```

---

## KNOWN TESTING LIMITATIONS

### Cannot Test Without

1. **Valid JWT Token**
   - Requires Supabase project access
   - Test user must exist in database
   - Token must not be expired

2. **Email Confirmation** (Export/Deletion)
   - Manual step: click email link
   - Cannot automate without email integration testing

3. **Live LLM Responses**
   - Requires valid API keys
   - Actual Gemini/OpenAI quota consumption
   - May have rate limits

### Workarounds

```bash
# Option 1: Create test user in Supabase
supabase auth create-user \
  --email test@atenna.dev \
  --password TestPassword123

# Option 2: Get JWT from test user login
# (Requires client-side auth flow or Supabase admin API)

# Option 3: Mock email confirmations
# POST directly to confirmation endpoints (not possible — requires token)
```

---

## AUTOMATED TEST SUITE

Currently implemented (24 passing E2E tests):

```
✅ tests/e2e/dlp-full-flow.spec.ts (22 tests)
  - CPF detection & rewrite
  - Email detection
  - API key detection
  - Multiple entities
  - CN J legal documents
  - User name detection
  - Export workflow
  - Deletion workflow

✅ tests/e2e/dlp-enforcement-validation.spec.ts (2 tests)
  - Strict mode ON/OFF behavior
  - Rewrite token accuracy
```

### How to Run

```bash
# Run all E2E tests
npx playwright test tests/e2e/

# Run specific test
npx playwright test tests/e2e/dlp-full-flow.spec.ts

# Run against production
npx playwright test --grep @production

# Generate report
npx playwright test --reporter=html
```

---

## MANUAL VALIDATION CHECKLIST

### Before Going Live

- [ ] Run `npm run test` — All 133 frontend tests pass
- [ ] Run `npm run build` — Zero TypeScript errors
- [ ] Run `npx playwright test` — All 24 E2E tests pass
- [ ] Run `profile_vps_document.py` — p95 < 8s, p99 < 10s
- [ ] Verify spacy models loaded: `docker exec atenna-backend python -m spacy info`
- [ ] Check Supabase connectivity: `curl https://[project].supabase.co/rest/v1/`
- [ ] Test JWT validation with invalid token → should get 401
- [ ] Test empty input → should get 422
- [ ] Monitor `/document/metrics` endpoint (should respond with observability data)
- [ ] Test export flow (complete email confirmation manually)
- [ ] Test deletion flow (verify grace period countdown)

### Monitoring During Rollout

```
Watch for:
❌ High 5xx error rate (should be near 0%)
❌ Timeout rate > 5% (should be < 1%)
❌ DLP false negatives (entities not detected)
❌ PII appearing in logs
❌ Supabase persistence failures
❌ LLM API failures (all 3 cascade providers down)
```

---

## NEXT STEPS (TASK 6)

Once all validations pass:

1. **Update CHANGELOG.md**
   - Document all v2.23.0 features
   - Note fixes from TASK 1-5

2. **Update ROADMAP.md**
   - Mark completed phases
   - Update timeline for FASE 5-7

3. **Update SPECS.md**
   - Endpoint documentation
   - Request/response examples
   - Error codes

4. **Generate Final Audit** (TASK 7)
   - Security review summary
   - Performance benchmarks
   - Compliance checklist

---

## APPENDIX: Example JWT

(For testing purposes only — expired)

```
eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.
eyJzdWIiOiJ1c2VyLWZvcmVuc2ljLXRlc3QiLCJpc3MiOiJzdXBhYmFzZSIsImF1ZCI6ImF1dGhlbnRpY2F0ZWQtdXNlcnMiLCJpYXQiOjE3MTUwMDAwMDB9.
fake_signature
```

### To Generate Valid JWT

```bash
# Using Supabase CLI
supabase gen token user $USER_ID --exp 3600

# Or via Supabase dashboard:
# Settings → API Docs → Auth tokens → Create token for user
```

---

## CONCLUSION

**TASK 5 Status:** Documentation complete, testing requires valid JWT.  
**Next Action:** Obtain valid JWT token and run validation scripts.  
**Expected Duration:** ~2 hours (with email manual confirmations).  

