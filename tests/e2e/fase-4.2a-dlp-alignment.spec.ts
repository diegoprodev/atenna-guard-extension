/**
 * FASE 4.2A / 9.0 — DLP server-side E2E (backend REAL, autenticado)
 *
 * Valida o contrato REAL de POST /dlp/scan → Presidio pipeline → ScanResponse:
 *   { risk_level, score, entities: [{type,value,start,end,score}], advisory, show_warning, duration_ms }
 *
 * (O mascaramento / [CPF] acontece no /generate-prompts via enforcement — coberto
 *  pelo harness backend `test_engine_revalidate_reconciliation` + fase-5.1.)
 *
 * Precisa de ATENNA_TEST_TOKEN (token BFF opaco de um usuário de teste). Sem ele, skip.
 */
import { test, expect } from '@playwright/test';

const BACKEND_URL = 'https://api.atennaia.com.br';

async function dlpScan(
  text: string,
  token: string,
  request: import('@playwright/test').APIRequestContext,
) {
  return request.post(`${BACKEND_URL}/dlp/scan`, {
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    data: { text },
  });
}

const types = (body: { entities?: Array<{ type?: string }> }) =>
  (body.entities ?? []).map((e) => e.type ?? '');

test.describe('FASE 4.2A — DLP server-side E2E', () => {
  const TOKEN = process.env.ATENNA_TEST_TOKEN ?? '';
  test.beforeEach(() => {
    if (!TOKEN) test.skip();
  });

  test('CPF válido → entity BR_CPF + risk HIGH', async ({ request }) => {
    const res = await dlpScan('CPF do cliente: 529.982.247-25', TOKEN, request);
    expect(res.ok()).toBeTruthy();
    const body = await res.json();
    expect(types(body)).toContain('BR_CPF');
    expect(body.risk_level).toBe('HIGH');
    expect(body.show_warning).toBe(true);
  });

  test('CPF inválido (dígito verificador errado) → NÃO detectado', async ({ request }) => {
    const res = await dlpScan('CPF: 111.111.111-11', TOKEN, request);
    expect(res.ok()).toBeTruthy();
    expect(types(await res.json())).not.toContain('BR_CPF');
  });

  test('cartão Luhn válido → CREDIT_CARD + HIGH', async ({ request }) => {
    const res = await dlpScan('cartão 4111 1111 1111 1111', TOKEN, request);
    const body = await res.json();
    expect(types(body)).toContain('CREDIT_CARD');
    expect(body.risk_level).toBe('HIGH');
  });

  test('JWT → entity TOKEN + HIGH', async ({ request }) => {
    const jwt =
      'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4gRG9lIn0.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c';
    const res = await dlpScan(`Authorization: Bearer ${jwt}`, TOKEN, request);
    const body = await res.json();
    expect(types(body)).toContain('TOKEN');
    expect(body.risk_level).toBe('HIGH');
  });

  test('API key OpenAI → API_KEY + HIGH', async ({ request }) => {
    const res = await dlpScan(
      'chave: sk-proj-ABCDEFGHIJKLMNOPQRSTUVWXYZ1234567890',
      TOKEN,
      request,
    );
    const body = await res.json();
    expect(types(body)).toContain('API_KEY');
    expect(body.risk_level).toBe('HIGH');
  });

  test('recognizers PT-BR: RG, CNH, OAB, placa, CRM', async ({ request }) => {
    const res = await dlpScan(
      'RG: 12.345.678-9, habilitação 01234567890, OAB/SP 123456, placa ABC1D23, CRM/RJ 54321',
      TOKEN,
      request,
    );
    const t = types(await res.json());
    for (const e of ['RG', 'CNH', 'OAB', 'PLACA', 'CRM']) expect(t).toContain(e);
  });

  test('texto técnico → sem falso positivo, risk NONE', async ({ request }) => {
    const res = await dlpScan(
      'the observer pattern in typescript uses a subject and listeners',
      TOKEN,
      request,
    );
    const body = await res.json();
    expect(body.risk_level === 'NONE' || body.risk_level === 'LOW').toBeTruthy();
    expect(types(body)).not.toContain('PERSON');
  });

  test('combinação CPF + RG + cartão → HIGH', async ({ request }) => {
    const res = await dlpScan(
      'CPF: 529.982.247-25, RG: 12.345.678-9, cartão 4111 1111 1111 1111',
      TOKEN,
      request,
    );
    const body = await res.json();
    expect(body.risk_level).toBe('HIGH');
    expect((body.entities ?? []).length).toBeGreaterThanOrEqual(3);
  });

  test('backend health responde (assert_safe_llm_url não quebrou o boot)', async ({ request }) => {
    const res = await request.get(`${BACKEND_URL}/health`);
    expect(res.status()).toBe(200);
  });

  test('paridade cliente↔servidor: mesmos tipos para o mesmo input (SI-15)', async ({ request }) => {
    // O cliente (src/dlp) detecta BR_CPF + CREDIT_CARD para este input; o servidor idem.
    const res = await dlpScan('CPF 529.982.247-25 e cartão 4111 1111 1111 1111', TOKEN, request);
    const t = types(await res.json());
    expect(t).toEqual(expect.arrayContaining(['BR_CPF', 'CREDIT_CARD']));
  });
});
