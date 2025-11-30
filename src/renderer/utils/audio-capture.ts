/**
 * Audio Capture Manager for Renderer Process
 * File: src/renderer/utils/audio-capture.ts
 * 
 * FIXED VERSION - includes getState() method
 */

import { AudioState } from './audio-state-manager';

console.log('[audio-capture] Module loaded - version 2.0 with getState()');

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

// Re-export AudioState for convenience
export { AudioState };

export class AudioCaptureManager extends EventEmitter {
  private mediaStream: MediaStream | null = null;
  private audioContext: AudioContext | null = null;
  private sourceNode: MediaStreamAudioSourceNode | null = null;
  private processorNode: ScriptProcessorNode | null = null;
  private isCapturing = false;
  private sampleRate = 16000;
  private channels = 1;
  private deviceId: string | undefined;
  
  // ========== CRITICAL FIX: State tracking ==========
  private currentState: AudioState = AudioState.IDLE;

  /**
   * Get the current audio state
   * THIS IS THE METHOD MainWindow.tsx NEEDS!
   */
  getState(): AudioState {
    return this.currentState;
  }

  /**
   * Update internal state and emit state-changed event
   */
  private setState(newState: AudioState): void {
    const previousState = this.currentState;
    this.currentState = newState;
    console.log(`[audio-capture] State: ${previousState} -> ${newState}`);
    
    this.emit('state-changed', {
      current: newState,
      previous: previousState,
      timestamp: Date.now(),
    });
  }
  // ========== END CRITICAL FIX ==========

  async startCapture(options: {
    sources?: ('microphone' | 'system-audio')[];
    sampleRate?: number;
    channels?: number;
    deviceId?: string;
  } = {}): Promise<void> {
    if (this.isCapturing) {
      return;
    }

    const sources = options.sources || ['microphone'];
    this.sampleRate = options.sampleRate || 16000;
    this.channels = options.channels || 1;
    this.deviceId = options.deviceId || undefined;

    try {
      // Update state: requesting permission
      this.setState(AudioState.REQUESTING_PERMISSION);

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

        // Update state: initializing context
        this.setState(AudioState.INITIALIZING_CONTEXT);

        const stream = await navigator.mediaDevices.getUserMedia({
          audio: audioConstraints,
        });

        this.setupAudioProcessing(stream);
      }

      // For system audio, we need to use desktopCapturer (handled in main process)
      // This will be implemented separately via IPC

      this.isCapturing = true;
      
      // Update state: recording
      this.setState(AudioState.RECORDING);
      
    } catch (error) {
      console.error('Failed to start audio capture:', error);
      this.setState(AudioState.ERROR);
      throw error;
    }
  }

  private setupAudioProcessing(stream: MediaStream): void {
    this.mediaStream = stream;
    this.audioContext = new AudioContext({ sampleRate: this.sampleRate });
    // Update actual sample rate in case the browser chooses a different value
    if (this.audioContext.sampleRate && this.audioContext.sampleRate !== this.sampleRate) {
      this.sampleRate = this.audioContext.sampleRate;
    }
    this.sourceNode = this.audioContext.createMediaStreamSource(stream);

    // Update state: loading worklet
    this.setState(AudioState.LOADING_WORKLET);

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

      // Debug logging for audio processing
      const maxAmplitude = Math.max(...Array.from(float32Array));
      const avgAmplitude = float32Array.reduce((sum, val) => sum + Math.abs(val), 0) / float32Array.length;

      console.log('[audio-capture] onaudioprocess fired:', {
        bufferLength: float32Array.length,
        maxAmplitude: maxAmplitude,
        avgAmplitude: avgAmplitude,
        sampleRate: this.audioContext?.sampleRate,
        isCapturing: this.isCapturing
      });

      const chunk: AudioChunk = {
        data: float32Array,
        sampleRate: this.audioContext?.sampleRate || this.sampleRate,
        channels: this.channels,
        timestamp: Date.now(),
      };

      this.emit('audio-chunk', chunk);
    };

    this.sourceNode.connect(this.processorNode);
    this.processorNode.connect(this.audioContext.destination);
    
    // Update state: ready
    this.setState(AudioState.READY);
  }

  async stopCapture(): Promise<void> {
    if (!this.isCapturing) {
      return;
    }

    // Update state: stopping
    this.setState(AudioState.STOPPING);
    this.isCapturing = false;

    // Update state: cleaning up
    this.setState(AudioState.CLEANING_UP);

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

    // Update state: idle
    this.setState(AudioState.IDLE);
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
