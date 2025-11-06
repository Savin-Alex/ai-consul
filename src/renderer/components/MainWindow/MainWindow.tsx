import React, { useState, useEffect } from 'react';
import './MainWindow.css';
import { AudioCaptureManager, AudioChunk } from '../../utils/audio-capture';

interface SessionStatus {
  isActive: boolean;
  mode?: string;
}

const MainWindow: React.FC = () => {
  const [sessionStatus, setSessionStatus] = useState<SessionStatus>({ isActive: false });
  const [selectedMode, setSelectedMode] = useState<string>('job_interviews');
  const [error, setError] = useState<string | null>(null);
  const [audioManager, setAudioManager] = useState<AudioCaptureManager | null>(null);
  const [isReady, setIsReady] = useState<boolean>(false);

  useEffect(() => {
    // Initialize audio manager
    const manager = new AudioCaptureManager();
    setAudioManager(manager);

    // Set up audio chunk handler
    manager.on('audio-chunk', (chunk: AudioChunk) => {
      // Send audio chunk to main process for processing
      if (window.electronAPI) {
        // Convert Float32Array to regular array for IPC
        const chunkData = {
          data: Array.from(chunk.data),
          sampleRate: chunk.sampleRate,
          channels: chunk.channels,
          timestamp: chunk.timestamp,
        };
        window.electronAPI.send('audio-chunk', chunkData);
      }
    });

    // Listen for session status updates
    if (window.electronAPI) {
      window.electronAPI.on('session-status', (status: SessionStatus) => {
        setSessionStatus(status);
      });

      window.electronAPI.on('error', (err: string) => {
        setError(err);
        setTimeout(() => setError(null), 5000);
      });

      window.electronAPI.on('session-manager-ready', (data: any) => {
        console.log('Received session-manager-ready event:', data);
        if (data?.ready) {
          console.log('Setting ready state to true');
          setIsReady(true);
        }
      });

      // Check if already ready (poll every 500ms, but extend timeout to 30 seconds)
      // This gives more time for app.whenReady() to complete
      let attempts = 0;
      const maxAttempts = 60; // 30 seconds instead of 10
      let checkReadyInterval: NodeJS.Timeout | null = null;
      
      const checkReady = () => {
        attempts++;
        if (attempts % 10 === 0) { // Log every 5 seconds instead of every attempt
          console.log(`Checking session manager ready (attempt ${attempts}/${maxAttempts})...`);
        }
        window.electronAPI.invoke('session-manager-ready').then((result: any) => {
          if (result?.ready) {
            console.log('Session manager is ready! (via polling)');
            setIsReady(true);
            if (checkReadyInterval) {
              clearInterval(checkReadyInterval);
              checkReadyInterval = null;
            }
          } else if (attempts % 10 === 0) {
            console.log('Session manager not ready yet, continuing to poll...');
          }
        }).catch((err) => {
          console.error('Error checking session manager ready:', err);
        });
        
        if (attempts >= maxAttempts) {
          console.warn('Max polling attempts reached. Session manager may not be initialized.');
          if (checkReadyInterval) {
            clearInterval(checkReadyInterval);
            checkReadyInterval = null;
          }
        }
      };
      
      // Start polling after a short delay to let main process initialize
      checkReadyInterval = setInterval(checkReady, 500);

      window.electronAPI.on('start-audio-capture', async (config: any) => {
        try {
          await manager.startCapture(config);
        } catch (err: any) {
          setError(err.message || 'Failed to start audio capture');
        }
      });

      window.electronAPI.on('stop-audio-capture', async () => {
        try {
          await manager.stopCapture();
        } catch (err: any) {
          console.error('Failed to stop audio capture:', err);
        }
      });
    }

    return () => {
      manager.stopCapture().catch(console.error);
      // Cleanup interval if component unmounts
      // Note: checkReadyInterval is in closure, will be cleaned up
    };
  }, []);

  const handleStartSession = async () => {
    if (!window.electronAPI) {
      setError('Electron API not available');
      return;
    }

    if (!isReady) {
      setError('App is still initializing. Please wait...');
      return;
    }

    try {
      setError(null);
      const config = {
        mode: selectedMode,
        context: {
          documents: [], // Can be extended to allow file upload
        },
      };

      const result = await window.electronAPI.invoke('start-session', config);
      if (result?.success) {
        setSessionStatus({ isActive: true, mode: selectedMode });
      }
    } catch (err: any) {
      setError(err.message || 'Failed to start session');
    }
  };

  const handleStopSession = async () => {
    if (!window.electronAPI) {
      return;
    }

    try {
      const result = await window.electronAPI.invoke('stop-session');
      if (result?.success) {
        setSessionStatus({ isActive: false });
      }
    } catch (err: any) {
      setError(err.message || 'Failed to stop session');
    }
  };

  const handlePauseSession = async () => {
    if (!window.electronAPI) {
      return;
    }

    try {
      await window.electronAPI.invoke('pause-session');
    } catch (err: any) {
      setError(err.message || 'Failed to pause session');
    }
  };

  return (
    <div className="main-window">
      <div className="main-content">
        <h1>AI Consul</h1>
        <p className="subtitle">Real-time AI assistant for your conversations</p>

        {error && (
          <div className="error-message">
            {error}
          </div>
        )}

        <div className="session-controls">
          <div className="mode-selector">
            <label htmlFor="mode-select">Session Mode:</label>
            <select
              id="mode-select"
              value={selectedMode}
              onChange={(e) => setSelectedMode(e.target.value)}
              disabled={sessionStatus.isActive}
            >
              <option value="job_interviews">Job Interviews</option>
              <option value="work_meetings">Work Meetings</option>
              <option value="education">Education</option>
              <option value="chat_messaging">Chat/Messaging</option>
              <option value="simulation_coaching">Simulation & Coaching</option>
            </select>
          </div>

          <div className="button-group">
            {!sessionStatus.isActive ? (
              <button
                className="btn btn-primary"
                onClick={handleStartSession}
                disabled={!isReady}
              >
                {isReady ? '▶ Start Session' : '⏳ Initializing...'}
              </button>
            ) : (
              <>
                <button
                  className="btn btn-secondary"
                  onClick={handlePauseSession}
                >
                  ⏸ Pause
                </button>
                <button
                  className="btn btn-danger"
                  onClick={handleStopSession}
                >
                  ⏹ Stop Session
                </button>
              </>
            )}
          </div>

          {sessionStatus.isActive && (
            <div className="session-status">
              <div className="status-indicator active"></div>
              <span>Session active - {sessionStatus.mode?.replace('_', ' ')}</span>
            </div>
          )}
        </div>

        <div className="info-section">
          <h3>How to Use</h3>
          <ol>
            <li>Select a session mode above</li>
            <li>Click "Start Session" to begin</li>
            <li>Speak into your microphone</li>
            <li>View suggestions in the companion window</li>
            <li>Click "Stop Session" when done</li>
          </ol>
        </div>
      </div>
    </div>
  );
};

export default MainWindow;

