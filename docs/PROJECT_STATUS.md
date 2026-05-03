# Atenna Guard Extension — Project Status

**Date:** 2026-05-03  
**Version:** 1.0.0  
**Repo:** https://github.com/diegoprodev/atenna-guard-extension  
**Branch:** `main` — up to date with remote

---

## What this project is

A Chrome Extension (Manifest V3) that injects an **"Atenna Guard Prompt"** button at the top-right of the input field in ChatGPT, Claude, and Gemini. Clicking the button toggles a minimal side panel showing extension status and the detected platform name.

**Non-goals:** no auth, no API calls, no prompt reading/modification, no data collection, no React.

---

## Tech Stack

| Tool | Version | Role |
|---|---|---|
| TypeScript | ^5.4.5 | Language |
| Vite | ^5.3.1 | Build (dual config) |
| Vitest + jsdom | ^2.0.5 | Unit tests |
| vite-plugin-static-copy | ^1.0.6 | Copy manifest + icons to dist |
| pngjs | ^7.0.0 | Icon generation script |
| Chrome MV3 | — | Extension target |

---

## Current State: COMPLETE ✓

All 13 tasks from the implementation plan are done.

### Files delivered

```
src/
  content/
    detectInput.ts        ← platform detection (hostname → config)
    detectInput.test.ts   ← 5 tests ✓
    injectButton.ts       ← DOM injection with idempotency guard
    injectButton.test.ts  ← 9 tests ✓
    content.ts            ← entry point, MutationObserver
  background/
    background.ts         ← MV3 service worker (onInstalled)
  ui/
    panel.ts              ← toggle panel, XSS-safe
    panel.test.ts         ← 7 tests ✓
    styles.css            ← atenna-* prefixed, transitions ≤200ms

dist/                     ← committed, ready for Chrome Load unpacked
  content.js
  background.js
  manifest.json
  styles.css
  icons/ (16, 32, 48, 128px)
  store-promo-1280x800.png

manifest.json
vite.config.ts            ← content IIFE + static copy
vite.bg.config.ts         ← background ES module
scripts/generate-icons.mjs
```

### Test results

```
✓ src/content/detectInput.test.ts   (5 tests)
✓ src/ui/panel.test.ts              (7 tests)
✓ src/content/injectButton.test.ts  (9 tests)

Test Files  3 passed (3)
Tests      21 passed (21)
```

---

## How to load in Chrome

1. Open `chrome://extensions`
2. Enable **Developer mode** (top-right toggle)
3. Click **Load unpacked**
4. Select the `dist/` folder
5. Go to `chatgpt.com`, `claude.ai`, or `gemini.google.com`
6. The **Atenna Guard Prompt** button appears at the top-right of the input field

---

## Known limitations / next steps (not in scope for v1)

- Button position may need adjustment if ChatGPT/Claude/Gemini update their DOM structure — `MutationObserver` will re-inject but the selector may need updating.
- No dark mode support.
- Panel is informational only — future versions could inject a guard prompt into the input.
- No Chrome Web Store submission yet.

---

## Key design decisions

| Decision | Reason |
|---|---|
| IIFE for content script | Must be self-contained, no ES imports at runtime |
| `data-atenna-injected` guard | Prevents duplicate injection on SPA navigation |
| `escapeHtml` in panel.ts | XSS safety — platform name comes from hostname, not user input, but defense-in-depth |
| All classes prefixed `atenna-` | Avoid collisions with ChatGPT/Claude/Gemini host page CSS |
| `dist/` committed to git | Chrome extension loaded directly from dist; avoids build step for reviewers |
