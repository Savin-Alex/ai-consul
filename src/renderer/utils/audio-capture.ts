// Simple EventEmitter implementation for browser
class EventEmitter {
  private listeners: Map<string, Function[]> = new Map();

  on(event: string, callback: Function): void {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, []);
    }
    this.listeners.get(event)!.push(callback);
  }

  emit(event: string, ...args: any[]): void {
    const callbacks = this.listeners.get(event);
    if (callbacks) {
      callbacks.forEach(callback => callback(...args));
    }
  }

  off(event: string, callback: Function): void {
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
  private isCapturing = false;
  private sampleRate = 16000;
  private channels = 1;

  async startCapture(options: {
    sources?: ('microphone' | 'system-audio')[];
    sampleRate?: number;
    channels?: number;
  } = {}): Promise<void> {
    if (this.isCapturing) {
      return;
    }

    const sources = options.sources || ['microphone'];
    this.sampleRate = options.sampleRate || 16000;
    this.channels = options.channels || 1;

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

        this.setupAudioProcessing(stream);
      }

      // For system audio, we need to use desktopCapturer (handled in main process)
      // This will be implemented separately via IPC

      this.isCapturing = true;
    } catch (error) {
      console.error('Failed to start audio capture:', error);
      throw error;
    }
  }

  private setupAudioProcessing(stream: MediaStream): void {
    this.mediaStream = stream;
    this.audioContext = new AudioContext({ sampleRate: this.sampleRate });
    this.sourceNode = this.audioContext.createMediaStreamSource(stream);

    // Create script processor for chunking (deprecated but works)
    // In production, use AudioWorklet for better performance
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

    this.isCapturing = false;

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

