import { getActiveSession, clearSession } from './core/auth';
import { toggleModal } from './ui/modal';

async function initPopup(): Promise<void> {
  const session = await getActiveSession();

  if (!session) {
    // Not logged in — show onboarding/login flow via modal
    chrome.storage.local.remove('atenna_onboarding_seen', () => {
      void toggleModal();
    });
    return;
  }

  // Logged in — show simple account view directly in popup (no editor)
  const container = document.getElementById('atenna-popup')!;

  const logoUrl = chrome.runtime.getURL('icons/icon128.png');

  container.innerHTML = `
    <div style="
      display:flex;flex-direction:column;align-items:center;
      padding:24px 20px;gap:16px;background:#fff;min-height:180px;
      font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;
    ">
      <img src="${logoUrl}" width="56" height="56" alt="Atenna"
           style="border-radius:50%;display:block;"/>
      <div style="text-align:center;">
        <div style="font-size:15px;font-weight:700;color:#111;margin-bottom:4px;">Atenna</div>
        <div style="font-size:12px;color:#666;">${session.email}</div>
      </div>
      <div style="font-size:12px;color:#444;text-align:center;line-height:1.5;padding:0 4px;">
        Abra o ChatGPT, Claude ou Gemini e clique no<br/>
        badge verde acima do campo de texto para usar.
      </div>
      <div style="display:flex;gap:8px;width:100%;">
        <button id="atenna-settings-btn" style="
          flex:1;padding:9px 0;border-radius:8px;font-size:13px;font-weight:600;
          border:1px solid #e5e5e5;background:#f7f7f7;color:#111;cursor:pointer;
        ">Configurações</button>
        <button id="atenna-logout-btn" style="
          flex:1;padding:9px 0;border-radius:8px;font-size:13px;font-weight:600;
          border:1px solid #fca5a5;background:#fef2f2;color:#dc2626;cursor:pointer;
        ">Sair</button>
      </div>
    </div>
  `;

  document.getElementById('atenna-logout-btn')!.addEventListener('click', async () => {
    await clearSession();
    chrome.storage.local.remove('atenna_onboarding_seen', () => {
      void toggleModal();
    });
  });

  document.getElementById('atenna-settings-btn')!.addEventListener('click', () => {
    void toggleModal();
  });
}

void initPopup();
