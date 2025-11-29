import { AudioChunk } from './audio-capture';

type Listener = (...args: unknown[]) => void;

// Simple EventEmitter for browser compatibility
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

interface AudioCaptureManagerInterface {
  processAudioChunk(chunk: AudioChunk): void;
  handleWorkletError(error: Event): void;
}

export class AudioWorkletHandler extends EventEmitter {
  private messageHandler: ((event: MessageEvent) => void) | null = null;
  private errorHandler: ((event: Event) => void) | null = null;
  private cleanupTasks = new Set<() => void>();
  private isCleanedUp = false;
  private messageQueue: MessageEvent[] = [];
  private processingQueue = false;
  private lastLevelUpdate = 0;
  private sampleRate = 16000;
  private channels = 1;
  private weakManager: WeakRef<AudioCaptureManagerInterface>;

  constructor(
    private workletNode: AudioWorkletNode,
    manager: AudioCaptureManagerInterface
  ) {
    super();
    // Use WeakRef to prevent circular references
    this.weakManager = new WeakRef(manager);
  }

  initialize(sampleRate: number = 16000, channels: number = 1): void {
    if (this.isCleanedUp) {
      throw new Error('Handler already cleaned up');
    }

    this.sampleRate = sampleRate;
    this.channels = channels;

    // Create bound handlers that we can reference later
    this.messageHandler = this.handleMessage.bind(this);
    this.errorHandler = this.handleError.bind(this);

    // Use addEventListener (can be removed cleanly)
    this.workletNode.port.addEventListener('message', this.messageHandler);
    this.workletNode.port.addEventListener('messageerror', this.errorHandler);

    // Start the port
    this.workletNode.port.start();

    // Register cleanup tasks
    this.cleanupTasks.add(() => {
      if (this.messageHandler) {
        this.workletNode.port.removeEventListener('message', this.messageHandler);
        this.messageHandler = null;
      }
    });

    this.cleanupTasks.add(() => {
      if (this.errorHandler) {
        this.workletNode.port.removeEventListener('messageerror', this.errorHandler);
        this.errorHandler = null;
      }
    });

    this.cleanupTasks.add(() => {
      try {
        this.workletNode.port.close();
      } catch (error) {
        // Port might already be closed
        console.warn('[AudioWorkletHandler] Port close error:', error);
      }
    });

    // Set up automatic cleanup on worklet termination
    this.workletNode.onprocessorerror = () => {
      console.error('[AudioWorkletHandler] AudioWorklet processor error');
      this.cleanup();
    };
  }

  private handleMessage(event: MessageEvent): void {
    // If cleaned up, ignore messages
    if (this.isCleanedUp) {
      return;
    }

    // Check port is still open
    try {
      // If we can't access port, it's closed
      if (!this.workletNode.port) {
        this.cleanup();
        return;
      }
    } catch (error) {
      // Port access error means it's closed
      this.cleanup();
      return;
    }

    // Queue message if processing
    if (this.processingQueue) {
      this.messageQueue.push(event);
      return;
    }

    this.processingQueue = true;

    try {
      // Process message based on type
      this.processMessage(event);

      // Process queued messages
      while (this.messageQueue.length > 0 && !this.isCleanedUp) {
        const queued = this.messageQueue.shift();
        if (queued) {
          this.processMessage(queued);
        }
      }
    } finally {
      this.processingQueue = false;
    }
  }

  private processMessage(event: MessageEvent): void {
    // Validate event data structure
    if (!event || !event.data || typeof event.data !== 'object') {
      console.warn('[AudioWorkletHandler] Invalid worklet message:', event);
      return;
    }

    // Use WeakRef to get manager (prevents circular references)
    const manager = this.weakManager.deref();
    if (!manager) {
      // Manager was garbage collected, clean ourselves up
      console.warn('[AudioWorkletHandler] Manager was garbage collected, cleaning up');
      this.cleanup();
      return;
    }

    const { type, data, timestamp, sampleRate, message } = event.data;

    switch (type) {
      case 'audio-chunk':
        this.processAudioData(data, sampleRate || this.sampleRate, timestamp, manager);
        break;

      case 'processor-ready':
        console.log('[AudioWorkletHandler] AudioWorklet processor ready', {
          sourceSampleRate: event.data.sourceSampleRate,
          targetSampleRate: event.data.targetSampleRate,
        });
        this.emit('processor-ready', {
          sourceSampleRate: event.data.sourceSampleRate,
          targetSampleRate: event.data.targetSampleRate,
        });
        break;

      case 'error':
        const error = new Error(message || 'AudioWorklet error');
        console.error('[AudioWorkletHandler] AudioWorklet error:', error);
        this.emit('error', error);
        manager.handleWorkletError(error as any);
        break;

      case 'flush-complete':
        this.emit('flush-complete', event.data);
        break;

      default:
        console.warn('[AudioWorkletHandler] Unknown message type:', type);
    }
  }

  private processAudioData(data: unknown, sampleRate: number, timestamp: number, manager: AudioCaptureManagerInterface): void {
    // Validate and convert data
    let audioData: Float32Array;

    if (data instanceof Float32Array) {
      // Direct Float32Array (Transferable)
      audioData = data;
    } else if (Array.isArray(data)) {
      // Fallback: convert array to Float32Array
      audioData = new Float32Array(data);
    } else {
      console.warn('[AudioWorkletHandler] Invalid audio chunk data type:', typeof data);
      return;
    }

    // Create chunk object
    const chunk: AudioChunk = {
      data: audioData,
      sampleRate: (typeof sampleRate === 'number' && sampleRate > 0) ? sampleRate : this.sampleRate,
      channels: this.channels,
      timestamp: (typeof timestamp === 'number' && timestamp > 0) ? timestamp : Date.now(),
    };

    // Process directly (AudioWorklet already runs in separate thread)
    manager.processAudioChunk(chunk);
  }

  private handleError(event: Event): void {
    console.error('[AudioWorkletHandler] AudioWorklet port error:', event);
    
    // Use WeakRef to get manager
    const manager = this.weakManager.deref();
    if (manager) {
      manager.handleWorkletError(event);
    }
    
    // Clean up on error
    this.cleanup();
  }

  cleanup(): void {
    if (this.isCleanedUp) {
      return;
    }

    this.isCleanedUp = true;

    // Clear message queue
    this.messageQueue = [];

    // Execute all cleanup tasks
    this.cleanupTasks.forEach(task => {
      try {
        task();
      } catch (error) {
        console.error('[AudioWorkletHandler] Cleanup task error:', error);
      }
    });

    this.cleanupTasks.clear();

    // Disconnect the worklet node
    try {
      this.workletNode.disconnect();
    } catch (error) {
      // Node might already be disconnected
      console.warn('[AudioWorkletHandler] Disconnect error:', error);
    }

    // Clear references
    this.messageHandler = null;
    this.errorHandler = null;

    console.log('[AudioWorkletHandler] Cleaned up successfully');
  }

  // Verify cleanup worked
  isClean(): boolean {
    return this.isCleanedUp &&
           this.messageHandler === null &&
           this.errorHandler === null &&
           this.cleanupTasks.size === 0 &&
           this.messageQueue.length === 0;
  }

  getWorkletNode(): AudioWorkletNode {
    return this.workletNode;
  }
}

