export type AnalyticsEvent =
  | 'prompt_generated'
  | 'prompt_used'
  | 'builder_opened'
  | 'auto_suggestion_shown'
  | 'auto_suggestion_accepted'
  | 'upgrade_clicked';

export type PromptType   = 'direct' | 'structured' | 'technical' | '';
export type PromptOrigin = 'builder' | 'auto' | 'manual';

interface EventPayload {
  event:        AnalyticsEvent;
  user_id:      string;
  timestamp:    number;
  prompt_type?: PromptType;
  origin?:      PromptOrigin;
}

const USER_ID_KEY = 'atenna_user_id';

function genAnonId(): string {
  return 'anon_' + Math.random().toString(36).slice(2) + Date.now().toString(36);
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

export async function track(
  event:  AnalyticsEvent,
  meta?:  { prompt_type?: PromptType; origin?: PromptOrigin },
): Promise<void> {
  try {
    const user_id = await getUserId();
    const payload: EventPayload = { event, user_id, timestamp: Date.now(), ...meta };
    // Fire-and-forget via background (no callback) — analytics must never block UX
    chrome.runtime.sendMessage({ type: 'ATENNA_TRACK', payload });
  } catch {
    // silently ignored
  }
}
