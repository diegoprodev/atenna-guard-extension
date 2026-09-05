import { initObservability } from '../core/observability';
initObservability('background');
import { getSession } from '../auth/sessionManager';
import { BFF_BASE } from '../config';

self.addEventListener('unhandledrejection', (event: PromiseRejectionEvent) => {
  console.error('[Atenna] unhandledrejection:', event.reason);
});

const BACKEND_URL    = `${BFF_BASE}/generate-prompts`;
const CHECKOUT_URL   = `${BFF_BASE}/checkout/create`;
const ANALYTICS_URL  = `${BFF_BASE}/track`;
const PROXY_ALLOWED_HOST = new URL(BFF_BASE).hostname;

chrome.runtime.onInstalled.addListener(() => {
  console.log('[Atenna Guard] Extension installed.');
});

// FASE 10.9 (B12) — libera chrome.storage.session pro content script.
// Por padrão só TRUSTED_CONTEXTS (background/popup) acessam. O analytics roda
// no content script e chamava storage.session → dezenas de
// "Unchecked runtime.lastError: Access to storage is not allowed from this context".
try {
  chrome.storage.session.setAccessLevel({ accessLevel: 'TRUSTED_AND_UNTRUSTED_CONTEXTS' })
    .catch(() => { /* API ausente em versões antigas do Chrome */ });
} catch { /* noop */ }

// Página de feedback aberta pelo Chrome quando o usuário remove a extensão (FASE 10.6).
try {
  chrome.runtime.setUninstallURL(`${BFF_BASE}/desinstalado`);
} catch { /* setUninstallURL indisponível em contexto de teste */ }

// ── Badge após login — backstop no service worker ────────────────────────
// O popup só manda RELAY_INJECT_BADGE enquanto está vivo. No login com Google
// (chrome.identity.launchWebAuthFlow) o popup já fechou quando o fluxo volta,
// então a mensagem se perde e o badge só aparece no reload da página.
// Aqui o SW observa a sessão no storage e injeta o badge em toda aba suportada
// que já esteja aberta — funciona pra e-mail, Google e login pela welcome.
// Fonte única: os mesmos matches do content script (o script de E2E injeta
// localhost aqui, então o backstop também vale nos testes).
function supportedTabMatches(): string[] {
  try {
    const cs = chrome.runtime.getManifest().content_scripts ?? [];
    const all = cs.flatMap(s => s.matches ?? []);
    return all.length ? all : ['https://chatgpt.com/*'];
  } catch {
    return ['https://chatgpt.com/*'];
  }
}

function broadcastToSupportedTabs(message: { type: string }): void {
  try {
    chrome.tabs.query({ url: supportedTabMatches() }, tabs => {
      void chrome.runtime.lastError;
      for (const t of tabs) {
        if (typeof t.id === 'number') {
          chrome.tabs.sendMessage(t.id, message, () => void chrome.runtime.lastError);
        }
      }
    });
  } catch { /* tabs API indisponível em teste */ }
}

try {
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local' || !('atenna_session' in changes)) return;
    const { oldValue, newValue } = changes['atenna_session'];
    if (newValue && !oldValue) {
      // sessão nova → injeta o badge nas abas já abertas
      broadcastToSupportedTabs({ type: 'INJECT_BADGE' });
    }
  });
} catch { /* storage.onChanged indisponível em teste */ }

// Returns the BFF opaque token (accepted by all backend routes).
async function getBffToken(): Promise<string | null> {
  try {
    const session = await getSession();
    return session?.token ?? null;
  } catch { return null; }
}

chrome.runtime.onInstalled.addListener(async (details) => {
  if (details.reason !== 'install') return;
  const { atenna_welcomed } = await chrome.storage.local.get('atenna_welcomed');
  if (atenna_welcomed) return;
  await chrome.storage.local.set({ atenna_welcomed: true });
  chrome.tabs.create({ url: chrome.runtime.getURL('welcome.html') });
});

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  // Only accept messages from this extension itself
  if (sender.id !== chrome.runtime.id) {
    sendResponse({ ok: false, error: 'unauthorized' });
    return false;
  }

  // ── Relay TOGGLE_MODAL to a specific tab (tabId passed from popup) ──
  if (msg.type === 'RELAY_TOGGLE_MODAL') {
    const tabId = typeof msg.tabId === 'number' ? msg.tabId : null;
    if (tabId) {
      chrome.tabs.sendMessage(tabId, { type: 'TOGGLE_MODAL' }, () => void chrome.runtime.lastError);
    }
    sendResponse({ ok: true });
    return true;
  }

  // ── Relay INJECT_BADGE — injects badge without opening the modal ──
  if (msg.type === 'RELAY_INJECT_BADGE') {
    const tabId = typeof msg.tabId === 'number' ? msg.tabId : null;
    if (tabId) {
      chrome.tabs.sendMessage(tabId, { type: 'INJECT_BADGE' }, () => void chrome.runtime.lastError);
    }
    sendResponse({ ok: true });
    return true;
  }

  // ── Prompt generation ────────────────────────────────────
  if (msg.type === 'ATENNA_FETCH') {
    const inputText = typeof msg.input === 'string' ? msg.input.trim() : '';
    if (!inputText) {
      sendResponse({ ok: false, error: 'empty input' });
      return true;
    }

    // Extract DLP metadata from message (passed by content script)
    const dlpMetadata = msg.dlp || {
      dlp_enabled: false,
      dlp_risk_level: 'NONE',
      dlp_entity_types: [],
      dlp_entity_count: 0,
      dlp_was_rewritten: false,
      dlp_user_override: false,
      dlp_client_score: 0,
    };

    getBffToken().then(jwt => {
      // JWT is mandatory — reject silently if not present
      if (!jwt) {
        sendResponse({ ok: false, error: 'auth_required', status: 401 });
        return;
      }

      return fetch(BACKEND_URL, {
        method:  'POST',
        headers: {
          'Content-Type':  'application/json',
          'Authorization': `Bearer ${jwt}`,
        },
        body: JSON.stringify({
          input: inputText,
          dlp: dlpMetadata,
        }),
      })
        .then(res => {
          if (res.status === 401) { sendResponse({ ok: false, error: 'auth_required', status: 401 }); return; }
          if (res.status === 429) {
            return res.json().then(body => {
              // FASE P-ZT.4 — o 429 pode ser cota (daily_limit_reached) OU
              // "conta em uso em outro IP" (account_in_use_elsewhere). O
              // backend diz qual em body.detail.error.
              const be = body?.detail?.error;
              if (be === 'account_in_use_elsewhere') {
                sendResponse({
                  ok: false,
                  error: 'account_in_use_elsewhere',
                  status: 429,
                  message: body?.detail?.message ?? '',
                  hint: body?.detail?.hint ?? '',
                });
                return;
              }
              sendResponse({
                ok: false,
                error: 'daily_limit_reached',
                status: 429,
                limit: body?.detail?.limit ?? 5,
                count: body?.detail?.count ?? 5,
                reset_at: body?.detail?.reset_at ?? null,
              });
            }).catch(() => sendResponse({ ok: false, error: 'daily_limit_reached', status: 429 }));
          }
          if (!res.ok) {
            console.warn('[Atenna] backend HTTP error:', res.status, res.statusText);
            sendResponse({ ok: false, status: res.status });
            return;
          }
          return res.json().then(data => sendResponse({ ok: true, data }));
        });
    })
      .catch(err => {
        console.warn('[Atenna] background fetch error:', err);
        sendResponse({ ok: false, error: String(err) });
      });

    return true; // keep channel open
  }

  // ── Checkout session creation ─────────────────────────────
  if (msg.type === 'ATENNA_CHECKOUT') {
    const plan = (msg.plan === 'monthly') ? 'monthly' : (msg.plan === 'pix_yearly') ? 'pix_yearly' : 'yearly';
    getBffToken().then(jwt => {
      if (!jwt) { sendResponse({ ok: false, error: 'auth_required' }); return; }
      return fetch(CHECKOUT_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${jwt}` },
        body: JSON.stringify({ plan }),
      })
        .then(res => {
          if (!res.ok) { sendResponse({ ok: false, status: res.status }); return; }
          return res.json().then(data => sendResponse({ ok: true, url: data.url, plan: data.plan }));
        });
    }).catch(err => sendResponse({ ok: false, error: String(err) }));
    return true;
  }

  // ── BFF token relay (for upload-widget / content scripts in iframes) ────
  if (msg.type === 'GET_BFF_TOKEN' || msg.type === 'GET_AUTH_TOKEN') {
    getBffToken().then(token => sendResponse({ token: token ?? null })).catch(() => sendResponse({ token: null }));
    return true;
  }

  // ── Document protect proxy (CORS bypass para content scripts) ──
  if (msg.type === 'ATENNA_PROTECT_FILE') {
    const { fileBase64, fileName, mimeType, token } = msg as {
      fileBase64: string; fileName: string; mimeType: string; token: string;
    };
    getBffToken().then(jwt => {
      const authToken = token || jwt;
      if (!authToken) { sendResponse({ ok: false, error: 'auth_required' }); return; }

      // Reconstrói bytes a partir do base64 (safe para qualquer tamanho)
      const binary = atob(fileBase64);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
      const blob = new Blob([bytes], { type: mimeType });
      const formData = new FormData();
      formData.append('file', blob, fileName);

      return fetch(`${BFF_BASE}/document/protect`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${authToken}` },
        body: formData,
      }).then(async res => {
        const body = await res.text();
        sendResponse({ ok: res.ok, status: res.status, body });
      });
    }).catch(err => sendResponse({ ok: false, status: 0, error: String(err) }));
    return true;
  }

  // ── Export protected document (retorna binário como base64) ─────────────
  if (msg.type === 'ATENNA_EXPORT_PROTECTED') {
    const { fileBase64, fileName, mimeType, token } = msg as {
      fileBase64: string; fileName: string; mimeType: string; token: string;
    };
    getBffToken().then(jwt => {
      const authToken = token || jwt;
      if (!authToken) { sendResponse({ ok: false, error: 'auth_required' }); return; }

      const binary = atob(fileBase64);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
      const blob = new Blob([bytes], { type: mimeType });
      const formData = new FormData();
      formData.append('file', blob, fileName);

      return fetch(`${BFF_BASE}/document/export-protected`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${authToken}` },
        body: formData,
      }).then(async res => {
        if (!res.ok) {
          const body = await res.text();
          sendResponse({ ok: false, status: res.status, body });
          return;
        }
        // Retorna binário como base64 + headers relevantes
        const arrBuf = await res.arrayBuffer();
        const outBytes = new Uint8Array(arrBuf);
        let b64 = '';
        for (let i = 0; i < outBytes.length; i++) b64 += String.fromCharCode(outBytes[i]);
        const resultB64 = btoa(b64);
        const contentType = res.headers.get('content-type') ?? 'application/octet-stream';
        const disposition = res.headers.get('content-disposition') ?? '';
        const fallback = res.headers.get('x-fallback-used') === '1';
        const needsReview = res.headers.get('x-needs-review') === '1';
        sendResponse({ ok: true, resultB64, contentType, disposition, fallback, needsReview });
      });
    }).catch(err => sendResponse({ ok: false, status: 0, error: String(err) }));
    return true;
  }

  // ── Generic backend proxy (content scripts bloqueados por CSP) ──
  if (msg.type === 'ATENNA_PROXY_FETCH') {
    const { url, method, token, body: reqBody } = msg as {
      url: string; method: string; token: string; body?: unknown;
    };
    try {
      const parsed = new URL(url);
      if (parsed.hostname !== PROXY_ALLOWED_HOST || parsed.protocol !== 'https:') {
        sendResponse({ ok: false, status: 403, error: 'unauthorized_url' });
        return true;
      }
    } catch {
      sendResponse({ ok: false, status: 400, error: 'invalid_url' });
      return true;
    }
    const opts: RequestInit = {
      method,
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
      },
    };
    if (reqBody !== undefined) opts.body = JSON.stringify(reqBody);
    fetch(url, opts)
      .then(async res => {
        const text = await res.text();
        sendResponse({ ok: res.ok, status: res.status, body: text });
      })
      .catch(err => sendResponse({ ok: false, status: 0, error: String(err) }));
    return true;
  }

  // ── Analytics (fire-and-forget, no response needed) ──────
  if (msg.type === 'ATENNA_TRACK') {
    fetch(ANALYTICS_URL, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(msg.payload),
    }).catch(() => { /* silently ignore */ });
    return false;
  }

  return false;
});
