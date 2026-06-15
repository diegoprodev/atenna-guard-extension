# PROMPT PARA LOVABLE — Adicionar Analytics + Corrigir Seção 2 na PP

Você precisa atualizar a Política de Privacidade para ADICIONAR a seção de Analytics que estava faltando e CORRIGIR a seção 2 que está muito genérica.

---

## SEÇÃO 2 — ATUALIZAR (REMOVER GENERICIDADE)

**Substitua INTEGRALMENTE a seção 2 por:**

```
2. Dados coletados

Coletamos os seguintes dados apenas durante o uso da extensão:

2.1 Autenticação e Identificação
- Endereço de e-mail: coletado quando o usuário realiza login voluntariamente para gerenciar conta
- Identificador anônimo (user_id): gerado localmente no primeiro uso, armazenado em chrome.storage.local para identificar o usuário sem e-mail
- Identificador de sessão (session_id): gerado a cada sessão para rastrear uso durante uma única visita

2.2 Atividade de Uso
- Eventos de uso específicos: tipo de ação (login, logout, geração de prompt, clique em botão)
- Tipo de plano: Free ou Pro (para controlar limites de 5 prompts/dia vs ilimitado)
- Timestamp: data e hora exata de cada ação
- Extensão version: versão da extensão instalada para debugging

2.3 Dados de Performance e Qualidade
- Latência de geração: tempo em milissegundos para gerar cada prompt
- Comprimento de entrada: número de caracteres do texto inserido pelo usuário
- Comprimento de saída: número de caracteres da resposta gerada
- Tipo de prompt: categoria do prompt gerado (estruturado, técnico, direto)
- Origem da ação: se foi gerado via builder, auto-sugestão ou manual

2.4 Mensagens de Erro (apenas para debugging)
- Error messages: mensagens de erro técnicas quando falhas ocorrem (ex: "timeout", "network error")
- Error context: qual operação causou o erro

2.5 Conteúdo Textual para Proteção
- Conteúdo textual inserido nos campos de prompt: processado LOCALMENTE para detecção de dados sensíveis (PII) antes de qualquer envio externo
- Conteúdo de documentos enviados (PDF, DOCX, XLSX, CSV): processado temporariamente no servidor para análise de dados sensíveis e NÃO armazenado permanentemente após análise

2.6 Dados Técnicos Mínimos
- Idioma do navegador
- Versão do Chrome/Navegador
- Sistema operacional (Windows, Mac, Linux)
```

---

## ADICIONAR NOVA SEÇÃO 4.1 — ANALYTICS E TELEMETRIA

**Localização:** Após a seção 4 "Uso dos dados", adicione:

```
4.1 Coleta e Análise de Dados de Usage

A extensão coleta dados de usage e telemetria APENAS para:
- Entender como usuários utilizam a extensão
- Identificar problemas técnicos e corrigir bugs
- Melhorar continuamente a experiência do usuário
- Garantir que os limites Free (5/dia) e Pro (ilimitado) funcionem corretamente

Como os dados são coletados:
1. Eventos são capturados localmente quando o usuário interage com a extensão
2. Um identificador anônimo (user_id) é gerado no primeiro uso
3. Um identificador de sessão é criado para cada uso
4. Todos os dados são embalados em JSON e enviados para: https://atennaplugin.maestro-n8n.site/track

Dados inclusos em cada evento de analytics:
- event: tipo de ação (login, prompt_generate, upgrade_clicked, etc)
- user_id: identificador anônimo gerado localmente (não é email, não é identidade real)
- session_id: identificador único da sessão atual
- timestamp: hora da ação (Unix timestamp)
- extension_version: versão da extensão
- plan: "free" ou "pro" (para controlar limites de uso)
- prompt_type: estruturado, técnico, direto (se aplicável)
- input_length: caracteres do texto inserido
- output_length: caracteres da resposta gerada
- latency_ms: milissegundos para gerar prompt
- error: mensagem técnica de erro (se houver falha)

Dados que NÃO são inclusos:
- Nenhum dado sensível (PII) como CPF, email de terceiros, senhas
- Nenhum conteúdo pessoal dos prompts gerados
- Nenhuma informação financeira
- Nenhum dado de navegação fora da extensão
- Nenhuma localização ou IP do usuário

Onde os dados são armazenados:
- Identificadores locais (user_id) são armazenados em chrome.storage.local no seu navegador
- Eventos de analytics são enviados para backend da Arckos IA (atennaplugin.maestro-n8n.site/track)
- Analytics dados não são compartilhados com terceiros (OpenAI, Google, etc) — apenas a extensão coleta esses dados

Retenção:
- User_id local: mantido enquanto extensão estiver instalada
- Analytics events: mantidos por 90 dias para análise, depois deletados automaticamente
```

---

## RESUMO

1. **REMOVER** seção 2 atual (muito genérica)
2. **ADICIONAR** seção 2 completa (detalhada com 2.1 a 2.6)
3. **ADICIONAR** seção 4.1 (analytics e telemetria)
4. Manter todas as outras seções (3-17)

**Resultado:** PP agora detalha TODOS os dados coletados de forma específica, exatamente como Chrome exige.

Pronto!
