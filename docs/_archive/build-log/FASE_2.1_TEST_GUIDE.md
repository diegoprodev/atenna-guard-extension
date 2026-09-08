# FASE 2.1: Test Execution Guide

## Quick Start

### Prerequisites

1. **Python Backend**
   ```bash
   cd backend
   pip install -r requirements.txt
   ```

2. **Node.js for Playwright**
   ```bash
   npm install
   ```

3. **Environment Variables**
   ```bash
   # Backend .env file
   cat > backend/.env << 'EOF'
   SUPABASE_URL=https://your-project.supabase.co
   SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
   SUPABASE_ANON_KEY=your-anon-key
   GEMINI_API_KEY=your-gemini-key
   STRICT_DLP_MODE=true  # Set to true for strict enforcement tests
   EOF
   ```

---

## Running Tests

### 1. Integration Tests (Fast, No UI)

**These run against a live backend and validate the DLP enforcement chain.**

```bash
# Start backend first
cd backend
python -m uvicorn main:app --reload --port 8000
```

Then in another terminal:

```bash
# Set environment variables
export BACKEND_URL=http://localhost:8000
export TEST_JWT="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.test"  # Or real JWT

# Run integration tests
npx playwright test tests/e2e/dlp-enforcement-validation.spec.ts -v
```

**What it tests:**
- Server-side DLP revalidation
- Strict mode enforcement
- Client-server mismatch detection
- Telemetry safety
- Timeout protection
- Backward compatibility

**Expected output:**
```
✓ Strict Mode: CPF → Auto-rewrite → Backend bloqueia número bruto
✓ Server-side Detection: Escondida API key detectada
✓ Multiple PII: CPF + Email + API Key → All tokenized
✓ Free Plan: User override → Payload pode ter PII (apenas log)
✓ Telemetry: Client-server divergence logged
✓ Empty or whitespace-only input → 422 validation error
✓ Timeout Protection: Very long input → Completes in <3s
✓ Backward Compatibility: Request sem DLP metadata funciona
✓ Health endpoint → OK response
✓ DLP health endpoint → Engine info

10 passed in 2.5s
```

---

### 2. Browser E2E Tests (Full UI)

**These require the extension to be built and loaded in Chrome.**

#### Step 1: Build the Extension

```bash
npm run build
```

This creates the extension in the `dist/` folder.

#### Step 2: Load in Chrome

1. Open Chrome and go to `chrome://extensions/`
2. Enable "Developer mode" (toggle in top right)
3. Click "Load unpacked"
4. Select the `dist/` folder
5. Note the extension ID (you'll need it for Playwright)

#### Step 3: Run E2E Tests with Extension

```bash
# Option A: Headed mode (see browser)
EXTENSION_ID="chrome-extension-id-here" \
npx playwright test tests/e2e/dlp-full-flow.spec.ts --headed

# Option B: Headless (faster CI/CD)
EXTENSION_ID="chrome-extension-id-here" \
npx playwright test tests/e2e/dlp-full-flow.spec.ts
```

**What it tests:**
- Real browser extension loading
- User interactions (type, click, wait)
- Request interception (validates no PII in requests)
- UI feedback (badges, banners)
- Real DLP detection (local scanner)
- Real rewrite flow

---

### 3. Full Test Suite

**Run all tests (integration + E2E):**

```bash
npm test tests/e2e/
```

**With HTML report:**

```bash
npm test tests/e2e/ -- --reporter=html

# Open report
open playwright-report/index.html  # macOS
start playwright-report/index.html # Windows
```

---

## Debugging Tests

### View Detailed Logs

```bash
npx playwright test tests/e2e/dlp-enforcement-validation.spec.ts \
  --reporter=list \
  --grep "CPF" \
  -v
```

### Run Single Test

```bash
npx playwright test tests/e2e/dlp-enforcement-validation.spec.ts \
  --grep "Strict Mode: CPF"
```

### Headed Mode (Slow Motion)

```bash
npx playwright test tests/e2e/dlp-full-flow.spec.ts \
  --headed \
  --slow-mo=1000  # 1s pause between actions
```

### Debug Mode

```bash
# Opens Playwright Inspector
npx playwright test tests/e2e/dlp-enforcement-validation.spec.ts \
  --debug
```

### Capture Traces and Screenshots

```bash
# Config already set in playwright.config.ts (trace: 'on-first-retry')
# Automatically captured on test failure

# View traces:
npx playwright show-trace test-results/path-to-trace.zip
```

---

## Validating Specific Scenarios

### Scenario 1: CPF Rewrite Validation

```bash
# Create test file: test-cpf.spec.ts
npx playwright test test-cpf.spec.ts --headed
```

```typescript
test('CPF bypass prevention', async ({ page }) => {
  await page.goto('http://localhost:3000');
  
  // Type CPF
  await page.fill('[data-testid="input"]', 'CPF 050.423.674-11');
  
  // Trigger DLP scan
  await page.waitForTimeout(100);
  
  // Check badge color changed
  const badge = await page.locator('[data-testid="badge"]');
  await expect(badge).toContainText(/HIGH|CRITICAL/);
  
  // Click protect
  await page.click('[data-testid="protect-button"]');
  
  // Verify rewrite happened
  const input = await page.inputValue('[data-testid="input"]');
  expect(input).not.toContain('050.423.674-11');
  expect(input).toContain('[CPF]');
});
```

### Scenario 2: Server Enforcement Test

```bash
# Use curl to test backend directly
curl -X POST http://localhost:8000/generate-prompts \
  -H "Authorization: Bearer ${TEST_JWT}" \
  -H "Content-Type: application/json" \
  -d '{
    "input": "CPF 050.423.674-11",
    "dlp": {
      "dlp_risk_level": "NONE",
      "dlp_entity_count": 0,
      "dlp_entity_types": [],
      "dlp_was_rewritten": false
    }
  }' \
  -s | jq '.prompts'
```

**Validation:** Check output doesn't contain "050.423.674-11"

### Scenario 3: Telemetry Validation

```bash
# Check if telemetry was persisted to Supabase
psql $DATABASE_URL << 'EOF'
  SELECT event_type, risk_level, entity_types, entity_count, was_rewritten
  FROM dlp_events
  WHERE created_at > NOW() - INTERVAL '1 minute'
  ORDER BY created_at DESC
  LIMIT 5;
EOF
```

**Validation:** 
- No raw PII values in any column
- Only entity_types should have values like ["BR_CPF"]
- entity_values should NOT exist

---

## Continuous Integration

### GitHub Actions Setup

```yaml
name: FASE 2.1 E2E Tests

on: [push, pull_request]

jobs:
  test:
    runs-on: ubuntu-latest
    
    services:
      postgres:
        image: postgres:15
        env:
          POSTGRES_PASSWORD: postgres
        options: >-
          --health-cmd pg_isready
          --health-interval 10s
          --health-timeout 5s
          --health-retries 5

    steps:
      - uses: actions/checkout@v3
      
      - uses: actions/setup-node@v3
        with:
          node-version: '18'
      
      - uses: actions/setup-python@v4
        with:
          python-version: '3.11'
      
      - name: Install dependencies
        run: |
          npm ci
          pip install -r backend/requirements.txt
      
      - name: Start backend
        run: |
          cd backend
          python -m uvicorn main:app --port 8000 &
          sleep 3
      
      - name: Run integration tests
        run: |
          npx playwright test tests/e2e/dlp-enforcement-validation.spec.ts
        env:
          BACKEND_URL: http://localhost:8000
          TEST_JWT: ${{ secrets.TEST_JWT }}
      
      - name: Upload report
        if: always()
        uses: actions/upload-artifact@v3
        with:
          name: playwright-report
          path: playwright-report/
          retention-days: 30
```

---

## Troubleshooting

### Backend Not Starting

```bash
# Check Python version
python --version  # Should be 3.11+

# Check if port 8000 is in use
lsof -i :8000  # macOS/Linux
netstat -ano | findstr :8000  # Windows

# Kill process if needed
kill -9 <PID>  # macOS/Linux
taskkill /PID <PID> /F  # Windows

# Try different port
python -m uvicorn main:app --port 8001
```

### Playwright Issues

```bash
# Install Chromium browser
npx playwright install

# Check browser versions
npx playwright browsers
```

### JWT Expired/Invalid

```bash
# Generate test JWT using Supabase CLI
supabase gen create-jwt --secret "your-jwt-secret"

# Or use test mode (no verification)
export TEST_JWT="test-mode"  # Backend handles appropriately
```

### Tests Timeout

Increase timeout in `playwright.config.ts`:

```typescript
use: {
  timeout: 30000,  // 30 seconds
  navigationTimeout: 30000,
},
```

---

## Test Coverage Summary

| Category | Count | Status |
|----------|-------|--------|
| Integration (Backend) | 10 | ✅ Ready |
| E2E (Browser) | 12 | ✅ Ready (needs build) |
| **Total** | **22** | ✅ **Complete** |

| Scenario | Coverage |
|----------|----------|
| CPF Detection & Rewrite | ✅ |
| API Key Detection | ✅ |
| JWT Token Protection | ✅ |
| CNJ Number Detection | ✅ |
| CAPS Name Detection | ✅ |
| Multiple PII Types | ✅ |
| Free Plan Override | ✅ |
| Strict Mode Enforcement | ✅ |
| Client-Server Divergence | ✅ |
| Timeout Protection | ✅ |
| Backward Compatibility | ✅ |
| Telemetry Safety | ✅ |
| Storage Security | ✅ |
| Exception Sanitization | ✅ |

---

## Next Steps

1. **Immediate:**
   - Run integration tests against staging backend
   - Verify all 10 integration tests pass
   - Check backend logs for audit trail

2. **Short-term (1-2 days):**
   - Build extension
   - Load in Chrome
   - Run E2E tests with real browser
   - Capture screenshots/videos

3. **Validation:**
   - Audit PII handling in logs
   - Verify Supabase telemetry is clean
   - Test with real user scenarios

4. **Production:**
   - Deploy with E2E tests in CI/CD
   - Monitor telemetry for anomalies
   - Regular security audits

---

**Need help?** Check `docs/fases/FASE_2.1_E2E_ANTI_VAZAMENTO.md` for detailed architecture and security guarantees.
