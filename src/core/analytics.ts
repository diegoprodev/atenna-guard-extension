export type AnalyticsEvent =
  // Auth events
  | 'login_view_shown'
  | 'login_email_submitted'
  | 'login_success'
  | 'login_error'
  | 'signup_clicked'
  | 'signup_submitted'
  | 'signup_success'
  | 'signup_error'
  | 'reset_clicked'
  | 'reset_submitted'
  | 'reset_success'
  | 'reset_error'
  | 'logout_clicked'
  // Prompt builder events
  | 'modal_opened'
  | 'prompt_input_started'
  | 'builder_opened'
  | 'builder_closed'
  | 'prompt_generate_clicked'
  | 'prompt_generate_success'
  | 'prompt_generate_error'
  | 'prompt_copied'
  | 'prompt_used'
  | 'prompt_tab_changed'
  | 'auto_suggestion_shown'
  | 'auto_suggestion_accepted'
  // Quota/conversion events
  | 'quota_viewed'
  | 'quota_warning_shown'
  | 'quota_limit_reached'
  | 'upgrade_modal_shown'
  | 'upgrade_modal_closed'
  | 'upgrade_clicked'
  | 'upgrade_interest_registered'
  // Retention events
  | 'app_opened'
  | 'returning_user_detected'
  | 'first_prompt_generated'
  | 'third_prompt_generated'
  | 'fifth_prompt_generated'
  | 'monthly_limit_warning'
  // Performance events
  | 'generation_latency_ms'
  | 'backend_error'
  | 'auth_401'
  | 'timeout_warning_shown';

export type PromptType   = 'direct' | 'structured' | 'technical' | '';
export type PromptOrigin = 'builder' | 'auto' | 'manual';

export interface EventPayload {
  event:              AnalyticsEvent;
  user_id:            string;
  timestamp:          number;
  session_id:         string;
  extension_version:  string;
  plan:               'free' | 'pro';
  prompt_type?:       PromptType;
  origin?:            PromptOrigin;
  input_length?:      number;
  output_length?:     number;
  latency_ms?:        number;
  error?:             string;
  [key: string]:      unknown;
}

const USER_ID_KEY = 'atenna_user_id';
const SESSION_ID_KEY = 'atenna_session_id';
const EXTENSION_VERSION = '1.2.0';

function genAnonId(): string {
  return 'anon_' + Math.random().toString(36).slice(2) + Date.now().toString(36);
}

function genSessionId(): string {
  return 'sess_' + Math.random().toString(36).slice(2);
}

async function getUserId(): Promise<string> {
  return new Promise(resolve => {
    try {
      chrome.storage.local.get(USER_ID_KEY, result => {
        const id = result[USER_ID_KEY] as string | undefined;
        if (id) { resolve(id); return; }
        const newId = genAnonId();
        chrome.storage.local.set({ [USER_ID_KEY]: newId }, () => resolve(newId));
      });
    } catch {
      resolve(genAnonId());
    }
  });
}

export function getOrCreateSessionId(): string {
  return new Promise(resolve => {
    try {
      chrome.storage.session?.get(SESSION_ID_KEY, result => {
        const id = (result?.[SESSION_ID_KEY] as string | undefined) || genSessionId();
        chrome.storage.session?.set({ [SESSION_ID_KEY]: id }, () => resolve(id));
      });
    } catch {
      resolve(genSessionId());
    }
  }) as any;
}

export async function trackEvent(
  event: AnalyticsEvent,
  meta?: Partial<Omit<EventPayload, 'event' | 'user_id' | 'timestamp' | 'session_id' | 'extension_version'>>,
): Promise<void> {
  try {
    const user_id = await getUserId();
    const sessionId = getOrCreateSessionId() || genSessionId();
    const plan = (await import('./planManager').then(m => m.isPro())) ? 'pro' : 'free';

    const payload: EventPayload = {
      event,
      user_id,
      timestamp: Date.now(),
      session_id: sessionId,
      extension_version: EXTENSION_VERSION,
      plan,
      ...meta,
    };

    chrome.runtime.sendMessage({ type: 'ATENNA_TRACK', payload });
  } catch {
    // silently ignored
  }
}

// Backward compat
export async function track(
  event: AnalyticsEvent,
  meta?: { prompt_type?: PromptType; origin?: PromptOrigin },
): Promise<void> {
  return trackEvent(event, meta);
}
