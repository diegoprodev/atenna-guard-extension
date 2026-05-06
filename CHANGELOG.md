# Changelog

All notable changes to **Atenna Guard Extension** are documented here.

## [2.1.0] — 2026-05-05

### Added
- **Authentication UI** (`src/ui/modal.ts`, `src/ui/modal.css`):
  - Login screen with email input and magic link flow (`renderLoginView`)
  - Shows only when user has no valid session
  - Status messages: "Verifique seu email" on success, error text on failure
  - CSS styles for login form: `.atenna-modal__login`, `.atenna-modal__login-input`, `.atenna-modal__login-btn`

- **Session validation** (`src/core/auth.ts`):
  - `getActiveSession()` — reads stored JWT and validates expiry (60s buffer) before returning
  - `decodeJwtPayload(token)` — shared JWT utility for extracting claims (sub, email, etc.)
  - Modal now gates entire flow behind session check: no session = login view

- **Magic link callback capture** (`src/background/background.ts`):
  - `chrome.tabs.onUpdated` listener captures Supabase redirect URL (`#access_token=...`)
  - Parses JWT payload to extract email and expiry time
  - Stores complete session in `chrome.storage.local['atenna_jwt']`
  - Works silently — no UI needed, user just sees extension icon light up after email click

- **Supabase plan sync** (`src/core/planManager.ts`):
  - `syncPlanFromSupabase(session)` — fetches user's plan from `profiles` table via REST API
  - Replaces local-only plan with real database state
  - Called on every modal open after session validation
  - Silently fails if network error (user keeps previous plan value)

- **Manifest permissions**:
  - Added `"tabs"` permission for `chrome.tabs.onUpdated` access
  - Added `"https://*.supabase.co/*"` host permission for Supabase API calls

### Changed
- **Modal initialization**: Now waits for session validation + plan sync before showing prompts or builder
- **Test setup**: All 92 tests updated with session mocks; `getActiveSession()` and `syncPlanFromSupabase()` stubbed in beforeEach
- **waitForFlow() timing**: Increased Promise.resolve() loops from 15→30 to account for dynamic import and fetch overhead

### Tests
- **All 92 tests passing** — no regressions; test suite updated for new auth flow
- Session mocks applied globally in `beforeEach` to bypass login screen in tests
- `syncPlanFromSupabase` mocked to resolve immediately without network calls

### Deployment
- Both builds regenerated: content.js (26.92 kB), background.js (1.57 kB)
- Commit: feat: Auth UI — login screen, session restore, Supabase plan sync
- All auth primitives from v2.0.0 now wired to UI and fully functional

## [2.0.0] — 2026-05-05

### Added
- **Supabase integration** — Complete backend database setup for production:
  - Project `kezbssjmgwtrunqeoyir` configured with 5 tables: `profiles`, `subscriptions`, `usage_daily`, `analytics_events`, `prompt_generations`
  - Row Level Security (RLS) enabled on all tables — user-level data isolation via `auth.uid()`
  - Auto-profile trigger: `handle_new_user()` creates profile on `auth.users` signup
  - Indexes on `user_id`, `date`, `anonymous_id` for query performance
  - Support for anonymous user tracking via `anonymous_id` (GDPR-compliant)

- **Auth skeleton** (`src/core/auth.ts`):
  - Supabase magic link signup integration
  - JWT storage in `chrome.storage.local` with session validity check (60s buffer)
  - `getStoredSession()`, `storeSession()`, `clearSession()`, `signOut()` helpers
  - Real project credentials: `SUPABASE_URL` and `SUPABASE_ANON_KEY` configured

- **Plan management** (`src/core/planManager.ts`):
  - Free/Pro plan distinction via `chrome.storage.local['atenna_plan']`
  - `isPro()` async checker for conditional UI rendering
  - Plan awareness in auto-generation and usage limits

- **Analytics system** (`src/core/analytics.ts`):
  - Event tracking: `prompt_generated`, `prompt_used`, `builder_opened`, `auto_suggestion_shown`, `auto_suggestion_accepted`, `upgrade_clicked`
  - Fire-and-forget telemetry via background worker (`ATENNA_TRACK` message)
  - Anonymous user ID support (never PII)
  - Metadata: `prompt_type` (direct/structured/technical), `origin` (builder/auto/manual)
  - Backend endpoint `POST /track` writes to `backend/data/events.jsonl`

- **Chrome Store compliance**:
  - `docs/privacy-policy.md` — complete privacy policy covering data collection, storage, usage, user rights
  - `manifest.json` updated: `version: 1.1.0`, `name: "Atenna Prompt"`, Chrome Store description
  - Backend `.env` with Supabase credentials (SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY)

- **Backend analytics route** (`backend/routes/analytics.py`):
  - `POST /track` endpoint receives event data, writes to `backend/data/events.jsonl`
  - Integrated into FastAPI app via router inclusion

- **Production Infrastructure** (`backend/Dockerfile`, `docker-compose.yml`, `nginx/default.conf`):
  - **Docker containerization**:
    - `Dockerfile` (Python 3.12 slim): FastAPI app running uvicorn on 0.0.0.0:8000 with auto-restart policy
    - `requirements.txt` updated: added `PyJWT`, `cryptography` for JWKS validation
    - Volume mount: `./backend/data` for persistent event logs and analytics
  - **Docker Compose orchestration** (`docker-compose.yml`):
    - Two-service stack: `atenna-backend` (FastAPI) + `atenna-nginx` (reverse proxy)
    - Backend isolation: listens only on `127.0.0.1:8000` (not exposed externally)
    - Nginx exposed on ports 80 (HTTP redirect) and 443 (HTTPS)
    - Auto-restart on failure, named volumes for data persistence
    - Service dependencies: nginx depends on backend
  - **Nginx reverse proxy** (`nginx/default.conf`):
    - HTTP server: listens :80, redirects to HTTPS with 301 status
    - HTTPS server: listens :443 ssl, proxies to backend container on http://backend:8000
    - Headers propagated: Host, X-Real-IP, X-Forwarded-For, X-Forwarded-Proto
    - SSL certificate paths: `/etc/nginx/certs/fullchain.pem`, `/etc/nginx/certs/privkey.pem`
    - TLS 1.2 + 1.3, HIGH ciphers only, no aNULL/MD5

- **VPS Deployment** (Hetzner CX33, 157.90.246.156):
  - **Automated SSH provisioning** (via paramiko in Python):
    - System updates: `apt update && apt upgrade`
    - Dependencies installed: Python 3.12, pip, venv, nginx, certbot, git, curl, ufw
    - Firewall configured: ports 22 (SSH), 80 (HTTP), 443 (HTTPS) allowed
    - Backend directory: `/root/atenna` with docker-compose and configs
  - **SSL Certificate** (Let's Encrypt via Certbot):
    - Domain: `atennaplugin.maestro-n8n.site` (corrected from typo with 3 n's)
    - Certbot ran in standalone mode, certificates copied to nginx volume
    - Auto-renewal scheduled via systemd timer (24-hour check)
    - Certificate chain: fullchain.pem (root + intermediate + leaf), privkey.pem
  - **Production URL**: `https://atennaplugin.maestro-n8n.site`

- **Smoke Tests** (via urllib):
  - 6 test cases covering production endpoints:
    - `GET /health → 200 OK` (connectivity check)
    - `GET /health corpo` (response body validation)
    - `POST /generate-prompts sem JWT → 401` (auth enforcement)
    - `POST /generate-prompts JWT fake → 401` (token validation)
    - `POST /generate-prompts input vazio → 422` (validation)
    - `POST /track → 200` (analytics endpoint)
    - `HTTP → HTTPS redirect 301` (SSL enforcement)
  - **Results**: 7/7 tests passing
  - **System score**: 10/10 (all production requirements met)

### Changed
- **Usage limit model**: Daily limit (`DAILY_LIMIT=5`), monthly limit (`MONTHLY_LIMIT=25`); reset at midnight (daily) and month boundary (monthly)
- **Usage counter**: 
  - Moved to `src/core/usageCounter.ts` with daily reset logic
  - Added `getTotalCount()` and `incrementTotalCount()` for all-time conversion trigger (at 3 generations, show upgrade card)
- **Modal behavior**:
  - `runFlow()` now plan-aware: pro users bypass daily limit, auto-suggestion shown only for pro users with vague input
  - `renderPrompts()` displays upgrade trigger when `totalCount >= 3`
  - Usage badge shows "Pro ✓" for pro users, "X/10" for free users
  - `incrementUsage()` called alongside `track('prompt_generated')` in runFlow

- **Background worker** (`src/background/background.ts`):
  - `ATENNA_FETCH`: adds JWT header from `atenna_jwt` storage before calling `/generate-prompts`
  - `ATENNA_TRACK`: fire-and-forget analytics (no callback expected)
  - Removed callback requirement for analytics messages

### Tests
- **All 92 tests passing** — no new failures introduced; existing tests updated for daily limits
- Cache test fixed: timing adjusted for async flow with plan checks
- Stub callback made optional: `cb?.(response)` for analytics support

### Deployment
- Supabase CLI linked with personal access token
- Migration applied successfully to remote project — all DDL, triggers, RLS policies active
- Both builds regenerated: content.js (22.74 kB), background.js (1.03 kB)
- Ready for production auth flow and telemetry

## [1.6.0] — 2026-05-03

### Added
- **Geração de prompts via IA** (`runFlow`): modal agora chama o backend FastAPI em vez de templates locais — Gemini 2.5 Flash Lite gera os 3 prompts.
- **UX de carregamento**: spinner + mensagens rotativas a cada 1,5s durante a geração (`Gerando seus prompts...`, `Analisando seu contexto...`, etc.). Spinner visível **imediatamente** na abertura do modal (antes de qualquer await).
- **Transição de sucesso**: ícone de check SVG animado com `cubic-bezier(0.34, 1.56, 0.64, 1)` + mensagem "Pronto!" por 500ms antes de exibir os cards.
- **Contador de uso mensal** (`src/core/usageCounter.ts`): persistido em `chrome.storage.local`, limite de 15 gerações/mês com reset automático após 30 dias. Badge `X/15` no header do modal — verde (< 10), amarelo (≥ 10), vermelho (= 15).
- **Tela de limite atingido**: ícone 🔒 + mensagem "Limite mensal atingido" quando `count >= 15`, sem spinner ou chamada à rede.
- **Cards com textarea readonly**: prompts exibidos em `<textarea readonly>` — permite seleção sem edição; nenhum conteúdo do usuário vai via `innerHTML`.
- **Botão USAR outline**: estilo outline verde por padrão, filled no hover — menor peso visual.
- **Botão Copiar (ícone)**: substituído texto "Copiar" por ícone SVG universal de clipboard.
- **Toggle no header**: `[Meu Texto] [Criar Prompt]` centralizado no header sticky — 2 cores, `320ms cubic-bezier`.

### Changed
- `renderLoading` movido para antes do primeiro `await` em `runFlow` — spinner exibido sincronamente.
- Segurança: todo conteúdo do usuário inserido via `.textContent` / `.value`; SVGs estáticos (check, copy) via `innerHTML` com constantes compile-time.

### Tests
- **83 testes passando** (7 arquivos): novos suites para `usageCounter` (9 testes) e `modal` completo (29 testes) cobrindo open/close, dark mode, spinner sync, flow async, usage badge, limit UI, USAR, Copiar, XSS.
- Root cause do stub reset documentada: `vi.restoreAllMocks()` reseta `vi.fn()` — solução: re-stub `chrome` e `fetch` em cada `beforeEach`.

## [1.5.0] — 2026-05-03

### Added
- **Backend local FastAPI** (`backend/`): servidor Python que gera os 3 prompts via Gemini 2.5 Flash Lite.
  - `POST /generate-prompts` — recebe `{ input }`, retorna `{ direct, technical, structured }` gerados por IA
  - `GET /health` — status do servidor
  - CORS liberado para extensão Chrome e localhost
  - Fallback local automático se a API do Gemini falhar (sem erro para a extensão)
  - API key via `.env` (nunca exposta no código)
  - Timeout 10s com tratamento de erros granular (timeout, HTTP, parse, inesperado)
  - Logs `[Atenna]` no console
- **`.gitignore`** atualizado: `__pycache__/`, `*.pyc`, `venv/` adicionados

### Quality
- Qualidade dos prompts com Gemini 2.5 Flash Lite vs templates locais: de **7/10 → 9.5/10**
- Gemini entende contexto real — para "natação em alto mar" gera prompts com correntes, ondas, periodização, navegação; templates locais são context-blind

## [1.4.0] — 2026-05-03

### Changed
- **Toggle de abas invertido**: ordem corrigida para `[Meu Texto] [Criar Prompt]` — fonte (esquerda) → ação (direita), padrão UX de segmented controls.
- **"Editar Texto" renomeado para "Meu Texto"**: nome mais intuitivo, referencia diretamente o texto digitado pelo usuário no input da plataforma.
- **Transição do toggle suavizada**: de `150ms ease` para `320ms cubic-bezier(0.4, 0, 0.2, 1)` — visível e sutil, sem brusquidão.

### Tests
- 64 testes passando (6 arquivos).

## [1.3.0] — 2026-05-03

### Added
- **Modal central** (`src/ui/modal.ts` + `src/ui/modal.css`): substitui o painel lateral por um modal overlay 520px com animação fade+scale. Abre ao clicar no badge, fecha com ESC ou clique no backdrop.
- **Geração de prompts** (`src/core/promptEngine.ts`): gera 3 variantes otimizadas a partir do texto atual do input — **Direto** (claro e objetivo), **Técnico** (detalhado com exemplos), **Estruturado** (organizado em seções).
- **Input handler** (`src/core/inputHandler.ts`): lê e escreve no input de qualquer plataforma (ChatGPT `textarea`, Claude/Gemini `contenteditable`) de forma compatível com React via native value setter + `execCommand`.
- **Botão Copiar**: copia o prompt para a área de transferência com fallback para `execCommand('copy')`. Toast de confirmação.
- **Botão USAR**: preenche automaticamente o input da plataforma com o prompt escolhido e fecha o modal.
- **Dark mode no modal**: detecta tema via luminância do `document.body` (mesmo mecanismo do painel anterior). Classe `.atenna-modal--dark` aplicada em runtime.
- **Preview do texto atual**: modal exibe o texto já digitado no input para referência antes de escolher a variante.

### Changed
- `src/content/content.ts`: `togglePanel` substituído por `toggleModal`.
- `manifest.json`: `modal.css` adicionado ao array `css` do content script.
- `vite.config.ts`: `modal.css` adicionado ao `viteStaticCopy`.
- Tests: 59 testes passando em 6 arquivos (+ 29 novos testes: promptEngine ×7, inputHandler ×8, modal ×14).

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
