# FASE 5.2 — PT-BR Enterprise Recognizers

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` to implement task-by-task.

**Goal:** Add RG, CNH, OAB, Placa Veicular, and CRM to the DLP engine — both frontend (`patterns.ts`) and backend (`analyzer.py`) — so Brazilian enterprise data leaks are detected in all document types, not just CPF/CNPJ.

**Architecture:** Frontend scanner (`src/dlp/patterns.ts`) gets new `PatternDef` entries. Backend Presidio-based analyzer (`backend/dlp/analyzer.py`) gets new `PatternRecognizer` instances. Both layers validate independently. `EntityType` union in `types.ts` is extended. Tests use the same real-world fixtures.

**Tech Stack:** TypeScript (frontend DLP), Python 3.10 + presidio-analyzer (backend DLP)

---

## GAP ANALYSIS (current vs required)

| Recognizer | Frontend | Backend | Priority |
|-----------|----------|---------|----------|
| RG (Registro Geral) | ❌ missing | ❌ missing | P1 |
| CNH (Carteira Habilitação) | ❌ missing | ❌ missing | P1 |
| OAB (Ordem Advogados Brasil) | ❌ missing | ❌ missing | P1 |
| Placa Veicular | ❌ missing | ❌ missing | P1 |
| CRM (Conselho Regional Medicina) | ❌ missing | ❌ missing | P2 |
| CPF | ✅ | ✅ | — |
| CNPJ | ✅ | ✅ | — |

## SECURITY INVARIANTS

| # | Invariant | Harness ID |
|---|-----------|------------|
| SI-11 | RG detected in plain text and structured contexts | H-RG-1 |
| SI-12 | CNH detected in numeric and labeled contexts | H-CNH-1 |
| SI-13 | OAB detected with state suffix (OAB/SP 123456) | H-OAB-1 |
| SI-14 | Placa detected in Mercosul (ABC1D23) and old format (ABC-1234) | H-PLACA-1 |
| SI-15 | Backend returns same entity types as frontend for same input | H-PARITY-1 |

---

## FILE MAP

| Path | Change |
|------|--------|
| `src/dlp/types.ts` | Add `'RG' \| 'CNH' \| 'OAB' \| 'PLACA' \| 'CRM'` to `EntityType` |
| `src/dlp/patterns.ts` | Add `PatternDef` entries + validators for each new type |
| `src/dlp/dlp.test.ts` | Add test cases for each new recognizer |
| `backend/dlp/analyzer.py` | Add `PatternRecognizer` instances for each new type |
| `backend/tests/test_ptbr_recognizers.py` | New: 15+ test cases |

---

## TASK 1 — Extend EntityType

**Files:**
- Modify: `src/dlp/types.ts`

- [ ] **Step 1: Update EntityType union**

```typescript
// src/dlp/types.ts — change line 3-7
export type EntityType =
  | 'CPF' | 'CNPJ' | 'EMAIL' | 'PHONE'
  | 'API_KEY' | 'TOKEN' | 'PASSWORD' | 'CREDIT_CARD'
  | 'ADDRESS' | 'MEDICAL' | 'LEGAL' | 'GENERIC_PII'
  | 'PROCESS_NUM' | 'NAME'
  | 'RG' | 'CNH' | 'OAB' | 'PLACA' | 'CRM';
```

- [ ] **Step 2: Build to verify no TS errors**

Run: `npm run build`
Expected: 0 errors

- [ ] **Step 3: Commit**

```bash
git add src/dlp/types.ts
git commit -m "feat(FASE 5.2): extend EntityType with RG, CNH, OAB, PLACA, CRM"
```

---

## TASK 2 — Frontend Recognizers (patterns.ts)

**Files:**
- Modify: `src/dlp/patterns.ts`
- Modify: `src/dlp/dlp.test.ts`

### Format Reference

| Type | Formats | Examples |
|------|---------|---------|
| RG | 7-9 digits, optional separator XX.XXX.XXX-X | `12.345.678-9`, `123456789`, `RG: 1.234.567` |
| CNH | 11 digits, labeled "CNH" or "Habilitação" or standalone | `01234567890`, `CNH: 012 345 678 90` |
| OAB | State/SP + number: OAB/UF NNNNN or OAB/UF NNNNNN | `OAB/SP 123456`, `OAB-RJ 98765` |
| Placa | Mercosul ABC1D23 or old ABC-1234 | `ABC1D23`, `ABC-1234`, `BRA2E56` |
| CRM | State + number: CRM/SP 123456 | `CRM/SP 123456`, `CRM-RS 98765` |

- [ ] **Step 1: Write failing tests in dlp.test.ts**

Add to `src/dlp/dlp.test.ts` in the `scanPatterns` suite:

```typescript
import { scanPatterns } from './patterns';

describe('PT-BR Enterprise Recognizers', () => {
  describe('RG', () => {
    test('detects formatted RG', () => {
      const r = scanPatterns('RG: 12.345.678-9');
      expect(r.some(e => e.type === 'RG')).toBe(true);
    });
    test('detects bare RG digits', () => {
      const r = scanPatterns('Documento: 123456789');
      expect(r.some(e => e.type === 'RG')).toBe(true);
    });
    test('does not detect 6-digit number as RG', () => {
      const r = scanPatterns('código: 123456');
      expect(r.some(e => e.type === 'RG')).toBe(false);
    });
  });

  describe('CNH', () => {
    test('detects labeled CNH', () => {
      const r = scanPatterns('CNH: 01234567890');
      expect(r.some(e => e.type === 'CNH')).toBe(true);
    });
    test('detects CNH with spaces', () => {
      const r = scanPatterns('habilitação 012 345 678 90');
      expect(r.some(e => e.type === 'CNH')).toBe(true);
    });
  });

  describe('OAB', () => {
    test('detects OAB/SP format', () => {
      const r = scanPatterns('advogado inscrito na OAB/SP 123456');
      expect(r.some(e => e.type === 'OAB')).toBe(true);
    });
    test('detects OAB-RJ format', () => {
      const r = scanPatterns('OAB-RJ 98765');
      expect(r.some(e => e.type === 'OAB')).toBe(true);
    });
    test('does not detect standalone OAB', () => {
      const r = scanPatterns('OAB é uma autarquia');
      expect(r.some(e => e.type === 'OAB')).toBe(false);
    });
  });

  describe('Placa Veicular', () => {
    test('detects Mercosul plate', () => {
      const r = scanPatterns('placa do veículo: ABC1D23');
      expect(r.some(e => e.type === 'PLACA')).toBe(true);
    });
    test('detects old format plate', () => {
      const r = scanPatterns('veículo ABC-1234 envolvido');
      expect(r.some(e => e.type === 'PLACA')).toBe(true);
    });
    test('does not detect random 7-char strings', () => {
      const r = scanPatterns('código ABCDEFG');
      expect(r.some(e => e.type === 'PLACA')).toBe(false);
    });
  });

  describe('CRM', () => {
    test('detects CRM/SP format', () => {
      const r = scanPatterns('Dr. Oliveira, CRM/SP 123456');
      expect(r.some(e => e.type === 'CRM')).toBe(true);
    });
  });
});
```

- [ ] **Step 2: Run → FAIL**

Run: `npx vitest run src/dlp/dlp.test.ts`
Expected: FAIL — "RG is not a valid EntityType" or assertion failures

- [ ] **Step 3: Add validators and patterns to patterns.ts**

Add validators after existing `luhn` function (before `NAME_STOPWORDS`):

```typescript
// ── RG validator ──────────────────────────────────────────────
// RG: 7-9 digits. Must not match a CPF (11 digits) or CNPJ (14).
function validateRG(raw: string): boolean {
  const d = raw.replace(/\D/g, '');
  return d.length >= 7 && d.length <= 9 && !/^(\d)\1+$/.test(d);
}

// ── CNH validator ─────────────────────────────────────────────
// CNH: exactly 11 digits (like CPF but issued by DETRAN, different check)
function validateCNH(raw: string): boolean {
  const d = raw.replace(/\D/g, '');
  return d.length === 11 && !/^(\d)\1{10}$/.test(d);
}
```

Add pattern entries to the `PATTERNS` array (insert after CREDIT_CARD, before CEP):

```typescript
  // RG — requires "RG" label or XX.XXX.XXX-X format to avoid false positives
  {
    type: 'RG' as EntityType,
    pattern: /\b(?:RG|R\.G\.|Rg)[:\s.]*\d{1,2}[.\s]?\d{3}[.\s]?\d{3}[-\s]?\d?\b|\b\d{2}\.\d{3}\.\d{3}-\d\b/gi,
    confidence: 0.88,
    validate: (raw: string) => validateRG(raw),
  },
  // CNH — requires "CNH" / "habilitação" label OR exact 11 digits in CNH context
  {
    type: 'CNH' as EntityType,
    pattern: /\b(?:CNH|C\.N\.H\.|habilitação|habilitacao)[:\s.]*\d[\d\s]{9,12}\d\b/gi,
    confidence: 0.90,
    validate: (raw: string) => validateCNH(raw),
  },
  // OAB — must include state code: OAB/SP 123456 or OAB-RJ 98765
  {
    type: 'OAB' as EntityType,
    pattern: /\bOAB[/\-\s][A-Z]{2}\s*\d{4,6}\b/gi,
    confidence: 0.95,
  },
  // Placa Veicular — Mercosul (ABC1D23) or old (ABC-1234)
  {
    type: 'PLACA' as EntityType,
    pattern: /\b[A-Z]{3}\d[A-Z0-9]\d{2}\b|\b[A-Z]{3}-?\d{4}\b/g,
    confidence: 0.85,
    validate: (raw: string) => {
      const s = raw.replace(/[^A-Z0-9]/gi, '').toUpperCase();
      // Mercosul: 3 letters + digit + letter + 2 digits = 7 chars
      if (s.length === 7) return /^[A-Z]{3}\d[A-Z]\d{2}$/.test(s);
      // Old: 3 letters + 4 digits = 7 chars
      return /^[A-Z]{3}\d{4}$/.test(s);
    },
  },
  // CRM — must include state code: CRM/SP 123456 or CRM-RS 98765
  {
    type: 'CRM' as EntityType,
    pattern: /\bCRM[/\-\s][A-Z]{2}\s*\d{4,6}\b/gi,
    confidence: 0.95,
  },
```

- [ ] **Step 4: Run → PASS**

Run: `npx vitest run src/dlp/dlp.test.ts`
Expected: All new tests PASS. Existing tests still PASS.

- [ ] **Step 5: Build**

Run: `npm run build`
Expected: 0 errors

- [ ] **Step 6: Commit**

```bash
git add src/dlp/patterns.ts src/dlp/dlp.test.ts
git commit -m "feat(FASE 5.2): frontend recognizers — RG, CNH, OAB, PLACA, CRM with validators"
```

---

## TASK 3 — Backend Recognizers (analyzer.py)

**Files:**
- Modify: `backend/dlp/analyzer.py`
- Create: `backend/tests/test_ptbr_recognizers.py`

- [ ] **Step 1: Read current analyzer.py**

Read `backend/dlp/analyzer.py` fully to understand current pattern structure before making changes.

- [ ] **Step 2: Write failing tests**

```python
# backend/tests/test_ptbr_recognizers.py
import pytest
from backend.dlp.analyzer import analyze_text

def test_rg_labeled():
    r = analyze_text("RG: 12.345.678-9")
    types = [e["entity_type"] for e in r["entities"]]
    assert "RG" in types

def test_rg_formatted():
    r = analyze_text("documento 12.345.678-9 apresentado")
    types = [e["entity_type"] for e in r["entities"]]
    assert "RG" in types

def test_cnh_labeled():
    r = analyze_text("CNH: 01234567890")
    types = [e["entity_type"] for e in r["entities"]]
    assert "CNH" in types

def test_oab_sp():
    r = analyze_text("inscrito na OAB/SP 123456")
    types = [e["entity_type"] for e in r["entities"]]
    assert "OAB" in types

def test_oab_rj():
    r = analyze_text("OAB-RJ 98765")
    types = [e["entity_type"] for e in r["entities"]]
    assert "OAB" in types

def test_placa_mercosul():
    r = analyze_text("veículo ABC1D23 foi autuado")
    types = [e["entity_type"] for e in r["entities"]]
    assert "PLACA" in types

def test_placa_old():
    r = analyze_text("placa ABC-1234")
    types = [e["entity_type"] for e in r["entities"]]
    assert "PLACA" in types

def test_crm():
    r = analyze_text("Dr. Silva CRM/SP 123456")
    types = [e["entity_type"] for e in r["entities"]]
    assert "CRM" in types

def test_cpf_still_works():
    r = analyze_text("CPF 123.456.789-09")
    types = [e["entity_type"] for e in r["entities"]]
    assert "CPF" in types

def test_cnpj_still_works():
    r = analyze_text("CNPJ 11.222.333/0001-81")
    types = [e["entity_type"] for e in r["entities"]]
    assert "CNPJ" in types
```

- [ ] **Step 3: Run → FAIL**

```bash
cd backend && python -m pytest tests/test_ptbr_recognizers.py -v
```
Expected: FAIL — `RG`, `CNH`, `OAB`, `PLACA`, `CRM` not in response entities

- [ ] **Step 4: Implement backend recognizers**

Read `backend/dlp/analyzer.py` first, then add after the existing recognizers. Pattern to follow (matches Presidio PatternRecognizer API):

```python
from presidio_analyzer import PatternRecognizer, Pattern

# RG Recognizer
rg_recognizer = PatternRecognizer(
    supported_entity="RG",
    name="BrazilianRGRecognizer",
    patterns=[
        Pattern("RG_LABELED", r"\b(?:RG|R\.G\.)[:\s.]*\d{1,2}[.\s]?\d{3}[.\s]?\d{3}[-\s]?\d?\b", 0.88),
        Pattern("RG_FORMATTED", r"\b\d{2}\.\d{3}\.\d{3}-\d\b", 0.85),
    ],
    context=["rg", "identidade", "registro geral"],
)

# CNH Recognizer
cnh_recognizer = PatternRecognizer(
    supported_entity="CNH",
    name="BrazilianCNHRecognizer",
    patterns=[
        Pattern("CNH_LABELED", r"\b(?:CNH|C\.N\.H\.|habilitação|habilitacao)[:\s.]*\d[\d\s]{9,12}\d\b", 0.90),
    ],
    context=["cnh", "habilitação", "carteira", "motorista"],
)

# OAB Recognizer
oab_recognizer = PatternRecognizer(
    supported_entity="OAB",
    name="BrazilianOABRecognizer",
    patterns=[
        Pattern("OAB_STATE", r"\bOAB[/\-\s][A-Z]{2}\s*\d{4,6}\b", 0.95),
    ],
    context=["oab", "advogado", "advogada", "ordem"],
)

# Placa Veicular Recognizer
placa_recognizer = PatternRecognizer(
    supported_entity="PLACA",
    name="BrazilianPlacaRecognizer",
    patterns=[
        Pattern("PLACA_MERCOSUL", r"\b[A-Z]{3}\d[A-Z]\d{2}\b", 0.85),
        Pattern("PLACA_OLD", r"\b[A-Z]{3}-?\d{4}\b", 0.82),
    ],
    context=["placa", "veículo", "veiculo", "carro", "moto", "automóvel"],
)

# CRM Recognizer
crm_recognizer = PatternRecognizer(
    supported_entity="CRM",
    name="BrazilianCRMRecognizer",
    patterns=[
        Pattern("CRM_STATE", r"\bCRM[/\-\s][A-Z]{2}\s*\d{4,6}\b", 0.95),
    ],
    context=["crm", "médico", "medico", "doutor", "dr", "dra"],
)

# Register all new recognizers with the analyzer registry
for rec in [rg_recognizer, cnh_recognizer, oab_recognizer, placa_recognizer, crm_recognizer]:
    analyzer.registry.add_recognizer(rec)
```

- [ ] **Step 5: Run → PASS**

```bash
cd backend && python -m pytest tests/test_ptbr_recognizers.py -v
```
Expected: 10/10 PASS

- [ ] **Step 6: Full backend suite still passes**

```bash
cd backend && python -m pytest -v
```
Expected: no regressions

- [ ] **Step 7: Commit**

```bash
git add backend/dlp/analyzer.py backend/tests/test_ptbr_recognizers.py
git commit -m "feat(FASE 5.2): backend PT-BR recognizers — RG, CNH, OAB, PLACA, CRM"
```

---

## TASK 4 — Harness Verification + Deploy

- [ ] **Step 1: Full frontend suite**

```bash
npx vitest run
```
Expected: ≥ previous passing count (125). No regressions. New PT-BR tests GREEN.

- [ ] **Step 2: Full backend suite**

```bash
cd backend && python -m pytest -v
```
Expected: 10 new PT-BR tests PASS.

- [ ] **Step 3: Manual smoke — frontend**

Open browser devtools, paste into extension content script console:

```javascript
// Quick smoke from console (or load extension on a test page)
const { scanPatterns } = await import(chrome.runtime.getURL('src/dlp/patterns.js'));
console.log(scanPatterns('RG: 12.345.678-9 e placa ABC1D23'));
// Expected: [{type:"RG",...},{type:"PLACA",...}]
```

- [ ] **Step 4: Verify H-PARITY-1 (frontend ≈ backend for same input)**

Input: `"RG: 12.345.678-9, CNH: 01234567890, OAB/SP 123456, placa ABC1D23, CRM/SP 654321"`

Both frontend and backend must return at least: `['RG', 'CNH', 'OAB', 'PLACA', 'CRM']`

- [ ] **Step 5: Update SPEC_INDEX.md**

Mark 5.2 as ✅ Completo.

- [ ] **Step 6: Update CHANGELOG.md**

```markdown
### Added (FASE 5.2)
- PT-BR Enterprise Recognizers: RG, CNH, OAB, Placa Veicular, CRM
- Frontend: new PatternDef entries with validators in `src/dlp/patterns.ts`
- Backend: Presidio PatternRecognizer instances in `backend/dlp/analyzer.py`
- 10 new backend tests + 12 new frontend tests, all GREEN
- EntityType extended: `'RG' | 'CNH' | 'OAB' | 'PLACA' | 'CRM'`
```

- [ ] **Step 7: Build + commit + push**

```bash
npm run build
git add CHANGELOG.md docs/specs/SPEC_INDEX.md
git commit -m "chore(FASE 5.2): PT-BR enterprise recognizers complete — harness GREEN"
git push
```

- [ ] **Step 8: Deploy to VPS**

```bash
scp -i C:/Users/dgapc/.ssh/ATENNAPLUGIN-DEPLOY backend/dlp/analyzer.py root@157.90.246.156:/opt/atenna/backend/dlp/analyzer.py
ssh -i C:/Users/dgapc/.ssh/ATENNAPLUGIN-DEPLOY root@157.90.246.156 "cd /opt/atenna && docker compose restart atenna-backend"
```

---

## HARNESS SUMMARY

| ID | Test | Passes When |
|----|------|-------------|
| H-RG-1 | `scanPatterns("RG: 12.345.678-9")` returns entity type `RG` | Both frontend + backend |
| H-CNH-1 | `scanPatterns("CNH: 01234567890")` returns entity type `CNH` | Both layers |
| H-OAB-1 | `scanPatterns("OAB/SP 123456")` returns entity type `OAB` | Both layers |
| H-PLACA-1 | Mercosul `ABC1D23` and old `ABC-1234` both detected as `PLACA` | Both layers |
| H-PARITY-1 | Same 5-entity input → same 5 types on frontend and backend | Manual smoke |

## DEFINITION OF DONE

- [ ] `npm run build` GREEN
- [ ] `npx vitest run` — PT-BR suite all PASS, no regressions vs baseline
- [ ] `cd backend && python -m pytest` — 10 new tests PASS
- [ ] H-PARITY-1 verified manually
- [ ] VPS running updated backend
- [ ] CHANGELOG and SPEC_INDEX updated
