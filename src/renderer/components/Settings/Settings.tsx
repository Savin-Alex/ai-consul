import React, { useState, useCallback, useRef, useEffect } from 'react';
import { useAppStore } from '../../stores/app-state';
import './Settings.css';

const Settings: React.FC = () => {
  const {
    audioSource,
    privacyMode,
    performanceTier,
    setAudioSource,
    setPrivacyMode,
    setPerformanceTier,
    microphones,
    selectedMicrophoneId,
    setMicrophones,
    setSelectedMicrophone,
  } = useAppStore();
  const [isOpen, setIsOpen] = useState(false);
  const [micTestStatus, setMicTestStatus] = useState<'idle' | 'recording' | 'playing' | 'success' | 'error'>('idle');
  const [micTestMessage, setMicTestMessage] = useState<string>('');
  const [playbackUrl, setPlaybackUrl] = useState<string | null>(null);
  const playbackAudioRef = useRef<HTMLAudioElement | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const testStreamRef = useRef<MediaStream | null>(null);
  const recordedChunksRef = useRef<Blob[]>([]);
  const testTimeoutRef = useRef<number | null>(null);

  const refreshMicrophones = useCallback(async () => {
    if (!navigator.mediaDevices?.enumerateDevices) {
      console.warn('Media devices API not available');
      return;
    }

    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      setMicrophones(devices.filter((device) => device.kind === 'audioinput'));
    } catch (error) {
      console.error('Failed to refresh microphone list:', error);
    }
  }, [setMicrophones]);

  const cleanupMicTest = useCallback(() => {
    if (testTimeoutRef.current !== null) {
      window.clearTimeout(testTimeoutRef.current);
      testTimeoutRef.current = null;
    }

    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      mediaRecorderRef.current.stop();
    }
    mediaRecorderRef.current = null;

    if (testStreamRef.current) {
      testStreamRef.current.getTracks().forEach((track) => track.stop());
      testStreamRef.current = null;
    }

    recordedChunksRef.current = [];

    if (playbackUrl) {
      URL.revokeObjectURL(playbackUrl);
      setPlaybackUrl(null);
    }
  }, [playbackUrl]);

  const ensureDevicePermission = useCallback(async (deviceId: string) => {
    try {
      const constraints: MediaStreamConstraints = {
        audio:
          deviceId === 'default'
            ? true
            : {
                deviceId: { exact: deviceId },
              },
      };
      const stream = await navigator.mediaDevices.getUserMedia(constraints);
      stream.getTracks().forEach((track) => track.stop());
      await refreshMicrophones();
    } catch (error) {
      console.error('Microphone permission request failed:', error);
    }
  }, [refreshMicrophones]);

  const handleMicrophoneChange = useCallback(
    async (deviceId: string) => {
      setSelectedMicrophone(deviceId);
      await ensureDevicePermission(deviceId);
    },
    [ensureDevicePermission, setSelectedMicrophone]
  );

  const startMicTest = useCallback(async () => {
    if (!navigator.mediaDevices?.getUserMedia) {
      setMicTestStatus('error');
      setMicTestMessage('Microphone testing is not supported in this browser.');
      return;
    }

    cleanupMicTest();

    try {
      setMicTestStatus('recording');
      setMicTestMessage('Recording a short sample...');

      const constraints: MediaStreamConstraints = {
        audio:
          selectedMicrophoneId === 'default'
            ? true
            : {
                deviceId: { exact: selectedMicrophoneId },
              },
      };

      const stream = await navigator.mediaDevices.getUserMedia(constraints);
      testStreamRef.current = stream;

      const mimeType = MediaRecorder.isTypeSupported('audio/webm') ? 'audio/webm' : '';
      const mediaRecorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
      mediaRecorderRef.current = mediaRecorder;
      recordedChunksRef.current = [];

      mediaRecorder.addEventListener('dataavailable', (event) => {
        if (event.data?.size > 0) {
          recordedChunksRef.current.push(event.data);
        }
      });

      mediaRecorder.addEventListener('stop', () => {
        const blob = new Blob(recordedChunksRef.current, { type: mimeType || 'audio/webm' });
        
        // Check if we have any recorded data
        if (blob.size === 0) {
          console.error('No audio data recorded');
          setMicTestStatus('error');
          setMicTestMessage('No audio was recorded. Please try again.');
          if (testStreamRef.current) {
            testStreamRef.current.getTracks().forEach((track) => track.stop());
            testStreamRef.current = null;
          }
          return;
        }

        const url = URL.createObjectURL(blob);
        setPlaybackUrl(url);
        setMicTestStatus('playing');
        setMicTestMessage('Playing back your recording...');

        const audioElement = playbackAudioRef.current;
        if (audioElement) {
          // Clear previous source and error handlers
          audioElement.onerror = null;
          audioElement.onloadeddata = null;
          
          // Set up error handler before setting src
          audioElement.onerror = () => {
            console.error('Audio element error:', audioElement.error);
            setMicTestStatus('error');
            setMicTestMessage('Unable to play the recording. The audio format may not be supported.');
            URL.revokeObjectURL(url);
          };

          // Wait for audio to be ready before playing
          const handleCanPlay = () => {
            audioElement.play().catch((error) => {
              console.error('Failed to play microphone test audio:', error);
              setMicTestStatus('error');
              setMicTestMessage('Unable to play the recording. Check your output device.');
            });
          };

          // Try multiple events to ensure audio is ready
          audioElement.onloadeddata = handleCanPlay;
          audioElement.oncanplay = handleCanPlay;
          
          // Fallback: if loadedmetadata fires, try playing after a short delay
          audioElement.onloadedmetadata = () => {
            setTimeout(() => {
              if (audioElement.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) {
                handleCanPlay();
              }
            }, 100);
          };

          // Set src after setting up handlers
          audioElement.src = url;
          audioElement.load(); // Force reload to trigger events
          
          // Fallback timeout in case events don't fire
          setTimeout(() => {
            if (audioElement.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA && audioElement.paused) {
              handleCanPlay();
            }
          }, 500);
        }

        if (testStreamRef.current) {
          testStreamRef.current.getTracks().forEach((track) => track.stop());
          testStreamRef.current = null;
        }
      });

      mediaRecorder.start();

      testTimeoutRef.current = window.setTimeout(() => {
        if (mediaRecorder.state !== 'inactive') {
          mediaRecorder.stop();
        }
        testTimeoutRef.current = null;
      }, 3000);
    } catch (error) {
      console.error('Microphone test failed:', error);
      cleanupMicTest();
      setMicTestStatus('error');
      setMicTestMessage(
        error instanceof Error
          ? error.message
          : 'Unable to access the microphone. Check permissions and try again.'
      );
    }
  }, [cleanupMicTest, selectedMicrophoneId]);

  const stopMicTest = useCallback(() => {
    setMicTestMessage('Microphone test stopped.');
    setMicTestStatus('idle');
    cleanupMicTest();
  }, [cleanupMicTest]);

  useEffect(() => {
    return () => {
      cleanupMicTest();
    };
  }, [cleanupMicTest]);

  useEffect(() => {
    const audioElement = playbackAudioRef.current;
    if (!audioElement) {
      return;
    }

    const handleEnded = () => {
      setMicTestStatus('success');
      setMicTestMessage('Microphone test complete. If you heard the playback, the microphone is working.');
    };

    const handleError = () => {
      if (audioElement.error) {
        console.error('Audio playback error:', audioElement.error);
        setMicTestStatus('error');
        setMicTestMessage('Unable to play the recording. The audio format may not be supported.');
      }
    };

    audioElement.addEventListener('ended', handleEnded);
    audioElement.addEventListener('error', handleError);

    return () => {
      audioElement.removeEventListener('ended', handleEnded);
      audioElement.removeEventListener('error', handleError);
    };
  }, []);

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

          <div className="settings-section">
            <label>Microphone</label>
            <div className="microphone-select">
              <select
                value={selectedMicrophoneId}
                onChange={(e) => handleMicrophoneChange(e.target.value)}
              >
                <option value="default">System Default</option>
                {microphones.map((device) => (
                  <option key={device.deviceId} value={device.deviceId}>
                    {device.label || device.deviceId || 'Microphone'}
                  </option>
                ))}
              </select>
              <button className="btn btn-small" onClick={refreshMicrophones} type="button">
                ↻
              </button>
            </div>
            <small className="settings-hint">
              Grant microphone access if device names are empty, then refresh.
            </small>
          </div>

          <div className="settings-section">
            <label>Microphone Test</label>
            <div className="mic-test-controls">
              <button
                className="btn"
                type="button"
                onClick={micTestStatus === 'recording' ? stopMicTest : startMicTest}
                disabled={micTestStatus === 'playing'}
              >
                {micTestStatus === 'recording' ? '⏹ Stop Test' : '🎤 Test Microphone'}
              </button>

              {playbackUrl && (
                <button
                  className="btn btn-secondary"
                  type="button"
                  onClick={() => {
                    if (playbackAudioRef.current) {
                      playbackAudioRef.current.currentTime = 0;
                      playbackAudioRef.current.play().catch((error) => {
                        console.error('Failed to replay microphone sample:', error);
                      });
                      setMicTestStatus('playing');
                      setMicTestMessage('Replaying your recording...');
                    }
                  }}
                  disabled={micTestStatus === 'recording'}
                >
                  🔁 Play Again
                </button>
              )}
            </div>
            <audio 
              ref={playbackAudioRef} 
              className="mic-test-audio" 
              controls 
              preload="none"
              style={{ display: playbackUrl ? 'block' : 'none' }} 
            />
            {micTestMessage && (
              <div className={`mic-test-status ${micTestStatus}`}>
                {micTestMessage}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export default Settings;

