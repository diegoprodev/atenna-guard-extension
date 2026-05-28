// src/ui/modal/network.ts
// Backend fetch layer: prompt generation, checkout, BFF plan sync.

import { getDlpMetadata } from '../../content/injectButton';
import { bffMe } from '../../auth/bffClient';
import { trackEvent } from '../../core/analytics';
import { getPlan, setPlan } from '../../core/planManager';
import { showToast } from './utils';
import type { PromptData } from './state';

export type { PromptData };

// ─── BFF plan sync helper ─────────────────────────────────

/**
 * Syncs plan from BFF /auth/me response into local cache and returns
 * whether the user just upgraded from free → pro (triggers welcome screen).
 */
export async function syncPlanFromBff(me: { plan: string; email?: string }): Promise<{ upgradedToPro: boolean }> {
  const previous = await getPlan();
  const wasFreeBefore = previous.type === 'free';
  const isPlanPro = me.plan === 'pro';
  await setPlan({ type: isPlanPro ? 'pro' : 'free', email: me.email });
  const upgradedToPro = wasFreeBefore && isPlanPro;
  return { upgradedToPro };
}

// ─── Prompt fetch ─────────────────────────────────────────

export interface PromptResponse extends PromptData {
  _fromApi?: boolean;
  _is_fallback?: boolean;
}

export class QuotaExceededError extends Error {
  constructor(
    public readonly count: number,
    public readonly limit: number,
    public readonly resetAt: string | null,
  ) {
    super('daily_limit_reached');
    this.name = 'QuotaExceededError';
  }
}

export async function fetchPrompts(inputText: string): Promise<PromptResponse> {
  const fallback: PromptResponse = {
    direct:      `Explique de forma clara e objetiva:\n\n${inputText}`,
    technical:   `Você é um especialista. Analise profundamente:\n\n${inputText}`,
    structured:  `Responda com contexto, solução e conclusão:\n\n${inputText}`,
    _fromApi: false,
  };
  try {
    const response = await sendToBackground(inputText);
    if (response && (response as { error?: string }).error === 'daily_limit_reached') {
      const r = response as { limit?: number; count?: number; reset_at?: string | null };
      throw new QuotaExceededError(r.count ?? 10, r.limit ?? 10, r.reset_at ?? null);
    }
    if (!response || !response.ok) {
      console.warn('[Atenna] backend response not ok:', response);
      throw new Error('backend error');
    }
    const data = response.data as PromptResponse;
    data._fromApi = true;
    return data;
  } catch (err) {
    if (err instanceof QuotaExceededError) throw err;
    console.warn('[Atenna] erro backend:', err);
    return fallback;
  }
}

export function sendToBackground(inputText: string): Promise<{ ok: boolean; data: unknown } | null> {
  return new Promise((resolve) => {
    try {
      const dlpMetadata = getDlpMetadata();
      chrome.runtime.sendMessage(
        {
          type: 'ATENNA_FETCH',
          input: inputText,
          dlp: dlpMetadata,
        },
        (response: { ok: boolean; data: unknown } | null | undefined) => {
          if (chrome.runtime.lastError) { resolve(null); return; }
          resolve(response ?? null);
        }
      );
    } catch { resolve(null); }
  });
}

export async function openCheckout(source: string, btn?: HTMLButtonElement, plan: 'yearly' | 'monthly' = 'yearly'): Promise<void> {
  if (btn) { btn.disabled = true; btn.textContent = 'Abrindo...'; }
  void trackEvent('checkout_started', { source, plan } as Parameters<typeof trackEvent>[1]);
  try {
    const url = await new Promise<string | null>((resolve) => {
      try {
        chrome.runtime.sendMessage({ type: 'ATENNA_CHECKOUT', plan }, (res: { ok: boolean; url?: string } | null) => {
          if (chrome.runtime.lastError || !res?.ok) { resolve(null); return; }
          resolve(res.url ?? null);
        });
      } catch { resolve(null); }
    });
    if (url) {
      window.open(url, '_blank', 'noopener');
      void trackEvent('checkout_url_opened', { source, plan } as Parameters<typeof trackEvent>[1]);
      showToast('Checkout aberto! Após o pagamento seu plano é atualizado automaticamente.', 'info');
      // Poll bffMe every 5s for up to 2min — update UI when plan becomes pro
      let polls = 0;
      const pollId = setInterval(async () => {
        polls++;
        if (polls > 24) { clearInterval(pollId); return; }
        try {
          const me = await bffMe();
          if (me?.plan === 'pro') {
            clearInterval(pollId);
            await syncPlanFromBff(me);
            showToast('🎉 Bem-vindo ao Atenna Pro! Aproveite todos os recursos.', 'success');
            void trackEvent('checkout_plan_upgraded', { source, plan } as Parameters<typeof trackEvent>[1]);
          }
        } catch { /* network error — keep polling */ }
      }, 5_000);
    } else {
      showToast('Não foi possível abrir o checkout. Tente novamente.', 'error');
    }
  } catch {
    showToast('Algo deu errado. Tente novamente em alguns instantes.', 'error');
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = btn.dataset.label ?? 'Quero ser Pro'; }
  }
}
