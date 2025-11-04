import React, { useState, useEffect } from 'react';
import { useAppStore } from '../../stores/app-state';
import OllamaCheck from './OllamaCheck';
import './Onboarding.css';

type Step = 'welcome' | 'audio' | 'privacy' | 'performance' | 'ollama' | 'complete';

const Onboarding: React.FC = () => {
  const [step, setStep] = useState<Step>('welcome');
  const [audioSource, setAudioSource] = useState<'mic-only' | 'full-system-audio'>('mic-only');
  const [privacyMode, setPrivacyMode] = useState<'local-first' | 'cloud-enabled'>('local-first');
  const [performanceTier, setPerformanceTier] = useState<'basic' | 'standard' | 'pro' | 'auto-detected'>('auto-detected');
  const { completeOnboarding, setOllamaStatus } = useAppStore();

  useEffect(() => {
    // Auto-detect performance tier
    if (step === 'performance') {
      const cores = navigator.hardwareConcurrency || 4;
      const memory = (performance as any).memory?.jsHeapSizeLimit || 4 * 1024 * 1024 * 1024;
      
      if (cores >= 8 && memory >= 8 * 1024 * 1024 * 1024) {
        setPerformanceTier('pro');
      } else if (cores >= 4 && memory >= 4 * 1024 * 1024 * 1024) {
        setPerformanceTier('standard');
      } else {
        setPerformanceTier('basic');
      }
    }
  }, [step]);

  const handleComplete = () => {
    completeOnboarding({
      audioSource,
      privacyMode,
      performanceTier,
    });
    setStep('complete');
  };

  const handleOllamaComplete = (connected: boolean, model?: string) => {
    setOllamaStatus(connected, model);
    if (connected) {
      handleComplete();
    }
  };

  return (
    <div className="onboarding">
      <div className="onboarding-content">
        {step === 'welcome' && (
          <div className="onboarding-step">
            <h1>Welcome to AI Consul</h1>
            <p>A privacy-first, real-time AI assistant for your conversations.</p>
            <button onClick={() => setStep('audio')}>Get Started</button>
          </div>
        )}

        {step === 'audio' && (
          <div className="onboarding-step">
            <h2>Audio Source</h2>
            <p>Choose how AI Consul should capture audio:</p>
            <div className="option-group">
              <label>
                <input
                  type="radio"
                  value="mic-only"
                  checked={audioSource === 'mic-only'}
                  onChange={(e) => setAudioSource(e.target.value as 'mic-only')}
                />
                Microphone Only
              </label>
              <label>
                <input
                  type="radio"
                  value="full-system-audio"
                  checked={audioSource === 'full-system-audio'}
                  onChange={(e) => setAudioSource(e.target.value as 'full-system-audio')}
                />
                Full System Audio (for meetings)
              </label>
            </div>
            <div className="button-group">
              <button onClick={() => setStep('welcome')}>Back</button>
              <button onClick={() => setStep('privacy')}>Next</button>
            </div>
          </div>
        )}

        {step === 'privacy' && (
          <div className="onboarding-step">
            <h2>Privacy Settings</h2>
            <p>Choose your privacy preference:</p>
            <div className="option-group">
              <label>
                <input
                  type="radio"
                  value="local-first"
                  checked={privacyMode === 'local-first'}
                  onChange={(e) => setPrivacyMode(e.target.value as 'local-first')}
                />
                Local First (recommended) - All processing happens on your device
              </label>
              <label>
                <input
                  type="radio"
                  value="cloud-enabled"
                  checked={privacyMode === 'cloud-enabled'}
                  onChange={(e) => setPrivacyMode(e.target.value as 'cloud-enabled')}
                />
                Cloud Enabled - Use cloud AI as fallback
              </label>
            </div>
            <div className="button-group">
              <button onClick={() => setStep('audio')}>Back</button>
              <button onClick={() => setStep('performance')}>Next</button>
            </div>
          </div>
        )}

        {step === 'performance' && (
          <div className="onboarding-step">
            <h2>Performance Detection</h2>
            <p>Detected performance tier: <strong>{performanceTier}</strong></p>
            <p>You can change this later in settings.</p>
            <div className="button-group">
              <button onClick={() => setStep('privacy')}>Back</button>
              <button onClick={() => setStep('ollama')}>Next</button>
            </div>
          </div>
        )}

        {step === 'ollama' && (
          <div className="onboarding-step">
            <h2>Local AI Setup</h2>
            <OllamaCheck onComplete={handleOllamaComplete} />
            <div className="button-group">
              <button onClick={() => setStep('performance')}>Back</button>
            </div>
          </div>
        )}

        {step === 'complete' && (
          <div className="onboarding-step">
            <h1>Setup Complete!</h1>
            <p>AI Consul is ready to use. Start a session to begin.</p>
          </div>
        )}
      </div>
    </div>
  );
};

export default Onboarding;

