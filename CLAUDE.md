# Atenna Guard Extension — CLAUDE.md

## Acesso à VPS
- Host: `157.90.246.156`  
- User: `root`
- Chave SSH: `C:\Users\dgapc\.ssh\ATENNAPLUGIN-DEPLOY`
- **NUNCA usar outra chave. NUNCA fazer push de .env ou chaves para o remoto.**
- Comando SSH: `ssh -i C:\Users\dgapc\.ssh\ATENNAPLUGIN-DEPLOY root@157.90.246.156`

## Supabase — Connection Direct
- Usar connection string direta para migrations e acesso admin:
  `postgresql://postgres:[SENHA]@db.[PROJECT_REF].supabase.co:5432/postgres`
- Senha do DB: definida em `backend/.env` como `SUPABASE_DB_PASSWORD` (NUNCA commitar)
- Para psql direto: `psql postgresql://postgres:[SENHA]@db.[REF].supabase.co:5432/postgres`
- MCP Supabase disponível para queries sem expor senha

## Builds
- **SEMPRE rodar os dois builds após qualquer mudança de código:**
  1. `npm run build` — gera `dist/` com content.js, background.js, manifest.json
  2. O usuário recarrega a extensão em `chrome://extensions`
- `dist/` é gitignored — nunca adicionar ao git
- Build order: generate-icons → vite (content) → vite popup → vite bg

## Testes
- Unitários front: `npx vitest run` (~314 testes, deve ser 0 falhas)
- Unitários backend: `pytest backend/` no container (harness FASE 9.0 = 68; total ~470)
- E2E: `npx playwright test --project=extension` — **T1–T8 + W1–W15 (23 testes, 0 skip)**.
  Precisa de `npx playwright install chromium` uma vez. `npm run test:e2e` faz build + localhost + run.
- E2E `api`: `npx playwright test --project=api` — bate no backend real (`api.atennaia.com.br`)
- E2E requer `dist/` atualizado — rodar `npm run build` antes
- E2E usa contexto persistente — testes compartilham estado, ordem importa

## Padrões Anti-Loop (erros que já aconteceram)

### 1. bffMe() não mockado em testes de modal
- `modal.ts` chama `bffMe()` de `src/auth/bffClient.ts`
- Testes DEVEM ter `vi.mock('../auth/bffClient', ...)` ANTES dos imports
- Sem esse mock, bffMe() faz fetch real e falha silenciosamente

### 2. generateFromBadge() vs toggleModal()
- `toggleModal()` abre modal com `autoGenerate=false` — NÃO dispara geração
- `generateFromBadge()` abre com `autoGenerate=true` — dispara geração
- Testes que esperam cards/skeleton DEVEM usar `generateFromBadge()`

### 3. openModal() é fire-and-forget para runFlow
- `runFlow()` é chamado com `void` — openModal() retorna ANTES de runFlow terminar
- Cache hit path também DEVE ser `void renderSuccess().then(...)` não `await`
- `waitForFlow()` = 30 microtasks → advanceTimersByTime(600) → 30 microtasks

### 4. Presidio — supported_language obrigatório
- Todos os PatternRecognizer DEVEM ter `supported_language="pt"`
- Sem isso, `get_recognizers(language="pt")` retorna vazio e nada é detectado
- Não herdar da classe base — declarar explicitamente em cada `super().__init__()`

### 5. CreditCardRecognizer — conflito com Presidio built-in
- Nossa classe se chamava `CreditCardRecognizer` — conflito com built-in do Presidio
- Renomeada para `BRCreditCardRecognizer`
- Qualquer nova recognizer: usar prefixo `BR` para evitar conflito

### 6. E2E — injectSession race condition
- `injectSession()` escreve no chrome.storage via service worker (async)
- Content script lê o storage ao carregar a página
- SEMPRE aguardar 300–500ms após `injectSession()` antes de `openFixturePage()`
- Exemplo: `await new Promise(r => setTimeout(r, 500));`

### 7. E2E — sessão fake basta (não valida no Supabase) — DESATUALIZADO/RESOLVIDO
- Histórico: o content script validava o JWT no Supabase → JWT falso → badge não aparecia.
- **Hoje (FASE 9.0):** `content.ts` `checkAuth()` só faz `await getSession()` do storage — não
  valida server-side. `injectSession()` do helper já é suficiente. T4–T8 reativados e passando.

### 8. NAME pattern — falsos positivos em texto técnico
- O NAME pattern detecta sequências de palavras em minúsculas como nomes
- Stopwords como "observer", "pattern", "typescript" devem estar em NAME_STOPWORDS
- Ao adicionar novo texto técnico que gera falso positivo, adicionar à lista em `src/dlp/patterns.ts`

### 9. admin/node_modules excluído do vitest
- `vitest.config.ts` deve incluir `'admin/node_modules/**'` em `exclude`
- Sem isso, vitest tenta rodar testes de deps do admin/ e falha

## Variáveis de Ambiente (NUNCA no git)
- `backend/.env` — contém senha do DB, SERVICE_ROLE key, JWT secret
- Chave de deploy SSH em `C:\Users\dgapc\.ssh\ATENNAPLUGIN-DEPLOY`
- SERVICE_ROLE key: NUNCA em logs, NUNCA em commits

## Deploy no VPS
- Container: `atenna-backend-backend-1`
- Restart: `ssh [KEY] root@157.90.246.156 "cd /root/atenna-backend && docker compose restart backend"`
- Logs: `docker compose logs -f backend --tail=50`
- Rebuild: `docker compose up --build -d backend`

## Fases Completas
- 4.6, 4.7, 5.1, 5.2, 5.3, 6.1, 6.2 — ver `docs/specs/SPEC_INDEX.md`

## Planos e Cotas
- **Free plan: 5 usos/dia** (não 10 — corrigir se encontrar 10 no código)
- Pro plan: sem limite (ou conforme definido no Supabase profiles.plan)
- Cota é validada server-side no BFF — nunca só no cliente

## Qualidade — NUNCA entregar sem isso

### REGRA CANÔNICA — padrão 9.5/10 em TODA tarefa (sem exceção)
Toda tarefa — por menor que pareça — passa por este ciclo **antes** de commit/push/deploy:
1. **Spec** — `docs/specs/FASE_X_*.md`: problema, decisões (tabela), arquivos, contrato, riscos, rollout.
2. **Harness + testes** — teste comportamental por feature; teste de regressão por bug (falha ANTES do fix);
   teste de bypass por regra de segurança. Rodar o harness e reportar o número real.
3. **Code review severo** — revisar com 3 chapéus e registrar os achados:
   - **Arquiteto sênior**: acoplamento, camadas, zero-trust, falha-fechado, o que quebra em produção.
   - **Product Owner**: o comportamento entregue é o que o usuário precisa? fricção proposital no free mantida?
   - **PM / Estrategista**: alinhado ao posicionamento (extensão = isca → Plataforma → Arckos)? não implementa o que já existe na Plataforma?
4. **Changelog enterprise** — `CHANGELOG.md`: o que era, o que quebrava, o que mudou, como foi validado, nº de testes.
5. Só então: **commit → push → deploy** (deploy do backend é na VPS; ver seção Deploy).

Nunca entregar “parece certo”. Nunca pular etapa “porque é pequeno”. Se o usuário pedir pressa,
fazer o ciclo mesmo assim e explicar o porquê.

### Antes de qualquer entrega de código
1. `npx vitest run` — 0 falhas (atualizar número no CLAUDE.md se mudar)
2. `npm run build` — build limpo sem erros
3. Reload manual da extensão e smoke test do fluxo principal
4. Para qualquer tela nova: abrir no Chrome e validar visualmente antes de reportar como pronto

### Para qualquer UX/UI front-end — 5 Leis de UX obrigatórias
1. **Lei de Fitts** — botões/links com padding generoso (mín. 44px de altura em mobile), nenhum alvo clicável abaixo de 32px
2. **Lei de Hick** — máximo 3–4 opções visíveis por vez; remova o que não é essencial; não mostre dois CTAs de mesmo peso
3. **Lei de Jakob** — siga convenções conhecidas: verde = sucesso, vermelho = erro, breadcrumb à esquerda, voltar = chevron/seta esquerda
4. **Lei de Miller** — agrupar info em chunks de ≤7 itens; nunca muro de texto; label sempre acima do input (não placeholder substituindo label)
5. **Lei de Proximidade** — erros inline junto ao campo que os causou; label colado ao input; CTA primário próximo ao último campo preenchido

### Padrão Anti Ping-Pong UI
- NUNCA usar `onclick=` ou `<script>` inline em páginas da extensão — viola CSP e bloqueia tudo
- TODO JS de páginas de extensão vai em arquivo `.ts` próprio compilado pelo Vite como IIFE
- NUNCA chamar Supabase diretamente da welcome/popup para auth — usar `bffClient.ts` (`bffLogin`, `bffGoogleLogin`, `bffResetPassword`)
- NUNCA confiar que "parece certo" — sempre testar o caminho crítico no Chrome antes de entregar

## Posicionamento Estratégico — CRÍTICO
- **Atenna Guard Extension ≠ Atenna Plataforma** — são produtos distintos
- A **extensão é uma isca (freemium)** para captar usuários e conduzi-los à esteira Arckos
- Governance Layer, Multi-tenant e features enterprise JÁ EXISTEM na Atenna Plataforma
- **NÃO implementar na extensão** o que já existe na plataforma — isso desvia da estratégia
- O fluxo de upsell é: Extensão (free/pro) → Atenna Plataforma → Arckos Enterprise
- Features da extensão devem ter fricção proposital no free para converter para pro/plataforma
