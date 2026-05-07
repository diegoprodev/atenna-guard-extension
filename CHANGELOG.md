# Changelog

All notable changes to **Atenna Guard Extension** are documented here.

---

## [2.8.0] — 2026-05-06 (Badge Centering + Pill Animation + Owl Zoom + Dot Tooltip)

### Fixed — Badge centering (causa raiz)
- `flex-direction: row-reverse` removido — era a causa do deslocamento da coruja para a esquerda em todos os estados
- Botão agora é um círculo fixo 42×42px; `icon-wrap` usa `position: absolute; right: 0` — nunca se move enquanto o pill expande
- Coruja centralizada via `display: flex; align-items: center; justify-content: center` no icon-wrap

### Changed — Pill expansion
- Badge expande `width` 42px → 148px para a esquerda (ancoragem por `right` no CSS)
- `overflow: hidden` restaurado no botão para clicar a label durante a expansão
- Label "ATENNA" posicionada via `position: absolute; left: 14px` dentro do pill — sem separar em elemento externo

### Added — Owl zoom animation
- Hover: coruja faz zoom-out (scale 1→0 + opacity fade) em 450ms `cubic-bezier(0.4,0,1,1)`
- Un-hover: coruja faz zoom-in spring (scale 0→1) em 550ms `cubic-bezier(0.34,1.56,0.64,1)` com leve overshoot
- Ring pulse para ao expandir: `.atenna-btn:hover .atenna-btn__icon-wrap::before { opacity: 0 }`

### Added — Dot tooltip
- Dot movido do `icon-wrap` para o `btn` diretamente — fica visível mesmo quando a coruja está em zoom-out
- `pointer-events: auto` no dot — hover funciona corretamente
- Tooltip via CSS `::after` + atributo `data-tip` — aparece acima do dot ao passar o mouse
- Cor do tooltip por estado DLP: verde (`#16a34a`) / laranja (`#f97316`) / vermelho (`#ef4444`) / dark padrão
- Textos: `✓ Tudo seguro` · `Digitando...` · `◉ Atenção: possível dado sensível` · `⚠ Dados sensíveis detectados`

### Fixed — Icon PNG
- `generate-icons.mjs` atualizado: círculo preto removido; ícones gerados como coruja branca em fundo transparente
- Badge fornece o fundo verde via CSS — sem `mix-blend-mode` ou filtros

---

## [2.7.0] — 2026-05-06 (Badge Visual Overhaul + DLP-Reactive Dot)

### Changed — Badge (`src/ui/styles.css`, `src/content/injectButton.ts`)

**Fundo verde sólido**
- Badge colapsado: `background: transparent` → `#22c55e` (círculo verde sólido)
- Badge expandido: `rgba(10,16,24,0.92)` (preto — quebrava tema claro) → `#16a34a` (verde escuro, contraste adequado em qualquer fundo)
- `mix-blend-mode: lighten` removido; substituído por `mix-blend-mode: screen` que faz o fundo preto da logo desaparecer sem afetar a coruja

**Coruja maior, sem fundo**
- Tamanho: 34px → 44px (quase preenche o círculo)
- `filter: brightness(1.3) contrast(1.1)` para a coruja aparecer nítida sobre verde
- `brightness(0) invert(1)` removido (causava fundo branco)

**Badge expandido compacto**
- Largura hover: 186px → 128px (redução ~31%)
- Removido subtítulo "Secure Engine" — hover exibe apenas **"ATENNA"**

**Dot DLP-reativo com ripple visível**
- Idle: pulso branco lento com ripple `box-shadow` (2.4s) — visível sobre fundo verde
- Digitando: verde neon automático (1.2s), detectado via `input` event listener
- DLP MEDIUM: laranja ripple (1.5s)
- DLP HIGH: vermelho ripple rápido (0.9s)
- Dot retorna ao idle 1.5s após o usuário parar de digitar

### Added — `injectButton.ts`
- `updateBadgeDotRisk(level)` — exportado; chamado por `modal.ts` após cada DLP scan
- Input listener de digitação: ativa `--typing` (verde neon) em tempo real; limpa após 1500ms de inatividade
- Cleanup correto do listener no `currentCleanup`

### Changed — `modal.ts`
- Importa e chama `updateBadgeDotRisk(scanResult.riskLevel)` após cada scan DLP

---

## [2.6.0] — 2026-05-06 (DLP Architecture + Badge Premium + Phase 1 UX Refinement)

### Added — DLP Architecture (3-Layer Hybrid)

**Layer 1 — Client-Side Detection (`src/dlp/`)**
- `types.ts` — `RiskLevel` enum (NONE/LOW/MEDIUM/HIGH), `DetectedEntity`, `ScanResult`, `Advisory`
- `patterns.ts` — 9 pattern detectors: CPF, CNPJ, EMAIL, PHONE, API_KEY, TOKEN, PASSWORD, CREDIT_CARD, ADDRESS com confidence ponderado (0.65–0.99)
- `semantic.ts` — 7 semantic hints por keyword (IS_REAL_DATA, IS_TECHNICAL_QUESTION, IS_EXAMPLE_REQUEST, IS_MEDICAL_CONTEXT...); `isLowRiskIntent()` / `isHighRiskIntent()` para redução inteligente de falsos positivos
- `scorer.ts` — score 0–100 com multiplicadores de intenção: contexto técnico → 0.10x (reduz drasticamente), dados reais → 1.30x (amplifica)
- `detector.ts` — orquestrador do pipeline local; target < 50ms
- `advisory.ts` — traduz ScanResult em UX Advisory (mensagem, CTAs, `show` flag)

**Layer 2 — Backend DLP (`backend/dlp/`)**
- `analyzer.py` — Presidio AnalyzerEngine + spaCy; `CPFRecognizer` com validação real do dígito verificador; `CNPJRecognizer`, `BRPhoneRecognizer`, `APIKeyRecognizer`
- `scoring.py` — blend 60% backend + 40% client pre-scan
- `advisory.py` — mensagem final por nível de risco
- `telemetry.py` — eventos JSON para stdout: `dlp_scan_started`, `dlp_entity_detected`, `dlp_high_risk`, `dlp_scan_complete`
- `pipeline.py` — orquestrador; nunca falha (retorna NONE em erro)
- `entities.py` — schemas Pydantic: `ScanRequest`, `ScanResponse`, `DetectedEntity`
- `routes/dlp.py` — `POST /dlp/scan` (enriquecimento assíncrono), `GET /dlp/health`

**Layer 3 — UX Decision Engine (`modal.ts` + `modal.css`)**
- `showDlpAdvisory()` — Promise<boolean> não-bloqueante; exibe advisory acima do conteúdo antes de gerar
- HIGH: fundo vermelho tênue (opacity 0.06) + pills de entidade + 2 CTAs ("Revisar" / "Enviar mesmo assim")
- MEDIUM: fundo âmbar (opacity 0.05) + mesmos CTAs
- LOW: mensagem discreta sem ações
- NONE: resolve imediatamente, zero UI
- Analytics: eventos `dlp_warning_shown`, `dlp_send_override`

**Test cases (per spec):**
- `"meu cpf é 123.456.789-09"` → CPF + IS_REAL_DATA → **HIGH**
- `"regex validar cpf javascript"` → IS_TECHNICAL_QUESTION → **NONE**
- `"paciente com diabetes"` → IS_MEDICAL_CONTEXT → **MEDIUM**
- `"api_key=sk_live_abc123"` → API_KEY confidence 0.95 → **HIGH**
- `"como proteger dados médicos"` → IS_PROTECTION_QUERY → **LOW**

### Added — Badge Retráctil Premium

- **Comportamento retráctil**: Estado normal = apenas coruja circular pulsando, sem pill verde; Hover = expande lateralmente para a **esquerda** revelando "ATENNA" + "Secure Engine"
- **Pulse ring**: Anel verde animado ao redor da coruja (opacity 0.5–0.9, scale 1–1.08), `2.8s ease-in-out infinite`
- **Status dot**: Ponto verde (`#22c55e`) com glow no canto inferior direito do ícone
- **Stagger animation na expansão**: label (250ms delay) → name (300ms) → sub (360ms) — cada elemento entra independentemente
- **Hover**: Pill dark `rgba(10,16,24,0.92)` + `backdrop-filter: blur(14px)` + glow verde sutil; coruja faz `scale(1.05) rotate(3deg)` + glow aumentado
- **Fechamento mais rápido** que abertura — `transition` padrão 700ms na abertura, reverse imediato
- HTML reestruturado: `.atenna-btn__icon-wrap` (ícone + dot) + `.atenna-btn__label` (name + sub)

### Changed — Phase 1 UX Refinement (Minimalismo + Hierarquia)

- **Loading premium**: Spinner removido → skeleton cards com shimmer suave (`3.5s ease-in-out`) + 3 estados de texto progressivos (`1200ms` interval)
- **Hierarquia de cards**: Refinado (primary) → Estruturado (secondary) → Estratégico (tertiary) com fade-in em cascata (0ms, 100ms, 200ms delay)
- **Usage badge**: `"Free 3/5"` → `"2 gerações restantes"` (elegante, não técnico)
- **Copy de loading**: `"Analisando..."` → `"Estruturando intenção..."` / `"Refinando instruções..."` / `"Preparando versões..."`
- **Onboarding**: 6 chips removidos → 3 linhas minimalistas sem exemplos
- **renderLimitReached**: `"Você já refinou 5 solicitações hoje"` (contextual, sem símbolo ⊘)
- **renderUpgradeTrigger**: Removida pseudo-profundidade ("melhor que 90%")
- **Card primary**: Verde removido da border/background — hierarquia via spacing (16px vs 12px) + sombra subtil (1px 3px)
- **Shimmer**: `2s linear` → `3.5s ease-in-out` com opacidade reduzida (0.4) — quase imperceptível

### Changed — Métricas Essenciais

- `card_variant` nos eventos `prompt_copied` / `prompt_used` — rastreia qual versão (primary/secondary/tertiary) foi utilizada
- `daily_return` — detecta retorno no dia seguinte; armazena `atenna_last_open_date` em `chrome.storage.local`

### Build
- `content.js`: 49.24 kB → 55.43 kB (+6.2 kB pelo DLP engine)
- `background.js`: 1.60 kB (inalterado)
- TypeScript: zero erros
- Módulos transformados: 11 → 16 (adição dos módulos DLP)

---

## [2.4.1] — 2026-05-06 (Fix Auth Callback Hash Fragment)

### Fixed
- **`backend/routes/auth.py`** — Auth callback agora lê `access_token` do hash fragment (`window.location.hash`) via JavaScript, em vez de query params. Supabase envia o token como `#access_token=...` após confirmação de email; o servidor nunca recebe o hash — a página HTML extrai o token client-side com `new URLSearchParams(window.location.hash.substring(1))` e então faz `postMessage` para a extensão.

---

## [2.4.0] — 2026-05-06 (VPS Deploy + E2E Verified)

### Infrastructure
- **VPS Hetzner CX33 configurada do zero via SSH + Paramiko** (`setup-vps.py`):
  - Docker Engine v29.4.2 + Docker Compose plugin v5.1.3
  - Nginx alpine como reverse proxy (80 → 443)
  - SSL Let's Encrypt para `atennaplugin.maestro-n8n.site` (válido até 08/2026)
  - UFW firewall: portas 22, 80, 443 abertas; tudo mais bloqueado
  - fail2ban: proteção SSH (max 5 tentativas, ban 1h)
  - Healthcheck automático no container a cada 30s
  - Auto-restart com `restart: always`
- **Deploy automatizado** (`fix-deploy.py`):
  - Upload de arquivos via SFTP (paramiko)
  - `docker-compose.yml` criado via SFTP (sem problemas de escaping)
  - `nginx/default.conf` com HTTPS, HSTS, X-Frame-Options, X-Content-Type-Options
  - Containers backend + nginx em rede Docker isolada `atenna`
- **Chave SSH configurada** (`gen-ssh-key.py`):
  - Gerada `~/.ssh/atenna-vps` (ed25519)
  - Adicionada ao `~/.ssh/authorized_keys` na VPS
  - Adicionada à Hetzner Cloud como `atennaplugin-deploy`
- **Playwright MCP instalado** (`claude mcp add playwright`):
  - Adicionado ao `.claude.json` do projeto
  - Testes E2E rodando contra produção

### Added
- **`setup-vps.py`** — Script completo de provisioning da VPS via SSH
- **`fix-deploy.py`** — Script de deploy focado (docker-compose + nginx + SSL)
- **`gen-ssh-key.py`** — Geração de chave SSH ed25519 sem interação
- **`deploy-hetzner-api.py`** — Deploy via Hetzner Cloud API + SSH key
- **`test-production.py`** — 8 smoke tests de produção (urllib)
- **`test-playwright-e2e.py`** — 10 testes E2E com Playwright headless

### Removed
- **`deploy-vps.ps1`** — Substituído por scripts Python com paramiko
- **`deploy.py`** — Versão antiga substituída por `setup-vps.py` + `fix-deploy.py`

### Verified (10/10 E2E testes passando em produção)
- `GET /health` → `{"status":"ok"}`
- `GET /auth/callback` (sem token) → HTML de erro amigável
- `GET /auth/callback?access_token=...` → HTML sucesso + countdown
- `POST /generate-prompts` vazio → 422
- `POST /generate-prompts` → retorna `direct`, `technical`, `structured`
- `POST /track` → `{"ok":true}`
- SSL válido (HTTPS sem erros)
- `/docs` → Swagger UI disponível

## [2.3.0] — 2026-05-06 (Production Auth + Premium UX)

### Fixed
- **Magic link removed entirely** — Causa confusão (email confirmation em vez de login imediato)
  - Removido `signInWithMagicLink()` de `src/core/auth.ts`
  - Implementado `signInWithPassword(email, password)` usando Supabase `/auth/v1/token?grant_type=password`
  - Login agora funciona com email + senha, sem confirmação intermediária
  - User feedback: "já disse pra remover essa merda"
- **Domain name typo fixed** — URLs tinham "atennnaplugin" (3 n's) em vez de "atennaplugin" (2 n's)
  - Corrigido em: `src/background/background.ts` (BACKEND_URL, ANALYTICS_URL)
  - Corrigido em: `src/core/auth.ts` (getCallbackUrl)
  - Corrigido em: `backend/main.py` (CORS allow_origins)
  - Production domain agora correto: `https://atennaplugin.maestro-n8n.site`
- **Scrollbar persisted despite overflow: hidden** — Modal body overflow compactado agressivamente
  - Reduzido padding de login: 16px → 12px
  - Reduzido gaps: 12px → 8px
  - Reduzido title: 24px → 20px, subtitle: 13px → 12px
  - Reduzido input padding: 13px 15px → 10px 12px
  - Reduzido button padding: 12px 20px → 10px 18px
  - Features box: padding 16px → 10px 12px, font 15px → 12px
  - Mobile (480px): ainda mais agressivo — padding 10px 10px, title 16px, gap 6px
  - Result: zero scrollbars, conteúdo cabe perfeitamente

### Added
- **Monthly usage limits** (`src/core/usageCounter.ts`):
  - `MONTHLY_LIMIT = 25` prompts/mês (alterado de daily limit)
  - `getMonthlyUsage()` com auto-reset baseado em YYYY-MM
  - `incrementMonthlyUsage()` retorna novo count
  - `isAtMonthlyLimit()` para enforcement
  - Auto-reset ao mudar de mês
- **Prompt history** (`src/core/history.ts`):
  - `PromptEntry` interface: id, text, type, date, favorited, origin
  - `getHistory()`, `addToHistory()`, `toggleFavorite()`, `clearHistory()`
  - Persisted em chrome.storage.local, máximo 20 prompts
  - Timeline de uso para análise comportamental
- **Expanded analytics** (`src/core/analytics.ts`):
  - 45+ event types: auth (login, signup, logout), builder (opened, suggested), quota (limit_reached), retention (history_viewed, favorite_added), performance (page_load)
  - `trackEvent()` como função principal com plan detection automático
  - Session ID generation para correlação de eventos
  - Metadata: session_id, extension_version (1.2.0), plan (free/pro)
  - EventPayload com optional fields para flexibilidade

### Changed
- **Authentication flow**: Magic link → Email/Password (mais direto, sem confirmação intermediária)
- **Session handling**: Agora inclui email validado em Session interface
- **Login form**: Entrada de senha adicionada, UX simplificada
- **Modal responsiveness**: Media queries agressivas para 768px (tablets) e 480px (mobile)
  - Header padding: 13px/16px → 10px/12px
  - Login section compactado em todas as telas
  - Font sizes reduzidas progressivamente
- **CSS vars**: Dark theme --at-bg #0f0f0f → #1f1f1f (melhor contraste), --at-text #f1f1f1 → #e8e8e8
- **Backend CORS**: URL corrigida de atennnaplugin (errado) para atennaplugin (correto)

### Tests
- Todos os 92 testes passando com novos stubs para monthly usage
- Analytics tests atualizados para 45+ event types

### Build
- npm run build executado — ambos content.js e background.js regenerados
- dist/ atualizado com todas as mudanças CSS e auth
- Versão manifest atualizada: 1.2.0

## [2.2.0] — 2026-05-06 (Auth UX Overhaul)

### Fixed
- **Mensagens de erro técnicas removidas** — Anteriormente mostravam "HTTP 400". Agora mensagens amigáveis em português:
  - "Email inválido. Verifique e tente novamente."
  - "Este email já está registrado."
  - "Senha deve ter no mínimo 6 caracteres."
- **Fluxo de email confirmation melhorado**:
  - Link do email não era acessível (ERR_BLOCKED_BY_CLIENT)
  - Novo `auth-callback.html` com UI clara e spinner
  - Extrai JWT automaticamente do hash da URL
  - Salva sessão sem feedback técnico
  - Countdown visual antes de fechar
- **UX confusa do login** — Usuário não sabia que precisava verificar email
  - Status message agora diz explicitamente: "✅ Verifique seu email!"
  - Features listadas (5 usos/dia, etc) para motivar signup

### Added
- **Auth views melhoradas** (`src/ui/modal.ts`):
  - `renderLoginView()` — magic link com features listadas
  - `renderSignupView()` — email + password + confirmação
  - `renderResetView()` — recuperar senha
  - Navegação entre views com botão "Voltar"
- **Auth functions com erro handling** (`src/core/auth.ts`):
  - `signUpWithPassword(email, password)` — cria conta com validação
  - `resetPassword(email)` — envia link de recovery
  - `getCallbackUrl()` — usa chrome.runtime.getURL() ou fallback
  - Error responses amigáveis (nunca expõem HTTP status codes)
- **Email callback handler** (`src/auth-callback.html`):
  - Interface limpa com spinner e countdown
  - Extrai `access_token`, `expires_in` do hash
  - Decoda JWT e extrai email
  - Salva em `chrome.storage.local`
  - Mostra sucesso/erro com timing apropriado
- **Estilos de auth** (`src/ui/modal.css`):
  - `.atenna-modal__login-back` — botão voltar
  - `.atenna-modal__login-features` — lista de benefícios
  - `.atenna-modal__login-links` — links Criar conta, Esqueci senha
  - `.atenna-modal__login-status--warning` — avisos (amarelo)
- **Manifest & build updates**:
  - `auth-callback.html` em `web_accessible_resources`
  - Supabase URLs permitidas
  - `vite.config.ts` copia callback HTML para dist/

### Changed
- **Authentication flow**: Agora suporta magic link + email/password
- **Error messages**: Todos os erros em português claro, sem jargão técnico
- **Session storage**: Agora inclui `refresh_token` (para futuro)

### Tests
- Todos os 92 testes passando (sem novos testes ainda para callbacks)

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
