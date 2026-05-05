const BACKEND_URL   = 'http://localhost:8000/generate-prompts';
const ANALYTICS_URL = 'http://localhost:8000/track';
const JWT_KEY       = 'atenna_jwt';

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

    getStoredJWT().then(jwt => {
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (jwt) headers['Authorization'] = `Bearer ${jwt}`;

      return fetch(BACKEND_URL, {
        method:  'POST',
        headers,
        body:    JSON.stringify({ input: inputText }),
      });
    })
      .then(res => {
        if (!res.ok) { sendResponse({ ok: false, status: res.status }); return; }
        return res.json().then(data => sendResponse({ ok: true, data }));
      })
      .catch(err => {
        console.warn('[Atenna] background fetch error:', err);
        sendResponse({ ok: false, error: String(err) });
      });

    return true; // keep channel open
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
