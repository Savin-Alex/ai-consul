/**
 * AudioState - Enumeration of audio capture states
 * Used to track the current state of audio capture initialization and recording
 */
export enum AudioState {
  IDLE = 'idle',
  REQUESTING_PERMISSION = 'requesting_permission',
  INITIALIZING_CONTEXT = 'initializing_context',
  LOADING_WORKLET = 'loading_worklet',
  READY = 'ready',
  RECORDING = 'recording',
  STOPPING = 'stopping',
  CLEANING_UP = 'cleaning_up',
  ERROR = 'error',
}

/**
 * AudioStateManager - Manages audio capture state transitions
 */
export class AudioStateManager {
  private currentState: AudioState = AudioState.IDLE;
  private listeners: Map<AudioState, (() => void)[]> = new Map();

  /**
   * Get the current audio state
   */
  getState(): AudioState {
    return this.currentState;
  }

  /**
   * Transition to a new state
   */
  setState(newState: AudioState): void {
    if (this.currentState !== newState) {
      const previousState = this.currentState;
      this.currentState = newState;
      
      // Notify listeners of state change
      const stateListeners = this.listeners.get(newState);
      if (stateListeners) {
        stateListeners.forEach(listener => listener());
      }
    }
  }

  /**
   * Subscribe to state changes
   */
  onStateChange(state: AudioState, callback: () => void): void {
    if (!this.listeners.has(state)) {
      this.listeners.set(state, []);
    }
    this.listeners.get(state)!.push(callback);
  }

  /**
   * Unsubscribe from state changes
   */
  offStateChange(state: AudioState, callback: () => void): void {
    const stateListeners = this.listeners.get(state);
    if (stateListeners) {
      const index = stateListeners.indexOf(callback);
      if (index > -1) {
        stateListeners.splice(index, 1);
      }
    }
  }

  /**
   * Reset to idle state
   */
  reset(): void {
    this.setState(AudioState.IDLE);
  }
}
