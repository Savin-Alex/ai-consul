import React, { useState } from 'react';
import { useAppStore } from '../../stores/app-state';
import './Settings.css';

const Settings: React.FC = () => {
  const {
    audioSource,
    privacyMode,
    performanceTier,
    setOllamaStatus,
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
            <select value={privacyMode} disabled>
              <option value="local-first">Local First</option>
              <option value="cloud-enabled">Cloud Enabled</option>
            </select>
          </div>

          <div className="settings-section">
            <label>Performance Tier</label>
            <select value={performanceTier} disabled>
              <option value="auto-detected">Auto-Detected</option>
              <option value="basic">Basic</option>
              <option value="standard">Standard</option>
              <option value="pro">Pro</option>
            </select>
          </div>

          <div className="settings-section">
            <label>Audio Source</label>
            <select value={audioSource} disabled>
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

