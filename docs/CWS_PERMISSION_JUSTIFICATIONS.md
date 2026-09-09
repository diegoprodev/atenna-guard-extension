# Chrome Web Store — textos dos campos de justificativa

> Cole nos campos correspondentes do **Privacy practices** / **Permissions** do
> dashboard da CWS ao resubmeter. Refletem o manifest da 2.3.x (pós-FASE B13.2 —
> `activeTab` no lugar de `tabs`, sem `chat.openai.com`).

---

## Single purpose (propósito único)

> A Atenna Safe Prompt protege dados sensíveis (CPF, CNPJ, e-mail, telefone, cartão,
> chaves de API, dados médicos e jurídicos) antes de serem enviados a assistentes de IA
> (ChatGPT, Claude, Gemini, Perplexity), avisando o usuário e oferecendo reescrita com
> um clique. Também ajuda a escrever prompts melhores, gerando três versões do texto.

---

## Permissão: `storage`

> Guarda localmente (chrome.storage.local, sem sincronização) a sessão do usuário — um
> token opaco, nunca um JWT bruto —, as preferências (cor do selo, alerta automático
> ligado/desligado, estilo de geração) e o contador de uso diário. Nenhum dado sai do
> dispositivo por esta permissão.

---

## Permissão: `activeTab`

> Quando o usuário clica no ícone da extensão, a extensão lê o domínio da aba ativa
> para saber se é uma das quatro plataformas de IA suportadas e exibir no popup o
> status de proteção correto ("ChatGPT — protegido e ativo"). O acesso é temporário e
> restrito a esse clique — a extensão não tem acesso persistente ao histórico nem às
> outras abas.

---

## Permissão: `identity`

> Login e cadastro com a conta Google, via `chrome.identity.launchWebAuthFlow` (fluxo
> OAuth 2.0 padrão). É o método de autenticação recomendado pelo próprio Google para
> extensões. Nenhum token do Google fica armazenado — a extensão troca o retorno do
> OAuth por uma sessão própria no backend e descarta o resto.

---

## Host permissions

### `https://chatgpt.com/*`, `https://claude.ai/*`, `https://gemini.google.com/*`, `https://www.perplexity.ai/*`

> É o núcleo do produto. O content script roda nessas quatro plataformas para:
> (1) analisar em tempo real o texto que o usuário digita no campo de mensagem e
> detectar dados sensíveis **antes** do envio ao modelo de IA;
> (2) injetar o botão da extensão ancorado ao campo de texto, com o indicador de risco.
> A análise é local (não bloqueia a digitação) e revalidada no servidor.

### `https://api.atennaia.com.br/*`

> Backend próprio da Atenna (BFF). A extensão faz requisições HTTPS para: autenticar o
> usuário, revalidar server-side os dados detectados (modelo zero-trust — o cliente
> apenas sugere), gerar as três versões do prompt e processar a assinatura. Todo o
> processamento sensível acontece no servidor, não na extensão.

### `https://kezbssjmgwtrunqeoyir.supabase.co/*`

> Provedor de autenticação (Supabase). Usado exclusivamente no passo de autorização do
> login com Google (o redirecionamento OAuth `.../auth/v1/authorize`). Nenhum outro
> tráfego vai direto para este host — o restante passa pelo BFF.

---

## Data usage / privacy disclosures

Marcar:
- **Personally identifiable information** — coletado: e-mail (autenticação). O conteúdo
  que o usuário digita é analisado **localmente**; ao servidor vai apenas metadado
  (tipos de entidade detectados, contagem, nível de risco) e, se o usuário pedir para
  gerar um prompt, o texto — para gerar a resposta.
- **Authentication information** — token de sessão opaco.
- **Website content** — só o texto do campo de mensagem, e só quando o usuário aciona
  a geração de prompt ou a proteção.

Declarar:
- ❌ Não é vendido a terceiros.
- ❌ Não é usado/transferido para fins alheios à funcionalidade central.
- ❌ Não é usado para determinar solvência ou para empréstimos.
- ✅ Trânsito só por HTTPS.
- ✅ O usuário pode pedir exportação ou exclusão dos dados (LGPD) dentro da extensão.

Política de privacidade: `https://api.atennaia.com.br/privacy` — precisa bater com o
que for declarado aqui.

---

## Remote code

> Não. Todo o código é empacotado. Sem `eval`, sem `new Function`, sem carregamento de
> script remoto. CSP restritiva no manifest (`script-src 'self'`).
