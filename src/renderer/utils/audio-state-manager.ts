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

export enum AudioState {
  IDLE = 'idle',
  REQUESTING_PERMISSION = 'requesting_permission',
  INITIALIZING_CONTEXT = 'initializing_context',
  LOADING_WORKLET = 'loading_worklet',
  READY = 'ready',
  RECORDING = 'recording',
  PAUSED = 'paused',
  STOPPING = 'stopping',
  CLEANING_UP = 'cleaning_up',
  ERROR = 'error'
}

interface StateTransition {
  from: AudioState[];
  to: AudioState;
  guard?: () => boolean;
  action?: () => Promise<void>;
}

interface StateChangeEvent {
  current: AudioState;
  previous: AudioState | null;
  timestamp: number;
  history: Array<{ state: AudioState; timestamp: number }>;
}

interface AudioResources {
  stream: MediaStream | null;
  audioContext: AudioContext | null;
  workletNode: AudioWorkletNode | null;
  sourceNode: MediaStreamAudioSourceNode | null;
  processorNode: ScriptProcessorNode | null;
}

export class AudioStateManager extends EventEmitter {
  private currentState = AudioState.IDLE;
  private stateHistory: Array<{ state: AudioState; timestamp: number }> = [];
  private readonly MAX_HISTORY = 100;
  private transitionLock = false;
  private stateTimeout: NodeJS.Timeout | null = null;
  private readonly STATE_TIMEOUT_MS = 10000; // 10s max per state
  private resources: AudioResources = {
    stream: null,
    audioContext: null,
    workletNode: null,
    sourceNode: null,
    processorNode: null
  };
  private sampleRate = 16000;
  private channels = 1;
  private deviceId: string | undefined;
  private useAudioWorklet = true;

  // Define valid state transitions
  private transitions: Map<string, StateTransition> = new Map([
    ['start', {
      from: [AudioState.IDLE, AudioState.ERROR],
      to: AudioState.REQUESTING_PERMISSION,
      action: async () => await this.requestPermission()
    }],
    ['permission_granted', {
      from: [AudioState.REQUESTING_PERMISSION],
      to: AudioState.INITIALIZING_CONTEXT,
      action: async () => await this.initializeContext()
    }],
    ['context_ready', {
      from: [AudioState.INITIALIZING_CONTEXT],
      to: AudioState.LOADING_WORKLET,
      action: async () => await this.loadWorklet()
    }],
    ['worklet_loaded', {
      from: [AudioState.LOADING_WORKLET],
      to: AudioState.READY
    }],
    ['begin_recording', {
      from: [AudioState.READY, AudioState.PAUSED],
      to: AudioState.RECORDING,
      action: async () => await this.startProcessing()
    }],
    ['pause', {
      from: [AudioState.RECORDING],
      to: AudioState.PAUSED,
      action: async () => await this.pauseProcessing()
    }],
    ['stop', {
      from: [AudioState.RECORDING, AudioState.PAUSED, AudioState.READY],
      to: AudioState.STOPPING,
      action: async () => await this.cleanup()
    }],
    ['stopped', {
      from: [AudioState.STOPPING, AudioState.CLEANING_UP],
      to: AudioState.IDLE
    }],
    ['error', {
      from: Object.values(AudioState),
      to: AudioState.ERROR,
      action: async () => await this.handleError()
    }]
  ]);

  constructor() {
    super();
    this.stateHistory.push({ state: AudioState.IDLE, timestamp: Date.now() });
  }

  async transition(transitionName: string): Promise<void> {
    // Allow error transition to override lock (for emergency recovery)
    if (this.transitionLock && transitionName !== 'error') {
      throw new Error('Transition already in progress');
    }

    const transition = this.transitions.get(transitionName);
    if (!transition) {
      throw new Error(`Unknown transition: ${transitionName}`);
    }

    // Validate current state
    if (!transition.from.includes(this.currentState)) {
      throw new Error(
        `Cannot transition '${transitionName}' from state '${this.currentState}'. Allowed from: ${transition.from.join(', ')}`
      );
    }

    // Check guard condition
    if (transition.guard && !transition.guard()) {
      throw new Error(`Guard condition failed for transition '${transitionName}'`);
    }

    this.transitionLock = true;
    const previousState = this.currentState;

    try {
      // Update state FIRST (UI can react immediately)
      this.setState(transition.to);

      // Then perform the action
      if (transition.action) {
        await transition.action();
      }

      // Log state change
      console.log(`[AudioState] ${previousState} → ${transition.to} (${transitionName})`);

    } catch (error) {
      // Rollback on error (unless already in error state)
      if (this.currentState !== AudioState.ERROR) {
        this.setState(AudioState.ERROR);
        await this.emergencyCleanup();
      }
      throw error;
    } finally {
      this.transitionLock = false;
    }
  }

  private setState(newState: AudioState) {
    const previousState = this.currentState;
    this.currentState = newState;

    // Add to history
    this.stateHistory.push({
      state: newState,
      timestamp: Date.now()
    });

    // Trim history if too large
    if (this.stateHistory.length > this.MAX_HISTORY) {
      this.stateHistory.shift();
    }

    // Clear previous timeout
    if (this.stateTimeout) {
      clearTimeout(this.stateTimeout);
      this.stateTimeout = null;
    }

    // Set timeout for this state (except IDLE and ERROR which are terminal)
    if (newState !== AudioState.IDLE && newState !== AudioState.ERROR) {
      this.stateTimeout = setTimeout(() => {
        console.error(`[AudioState] State ${newState} stuck for ${this.STATE_TIMEOUT_MS}ms, forcing error state`);
        this.transition('error').catch((error) => {
          console.error('[AudioState] Failed to transition to error state:', error);
        });
      }, this.STATE_TIMEOUT_MS);
    }

    // Emit state change event
    this.emit('stateChanged', {
      current: newState,
      previous: previousState,
      timestamp: Date.now(),
      history: [...this.stateHistory]
    } as StateChangeEvent);
  }

  private async requestPermission(): Promise<void> {
    // Double-check we're in the right state before requesting permission
    if (this.currentState !== AudioState.REQUESTING_PERMISSION) {
      console.warn(`[AudioState] requestPermission called but state is ${this.currentState}`);
      return;
    }

    try {
      const audioConstraints: MediaTrackConstraints = {
        sampleRate: this.sampleRate,
        channelCount: this.channels,
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true
      };

      if (this.deviceId && this.deviceId !== 'default') {
        audioConstraints.deviceId = { exact: this.deviceId };
      }

      this.resources.stream = await navigator.mediaDevices.getUserMedia({
        audio: audioConstraints
      });

      // Only transition if we're still in REQUESTING_PERMISSION state
      if (this.currentState === AudioState.REQUESTING_PERMISSION) {
        await this.transition('permission_granted');
      } else {
        console.warn(`[AudioState] State changed during getUserMedia, current state: ${this.currentState}`);
        // Clean up the stream we just got
        this.resources.stream.getTracks().forEach(track => track.stop());
        this.resources.stream = null;
      }

    } catch (error: any) {
      if (error.name === 'NotAllowedError') {
        throw new Error('Microphone permission denied');
      } else if (error.name === 'NotFoundError') {
        throw new Error('No microphone found');
      }
      throw error;
    }
  }

  private async initializeContext(): Promise<void> {
    if (!this.resources.stream) {
      throw new Error('MediaStream not available');
    }

    // Create AudioContext with proper configuration
    this.resources.audioContext = new AudioContext({
      latencyHint: 'interactive',
      sampleRate: this.sampleRate
    });

    // Update sample rate if browser chose different value
    if (this.resources.audioContext.sampleRate && this.resources.audioContext.sampleRate !== this.sampleRate) {
      this.sampleRate = this.resources.audioContext.sampleRate;
    }

    // Wait for context to be ready
    if (this.resources.audioContext.state === 'suspended') {
      await this.resources.audioContext.resume();
    }

    // Create source from stream
    this.resources.sourceNode = this.resources.audioContext.createMediaStreamSource(
      this.resources.stream
    );

    await this.transition('context_ready');
  }

  private async loadWorklet(): Promise<void> {
    if (!this.resources.audioContext || !this.resources.sourceNode) {
      throw new Error('AudioContext or source node not initialized');
    }

    if (!this.useAudioWorklet || !this.resources.audioContext.audioWorklet) {
      // Fallback to ScriptProcessorNode
      this.setupScriptProcessor();
      await this.transition('worklet_loaded');
      return;
    }

    try {
      // Load the worklet module
      const workletPath = new URL('/core/audio/audio-worklet-processor.js', window.location.href).href;
      await this.resources.audioContext.audioWorklet.addModule(workletPath);

      // Create worklet node
      this.resources.workletNode = new AudioWorkletNode(
        this.resources.audioContext,
        'streaming-audio-processor'
      );

      // Connect the audio graph
      this.resources.sourceNode.connect(this.resources.workletNode);

      await this.transition('worklet_loaded');

    } catch (error) {
      console.warn('[AudioState] AudioWorklet setup failed, falling back to ScriptProcessorNode:', error);
      this.useAudioWorklet = false;
      this.setupScriptProcessor();
      await this.transition('worklet_loaded');
    }
  }

  private setupScriptProcessor(): void {
    if (!this.resources.audioContext || !this.resources.sourceNode) {
      throw new Error('AudioContext or source node not initialized');
    }

    const bufferSize = 4096;
    this.resources.processorNode = this.resources.audioContext.createScriptProcessor(
      bufferSize,
      this.channels,
      this.channels
    );

    // Note: onaudioprocess handler will be set by AudioCaptureManager
    // This is just creating the node

    this.resources.sourceNode.connect(this.resources.processorNode);
    this.resources.processorNode.connect(this.resources.audioContext.destination);
  }

  private async startProcessing(): Promise<void> {
    // Processing starts automatically when nodes are connected
    // This is a placeholder for any additional setup needed
  }

  private async pauseProcessing(): Promise<void> {
    // Pause processing (if needed)
    // Currently just a state transition
  }

  private async cleanup(): Promise<void> {
    this.setState(AudioState.CLEANING_UP);

    // Clean up in reverse order of creation
    try {
      // Disconnect audio nodes
      this.resources.workletNode?.disconnect();
      this.resources.processorNode?.disconnect();
      this.resources.sourceNode?.disconnect();

      // Close audio context
      if (this.resources.audioContext?.state !== 'closed') {
        await this.resources.audioContext?.close();
      }

      // Stop media tracks
      this.resources.stream?.getTracks().forEach(track => track.stop());

      // Clear references
      this.resources = {
        stream: null,
        audioContext: null,
        workletNode: null,
        sourceNode: null,
        processorNode: null
      };

      await this.transition('stopped');

    } catch (error) {
      console.error('[AudioState] Cleanup error:', error);
      await this.transition('error');
      throw error;
    }
  }

  private async handleError(): Promise<void> {
    await this.emergencyCleanup();
  }

  private async emergencyCleanup(): Promise<void> {
    // Emergency cleanup - try to clean up everything regardless of state
    try {
      // Clear timeout
      if (this.stateTimeout) {
        clearTimeout(this.stateTimeout);
        this.stateTimeout = null;
      }

      // Disconnect nodes (ignore errors)
      try {
        this.resources.workletNode?.disconnect();
      } catch (e) {
        // Ignore
      }

      try {
        this.resources.processorNode?.disconnect();
      } catch (e) {
        // Ignore
      }

      try {
        this.resources.sourceNode?.disconnect();
      } catch (e) {
        // Ignore
      }

      // Close context (ignore errors)
      try {
        if (this.resources.audioContext?.state !== 'closed') {
          await this.resources.audioContext?.close();
        }
      } catch (e) {
        // Ignore
      }

      // Stop tracks (ignore errors)
      try {
        this.resources.stream?.getTracks().forEach(track => {
          try {
            track.stop();
          } catch (e) {
            // Ignore
          }
        });
      } catch (e) {
        // Ignore
      }

      // Clear references
      this.resources = {
        stream: null,
        audioContext: null,
        workletNode: null,
        sourceNode: null,
        processorNode: null
      };

    } catch (error) {
      console.error('[AudioState] Emergency cleanup error:', error);
    }
  }

  // Public API
  async startRecording(options: {
    sampleRate?: number;
    channels?: number;
    deviceId?: string;
    useAudioWorklet?: boolean;
  } = {}): Promise<void> {
    // Set configuration
    this.sampleRate = options.sampleRate || 16000;
    this.channels = options.channels || 1;
    this.deviceId = options.deviceId;
    this.useAudioWorklet = options.useAudioWorklet !== false;

    if (this.currentState === AudioState.IDLE || this.currentState === AudioState.ERROR) {
      await this.transition('start');
    }

    if (this.currentState === AudioState.READY) {
      await this.transition('begin_recording');
    }
  }

  async stopRecording(): Promise<void> {
    if ([AudioState.RECORDING, AudioState.PAUSED, AudioState.READY].includes(this.currentState)) {
      await this.transition('stop');
    }
  }

  async pauseRecording(): Promise<void> {
    if (this.currentState === AudioState.RECORDING) {
      await this.transition('pause');
    }
  }

  async resumeRecording(): Promise<void> {
    if (this.currentState === AudioState.PAUSED) {
      await this.transition('begin_recording');
    }
  }

  async emergencyStop(): Promise<void> {
    // Override lock for emergency stop
    const wasLocked = this.transitionLock;
    this.transitionLock = false;
    
    try {
      // Only transition to error if not already in error state
      if (this.currentState !== AudioState.ERROR) {
        // Manually set state to ERROR without going through transition (to avoid lock)
        this.currentState = AudioState.ERROR;
        this.stateHistory.push({ state: AudioState.ERROR, timestamp: Date.now() });
        if (this.stateHistory.length > this.MAX_HISTORY) {
          this.stateHistory.shift();
        }
      }
      
      await this.emergencyCleanup();
      
      // Force to IDLE after emergency cleanup
      this.currentState = AudioState.IDLE;
      this.stateHistory.push({ state: AudioState.IDLE, timestamp: Date.now() });
      if (this.stateHistory.length > this.MAX_HISTORY) {
        this.stateHistory.shift();
      }
      
      // Emit state change events
      this.emit('stateChanged', {
        current: AudioState.IDLE,
        previous: this.stateHistory[this.stateHistory.length - 2]?.state || null,
        timestamp: Date.now(),
        history: [...this.stateHistory]
      });
    } catch (error) {
      console.error('[AudioState] Emergency stop error:', error);
    } finally {
      // Always ensure lock is released
      this.transitionLock = false;
    }
  }

  getState(): AudioState {
    return this.currentState;
  }

  getResources(): AudioResources {
    return { ...this.resources };
  }

  canStart(): boolean {
    return [AudioState.IDLE, AudioState.ERROR].includes(this.currentState);
  }

  canStop(): boolean {
    return [AudioState.RECORDING, AudioState.PAUSED, AudioState.READY].includes(this.currentState);
  }

  getStateHistory(): Array<{ state: AudioState; timestamp: number }> {
    return [...this.stateHistory];
  }
}


