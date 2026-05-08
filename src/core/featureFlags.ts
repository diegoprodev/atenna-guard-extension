/**
 * Feature Flags for Atenna Guard
 * Centralized flag management with localStorage fallback + admin override
 */

interface FlagConfig {
  default: boolean;
  description: string;
}

const FLAGS: Record<string, FlagConfig> = {
  MULTIMODAL_ENABLED: {
    default: false,
    description: 'Enable document upload widget and badge upload icon',
  },
  DOCUMENT_DLP_ENABLED: {
    default: true,
    description: 'Run DLP scan on documents (when MULTIMODAL_ENABLED)',
  },
  STRICT_DOCUMENT_MODE: {
    default: true,
    description: 'High risk documents must be protected before sending',
  },
};

/**
 * Get feature flag value
 * Priority: localStorage override > default config
 */
export async function getFlag(flagName: string): Promise<boolean> {
  // Check for admin override in localStorage (for testing/rollout)
  try {
    const overrides = localStorage.getItem('atenna_flag_overrides');
    if (overrides) {
      const parsed = JSON.parse(overrides) as Record<string, boolean>;
      if (flagName in parsed) {
        return parsed[flagName];
      }
    }
  } catch {
    // Fallthrough to default
  }

  // Check Chrome storage (for extension persistence)
  try {
    const stored = await new Promise<Record<string, boolean> | undefined>((resolve) => {
      chrome.storage.local.get('atenna_flags', (result) => {
        resolve((result.atenna_flags as Record<string, boolean> | undefined) ?? undefined);
      });
    });

    if (stored && flagName in stored) {
      return stored[flagName];
    }
  } catch {
    // Fallthrough to default
  }

  // Return default value
  const config = FLAGS[flagName];
  return config ? config.default : false;
}

/**
 * Set feature flag (admin only)
 */
export async function setFlag(flagName: string, value: boolean): Promise<void> {
  if (!(flagName in FLAGS)) {
    console.warn(`[Atenna] Unknown flag: ${flagName}`);
    return;
  }

  try {
    const current = await new Promise<Record<string, boolean>>((resolve) => {
      chrome.storage.local.get('atenna_flags', (result) => {
        resolve((result.atenna_flags as Record<string, boolean>) ?? {});
      });
    });

    current[flagName] = value;
    await new Promise<void>((resolve) => {
      chrome.storage.local.set({ atenna_flags: current }, () => {
        resolve();
      });
    });

    console.log(`[Atenna] Flag updated: ${flagName} = ${value}`);
  } catch (e) {
    console.error(`[Atenna] Failed to set flag ${flagName}:`, e);
  }
}

/**
 * Get all flags with current values (for debugging)
 */
export async function getAllFlags(): Promise<Record<string, { value: boolean; default: boolean; description: string }>> {
  const result: Record<string, { value: boolean; default: boolean; description: string }> = {};

  for (const [name, config] of Object.entries(FLAGS)) {
    const value = await getFlag(name);
    result[name] = {
      value,
      default: config.default,
      description: config.description,
    };
  }

  return result;
}

/**
 * Reset all flags to defaults
 */
export async function resetFlags(): Promise<void> {
  try {
    await new Promise<void>((resolve) => {
      chrome.storage.local.remove('atenna_flags', () => {
        resolve();
      });
    });

    console.log('[Atenna] All flags reset to defaults');
  } catch (e) {
    console.error('[Atenna] Failed to reset flags:', e);
  }
}

export const FlagNames = {
  MULTIMODAL_ENABLED: 'MULTIMODAL_ENABLED',
  DOCUMENT_DLP_ENABLED: 'DOCUMENT_DLP_ENABLED',
  STRICT_DOCUMENT_MODE: 'STRICT_DOCUMENT_MODE',
} as const;
