// src/ui/modal/state.ts
// Shared mutable state for the modal subsystem.
// Use modalState.field — never destructure, as that creates a stale copy.

export interface PromptData {
  direct: string; technical: string; structured: string;
  direct_preview?: string; technical_preview?: string; structured_preview?: string;
}

export const UPGRADE_TRIGGER = 3;

export const modalState = {
  promptCache: null as { forText: string; data: PromptData } | null,
  upgradeShown: false,
  msgIntervalId: undefined as ReturnType<typeof setInterval> | undefined,
};

export function clearPromptCache(): void {
  modalState.promptCache = null;
  modalState.upgradeShown = false;
}
