// TODO(FASE 4.7): migrate direct Supabase REST calls to BFF endpoints
import { sk } from './scopedStorage';

const PLAN_KEY         = 'atenna_plan';
const PRO_WELCOME_KEY  = 'atenna_pro_welcome_pending';
const SUPABASE_URL      = 'https://kezbssjmgwtrunqeoyir.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImtlemJzc2ptZ3d0cnVucWVveWlyIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzc5MzY0NzcsImV4cCI6MjA5MzUxMjQ3N30.c2YNPrG7WcbwtFij8UJlS7BNxY_XeaKoeqPlrKHloKs';

export interface Plan {
  type:        'free' | 'pro';
  planType?:   'free' | 'monthly' | 'yearly';
  email?:      string;
  validUntil?: number;  // ms timestamp (local cache expiry mirror)
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

/** Returns true if plan just transitioned free → pro (welcome screen trigger) */
export async function syncPlanFromSupabase(
  session: { access_token: string; email: string }
): Promise<{ upgradedToPro: boolean }> {
  try {
    const { decodeJwtPayload } = await import('./auth');
    const payload = decodeJwtPayload(session.access_token);
    const userId = payload.sub as string;
    if (!userId) return { upgradedToPro: false };

    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/profiles?id=eq.${userId}&select=plan,plan_type,plan_expires_at`,
      {
        headers: {
          'apikey':        SUPABASE_ANON_KEY,
          'Authorization': `Bearer ${session.access_token}`,
        },
      }
    );
    if (!res.ok) return { upgradedToPro: false };

    const data = await res.json() as Array<{ plan: string; plan_type?: string; plan_expires_at?: string }>;
    const row         = data[0];
    const remotePlan  = row?.plan;
    const planType    = (row?.plan_type ?? 'free') as 'free' | 'monthly' | 'yearly';
    const expiresAt   = row?.plan_expires_at ? new Date(row.plan_expires_at).getTime() : undefined;

    const previous = await getPlan();
    const wasFreeBefore = previous.type === 'free';

    if (remotePlan === 'pro') {
      await setPlan({ type: 'pro', planType, email: session.email, validUntil: expiresAt });
      if (wasFreeBefore) {
        // Mark welcome pending so next modal open shows congrats screen
        await new Promise<void>(r => {
          try { chrome.storage.local.set({ [sk(PRO_WELCOME_KEY)]: true }, () => r()); }
          catch { r(); }
        });
        return { upgradedToPro: true };
      }
    } else {
      await setPlan({ type: 'free', planType: 'free', email: session.email });
    }
  } catch { /* silent */ }
  return { upgradedToPro: false };
}

/** Check and consume the welcome-pending flag (one-shot). */
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
