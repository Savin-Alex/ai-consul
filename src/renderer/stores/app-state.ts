import { create } from 'zustand';

interface AppState {
  isOnboardingComplete: boolean;
  audioSource: 'mic-only' | 'full-system-audio';
  privacyMode: 'local-first' | 'cloud-enabled';
  performanceTier: 'basic' | 'standard' | 'pro' | 'auto-detected';
  ollamaConnected: boolean;
  ollamaModel: string;
  initialize: () => Promise<void>;
  completeOnboarding: (config: {
    audioSource: 'mic-only' | 'full-system-audio';
    privacyMode: 'local-first' | 'cloud-enabled';
    performanceTier: 'basic' | 'standard' | 'pro' | 'auto-detected';
  }) => void;
  setOllamaStatus: (connected: boolean, model?: string) => void;
}

export const useAppStore = create<AppState>((set) => ({
  isOnboardingComplete: false,
  audioSource: 'mic-only',
  privacyMode: 'local-first',
  performanceTier: 'auto-detected',
  ollamaConnected: false,
  ollamaModel: 'llama3:8b',

  initialize: async () => {
    // Load saved state from localStorage or config file
    const saved = localStorage.getItem('ai-consul-config');
    if (saved) {
      try {
        const config = JSON.parse(saved);
        set({
          isOnboardingComplete: config.isOnboardingComplete || false,
          audioSource: config.audioSource || 'mic-only',
          privacyMode: config.privacyMode || 'local-first',
          performanceTier: config.performanceTier || 'auto-detected',
          ollamaConnected: config.ollamaConnected || false,
          ollamaModel: config.ollamaModel || 'llama3:8b',
        });
      } catch (e) {
        console.error('Failed to load config:', e);
      }
    }
  },

  completeOnboarding: (config) => {
    const state = {
      isOnboardingComplete: true,
      audioSource: config.audioSource,
      privacyMode: config.privacyMode,
      performanceTier: config.performanceTier,
    };
    set(state);
    localStorage.setItem('ai-consul-config', JSON.stringify(state));
  },

  setOllamaStatus: (connected, model) => {
    set({ ollamaConnected: connected, ollamaModel: model || 'llama3:8b' });
  },
}));

