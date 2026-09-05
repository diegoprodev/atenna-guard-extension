# FASE P-ZT Parte 4 — Anti-abuso de conta PRO (IP único + teto por hora)

**Status:** spec · **Parte de:** P-ZT (zero-trust) · **Pedido:** dono — "impedir empréstimo de
login PRO (família/empresa usando a mesma conta), só 1 IP ativo, teto de 12 gerações/hora, pra
economizar custo de API".

## Problema

Um assento PRO é **1 usuário**. Hoje nada impede:
- Login+senha PRO compartilhado com N pessoas (família, colegas, empresa inteira).
- Uso simultâneo de IPs diferentes com o mesmo token/sessão.
- PRO tem teto de **20 gerações/hora** (`PRO_HOURLY_LIMIT`), alto demais pro custo real de API
  quando a conta é compartilhada por 5 pessoas → 100 gerações/hora de custo num assento só.

O `bff_sessions` é **por token** (um por device/login) — não há nada **por usuário** que
controle "quantos lugares/IPs este assento está usando agora".

Custo real por geração (FASE 10.9.6): OpenAI `gpt-4.1-nano` $0.10/1M in + $0.40/1M out;
Gemini `gemini-2.5-flash-lite` idem. Uma geração ≈ 300 in + ~1500 out ≈ US$0.0006. 20/h × 5
pessoas × 24h ≈ US$1,44/dia num assento de ~US$1/dia de receita. Prejuízo.

## Decisões

| Tema | Decisão | Porquê |
|---|---|---|
| Teto PRO/hora | **20 → 12** (`PRO_HOURLY_LIMIT`) | 12 cobre uso individual real com folga; corta o abuso de compartilhamento |
| O que conta pro teto | Toda chamada que bate em LLM/OCR externo: `/generate-prompts`, `/protect` (doc OCR Gemini), `/dlp/image` (se usar Gemini) | são as que custam dinheiro. "DLP à vontade" = scan local (cliente) + `/dlp/scan` (Presidio, CPU, sem custo externo) seguem **sem teto** |
| IP único ativo | **Lock por usuário** (`pro_ip_locks`), 1 IP ativo. IP diferente **dentro da janela de graça (15 min de atividade)** → **429**. IP antigo ocioso > 15 min → adota o novo | bloqueia uso simultâneo sem travar quem trocou de wifi/4G ou viajou |
| Login explícito reivindica o lock | `POST /auth/login` / `/auth/google` seta `active_ip` pro IP do login na hora | quem foi bloqueado só precisa "entrar de novo"; cada re-login fica no audit (rastro de compartilhamento) |
| Fonte do IP | header `X-Real-IP` (nginx seta a partir de `CF-Connecting-IP`; `proxy_set_header` **sobrescreve** qualquer header que o cliente mande). Fallback: 1º IP de `X-Forwarded-For`, depois `request.client.host` | zero-trust: o edge decide o IP, não o cliente. **Pré-req**: origem só aceita tráfego da Cloudflare (P7 firewall) — senão dá pra furar batendo direto no IP do servidor |
| Escopo | **PRO apenas.** Free (5/dia) compartilhado = 5/dia no total, não vale o abuso | menos superfície, não penaliza o caso comum |
| Falha do Supabase | **fail-open** (libera) + `logger.error` | nunca travar um cliente pagante por hiccup de infra (mesma política da cota — S7) |
| Rollout | `PRO_IP_LOCK_MODE` = `off` \| `shadow` \| `enforce`. Começa `shadow` (loga o que bloquearia) por ~1 semana → mede falso-positivo → `enforce` | evita travar cliente legítimo de cara |
| IP no cliente/audit | erro pro cliente: IP **mascarado** (`186.xxx.xxx.42`). Audit interno: IP inteiro (é dado operacional, não PII de terceiro — é o próprio usuário) | LGPD: minimização na superfície voltada ao cliente |

## Arquivos

```
supabase/migrations/2026XXXX_pro_ip_locks.sql      # nova tabela + RLS (só service_role escreve)
backend/services/client_ip.py                       # novo — get_client_ip(request) canônico
backend/services/pro_ip_lock.py                     # novo — check_and_claim_ip(user_id, ip, mode) -> dict
backend/dlp/rate_limit.py                           # PRO_HOURLY_LIMIT 20 -> 12
backend/middleware/pro_guard.py                     # novo — Depends(enforce_pro_limits) p/ endpoints pagos
backend/main.py                                     # /generate-prompts usa o guard
backend/routes/protect.py                           # /protect usa o guard
backend/routes/bff_auth.py                          # login/google reivindicam o lock
backend/observability_metrics.py                    # atenna_pro_ip_lock_block (counter), atenna_pro_ip_lock_mode (gauge)
backend/tests/test_rate_limit_pro_hourly.py         # novo
backend/tests/test_pro_ip_lock.py                   # novo
backend/tests/test_client_ip.py                     # novo — header spoofing
```

## Contrato

### `pro_ip_locks`
```sql
create table pro_ip_locks (
  user_id       uuid primary key references auth.users(id) on delete cascade,
  active_ip     text not null,
  last_seen_at  timestamptz not null default now(),
  claimed_via   text not null default 'request',  -- 'request' | 'login'
  updated_at    timestamptz not null default now()
);
alter table pro_ip_locks enable row level security;
-- nenhuma policy p/ anon/authenticated → só service_role (backend) lê/escreve
```

### `check_and_claim_ip(user_id, ip, mode) -> dict`
```
GRACE_SECONDS = 900  # 15 min

lock = select * from pro_ip_locks where user_id = :uid
if not lock:
    upsert (uid, ip, now, 'request'); return {allowed: True, action: 'created'}
if lock.active_ip == ip:
    update last_seen_at = now; return {allowed: True, action: 'refreshed'}
# IP diferente
idle = now - lock.last_seen_at
if idle > GRACE_SECONDS:
    update active_ip = ip, last_seen_at = now, claimed_via 'request'
    return {allowed: True, action: 'adopted', prev_ip: lock.active_ip, idle_s: idle}
# IP antigo ainda ativo → conflito
return {allowed: mode != 'enforce', action: 'blocked', active_ip: lock.active_ip, idle_s: idle}
```

### `enforce_pro_limits` (Depends)
```
plan = get_user_plan(user_id)
if plan != 'pro': return   # free já tem o /dia; nada de IP lock
ip = get_client_ip(request)
res = check_and_claim_ip(user_id, ip, PRO_IP_LOCK_MODE)
if res['action'] == 'blocked':
    metrics.pro_ip_lock_block()
    audit_log(user_id, 'pro_ip_lock', metadata={mode, active_ip, idle_s})
    if PRO_IP_LOCK_MODE == 'enforce':
        raise HTTPException(429, {error: 'account_in_use_elsewhere',
            message: 'Sua conta PRO está em uso em outro local (IP ' + mask(active_ip) + ').'
                     ' Aguarde alguns minutos ou entre novamente para assumir a sessão.'})
```
O teto de 12/h continua sendo aplicado pelo `check_rate_limit` já existente (só muda a constante).

### Login reivindica o lock
`bff_auth.login` / `google`: após emitir o token, se `plan == 'pro'`:
`upsert pro_ip_locks (user_id, ip=get_client_ip(request), last_seen_at=now, claimed_via='login')`.

## Harness / Testes

### `test_rate_limit_pro_hourly.py`
1. `PRO_HOURLY_LIMIT == 12` (regressão da constante — o dono pediu 12 explícito).
2. PRO com 12 gerações na hora → 13ª → 429 `window='hour'`.
3. Free segue em 5/dia (não afeta).

### `test_pro_ip_lock.py` (todos com Supabase mockado)
1. 1ª request IP-A → `action='created'`, allowed.
2. 2ª request IP-A dentro da janela → `action='refreshed'`, `last_seen_at` avançou.
3. request IP-B com IP-A ativo (idle < 900s), `mode='enforce'` → `allowed=False`, `action='blocked'`, audit gravado.
4. request IP-B com IP-A ocioso (idle > 900s) → `action='adopted'`, allowed, `active_ip` virou IP-B.
5. `mode='shadow'` + conflito → `allowed=True` mas `action='blocked'` e métrica/audit gravados (não bloqueia, só observa).
6. `mode='off'` → `check_and_claim_ip` nem roda (guard retorna cedo).
7. login de IP-B → `pro_ip_locks.active_ip == IP-B`, `claimed_via='login'`.
8. usuário `free` → guard retorna sem tocar em `pro_ip_locks`.
9. Supabase lança exceção → `allowed=True` (fail-open) + `logger.error`.
10. mensagem 429 pro cliente tem IP **mascarado** (regex `\d+\.\d+\.\d+\.\d+` não casa inteiro).

### `test_client_ip.py` (teste de bypass — "nunca confiar no front")
1. Request com `X-Real-IP` setado (simula o que o nginx entrega) → `get_client_ip` devolve ele.
2. Request com `X-Forwarded-For: a, b, c` e sem `X-Real-IP` → devolve `a` (o 1º, o do cliente real).
3. Request com **só** `request.client.host` → devolve ele (fallback).
4. Documentar (comentário + teste-asserção): em produção o cliente **não** consegue setar
   `X-Real-IP` porque o `proxy_set_header X-Real-IP $remote_addr` do nginx sobrescreve. O
   backend confia no header porque só o nginx fala com ele (uvicorn em `127.0.0.1:8000`).

## Code review — 3 chapéus

**Arquiteto sênior**
- Enforcement no boundary do endpoint pago (Depends), não em todo request autenticado — free não
  paga o custo. Lock **por usuário** (não por token) porque o abuso é multi-device no mesmo assento.
- `client_ip.py` como fonte única — nenhum endpoint relê header na mão (já teve isso em
  `uninstall_feedback.py`).
- Fail-open no Supabase: consistente com a cota. O risco (janela de abuso durante um outage do
  Supabase) é aceitável vs. travar cliente pagante.
- **Risco real**: se a origem aceitar tráfego fora da Cloudflare, dá pra forjar `CF-Connecting-IP`
  → forjar o IP → furar o lock. **Pré-requisito**: Hetzner Cloud Firewall / UFW só liberando as
  faixas da Cloudflare pro 443 (P7.3). Anotar como dependência dura no rollout.
- `uvicorn` sem `--proxy-headers` hoje → `request.client.host` é o IP do container do nginx.
  `get_client_ip` tem que ler `X-Real-IP`/`X-Forwarded-For`, não `request.client`. (Não precisa
  mudar o uvicorn — só não depender do `request.client` pra isso.)

**Product Owner**
- Um assento PRO = 1 pessoa. Compartilhar fere o ToS. O caso legítimo (trocar de rede, viajar):
  15 min de espera **ou** re-login imediato. Fricção baixa, e o re-login é 1 clique no popup.
- Mensagem de erro tem que ser clara e dar a saída ("entre novamente para assumir a sessão"),
  não um 429 seco.
- `shadow` primeiro: se a taxa de "blocked" em shadow for alta entre contas que claramente são
  1 pessoa (mesmo /24, alternância wifi/4G), afrouxar a janela antes de `enforce`.

**PM / Estrategista**
- **On-strategy**: PRO é assento único → funil pra Plataforma (multi-tenant / times). Bloquear
  o compartilhamento de assento **empurra times pra Plataforma**, que é exatamente a esteira.
- Não implementa "gestão de times" na extensão (isso é da Plataforma) — só impõe o limite do
  produto atual.
- 12/h ainda é generoso pra 1 pessoa (a extensão é isca; quem precisa de volume vai pro pago maior).

## Riscos

| Risco | Mitigação |
|---|---|
| Forja de `CF-Connecting-IP` batendo direto na origem | **Bloqueante**: firewall só-Cloudflare no 443 antes de `enforce` (P7.3) |
| CGNAT / operadora móvel: 2 pessoas legítimas atrás do mesmo IP público | Isso **passa** no lock (mesmo IP) — não é problema |
| 1 pessoa, 2 devices ao mesmo tempo (desktop + celular) | Fere o limite de propósito; 15 min de janela cobre alternância, uso 100% simultâneo não. Documentar no /pro |
| `pro_ip_locks` cresce sem limpar | linha por usuário PRO (poucos milhares no máximo); job mensal apaga linha de quem não é mais PRO |
| Falso-positivo trava cliente pagante | `shadow` → medir → `enforce`; fail-open no erro; re-login sempre destrava |
| IPv6: prefixo muda a cada request em algumas redes | comparar por /64 no caso IPv6 (não o endereço inteiro) — anotado pra implementação |

## Rollout

1. **Fase 1 (agora, baixo risco):** `PRO_HOURLY_LIMIT` 20 → 12 + teste. Deploy.
2. **Fase 2 (esta spec):** migration `pro_ip_locks` + `client_ip.py` + `pro_ip_lock.py` +
   `enforce_pro_limits` guard, com `PRO_IP_LOCK_MODE=shadow`. Deploy. Login reivindica o lock.
3. **Fase 3 (após ~1 semana de shadow):** revisar métricas/audit de "blocked". Ajustar janela se
   preciso. **Pré-req: firewall só-Cloudflare no 443.** Flip `PRO_IP_LOCK_MODE=enforce`.
4. **Fase 4 (follow-up):** copy no `/pro` e no popup explicando "1 assento = 1 pessoa/lugar".
