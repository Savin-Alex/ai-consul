/**
 * VAD Provider Interface
 * Allows pluggable VAD implementations (default, Silero, etc.)
 */

export interface VADResult {
  speech: boolean;
  pause: boolean;
}

export interface VADEvent {
  type: 'speech_start' | 'speech_active' | 'speech_end';
  probability?: number;
}

export interface VADProvider {
  /**
   * Initialize the VAD provider
   */
  initialize(): Promise<void>;

  /**
   * Check if the provider is ready
   */
  isReady(): Promise<void>;

  /**
   * Process an audio chunk and return VAD result
   */
  process(audioChunk: Float32Array, maxAmplitude?: number): Promise<VADResult>;

  /**
   * Reset internal state
   */
  resetState(): void;

  /**
   * Get provider name
   */
  getName(): string;
}

