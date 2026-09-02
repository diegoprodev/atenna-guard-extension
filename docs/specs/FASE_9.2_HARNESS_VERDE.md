# FASE 9.2 — Harness verde (pré-requisito do CI/CD)

**Status:** em implementação · **Depende de:** FASE 9.0/9.1 · **Bloqueia:** P3 (CI/CD)
**Não bloqueia:** republicação da extensão (mas o CI que a destrava, sim).

## Problema

`pytest` no container de produção: **~37 falhas + 1 erro de coleta** (baseline, não
regressão da 9.1). CI precisa de base verde para servir de alarme — hoje não dá para
distinguir "quebrei algo" de "já estava vermelho".

**Ao triar, achamos bugs reais escondidos no vermelho** (não é só teste velho):

| # | Categoria | Gravidade | Achado |
|---|---|---|---|
| B1 | DLP — proteção / robustez | Média | Triado: os testes `test_rewrite_email`/`test_rewrite_multiple_entities` têm **offset errado no fixture** (`end` > `len(text)`), e `rewrite_pii_tokens` **descarta** o span quando `end > len(text)` (linha 63) — correto para não corromper, mas **um offset levemente fora faz a PII vazar** em vez de ser mascarada. Fix: **clampar** `start=max(0,start)`, `end=min(len,end)` em vez de descartar + corrigir os fixtures + caso EMAIL no E2E strict. |
| B2 | DLP — detecção | Média | `scanner.scan("Cartão: 4111 1111 1111 1111")` **não detecta `CREDIT_CARD`** (prefixo acentuado quebra o regex). |
| B3 | DLP — detecção | Média | `LEGAL_CONTEXT` — regex morto, `test_contexto_juridico` falha. |
| B4 | Feature Pro — export | Média | `export_manager` PDF quebrado: `fpdf2.output()` passou a devolver `bytearray`, o código chama `.encode()` → `'bytearray' object has no attribute 'encode'` (11 testes). Export LGPD do usuário não gera PDF. |
| B5 | Upload — abuso | Baixa | docx zip-bomb é rejeitado, mas com `error_code = malformed_document` em vez de `file_too_large`. |

| # | Categoria | Ação |
|---|---|---|
| T1 | `tests/test_bff_auth.py` (5) + `test_auth_middleware.py::test_valid_opaque_token_accepted` | mock de `get_admin_client` não satisfaz o probe `_check_table()` (`.table('bff_sessions').select(...).limit(0)`) → cai no fallback in-memory → token injetado não é achado. **Consertar o fixture** (mockar o probe) ou expor um hook de teste em `bff_auth`. |
| T2 | `dlp/test_retention_manager.py` (2), `dlp/test_supabase_persistence.py` (3) | dependem de tabelas/creds Supabase. **`pytest.mark.skipif`** quando sem `SUPABASE_URL`/tabela, OU mock do client. Não podem falhar por ambiente. |
| T3 | `tests/test_google_auth.py` (7) | órfão — `_extract_google_user` não existe mais em `bff_auth`. **Reescrever** contra o contrato atual de `/auth/google` OU deletar se a cobertura já está em `test_bff_auth`. |
| T4 | `tests/test_pdf_parser_v2.py` | erro de coleta (`_format_table_as_text` não existe). Arquivo **só existe na VPS**, não no repo. **Deletar da VPS.** |
| T5 | `dlp/test_deletion_manager.py::test_fallback_mode_graceful` | investigar (provável mesmo padrão de mock). |

## Decisões

| Tema | Decisão | Porquê |
|---|---|---|
| Bugs reais (B1–B5) | **Corrigir**, cada um com teste que falha antes | é o valor real da fase; B1 é vazamento de PII |
| Testes de ambiente (T2) | `skipif` sem credencial + rodar de verdade no CI com Supabase de teste | CI não pode depender de infra externa opcional |
| Órfãos (T3, T4) | reescrever se cobre algo único; senão deletar | teste que não roda é dívida, não cobertura |
| Fixture de auth (T1) | um `conftest.py` em `tests/` com fixture `bff_table_ok` que mocka `_check_table` | corrige os 6 de uma vez, sem tocar em prod |
| Baseline | ao fim: `pytest` no container = **0 falhas, 0 erros** | é o gate do P3 |
| `requirements-dev.txt` | já existe; garantir que `pytest`, `pytest-asyncio`, `httpx` cobrem tudo | CI instala isso |

## Arquivos

```
backend/dlp/enforcement.py            # B1 — _TOKEN_MAP: EMAIL_ADDRESS -> [EMAIL] (+ PHONE, etc.)
backend/dlp/scanner.py                # B2 — regex de cartão tolera prefixo acentuado ; B3 — LEGAL_CONTEXT
backend/dlp/export_manager.py         # B4 — fpdf2 output(): bytes(bytearray) em vez de .encode()
backend/document/parsers/docx_parser.py  # B5 — zip-bomb -> FILE_TOO_LARGE
backend/tests/conftest.py             # T1 — fixture de mock do _check_table (novo)
backend/tests/test_google_auth.py     # T3 — reescrito ou removido
backend/dlp/test_retention_manager.py, dlp/test_supabase_persistence.py  # T2 — skipif
VPS: /root/atenna-backend/tests/test_pdf_parser_v2.py  # T4 — rm
backend/tests/test_fase_9_2_regressao.py  # novo — 1 teste por bug (B1–B5) que falha antes do fix
```

## Testes (regressão — falham ANTES do fix)

1. `rewrite_pii_tokens("email x@y.com", [{"type":"EMAIL_ADDRESS",0..}])` → contém `[EMAIL]`.
2. `evaluate_strict_enforcement` com e-mail cru + STRICT → texto reescrito sem o e-mail.
3. `scanner.scan("Cartão: 4111 1111 1111 1111")` → acha `CREDIT_CARD`.
4. `scanner.scan(<contexto jurídico>)` → `LEGAL_CONTEXT` detectado.
5. `export_manager` gera PDF → retorna `bytes`, não levanta.
6. docx zip-bomb → `error_code == FILE_TOO_LARGE`.
7. suíte inteira no container: `0 failed, 0 error`.

## Code review (3 chapéus) — preencher em `FASE_9.2_CODE_REVIEW.md` antes do commit

- **Arquiteto:** B1 muda o caminho quente do DLP — o `_TOKEN_MAP` tem que ser exaustivo e ter
  fallback genérico `[DADO]` para tipo desconhecido (nunca deixar cru). Merge de spans já existe (9.0).
- **PO:** B1/B4 são promessa direta do produto ("proteja seus dados" / "exporte seus dados LGPD").
  Corrigir aumenta a confiança no free e no Pro.
- **PM:** nada aqui implementa capacidade da Plataforma; é dívida técnica do próprio núcleo. OK.

## Rollout

Por bug: teste vermelho → fix → teste verde → rodar suíte → sem regressão. Ao fim: 1 rebuild,
deploy, `pytest` 0/0 no container, CHANGELOG, commit único por bug ou agrupado por categoria, push.
