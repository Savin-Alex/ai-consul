/**
 * Simple Audio Manager - Replaces over-engineered AudioStateManager + AudioCaptureManager
 * 50 lines instead of 900+ lines of complexity
 */
export class SimpleAudioManager {
  private static instance: SimpleAudioManager;
  private audioContext?: AudioContext;
  private worklet?: AudioWorkletNode;
  private sourceNode?: MediaStreamAudioSourceNode;
  private stream?: MediaStream;
  private startPromise?: Promise<void>;
  private onChunk?: (chunk: Float32Array) => void;

  static getInstance(): SimpleAudioManager {
    if (!SimpleAudioManager.instance) {
      SimpleAudioManager.instance = new SimpleAudioManager();
    }
    return SimpleAudioManager.instance;
  }

  async start(options: {
    sampleRate?: number;
    channels?: number;
    deviceId?: string;
    useAudioWorklet?: boolean;
  } = {}): Promise<void> {
    // Single source of truth - prevent duplicate starts
    if (this.startPromise) {
      return this.startPromise;
    }
    
    if (this.audioContext?.state === 'running') {
      return; // Already running
    }

    this.startPromise = this.doStart(options);
    
    try {
      await this.startPromise;
    } finally {
      this.startPromise = undefined;
    }
  }

  private async doStart(options: {
    sampleRate?: number;
    channels?: number;
    deviceId?: string;
    useAudioWorklet?: boolean;
  }): Promise<void> {
    try {
      const sampleRate = options.sampleRate || 16000;
      const channels = options.channels || 1;
      
      // Get media stream
      const constraints: MediaTrackConstraints = {
        sampleRate,
        channelCount: channels,
        echoCancellation: true,
        noiseSuppression: true,
      };
      
      if (options.deviceId && options.deviceId !== 'default') {
        constraints.deviceId = { exact: options.deviceId };
      }

      this.stream = await navigator.mediaDevices.getUserMedia({ audio: constraints });

      // Create audio context
      this.audioContext = new AudioContext({ sampleRate });
      
      // Try AudioWorklet first, fallback to ScriptProcessor
      const useAudioWorklet = options.useAudioWorklet !== false && this.audioContext.audioWorklet;
      
      if (useAudioWorklet) {
        try {
          await this.audioContext.audioWorklet.addModule('/core/audio/audio-worklet-processor.js');
          this.worklet = new AudioWorkletNode(this.audioContext, 'processor');
          
          this.worklet.port.onmessage = (e) => {
            if (e.data.type === 'audio-chunk' && this.onChunk) {
              this.onChunk(e.data.data);
            }
          };
          
          this.sourceNode = this.audioContext.createMediaStreamSource(this.stream);
          this.sourceNode.connect(this.worklet);
        } catch (error) {
          console.warn('[SimpleAudio] AudioWorklet failed, using ScriptProcessor:', error);
          this.setupScriptProcessor();
        }
      } else {
        this.setupScriptProcessor();
      }
    } catch (error) {
      this.cleanup();
      throw error;
    }
  }

  private setupScriptProcessor(): void {
    if (!this.audioContext || !this.stream) return;
    
    this.sourceNode = this.audioContext.createMediaStreamSource(this.stream);
    const processor = this.audioContext.createScriptProcessor(4096, this.stream.getAudioTracks()[0].getSettings().channelCount || 1, this.stream.getAudioTracks()[0].getSettings().channelCount || 1);
    
    processor.onaudioprocess = (event) => {
      if (this.onChunk) {
        const inputBuffer = event.inputBuffer;
        const channelData = inputBuffer.getChannelData(0);
        const float32Array = new Float32Array(channelData.length);
        float32Array.set(channelData);
        this.onChunk(float32Array);
      }
    };
    
    this.sourceNode.connect(processor);
    processor.connect(this.audioContext.destination);
    (this as any).processor = processor; // Store for cleanup
  }

  async stop(): Promise<void> {
    this.cleanup();
  }

  cleanup(): void {
    if ((this as any).processor) {
      (this as any).processor.disconnect();
      (this as any).processor = undefined;
    }
    this.worklet?.disconnect();
    this.sourceNode?.disconnect();
    this.audioContext?.close();
    this.stream?.getTracks().forEach(track => track.stop());
    
    this.worklet = undefined;
    this.sourceNode = undefined;
    this.audioContext = undefined;
    this.stream = undefined;
    this.onChunk = undefined;
  }

  on(event: 'audio-chunk', callback: (chunk: Float32Array) => void): void {
    if (event === 'audio-chunk') {
      this.onChunk = callback;
    }
  }

  getIsCapturing(): boolean {
    return this.audioContext?.state === 'running' || false;
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

