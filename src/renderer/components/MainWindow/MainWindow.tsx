import React, { useState, useEffect, useRef } from 'react';
import './MainWindow.css';
import { AudioCaptureManager, AudioChunk } from '../../utils/audio-capture';
import { AudioState } from '../../utils/audio-state';
import { useAppStore } from '../../stores/app-state';

interface SessionStatus {
  isActive: boolean;
  mode?: string;
}

interface SessionManagerReadyPayload {
  ready?: boolean;
}

interface StartStopResponse {
  success?: boolean;
  error?: string;
}

interface AudioCaptureConfig {
  sources?: ('microphone' | 'system-audio')[];
  sampleRate?: number;
  channels?: number;
  deviceId?: string;
}

const getErrorMessage = (error: unknown): string => {
  if (error instanceof Error) {
    return error.message;
  }
  if (typeof error === 'string') {
    return error;
  }
  return 'Unknown error occurred';
};

const MainWindow: React.FC = () => {
  const [sessionStatus, setSessionStatus] = useState<SessionStatus>({ isActive: false });
  const [selectedMode, setSelectedMode] = useState<string>('job_interviews');
  const [error, setError] = useState<string | null>(null);
  const [isReady, setIsReady] = useState<boolean>(false);
  const [audioState, setAudioState] = useState<AudioState>(AudioState.IDLE);
  const [audioStateMessage, setAudioStateMessage] = useState<string>('');
  const { selectedMicrophoneId, setMicrophones } = useAppStore((state) => ({
    selectedMicrophoneId: state.selectedMicrophoneId,
    setMicrophones: state.setMicrophones,
  }));
  const selectedMicrophoneRef = useRef<string>(selectedMicrophoneId);
  const startAudioCaptureHandlerRef = useRef<((config: AudioCaptureConfig) => Promise<void>) | null>(null);
  const stopAudioCaptureHandlerRef = useRef<(() => Promise<void>) | null>(null);
  const sessionStatusHandlerRef = useRef<((status: SessionStatus) => void) | null>(null);
  const errorHandlerRef = useRef<((err: string) => void) | null>(null);
  const sessionManagerReadyHandlerRef = useRef<((data: SessionManagerReadyPayload) => void) | null>(null);
  // Prevent double registration in React StrictMode
  const handlersRegisteredRef = useRef(false);
  const managerRef = useRef<AudioCaptureManager | null>(null);

  useEffect(() => {
    selectedMicrophoneRef.current = selectedMicrophoneId;
  }, [selectedMicrophoneId]);

  useEffect(() => {
    // CRITICAL: Prevent double registration in React 18 StrictMode
    if (handlersRegisteredRef.current) {
      console.log('[renderer] Handlers already registered, skipping duplicate');
      return;
    }
    handlersRegisteredRef.current = true;

    // Initialize audio manager ONCE
    const manager = new AudioCaptureManager();
    managerRef.current = manager;

    // Track capture state at module level (within this effect)
    let captureInProgress = false;

    // Set up audio chunk handler
    manager.on('audio-chunk', (chunk: unknown) => {
      const audioChunk = chunk as AudioChunk;
      if (!audioChunk || !audioChunk.data) {
        console.warn('[renderer] Invalid audio chunk received');
        return;
      }
      console.log('[renderer] Audio chunk received from manager:', {
        dataLength: audioChunk.data.length,
        sampleRate: audioChunk.sampleRate,
        maxAmplitude: Math.max(...Array.from(audioChunk.data)),
        avgAmplitude: audioChunk.data.reduce((sum: number, val: number) => sum + Math.abs(val), 0) / audioChunk.data.length,
        timestamp: audioChunk.timestamp
      });

      // Send audio chunk to main process for processing
      if (window.electronAPI) {
        // Convert Float32Array to base64 for IPC to preserve precision
        // Float32Array -> Uint8Array -> base64 string (using loop to avoid stack overflow)
        const uint8Array = new Uint8Array(audioChunk.data.buffer);
        let binaryString = '';
        // Build binary string character by character to avoid stack overflow
        for (let i = 0; i < uint8Array.length; i++) {
          binaryString += String.fromCharCode(uint8Array[i]);
        }
        const base64Data = btoa(binaryString);
        
        const chunkData = {
          data: base64Data, // Base64 encoded binary data
          dataLength: audioChunk.data.length, // Original array length
          sampleRate: audioChunk.sampleRate,
          channels: audioChunk.channels,
          timestamp: audioChunk.timestamp,
        };
        console.log('[renderer] Sending audio chunk to main process');
        window.electronAPI.send('audio-chunk', chunkData);
      } else {
        console.error('[renderer] window.electronAPI not available for sending audio chunk');
      }
    });

    // Listen for session status updates
    let checkReadyInterval: NodeJS.Timeout | null = null;
    const deviceChangeHandlers: Array<() => void> = [];

    if (window.electronAPI) {
      const sessionStatusHandler = (status: SessionStatus) => {
        setSessionStatus(status);
      };
      sessionStatusHandlerRef.current = sessionStatusHandler;
      window.electronAPI.on('session-status', sessionStatusHandler);

      const errorHandler = (err: string) => {
        setError(err);
        setTimeout(() => setError(null), 5000);
      };
      errorHandlerRef.current = errorHandler;
      window.electronAPI.on('error', errorHandler);

      const sessionManagerReadyHandler = (data: SessionManagerReadyPayload) => {
        console.log('Received session-manager-ready event:', data);
        if (data?.ready) {
          console.log('Setting ready state to true');
          setIsReady(true);
        }
      };
      sessionManagerReadyHandlerRef.current = sessionManagerReadyHandler;
      window.electronAPI.on('session-manager-ready', sessionManagerReadyHandler);

      let attempts = 0;
      const maxAttempts = 60;

      const checkReady = () => {
        attempts++;
        if (attempts % 10 === 0) {
          console.log(`Checking session manager ready (attempt ${attempts}/${maxAttempts})...`);
        }
        if (!window.electronAPI) {
          console.error('window.electronAPI not available');
          return;
        }
        window.electronAPI
          .invoke('session-manager-ready')
          .then((result: unknown) => {
            const payload = result as SessionManagerReadyPayload | undefined;
            if (payload?.ready) {
              console.log('Session manager is ready! (via polling)');
              setIsReady(true);
              if (checkReadyInterval) {
                clearInterval(checkReadyInterval);
                checkReadyInterval = null;
              }
            } else if (attempts % 10 === 0) {
              console.log('Session manager not ready yet, continuing to poll...');
            }
          })
          .catch((err: unknown) => {
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

      checkReadyInterval = setInterval(checkReady, 500);

      // Subscribe to audio state changes
      manager.on('state-changed', (event: any) => {
        const newState = event.current as AudioState;
        setAudioState(newState);
        
        // Set user-friendly state message
        switch (newState) {
          case AudioState.IDLE:
            setAudioStateMessage('');
            break;
          case AudioState.REQUESTING_PERMISSION:
            setAudioStateMessage('Requesting microphone permission...');
            break;
          case AudioState.INITIALIZING_CONTEXT:
            setAudioStateMessage('Initializing audio context...');
            break;
          case AudioState.LOADING_WORKLET:
            setAudioStateMessage('Loading audio processor...');
            break;
          case AudioState.READY:
            setAudioStateMessage('Audio ready');
            break;
          case AudioState.RECORDING:
            setAudioStateMessage('Recording...');
            break;
          case AudioState.STOPPING:
            setAudioStateMessage('Stopping...');
            break;
          case AudioState.CLEANING_UP:
            setAudioStateMessage('Cleaning up...');
            break;
          case AudioState.ERROR:
            setAudioStateMessage('Audio error occurred');
            break;
          default:
            setAudioStateMessage('');
        }
      });

      // Store handler reference for cleanup
      const startAudioCaptureHandler = async (config: AudioCaptureConfig) => {
        // CRITICAL: Check BOTH the flag AND the manager state
        const currentManager = managerRef.current;
        if (!currentManager) {
          console.error('[renderer] Manager not initialized');
          if (window.electronAPI) {
            window.electronAPI.send('audio-capture-ready', {
              success: false,
              error: 'Manager not initialized',
            });
          }
          return;
        }

        const currentState = currentManager.getState();

        // Prevent duplicate calls - check both flag and state
        if (captureInProgress || currentState === AudioState.RECORDING || currentState === AudioState.READY) {
          console.log('[renderer] Capture already in progress or ready, sending confirmation');
          if (window.electronAPI) {
            window.electronAPI.send('audio-capture-ready', {
              success: true,
              state: currentState,
            });
          }
          return;
        }

        console.log('[renderer] Received start-audio-capture event with config:', config);
        captureInProgress = true;
        
        try {

          const captureConfig = {
            ...config,
            deviceId: config.deviceId || selectedMicrophoneRef.current,
          };
          console.log('[renderer] Starting audio capture with config:', captureConfig);
          
          // Set a timeout to ensure we always send a response
          const responseTimeout = setTimeout(() => {
            if (captureInProgress) {
              console.error('[renderer] Audio capture start timeout, sending error response');
              const timeoutState = currentManager.getState();
              if (window.electronAPI) {
                window.electronAPI.send('audio-capture-ready', { 
                  success: false,
                  error: 'Audio capture start timed out',
                  state: timeoutState
                });
              }
              captureInProgress = false;
            }
          }, 10000); // 10 second timeout

          try {
            await currentManager.startCapture(captureConfig);
            
            // Wait for state to reach RECORDING or READY (with a small delay to ensure state is stable)
            await new Promise(resolve => setTimeout(resolve, 200));
            const finalState = currentManager.getState();
            console.log('[renderer] Audio capture started, current state:', finalState);
            
            clearTimeout(responseTimeout);
            
            // Send confirmation back to main process with state information
            // Accept RECORDING or READY as success (READY means audio is initialized and ready)
            const isSuccess = finalState === AudioState.RECORDING || finalState === AudioState.READY;
            if (window.electronAPI) {
              window.electronAPI.send('audio-capture-ready', { 
                success: isSuccess,
                state: finalState
              });
            }
            
            if (!isSuccess) {
              console.warn(`[renderer] Audio capture completed but state is ${finalState}, not RECORDING or READY`);
            }
          } catch (captureError) {
            clearTimeout(responseTimeout);
            throw captureError;
          }
        } catch (err: unknown) {
          console.error('[renderer] Failed to start audio capture:', err);
          setError(getErrorMessage(err) || 'Failed to start audio capture');
          // Always send error confirmation to prevent timeout
          if (window.electronAPI) {
            window.electronAPI.send('audio-capture-ready', { 
              success: false, 
              error: getErrorMessage(err) || 'Failed to start audio capture',
              state: currentManager.getState()
            });
          }
        } finally {
          captureInProgress = false;
        }
      };

      // Store handlers in refs for cleanup
      startAudioCaptureHandlerRef.current = startAudioCaptureHandler;
      window.electronAPI.on('start-audio-capture', startAudioCaptureHandler);

      const stopAudioCaptureHandler = async () => {
        console.log('[renderer] Received stop-audio-capture event');
        const currentManager = managerRef.current;
        
        if (!currentManager) {
          console.warn('[renderer] Manager not available for stop');
          return;
        }

        // Reset capture flag
        captureInProgress = false;

        try {
          // Force stop regardless of state
          await currentManager.stopCapture();
          console.log('[renderer] Audio capture stopped successfully');
        } catch (err: unknown) {
          console.error('[renderer] Failed to stop audio capture:', err);
          setError(getErrorMessage(err) || 'Failed to stop audio capture');
        }
      };

      // Store handler in ref for cleanup
      stopAudioCaptureHandlerRef.current = stopAudioCaptureHandler;
      window.electronAPI.on('stop-audio-capture', stopAudioCaptureHandler);

      (async () => {
        const devices = await manager.listInputDevices();
        setMicrophones(devices);
      })();

      const handleDeviceChange = async () => {
        const devices = await manager.listInputDevices();
        setMicrophones(devices);
      };

      if (navigator.mediaDevices?.addEventListener) {
        navigator.mediaDevices.addEventListener('devicechange', handleDeviceChange);
        deviceChangeHandlers.push(() => {
          navigator.mediaDevices.removeEventListener('devicechange', handleDeviceChange);
        });
      } else {
        const mediaDevices = navigator.mediaDevices as MediaDevices & {
          ondevicechange?: ((this: MediaDevices, ev: Event) => void) | null;
        };

        if (mediaDevices.ondevicechange !== undefined) {
          const previousHandler = mediaDevices.ondevicechange;
          mediaDevices.ondevicechange = handleDeviceChange;
          deviceChangeHandlers.push(() => {
            if (mediaDevices.ondevicechange === handleDeviceChange) {
              mediaDevices.ondevicechange = previousHandler ?? null;
            }
          });
        }
      }
    }

    return () => {
      console.log('[renderer] Cleaning up MainWindow useEffect');
      
      // Remove IPC handlers (use removeListener, not 'off' - it doesn't exist in preload)
      if (window.electronAPI) {
        if (startAudioCaptureHandlerRef.current) {
          window.electronAPI.removeListener('start-audio-capture', startAudioCaptureHandlerRef.current);
        }
        if (stopAudioCaptureHandlerRef.current) {
          window.electronAPI.removeListener('stop-audio-capture', stopAudioCaptureHandlerRef.current);
        }
        if (sessionStatusHandlerRef.current) {
          window.electronAPI.removeListener('session-status', sessionStatusHandlerRef.current);
        }
        if (errorHandlerRef.current) {
          window.electronAPI.removeListener('error', errorHandlerRef.current);
        }
        if (sessionManagerReadyHandlerRef.current) {
          window.electronAPI.removeListener('session-manager-ready', sessionManagerReadyHandlerRef.current);
        }
      }
      
      // CRITICAL: Stop the manager using ref
      if (managerRef.current) {
        managerRef.current.stopCapture().catch((err) => {
          console.error('[renderer] Error stopping manager during cleanup:', err);
        });
        managerRef.current = null;
      }
      
      // Clean up interval
      if (checkReadyInterval) {
        clearInterval(checkReadyInterval);
      }
      
      // Clean up device change handlers
      deviceChangeHandlers.forEach((cleanup) => cleanup());
      
      // Reset registration flag to allow re-registration if component remounts
      handlersRegisteredRef.current = false;
    };
  }, [setMicrophones]);

  const handleStartSession = async () => {
    console.log('[renderer] handleStartSession called');
    console.log('[renderer] window.electronAPI available:', !!window.electronAPI);
    console.log('[renderer] isReady:', isReady);
    console.log('[renderer] selectedMode:', selectedMode);

    if (!window.electronAPI) {
      setError('Electron API not available');
      console.error('[renderer] Electron API not available');
      return;
    }

    if (!isReady) {
      setError('App is still initializing. Please wait...');
      console.error('[renderer] App not ready');
      return;
    }

    // Prevent concurrent start calls
    if (sessionStatus.isActive) {
      console.log('[renderer] Session already active, ignoring start request');
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

      console.log('[renderer] Invoking start-session with config:', config);
      const result = await window.electronAPI.invoke('start-session', config) as StartStopResponse;
      console.log('[renderer] start-session result:', result);

      if (result?.success) {
        setSessionStatus({ isActive: true, mode: selectedMode });
        console.log('[renderer] Session started successfully, UI updated');
      } else {
        console.error('[renderer] Session start failed:', result);
        setError('Failed to start session');
      }
    } catch (err: unknown) {
      console.error('[renderer] Error starting session:', err);
      setError(getErrorMessage(err) || 'Failed to start session');
    }
  };

  const handleStopSession = async () => {
    if (!window.electronAPI) {
      return;
    }

    try {
      const result = await window.electronAPI.invoke('stop-session') as StartStopResponse;
      if (result?.success) {
        setSessionStatus({ isActive: false });
      }
    } catch (err: unknown) {
      setError(getErrorMessage(err) || 'Failed to stop session');
    }
  };

  const handlePauseSession = async () => {
    console.log('[renderer] handlePauseSession called');
    console.log('[renderer] sessionStatus.isActive:', sessionStatus.isActive);

    if (!window.electronAPI) {
      console.error('[renderer] Electron API not available for pause');
      return;
    }

    try {
      console.log('[renderer] Invoking pause-session');
      await window.electronAPI.invoke('pause-session');
      console.log('[renderer] pause-session completed');
    } catch (err: unknown) {
      console.error('[renderer] Error pausing session:', err);
      setError(getErrorMessage(err) || 'Failed to pause session');
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

        {audioStateMessage && (
          <div className={`audio-state-message ${audioState === AudioState.ERROR ? 'error' : ''}`}>
            {audioStateMessage}
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

