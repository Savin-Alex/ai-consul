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
  private readonly speechConfidenceThreshold = 0.03; // Lowered from 0.25 - speech-commands model outputs lower confidence scores
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
      
      // Filter out music and non-speech audio
      const labelLower = topLabel.toLowerCase();
      const isMusic = labelLower.includes('music') || 
                      labelLower.includes('song') ||
                      labelLower.includes('melody') ||
                      labelLower.includes('tune') ||
                      labelLower.includes('sound') && !labelLower.includes('speech');
      
      // Speech command keywords that indicate actual speech
      const speechKeywords = [
        'yes', 'no', 'up', 'down', 'left', 'right', 'on', 'off', 'stop', 'go',
        'zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine',
        'bed', 'bird', 'cat', 'dog', 'happy', 'house', 'marvin', 'sheila', 'tree', 'wow',
        'backward', 'forward', 'follow', 'learn', 'visual'
      ];
      const isSpeechCommand = speechKeywords.some(keyword => labelLower.includes(keyword));
      
      const energyLevel =
        typeof maxAmplitude === 'number' ? maxAmplitude : this.computeMaxAmplitude(audioChunk);

      const meetsEnergy = energyLevel >= this.energyThreshold;
      const meetsConfidence = topScore >= this.speechConfidenceThreshold;
      
      // Additional filtering: Check if the audio characteristics suggest music vs speech
      // Music typically has more consistent energy and different spectral characteristics
      const avgAmplitude = audioChunk.reduce((sum, val) => sum + Math.abs(val), 0) / audioChunk.length;
      const energyVariation = this.computeEnergyVariation(audioChunk);
      
      // Music often has lower energy variation (more consistent) and higher average amplitude
      // Speech has more variation and typically lower average amplitude
      const looksLikeMusic = energyVariation < 0.3 && avgAmplitude > 0.1 && energyLevel > 0.3;
      
      // Only consider it speech if:
      // 1. It's not music (by label or audio characteristics)
      // 2. It's either a known speech command OR (meets energy/confidence AND not unknown)
      // 3. Energy and confidence thresholds are met
      // 4. Audio characteristics don't suggest music
      const isSpeech = !isMusic && 
                       !looksLikeMusic &&
                       (isSpeechCommand || (meetsEnergy && meetsConfidence && !isUnknownTop)) &&
                       meetsEnergy && meetsConfidence;

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
        const avgAmplitude = audioChunk.reduce((sum, val) => sum + Math.abs(val), 0) / audioChunk.length;
        const energyVariation = this.computeEnergyVariation(audioChunk);
        console.log('[DefaultVAD] scores:', {
          top: topLabel,
          silenceScore: silenceScore.toFixed(2),
          speechScore: speechScore.toFixed(2),
          energy: energyLevel.toFixed(4),
          avgAmplitude: avgAmplitude.toFixed(4),
          energyVariation: energyVariation.toFixed(4),
          isMusic,
          looksLikeMusic: energyVariation < 0.3 && avgAmplitude > 0.1 && energyLevel > 0.3,
          isSpeechCommand,
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

  private computeEnergyVariation(buffer: Float32Array): number {
    // Compute coefficient of variation (std dev / mean) of energy
    // Higher variation = more like speech, lower variation = more like music
    const energies = [];
    const windowSize = Math.floor(buffer.length / 10); // 10 windows
    
    for (let i = 0; i < buffer.length; i += windowSize) {
      let windowEnergy = 0;
      const end = Math.min(i + windowSize, buffer.length);
      for (let j = i; j < end; j++) {
        windowEnergy += Math.abs(buffer[j]);
      }
      energies.push(windowEnergy / (end - i));
    }
    
    if (energies.length === 0) return 1.0;
    
    const mean = energies.reduce((sum, e) => sum + e, 0) / energies.length;
    if (mean === 0) return 1.0;
    
    const variance = energies.reduce((sum, e) => sum + Math.pow(e - mean, 2), 0) / energies.length;
    const stdDev = Math.sqrt(variance);
    
    return stdDev / mean; // Coefficient of variation
  }
}



