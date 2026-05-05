# Política de Privacidade — Atenna Prompt

**Última atualização:** 2026-05-04

---

## 1. Quem somos

A extensão **Atenna Prompt** é desenvolvida por Diego Rodrigues (devdiegopro@gmail.com). Esta política descreve como coletamos, usamos e protegemos seus dados.

---

## 2. Dados coletados

### 2.1 Dados de uso (anônimos)
Coletamos métricas de uso para melhorar o produto. Cada evento contém:

| Campo        | Exemplo               | Finalidade                        |
|--------------|-----------------------|-----------------------------------|
| `user_id`    | `anon_k3j9x2...`      | ID anônimo gerado localmente      |
| `event`      | `prompt_generated`    | Tipo de ação realizada            |
| `timestamp`  | `1746362400000`       | Quando o evento ocorreu           |
| `prompt_type`| `direct`              | Qual versão do prompt foi usada   |
| `origin`     | `builder`             | De onde veio o prompt             |

**O `user_id` é gerado aleatoriamente no navegador. Nunca contém seu nome, e-mail ou qualquer dado pessoal identificável.**

### 2.2 Dados de conta (plano Pro — futuro)
Se você criar uma conta para o plano Pro, coletaremos:
- Endereço de e-mail (para autenticação via magic link)
- Data de ativação do plano

### 2.3 Dados NÃO coletados
- Conteúdo dos seus prompts ou textos digitados
- Histórico de navegação
- Cookies de terceiros
- Dados de localização

---

## 3. Como os dados são usados

| Dado          | Uso                                                |
|---------------|----------------------------------------------------|
| Métricas anônimas | Entender quais funcionalidades são mais usadas |
| E-mail (Pro)  | Autenticação e comunicação sobre o plano           |

**Nunca vendemos ou compartilhamos seus dados com terceiros para fins comerciais.**

---

## 4. Armazenamento

- **Localmente (chrome.storage.local):** contador de uso diário, plano (free/pro), ID anônimo, JWT de sessão.
- **Servidor (ao usar o produto):** eventos de uso anônimos gravados em servidor próprio.
- **Supabase (plano Pro):** e-mail e token de sessão, armazenados no Brasil/EUA conforme política da Supabase.

Os dados locais ficam no seu navegador e **não são acessíveis por outros sites**.

---

## 5. Compartilhamento

Não compartilhamos dados pessoais com terceiros, exceto:
- **Supabase** (autenticação, apenas plano Pro): [https://supabase.com/privacy](https://supabase.com/privacy)
- **Google Gemini API** (geração de prompts): o texto que você digita é enviado à API do Gemini para processamento. Consulte a [política do Google](https://policies.google.com/privacy).

---

## 6. Seus direitos

Você pode:
- **Excluir todos os dados locais** a qualquer momento: clique com o botão direito na extensão → "Remover extensão" ou limpe os dados via `chrome://settings/siteData`.
- **Solicitar exclusão de conta** (plano Pro): envie e-mail para devdiegopro@gmail.com.

---

## 7. Segurança

- Comunicação com o servidor via HTTPS (produção)
- JWT armazenado em `chrome.storage.local` (não acessível via JavaScript de páginas web)
- IDs de usuário são anônimos e não reversíveis

---

## 8. Extensão funciona sem login

O plano Free não exige cadastro. A extensão funciona completamente offline para as funcionalidades básicas (fallback de prompts) e sem coletar dados de conta.

---

## 9. Conformidade

Esta extensão segue as [Políticas do Programa para Desenvolvedores do Chrome Web Store](https://developer.chrome.com/docs/webstore/program-policies/), incluindo:
- Permissões mínimas necessárias (apenas `storage`)
- Sem acesso a dados de outras abas ou histórico
- Funcionalidade free disponível sem paywall total

---

## 10. Contato

Dúvidas sobre privacidade:  
📧 devdiegopro@gmail.com
