/**
 * Observabilidade da extensão — reporter dependency-free para GlitchTip
 * (protocolo Sentry envelope). Sem npm deps: o content.js carrega em toda
 * página de IA, então cada KB conta.
 *
 * Captura: window.onerror, unhandledrejection, e chamadas manuais reportError().
 * Envia com contexto (surface / platform / release / quando) e SEM PII.
 */
import { VERSION } from '../config';

// DSN público do projeto "extension" no GlitchTip (write-only ingest — não é segredo).
const PUBLIC_KEY = '8c4039cd2a10459fa000564b7ec0ef55';
const HOST = 'errors.atennaia.com.br';
const PROJECT_ID = '2';
const ENDPOINT = `https://${HOST}/api/${PROJECT_ID}/envelope/`;
const RELEASE = `atenna-safe-prompt@${VERSION}`;

let _surface = '';
let _userId: string | null = null;
let _plan: string | undefined;
let _on = false;
let _lastSig = '';
let _lastAt = 0;

// ── PII scrubbing ───────────────────────────────────────────────────────────
const RX: Array<[RegExp, string]> = [
  [/\beyJ[A-Za-z0-9_\-]{10,}\.[A-Za-z0-9_\-]{10,}\.[A-Za-z0-9_\-]{10,}\b/g, '[JWT]'],
  [/\bsk-proj-[A-Za-z0-9_\-]{16,}/g, '[KEY]'],
  [/\b(?:sk-[A-Za-z0-9]{16,}|sk_live_[A-Za-z0-9]{10,}|sk-ant-[A-Za-z0-9_\-]{16,}|re_[A-Za-z0-9_]{10,}|AKIA[0-9A-Z]{16}|AIza[0-9A-Za-z_\-]{35})\b/g, '[KEY]'],
  [/(?:bearer\s+)[A-Za-z0-9._\-]+/gi, 'Bearer [TOKEN]'],
  [/\b\d{3}\.?\d{3}\.?\d{3}-?\d{2}\b/g, '[CPF]'],
  [/\b\d{2}\.?\d{3}\.?\d{3}\/?\d{4}-?\d{2}\b/g, '[CNPJ]'],
  [/\b(?:\d[ -]?){13,19}\b/g, '[CARD]'],
  [/\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g, '[EMAIL]'],
];
const scrub = (s: string): string => RX.reduce((a, [rx, t]) => a.replace(rx, t), String(s ?? ''));

function platform(): string {
  const h = typeof location !== 'undefined' ? location.hostname : '';
  if (h.includes('chatgpt') || h.includes('openai')) return 'chatgpt';
  if (h.includes('claude')) return 'claude';
  if (h.includes('gemini')) return 'gemini';
  if (h.includes('perplexity')) return 'perplexity';
  return h || 'extension';
}

function uuid(): string {
  return (crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`).replace(/-/g, '');
}

function parseFrames(stack?: string): Array<Record<string, unknown>> {
  if (!stack) return [];
  return stack
    .split('\n')
    .slice(1, 25)
    .map((l) => {
      const m = l.match(/at (?:(.+?) )?\(?(.+?):(\d+):(\d+)\)?$/);
      if (!m) return { function: scrub(l.trim()) };
      return {
        function: m[1] || '?',
        filename: scrub(m[2]),
        lineno: Number(m[3]),
        colno: Number(m[4]),
        in_app: !m[2].includes('node_modules'),
      };
    })
    .reverse();
}

async function send(payload: Record<string, unknown>): Promise<void> {
  if (!_on) return;
  const sig = `${payload['exception'] ? JSON.stringify((payload['exception'] as any)?.values?.[0]?.value) : payload['message']}`;
  const now = Date.now();
  if (sig === _lastSig && now - _lastAt < 5000) return; // dedupe rajada
  _lastSig = sig;
  _lastAt = now;

  const eventId = uuid();
  const event = {
    event_id: eventId,
    timestamp: now / 1000,
    platform: 'javascript',
    release: RELEASE,
    environment: 'production',
    level: (payload['level'] as string) || 'error',
    tags: { surface: _surface, platform: platform(), ...(_plan ? { plan: _plan } : {}) },
    user: _userId ? { id: _userId } : undefined,
    ...payload,
  };
  const body =
    JSON.stringify({ event_id: eventId, sent_at: new Date().toISOString() }) +
    '\n' + JSON.stringify({ type: 'event' }) +
    '\n' + JSON.stringify(event);

  try {
    await fetch(`${ENDPOINT}?sentry_key=${PUBLIC_KEY}&sentry_version=7`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-sentry-envelope' },
      body,
      keepalive: true,
    });
  } catch {
    /* nunca deixar o reporter quebrar a extensão */
  }
}

/** Chamar uma vez por contexto. */
export function initObservability(surface: 'background' | 'content' | 'popup' | 'welcome'): void {
  if (_on) return;
  _surface = surface;
  _on = true;

  try {
    self.addEventListener('error', (e: ErrorEvent) => {
      void send({
        exception: { values: [{ type: e.error?.name || 'Error', value: scrub(e.message), stacktrace: { frames: parseFrames(e.error?.stack) } }] },
      });
    });
    self.addEventListener('unhandledrejection', (e: PromiseRejectionEvent) => {
      const r: any = e.reason;
      void send({
        exception: { values: [{ type: r?.name || 'UnhandledRejection', value: scrub(r?.message || String(r)), stacktrace: { frames: parseFrames(r?.stack) } }] },
      });
    });
  } catch { /* noop */ }
}

/** Anexa "quem" às issues. */
export function setObsUser(userId: string | null, plan?: string): void {
  _userId = userId;
  _plan = plan;
}

/** Reportar erro manualmente com contexto. */
export function reportError(err: unknown, context?: Record<string, unknown>): void {
  const e: any = err;
  void send({
    exception: { values: [{ type: e?.name || 'Error', value: scrub(e?.message || String(err)), stacktrace: { frames: parseFrames(e?.stack) } }] },
    contexts: context ? { atenna: JSON.parse(scrub(JSON.stringify(context))) } : undefined,
  });
}
