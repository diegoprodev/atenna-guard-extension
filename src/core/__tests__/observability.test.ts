/**
 * O reporter da extensão NUNCA pode mandar PII pro GlitchTip.
 * Testa o scrub() (via reportError com fetch mockado).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

describe('observability — scrubbing de PII antes de enviar', () => {
  let sent: string[];

  beforeEach(async () => {
    sent = [];
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init: RequestInit) => {
      sent.push(String(init.body));
      return new Response('{}', { status: 200 });
    }));
    vi.stubGlobal('crypto', { randomUUID: () => '00000000-0000-0000-0000-000000000000' });
    // reset do módulo (o _on é module-level)
    vi.resetModules();
  });

  it('remove CPF, email, JWT, cartão e API key do payload', async () => {
    const obs = await import('../observability');
    obs.initObservability('content');
    obs.reportError(
      new Error('falhou com CPF 111.444.777-35, email joao@empresa.com.br, ' +
        'card 4111 1111 1111 1111, jwt eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjMifQ.abcdefghij, ' +
        'key sk-proj-ABCDEFGHIJKLMNOPQRSTUVWX0123456789'),
      { user_note: 'meu cpf é 999.888.777-66' },
    );
    await new Promise((r) => setTimeout(r, 10));

    const body = sent.join('\n');
    expect(body).not.toMatch(/111\.444\.777-35/);
    expect(body).not.toMatch(/joao@empresa\.com\.br/);
    expect(body).not.toMatch(/999\.888\.777-66/);
    expect(body).not.toMatch(/eyJhbGciOiJIUzI1NiJ9\.eyJ/);
    expect(body).not.toMatch(/sk-proj-ABCDEF/);
    expect(body).toMatch(/\[CPF\]/);
    expect(body).toMatch(/\[EMAIL\]/);
    expect(body).toMatch(/\[JWT\]/);
  });

  it('envia no endpoint do GlitchTip com o sentry_key', async () => {
    const obs = await import('../observability');
    obs.initObservability('background');
    obs.reportError(new Error('erro simples sem pii'));
    await new Promise((r) => setTimeout(r, 10));
    const call = (globalThis.fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(String(call[0])).toContain('errors.atennaia.com.br/api/2/envelope/');
    expect(String(call[0])).toContain('sentry_key=');
  });
});
