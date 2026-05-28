import { getSession } from '../auth/sessionManager';

const BFF_BASE = 'https://atennaplugin.maestro-n8n.site';
const BANNER_ID = 'atenna-protection-banner';

async function getToken(): Promise<string | null> {
  try {
    const session = await getSession();
    return session?.token ?? null;
  } catch { return null; }
}

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function showImageDlpBanner(advisory: string): void {
  let banner = document.getElementById(BANNER_ID);
  if (!banner) {
    banner = document.createElement('div');
    banner.id = BANNER_ID;
    banner.style.cssText = [
      'position:fixed', 'bottom:80px', 'left:50%', 'transform:translateX(-50%)',
      'background:#ff4d4f', 'color:#fff', 'padding:10px 20px', 'border-radius:8px',
      'font-family:sans-serif', 'font-size:14px', 'z-index:2147483647',
      'box-shadow:0 4px 12px rgba(0,0,0,.3)', 'max-width:480px', 'text-align:center',
    ].join(';');
    document.body.appendChild(banner);
    setTimeout(() => banner?.remove(), 6000);
  }
  banner.textContent = `⚠️ Dados sensíveis detectados na imagem: ${advisory}`;
}

async function handleImageFile(file: File): Promise<void> {
  if (!file.type.startsWith('image/')) return;
  const token = await getToken();
  if (!token) return;
  const base64 = await fileToBase64(file);

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 8000);

  try {
    const resp = await fetch(`${BFF_BASE}/dlp/image`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ image_b64: base64 }),
      signal: controller.signal,
    });
    clearTimeout(timeoutId);
    if (!resp.ok) return;
    const data = await resp.json() as { show_warning: boolean; advisory?: string; entities?: Array<{ type: string }> };
    if (data.show_warning) {
      showImageDlpBanner(data.advisory || data.entities?.[0]?.type || 'PII');
    }
  } catch (err) {
    clearTimeout(timeoutId);
    if ((err as Error).name === 'AbortError') return; // timeout — fail open, don't block user
    throw err;
  }
}

function extractImageFile(dt: DataTransfer | null): File | null {
  if (!dt) return null;
  for (let i = 0; i < dt.items.length; i++) {
    const item = dt.items[i];
    if (item.kind === 'file' && item.type.startsWith('image/')) return item.getAsFile();
  }
  return null;
}

export function attachImageInterceptor(inputSelector: string): void {
  const el = document.querySelector(inputSelector);
  if (!el) return;
  el.addEventListener('paste', (e: Event) => {
    const file = extractImageFile((e as ClipboardEvent).clipboardData);
    if (file) handleImageFile(file).catch(() => {});
  });
  el.addEventListener('drop', (e: Event) => {
    const file = extractImageFile((e as DragEvent).dataTransfer);
    if (file) handleImageFile(file).catch(() => {});
  });
}
