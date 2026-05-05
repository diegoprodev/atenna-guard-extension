const PLAN_KEY = 'atenna_plan';
const SUPABASE_URL      = 'https://kezbssjmgwtrunqeoyir.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImtlemJzc2ptZ3d0cnVucWVveWlyIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzc5MzY0NzcsImV4cCI6MjA5MzUxMjQ3N30.c2YNPrG7WcbwtFij8UJlS7BNxY_XeaKoeqPlrKHloKs';

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

export async function syncPlanFromSupabase(session: { access_token: string; email: string }): Promise<void> {
  try {
    // Import at call time to avoid circular dependency
    const { decodeJwtPayload } = await import('./auth');
    const payload = decodeJwtPayload(session.access_token);
    const userId = payload.sub as string;
    if (!userId) return;

    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/profiles?id=eq.${userId}&select=plan`,
      {
        method: 'GET',
        headers: {
          'apikey':        SUPABASE_ANON_KEY,
          'Authorization': `Bearer ${session.access_token}`,
        },
      }
    );

    if (!res.ok) return;
    const data = await res.json() as Array<{ plan: string }>;
    const profile = data[0];

    if (profile?.plan === 'pro') {
      await setPlan({ type: 'pro', email: session.email });
    } else {
      await setPlan({ type: 'free', email: session.email });
    }
  } catch {
    // Silently fail; local plan remains unchanged
  }
}
