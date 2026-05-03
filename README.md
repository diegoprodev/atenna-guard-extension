# Atenna Guard Prompt

Chrome Extension (Manifest V3) that injects an **"Atenna Guard Prompt"** button at the top-right corner of the input field in ChatGPT, Claude, and Gemini.

## Stack

- TypeScript + Vite 5
- Manifest V3 (no frameworks)
- Vitest + jsdom for unit tests

## Development

### Install dependencies

```bash
npm install
```

### Run tests

```bash
npm test
```

### Build

```bash
npm run build
```

Output goes to `dist/`. The build runs in three steps automatically:
1. Generates icons from the Atenna logo
2. Builds content script (IIFE format)
3. Builds background service worker (ES module)

## Load in Chrome

1. Open `chrome://extensions`
2. Enable **Developer mode** (toggle, top-right)
3. Click **Load unpacked**
4. Select the `dist/` folder
5. Navigate to one of the supported platforms:
   - [chatgpt.com](https://chatgpt.com)
   - [claude.ai](https://claude.ai)
   - [gemini.google.com](https://gemini.google.com)
6. The **Atenna Guard Prompt** button appears at the top-right corner of the input field
7. Click to open the status panel

## How it works

- Content script starts a `MutationObserver` on page load to handle SPA navigation
- Detects platform via `window.location.hostname`
- Injects a positioned `<button>` into the input's parent container
- Button toggles a fixed side panel showing extension status and detected platform

## Project structure

```
src/
  content/
    content.ts        ← entry point + MutationObserver
    detectInput.ts    ← platform detection (ChatGPT / Claude / Gemini)
    injectButton.ts   ← DOM injection with idempotency guard
  background/
    background.ts     ← MV3 service worker
  ui/
    panel.ts          ← side panel toggle
    styles.css        ← all styles (atenna-* prefix)
public/
  icons/              ← 16, 32, 48, 128px PNGs (generated from logo)
  store-promo-1280x800.png ← Chrome Web Store promotional image
scripts/
  generate-icons.mjs  ← converts Atenna logo to PNG icons using sharp
```

## Chrome Web Store

The `public/store-promo-1280x800.png` file is ready to upload as the promotional banner in the Chrome Web Store developer dashboard.
