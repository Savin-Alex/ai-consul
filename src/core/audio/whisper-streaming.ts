/**
 * Streaming Whisper Transcription Engine
 * Implements sliding window approach with local agreement algorithm
 * Provides interim results for real-time UI updates
 */

import { loadTransformers } from './transformers';
import { EventEmitter } from 'events';

export interface StreamingTranscript {
  text: string;
  words?: Array<{
    text: string;
    start: number;
    end: number;
    confidence: number;
  }>;
  confidence: number;
  isFinal: boolean;
  timestamp: number;
}

export interface StreamingConfig {
  windowSize: number; // seconds
  stepSize: number; // seconds
  overlapRatio: number; // 0.5 = 50% overlap
  modelSize: 'tiny' | 'base' | 'small';
  language?: string;
  agreementThreshold: number; // minimum words for agreement
  agreementRuns: number; // number of consecutive runs needed
}

const DEFAULT_CONFIG: StreamingConfig = {
  windowSize: 2.0,
  stepSize: 1.0,
  overlapRatio: 0.5,
  modelSize: 'base',
  language: 'en',
  agreementThreshold: 5,
  agreementRuns: 2,
};

/**
 * Local Agreement Buffer
 * Only emits text when consecutive processing runs agree
 */
class LocalAgreementBuffer {
  private previousSegments: string[][] = [];
  private agreementRuns: number;
  private agreementThreshold: number;
  private confirmedText: string = '';

  constructor(agreementRuns: number = 2, agreementThreshold: number = 5) {
    this.agreementRuns = agreementRuns;
    this.agreementThreshold = agreementThreshold;
  }

  /**
   * Find overlap index between two word sequences
   */
  private findOverlap(prevWords: string[], newWords: string[]): number {
    if (!prevWords.length || !newWords.length) {
      return -1;
    }

    // Try to find where the new segment starts in the previous
    for (let i = 0; i < prevWords.length; i++) {
      const prevSlice = prevWords.slice(i);
      const newSlice = newWords.slice(0, Math.min(prevSlice.length, newWords.length));
      
      // Check if slices match
      let matches = 0;
      for (let j = 0; j < Math.min(prevSlice.length, newSlice.length); j++) {
        if (prevSlice[j].toLowerCase() === newSlice[j].toLowerCase()) {
          matches++;
        } else {
          break;
        }
      }

      if (matches >= this.agreementThreshold) {
        return i + matches;
      }
    }

    return -1;
  }

  /**
   * Process a new segment and return agreed-upon text if available
   */
  processSegment(text: string): { agreedText: string | null; isAgreed: boolean } {
    const newWords = text.split(/\s+/).filter(w => w.length > 0);

    if (!this.previousSegments.length) {
      this.previousSegments.push(newWords);
      return { agreedText: null, isAgreed: false };
    }

    // Check agreement with previous segments
    const agreements: number[] = [];
    for (const prevWords of this.previousSegments) {
      const overlapIdx = this.findOverlap(prevWords, newWords);
      if (overlapIdx >= this.agreementThreshold) {
        agreements.push(overlapIdx);
      }
    }

    // If we have enough agreements, emit the agreed text
    if (agreements.length >= this.agreementRuns - 1) {
      const avgOverlap = Math.floor(
        agreements.reduce((sum, idx) => sum + idx, 0) / agreements.length
      );
      const agreedText = newWords.slice(0, avgOverlap).join(' ');

      // Update state
      this.previousSegments.push(newWords);
      if (this.previousSegments.length > this.agreementRuns) {
        this.previousSegments.shift();
      }

      this.confirmedText += (this.confirmedText ? ' ' : '') + agreedText;

      return { agreedText, isAgreed: true };
    }

    this.previousSegments.push(newWords);
    if (this.previousSegments.length > this.agreementRuns) {
      this.previousSegments.shift();
    }

    return { agreedText: null, isAgreed: false };
  }

  reset(): void {
    this.previousSegments = [];
    this.confirmedText = '';
  }

  getConfirmedText(): string {
    return this.confirmedText;
  }
}

export class WhisperStreamingEngine extends EventEmitter {
  private processor: any = null;
  private isInitialized = false;
  private initializationPromise: Promise<void> | null = null;
  private config: StreamingConfig;
  private audioBuffer: Float32Array[] = [];
  private sampleRate: number = 16000;
  private agreementBuffer: LocalAgreementBuffer;
  private conversationContext: string[] = [];
  private sentenceBank: string[] = [
    "Let's discuss the quarterly results.",
    "What do you think about that approach?",
    "Could you elaborate on that point?",
    "I agree with your assessment.",
    "That's an interesting perspective.",
    "We should consider all options.",
    "The data supports this conclusion.",
    "Let me explain the reasoning.",
    "This aligns with our goals.",
    "We need to address this issue.",
  ];

  constructor(config: Partial<StreamingConfig> = {}) {
    super();
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.agreementBuffer = new LocalAgreementBuffer(
      this.config.agreementRuns,
      this.config.agreementThreshold
    );
  }

  async initialize(): Promise<void> {
    if (this.isInitialized) {
      return;
    }

    if (this.initializationPromise) {
      return this.initializationPromise;
    }

    this.initializationPromise = (async () => {
      try {
        const modelName = `Xenova/whisper-${this.config.modelSize}`;
        console.log(`[WhisperStreaming] Loading model: ${modelName}`);

        const { pipeline: pipelineFn } = await loadTransformers();

        this.processor = await pipelineFn('automatic-speech-recognition', modelName, {
          quantized: true,
        });

        this.isInitialized = true;
        console.log('[WhisperStreaming] Model loaded successfully');
      } catch (error) {
        console.error('[WhisperStreaming] Failed to load model:', error);
        throw new Error(`Failed to initialize Whisper streaming: ${error}`);
      } finally {
        this.initializationPromise = null;
      }
    })();

    return this.initializationPromise;
  }

  /**
   * Add audio chunk for processing
   */
  async addAudio(audioChunk: Float32Array, sampleRate: number = 16000): Promise<void> {
    if (!audioChunk || audioChunk.length === 0) {
      return;
    }

    if (!this.isInitialized) {
      await this.initialize();
    } else if (this.initializationPromise) {
      await this.initializationPromise;
    }

    if (!this.processor) {
      throw new Error('Whisper processor is not available');
    }

    this.sampleRate = sampleRate;
    this.audioBuffer.push(audioChunk);

    // Check if we have enough audio for a window
    const windowSamples = Math.floor(this.config.windowSize * this.sampleRate);
    const totalSamples = this.audioBuffer.reduce((sum, chunk) => sum + chunk.length, 0);

    if (totalSamples >= windowSamples) {
      await this.processWindow();
    }
  }

  /**
   * Process audio window with sliding approach
   */
  private async processWindow(): Promise<void> {
    if (!this.processor || this.audioBuffer.length === 0) {
      return;
    }

    // Combine audio buffer
    const totalSamples = this.audioBuffer.reduce((sum, chunk) => sum + chunk.length, 0);
    const windowSamples = Math.floor(this.config.windowSize * this.sampleRate);
    const stepSamples = Math.floor(this.config.stepSize * this.sampleRate);

    // Get window of audio (last windowSize seconds)
    const windowAudio = new Float32Array(Math.min(windowSamples, totalSamples));
    let offset = 0;
    let samplesNeeded = windowAudio.length;

    // Fill from end of buffer backwards
    for (let i = this.audioBuffer.length - 1; i >= 0 && samplesNeeded > 0; i--) {
      const chunk = this.audioBuffer[i];
      const takeFromChunk = Math.min(samplesNeeded, chunk.length);
      windowAudio.set(
        chunk.subarray(chunk.length - takeFromChunk),
        windowAudio.length - offset - takeFromChunk
      );
      offset += takeFromChunk;
      samplesNeeded -= takeFromChunk;
    }

    try {
      // Transcribe with prompt for consistent punctuation
      const prompt = this.getPrompt();
      const result = await this.processor(windowAudio, {
        return_timestamps: false,
        sampling_rate: this.sampleRate,
        language: this.config.language,
        task: 'transcribe',
        initial_prompt: prompt,
      });

      const transcribedText = result.text || '';

      if (!transcribedText.trim()) {
        return;
      }

      // Check local agreement
      const { agreedText, isAgreed } = this.agreementBuffer.processSegment(transcribedText);

      if (isAgreed && agreedText) {
        // Emit final result
        const finalTranscript: StreamingTranscript = {
          text: agreedText,
          confidence: 0.9, // TODO: Extract from result if available
          isFinal: true,
          timestamp: Date.now(),
        };

        this.emit('final', finalTranscript);

        // Update conversation context
        this.conversationContext.push(...agreedText.split(/\s+/));
        if (this.conversationContext.length > 100) {
          this.conversationContext = this.conversationContext.slice(-100);
        }

        // Trim audio buffer (keep overlap)
        this.trimBuffer(stepSamples);
      } else {
        // Emit interim result
        const interimTranscript: StreamingTranscript = {
          text: transcribedText,
          confidence: 0.7,
          isFinal: false,
          timestamp: Date.now(),
        };

        this.emit('interim', interimTranscript);
      }
    } catch (error) {
      console.error('[WhisperStreaming] Error processing window:', error);
      this.emit('error', error);
    }
  }

  /**
   * Generate prompt for consistent punctuation
   */
  private getPrompt(): string {
    // Select 2-3 random sentences from bank
    const selected = this.sentenceBank
      .sort(() => Math.random() - 0.5)
      .slice(0, 3)
      .join(' ');

    // Add recent conversation context
    const context = this.conversationContext.slice(-50).join(' ');

    return `${selected} ${context}`.trim();
  }

  /**
   * Trim audio buffer, keeping overlap
   */
  private trimBuffer(keepSamples: number): void {
    const totalSamples = this.audioBuffer.reduce((sum, chunk) => sum + chunk.length, 0);
    const trimSamples = totalSamples - keepSamples;

    if (trimSamples <= 0) {
      return;
    }

    let trimmed = 0;
    while (trimmed < trimSamples && this.audioBuffer.length > 0) {
      const chunk = this.audioBuffer[0];
      const chunkSize = chunk.length;

      if (trimmed + chunkSize <= trimSamples) {
        // Remove entire chunk
        this.audioBuffer.shift();
        trimmed += chunkSize;
      } else {
        // Trim partial chunk
        const trimFromChunk = trimSamples - trimmed;
        this.audioBuffer[0] = chunk.subarray(trimFromChunk);
        trimmed = trimSamples;
      }
    }
  }

  /**
   * Reset streaming state
   */
  reset(): void {
    this.audioBuffer = [];
    this.agreementBuffer.reset();
    this.conversationContext = [];
  }

  /**
   * Force processing of current buffer
   */
  async flush(): Promise<void> {
    if (this.audioBuffer.length > 0) {
      await this.processWindow();
    }
  }
}

