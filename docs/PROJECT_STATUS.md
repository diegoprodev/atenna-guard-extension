# Atenna Guard Extension — Project Status

**Date:** 2026-05-03  
**Version:** 1.2.0  
**Repo:** https://github.com/diegoprodev/atenna-guard-extension  
**Branch:** `main` — up to date with remote

---

## What this project is

A Chrome Extension (Manifest V3) that injects an **"Atenna Prompt"** badge at the top-right of the input field in ChatGPT, Claude, and Gemini. Clicking the badge toggles a minimal panel showing extension status and the detected platform name.

**Non-goals:** no auth, no API calls, no prompt reading/modification, no data collection, no React.

---

## Tech Stack

| Tool | Version | Role |
|---|---|---|
| TypeScript | ^5.4.5 | Language |
| Vite | ^5.3.1 | Build (dual config) |
| Vitest + jsdom | ^2.0.5 | Unit tests |
| vite-plugin-static-copy | ^1.0.6 | Copy manifest + icons to dist |
| sharp | ^0.34.5 | Icon generation (trim + blend) |
| Chrome MV3 | — | Extension target |

---

## Current State: STABLE v1.2.0

### Files delivered

```
src/
  content/
    detectInput.ts        ← platform detection; excludes Claude non-chat paths
    detectInput.test.ts   ← 9 tests ✓
    injectButton.ts       ← fixed positioning via findVisualContainer() + getBoundingClientRect()
    injectButton.test.ts  ← 12 tests ✓
    content.ts            ← entry point, MutationObserver
  background/
    background.ts         ← MV3 service worker (onInstalled)
  ui/
    panel.ts              ← toggle panel; isDark() detects in-app theme at runtime
    panel.test.ts         ← 9 tests ✓
    styles.css            ← atenna-* prefixed; .atenna-panel--dark class for dark theme

dist/                     ← committed, ready for Chrome Load unpacked
manifest.json             ← includes web_accessible_resources for icon128.png
scripts/generate-icons.mjs ← sharp with .trim() to fill available space
```

### Test results

```
✓ src/content/detectInput.test.ts    (9 tests)
✓ src/ui/panel.test.ts               (9 tests)
✓ src/content/injectButton.test.ts  (12 tests)

Test Files  3 passed (3)
Tests      30 passed (30)
```

---

## Key architecture decisions

| Decision | Reason |
|---|---|
| `position: fixed` + `getBoundingClientRect()` | Immune to `overflow: hidden` on parent containers (all 3 platforms clip children) |
| `findVisualContainer()` heuristic | Walks up DOM to `border-radius ≥ 8px` element — correct visual anchor on ChatGPT/Claude/Gemini without platform-specific selectors |
| `currentCleanup` module-level | Allows clean teardown of scroll/resize/ResizeObserver when conversation switches |
| `isDark()` luminance check | Tracks platform's in-app theme toggle, not OS preference |
| `.atenna-panel--dark` class | Applied by JS at panel creation time based on `isDark()` |
| `chrome.runtime.getURL` + `web_accessible_resources` | Required for content scripts to load extension assets (the Atenna logo) |
| `mix-blend-mode: lighten` on icon | Removes black circle background; white logo shows on green badge |
| CLAUDE_NON_CHAT path guard | Prevents badge on `/chats`, `/recents`, etc. where contenteditable is a search box |
| `Promise.resolve().then(positionButton)` | Defers initial badge positioning one microtask so `getBoundingClientRect().height` is non-zero |

---

## Known limitations

- If ChatGPT/Claude/Gemini update their DOM structure, `findVisualContainer()` heuristic (border-radius ≥ 8px) may need adjustment.
- Badge right offset (90px) is tuned for current toolbar layouts; may need adjustment if platforms add/remove toolbar buttons.
- No Chrome Web Store submission yet.
- Panel position is calculated at open time; if the badge moves after the panel is open (rare), the panel won't follow.

---

## How to load in Chrome

1. `chrome://extensions` → Enable **Developer mode**
2. **Load unpacked** → select `dist/`
3. Navigate to `chatgpt.com`, `claude.ai`, or `gemini.google.com`
4. Badge appears at top-right of input, half outside the container border
