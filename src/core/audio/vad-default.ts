/**
 * Default VAD Provider
 * Wraps the existing VAD implementation for provider abstraction
 */

import { loadTransformers } from './transformers';
import { VADProvider, VADResult } from './vad-provider';

export class DefaultVADProvider implements VADProvider {
  private vad: any = null;
  private isInitialized = false;
  private initializationPromise: Promise<void> | null = null;
  private initializationError: Error | null = null;

  private speechDetected = false;
  private accumulatedSilenceMs = 0;
  private silenceChunkCount = 0;

  private readonly sampleRate = 16000;
  private readonly minSilenceDurationMs = 1200;
  private readonly speechThreshold = 0.5;
  private readonly energyThreshold = 0.01;
  private readonly speechConfidenceThreshold = 0.25;
  private readonly pauseDelayChunks = 10;

  getName(): string {
    return 'default';
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
        console.log('[DefaultVAD] Initializing speech-commands VAD model...');
        const { pipeline: pipelineFn } = await loadTransformers();

        this.vad = await pipelineFn('audio-classification', 'Xenova/ast-finetuned-speech-commands-v2', {
          quantized: true,
          use_cache: false,
        });

        this.isInitialized = true;
        console.log('[DefaultVAD] Speech-commands VAD initialized');
      } catch (error) {
        const wrapped = this.normalizeInitializationError(error);
        this.initializationError = wrapped;
        console.error('[DefaultVAD] Failed to initialize VAD model:', wrapped);
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
    this.speechDetected = false;
    this.accumulatedSilenceMs = 0;
    this.silenceChunkCount = 0;
    if (process.env.DEBUG_AUDIO === 'true') {
      console.log('[DefaultVAD] State reset');
    }
  }

  async process(audioChunk: Float32Array, maxAmplitude?: number): Promise<VADResult> {
    if (!audioChunk || audioChunk.length === 0) {
      if (process.env.DEBUG_AUDIO === 'true') {
        console.warn('[DefaultVAD] Received empty audio chunk, skipping.');
      }
      return { speech: false, pause: false };
    }

    if (this.initializationError) {
      throw this.initializationError;
    }

    if (!this.isInitialized) {
      await this.isReady();
    }

    if (!this.vad) {
      console.warn('[DefaultVAD] Processor unavailable');
      return { speech: false, pause: false };
    }

    try {
      const results = await this.vad(audioChunk, { topk: null });
      const outputs = Array.isArray(results) ? results : [results];

      let silenceScore = 0;
      let speechScore = 0;
      let topResult: { label: string; score: number } | null = null;

      for (const item of outputs) {
        if (!item || typeof item !== 'object') continue;
        const rawLabel = typeof item.label === 'string' ? item.label : '';
        const label = rawLabel.toLowerCase();
        const score = typeof item.score === 'number' ? item.score : 0;

        if (!topResult || score > topResult.score) {
          topResult = { label: rawLabel, score };
        }

        if (rawLabel === '_unknown_' || label.includes('unknown')) {
          silenceScore = Math.max(silenceScore, score);
        } else {
          speechScore = Math.max(speechScore, score);
        }
      }

      const topLabel = topResult?.label ?? '';
      const topScore = topResult?.score ?? 0;
      const isUnknownTop =
        topLabel === '_unknown_' || topLabel.toLowerCase().includes('unknown');
      const energyLevel =
        typeof maxAmplitude === 'number' ? maxAmplitude : this.computeMaxAmplitude(audioChunk);

      const meetsEnergy = energyLevel >= this.energyThreshold;
      const meetsConfidence = topScore >= this.speechConfidenceThreshold;
      const isSpeech = meetsEnergy && meetsConfidence && !isUnknownTop;

      const chunkDurationMs = (audioChunk.length / this.sampleRate) * 1000;
      let pauseDetected = false;

      if (isSpeech) {
        this.speechDetected = true;
        this.accumulatedSilenceMs = 0;
        this.silenceChunkCount = 0;
      } else if (this.speechDetected) {
        this.accumulatedSilenceMs += chunkDurationMs;
        this.silenceChunkCount += 1;
        if (this.accumulatedSilenceMs >= this.minSilenceDurationMs) {
          pauseDetected = true;
          this.speechDetected = false;
          this.accumulatedSilenceMs = 0;
          this.silenceChunkCount = 0;
        } else if (this.silenceChunkCount >= this.pauseDelayChunks) {
          pauseDetected = true;
          this.speechDetected = false;
          this.accumulatedSilenceMs = 0;
          this.silenceChunkCount = 0;
        }
      }

      const speechActive = isSpeech || this.speechDetected;

      if (process.env.DEBUG_AUDIO === 'true') {
        const topLabel = topResult
          ? `${topResult.label} (${topResult.score.toFixed(2)})`
          : 'n/a';
        console.log('[DefaultVAD] scores:', {
          top: topLabel,
          silenceScore: silenceScore.toFixed(2),
          speechScore: speechScore.toFixed(2),
          energy: energyLevel.toFixed(4),
          meetsEnergy,
          topScore: topScore.toFixed(2),
          meetsConfidence,
          isUnknownTop,
          isSpeech,
          speechActive,
          pauseDetected,
        });
      }

      return {
        speech: speechActive,
        pause: pauseDetected,
      };
    } catch (error) {
      console.error('[DefaultVAD] Error processing audio chunk:', error);
      return { speech: false, pause: false };
    }
  }

  private normalizeInitializationError(error: unknown): Error {
    if (error instanceof Error) {
      if (error.message.includes('Unauthorized access to file')) {
        const hint =
          'Ensure the application can access Hugging Face to download the Xenova/ast-finetuned-speech-commands-v2 assets.';
        return new Error(`${error.message} ${hint}`);
      }
      return error;
    }

    return new Error('Unknown error during VAD initialization');
  }

  private computeMaxAmplitude(buffer: Float32Array): number {
    let max = 0;
    for (let i = 0; i < buffer.length; i++) {
      const value = Math.abs(buffer[i]);
      if (value > max) {
        max = value;
      }
    }
    return max;
  }
}

