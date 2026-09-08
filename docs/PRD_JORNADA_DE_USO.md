# PRD — Jornada de Uso · Atenna Safe Prompt

> Documento de produto. Descreve a jornada do usuário na **extensão** (Chrome MV3),
> ponta a ponta: da descoberta à desinstalação. Fonte da verdade pra decisões de
> UX, priorização e métricas. Não descreve arquitetura (ver `docs/SYSTEM_STATE.md`)
> nem specs de implementação (ver `docs/specs/`).

**Versão do produto:** 2.3.0 · **Última revisão:** 2026-09-08

---

## 1. O que é / pra quem

**Atenna Safe Prompt** é uma extensão de navegador que, nas plataformas de IA
(ChatGPT, Claude, Gemini, Perplexity):

1. **Protege dados sensíveis** — escaneia o que você vai enviar e avisa/reescreve
   PII (CPF, CNPJ, e-mail, telefone, cartão, chave de API, dados médicos/jurídicos…)
   **antes** de sair pro LLM.
2. **Melhora o prompt** — a "varinha" gera 3 versões do seu texto (direto, técnico,
   estruturado).

A validação de PII e a cota são **sempre revalidadas no servidor** (zero-trust): o
cliente sugere e exibe, o backend decide.

### Personas

| Persona | Contexto | Dor | O que a extensão entrega |
|---|---|---|---|
| **Profissional autônomo / PME** (advogado, contador, consultor) | Usa ChatGPT no dia a dia, cola documento de cliente | Medo de vazar dado de cliente → LGPD, multa, quebra de sigilo | Aviso automático + reescrita com 1 clique |
| **Funcionário de empresa sem política de IA** | Usa IA "por fora", sem ferramenta corporativa | Não sabe o que pode/não pode colar | Rede de segurança silenciosa |
| **Power user de prompt** | Escreve prompts longos o dia todo | Retrabalho pra estruturar o prompt | Varinha gera 3 variações |

> **Posicionamento:** a extensão é a **isca freemium** da esteira
> Extensão → Atenna Plataforma → Arckos Enterprise. Governança, multi-tenant e
> features enterprise **não** entram aqui — ficam na Plataforma. A fricção no plano
> free é proposital (converter pra Pro/Plataforma).

---

## 2. Mapa da jornada

```
DESCOBERTA ──▶ INSTALAÇÃO ──▶ ONBOARDING ──▶ 1º USO NA IA ──▶ USO RECORRENTE ──┐
   (CWS)         (1 clique)     (welcome)     (badge)          (DLP + varinha)  │
                                                                               │
        ┌──────────────────────────────────────────────────────────────────────┘
        ▼
  BATE NA COTA (5/dia) ──▶ UPSELL ──▶ CHECKOUT PRO ──▶ USUÁRIO PRO
        │                                                    │
        ▼                                                    ▼
  CONTINUA FREE                                    LGPD (exportar / excluir dados)
        │                                                    │
        └───────────────────────▶ DESINSTALAÇÃO ◀────────────┘
                                   (feedback)
```

---

## 3. Jornada detalhada

### 3.1 Descoberta → Instalação

| Passo | O que acontece | Onde |
|---|---|---|
| Acha na Chrome Web Store | Listagem "Atenna Safe Prompt", categoria Privacy & Security | CWS |
| Clica "Usar no Chrome" | Instala. `chrome.runtime.onInstalled` dispara | — |
| **Abre a welcome automaticamente** | Nova aba `welcome.html` | `background.ts` |

**Requisito:** a listagem tem que refletir a versão MAIS RECENTE (screenshots
1280×800, summary ≤132 chars, sem superlativo). Ver
`memory/chrome-web-store-boas-praticas`.

### 3.2 Onboarding (welcome.html)

Tela dividida: **hero à esquerda** (proposta de valor + logos das 4 plataformas)
· **formulário à direita** (abas Login / Criar conta).

| Caminho | Passos | Resultado |
|---|---|---|
| **Criar conta (e-mail)** | nome + e-mail + senha (≥8) → "Criar conta grátis" | **auto-login** — cai logado direto (FASE 10 O1). Fallback manual se o auto-login falhar |
| **Criar conta / Login (Google)** | botão "Entrar com Google" → `chrome.identity.launchWebAuthFlow` → consentimento Google → volta logado | mesma rota cria-ou-loga |
| **Login (e-mail)** | e-mail + senha → "Entrar" | logado |
| **Esqueci a senha** | e-mail → link enviado | tela de confirmação |

**Pós-login:** tela de sucesso com **links diretos pras 4 plataformas de IA**. O
usuário clica numa → vai pra lá com a sessão já ativa.

**Erros tratados na tela** (nunca só no console): credencial inválida, e-mail já
cadastrado, rede fora, Google cancelado.

### 3.3 Primeiro uso na plataforma de IA — o badge

Ao abrir/entrar em `chatgpt.com`, `claude.ai`, `gemini.google.com` ou
`perplexity.ai` **logado na Atenna**:

- O **badge** (coruja Atenna) injeta ancorado acima do campo de texto.
- Se o campo ainda não existe (usuário não logou na plataforma): aparece um
  **badge de espera** no canto — só abre o modal, sem as ações que dependem de
  input real. Vira o badge completo assim que o campo aparece.
- Injeção com **retry curto (10s)** — não depende de mutação do DOM (FASE B13.1).

**Estado do badge:** um "dot" sempre visível mostra o risco DLP em tempo real
(nada / baixo / médio / alto). Hover → barra de ações: abrir modal · varinha ·
analisar arquivo · configurações.

### 3.4 Uso recorrente — proteção de dados (DLP)

```
usuário digita no campo da IA
        │  (debounce 400ms)
        ▼
scan local (<50ms, não bloqueia)  ──▶  atualiza o dot do badge
        │
        ├─ risco NONE/LOW  ──▶  nada
        │
        └─ risco HIGH  ──▶  BANNER "Dados sensíveis detectados (N)"
                             · lista os tipos (CPF · E-mail · Telefone…)
                             · [Proteger dados]  → reescreve com tokens ([CPF], [NOME]…)
                             · [Enviar original] → dispensa
                                     │
                            após proteger: [Reverter] por 15s (texto original só em memória)
```

Quando o usuário manda o prompt de verdade, o **servidor revalida** a PII. Se o
cliente mentiu (`dlp_risk_level` forjado) e `STRICT_DLP_MODE` está ligado, o
servidor **reescreve** antes de repassar ao LLM.

**Alerta automático** é ligado por padrão; pode desligar em Configurações (aí o
banner só aparece ao clicar no badge).

### 3.5 Uso recorrente — a varinha (gerar prompt)

| Gatilho | Comportamento |
|---|---|
| Campo tem <10 chars | Tooltip "Digite algo no campo de texto primeiro" (dica visível, não `title` nativo) |
| Campo tem conteúdo | Gera 3 cards: **direto · técnico · estruturado** (~8s) |
| Conteúdo idêntico ao da última geração | Pergunta "é o mesmo conteúdo?" antes de regenerar (não gasta cota à toa) |
| Modal de geração | Abre **imediato** (sem lag de ~3s — FASE 10.9.6) e mostra skeleton enquanto gera |

Estilo de geração pela varinha é configurável (perguntar / sempre direto / etc.).

### 3.6 A cota (fricção proposital do free)

| Plano | Limite | Enforce |
|---|---|---|
| **Free** | **5 gerações/dia**, 25/mês | Servidor (BFF `dlp.rate_limit` → HTTP 429). Cliente também conta (cosmético). Limpar `chrome.storage` **não** libera nada. |
| **Pro** | Sem limite prático (teto anti-abuso de 12/hora por conta + 1 IP simultâneo) | `enforce_pro_limits` |

A cota é ancorada no fuso **America/São_Paulo** (não meia-noite UTC — FASE 10.9.5).

**Ao bater o limite:** a geração falha com mensagem clara + **CTA de upgrade**.
O contador "Hoje: X/5" fica visível no modal.

### 3.7 Upsell → Checkout Pro

| Passo | O que acontece |
|---|---|
| Usuário FREE abre o modal | Vê o bloco de upsell (usuário PRO **não** vê — contraprova em teste F6/F7) |
| Clica "Assinar Pro" | Modal de planos: **R$ 29,90/mês** ou **R$ 197/ano** |
| Escolhe plano | `openCheckout({plan})` → backend devolve a URL (preço/link **do servidor**, nunca do cliente) |
| Brasil | Asaas (PIX/cartão/boleto) |
| Fora do Brasil | Stripe (roteado por país) — *planejado (FASE P8)* |
| Paga | Webhook do provedor → `_promote_to_pro` → `profiles` **e** `user_plans` atualizados atomicamente |
| Extensão | Polling do `bffMe()` detecta `plan=pro` → some o upsell, some a cota |

### 3.8 Configurações & Histórico

Overlay acessível pelo badge (engrenagem) ou pelo ícone da extensão:

- **Conta:** e-mail logado, **Sair**
- **Proteção:** liga/desliga alerta automático, cor do badge, estilo da varinha
- **Privacidade (LGPD):** cards clicáveis → exportar meus dados · excluir minha conta
- **Histórico:** prompts gerados (escopado por usuário — **não vaza entre contas** na
  mesma máquina; teste F8)

**Sair** (`signOut`): confirma → limpa a sessão **e todo o dado escopado do usuário**
do storage local (histórico, uso, plano) — não fica pra próxima conta (FASE segurança).

### 3.9 LGPD — exportar / excluir dados

| Fluxo | Passos | Entrega |
|---|---|---|
| **Exportar** | Configurações → "Exportar meus dados" → confirma por e-mail (link com token) → página de confirmação → **botão "Baixar relatório (PDF)"** | PDF real, `max_downloads` limitado, token = o segredo |
| **Reenviar e-mail** | botão na própria tela se o e-mail não chegou | reusa o token ativo |
| **Excluir conta** | "Excluir minha conta" → confirma por e-mail → conta agendada pra exclusão | e-mail de confirmação |

E-mails transacionais saem de verdade (`email_service.py` + Resend) — bug histórico
de "e-mail não saía" corrigido na FASE 10.9.7.

### 3.10 Desinstalação

- Chrome abre `api.atennaia.com.br/desinstalado` (via `setUninstallURL`).
- Formulário de feedback ("por que removeu?") → o admin vê as respostas.
- A relação **instalações × desinstalações ao longo do tempo** é sinal de ranking na
  CWS — por isso essa tela importa (FASE 10.6).

---

## 4. Estados de erro na jornada (nunca só no console)

| Momento | Falha | O que o usuário vê |
|---|---|---|
| Onboarding | Google cancelado / rede fora | "Tentar novamente com Google" (sem mensagem de erro agressiva) |
| Onboarding | e-mail já cadastrado | mensagem amigável + troca pra aba Login |
| Badge | plataforma não logada | badge de espera no canto + tooltip explicando |
| Geração | cota estourada (429) | mensagem + CTA de upgrade |
| Geração | provider de LLM fora / 429 de crédito | erro tratado + reportado no GlitchTip (não morre em `print`) |
| Pro | mesma conta em 2 dispositivos | "Você só pode usar em um único dispositivo simultaneamente" (🔒) |
| LGPD | token inválido / link velho | "link inválido", não a página de download |

---

## 5. Métricas da jornada

| Etapa | Métrica | Por quê |
|---|---|---|
| Instalação → Onboarding | % que completa signup | topo do funil |
| Signup | e-mail vs Google | esforço de onboarding |
| Onboarding → 1º uso | % que abre uma plataforma de IA e vê o badge | **ativação** |
| 1º uso → recorrência | D1 / D7 / D30 retention | valor percebido |
| DLP | banners mostrados · % "Proteger" vs "Enviar original" | o produto está sendo usado pro que promete? |
| Varinha | gerações/usuário/dia · % que aplica um card | valor do gerador |
| Cota | % de usuários free que bate no limite | pressão de conversão |
| Upsell | limite batido → clique no upgrade → checkout iniciado → pago | **conversão free→pro** |
| Desinstalação | taxa + motivos do feedback | saúde + sinal de ranking CWS |

---

## 6. Fricção proposital (o que NÃO melhorar no free)

- **5/dia é pouco de propósito.** Não subir "pra ser simpático" — é a alavanca de
  conversão.
- Upload/análise de arquivo, geração ilimitada, strict mode = **gate de Pro**.
- Governança, multi-tenant, políticas por time, auditoria enterprise = **não é aqui**,
  é a Atenna Plataforma. Se aparecer pedido desse tipo, a resposta é "isso está na
  Plataforma", não implementar na extensão.

---

## 7. O que a extensão deliberadamente NÃO faz

| Não faz | Onde fica |
|---|---|
| Console de governança, políticas por organização | Atenna Plataforma |
| Multi-tenant / gestão de times | Atenna Plataforma |
| Auditoria/SIEM corporativo, retenção configurável | Atenna Plataforma / Arckos |
| Integração com provedores de LLM da própria empresa | Plataforma |
| Bloqueio forçado do envio (a extensão **avisa e sugere**, não impõe no cliente — a imposição real é server-side no proxy) | — |

---

## 8. Referências

- Arquitetura / data-flow: `docs/SYSTEM_STATE.md`
- Specs por fase: `docs/specs/`
- Zero-trust / ameaças: specs `FASE_P-ZT_*`
- Boas práticas de publicação: `memory/chrome-web-store-boas-praticas`
- Posicionamento estratégico: `CLAUDE.md` §"Posicionamento Estratégico"
- Narrativa de marketing: `docs/marketing/NARRATIVA_EXTENSAO_CARROSSEL.md`
