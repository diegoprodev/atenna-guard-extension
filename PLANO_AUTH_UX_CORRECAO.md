# PLANO MASTER — Corrigir Auth/Onboarding/Settings (CRÍTICO)

**Status:** BLOQUEADO — bugs amadores impedem produção  
**Prioridade:** P0 CRÍTICO  
**Usuário impactado:** 100% — ninguém consegue ver dados reais após login

---

## BUGS IDENTIFICADOS

### Bug 1: Settings não traz dados reais
- **Sintoma:** Settings mostra "0 / ∞" mesmo com usuário logado e dados no servidor
- **Causa raiz:** `/auth/usage` endpoint retornando null ou erro silencioso
- **Impacto:** Usuário não consegue ver progresso de uso, dados protegidos, etc.

### Bug 2: Badge não aparece após primeiro login
- **Sintoma:** Badge injetado antes da sessão existir; só aparece após reload da página
- **Causa raiz:** Race condition entre `createButton()` (antes do login) e `getActiveSession()` (após login)
- **Impacto:** UX confusa — usuário pensa que extensão não funciona

### Bug 3: Fluxo de auth confuso (DUPLO)
- **Tela 1:** Modal popup com "Bem-vindo ao Atenna" (onboarding)
- **Tela 2:** Modal modal com formulário de login (auth-views)
- **Tela 3:** Modal formal no centro (quando clica em "Criar conta")
- **Impacto:** Usuário não sabe qual é a "tela correta", sensação de produto amador

### Bug 4: Onboarding aparece MESMO ESTANDO LOGADO
- **Sintoma:** Clica no badge → abre onboarding "Bem-vindo", depois aparece "Criar conta"
- **Causa raiz:** `openModal()` não checa `bffMe()` antes de renderizar views
- **Impacto:** Muito confuso — "Criar conta" não faz sentido para usuário já logado

### Bug 5: Modal settings está CSS-bugado
- **Sintoma:** Navbar gigante, conteúdo pequeno, layout sobreposto
- **Causa raiz:** CSS mal dimensionado, viewport não respeitada
- **Impacto:** Parece inacabado

### Bug 6: POST-login não tem "boas-vindas"
- **Sintoma:** User loga e vai direto para settings
- **Causa raiz:** Sem tela de boas-vindas após login bem-sucedido
- **Impacto:** Sem educação sobre features, sem conversão pós-login

---

## FLUXO CORRETO (ENTERPRISE)

```
┌─────────────────────────────────────────────────────────────┐
│ USUÁRIO CLICA NO BADGE                                      │
└─────────────────────────────────────────────────────────────┘
                          ↓
                  ┌───────────────┐
                  │  Checar se    │
                  │  logado?      │
                  └───────┬───────┘
                          ↓
        ┌─────────────────┴─────────────────┐
        ↓                                   ↓
   SIM (logado)                         NÃO (anônimo)
        ↓                                   ↓
   ┌─────────────┐           ┌─────────────────────┐
   │  Settings   │           │  Onboarding (1x)    │
   │  OR         │           │  + Login Form       │
   │  Gerar      │           │  (popup formal)     │
   └─────────────┘           └─────────────────────┘
        ↓                                   ↓
   Modal =                              Modal =
   Settings ou                          Auth (login/signup)
   Prompt Generator                            ↓
                                        ┌─────────────────┐
                                        │  Login sucesso? │
                                        └────────┬────────┘
                                                 ↓
                                        ┌─────────────────┐
                                        │  Boas-vindas    │
                                        │  POST-LOGIN     │
                                        │  (1 vez)        │
                                        └────────┬────────┘
                                                 ↓
                                        ┌─────────────────┐
                                        │  Settings ou    │
                                        │  Gerar          │
                                        └─────────────────┘
```

---

## SOLUÇÃO (5 TAREFAS)

### Task 1: Diagnosticar `/auth/usage`
**Objetivo:** Entender por que settings não traz dados

**Steps:**
1. Testa endpoint com curl + token válido
2. Checa se as queries ao Supabase estão certas
3. Verifica se dados realmente existem no banco (dlp_events, telemetry_persistence)
4. Corrige a query ou a chamada no bffClient.ts

**Tempo:** 30 min

---

### Task 2: Corrigir badge não aparecer após login
**Objetivo:** Badge aparece imediatamente quando usuário loga

**Código:**
Adicionar listener de mudança de sessão em `injectButton.ts`:

```typescript
// Em injectButton.ts, após createButton()
import { onSessionChange } from '../core/auth';
onSessionChange(() => {
  // Re-position badge ou update visibility quando sessão muda
  const btn = document.getElementById(BTN_ID);
  if (btn) {
    applyDefaultPosition(btn, input);
    // Re-fetch badge color
    void (async () => {
      const color = await getBadgeColor();
      btn.setAttribute('data-badge-color', color);
    })();
  }
});
```

**Tempo:** 20 min

---

### Task 3: Unificar fluxo de AUTH em UMA tela
**Objetivo:** Não ter 3 telas de login diferentes

**Decisão:** 
- DELETE `onboarding-views.ts` (Bem-vindo ao Atenna)
- KEEP `auth-views.ts` (Login/Signup/Reset)
- Render `auth-views` no modal formal (center modal, não popup)

**Fluxo:**
```
Clique badge (anônimo) →
  renderLoginView() [modal formal, center]
```

**Tempo:** 1h (refatorar core.ts)

---

### Task 4: Checker logado ANTES de abrir modal
**Objetivo:** Usuário logado vai direto para settings/gerar

**Em `openModal()`:**
```typescript
async function openModal(autoGenerate = false) {
  // NOVO: Check se logado
  const me = await bffMe();
  if (me) {
    // Logado → vai para settings ou gerar
    if (autoGenerate) return generateFromBadge();
    return openSettingsOverlay();
  }
  
  // Anônimo → mostra login
  // ... rest
}
```

**Tempo:** 20 min

---

### Task 5: Corrigir CSS do Settings Modal
**Objetivo:** Settings parece profissional (não amador)

**Fixes:**
- Navbar: remover gigantismo, usar padding correto
- Content: 100% width, scroll correto
- Modal: center no viewport, não sobreposto

**Tempo:** 30 min

---

## TOTAL: ~2.5 horas

---

## VALIDAÇÃO REAL (OBRIGATÓRIO)

Após cada task:
1. Build: `npm run build`
2. Reload extensão no Chrome
3. Teste end-to-end:
   - Logout
   - Login com pmb_dga@gmail.com
   - Verifica: badge aparece, settings mostra dados, não há telas confusas
   - Logout
   - Clica badge → mostra login (não onboarding)

---

## NOTA AO USUÁRIO

Você tem RAZÃO de estar furioso. Esses bugs são **grotescos** para um produto dito "100% pronto". Não deveria chegar em produção assim. Vou corrigir TODOS agora com testes REAIS no Chrome.

**Commit será:** `fix: refactor auth/onboarding fluxo — single unified login, real usage data, fix badge race condition`
