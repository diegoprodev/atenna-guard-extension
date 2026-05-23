import { sk } from './scopedStorage';

const PLAN_KEY        = 'atenna_plan';
const PRO_WELCOME_KEY = 'atenna_pro_welcome_pending';

export interface Plan {
  type:        'free' | 'pro';
  planType?:   'free' | 'monthly' | 'yearly';
  email?:      string;
  validUntil?: number;
}

async function storagePlanGet(): Promise<Plan | undefined> {
  return new Promise(resolve => {
    try {
      const key = sk(PLAN_KEY);
      chrome.storage.local.get(key, r =>
        resolve(r[key] as Plan | undefined)
      );
    } catch { resolve(undefined); }
  });
}

export async function setPlan(plan: Plan): Promise<void> {
  return new Promise(resolve => {
    try {
      chrome.storage.local.set({ [sk(PLAN_KEY)]: plan }, () => resolve());
    } catch { resolve(); }
  });
}

export async function getPlan(): Promise<Plan> {
  const plan = await storagePlanGet();
  if (!plan) return { type: 'free' };
  if (plan.type === 'pro' && plan.validUntil && Date.now() > plan.validUntil) {
    return { type: 'free' };
  }
  return plan;
}

export async function isPro(): Promise<boolean> {
  const plan = await getPlan();
  return plan.type === 'pro';
}

/** Sync plan from BFF /auth/me response — call after login or modal open */
export async function syncPlanFromBff(
  me: { user_id: string; email: string; plan: string; expires_at?: number }
): Promise<{ upgradedToPro: boolean }> {
  const previous = await getPlan();
  const wasFreeBefore = previous.type === 'free';
  const isPlanPro = me.plan === 'pro';

  if (isPlanPro) {
    const validUntil = me.expires_at ? me.expires_at * 1000 : undefined;
    await setPlan({ type: 'pro', planType: 'monthly', email: me.email, validUntil });
    if (wasFreeBefore) {
      await new Promise<void>(r => {
        try { chrome.storage.local.set({ [sk(PRO_WELCOME_KEY)]: true }, () => r()); }
        catch { r(); }
      });
      return { upgradedToPro: true };
    }
  } else {
    await setPlan({ type: 'free', planType: 'free', email: me.email });
  }
  return { upgradedToPro: false };
}

// Legacy alias — kept for callers that pass a raw session object
export async function syncPlanFromSupabase(
  session: { access_token: string; email: string }
): Promise<{ upgradedToPro: boolean }> {
  const { bffMe } = await import('../auth/bffClient');
  const me = await bffMe();
  if (!me) return { upgradedToPro: false };
  return syncPlanFromBff(me);
}

export async function consumeProWelcome(): Promise<boolean> {
  return new Promise(resolve => {
    try {
      const key = sk(PRO_WELCOME_KEY);
      chrome.storage.local.get(key, r => {
        const pending = !!r[key];
        if (pending) chrome.storage.local.remove(key, () => resolve(true));
        else resolve(false);
      });
    } catch { resolve(false); }
  });
}
