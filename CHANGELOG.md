# Changelog

All notable changes to **Atenna Guard Extension** are documented here.

## [1.0.0] — 2026-05-03

### Added
- **Platform detection** (`src/content/detectInput.ts`): detects ChatGPT (`chatgpt.com`, `chat.openai.com`), Claude (`claude.ai`), and Gemini (`gemini.google.com`) via `window.location.hostname`.
- **Button injection** (`src/content/injectButton.ts`): injects `.atenna-btn` into the input's parent container with idempotency guard (`data-atenna-injected`). Sets `position: relative` and `padding-top: 30px` on container.
- **Side panel** (`src/ui/panel.ts`): toggle-able fixed panel (`#atenna-panel`) showing extension status and detected platform name. XSS-safe via `escapeHtml`. Close button removes panel.
- **CSS styles** (`src/ui/styles.css`): all classes prefixed `atenna-*` to avoid host page collisions. Transitions ≤ 200ms (Doherty Threshold). System font stack only.
- **Content script entry** (`src/content/content.ts`): `MutationObserver` on `document.body` handles SPA re-renders on all three platforms.
- **Background service worker** (`src/background/background.ts`): MV3 lifecycle handler (`onInstalled`).
- **Manifest V3** (`manifest.json`): `host_permissions` for all four URLs, `storage` permission, IIFE content script + ES module background.
- **Icons**: real Atenna logo converted from `.webp` → 16/32/48/128px PNG with transparent background. Store promo image 1280×800.
- **Vite build**: dual config — `vite.config.ts` (content IIFE + static copy) and `vite.bg.config.ts` (background ES module).
- **`dist/`**: committed build output ready for Chrome `Load unpacked`.

### Fixed
- Icons regenerated with transparent background (preserve original alpha channel).
- `package.json` `type: "module"` added for ESM compatibility with `generate-icons.mjs`.

### Tests
- 21 unit tests across 3 files (Vitest + jsdom), all passing:
  - `detectInput.test.ts` — 5 tests
  - `injectButton.test.ts` — 9 tests
  - `panel.test.ts` — 7 tests
