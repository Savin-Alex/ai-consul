import React, { useState, useEffect, useRef } from 'react';
import './MainWindow.css';
import { AudioCaptureManager, AudioChunk, AudioState } from '../../utils/audio-capture';
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

  useEffect(() => {
    selectedMicrophoneRef.current = selectedMicrophoneId;
  }, [selectedMicrophoneId]);

  useEffect(() => {
    // Initialize audio manager
    const manager = new AudioCaptureManager();

    // Set up audio chunk handler (store reference for cleanup)
    const audioChunkHandler = (chunk: unknown) => {
      const audioChunk = chunk as AudioChunk;
      if (!audioChunk || !audioChunk.data) {
        console.warn('[renderer] Invalid audio chunk received');
        return;
      }
      // Calculate max amplitude safely (avoid stack overflow with large arrays)
      let maxAmplitude = 0;
      let sumAmplitude = 0;
      for (let i = 0; i < audioChunk.data.length; i++) {
        const abs = Math.abs(audioChunk.data[i]);
        if (abs > maxAmplitude) {
          maxAmplitude = abs;
        }
        sumAmplitude += abs;
      }
      const avgAmplitude = sumAmplitude / audioChunk.data.length;
      
      console.log('[renderer] Audio chunk received from manager:', {
        dataLength: audioChunk.data.length,
        sampleRate: audioChunk.sampleRate,
        maxAmplitude: maxAmplitude,
        avgAmplitude: avgAmplitude,
        timestamp: audioChunk.timestamp
      });

      // Send audio chunk to main process for processing
      if (window.electronAPI) {
        const audioData = audioChunk.data;
        
        // DEBUG: Log original audio data before encoding
        let maxVal = 0;
        let minVal = 0;
        let sumAbs = 0;
        for (let i = 0; i < Math.min(100, audioData.length); i++) {
          const val = audioData[i];
          if (val > maxVal) maxVal = val;
          if (val < minVal) minVal = val;
          sumAbs += Math.abs(val);
        }
        const avgAbs = sumAbs / Math.min(100, audioData.length);
        
        console.log('[renderer] BEFORE encoding - Original Float32Array:', {
          length: audioData.length,
          first10: Array.from(audioData.slice(0, 10)),
          last10: Array.from(audioData.slice(-10)),
          max: maxVal,
          min: minVal,
          avgAbs: avgAbs,
          bufferByteLength: audioData.buffer.byteLength,
          byteOffset: audioData.byteOffset,
          byteLength: audioData.byteLength,
        });
        
        // CRITICAL: Specify byteOffset and byteLength to get ONLY our data
        // AudioWorklet may return views into larger shared buffers, so we must
        // account for byteOffset to avoid encoding zeros from the entire buffer
        const uint8Array = new Uint8Array(
          audioData.buffer,
          audioData.byteOffset,
          audioData.byteLength
        );
        
        console.log('[renderer] Uint8Array for encoding:', {
          length: uint8Array.length,
          first10: Array.from(uint8Array.slice(0, 10)),
          last10: Array.from(uint8Array.slice(-10)),
          expectedLength: audioData.length * 4, // Float32 = 4 bytes per sample
        });
        
        let binaryString = '';
        // Build binary string character by character to avoid stack overflow
        for (let i = 0; i < uint8Array.length; i++) {
          binaryString += String.fromCharCode(uint8Array[i]);
        }
        const base64Data = btoa(binaryString);
        
        const chunkData = {
          data: base64Data, // Base64 encoded binary data
          dataLength: audioData.length, // Original array length
          sampleRate: audioChunk.sampleRate,
          channels: audioChunk.channels,
          timestamp: audioChunk.timestamp,
        };
        console.log('[renderer] Sending audio chunk to main process:', {
          dataLength: chunkData.dataLength,
          base64Length: base64Data.length,
          sampleRate: chunkData.sampleRate,
        });
        window.electronAPI.send('audio-chunk', chunkData);
      } else {
        console.error('[renderer] window.electronAPI not available for sending audio chunk');
      }
    };
    manager.on('audio-chunk', audioChunkHandler);

    // Listen for session status updates
    let checkReadyInterval: NodeJS.Timeout | null = null;
    const deviceChangeHandlers: Array<() => void> = [];

    // Store handler references for cleanup (declare outside if block for scope)
    const sessionStatusHandler = (status: SessionStatus) => {
      setSessionStatus(status);
    };
    
    const errorHandler = (err: string) => {
      setError(err);
      setTimeout(() => setError(null), 5000);
    };
    
    const sessionManagerReadyHandler = (data: SessionManagerReadyPayload) => {
      console.log('Received session-manager-ready event:', data);
      if (data?.ready) {
        console.log('Setting ready state to true');
        setIsReady(true);
      }
    };

    // Store handler references for cleanup (declare outside if block for scope)
    let startAudioCaptureHandler: ((config: AudioCaptureConfig) => Promise<void>) | null = null;
    let stopAudioCaptureHandler: (() => Promise<void>) | null = null;

    if (window.electronAPI) {
      window.electronAPI.on('session-status', sessionStatusHandler);
      window.electronAPI.on('error', errorHandler);
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
    }

    // Subscribe to audio state changes (store handler reference for cleanup)
    // Defined outside if block so it's accessible in cleanup
    const stateChangedHandler = (event: any) => {
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
    };
    manager.on('state-changed', stateChangedHandler);

    if (window.electronAPI) {

      // Store handler reference for cleanup
      // Use a flag to prevent concurrent handler executions
      let isHandlingStart = false;
      startAudioCaptureHandler = async (config: AudioCaptureConfig) => {
        // Prevent concurrent handler executions
        if (isHandlingStart) {
          console.warn('[renderer] Start handler already executing, ignoring duplicate call');
          // Still send a response to prevent timeout
          const currentState = manager.getState();
          if (window.electronAPI) {
            window.electronAPI.send('audio-capture-ready', { 
              success: currentState === AudioState.RECORDING || currentState === AudioState.READY,
              state: currentState,
              error: 'Handler already executing'
            });
          }
          return;
        }

        console.log('[renderer] Received start-audio-capture event with config:', config);
        isHandlingStart = true;
        
        try {
          // Check current state to prevent duplicate calls
          const currentState = manager.getState();
          if (currentState === AudioState.RECORDING) {
            console.log('[renderer] Already recording, sending confirmation');
            if (window.electronAPI) {
              window.electronAPI.send('audio-capture-ready', { 
                success: true,
                state: currentState
              });
            }
            return;
          }

          const captureConfig = {
            ...config,
            deviceId: selectedMicrophoneRef.current,
          };
          console.log('[renderer] Starting audio capture with config:', captureConfig);
          
          // Set a timeout to ensure we always send a response
          const responseTimeout = setTimeout(() => {
            if (isHandlingStart) {
              console.error('[renderer] Audio capture start timeout, sending error response');
              const timeoutState = manager.getState();
              if (window.electronAPI) {
                window.electronAPI.send('audio-capture-ready', { 
                  success: false,
                  error: 'Audio capture start timed out',
                  state: timeoutState
                });
              }
              isHandlingStart = false;
            }
          }, 10000); // 10 second timeout

          try {
            await manager.startCapture(captureConfig);
            
            // Wait for state to reach RECORDING or READY (with a small delay to ensure state is stable)
            await new Promise(resolve => setTimeout(resolve, 200));
            const finalState = manager.getState();
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
              state: manager.getState()
            });
          }
        } finally {
          isHandlingStart = false;
        }
      };

      window.electronAPI.on('start-audio-capture', startAudioCaptureHandler);

      stopAudioCaptureHandler = async () => {
        console.log('[renderer] Received stop-audio-capture event');
        try {
          await manager.stopCapture();
          console.log('[renderer] Audio capture stopped successfully');
        } catch (err: unknown) {
          console.error('[renderer] Failed to stop audio capture:', err);
          setError(getErrorMessage(err) || 'Failed to stop audio capture');
        }
      };

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
      // Remove IPC handlers (handlers are in scope from above)
      if (window.electronAPI) {
        // Use removeListener (off is just an alias)
        if (startAudioCaptureHandler) {
          window.electronAPI.removeListener('start-audio-capture', startAudioCaptureHandler);
        }
        if (stopAudioCaptureHandler) {
          window.electronAPI.removeListener('stop-audio-capture', stopAudioCaptureHandler);
        }
        window.electronAPI.removeListener('session-status', sessionStatusHandler);
        window.electronAPI.removeListener('error', errorHandler);
        window.electronAPI.removeListener('session-manager-ready', sessionManagerReadyHandler);
      }
      
      // Remove audio manager event listeners
      manager.off('audio-chunk', audioChunkHandler);
      manager.off('state-changed', stateChangedHandler);
      
      // Clean up audio manager
      manager.stopCapture().catch(console.error);
      
      // Clean up interval
      if (checkReadyInterval) {
        clearInterval(checkReadyInterval);
      }
      
      // Clean up device change handlers
      deviceChangeHandlers.forEach((cleanup) => cleanup());
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

