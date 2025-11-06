import React, { useState } from 'react';
import { useAppStore } from '../../stores/app-state';
import './Settings.css';

const Settings: React.FC = () => {
  const {
    audioSource,
    privacyMode,
    performanceTier,
    setOllamaStatus,
    setAudioSource,
    setPrivacyMode,
    setPerformanceTier,
  } = useAppStore();
  const [isOpen, setIsOpen] = useState(false);

  return (
    <div className="settings-container">
      <button
        className="settings-toggle"
        onClick={() => setIsOpen(!isOpen)}
      >
        ⚙️ Settings
      </button>
      {isOpen && (
        <div className="settings-panel">
          <h2>Settings</h2>
          
          <div className="settings-section">
            <label>Privacy Mode</label>
            <select 
              value={privacyMode} 
              onChange={(e) => setPrivacyMode(e.target.value as 'local-first' | 'cloud-enabled')}
            >
              <option value="local-first">Local First</option>
              <option value="cloud-enabled">Cloud Enabled</option>
            </select>
          </div>

          <div className="settings-section">
            <label>Performance Tier</label>
            <select 
              value={performanceTier} 
              onChange={(e) => setPerformanceTier(e.target.value as 'basic' | 'standard' | 'pro' | 'auto-detected')}
            >
              <option value="auto-detected">Auto-Detected</option>
              <option value="basic">Basic</option>
              <option value="standard">Standard</option>
              <option value="pro">Pro</option>
            </select>
          </div>

          <div className="settings-section">
            <label>Audio Source</label>
            <select 
              value={audioSource} 
              onChange={(e) => setAudioSource(e.target.value as 'mic-only' | 'full-system-audio')}
            >
              <option value="mic-only">Microphone Only</option>
              <option value="full-system-audio">Full System Audio</option>
            </select>
          </div>
        </div>
      )}
    </div>
  );
};

export default Settings;

