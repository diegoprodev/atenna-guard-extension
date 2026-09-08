# 📖 Narrativa da Extensão Atenna Guard — Brief para Carrossel

## Visão Estratégica (Elevator Pitch)

**Atenna Guard Extension** é uma extensão de navegador freemium que protege dados sensíveis antes de você falar com IA — ao mesmo tempo que melhora a qualidade dos prompts você escreve.

Funciona como um **protetor inteligente + amplificador de criatividade** que:
1. **Detecta e remove PII** em tempo real (CPF, dados bancários, senhas, chaves de API)
2. **Estrutura seus inputs** em prompts de alta qualidade para qualquer ferramenta de IA
3. **Mantém você compliant** com LGPD automaticamente

Livre para usar 5 prompts/dia. Pro desbloqueias geração ilimitada + suporte a documentos.

---

## O Problema (Contexto)

### Cenário 1: O Vazamento Silencioso
Um usuário digita no ChatGPT: *"Ajuda a estruturar um email para [CPF: 123.456.789-09], que tem renda de R$ 12.000/mês e mora em [endereço]. Preciso preparar uma proposta de crédito."*

**O que acontece:**
- ChatGPT processa o CPF, endereço e renda como parte do contexto
- Esses dados entram no histórico da IA
- LGPD viola: coleta não autorizada de dados de terceiros
- Você cometeu crime de vazamento mesmo sem perceber

### Cenário 2: Prompt Fraco = Resposta Fraca
Mesmo usuário digita: *"Faz um roteiro de vendas pra minha empresa"*

**ChatGPT retorna:** resposta genérica, sem contexto da sua indústria, tamanho da empresa, público-alvo

**Resultado:** prompt perde 70% do potencial porque falta estrutura

### Cenário 3: Fricção com Compliance
Você quer entregar um relatório seguro à IA, mas:
- Precisa reler manualmente o texto
- Mascarar dados à mão
- Lembrar sempre de NOT fazer

**Resultado:** tedioso, propenso a erros, ninguém faz direito

---

## A Solução: Atenna Guard Extension

### Como Funciona (Fluxo Principal)

#### Passo 1: Você escolhe um texto/contexto
Seleciona um paragrafo, um email, um PDF — qualquer coisa com informação sensível.

#### Passo 2: Clica no Badge do Atenna
Badge aparece discretamente no canto (verde = seguro, vermelho = alerta de PII)

#### Passo 3: Extensão Analisa em Tempo Real
**Detecção DLP (Data Loss Prevention):**
- Identifica 11 tipos de PII brasileiros:
  - Documentos: CPF, CNPJ, RG, CNH
  - Financeiro: Credit Card, dados bancários
  - Profissional: OAB, CRM
  - Contato: Telefones
  - Segurança: API Keys, JWT tokens
  - Outros: Placas de carro

**Risk Scoring:**
- NONE: Nenhuma PII
- LOW: 1-2 items de baixo risco
- MEDIUM: 3+ items ou 1 documento pessoal
- HIGH: CPF + banco + dados pessoais juntos

#### Passo 4: Geração de Prompt Inteligente
Se dados sensíveis foram detectados:
- Substitui automaticamente por placeholders: `[SUBSTITUÍDO: DOCUMENTO_ID]`
- Mantém o contexto semântico (ex: "renda alta" se era 12k/mês)
- Estrutura em **formato de prompt profissional**

**Transformação:**
```
ANTES (arriscado):
"Preciso ajuda com [CPF: 123.456.789-09] que tem renda de R$ 12.000. 
Mora em [endereço completo]. Quer crédito."

DEPOIS (seguro + estruturado):
**Cliente**
- Renda: Alta (R$ 12.000/mês)
- Tipo: Pessoa Física
- Necessidade: Crédito pessoal

**Solicitação**
Estruture uma proposta de crédito que considere:
1. Renda mensal: [RENDA_VERIFICADA]
2. Localização: [REGIÃO_GEOGRÁFICA]
3. Produto: Crédito pessoal

**Tom**: Profissional, seguro, compliant
```

#### Passo 5: Copiar ou Gerar Variações
Extensão oferece:
- **Copiar para clipboard** → cola no ChatGPT/Claude/Copilot
- **Gerar 3 variações** → opções com enfoques diferentes
- **Enviar para IA** → integração direta (Pro)

#### Passo 6: IA Recebe Prompt Seguro
ChatGPT, Claude, ou qualquer ferramenta recebe:
- ✅ Sem PII exposta
- ✅ Estruturado para melhor resposta
- ✅ Contexto claro
- ✅ Pronto para produção

---

## Funcionalidades Principais

### 1️⃣ Proteção DLP (Data Loss Prevention)
- **Real-time scanning** de qualquer texto
- **11 padrões de detecção** brasileiros
- **Algoritmos de validação** (Luhn para CC, CPF mod-11)
- **Mascaramento automático** mantendo contexto
- **Risk scoring** visual (badge com cores)

### 2️⃣ Geração de Prompts
- **Reestruturação automática** de texto
- **3 variações** de prompt com enfoques diferentes
  - Variação 1: Estruturado & Técnico
  - Variação 2: Criativo & Estratégico
  - Variação 3: Executivo & Conciso
- **Customização manual** antes de enviar
- **Templates** para 10+ casos de uso comuns
  - Documentos profissionais
  - Estratégia de vendas
  - Conteúdo para redes
  - Explicação técnica
  - Etc.

### 3️⃣ Upload de Documentos (Pro)
- Enviar PDF, DOCX, Excel para análise
- DLP escaneia arquivo inteiro
- Gera resumo protegido + prompt
- Até 100MB por arquivo (Pro)

### 4️⃣ Integração com IA (Pro)
- Enviar prompt diretamente ao ChatGPT/Claude/Copilot
- Histórico de prompts gerados
- Estatísticas de uso
- Sugestões baseadas em histórico

### 5️⃣ Governance & Compliance (Pro)
- Dashboard de dados enviados
- Audit log de operações
- Retenção automática (30 dias, depois apaga)
- Relatório de conformidade LGPD
- Exportar histórico

---

## Jornada do Usuário

### Free Plan (5 prompts/dia)
**Para experimentar:**
- ✅ DLP protection em qualquer texto
- ✅ Gerar 1 prompt estruturado por dia
- ✅ 3 variações por geração
- ✅ Interface completa
- ❌ Upload de docs
- ❌ Integração com IA
- ❌ Governance features

**Limite**: 5 gerações/dia → reinicia meia-noite

### Pro Plan (Ilimitado)
**Para profissionais:**
- ✅ Prompts ilimitados todos os dias
- ✅ Upload de PDF/DOCX/Excel
- ✅ Integração com ChatGPT/Claude/Copilot
- ✅ Histórico de prompts (90 dias)
- ✅ Dashboard de dados
- ✅ Audit log completo
- ✅ Relatórios de conformidade

**Preço**: R$ 19,90/mês (ou equivalente)

### Upsell Path
**Free user hits limit** → "Desbloqueie prompts ilimitados"
**Pro user quer mais** → Upsell para **Atenna Platform**
  - Multi-tenant governance
  - SSO + permissões granulares
  - Integração com apps enterprise
  - Suporte dedicado

---

## Proteção de Dados (Diferencial)

### Antes da Extensão
```
Seu texto com CPF/dados
          ↓
[ChatGPT / qualquer IA]
          ↓
Dados vazam no histórico da IA
```

### Com Atenna Guard
```
Seu texto com CPF/dados
          ↓
[Detecção DLP local]
          ↓
Mascaramento automático
          ↓
Prompt sanitizado
          ↓
[ChatGPT recebe APENAS o prompt limpo]
          ↓
Zero risco de vazamento
```

### Conformidade LGPD
- **Artigo 5**: Dados processados com segurança ✅
- **Artigo 7**: Consentimento explícito (usuário clica em "Gerar") ✅
- **Artigo 11**: Dados sensíveis + identificadores removidos ✅
- **Artigo 17**: Direito ao esquecimento (retenção 30 dias, depois apaga) ✅

---

## Casos de Uso Reais

### Caso 1: Profissional de RH
**Problema:** Precisa processar dados de candidatos com IA, mas não pode expor CPF/endereço
**Solução:**
1. Copia CV do candidato
2. Clica no Atenna badge
3. Extensão gera prompt: "Analise este candidato para posição de gerente, considerando: [experiência mascarada], [habilidades], [localização genérica]"
4. Copia para ChatGPT
5. Recebe análise segura + sugestões de entrevista

**Resultado:** Compliant com LGPD, prompt estruturado, decisão melhor

### Caso 2: Desenvolvedor com Secrets
**Problema:** Quer pedir ajuda no ChatGPT mas tem chaves de API no código
**Solução:**
1. Copia snippet de código com API key
2. Badge fica **vermelho** (detecta `sk-proj-...`)
3. Clica → extensão remove chave, mantém lógica
4. Gera prompt: "Otimize este código de integração com OpenAI [CHAVE REMOVIDA]"
5. Copia para Claude
6. Recebe refactoring seguro

**Resultado:** Zero risco de credential leak, código seguro

### Caso 3: Vendedor B2B
**Problema:** Quer gerar pitch para cliente mas precisa personalizar sem soar robótico
**Solução:**
1. Seleciona proposta anterior para cliente XYZ
2. Clica no Atenna badge
3. Extensão gera 3 variações:
   - V1: Estruturada (dados + números)
   - V2: Narrativa (história + case)
   - V3: Executiva (3 pontos + CTA)
4. Escolhe V2, customiza
5. Copia para email

**Resultado:** Pitch personalizado, profissional, 3x mais rápido

### Caso 4: Analista de Conformidade
**Problema:** Auditar quais dados foram expostos em prompts de IA
**Solução:**
1. Abre dashboard Pro do Atenna
2. Vê relatório: "28 prompts gerados, 0 PII exposições"
3. Exporta log para compliance team
4. Mostra ao auditor LGPD

**Resultado:** Prova de conformidade automática

---

## Diferenciais da Atenna Guard

### vs. ChatGPT Custom Instructions
- ❌ Custom instructions não detectam PII
- ❌ Não mascarám dados automaticamente
- ❌ Usuário é responsável por lembrar
- ✅ Atenna: Automático, sempre ligado, 11 padrões PT-BR

### vs. OpenAI API (Data Privacy Mode)
- ❌ Caro
- ❌ Requer implementação técnica
- ❌ Não melhora prompts
- ✅ Atenna: Grátis (Free), integrado no navegador, reestrutura prompts

### vs. VPN/Proxy
- ❌ Não detecta dados sensíveis
- ❌ Lento
- ❌ Não estrutura prompts
- ✅ Atenna: Específico para PII, rápido, inteligente

---

## Fluxo de Onboarding

### Tela 1: Bem-vindo
**Título:** "Seus dados, protegidos. Prompts, melhores."
**Copy:** "Atenna Guard detecta dados sensíveis antes de você mandar pra IA — e estrutura seu texto para respostas melhores."
**CTA:** "Começar em 1 minuto"

### Tela 2: O Problema
**Título:** "Você sabe o que você manda pra IA?"
**Visuals:**
- Ícone de CPF
- Ícone de Chave de API
- Ícone de Email
**Copy:** "Toda vez que você digita, pode estar expondo dados sem perceber. Seus dados + dados de clientes entram no histórico da IA para sempre."
**CTA:** "Mostrar como proteger"

### Tela 3: A Solução
**Título:** "Atenna detecta, mascara e estrutura em 1 clique"
**Visuals:**
- Badge do Atenna no input
- Seta para "Detecta PII"
- Seta para "Remove dados"
- Seta para "Gera prompt"
**Copy:** "Quando você seleciona um texto, o Atenna escaneia em tempo real. Se encontrar dados sensíveis, remove e estrutura um prompt melhor."
**CTA:** "Ver funcionando"

### Tela 4: Proteção Completa
**Título:** "11 tipos de dados brasileiros"
**Grid de ícones:**
- 📄 CPF
- 📋 CNPJ
- 🆔 RG/CNH
- 💳 Cartão
- 🔑 API Key
- 🛡️ JWT
- 📞 Telefone
- 🏢 OAB/CRM
- 🚗 Placa
- 💰 Banco
- 🔐 Outros

**Copy:** "De documentos a chaves de API. Tudo detectado."
**CTA:** "Próximo"

### Tela 5: Qualidade de Prompt
**Título:** "Texto melhor = Respostas melhores"
**Antes/Depois:**
```
ANTES: "Estrutura um email pra [cliente com dados pessoais]"
DEPOIS: "Estruture email profissional considerando:
- Tipo: [SUBSTITUÍDO: PESSOA_FÍSICA]
- Situação: [CONTEXTO_MANTIDO]
- Tom: Formal"
```
**Copy:** "Atenna não só protege — estrutura seu prompt para IA entender melhor o que você quer."
**CTA:** "Começar"

### Tela 6: Planos
**Dois cards:**

**Free**
- ✅ DLP Protection
- ✅ 5 prompts/dia
- ✅ Variações ilimitadas
- ❌ Upload de docs
- ❌ Integração com IA

**Pro**
- ✅ Tudo do Free
- ✅ Prompts ilimitados
- ✅ Upload (100MB)
- ✅ Integração com IA
- ✅ Dashboard + Audit

**CTA Pro:** "Liberar Pro — R$ 19,90/mês"
**CTA Free:** "Usar Free agora"

---

## Estrutura Visual do Carrossel

### Slide 1: Headline
```
┌─────────────────────────────────────┐
│                                     │
│   Seus dados, protegidos.           │
│   Prompts, melhores.                │
│                                     │
│   [Grande visual: Badge Atenna]     │
│                                     │
│        [CTA: Começar]               │
└─────────────────────────────────────┘
```

### Slide 2-3: Problema
```
┌─────────────────────────────────────┐
│   Você sabe o que manda pra IA?     │
│                                     │
│   [Ícone CPF]  [Ícone API Key]     │
│   [Ícone Email] [Ícone Telefone]   │
│                                     │
│   Dados vazam silenciosamente       │
│        [CTA: Continuar]             │
└─────────────────────────────────────┘
```

### Slide 4: Proteção
```
┌─────────────────────────────────────┐
│   Detecta 11 tipos de dados         │
│   brasileiros em tempo real         │
│                                     │
│   📄 CPF    📋 CNPJ   💳 Cartão   │
│   🔑 API    🛡️ JWT    ☎️ Telefone  │
│   🏢 OAB    🚗 Placa   💰 Banco    │
│                                     │
│        [CTA: Próximo]               │
└─────────────────────────────────────┘
```

### Slide 5: Quality
```
┌─────────────────────────────────────┐
│   Transforma seu texto em prompt    │
│   profissional                      │
│                                     │
│   ❌ "ajuda com [CPF 123...]"      │
│   ✅ "Analise candidato por..."    │
│                                     │
│   Melhor texto = melhor resposta    │
│        [CTA: Continuar]             │
└─────────────────────────────────────┘
```

### Slide 6: Plans
```
┌─────────────────────────────────────┐
│   Escolha seu plano                 │
│                                     │
│  [Free Card]    [Pro Card]          │
│  5 prompts      Ilimitado           │
│  [CTA Free]     [CTA Pro]           │
│                                     │
└─────────────────────────────────────┘
```

---

## Mensagens-Chave

1. **Proteção Automática** — Você não precisa lembrar, Atenna lembra por você
2. **Sem Risco LGPD** — Dados não saem do seu navegador, PII é removida antes de enviar
3. **Prompts Profissionais** — Texto estruturado = respostas melhores
4. **Compatível com Tudo** — Funciona em ChatGPT, Claude, Copilot, qualquer IA
5. **Transparência Total** — Você vê exatamente o que foi removido e o que foi enviado
6. **Friction Criada** — Free plan (5/dia) convida upgrade, nunca força
7. **Degrau para Plataforma** — Pro desbloqueía upgrade para Atenna Platform (multi-tenant, governance, SSO)

---

## Tone & Voice para Carrossel

- **Segurança sem paranóia** — Não assuste, eduque
- **Empowerment** — Você está no controle, não é máquina fazendo mágica
- **PT-BR authenticity** — Fale em português natural, use exemplos brasileiros
- **Clareza > Cleverness** — Nenhuma pirueta verbal, clareza máxima
- **Ação positiva** — Foque no que ganham, não no medo de perder

---

## Dimensões de Valor

### Para Usuário Individual
- **Segurança:** Zero risco de vazamento de PII
- **Produtividade:** 3x mais rápido gerar prompts profissionais
- **Conformidade:** Automaticamente compliant com LGPD
- **Qualidade:** Respostas melhores porque prompts são estruturados

### Para Empresa
- **Risk Mitigation:** Zero data breach por PII em IA
- **Governance:** Audit log + relatórios de conformidade
- **Produtividade:** Equipe gera melhores prompts
- **Compliance:** Atende LGPD, INMETRO, regulações Brasil

### Para Atenna Plataforma
- **Acquisition:** Extensão = funil de usuários para plataforma
- **Engagement:** Free plan = hábito (5/dia lembra do Atenna)
- **Conversion:** Pro → Plataforma upgrade (governance + multi-tenant)
- **Network:** Cada extensão usada = possível lead B2B

---

## Próximos Passos

Este brief é pronto para:
1. **Designer** — Criar mockups do carrossel com esses slides
2. **Dev** — Implementar UI de onboarding (já existe em `src/ui/modal/prompt-states.ts`)
3. **Copywriter** — Refinar textos com tom de voz
4. **PM** — Alinhar goals de conversão (Free → Pro, Pro → Platform)

---

**Status:** Pronto para produção. Código DLP + geração de prompts já implementados e testados (100% test pass).
