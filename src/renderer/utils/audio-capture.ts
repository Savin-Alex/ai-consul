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

export interface AudioChunk {
  data: Float32Array;
  sampleRate: number;
  channels: number;
  timestamp: number;
}

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

  async startCapture(options: {
    sources?: ('microphone' | 'system-audio')[];
    sampleRate?: number;
    channels?: number;
    deviceId?: string;
    useAudioWorklet?: boolean;
  } = {}): Promise<void> {
    if (this.isCapturing) {
      return;
    }

    const sources = options.sources || ['microphone'];
    this.sampleRate = options.sampleRate || 16000;
    this.channels = options.channels || 1;
    this.deviceId = options.deviceId || undefined;
    this.useAudioWorklet = options.useAudioWorklet !== false; // Default to true

    try {
      // For microphone, use getUserMedia
      if (sources.includes('microphone')) {
        const audioConstraints: MediaTrackConstraints = {
          sampleRate: this.sampleRate,
          channelCount: this.channels,
          echoCancellation: true,
          noiseSuppression: true,
        };

        if (this.deviceId && this.deviceId !== 'default') {
          audioConstraints.deviceId = { exact: this.deviceId };
        }

        const stream = await navigator.mediaDevices.getUserMedia({
          audio: audioConstraints,
        });

        await this.setupAudioProcessing(stream);
      }

      // For system audio, we need to use desktopCapturer (handled in main process)
      // This will be implemented separately via IPC

      this.isCapturing = true;
    } catch (error) {
      console.error('Failed to start audio capture:', error);
      throw error;
    }
  }

  private async setupAudioProcessing(stream: MediaStream): Promise<void> {
    this.mediaStream = stream;
    this.audioContext = new AudioContext({ sampleRate: this.sampleRate });
    // Update actual sample rate in case the browser chooses a different value
    if (this.audioContext.sampleRate && this.audioContext.sampleRate !== this.sampleRate) {
      this.sampleRate = this.audioContext.sampleRate;
    }
    this.sourceNode = this.audioContext.createMediaStreamSource(stream);

    // Try AudioWorklet first, fallback to ScriptProcessorNode
    if (this.useAudioWorklet && this.audioContext.audioWorklet) {
      try {
        await this.setupAudioWorklet();
        return;
      } catch (error) {
        console.warn('[audio-capture] AudioWorklet setup failed, falling back to ScriptProcessorNode:', error);
        this.useAudioWorklet = false;
      }
    }

    // Fallback to ScriptProcessorNode (deprecated but works)
    this.setupScriptProcessor();
  }

  private async setupAudioWorklet(): Promise<void> {
    if (!this.audioContext || !this.sourceNode) {
      throw new Error('AudioContext or source node not initialized');
    }

    try {
      // Load the AudioWorklet processor module
      // In development, Vite serves public files at root, so use /core/audio/audio-worklet-processor.js
      // In production, files are in dist/renderer, so use the same path
      // The file is copied to src/renderer/public/core/audio/ during build
      const workletPath = new URL('/core/audio/audio-worklet-processor.js', window.location.href).href;

      await this.audioContext.audioWorklet.addModule(workletPath);

      // Create AudioWorkletNode
      this.audioWorkletNode = new AudioWorkletNode(this.audioContext, 'streaming-audio-processor');

      // Set capturing flag BEFORE setting up message handler to prevent race condition
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
      this.sourceNode.connect(this.audioWorkletNode);
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

      this.emit('audio-chunk', chunk);
    };

    this.sourceNode.connect(this.processorNode);
    this.processorNode.connect(this.audioContext.destination);
  }

  async stopCapture(): Promise<void> {
    if (!this.isCapturing) {
      return;
    }

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

