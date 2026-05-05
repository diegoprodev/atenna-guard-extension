const PLAN_KEY = 'atenna_plan';

export interface Plan {
  type:        'free' | 'pro';
  email?:      string;
  validUntil?: number; // ms timestamp; undefined = lifetime
}

async function storagePlanGet(): Promise<Plan | undefined> {
  return new Promise(resolve => {
    try {
      chrome.storage.local.get(PLAN_KEY, r =>
        resolve(r[PLAN_KEY] as Plan | undefined)
      );
    } catch { resolve(undefined); }
  });
}

export async function setPlan(plan: Plan): Promise<void> {
  return new Promise(resolve => {
    try {
      chrome.storage.local.set({ [PLAN_KEY]: plan }, () => resolve());
    } catch { resolve(); }
  });
}

export async function getPlan(): Promise<Plan> {
  const plan = await storagePlanGet();
  if (!plan) return { type: 'free' };
  // If Pro subscription expired, revert to Free
  if (plan.type === 'pro' && plan.validUntil && Date.now() > plan.validUntil) {
    return { type: 'free' };
  }
  return plan;
}

export async function isPro(): Promise<boolean> {
  const plan = await getPlan();
  return plan.type === 'pro';
}
