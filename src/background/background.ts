const BACKEND_URL    = 'https://atennaplugin.maestro-n8n.site/generate-prompts';
const CHECKOUT_URL   = 'https://atennaplugin.maestro-n8n.site/checkout/create';
const ANALYTICS_URL  = 'https://atennaplugin.maestro-n8n.site/track';
const JWT_KEY       = 'atenna_jwt';

function decodeJwtPayload(token: string): Record<string, unknown> {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) throw new Error('Invalid JWT format');
    const decoded = atob(parts[1].replace(/-/g, '+').replace(/_/g, '/'));
    return JSON.parse(decoded);
  } catch {
    return {};
  }
}

chrome.runtime.onInstalled.addListener(() => {
  console.log('[Atenna Guard] Extension installed.');
});

async function getStoredJWT(): Promise<string | null> {
  return new Promise(resolve => {
    try {
      chrome.storage.local.get(JWT_KEY, r => {
        const session = r[JWT_KEY] as { access_token?: string } | undefined;
        resolve(session?.access_token ?? null);
      });
    } catch { resolve(null); }
  });
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
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

    getStoredJWT().then(jwt => {
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
              sendResponse({
                ok: false,
                error: 'daily_limit_reached',
                status: 429,
                limit: body?.detail?.limit ?? 10,
                count: body?.detail?.count ?? 10,
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
    getStoredJWT().then(jwt => {
      if (!jwt) { sendResponse({ ok: false, error: 'auth_required' }); return; }
      return fetch(CHECKOUT_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${jwt}` },
      })
        .then(res => {
          if (!res.ok) { sendResponse({ ok: false, status: res.status }); return; }
          return res.json().then(data => sendResponse({ ok: true, url: data.url }));
        });
    }).catch(err => sendResponse({ ok: false, error: String(err) }));
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

chrome.tabs.onUpdated.addListener((_tabId, changeInfo, tab) => {
  // Listen for magic link callback from Supabase
  if (changeInfo.url && changeInfo.url.includes('#access_token=')) {
    const url = new URL(changeInfo.url);
    const fragment = url.hash.substring(1);
    const params = new URLSearchParams(fragment);
    const accessToken = params.get('access_token');
    const expiresIn = params.get('expires_in');

    if (accessToken && expiresIn) {
      const payload = decodeJwtPayload(accessToken);
      const email = payload.email as string | undefined;

      if (email) {
        const expiresAtSeconds = Math.floor(Date.now() / 1000) + parseInt(expiresIn, 10);
        chrome.storage.local.set({
          [JWT_KEY]: {
            access_token: accessToken,
            email,
            expires_at: expiresAtSeconds,
          },
        });
      }
    }
  }
});
