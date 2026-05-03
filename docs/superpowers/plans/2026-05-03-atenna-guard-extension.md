# Atenna Guard Prompt — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a Chrome Extension (MV3) that injects an "Atenna Guard Prompt" button at the top-right of the input container in ChatGPT, Claude, and Gemini, and toggles a minimal side panel on click.

**Architecture:** Content script detects the platform via hostname, injects a positioned button into the input's parent container, and toggles a fixed side panel. MutationObserver handles SPA re-renders. Two separate Vite builds produce IIFE content.js + ES background.js.

**Tech Stack:** TypeScript, Vite 5, vite-plugin-static-copy, Vitest + jsdom, pngjs (icon generation), Chrome MV3.

---

## File Map

| File | Responsibility |
|---|---|
| `src/content/detectInput.ts` | Resolve platform name + input selector from hostname |
| `src/content/injectButton.ts` | Inject/remove button in input's parent container |
| `src/ui/panel.ts` | Create/toggle/destroy side panel |
| `src/ui/styles.css` | All visual styles, prefixed `atenna-*` |
| `src/content/content.ts` | Entry: init MutationObserver, orchestrate inject |
| `src/background/background.ts` | MV3 service worker lifecycle |
| `manifest.json` | Extension manifest |
| `vite.config.ts` | Content script (IIFE) + static asset copy |
| `vite.bg.config.ts` | Background service worker (ES) |
| `vitest.config.ts` | Test environment (jsdom) |
| `scripts/generate-icons.mjs` | Generate 16/32/48/128px placeholder PNGs |
| `package.json` | Scripts + devDependencies |
| `tsconfig.json` | TypeScript config |

---

## Task 1: Project Scaffold

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `vitest.config.ts`
- Create directories: `src/content/`, `src/background/`, `src/ui/`, `public/icons/`, `scripts/`

- [ ] **Step 1: Create directory structure**

```bash
cd c:\projetos\atenna-guard-extension
mkdir -p src/content src/background src/ui public/icons scripts
```

(PowerShell: `New-Item -ItemType Directory -Force src/content, src/background, src/ui, public/icons, scripts`)

- [ ] **Step 2: Create `package.json`**

```json
{
  "name": "atenna-guard-extension",
  "version": "1.0.0",
  "private": true,
  "scripts": {
    "build": "node scripts/generate-icons.mjs && vite build && vite build --config vite.bg.config.ts",
    "dev": "vite build --watch",
    "test": "vitest run",
    "test:watch": "vitest"
  },
  "devDependencies": {
    "@types/chrome": "^0.0.268",
    "@types/pngjs": "^6.0.4",
    "jsdom": "^24.1.0",
    "pngjs": "^7.0.0",
    "typescript": "^5.4.5",
    "vite": "^5.3.1",
    "vite-plugin-static-copy": "^1.0.6",
    "vitest": "^2.0.5"
  }
}
```

- [ ] **Step 3: Create `tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2020",
    "lib": ["ES2020", "DOM"],
    "module": "ESNext",
    "moduleResolution": "bundler",
    "strict": true,
    "noEmit": true,
    "types": ["chrome"]
  },
  "include": ["src/**/*.ts"]
}
```

- [ ] **Step 4: Create `vitest.config.ts`**

```typescript
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'jsdom',
    globals: true,
  },
});
```

- [ ] **Step 5: Install dependencies**

```bash
npm install
```

Expected: `node_modules/` created, no errors.

- [ ] **Step 6: Commit scaffold**

```bash
git init
git add package.json tsconfig.json vitest.config.ts
git commit -m "chore: project scaffold"
```

---

## Task 2: Vite Build Configs

**Files:**
- Create: `vite.config.ts`
- Create: `vite.bg.config.ts`

- [ ] **Step 1: Create `vite.config.ts`** (content script + static assets)

```typescript
import { defineConfig } from 'vite';
import { viteStaticCopy } from 'vite-plugin-static-copy';
import { resolve } from 'path';

export default defineConfig({
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    rollupOptions: {
      input: resolve(__dirname, 'src/content/content.ts'),
      output: {
        format: 'iife',
        entryFileNames: 'content.js',
        inlineDynamicImports: true,
      },
    },
  },
  plugins: [
    viteStaticCopy({
      targets: [
        { src: 'manifest.json', dest: '.' },
        { src: 'public/icons/*', dest: 'icons' },
        { src: 'src/ui/styles.css', dest: '.' },
      ],
    }),
  ],
});
```

- [ ] **Step 2: Create `vite.bg.config.ts`** (background service worker)

```typescript
import { defineConfig } from 'vite';
import { resolve } from 'path';

export default defineConfig({
  build: {
    outDir: 'dist',
    emptyOutDir: false,
    rollupOptions: {
      input: resolve(__dirname, 'src/background/background.ts'),
      output: {
        format: 'es',
        entryFileNames: 'background.js',
      },
    },
  },
});
```

- [ ] **Step 3: Commit**

```bash
git add vite.config.ts vite.bg.config.ts
git commit -m "chore: vite build configs"
```

---

## Task 3: Manifest

**Files:**
- Create: `manifest.json`

- [ ] **Step 1: Create `manifest.json`**

```json
{
  "manifest_version": 3,
  "name": "Atenna Guard Prompt",
  "version": "1.0.0",
  "description": "Inject Atenna Guard Prompt button into ChatGPT, Claude, and Gemini inputs.",
  "permissions": ["storage"],
  "host_permissions": [
    "https://chat.openai.com/*",
    "https://chatgpt.com/*",
    "https://claude.ai/*",
    "https://gemini.google.com/*"
  ],
  "content_scripts": [
    {
      "matches": [
        "https://chat.openai.com/*",
        "https://chatgpt.com/*",
        "https://claude.ai/*",
        "https://gemini.google.com/*"
      ],
      "js": ["content.js"],
      "css": ["styles.css"],
      "run_at": "document_idle"
    }
  ],
  "background": {
    "service_worker": "background.js",
    "type": "module"
  },
  "action": {
    "default_icon": {
      "16": "icons/icon16.png",
      "32": "icons/icon32.png",
      "48": "icons/icon48.png",
      "128": "icons/icon128.png"
    },
    "default_title": "Atenna Guard Prompt"
  },
  "icons": {
    "16": "icons/icon16.png",
    "32": "icons/icon32.png",
    "48": "icons/icon48.png",
    "128": "icons/icon128.png"
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add manifest.json
git commit -m "chore: manifest v3 with chatgpt, claude, gemini"
```

---

## Task 4: CSS Styles

**Files:**
- Create: `src/ui/styles.css`

- [ ] **Step 1: Create `src/ui/styles.css`**

```css
/* Atenna Guard Prompt — all classes prefixed atenna- to avoid host page collisions */

.atenna-btn {
  position: absolute;
  top: 0;
  right: 0;
  background: #22c55e;
  color: #ffffff;
  border: none;
  border-radius: 8px 8px 0 0;
  font-size: 12px;
  font-weight: 500;
  padding: 5px 12px;
  cursor: pointer;
  z-index: 9999;
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
  transition: background 200ms ease, box-shadow 200ms ease;
  white-space: nowrap;
  line-height: 1.4;
  letter-spacing: 0.01em;
}

.atenna-btn:hover {
  background: #16a34a;
  box-shadow: 0 2px 8px rgba(34, 197, 94, 0.35);
}

.atenna-btn:focus-visible {
  outline: 2px solid #22c55e;
  outline-offset: 2px;
}

.atenna-btn[data-active='true'] {
  background: #15803d;
}

/* ── Panel ──────────────────────────────────────────── */

.atenna-panel {
  position: fixed;
  right: 16px;
  top: 50%;
  transform: translateY(-50%);
  width: 240px;
  background: #ffffff;
  border-radius: 12px;
  box-shadow: 0 4px 24px rgba(0, 0, 0, 0.12);
  z-index: 99999;
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
  font-size: 14px;
  color: #1f2937;
  padding: 14px;
  animation: atenna-slide-in 200ms ease;
}

@keyframes atenna-slide-in {
  from {
    opacity: 0;
    transform: translateY(-50%) translateX(16px);
  }
  to {
    opacity: 1;
    transform: translateY(-50%) translateX(0);
  }
}

.atenna-panel__header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 8px;
}

.atenna-panel__logo {
  font-weight: 600;
  font-size: 13px;
  color: #15803d;
  letter-spacing: 0.01em;
}

.atenna-panel__close {
  background: none;
  border: none;
  cursor: pointer;
  font-size: 18px;
  color: #9ca3af;
  padding: 0 2px;
  line-height: 1;
  transition: color 150ms ease;
}

.atenna-panel__close:hover {
  color: #1f2937;
}

.atenna-panel__divider {
  border: none;
  border-top: 1px solid #e5e7eb;
  margin: 8px 0;
}

.atenna-panel__status {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 10px;
  font-size: 13px;
}

.atenna-panel__dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: #22c55e;
  flex-shrink: 0;
  box-shadow: 0 0 0 2px rgba(34, 197, 94, 0.25);
}

.atenna-panel__platform {
  font-size: 11px;
  color: #9ca3af;
  letter-spacing: 0.02em;
}
```

- [ ] **Step 2: Commit**

```bash
git add src/ui/styles.css
git commit -m "feat: atenna guard styles with 5 UX laws applied"
```

---

## Task 5: Platform Detection — detectInput.ts (TDD)

**Files:**
- Create: `src/content/detectInput.ts`
- Test: `src/content/detectInput.test.ts`

- [ ] **Step 1: Write failing tests first**

Create `src/content/detectInput.test.ts`:

```typescript
import { describe, it, expect, beforeEach } from 'vitest';
import { detectPlatform, type PlatformConfig } from './detectInput';

function setHostname(hostname: string) {
  Object.defineProperty(window, 'location', {
    value: { hostname },
    writable: true,
    configurable: true,
  });
}

describe('detectPlatform', () => {
  it('returns ChatGPT config for chatgpt.com', () => {
    setHostname('chatgpt.com');
    const config = detectPlatform();
    expect(config).not.toBeNull();
    expect(config!.name).toBe('ChatGPT');
    expect(config!.inputSelector).toBe('#prompt-textarea');
  });

  it('returns ChatGPT config for chat.openai.com', () => {
    setHostname('chat.openai.com');
    expect(detectPlatform()?.name).toBe('ChatGPT');
  });

  it('returns Claude config for claude.ai', () => {
    setHostname('claude.ai');
    const config = detectPlatform();
    expect(config!.name).toBe('Claude');
    expect(config!.inputSelector).toContain('contenteditable');
  });

  it('returns Gemini config for gemini.google.com', () => {
    setHostname('gemini.google.com');
    const config = detectPlatform();
    expect(config!.name).toBe('Gemini');
    expect(config!.inputSelector).toContain('contenteditable');
  });

  it('returns null for unknown hostname', () => {
    setHostname('example.com');
    expect(detectPlatform()).toBeNull();
  });
});
```

- [ ] **Step 2: Run tests — expect FAIL (file not found)**

```bash
npm test
```

Expected: `Cannot find module './detectInput'`

- [ ] **Step 3: Implement `src/content/detectInput.ts`**

```typescript
export interface PlatformConfig {
  name: string;
  inputSelector: string;
}

export function detectPlatform(): PlatformConfig | null {
  const host = window.location.hostname;

  if (host.includes('chatgpt.com') || host.includes('chat.openai.com')) {
    return {
      name: 'ChatGPT',
      inputSelector: '#prompt-textarea',
    };
  }

  if (host.includes('claude.ai')) {
    return {
      name: 'Claude',
      inputSelector: 'div[contenteditable="true"]',
    };
  }

  if (host.includes('gemini.google.com')) {
    return {
      name: 'Gemini',
      inputSelector: 'div[contenteditable="true"]',
    };
  }

  return null;
}
```

- [ ] **Step 4: Run tests — expect PASS**

```bash
npm test
```

Expected: `5 passed`

- [ ] **Step 5: Commit**

```bash
git add src/content/detectInput.ts src/content/detectInput.test.ts
git commit -m "feat: platform detection for chatgpt, claude, gemini"
```

---

## Task 6: Button Injection — injectButton.ts (TDD)

**Files:**
- Create: `src/content/injectButton.ts`
- Test: `src/content/injectButton.test.ts`

- [ ] **Step 1: Write failing tests**

Create `src/content/injectButton.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { injectButton, removeButton } from './injectButton';
import type { PlatformConfig } from './detectInput';

const chatgpt: PlatformConfig = {
  name: 'ChatGPT',
  inputSelector: '#prompt-textarea',
};

describe('injectButton', () => {
  beforeEach(() => {
    document.body.innerHTML = '<div id="parent"><textarea id="prompt-textarea"></textarea></div>';
  });

  it('injects .atenna-btn into the input parent', () => {
    injectButton(chatgpt, () => {});
    expect(document.querySelector('.atenna-btn')).not.toBeNull();
  });

  it('does not inject twice (idempotent)', () => {
    injectButton(chatgpt, () => {});
    injectButton(chatgpt, () => {});
    expect(document.querySelectorAll('.atenna-btn').length).toBe(1);
  });

  it('sets padding-top on parent container', () => {
    injectButton(chatgpt, () => {});
    const parent = document.getElementById('parent') as HTMLElement;
    expect(parent.style.paddingTop).toBe('30px');
  });

  it('sets position relative if container is static', () => {
    injectButton(chatgpt, () => {});
    const parent = document.getElementById('parent') as HTMLElement;
    expect(parent.style.position).toBe('relative');
  });

  it('button text is "Atenna Guard Prompt"', () => {
    injectButton(chatgpt, () => {});
    const btn = document.querySelector('.atenna-btn') as HTMLButtonElement;
    expect(btn.textContent).toBe('Atenna Guard Prompt');
  });

  it('calls onToggle when button is clicked', () => {
    const toggle = vi.fn();
    injectButton(chatgpt, toggle);
    (document.querySelector('.atenna-btn') as HTMLButtonElement).click();
    expect(toggle).toHaveBeenCalledOnce();
  });

  it('does nothing if input selector matches nothing', () => {
    document.body.innerHTML = '<div></div>';
    injectButton(chatgpt, () => {});
    expect(document.querySelector('.atenna-btn')).toBeNull();
  });
});

describe('removeButton', () => {
  beforeEach(() => {
    document.body.innerHTML = '<div id="parent"><textarea id="prompt-textarea"></textarea></div>';
  });

  it('removes injected button', () => {
    injectButton(chatgpt, () => {});
    removeButton(chatgpt.inputSelector);
    expect(document.querySelector('.atenna-btn')).toBeNull();
  });

  it('resets padding-top after removal', () => {
    injectButton(chatgpt, () => {});
    removeButton(chatgpt.inputSelector);
    const parent = document.getElementById('parent') as HTMLElement;
    expect(parent.style.paddingTop).toBe('');
  });
});
```

- [ ] **Step 2: Run tests — expect FAIL**

```bash
npm test
```

Expected: `Cannot find module './injectButton'`

- [ ] **Step 3: Implement `src/content/injectButton.ts`**

```typescript
import type { PlatformConfig } from './detectInput';

const INJECTED_ATTR = 'data-atenna-injected';
const BTN_CLASS = 'atenna-btn';

export function injectButton(config: PlatformConfig, onToggle: () => void): void {
  const input = document.querySelector(config.inputSelector) as HTMLElement | null;
  if (!input) return;

  const container = input.parentElement as HTMLElement | null;
  if (!container || container.hasAttribute(INJECTED_ATTR)) return;

  container.setAttribute(INJECTED_ATTR, 'true');

  if (getComputedStyle(container).position === 'static') {
    container.style.position = 'relative';
  }
  container.style.paddingTop = '30px';

  const btn = document.createElement('button');
  btn.className = BTN_CLASS;
  btn.textContent = 'Atenna Guard Prompt';
  btn.setAttribute('aria-label', 'Atenna Guard Prompt');
  btn.addEventListener('click', onToggle);

  container.insertBefore(btn, container.firstChild);
}

export function removeButton(inputSelector: string): void {
  const input = document.querySelector(inputSelector) as HTMLElement | null;
  if (!input) return;

  const container = input.parentElement as HTMLElement | null;
  if (!container) return;

  container.removeAttribute(INJECTED_ATTR);
  container.style.paddingTop = '';

  container.querySelector(`.${BTN_CLASS}`)?.remove();
}
```

- [ ] **Step 4: Run tests — expect PASS**

```bash
npm test
```

Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/content/injectButton.ts src/content/injectButton.test.ts
git commit -m "feat: button injection with idempotency guard"
```

---

## Task 7: Side Panel — panel.ts (TDD)

**Files:**
- Create: `src/ui/panel.ts`
- Test: `src/ui/panel.test.ts`

- [ ] **Step 1: Write failing tests**

Create `src/ui/panel.test.ts`:

```typescript
import { describe, it, expect, beforeEach } from 'vitest';
import { togglePanel } from './panel';

describe('togglePanel', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('creates #atenna-panel on first call', () => {
    togglePanel('ChatGPT');
    expect(document.getElementById('atenna-panel')).not.toBeNull();
  });

  it('removes #atenna-panel on second call (toggle off)', () => {
    togglePanel('ChatGPT');
    togglePanel('ChatGPT');
    expect(document.getElementById('atenna-panel')).toBeNull();
  });

  it('panel has class atenna-panel', () => {
    togglePanel('Claude');
    expect(document.querySelector('.atenna-panel')).not.toBeNull();
  });

  it('panel contains the platform name', () => {
    togglePanel('Gemini');
    expect(document.getElementById('atenna-panel')!.textContent).toContain('Gemini');
  });

  it('panel contains "Atenna Guard ativo"', () => {
    togglePanel('ChatGPT');
    expect(document.getElementById('atenna-panel')!.textContent).toContain('Atenna Guard ativo');
  });

  it('close button removes the panel', () => {
    togglePanel('ChatGPT');
    const closeBtn = document.querySelector('.atenna-panel__close') as HTMLButtonElement;
    closeBtn.click();
    expect(document.getElementById('atenna-panel')).toBeNull();
  });
});
```

- [ ] **Step 2: Run tests — expect FAIL**

```bash
npm test
```

Expected: `Cannot find module './panel'`

- [ ] **Step 3: Implement `src/ui/panel.ts`**

```typescript
const PANEL_ID = 'atenna-panel';

export function togglePanel(platformName: string): void {
  const existing = document.getElementById(PANEL_ID);
  if (existing) {
    existing.remove();
    return;
  }
  createPanel(platformName);
}

function createPanel(platformName: string): void {
  const panel = document.createElement('div');
  panel.id = PANEL_ID;
  panel.className = 'atenna-panel';

  panel.innerHTML = `
    <div class="atenna-panel__header">
      <span class="atenna-panel__logo">✦ Atenna Guard</span>
      <button class="atenna-panel__close" aria-label="Fechar painel">×</button>
    </div>
    <hr class="atenna-panel__divider" />
    <div class="atenna-panel__status">
      <span class="atenna-panel__dot"></span>
      <span>Atenna Guard ativo</span>
    </div>
    <div class="atenna-panel__platform">Plataforma: ${escapeHtml(platformName)}</div>
  `;

  panel.querySelector('.atenna-panel__close')!
    .addEventListener('click', () => panel.remove());

  document.body.appendChild(panel);
}

function escapeHtml(str: string): string {
  return str.replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] ?? c)
  );
}
```

- [ ] **Step 4: Run tests — expect PASS**

```bash
npm test
```

Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/ui/panel.ts src/ui/panel.test.ts
git commit -m "feat: toggle panel with platform name and close button"
```

---

## Task 8: Content Entry Point — content.ts

**Files:**
- Create: `src/content/content.ts`

- [ ] **Step 1: Create `src/content/content.ts`**

```typescript
import { detectPlatform } from './detectInput';
import { injectButton } from './injectButton';
import { togglePanel } from '../ui/panel';

function tryInject(): void {
  const config = detectPlatform();
  if (!config) return;

  const input = document.querySelector(config.inputSelector);
  if (!input) return;

  injectButton(config, () => togglePanel(config.name));
}

function init(): void {
  tryInject();

  const observer = new MutationObserver(() => {
    tryInject();
  });

  observer.observe(document.body, { childList: true, subtree: true });
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
```

- [ ] **Step 2: Commit**

```bash
git add src/content/content.ts
git commit -m "feat: content script entry with MutationObserver"
```

---

## Task 9: Background Service Worker

**Files:**
- Create: `src/background/background.ts`

- [ ] **Step 1: Create `src/background/background.ts`**

```typescript
chrome.runtime.onInstalled.addListener(() => {
  console.log('[Atenna Guard] Extension installed.');
});
```

- [ ] **Step 2: Commit**

```bash
git add src/background/background.ts
git commit -m "feat: background service worker"
```

---

## Task 10: Icon Generation

**Files:**
- Create: `scripts/generate-icons.mjs`

- [ ] **Step 1: Create `scripts/generate-icons.mjs`**

```javascript
import { PNG } from 'pngjs';
import { writeFileSync, mkdirSync } from 'fs';

const sizes = [16, 32, 48, 128];
mkdirSync('public/icons', { recursive: true });

// #22c55e = R:34 G:197 B:94
const [R, G, B] = [34, 197, 94];

for (const size of sizes) {
  const png = new PNG({ width: size, height: size });

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = (size * y + x) * 4;
      // Rounded corners: set transparent if outside circle
      const cx = size / 2;
      const cy = size / 2;
      const r = size / 2;
      const dist = Math.sqrt((x - cx) ** 2 + (y - cy) ** 2);
      const alpha = dist <= r ? 255 : 0;

      png.data[i] = R;
      png.data[i + 1] = G;
      png.data[i + 2] = B;
      png.data[i + 3] = alpha;
    }
  }

  const buffer = PNG.sync.write(png);
  writeFileSync(`public/icons/icon${size}.png`, buffer);
  console.log(`Generated icon${size}.png`);
}
```

- [ ] **Step 2: Run icon generation to verify**

```bash
node scripts/generate-icons.mjs
```

Expected output:
```
Generated icon16.png
Generated icon32.png
Generated icon48.png
Generated icon128.png
```

Files appear in `public/icons/`.

- [ ] **Step 3: Commit**

```bash
git add scripts/generate-icons.mjs public/icons/
git commit -m "feat: generate green circle extension icons"
```

---

## Task 11: Build Verification

- [ ] **Step 1: Run full build**

```bash
npm run build
```

Expected: no errors. `dist/` contains:
```
dist/
  content.js
  background.js
  manifest.json
  styles.css
  icons/
    icon16.png
    icon32.png
    icon48.png
    icon128.png
```

- [ ] **Step 2: Verify dist contents**

```bash
ls dist/
ls dist/icons/
```

- [ ] **Step 3: Run all tests**

```bash
npm test
```

Expected: all tests pass.

- [ ] **Step 4: Commit build output**

Add `dist/` to git (Chrome extension load from `dist` directly).

```bash
git add dist/
git commit -m "build: initial dist output"
```

---

## Task 12: README

**Files:**
- Create: `README.md`

- [ ] **Step 1: Create `README.md`**

```markdown
# Atenna Guard Prompt

Chrome Extension (Manifest V3) that injects an "Atenna Guard Prompt" button at the
top-right of the input field in ChatGPT, Claude, and Gemini.

## Stack

- TypeScript + Vite 5
- Manifest V3
- No framework dependencies

## Development

### Install

```bash
npm install
```

### Build

```bash
npm run build
```

Output goes to `dist/`.

### Test

```bash
npm test
```

## Load in Chrome

1. Open `chrome://extensions`
2. Enable **Developer mode** (top-right toggle)
3. Click **Load unpacked**
4. Select the `dist/` folder
5. Navigate to [chatgpt.com](https://chatgpt.com), [claude.ai](https://claude.ai), or [gemini.google.com](https://gemini.google.com)
6. Look for the **Atenna Guard Prompt** button at the top-right of the input field
7. Click it to open the side panel

## How it works

- `content.js` starts a `MutationObserver` on page load (handles SPA navigation)
- Detects the platform via `window.location.hostname`
- Injects a positioned button into the input's parent container
- Button toggles a fixed side panel showing extension status
```

- [ ] **Step 2: Commit**

```bash
git add README.md
git commit -m "docs: installation and usage guide"
```

---

## Task 13: GitHub Repository + Push

- [ ] **Step 1: Verify `gh` CLI is authenticated**

```bash
gh auth status
```

Expected: logged in as user associated with `devdiegopro@gmail.com`.

If not: run `gh auth login` and follow prompts.

- [ ] **Step 2: Create GitHub repository and push**

```bash
gh repo create atenna-guard-extension --public --description "Chrome Extension: Atenna Guard Prompt button for ChatGPT, Claude & Gemini" --source=. --remote=origin --push
```

Expected: repository created at `https://github.com/<username>/atenna-guard-extension` and all commits pushed.

- [ ] **Step 3: Verify on GitHub**

```bash
gh repo view atenna-guard-extension --web
```

Opens the repository in the browser.

---

## Self-Review

**Spec coverage:**
- [x] Button at top-right of input, integrated (Task 6)
- [x] `border-radius: 8px 8px 0 0` (Task 4 CSS)
- [x] ChatGPT, Claude, Gemini detection (Task 5)
- [x] MutationObserver for SPA re-renders (Task 8)
- [x] Side panel with status + platform name (Task 7)
- [x] All 5 UX Laws applied in CSS + architecture
- [x] MV3 manifest with correct host_permissions (Task 3)
- [x] Icons 16/32/48/128 (Task 10)
- [x] Vite builds IIFE content + ES background (Task 2)
- [x] GitHub repo + push (Task 13)
- [x] No React, no remote code, no heavy libs

**Placeholder scan:** None found.

**Type consistency:**
- `PlatformConfig` exported from `detectInput.ts`, imported in `injectButton.ts` and `content.ts` ✓
- `PANEL_ID = 'atenna-panel'` used consistently in `panel.ts` ✓
- `BTN_CLASS = 'atenna-btn'` matches CSS class in `styles.css` ✓
- `INJECTED_ATTR = 'data-atenna-injected'` used in inject + remove ✓
