import { toggleModal } from './ui/modal';

// Reset onboarding on every popup open to ensure fresh experience
// TODO: Remove this after first user interaction testing
chrome.storage.local.remove('atenna_onboarding_seen', () => {
  void toggleModal();
});
