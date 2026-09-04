# FASE P-ZT parte 3 — backend usa JWT do usuário em vez de service_role (RLS como 2ª barreira de verdade)

> Segue a REGRA CANÔNICA do `CLAUDE.md`: spec → harness/testes → code review (3 chapéus) →
> changelog → só então commit/push/deploy. Nenhuma linha desta fase entra sem passar pelo ciclo.

## 1. Problema

Hoje o backend usa **`SUPABASE_SERVICE_ROLE_KEY`** (que tem `rolbypassrls=true`, confirmado
na auditoria da parte 2) pra praticamente toda query — inclusive nas rotas onde o dado é só
do próprio usuário (`/user/export/*`, `/user/deletion/*`, `/auth/usage`, `/auth/me`, etc).

Isso significa que **RLS existe no banco mas não protege o backend contra ele mesmo**. Se um
PR futuro introduzir um bug onde o `user_id` é derivado errado (like a coluna trocada, um
`.eq()` esquecido, um alias que devolve `None`), a query roda igual — porque `service_role`
ignora toda policy — e devolve dado de outro usuário. **Foi exatamente essa classe de bug**
(chave de storage sem escopo) que causou o vazamento de histórico entre contas corrigido no
PR #40, só que no cliente em vez do servidor. Não temos essa segunda barreira no backend hoje.

**Meta desta fase:** nas rotas de dado pessoal, o backend passa a consultar o Supabase **com
o JWT do próprio usuário** (não `service_role`). Se o código tiver um bug e tentar ler a linha
de outro `user_id`, o Postgres nega **na camada de banco**, independente do bug de aplicação.

## 2. Decisões

| # | Decisão | Alternativa considerada | Por quê |
|---|---------|--------------------------|---------|
| D1 | Cliente Supabase **por request**, construído com o JWT Supabase original (guardado — cifrado — na sessão BFF) | Reusar um único client global | Client global com JWT trocado por request tem histórico de bug real neste projeto (PR já corrigiu "cliente admin poluído por sign_in_with_password" — `services/supabase_admin.py` `get_auth_client()`); client por request evita reincidência |
| D2 | Guardar o **JWT Supabase original** (não só o opaco BFF) na sessão persistida (`bff_sessions.supabase_jwt` — **coluna já existe**, é escrita mas nunca lida hoje) | Re-autenticar a cada request | Já temos o JWT salvo desde a FASE P3.3; é só passar a usá-lo. Zero custo extra de login |
| D3 | Escopo desta fase: só rotas onde 100% do dado é do próprio usuário — `export.py`, `deletion.py`, `/auth/usage`, `/auth/me`. **Não** inclui `/generate-prompts` (grava em `dlp_events` com lógica de quota compartilhada) nem `/admin/*` (sempre `service_role`, é o propósito) | Trocar tudo de uma vez | Menor raio de explosão; cada rota trocada é testável isoladamente com a suíte de bypass (P2.5 do plano macro) |
| D4 | Se o JWT do usuário expirou (>1h) no meio da sessão BFF, o backend cai pro refresh **antes** de montar o client de usuário (reusa `bffRefresh`/rotina de refresh já existente) | Deixar a query falhar com 401 do Postgres | UX: usuário não deve ver erro por token expirado se o refresh token ainda é válido |
| D5 | `service_role` continua sendo usado para: webhooks (Asaas), jobs agendados (`execute_account_purge`, `cleanup_old_dlp_events`), e-mails transacionais, `/admin/*` | Migrar tudo pro JWT do usuário | Esses fluxos não têm um "usuário logado fazendo a request" — são server-to-server por natureza |

## 3. Arquivos

| Arquivo | Mudança |
|---|---|
| `backend/services/supabase_admin.py` | Nova função `get_user_client(supabase_jwt: str) -> Client` — cliente Supabase autenticado como o usuário (não admin) |
| `backend/services/session_store.py` | `resolve_token()` já devolve `supabase_jwt` no dict da sessão — nenhuma mudança de schema, só passar a usar o campo |
| `backend/middleware/auth.py` | `require_auth` passa a expor `supabase_jwt` no dict retornado (hoje só expõe `user_id`/`email`/`plan`) |
| `backend/routes/export.py` | `request_export`, `resend_export_email`, `confirm_export_page`→ leitura de status usa `get_user_client`; escritas que hoje passam por RPC (`initiate_export_request` etc, `SECURITY DEFINER`) continuam funcionando pois RPCs `SECURITY DEFINER` não dependem do papel do chamador |
| `backend/routes/deletion.py` | idem, para `initiate_deletion`, `get_deletion_status`, `cancel_deletion`, `resend_deletion_email` |
| `backend/routes/bff_auth.py` | `/auth/usage`: troca `get_admin_client()` por `get_user_client(session["supabase_jwt"])` na leitura de `dlp_events`/`user_dlp_stats` |
| `backend/tests/test_user_jwt_client.py` | Novo — ver seção Harness |
| `docs/THREAT_MODEL.md` (novo, se ainda não existir) | Atacante = usuário avançado com o próprio token opaco; resposta-alvo: nada além do próprio dado, mesmo com bug de código |

## 4. Contrato

- Toda rota migrada: se o código (por bug) tentar `.eq("user_id", <outro_uid>)`, o Postgres
  devolve **0 linhas** (RLS nega), não um erro 500 — o comportamento observável pro usuário é
  "não encontrado", nunca dado de terceiro.
- `GET /user/export/status`, `GET /user/deletion/status`, `GET /auth/usage`: usam o JWT do
  usuário. Resposta idêntica à de hoje pro caso feliz (contrato de API não muda).
- Rotas com RPC `SECURITY DEFINER` (`initiate_export_request`, `confirm_export_request`,
  `initiate_account_deletion`, etc) continuam funcionando sem mudança — `SECURITY DEFINER`
  roda com o dono da função, não o papel do chamador; RLS não se aplica a elas de qualquer
  forma. Só as leituras diretas de tabela (`select`) migram pro client de usuário.
- Se o JWT do usuário expirou e o refresh falhar: **401** (sessão expirada), nunca fallback
  silencioso pra `service_role`.

## 5. Harness / Testes (falha ANTES do fix, prova o comportamento DEPOIS)

`backend/tests/test_user_jwt_client.py`:
1. **Teste de bypass (o que importa de verdade):** monta 2 usuários reais num Supabase de
   teste (ou mock fiel do RLS via Postgres real em container — client fake não basta, RLS é
   imposto pelo Postgres). Usuário A pede `/user/export/status`; o handler é forçado (via
   monkeypatch) a tentar ler a linha do usuário B. Com `service_role`: leitura funciona
   (**vulnerável** — é o estado ANTES do fix, prova que o teste pega o problema).
   Com `get_user_client`: leitura devolve vazio.
2. `get_user_client(jwt)` monta um client com `Authorization: Bearer <jwt>` (não a service key).
3. `require_auth` expõe `supabase_jwt` no dict — regressão se algum PR remover o campo.
4. Rodar a suíte completa (`test_anti_idor.py` incluído) antes e depois da migração de cada
   rota — zero regressão.

**Nota:** este teste de bypass PRECISA de RLS real (Postgres), não dá pra provar com mock do
client Supabase (mock não impõe RLS). Se não houver Postgres em container no CI, o teste roda
`@pytest.mark.skipif` com aviso claro — nunca finge que passou.

## 6. Code review — 3 chapéus

- **Arquiteto sênior:** cliente por request tem custo de 1 troca de JWT por chamada (desprezível,
  é só header HTTP) vs. o ganho de isolamento real. Acoplamento: `get_user_client` fica em
  `services/supabase_admin.py`, mesmo lugar do `get_admin_client`/`get_auth_client` — sem
  nova camada. Falha-fechado: JWT ausente/expirado → 401, nunca degrada pra admin.
- **Product Owner:** zero mudança de comportamento pro usuário no caminho feliz — só muda o
  que acontece quando tem bug (que aí devolve "não encontrado" em vez de vazar dado). Não
  atrasa nenhuma feature visível.
- **PM/Estrategista:** isso é infraestrutura de confiança, não feature de produto — mas é
  exatamente o tipo de coisa que vira motivo de perda de confiança/processo se descoberta por
  fora. Faseado por rota = risco controlado, não bloqueia o roadmap de produto.

## 7. Riscos

| Risco | Mitigação |
|---|---|
| RLS mal configurada bloqueia leitura legítima (regressão funcional) | Migrar 1 rota por PR, com a suíte de bypass + regressão rodando antes de mergear cada uma |
| JWT do usuário expira no meio de uma sessão longa | D4 — refresh automático antes de montar o client; teste de expiração |
| `SECURITY DEFINER` nas RPCs mascara um caso onde RLS deveria ter pego algo | Já auditado na parte 2 — nenhuma RPC de escrita faz `select *` sem filtro de user_id no corpo |
| Teste de bypass exige Postgres real — se o CI não tiver, fica sem cobertura de verdade | Documentar explicitamente o skip; não declarar "coberto" sem o teste rodando de fato |

## 8. Rollout

1. Uma rota por PR (`/auth/usage` primeiro — menor risco, só leitura).
2. Cada PR: harness roda, 3 chapéus registrados no PR, CHANGELOG atualizado.
3. Deploy do backend (aprovação manual, como sempre).
4. Smoke: usuário real gera relatório/exclusão/consulta uso — fluxo idêntico ao de hoje.
5. Depois das 4 rotas do D3: reavaliar se `/generate-prompts` entra numa fase seguinte.

## 9. Fora de escopo (não fazer aqui)
- Trocar `/admin/*` pro modelo de usuário — errado por design, admin precisa ver tudo.
- Tocar nas RPCs `SECURITY DEFINER` — já corretas, fora do raio desta fase.
- `/generate-prompts` e a lógica de quota — tem estado compartilhado (contagem), fica pra
  fase própria depois de medir o impacto nas 4 rotas mais simples primeiro.
