# FEATURE FLAGS — Canonical State

**Last Updated:** 2026-05-13  
**Authority:** Runtime environment variables on VPS 157.90.246.156

---

## ACTIVE FLAGS (Currently Enabled)

### 1. STRICT_DLP_MODE

| Property | Value |
|----------|-------|
| **Current State** | `false` (observation mode) |
| **Location** | Backend environment variable |
| **Behavior (false)** | Logs "dlp_strict_would_apply=true" but does NOT rewrite |
| **Behavior (true)** | Automatically rewrites HIGH-risk PII before sending to LLM |
| **When to Enable** | After rigorous testing, for high-security deployments |
| **Revert Strategy** | Set `STRICT_DLP_MODE=false` and restart container |
| **Scope** | Affects /generate-prompts endpoint only |

**Example:**

```
Input:  "Please help me fix code. CPF 123.456.789-10"

STRICT_DLP_MODE=false:
  → Log: {"event": "dlp_strict_would_apply", "risk": "HIGH"}
  → LLM receives: "Please help me fix code. CPF 123.456.789-10" (UNCHANGED)
  
STRICT_DLP_MODE=true:
  → Log: {"event": "dlp_strict_applied", "entities": 1}
  → LLM receives: "Please help me fix code. CPF [CPF]" (REWRITTEN)
```

---

## DORMANT FLAGS (Not Yet Used)

### 2. DOCUMENT_UPLOAD_ENABLED

| Property | Value |
|----------|-------|
| **Current State** | Not used |
| **Planned For** | File upload and processing (FASE 5) |
| **Dependencies** | /document/upload endpoint, PDF/DOCX parsing |
| **Status** | Infrastructure ready, feature not exposed |

### 3. MULTIMODAL_ENABLED

| Property | Value |
|----------|-------|
| **Current State** | Not used |
| **Planned For** | Image + text input processing |
| **Dependencies** | Vision API, OCR engine |
| **Status** | Not implemented |

### 4. OCR_ENABLED

| Property | Value |
|----------|-------|
| **Current State** | Not used |
| **Planned For** | Extract text from images |
| **Dependencies** | Tesseract or Google Vision API |
| **Status** | Not implemented |

### 5. VISION_API_ENABLED

| Property | Value |
|----------|-------|
| **Current State** | Not used |
| **Planned For** | Process images with vision model |
| **Dependencies** | OpenAI Vision API or Google Vision API |
| **Status** | Not implemented |

---

## ENVIRONMENT CONFIGURATION (VPS)

### Set at Container Start

```bash
# Current VPS environment variables
STRICT_DLP_MODE=false
SUPABASE_URL=<redacted>
SUPABASE_SERVICE_ROLE_KEY=<redacted>
SUPABASE_ANON_KEY=<redacted>
GEMINI_API_KEY=<redacted>
OPENAI_API_KEY=<redacted>
```

### How to Change

```bash
# SSH into VPS
ssh -i key.pem root@157.90.246.156

# Edit docker-compose or environment file
# (if using docker-compose)
vim docker-compose.yml
# OR edit .env file
vim /app/.env

# Restart container
docker restart atenna-backend

# Verify new state
curl http://localhost:8000/health
docker logs atenna-backend --tail 20
```

---

## RUNTIME BEHAVIOR BY FLAG STATE

### DLP Pipeline Decision Tree

```
Request arrives at /generate-prompts
  ├─ Extract JWT user
  ├─ Validate DLP metadata from client
  │
  ├─ STRICT_DLP_MODE = false (CURRENT)
  │ ├─ Server revalidates risk (engine.revalidate)
  │ ├─ If mismatch detected: log divergence event
  │ ├─ Create enforcement metadata (server risk)
  │ ├─ Call evaluate_strict_enforcement()
  │ │  ├─ would_apply = true (if HIGH)
  │ │  ├─ applied = false (mode is OFF)
  │ │  └─ rewritten_text = original (unchanged)
  │ ├─ Log: dlp_strict_would_apply (observational)
  │ └─ Send ORIGINAL input to Gemini
  │
  └─ STRICT_DLP_MODE = true (FUTURE)
    ├─ Server revalidates risk (engine.revalidate)
    ├─ Create enforcement metadata (server risk)
    ├─ Call evaluate_strict_enforcement()
    │  ├─ would_apply = true (if HIGH)
    │  ├─ applied = true (mode is ON)
    │  ├─ rewritten_text = "CPF [CPF]" (rewritten)
    │  └─ Log: dlp_strict_applied
    └─ Send REWRITTEN input to Gemini
```

---

## CLIENT-SIDE FLAGS (Chrome Extension)

### No Client-Side Feature Flags Currently

The extension does NOT have runtime-configurable flags. All behavior is baked into:
- `src/core/auth.ts` — authentication logic
- `src/core/dlp.ts` — local DLP scanning
- `src/ui/modal.ts` — UI rendering
- Configuration objects in `src/config/`

**To enable new features on client:**
1. Modify source code
2. Rebuild extension: `npm run build`
3. Update manifest version
4. Re-deploy to users

---

## TELEMETRY FLAGS (Implicit)

### What's Always Logged

Regardless of flag state, these events are ALWAYS logged:

| Event | Payload |
|-------|---------|
| `dlp_prompt_received` | risk_level, entity_count, entity_types, session_id |
| `dlp_client_server_divergence` | divergence_type, client_risk, server_risk, confidence |
| `dlp_strict_evaluated` | risk_level, would_apply, applied, session_id |
| `dlp_strict_applied` (if mode=true) | entity_count, entity_types, original_length, rewritten_length |
| `dlp_strict_would_apply` (if mode=false) | risk_level, entity_types |

**Note:** These logs contain NO PII — only metadata and hashes.

---

## SWITCHING MODES

### Scenario: Enable STRICT_DLP_MODE for High-Security Client

**Steps:**

1. **Pre-flight Checks**
   ```bash
   # Verify test suite passes
   cd backend
   python -m pytest tests/ -v
   
   # Run VPS profiler with current settings
   python scripts/profile_vps_document.py \
     --token $JWT \
     --url https://atennaplugin.maestro-n8n.site \
     --rounds 20 \
     --concurrent 3
   ```

2. **Enable Flag**
   ```bash
   # SSH to VPS
   ssh -i key.pem root@157.90.246.156
   
   # Update environment
   echo "STRICT_DLP_MODE=true" >> /app/.env
   
   # Restart container
   docker restart atenna-backend
   ```

3. **Verify Behavior**
   ```bash
   # Test with HIGH-risk input
   curl -X POST https://atennaplugin.maestro-n8n.site/generate-prompts \
     -H "Authorization: Bearer $JWT" \
     -H "Content-Type: application/json" \
     -d '{
       "input": "CPF 123.456.789-10",
       "dlp": {"dlp_risk_level": "HIGH", "dlp_entity_types": ["BR_CPF"]}
     }'
   
   # Should return rewritten input: "CPF [CPF]"
   ```

4. **Monitor Logs**
   ```bash
   docker logs -f atenna-backend | grep -E "dlp_strict_applied|dlp_client_server"
   ```

5. **Rollback (if needed)**
   ```bash
   echo "STRICT_DLP_MODE=false" > /app/.env
   docker restart atenna-backend
   ```

---

## FEATURE FLAG ROADMAP

### Phase 1 (Current — DONE)
- ✅ STRICT_DLP_MODE (dormant, mode=false)
- ✅ Basic DLP pipeline
- ✅ JWT authentication
- ✅ Telemetry persistence

### Phase 2 (FASE 5 — Planned)
- 🔄 DOCUMENT_UPLOAD_ENABLED
  - PDF/DOCX parsing
  - Document DLP scanning
  - /document/upload endpoint

### Phase 3 (FASE 6 — Planned)
- 🔄 OCR_ENABLED
  - Tesseract or Google Vision integration
  - Text extraction from images
  - Image DLP scanning

### Phase 4 (FASE 7 — Planned)
- 🔄 MULTIMODAL_ENABLED
  - Vision API integration
  - Image + text processing
  - Unified prompt generation

---

## TECHNICAL NOTES

### Why STRICT_DLP_MODE is OFF by Default

1. **User Experience:** Rewriting changes user input, may surprise users
2. **Testing:** Needs extensive validation before enabling  
3. **Compliance:** Some regulations prefer human review over automatic rewrite
4. **Audit Trail:** Observation mode allows tracking what WOULD be rewritten

### Why No Client-Side Flags

1. **Security:** Flags in Chrome storage are user-editable
2. **Consistency:** Server is source of truth for policy
3. **Compliance:** Audit trail must reflect actual enforcement
4. **Simplicity:** No client-side feature flag management needed

### Future Enhancement: Server-Driven Config

```
Extension →  GET /extension/config
             ← { strict_mode: false, feature_set: "free" }

Extension uses this to show/hide UI elements
But: Actual enforcement still happens on backend
```

---

## Testing Feature Flags

### Unit Tests

```python
# backend/dlp/test_enforcement.py
def test_strict_mode_disabled_observes_only():
    """STRICT_DLP_MODE=false → logs but doesn't rewrite"""
    os.environ["STRICT_DLP_MODE"] = "false"
    result = evaluate_strict_enforcement("CPF 123.456.789-10", {"dlp_risk_level": "HIGH"})
    assert result["would_apply"] == True
    assert result["applied"] == False
    assert result["rewritten_text"] == "CPF 123.456.789-10"

def test_strict_mode_enabled_rewrites():
    """STRICT_DLP_MODE=true → rewrites HIGH risk"""
    os.environ["STRICT_DLP_MODE"] = "true"
    result = evaluate_strict_enforcement("CPF 123.456.789-10", {"dlp_risk_level": "HIGH"})
    assert result["would_apply"] == True
    assert result["applied"] == True
    assert result["rewritten_text"] == "CPF [CPF]"
```

### E2E Tests

```typescript
// tests/e2e/feature-flags.spec.ts
test("STRICT_DLP_MODE=false: input sent unchanged to LLM", async ({ page }) => {
  // Verify: original text reaches backend unchanged
  // Check logs: dlp_strict_would_apply
  // Verify: no [CPF] tokens in output
});

test("STRICT_DLP_MODE=true: HIGH-risk text is rewritten", async ({ page }) => {
  // Requires manual VPS setup with flag enabled
  // Verify: [CPF] tokens in backend logs
  // Verify: no raw CPF in generated prompts
});
```

---

## Conclusion

**Current State:** STRICT_DLP_MODE is disabled (observation-only).  
**Production Ready:** Yes — safe defaults with audit trail.  
**Next Step:** Enable STRICT_DLP_MODE only after Phase 2 testing completed.

