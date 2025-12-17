type Listener = (...args: unknown[]) => void;

// Simple EventEmitter implementation for browser
class EventEmitter {
  private listeners: Map<string, Listener[]> = new Map();

  on(event: string, callback: Listener): void {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, []);
    }
    this.listeners.get(event)!.push(callback);
  }

  emit(event: string, ...args: unknown[]): void {
    const callbacks = this.listeners.get(event);
    if (callbacks) {
      callbacks.forEach((callback) => callback(...args));
    }
  }

  off(event: string, callback: Listener): void {
    const callbacks = this.listeners.get(event);
    if (callbacks) {
      const index = callbacks.indexOf(callback);
      if (index > -1) {
        callbacks.splice(index, 1);
      }
    }
  }
}

import { AudioState } from './audio-state-manager';

export interface AudioChunk {
  data: Float32Array;
  sampleRate: number;
  channels: number;
  timestamp: number;
}

// Re-export AudioState for convenience
export { AudioState };

export class AudioCaptureManager extends EventEmitter {
  private mediaStream: MediaStream | null = null;
  private audioContext: AudioContext | null = null;
  private sourceNode: MediaStreamAudioSourceNode | null = null;
  private processorNode: ScriptProcessorNode | null = null;
  private audioWorkletNode: AudioWorkletNode | null = null;
  private useAudioWorklet: boolean = true;
  private isCapturing = false;
  private sampleRate = 16000;
  private channels = 1;
  private deviceId: string | undefined;
  private currentState: AudioState = AudioState.IDLE;

  private setState(newState: AudioState): void {
    if (this.currentState !== newState) {
      const oldState = this.currentState;
      this.currentState = newState;
      this.emit('state-changed', { old: oldState, current: newState });
      console.log(`[AudioCaptureManager] State changed: ${oldState} -> ${newState}`);
    }
  }

  getState(): AudioState {
    return this.currentState;
  }

  async startCapture(options: {
    sources?: ('microphone' | 'system-audio')[];
    sampleRate?: number;
    channels?: number;
    deviceId?: string;
    useAudioWorklet?: boolean;
  } = {}): Promise<void> {
    if (this.isCapturing) {
      console.warn('[AudioCaptureManager] Already capturing, ignoring start request.');
      return;
    }

    this.setState(AudioState.REQUESTING_PERMISSION);

    const sources = options.sources || ['microphone'];
    this.sampleRate = options.sampleRate || 16000;
    this.channels = options.channels || 1;
    this.deviceId = options.deviceId || undefined;
    this.useAudioWorklet = options.useAudioWorklet !== false; // Default to true

    try {
      // For microphone, use getUserMedia
      if (sources.includes('microphone')) {
        // Start with ideal constraints (browser will use best available match)
        const audioConstraints: MediaTrackConstraints = {
          sampleRate: { ideal: this.sampleRate }, // Use 'ideal' instead of exact value
          channelCount: { ideal: this.channels },
          // DISABLED: echoCancellation and noiseSuppression can filter out speech
          // Enable these only if you have issues with echo/background noise
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false, // Also disable auto gain control
        };

        if (this.deviceId && this.deviceId !== 'default') {
          // Try 'exact' first, but we'll fallback to 'ideal' if it fails
          audioConstraints.deviceId = { exact: this.deviceId };
          console.log('[audio-capture] Using specific microphone device (exact):', this.deviceId);
        } else {
          console.log('[audio-capture] Using default microphone device');
        }

        console.log('[audio-capture] Requesting microphone access with constraints:', audioConstraints);
        
        let stream: MediaStream;
        try {
          stream = await navigator.mediaDevices.getUserMedia({
            audio: audioConstraints,
          });
        } catch (error) {
          // If OverconstrainedError, try with more lenient constraints
          if (error instanceof OverconstrainedError || error instanceof DOMException) {
            console.warn('[audio-capture] OverconstrainedError, trying with lenient constraints:', error);
            
            // Fallback: use 'ideal' for deviceId and remove strict sampleRate
            const fallbackConstraints: MediaTrackConstraints = {
              sampleRate: { ideal: this.sampleRate },
              channelCount: { ideal: this.channels },
              echoCancellation: false,
              noiseSuppression: false,
              autoGainControl: false,
            };
            
            if (this.deviceId && this.deviceId !== 'default') {
              // Try 'ideal' instead of 'exact'
              fallbackConstraints.deviceId = { ideal: this.deviceId };
              console.log('[audio-capture] Retrying with deviceId (ideal):', this.deviceId);
            }
            
            try {
              stream = await navigator.mediaDevices.getUserMedia({
                audio: fallbackConstraints,
              });
              console.log('[audio-capture] Successfully obtained stream with fallback constraints');
            } catch (fallbackError) {
              // Last resort: minimal constraints
              console.warn('[audio-capture] Fallback also failed, trying minimal constraints:', fallbackError);
              stream = await navigator.mediaDevices.getUserMedia({
                audio: this.deviceId && this.deviceId !== 'default' 
                  ? { deviceId: { ideal: this.deviceId } }
                  : true,
              });
              console.log('[audio-capture] Successfully obtained stream with minimal constraints');
            }
          } else {
            // Re-throw non-constraint errors
            throw error;
          }
        }
        
        // Log actual track settings (browser may override our constraints)
        const audioTrack = stream.getAudioTracks()[0];
        if (audioTrack) {
          const settings = audioTrack.getSettings();
          console.log('[audio-capture] Actual microphone settings:', {
            deviceId: settings.deviceId,
            label: audioTrack.label,
            sampleRate: settings.sampleRate,
            channelCount: settings.channelCount,
            echoCancellation: settings.echoCancellation,
            noiseSuppression: settings.noiseSuppression,
            autoGainControl: settings.autoGainControl,
          });
          
          // Update sampleRate to match actual stream sample rate (browser may have chosen different rate)
          if (settings.sampleRate && settings.sampleRate !== this.sampleRate) {
            console.log('[audio-capture] Updating sampleRate to match stream:', {
              requested: this.sampleRate,
              actual: settings.sampleRate,
            });
            this.sampleRate = settings.sampleRate;
          }
        }

        this.setState(AudioState.INITIALIZING_CONTEXT);
        await this.setupAudioProcessing(stream);
      }

      // For system audio, we need to use desktopCapturer (handled in main process)
      // This will be implemented separately via IPC

      this.isCapturing = true;
      this.setState(AudioState.RECORDING);
      console.log('[AudioCaptureManager] Audio capture started successfully.');
    } catch (error) {
      console.error('[AudioCaptureManager] Failed to start audio capture:', error);
      this.setState(AudioState.ERROR);
      throw error;
    }
  }

  private async setupAudioProcessing(stream: MediaStream): Promise<void> {
    this.mediaStream = stream;
    this.audioContext = new AudioContext({ sampleRate: this.sampleRate });
    
    // CRITICAL: Resume AudioContext if suspended (required for audio processing)
    // AudioContext starts in 'suspended' state in many browsers and needs user interaction to resume
    if (this.audioContext.state === 'suspended') {
      console.log('[audio-capture] AudioContext is suspended, resuming...');
      await this.audioContext.resume();
      console.log('[audio-capture] AudioContext resumed, state:', this.audioContext.state);
    }
    
    // Update actual sample rate in case the browser chooses a different value
    if (this.audioContext.sampleRate && this.audioContext.sampleRate !== this.sampleRate) {
      console.log('[audio-capture] Sample rate mismatch:', {
        requested: this.sampleRate,
        actual: this.audioContext.sampleRate,
      });
      this.sampleRate = this.audioContext.sampleRate;
    }
    
    console.log('[audio-capture] Creating MediaStreamAudioSourceNode from stream');
    this.sourceNode = this.audioContext.createMediaStreamSource(stream);
    console.log('[audio-capture] MediaStreamAudioSourceNode created:', {
      numberOfInputs: this.sourceNode.numberOfInputs,
      numberOfOutputs: this.sourceNode.numberOfOutputs,
      channelCount: this.sourceNode.channelCount,
    });

    // Try AudioWorklet first, fallback to ScriptProcessorNode
    if (this.useAudioWorklet && this.audioContext.audioWorklet) {
      try {
        this.setState(AudioState.LOADING_WORKLET);
        await this.setupAudioWorklet();
        this.setState(AudioState.READY);
        return;
      } catch (error) {
        console.warn('[audio-capture] AudioWorklet setup failed, falling back to ScriptProcessorNode:', error);
        this.useAudioWorklet = false;
      }
    }

    // Fallback to ScriptProcessorNode (deprecated but works)
    this.setupScriptProcessor();
    this.setState(AudioState.READY);
  }

  private async setupAudioWorklet(): Promise<void> {
    if (!this.audioContext || !this.sourceNode) {
      throw new Error('AudioContext or source node not initialized');
    }

    try {
      // CRITICAL: Resume AudioContext if suspended (required for audio processing)
      if (this.audioContext.state === 'suspended') {
        console.log('[audio-capture] AudioContext is suspended, resuming...');
        await this.audioContext.resume();
        console.log('[audio-capture] AudioContext resumed, state:', this.audioContext.state);
      }

      // Verify stream tracks are active
      if (this.mediaStream) {
        const audioTracks = this.mediaStream.getAudioTracks();
        console.log('[audio-capture] Stream audio tracks:', audioTracks.map(track => ({
          id: track.id,
          label: track.label,
          enabled: track.enabled,
          muted: track.muted,
          readyState: track.readyState,
          settings: track.getSettings(),
        })));
        
        // Ensure tracks are enabled (muted is read-only, can't change it)
        audioTracks.forEach(track => {
          if (!track.enabled) {
            console.warn('[audio-capture] Audio track is disabled, enabling...');
            track.enabled = true;
          }
          if (track.muted) {
            console.warn('[audio-capture] WARNING: Audio track is muted (read-only, cannot change)');
          }
        });
      }

      // Load the AudioWorklet processor module
      // In development, Vite serves public files at root, so use /core/audio/audio-worklet-processor.js
      // In production, files are in dist/renderer, so use the same path
      // The file is copied to src/renderer/public/core/audio/ during build
      const workletPath = new URL('/core/audio/audio-worklet-processor.js', window.location.href).href;

      console.log('[audio-capture] Loading AudioWorklet from:', workletPath);
      await this.audioContext.audioWorklet.addModule(workletPath);
      console.log('[audio-capture] AudioWorklet module loaded');

      // Create AudioWorkletNode
      this.audioWorkletNode = new AudioWorkletNode(this.audioContext, 'streaming-audio-processor');
      console.log('[audio-capture] AudioWorkletNode created');

      // Set capturing flag BEFORE setting up message handler to prevent race condition
      console.log('[audio-capture] Setting up AudioWorklet message handler');
      // This ensures messages are only processed when we're actually capturing
      const wasCapturing = this.isCapturing;
      this.isCapturing = true;

      // Handle messages from the worklet
      this.audioWorkletNode.port.onmessage = (event) => {
        // Double-check capturing state (defensive programming)
        if (!this.isCapturing) {
          return;
        }

        // Validate event data structure
        if (!event || !event.data || typeof event.data !== 'object') {
          console.warn('[audio-capture] Invalid worklet message:', event);
          return;
        }

        const { type, data, timestamp, sampleRate, message } = event.data;

        if (type === 'audio-chunk') {
          // Data is sent as Float32Array via Transferable (no conversion needed)
          // Validate data before processing
          let audioData: Float32Array;
          if (data instanceof Float32Array) {
            // Direct Float32Array (Transferable)
            audioData = data;
          } else if (Array.isArray(data)) {
            // Fallback: convert array to Float32Array (shouldn't happen with Transferable)
            audioData = new Float32Array(data);
          } else {
            console.warn('[audio-capture] Invalid audio chunk data type:', typeof data);
            return;
          }

          const chunk: AudioChunk = {
            data: audioData,
            sampleRate: (typeof sampleRate === 'number' && sampleRate > 0) ? sampleRate : this.sampleRate,
            channels: this.channels,
            timestamp: (typeof timestamp === 'number' && timestamp > 0) ? timestamp : Date.now(),
          };

          // Calculate max amplitude safely (avoid stack overflow)
          let maxAmplitude = 0;
          const sampleCount = Math.min(100, chunk.data.length);
          for (let i = 0; i < sampleCount; i++) {
            const abs = Math.abs(chunk.data[i]);
            if (abs > maxAmplitude) maxAmplitude = abs;
          }
          
          // Calculate average amplitude
          let sumAbs = 0;
          for (let i = 0; i < chunk.data.length; i++) {
            sumAbs += Math.abs(chunk.data[i]);
          }
          const avgAmplitude = sumAbs / chunk.data.length;
          
          console.log('[audio-capture] Emitting audio-chunk event:', {
            samples: chunk.data.length,
            sampleRate: chunk.sampleRate,
            channels: chunk.channels,
            timestamp: chunk.timestamp,
            maxAmplitude: maxAmplitude.toFixed(6),
            avgAmplitude: avgAmplitude.toFixed(6),
            first5Samples: Array.from(chunk.data.slice(0, 5)).map(v => v.toFixed(6)),
            last5Samples: Array.from(chunk.data.slice(-5)).map(v => v.toFixed(6)),
          });
          this.emit('audio-chunk', chunk);
        } else if (type === 'processor-ready') {
          console.log('[audio-capture] AudioWorklet processor ready', {
            sourceSampleRate: event.data.sourceSampleRate,
            targetSampleRate: event.data.targetSampleRate,
          });
        } else if (type === 'error') {
          console.error('[audio-capture] AudioWorklet error:', message || 'Unknown error');
          this.emit('error', new Error(message || 'AudioWorklet error'));
        }
      };

      // Connect the audio graph
      console.log('[audio-capture] Connecting sourceNode to audioWorkletNode');
      console.log('[audio-capture] SourceNode:', {
        numberOfInputs: this.sourceNode.numberOfInputs,
        numberOfOutputs: this.sourceNode.numberOfOutputs,
        channelCount: this.sourceNode.channelCount,
        channelCountMode: this.sourceNode.channelCountMode,
      });
      console.log('[audio-capture] AudioWorkletNode:', {
        numberOfInputs: this.audioWorkletNode.numberOfInputs,
        numberOfOutputs: this.audioWorkletNode.numberOfOutputs,
        channelCount: this.audioWorkletNode.channelCount,
        channelCountMode: this.audioWorkletNode.channelCountMode,
      });
      
      this.sourceNode.connect(this.audioWorkletNode);
      console.log('[audio-capture] Audio graph connected');
      // Note: AudioWorkletNode doesn't need to connect to destination
      
      // Restore capturing state if it wasn't set
      if (!wasCapturing) {
        this.isCapturing = false;
      }
    } catch (error) {
      console.error('[audio-capture] Failed to setup AudioWorklet:', error);
      throw error;
    }
  }

  private setupScriptProcessor(): void {
    if (!this.audioContext || !this.sourceNode) {
      throw new Error('AudioContext or source node not initialized');
    }

    // Create script processor for chunking (deprecated but works)
    const bufferSize = 4096;
    this.processorNode = this.audioContext.createScriptProcessor(
      bufferSize,
      this.channels,
      this.channels
    );

    this.processorNode.onaudioprocess = (event) => {
      if (!this.isCapturing) return;

      const inputBuffer = event.inputBuffer;
      const channelData = inputBuffer.getChannelData(0);
      const float32Array = new Float32Array(channelData.length);
      float32Array.set(channelData);

      const chunk: AudioChunk = {
        data: float32Array,
        sampleRate: this.audioContext!.sampleRate,
        channels: this.channels,
        timestamp: Date.now(),
      };

      console.log('[audio-capture] Emitting audio-chunk event (ScriptProcessor):', {
        samples: chunk.data.length,
        sampleRate: chunk.sampleRate,
        channels: chunk.channels,
        timestamp: chunk.timestamp,
        maxAmplitude: Math.max(...Array.from(chunk.data.slice(0, 100).map(Math.abs))),
      });
      this.emit('audio-chunk', chunk);
    };

    this.sourceNode.connect(this.processorNode);
    this.processorNode.connect(this.audioContext.destination);
  }

  async stopCapture(): Promise<void> {
    if (!this.isCapturing) {
      return;
    }

    this.setState(AudioState.STOPPING);

    // Set capturing to false first to stop processing new messages
    this.isCapturing = false;

    if (this.audioWorkletNode) {
      // Note: AudioWorklet processors can't receive messages directly in process()
      // The flush will happen naturally when audio stops, or we can trigger it
      // by checking a flag. For now, we'll rely on the worklet to flush remaining
      // data when audio input stops (which happens automatically).
      
      // Remove message handler to prevent memory leak
      this.audioWorkletNode.port.onmessage = null;
      
      // Small delay to allow any pending messages to be processed
      await new Promise(resolve => setTimeout(resolve, 50));
      
      this.audioWorkletNode.disconnect();
      this.audioWorkletNode.port.close();
      this.audioWorkletNode = null;
    }

    if (this.processorNode) {
      this.processorNode.disconnect();
      this.processorNode = null;
    }

    if (this.sourceNode) {
      this.sourceNode.disconnect();
      this.sourceNode = null;
    }

    if (this.audioContext) {
      await this.audioContext.close();
      this.audioContext = null;
    }

    if (this.mediaStream) {
      this.mediaStream.getTracks().forEach((track) => track.stop());
      this.mediaStream = null;
    }

    this.setState(AudioState.IDLE);
    console.log('[AudioCaptureManager] Audio capture stopped successfully.');
  }

  getIsCapturing(): boolean {
    return this.isCapturing;
  }

  async listInputDevices(): Promise<MediaDeviceInfo[]> {
    if (!navigator.mediaDevices?.enumerateDevices) {
      return [];
    }

    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      return devices.filter((device) => device.kind === 'audioinput');
    } catch (error) {
      console.error('Failed to enumerate audio devices:', error);
      return [];
    }
  }
}

