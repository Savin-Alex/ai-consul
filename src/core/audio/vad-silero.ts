/**
 * Silero VAD Implementation
 * More accurate VAD using Silero VAD model
 * Optional enhancement over default VAD
 */

import { loadTransformers } from './transformers';
import { VADProvider, VADResult, VADEvent } from './vad-provider';

enum VadState {
  IDLE = 'idle',
  SPEECH_START = 'speech_start',
  SPEAKING = 'speaking',
  POSSIBLE_END = 'possible_end',
}

export class SileroVADProvider implements VADProvider {
  private model: any = null;
  private isInitialized = false;
  private initializationPromise: Promise<void> | null = null;
  private initializationError: Error | null = null;

  private state: VadState = VadState.IDLE;
  private speechDetected = false;
  private accumulatedSilenceMs = 0;
  private silenceTimer: { start: number } | null = null;

  private readonly sampleRate = 16000;
  private readonly speechProbThreshold = 0.5;
  private readonly minSpeechDurationMs = 250;
  private readonly minSilenceDurationMs = 500;

  getName(): string {
    return 'silero';
  }

  async initialize(): Promise<void> {
    if (this.isInitialized) {
      return;
    }

    if (this.initializationPromise) {
      return this.initializationPromise;
    }

    this.initializationPromise = (async () => {
      this.initializationError = null;

      try {
        console.log('[SileroVAD] Initializing Silero VAD model...');
        const { pipeline: pipelineFn } = await loadTransformers();

        // Silero VAD model from HuggingFace
        // Using silero/silero_vad as the model name
        this.model = await pipelineFn('audio-classification', 'silero/silero_vad', {
          quantized: true,
          use_cache: false,
        });

        this.isInitialized = true;
        console.log('[SileroVAD] Silero VAD initialized');
      } catch (error) {
        const wrapped = this.normalizeInitializationError(error);
        this.initializationError = wrapped;
        console.error('[SileroVAD] Failed to initialize VAD model:', wrapped);
        throw wrapped;
      } finally {
        this.initializationPromise = null;
      }
    })();

    return this.initializationPromise;
  }

  async isReady(): Promise<void> {
    if (this.initializationError) {
      throw this.initializationError;
    }

    if (this.isInitialized) {
      return;
    }

    if (!this.initializationPromise) {
      this.initializationPromise = this.initialize();
    }

    return this.initializationPromise;
  }

  resetState(): void {
    if (!this.isInitialized || this.initializationError) {
      return;
    }
    this.state = VadState.IDLE;
    this.speechDetected = false;
    this.accumulatedSilenceMs = 0;
    this.silenceTimer = null;
    if (process.env.DEBUG_AUDIO === 'true') {
      console.log('[SileroVAD] State reset');
    }
  }

  async process(audioChunk: Float32Array, maxAmplitude?: number): Promise<VADResult> {
    if (!audioChunk || audioChunk.length === 0) {
      if (process.env.DEBUG_AUDIO === 'true') {
        console.warn('[SileroVAD] Received empty audio chunk, skipping.');
      }
      return { speech: false, pause: false };
    }

    if (this.initializationError) {
      throw this.initializationError;
    }

    if (!this.isInitialized) {
      await this.isReady();
    }

    if (!this.model) {
      console.warn('[SileroVAD] Model unavailable');
      return { speech: false, pause: false };
    }

    try {
      // Process audio chunk with Silero VAD
      const result = await this.model(audioChunk, { topk: null });
      const outputs = Array.isArray(result) ? result : [result];

      // Extract speech probability
      let speechProbability = 0;
      for (const item of outputs) {
        if (!item || typeof item !== 'object') continue;
        const label = typeof item.label === 'string' ? item.label.toLowerCase() : '';
        const score = typeof item.score === 'number' ? item.score : 0;

        // Silero VAD typically outputs 'SPEECH' or 'NO_SPEECH'
        if (label.includes('speech') && !label.includes('no')) {
          speechProbability = Math.max(speechProbability, score);
        }
      }

      // Update state machine
      const vadEvent = this.updateState(speechProbability);
      const chunkDurationMs = (audioChunk.length / this.sampleRate) * 1000;

      let pauseDetected = false;

      // Handle state transitions
      switch (vadEvent.type) {
        case 'speech_start':
          this.speechDetected = true;
          this.accumulatedSilenceMs = 0;
          this.silenceTimer = null;
          break;

        case 'speech_active':
          if (this.speechDetected) {
            this.accumulatedSilenceMs = 0;
            this.silenceTimer = null;
          }
          break;

        case 'speech_end':
          pauseDetected = true;
          this.speechDetected = false;
          this.accumulatedSilenceMs = 0;
          this.silenceTimer = null;
          break;
      }

      // Check for pause based on silence duration
      if (this.speechDetected && speechProbability < this.speechProbThreshold) {
        if (!this.silenceTimer) {
          this.silenceTimer = { start: Date.now() };
        }
        this.accumulatedSilenceMs += chunkDurationMs;

        if (this.accumulatedSilenceMs >= this.minSilenceDurationMs) {
          pauseDetected = true;
          this.speechDetected = false;
          this.accumulatedSilenceMs = 0;
          this.silenceTimer = null;
        }
      }

      const speechActive = this.speechDetected || speechProbability >= this.speechProbThreshold;

      if (process.env.DEBUG_AUDIO === 'true') {
        console.log('[SileroVAD] result:', {
          probability: speechProbability.toFixed(3),
          state: this.state,
          speechActive,
          pauseDetected,
          accumulatedSilence: this.accumulatedSilenceMs.toFixed(0) + 'ms',
        });
      }

      return {
        speech: speechActive,
        pause: pauseDetected,
      };
    } catch (error) {
      console.error('[SileroVAD] Error processing audio chunk:', error);
      return { speech: false, pause: false };
    }
  }

  private updateState(probability: number): VADEvent {
    const previousState = this.state;

    switch (this.state) {
      case VadState.IDLE:
        if (probability > this.speechProbThreshold) {
          this.state = VadState.SPEECH_START;
          return { type: 'speech_start', probability };
        }
        break;

      case VadState.SPEECH_START:
        this.state = VadState.SPEAKING;
        return { type: 'speech_active', probability };

      case VadState.SPEAKING:
        if (probability < this.speechProbThreshold) {
          this.state = VadState.POSSIBLE_END;
          // Don't emit speech_end immediately, wait for confirmation
          return { type: 'speech_active', probability };
        }
        return { type: 'speech_active', probability };

      case VadState.POSSIBLE_END:
        if (probability > this.speechProbThreshold) {
          // Speech resumed, not actually ended
          this.state = VadState.SPEAKING;
          return { type: 'speech_active', probability };
        } else {
          // Confirmed end of speech
          this.state = VadState.IDLE;
          return { type: 'speech_end', probability };
        }
    }

    return { type: 'speech_active', probability };
  }

  private normalizeInitializationError(error: unknown): Error {
    if (error instanceof Error) {
      if (error.message.includes('Unauthorized access to file')) {
        const hint =
          'Ensure the application can access Hugging Face to download the silero/silero_vad assets.';
        return new Error(`${error.message} ${hint}`);
      }
      return error;
    }

    return new Error('Unknown error during Silero VAD initialization');
  }
}

