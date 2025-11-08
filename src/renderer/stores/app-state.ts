import { create } from 'zustand';

interface AppState {
  isOnboardingComplete: boolean;
  audioSource: 'mic-only' | 'full-system-audio';
  privacyMode: 'local-first' | 'cloud-enabled';
  performanceTier: 'basic' | 'standard' | 'pro' | 'auto-detected';
  ollamaConnected: boolean;
  ollamaModel: string;
  microphones: MediaDeviceInfo[];
  selectedMicrophoneId: string;
  initialize: () => Promise<void>;
  completeOnboarding: (config: {
    audioSource: 'mic-only' | 'full-system-audio';
    privacyMode: 'local-first' | 'cloud-enabled';
    performanceTier: 'basic' | 'standard' | 'pro' | 'auto-detected';
    selectedMicrophoneId?: string;
  }) => void;
  setOllamaStatus: (connected: boolean, model?: string) => void;
  setAudioSource: (source: 'mic-only' | 'full-system-audio') => void;
  setPrivacyMode: (mode: 'local-first' | 'cloud-enabled') => void;
  setPerformanceTier: (tier: 'basic' | 'standard' | 'pro' | 'auto-detected') => void;
  setMicrophones: (devices: MediaDeviceInfo[]) => void;
  setSelectedMicrophone: (deviceId: string) => void;
}

export const useAppStore = create<AppState>((set) => ({
  isOnboardingComplete: false,
  audioSource: 'mic-only',
  privacyMode: 'local-first',
  performanceTier: 'auto-detected',
  ollamaConnected: false,
  ollamaModel: 'llama3:8b',
  microphones: [],
  selectedMicrophoneId: 'default',

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
          selectedMicrophoneId: config.selectedMicrophoneId || 'default',
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
      selectedMicrophoneId: config.selectedMicrophoneId || 'default',
    };
    set(state);
    localStorage.setItem('ai-consul-config', JSON.stringify(state));
  },

  setOllamaStatus: (connected, model) => {
    set({ ollamaConnected: connected, ollamaModel: model || 'llama3:8b' });
  },

  setAudioSource: (source) => {
    set({ audioSource: source });
    // Save to localStorage
    const saved = localStorage.getItem('ai-consul-config');
    if (saved) {
      try {
        const config = JSON.parse(saved);
        config.audioSource = source;
        localStorage.setItem('ai-consul-config', JSON.stringify(config));
      } catch (e) {
        console.error('Failed to save audio source:', e);
      }
    }
  },

  setPrivacyMode: (mode) => {
    set({ privacyMode: mode });
    // Save to localStorage
    const saved = localStorage.getItem('ai-consul-config');
    if (saved) {
      try {
        const config = JSON.parse(saved);
        config.privacyMode = mode;
        localStorage.setItem('ai-consul-config', JSON.stringify(config));
      } catch (e) {
        console.error('Failed to save privacy mode:', e);
      }
    }
  },

  setPerformanceTier: (tier) => {
    set({ performanceTier: tier });
    // Save to localStorage
    const saved = localStorage.getItem('ai-consul-config');
    if (saved) {
      try {
        const config = JSON.parse(saved);
        config.performanceTier = tier;
        localStorage.setItem('ai-consul-config', JSON.stringify(config));
      } catch (e) {
        console.error('Failed to save performance tier:', e);
      }
    }
  },

  setMicrophones: (devices) => {
    set({ microphones: devices });
  },

  setSelectedMicrophone: (deviceId) => {
    set({ selectedMicrophoneId: deviceId || 'default' });
    const saved = localStorage.getItem('ai-consul-config');
    if (saved) {
      try {
        const config = JSON.parse(saved);
        config.selectedMicrophoneId = deviceId || 'default';
        localStorage.setItem('ai-consul-config', JSON.stringify(config));
      } catch (e) {
        console.error('Failed to save selected microphone:', e);
      }
    }
  },
}));

