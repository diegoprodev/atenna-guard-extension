// src/ui/modal/index.ts
// Public API barrel for the modal subsystem.
// All importers use: import { X } from '../ui/modal' — this file is their resolved target.

export { clearPromptCache, toggleModal, generateFromBadge, openSettingsOverlay } from './core';
export { openUploadFromBadge } from './upload-flow';
export { renderSignupView } from './auth-views';
export { updateUsageBadge } from './settings';
export type { PromptResponse } from './network';
export { QuotaExceededError, fetchPrompts } from './network';
export type { PromptData } from './state';
