# Changelog

All notable changes to **Atenna Guard Extension** are documented here.

## [1.2.0] — 2026-05-03

### Fixed
- **Panel ignoring in-app theme toggle**: `@media (prefers-color-scheme: dark)` only reacted to the OS setting. Replaced with runtime luminance check on `document.body` background color (`isDark()` in `panel.ts`). Panel now picks up ChatGPT/Claude/Gemini theme changes instantly on open.
- **Claude `/chats` page badge**: `detectPlatform()` returns `null` for non-chat paths (`/chats`, `/recents`, `/settings`, `/projects`, `/files`, `/artifacts`, `/teams`, `/upgrade`).

### Changed
- Dark theme toggled via `.atenna-panel--dark` CSS class (JS-applied) instead of `@media` query.
- Tests: 30 unit tests (up from 28) — added dark/light mode detection tests.

## [1.1.0] — 2026-05-03

### Added
- **`web_accessible_resources`** in `manifest.json`: allows content script to load `icons/icon128.png` via `chrome.runtime.getURL` — required for the badge logo to render.
- **`findVisualContainer()`** in `injectButton.ts`: walks up the DOM to find the element with `border-radius ≥ 8px` (the visual input box), used for accurate badge positioning on all platforms regardless of DOM nesting depth.
- **Panel positions above badge**: `panel.ts` reads the badge's `getBoundingClientRect()` and sets `bottom = innerHeight - badge.top + 8` — panel never overlaps the input.
- **`ResizeObserver`** on `documentElement` + input element: badge repositions when the page layout shifts (e.g. ChatGPT input moving from center to bottom on first message).

### Changed
- **Badge label**: "Atenna Guard Prompt" → "Atenna Prompt"
- **Badge icon**: SVG placeholder → real Atenna logo (`icon128.png`) via `chrome.runtime.getURL`
- **Icon blend mode**: `mix-blend-mode: lighten` removes the black circle background; white logo renders cleanly on green badge
- **Icon size**: 30px (overflows ~21px badge height by ~4.5px each side — "stamp" effect)
- **Badge position**: `position: fixed` + `getBoundingClientRect()` — immune to `overflow: hidden` on parent containers. Uses `findVisualContainer()` for vertical anchor and correct right-edge alignment.
- **Badge offset**: 90px from container right edge — clears mic/send toolbar icons on all platforms
- **Shimmer**: moved from full badge background to logo icon only (`filter: brightness + drop-shadow` animation on `.atenna-btn__icon`)
- **Panel animation**: simplified to `translateX(12px → 0)` slide; no longer conflicts with dynamic `bottom` positioning
- **Badge size**: reduced (font 11px, padding 3px/10px, icon 30px)
- **`currentCleanup`** module-level in `injectButton.ts`: tears down previous scroll/resize/ResizeObserver listeners when conversation switches, then creates a fresh badge for the new input
- **Tests**: 28 unit tests (up from 21) — added `chrome` stub, `ResizeObserver` mock, conversation-switch test, Claude path-guard tests

### Fixed
- **Badge floating on Claude `/chats` page**: `detectPlatform()` now returns `null` for Claude non-chat paths (`/chats`, `/recents`, `/settings`, `/projects`, `/files`, `/artifacts`, `/teams`, `/upgrade`) — badge only injects on actual chat pages
- **Badge overlapping voice icon** on ChatGPT: increased right offset from 10px to 90px
- **Badge center not at input top border**: switched from `offsetHeight` (returned 0 before layout) to `getBoundingClientRect().height` + `Promise.resolve()` microtask for reliable initial positioning
- **ChatGPT badge centering**: `findVisualContainer()` finds the correct visual input box rather than a wide wrapper div
- **Panel rendered white in dark mode**: `@media (prefers-color-scheme: dark)` overrides added
- **Badge not following on conversation switch**: module-level cleanup + badge removal before re-injection

## [1.0.0] — 2026-05-03

### Added
- **Platform detection** (`src/content/detectInput.ts`): detects ChatGPT, Claude, and Gemini via `window.location.hostname`.
- **Button injection** (`src/content/injectButton.ts`): injects badge into input container with idempotency guard.
- **Side panel** (`src/ui/panel.ts`): toggle-able panel showing status and platform name. XSS-safe.
- **CSS styles** (`src/ui/styles.css`): all classes prefixed `atenna-*`. Transitions ≤ 200ms.
- **Content script** (`src/content/content.ts`): `MutationObserver` for SPA re-renders.
- **Background service worker** (`src/background/background.ts`): MV3 `onInstalled` handler.
- **Manifest V3**: `host_permissions`, `storage` permission, IIFE content + ES background.
- **Icons**: Atenna logo converted from `.webp` → 16/32/48/128px PNG. Store promo 1280×800.
- **Vite dual build**: `vite.config.ts` (IIFE) + `vite.bg.config.ts` (ES module).
- **`dist/`** committed — ready for Chrome `Load unpacked`.

### Tests
- 21 unit tests across 3 files (Vitest + jsdom).
