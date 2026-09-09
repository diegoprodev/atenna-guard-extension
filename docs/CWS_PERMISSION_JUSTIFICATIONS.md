# Chrome Web Store — ficha completa (v2.4.0)

> Tudo pronto pra colar campo a campo no dashboard da CWS ao resubmeter.
> Reflete o manifest da **2.4.0** — `storage` + `activeTab` + `identity` (sem `tabs`,
> sem "ler histórico"), sem `chat.openai.com`, onboarding B14.
> Item publicado: `mcofdpebfbkbgnekidmepbpebapliifa` (a 2.4.0 é update dele).

---

# 1. Store listing

## Nome
```
Atenna Safe Prompt
```

## Summary (≤132 caracteres, texto puro)
```
Detecta CPF, e-mail e cartão no que você digita e avisa antes de enviar ao ChatGPT, Claude, Gemini ou Perplexity.
```
*(112 caracteres)*

## Description
```
A Atenna Safe Prompt protege seus dados sensíveis antes que eles cheguem a um assistente de IA.

Enquanto você escreve no ChatGPT, Claude, Gemini ou Perplexity, a extensão analisa o texto localmente e avisa quando encontra CPF, CNPJ, e-mail, telefone, cartão, chave de API, endereço ou dados médicos e jurídicos. Você revisa e decide: enviar como está, ou substituir os dados sensíveis com um clique.

A mesma barra também melhora seu prompt: a varinha reescreve o texto em três versões — direta, técnica e estruturada — e você escolhe a que serve.

RECURSOS
- Detecção de dados sensíveis em tempo real, sem sair da página
- Proteção com um clique (substitui os dados, mantém o sentido)
- Geração de prompt em três estilos
- Funciona em ChatGPT, Claude, Gemini e Perplexity
- Revalidação no servidor (o que a extensão sugere é sempre conferido)
- Exportação e exclusão dos seus dados dentro da extensão (LGPD)

PRIVACIDADE
O texto que você digita é analisado no seu navegador. Para o servidor vão apenas os
tipos de dado detectados e a contagem — nunca o conteúdo — exceto quando você pede
para gerar um prompt. Nada é vendido. Todo o tráfego é HTTPS.

Plano grátis: 5 gerações por dia. Pro: sem limite.
```

## Categoria
```
Privacidade e segurança
```
*(alternativa: Ferramentas / Productivity)*

## Idioma
```
Português (Brasil)
```

---

# 2. Single purpose (propósito único)

```
A Atenna Safe Prompt protege dados sensíveis (CPF, CNPJ, e-mail, telefone, cartão, chaves de API, dados médicos e jurídicos) antes de serem enviados a assistentes de IA (ChatGPT, Claude, Gemini, Perplexity), avisando o usuário e oferecendo substituição com um clique. Também ajuda a escrever prompts melhores, gerando três versões do texto.
```

---

# 3. Permissões

## `storage`
```
Guarda localmente (chrome.storage.local, sem sincronização) a sessão do usuário — um token opaco, nunca um JWT bruto —, as preferências (cor do selo, alerta automático ligado/desligado, estilo de geração) e o contador de uso diário. Nenhum dado sai do dispositivo por esta permissão.
```

## `activeTab`
```
Quando o usuário clica no ícone da extensão, ela lê o domínio da aba ativa para saber se é uma das quatro plataformas de IA suportadas e exibir no popup o status de proteção correto ("ChatGPT — protegido e ativo"). O acesso é temporário e restrito a esse clique — a extensão não tem acesso persistente ao histórico nem às outras abas.
```

## `identity`
```
Login e cadastro com a conta Google, via chrome.identity.launchWebAuthFlow (fluxo OAuth 2.0 padrão), método de autenticação recomendado pelo próprio Google para extensões. Nenhum token do Google fica armazenado — a extensão troca o retorno do OAuth por uma sessão própria no backend e descarta o resto.
```

## Host permissions — `chatgpt.com`, `claude.ai`, `gemini.google.com`, `www.perplexity.ai`
```
É o núcleo do produto. O content script roda nessas quatro plataformas para: (1) analisar em tempo real o texto que o usuário digita no campo de mensagem e detectar dados sensíveis antes do envio ao modelo de IA; (2) injetar o botão da extensão ancorado ao campo de texto, com o indicador de risco. A análise é local (não bloqueia a digitação) e revalidada no servidor.
```

## Host permission — `api.atennaia.com.br`
```
Backend próprio da Atenna (BFF). A extensão faz requisições HTTPS para: autenticar o usuário, revalidar server-side os dados detectados (modelo zero-trust — o cliente apenas sugere), gerar as três versões do prompt e processar a assinatura. Todo o processamento sensível acontece no servidor, não na extensão.
```

## Host permission — `kezbssjmgwtrunqeoyir.supabase.co`
```
Provedor de autenticação (Supabase). Usado exclusivamente no passo de autorização do login com Google (o redirecionamento OAuth .../auth/v1/authorize). Nenhum outro tráfego vai direto para este host — o restante passa pelo BFF.
```

---

# 4. Privacy practices

## O que a extensão coleta

| Tipo | Marcar? | O quê |
|---|---|---|
| Personally identifiable information | ✅ | E-mail (autenticação). O conteúdo digitado é analisado **localmente**; ao servidor vai só metadado (tipos de entidade, contagem, nível de risco). O texto só vai ao servidor quando o usuário pede para gerar um prompt. |
| Authentication information | ✅ | Token de sessão opaco. |
| Website content | ✅ | Só o texto do campo de mensagem, e só quando o usuário aciona a geração ou a proteção. |
| Location, financial, health, personal comms, web history, user activity | ❌ | — |

## Declarações (marcar todas)
- Não vendo os dados dos usuários a terceiros.
- Não uso nem transfiro os dados para fins alheios à funcionalidade central do item.
- Não uso nem transfiro os dados para determinar solvência ou para empréstimos.

## Certificações
- ✅ Trânsito de dados só por HTTPS.
- ✅ O usuário pode pedir exportação e exclusão dos dados (LGPD), dentro da própria extensão.

## Política de privacidade
```
https://api.atennaia.com.br/privacy
```
*(tem que bater com o que for declarado acima — conferir antes de submeter)*

---

# 5. Remote code

```
Não. Todo o código é empacotado no pacote da extensão. Sem eval, sem new Function, sem carregamento de script remoto. CSP restritiva no manifest (script-src 'self').
```

---

# 6. Imagens da ficha (lembrete — o dono fornece)

- **Ícone da loja:** 128x128, sem screenshot/texto dentro, cor da marca (verde-pinho `#0A2E23`).
- **Screenshots:** 1280x800 (ou 640x400), cantos retos, sem padding. Da **2.4.0** — nunca de build velho.
  Sugestão: (1) banner DLP pegando um CPF no ChatGPT · (2) os 3 prompts da varinha ·
  (3) tela de onboarding "Tudo pronto" · (4) popup "protegido e ativo".
- **Promo tile pequeno:** 440x280.
