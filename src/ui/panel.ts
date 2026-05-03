const PANEL_ID = 'atenna-panel';

export function togglePanel(platformName: string): void {
  const existing = document.getElementById(PANEL_ID);
  if (existing) {
    existing.remove();
    return;
  }
  createPanel(platformName);
}

function createPanel(platformName: string): void {
  const panel = document.createElement('div');
  panel.id = PANEL_ID;
  panel.className = 'atenna-panel';

  panel.innerHTML = `
    <div class="atenna-panel__header">
      <span class="atenna-panel__logo">✦ Atenna Guard</span>
      <button class="atenna-panel__close" aria-label="Fechar painel">×</button>
    </div>
    <hr class="atenna-panel__divider" />
    <div class="atenna-panel__status">
      <span class="atenna-panel__dot"></span>
      <span>Atenna Guard ativo</span>
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
