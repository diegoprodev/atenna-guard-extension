const BACKEND_URL = 'http://localhost:8000/generate-prompts';

chrome.runtime.onInstalled.addListener(() => {
  console.log('[Atenna Guard] Extension installed.');
});

// Proxy fetch from content scripts — content scripts in HTTPS pages cannot
// make HTTP requests (mixed content). Background workers are exempt.
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg.type !== 'ATENNA_FETCH') return false;

  fetch(BACKEND_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ input: msg.input }),
  })
    .then(res => {
      if (!res.ok) { sendResponse({ ok: false, status: res.status }); return; }
      return res.json().then(data => sendResponse({ ok: true, data }));
    })
    .catch(err => {
      console.error('[Atenna] background fetch error:', err);
      sendResponse({ ok: false, error: String(err) });
    });

  return true; // keep message channel open for async response
});
