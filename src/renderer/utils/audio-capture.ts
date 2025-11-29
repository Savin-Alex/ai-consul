import { AudioStateManager, AudioState } from './audio-state-manager';
import { AudioWorkletHandler } from './audio-worklet-handler';

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

  removeAllListeners(event?: string): void {
    if (event) {
      this.listeners.delete(event);
    } else {
      this.listeners.clear();
    }
  }

  once(event: string, callback: Listener): void {
    const onceWrapper = (...args: unknown[]) => {
      this.off(event, onceWrapper);
      callback(...args);
    };
    this.on(event, onceWrapper);
  }
}

export interface AudioChunk {
  data: Float32Array;
  sampleRate: number;
  channels: number;
  timestamp: number;
}

export class AudioCaptureManager extends EventEmitter {
  private stateManager: AudioStateManager;
  private workletHandler: AudioWorkletHandler | null = null;
  private sampleRate = 16000;
  private channels = 1;
  private deviceId: string | undefined;
  private scriptProcessorHandler: ((event: AudioProcessingEvent) => void) | null = null;
  private startPromise: Promise<void> | null = null;

  constructor() {
    super();
    this.stateManager = new AudioStateManager();
    
    // Forward state changes to our EventEmitter
    this.stateManager.on('stateChanged', (event) => {
      this.emit('state-changed', event);
    });
  }

  async startCapture(options: {
    sources?: ('microphone' | 'system-audio')[];
    sampleRate?: number;
    channels?: number;
    deviceId?: string;
    useAudioWorklet?: boolean;
  } = {}): Promise<void> {
    // Prevent concurrent start calls - check and set atomically
    if (this.startPromise) {
      console.warn('[audio-capture] Start already in progress, waiting for existing call...');
      try {
        return await this.startPromise;
      } catch (error) {
        // If the previous call failed, we can try again
        console.log('[audio-capture] Previous start failed, retrying...');
        this.startPromise = null;
      }
    }

    const currentState = this.stateManager.getState();
    
    // If already recording, return immediately
    if (currentState === AudioState.RECORDING) {
      console.log('[audio-capture] Already recording, skipping start');
      return;
    }

    // If in ERROR state, try to recover first
    if (currentState === AudioState.ERROR) {
      console.log('[audio-capture] Recovering from ERROR state...');
      try {
        await this.stateManager.emergencyStop();
        // Wait a bit for cleanup and state to stabilize
        await new Promise(resolve => setTimeout(resolve, 200));
        
        // Verify we're now in IDLE state
        const recoveredState = this.stateManager.getState();
        if (recoveredState !== AudioState.IDLE) {
          console.warn(`[audio-capture] Recovery incomplete, state is ${recoveredState}`);
          // Force to IDLE if still not recovered
          if (recoveredState === AudioState.ERROR) {
            throw new Error('Failed to recover from ERROR state');
          }
        }
      } catch (error) {
        console.error('[audio-capture] Failed to recover from ERROR state:', error);
        throw error;
      }
    }

    // If in a transitional state, wait for it to complete or error
    const finalState = this.stateManager.getState();
    if (![AudioState.IDLE, AudioState.ERROR].includes(finalState)) {
      console.warn(`[audio-capture] Cannot start from state ${finalState}, waiting for transition...`);
      // Wait a bit and check again
      await new Promise(resolve => setTimeout(resolve, 200));
      const newState = this.stateManager.getState();
      if (newState === AudioState.RECORDING) {
        return;
      }
      if (![AudioState.IDLE, AudioState.ERROR].includes(newState)) {
        // Force recovery if stuck
        console.warn(`[audio-capture] Stuck in state ${newState}, forcing recovery...`);
        try {
          await this.stateManager.emergencyStop();
          await new Promise(resolve => setTimeout(resolve, 100));
        } catch (error) {
          console.error('[audio-capture] Failed to force recovery:', error);
        }
      }
    }

    const sources = options.sources || ['microphone'];
    this.sampleRate = options.sampleRate || 16000;
    this.channels = options.channels || 1;
    this.deviceId = options.deviceId || undefined;
    const useAudioWorklet = options.useAudioWorklet !== false; // Default to true

    // Create promise and store it atomically
    this.startPromise = (async () => {
      try {
        // Ensure we're in a valid starting state
        const preStartState = this.stateManager.getState();
        if (![AudioState.IDLE, AudioState.ERROR].includes(preStartState)) {
          throw new Error(`Cannot start: invalid state ${preStartState}`);
        }

        // Start recording using state machine
        await this.stateManager.startRecording({
          sampleRate: this.sampleRate,
          channels: this.channels,
          deviceId: this.deviceId,
          useAudioWorklet: useAudioWorklet
        });

      // Wait for state to reach READY
      await this.waitForState(AudioState.READY, 10000);

      // Begin recording
      await this.stateManager.transition('begin_recording');

        // Setup handlers based on which processing method was used
        const resources = this.stateManager.getResources();
        if (resources.workletNode) {
          await this.setupWorkletHandler(resources.workletNode);
        } else if (resources.processorNode) {
          this.setupScriptProcessorHandler(resources.processorNode);
        }
      } catch (error) {
        console.error('[audio-capture] Failed to start audio capture:', error);
        // Ensure state machine is in a recoverable state
        const errorState = this.stateManager.getState();
        if (errorState === AudioState.ERROR) {
          // State machine already handled the error, we can recover
          console.log('[audio-capture] State machine is in ERROR state, can recover');
        }
        throw error;
      } finally {
        // Clear the promise so we can start again
        this.startPromise = null;
      }
    })();

    return this.startPromise;
  }

  private async waitForState(targetState: AudioState, timeoutMs: number): Promise<void> {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.stateManager.off('stateChanged', checkState);
        reject(new Error(`Timeout waiting for state ${targetState}`));
      }, timeoutMs);

      const checkState = () => {
        if (this.stateManager.getState() === targetState) {
          clearTimeout(timeout);
          this.stateManager.off('stateChanged', checkState);
          resolve();
        }
      };

      this.stateManager.on('stateChanged', checkState);
      // Check immediately in case we're already in the target state
      checkState();
    });
  }

  private async setupWorkletHandler(workletNode: AudioWorkletNode): Promise<void> {
    // Clean up existing handler if any
    if (this.workletHandler) {
      this.workletHandler.cleanup();
      this.workletHandler = null;
    }

    // Create new handler
    this.workletHandler = new AudioWorkletHandler(workletNode, {
      processAudioChunk: (chunk: AudioChunk) => {
        this.emit('audio-chunk', chunk);
      },
      handleWorkletError: (error: Event) => {
        this.emit('error', error);
        // Transition to error state
        this.stateManager.transition('error').catch((err) => {
          console.error('[audio-capture] Failed to transition to error state:', err);
        });
      }
    });

    // Initialize handler
    this.workletHandler.initialize(this.sampleRate, this.channels);

    // Forward worklet handler events
    this.workletHandler.on('processor-ready', (data) => {
      console.log('[audio-capture] AudioWorklet processor ready', data);
    });

    this.workletHandler.on('error', (error) => {
      this.emit('error', error);
    });
  }

  private setupScriptProcessorHandler(processorNode: ScriptProcessorNode): void {
    // Remove existing handler if any
    if (this.scriptProcessorHandler) {
      processorNode.onaudioprocess = null;
    }

    // Create new handler
    this.scriptProcessorHandler = (event: AudioProcessingEvent) => {
      const state = this.stateManager.getState();
      if (state !== AudioState.RECORDING) {
        return;
      }

      const resources = this.stateManager.getResources();
      if (!resources.audioContext) {
        return;
      }

      const inputBuffer = event.inputBuffer;
      const channelData = inputBuffer.getChannelData(0);
      const float32Array = new Float32Array(channelData.length);
      float32Array.set(channelData);

      const chunk: AudioChunk = {
        data: float32Array,
        sampleRate: resources.audioContext.sampleRate,
        channels: this.channels,
        timestamp: Date.now(),
      };

      this.emit('audio-chunk', chunk);
    };

    processorNode.onaudioprocess = this.scriptProcessorHandler;
  }


  async stopCapture(): Promise<void> {
    const currentState = this.stateManager.getState();
    
    // Only stop if actually recording or ready
    if (![AudioState.RECORDING, AudioState.PAUSED, AudioState.READY].includes(currentState)) {
      return;
    }

    try {
      // Clean up handlers first
      if (this.workletHandler) {
        this.workletHandler.cleanup();
        this.workletHandler = null;
      }

      const resources = this.stateManager.getResources();
      if (resources.processorNode && this.scriptProcessorHandler) {
        resources.processorNode.onaudioprocess = null;
        this.scriptProcessorHandler = null;
      }

      // Stop recording using state machine (this will clean up resources)
      await this.stateManager.stopRecording();

      // Wait for state to reach IDLE
      await this.waitForState(AudioState.IDLE, 5000);

    } catch (error) {
      console.error('[audio-capture] Error during stop:', error);
      // Force emergency stop if normal stop fails
      await this.stateManager.emergencyStop();
      throw error;
    }
  }

  getIsCapturing(): boolean {
    // Backward compatibility: map RECORDING state to true
    return this.stateManager.getState() === AudioState.RECORDING;
  }

  getState(): AudioState {
    return this.stateManager.getState();
  }

  getStateManager(): AudioStateManager {
    return this.stateManager;
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

