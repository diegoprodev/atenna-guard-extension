const PANEL_ID = 'atenna-panel';

function getLogoUrl(): string {
  try { return chrome.runtime.getURL('icons/icon128.png'); }
  catch { return ''; }
}

// Detects the platform's actual in-app theme by measuring the luminance of
// document.body's computed background. Reliable across ChatGPT/Claude/Gemini
// theme toggles which are independent of the OS preference.
function isDark(): boolean {
  const bg = getComputedStyle(document.body).backgroundColor;
  const m = bg.match(/\d+/g);
  if (m && m.length >= 3) {
    const lum = 0.299 * +m[0] + 0.587 * +m[1] + 0.114 * +m[2];
    return lum < 128;
  }
  // Fallback to OS preference
  return window.matchMedia('(prefers-color-scheme: dark)').matches;
}

export function togglePanel(platformName: string): void {
  const existing = document.getElementById(PANEL_ID);
  if (existing) { existing.remove(); return; }
  createPanel(platformName);
}

function createPanel(platformName: string): void {
  const panel = document.createElement('div');
  panel.id = PANEL_ID;
  panel.className = isDark() ? 'atenna-panel atenna-panel--dark' : 'atenna-panel';

  // Position above the badge — never overlaps the input
  const btn = document.getElementById('atenna-guard-btn');
  if (btn) {
    const r = btn.getBoundingClientRect();
    panel.style.right = `${window.innerWidth - r.right}px`;
    panel.style.bottom = `${window.innerHeight - r.top + 8}px`;
  } else {
    panel.style.right = '16px';
    panel.style.bottom = '80px';
  }

  const logoUrl = getLogoUrl();
  const logoImg = logoUrl
    ? `<img src="${logoUrl}" class="atenna-panel__logo-img" width="20" height="20" alt="" aria-hidden="true"/>`
    : '';

  panel.innerHTML = `
    <div class="atenna-panel__header">
      <span class="atenna-panel__logo">${logoImg}Atenna Prompt</span>
      <button class="atenna-panel__close" aria-label="Fechar painel">×</button>
    </div>
    <hr class="atenna-panel__divider" />
    <div class="atenna-panel__status">
      <span class="atenna-panel__dot"></span>
      <span>Atenna ativo</span>
    </div>
    <div class="atenna-panel__platform">Plataforma: ${escapeHtml(platformName)}</div>
  `;

  panel.querySelector('.atenna-panel__close')!
    .addEventListener('click', () => panel.remove());

  document.body.appendChild(panel);
}

function escapeHtml(str: string): string {
  return str.replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] ?? c)
  );
}
