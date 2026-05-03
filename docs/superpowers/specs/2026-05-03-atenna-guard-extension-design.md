# Atenna Guard Prompt — Design Spec
**Date:** 2026-05-03  
**Status:** Approved

---

## Overview

A Chrome Extension (Manifest V3) that injects an "Atenna Guard Prompt" button into the input fields of ChatGPT, Claude, and Gemini. The button sits at the top-right corner of the input container, integrated with slightly rounded top borders. Clicking it toggles a minimal side panel.

---

## 5 UX Laws Applied

| Law | Application |
|---|---|
| **Fitts's Law** | Button fixed at top-right of input — predictable, large enough click target |
| **Hick's Law** | One button, one action — zero decision overhead |
| **Jakob's Law** | Follows Grammarly/Jasper extension pattern users already know |
| **Miller's Law** | Panel displays ≤5 elements — no cognitive overload |
| **Doherty Threshold** | All transitions ≤ 200ms, no loading states, instant feedback |

---

## Architecture

```
atenna-guard-extension/
  manifest.json
  package.json
  tsconfig.json
  vite.config.ts
  src/
    content/
      content.ts         ← entry point; starts MutationObserver
      detectInput.ts     ← platform-specific selectors
      injectButton.ts    ← DOM injection logic
    background/
      background.ts      ← MV3 service worker (lifecycle only)
    ui/
      panel.ts           ← side panel create/toggle/destroy
      styles.css         ← all styles, prefixed atenna-*
  public/
    icons/               ← 16, 32, 48, 128px PNGs
  dist/                  ← vite build output
  docs/
    superpowers/specs/   ← this file
```

### Data Flow

```
Page Load
  └─ content.ts → MutationObserver(document.body, subtree)
       └─ detectInput.ts → resolves platform + selectors
            └─ injectButton.ts
                 ├─ guard: skip if data-atenna-injected="true"
                 ├─ set container position: relative
                 ├─ set container padding-top: 30px
                 └─ insert <button class="atenna-btn">
                      └─ click → panel.ts.toggle()
```

---

## Platform Detection

| Platform | URL Match | Input Selector | Button Container |
|---|---|---|---|
| **ChatGPT** | `chatgpt.com`, `chat.openai.com` | `#prompt-textarea` | `.relative` parent of textarea |
| **Claude** | `claude.ai` | `div[contenteditable="true"]` inside `fieldset` | `fieldset` or immediate parent div |
| **Gemini** | `gemini.google.com` | `div[contenteditable="true"]` inside `rich-textarea` | `rich-textarea` wrapper |

Detection order: check `window.location.hostname` → return platform config object `{ inputSelector, containerSelector }`.

MutationObserver watches `document.body` with `{ childList: true, subtree: true }` to re-inject after SPA navigation.

---

## Button Design

### Visual Spec

```
Position: absolute, top: 0, right: 0
Border-radius: 8px 8px 0 0  (top rounded, bottom flat — integrated with input edge)
Background: #22c55e (green-500)
Color: #ffffff
Font-size: 12px, font-weight: 500
Padding: 5px 12px
Transition: background 200ms ease, box-shadow 200ms ease
Z-index: 9999
```

### States

| State | Style |
|---|---|
| Default | `background: #22c55e` |
| Hover | `background: #16a34a`, `box-shadow: 0 2px 8px rgba(34,197,94,0.4)` |
| Active (panel open) | `background: #15803d`, subtle ring |
| Focus | `outline: 2px solid #22c55e`, `outline-offset: 2px` (WCAG AA) |

### Container Adjustment

The button's parent container receives:
- `position: relative` (if not already set)
- `padding-top: 30px` injected via inline style (removed on extension unload)

---

## Side Panel Design

```
Position: fixed, right: 16px, top: 50%, transform: translateY(-50%)
Width: 240px
Border-radius: 12px
Background: #ffffff
Box-shadow: 0 4px 24px rgba(0,0,0,0.12)
Animation: slideInRight 200ms ease on open
```

### Panel Content

```
┌──────────────────────────┐
│ ✦ Atenna Guard      [×] │  ← header + close button
│ ─────────────────────── │
│ ● Atenna Guard ativo    │  ← green dot status
│                          │
│ Plataforma: ChatGPT     │  ← auto-detected platform name
│                          │
└──────────────────────────┘
```

Elements (5 max — Miller's Law):
1. Header with logo text
2. Close button (×)
3. Divider
4. Status indicator (green dot + "Atenna Guard ativo")
5. Detected platform label

---

## Manifest V3 Config

```json
{
  "manifest_version": 3,
  "name": "Atenna Guard Prompt",
  "version": "1.0.0",
  "permissions": ["storage"],
  "host_permissions": [
    "https://chat.openai.com/*",
    "https://chatgpt.com/*",
    "https://claude.ai/*",
    "https://gemini.google.com/*"
  ],
  "content_scripts": [{
    "matches": [
      "https://chat.openai.com/*",
      "https://chatgpt.com/*",
      "https://claude.ai/*",
      "https://gemini.google.com/*"
    ],
    "js": ["src/content/content.js"],
    "css": ["src/ui/styles.css"],
    "run_at": "document_idle"
  }],
  "background": {
    "service_worker": "background.js"
  },
  "action": {
    "default_icon": { "16": "icons/icon16.png", "32": "icons/icon32.png" }
  }
}
```

---

## Vite Build Config

Multi-entry build:
- `content` → `dist/src/content/content.js`
- `background` → `dist/background.js`

Plugins:
- `vite-plugin-static-copy` to copy `manifest.json` and `public/icons/` into `dist/`

Output format: `iife` for content script (must be self-contained), `es` for background.

---

## CSS Isolation Strategy

All classes prefixed `atenna-` to avoid collisions with host page styles:
- `.atenna-btn`
- `.atenna-panel`
- `.atenna-panel__header`
- `.atenna-panel__status`
- `.atenna-panel__platform`

No external font imports — uses system font stack (`-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif`).

---

## Non-Goals (YAGNI)

- No authentication or API calls
- No prompt modification or reading
- No data collection or remote requests
- No dark mode (keeps bundle minimal)
- No React or heavy framework

---

## GitHub Repository

New repo: `atenna-guard-extension` under user `devdiegopro@gmail.com`  
Location: `c:\projetos\atenna-guard-extension\`  
After build: `git init` → create GitHub repo → commit → push
