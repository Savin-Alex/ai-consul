import { EventEmitter } from 'events';

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

  async startCapture(options: {
    sources?: ('microphone' | 'system-audio')[];
    sampleRate?: number;
    channels?: number;
    useAudioWorklet?: boolean;
  } = {}): Promise<void> {
    if (this.isCapturing) {
      return;
    }

    const sources = options.sources || ['microphone'];
    this.sampleRate = options.sampleRate || 16000;
    this.channels = options.channels || 1;
    this.useAudioWorklet = options.useAudioWorklet !== false; // Default to true

    try {
      // For microphone, use getUserMedia
      if (sources.includes('microphone')) {
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: {
            sampleRate: this.sampleRate,
            channelCount: this.channels,
            echoCancellation: true,
            noiseSuppression: true,
          },
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
    this.sourceNode = this.audioContext.createMediaStreamSource(stream);

    // Try AudioWorklet first, fallback to ScriptProcessorNode
    if (this.useAudioWorklet && this.audioContext.audioWorklet) {
      try {
        await this.setupAudioWorklet();
        return;
      } catch (error) {
        console.warn('AudioWorklet setup failed, falling back to ScriptProcessorNode:', error);
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

    // AudioWorklet is not available in Node.js main process (Electron limitation)
    // This code path should not be reached in main process, but add check for safety
    if (typeof window === 'undefined') {
      throw new Error('AudioWorklet is not available in Node.js main process. Use renderer process instead.');
    }

    try {
      // Load the AudioWorklet processor module
      // In Electron renderer, we need to use the correct path
      // The worklet file must be accessible via HTTP/HTTPS or file:// protocol
      const workletPath = process.env.NODE_ENV === 'development'
        ? new URL('/src/core/audio/audio-worklet-processor.js', window.location.href).href
        : new URL('/dist/core/audio/audio-worklet-processor.js', window.location.href).href;

      await this.audioContext.audioWorklet.addModule(workletPath);

      // Create AudioWorkletNode
      this.audioWorkletNode = new AudioWorkletNode(this.audioContext, 'streaming-audio-processor');

      // Set capturing flag BEFORE setting up message handler to prevent race condition
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
          console.warn('[AudioCapture] Invalid worklet message:', event);
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
            console.warn('[AudioCapture] Invalid audio chunk data type:', typeof data);
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
          console.log('[AudioCapture] AudioWorklet processor ready', {
            sourceSampleRate: event.data.sourceSampleRate,
            targetSampleRate: event.data.targetSampleRate,
          });
        } else if (type === 'error') {
          console.error('[AudioCapture] AudioWorklet error:', message || 'Unknown error');
          this.emit('error', new Error(message || 'AudioWorklet error'));
        }
      };
      
      // Restore capturing state if it wasn't set
      if (!wasCapturing) {
        this.isCapturing = false;
      }

      // Connect the audio graph
      this.sourceNode.connect(this.audioWorkletNode);
      // Note: AudioWorkletNode doesn't need to connect to destination
    } catch (error) {
      console.error('Failed to setup AudioWorklet:', error);
      throw error;
    }
  }

  private setupScriptProcessor(): void {
    if (!this.audioContext || !this.sourceNode) {
      throw new Error('AudioContext or source node not initialized');
    }

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
        sampleRate: this.sampleRate,
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
}

