/**
 * Sentence Assembly State Machine
 * Intelligently assembles words into complete sentences
 * Detects boundaries based on punctuation, silence, and timeouts
 */

import { EventEmitter } from 'events';

export interface Word {
  text: string;
  start: number;
  end: number;
  confidence: number;
}

export interface CompleteSentence {
  text: string;
  words: Word[];
  startTime: number;
  endTime: number;
  confidence: number;
  boundaryType: 'punctuation' | 'silence' | 'timeout';
}

enum AssemblyState {
  IDLE = 'idle',
  COLLECTING = 'collecting',
  BOUNDARY_PENDING = 'boundary_pending',
  READY_TO_EMIT = 'ready_to_emit',
}

export interface SentenceAssemblerConfig {
  maxSentenceDuration: number; // milliseconds
  minSilenceForBoundary: number; // milliseconds
  punctuationRegex: RegExp;
  boundaryConfirmationDelay: number; // milliseconds
}

const DEFAULT_CONFIG: SentenceAssemblerConfig = {
  maxSentenceDuration: 8000, // 8 seconds
  minSilenceForBoundary: 500, // 500ms
  punctuationRegex: /[.!?]+$/,
  boundaryConfirmationDelay: 200,
};

export class SentenceAssembler extends EventEmitter {
  private state: AssemblyState = AssemblyState.IDLE;
  private wordBuffer: Word[] = [];
  private lastEmitTime: number = Date.now();
  private boundaryTimeout: NodeJS.Timeout | null = null;
  private config: SentenceAssemblerConfig;

  constructor(config: Partial<SentenceAssemblerConfig> = {}) {
    super();
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Add a final transcript (with words) to the assembler
   */
  async addFinalTranscript(text: string, words: Word[] = []): Promise<void> {
    if (!text || !text.trim()) {
      return;
    }

    // If no words provided, create simple word objects
    const transcriptWords: Word[] = words.length > 0
      ? words
      : text.split(/\s+/).map((word, index) => ({
          text: word,
          start: Date.now() - (text.split(/\s+/).length - index) * 100,
          end: Date.now() - (text.split(/\s+/).length - index - 1) * 100,
          confidence: 0.9,
        }));

    this.wordBuffer.push(...transcriptWords);
    this.state = AssemblyState.COLLECTING;

    await this.checkBoundaries();
  }

  /**
   * Check for sentence boundaries and emit if ready
   */
  private async checkBoundaries(): Promise<void> {
    const now = Date.now();

    // Force emission if timeout
    if (now - this.lastEmitTime > this.config.maxSentenceDuration) {
      await this.emitSentence('timeout');
      return;
    }

    if (this.wordBuffer.length === 0) {
      return;
    }

    const lastWord = this.wordBuffer[this.wordBuffer.length - 1];

    // Check for punctuation boundary
    if (this.config.punctuationRegex.test(lastWord.text)) {
      this.state = AssemblyState.BOUNDARY_PENDING;

      // Clear any existing timeout
      if (this.boundaryTimeout) {
        clearTimeout(this.boundaryTimeout);
      }

      // Wait for confirmation (next word or timeout)
      this.boundaryTimeout = setTimeout(() => {
        if (this.state === AssemblyState.BOUNDARY_PENDING) {
          this.emitSentence('punctuation');
        }
      }, this.config.boundaryConfirmationDelay);

      return;
    }

    // Check for silence boundary
    if (this.wordBuffer.length >= 2) {
      const lastGap = lastWord.start - this.wordBuffer[this.wordBuffer.length - 2].end;
      if (lastGap > this.config.minSilenceForBoundary) {
        await this.emitSentence('silence');
        return;
      }
    }
  }

  /**
   * Emit a complete sentence
   */
  private async emitSentence(reason: 'punctuation' | 'silence' | 'timeout'): Promise<void> {
    if (this.wordBuffer.length === 0) {
      this.state = AssemblyState.IDLE;
      return;
    }

    // Clear boundary timeout
    if (this.boundaryTimeout) {
      clearTimeout(this.boundaryTimeout);
      this.boundaryTimeout = null;
    }

    const sentence: CompleteSentence = {
      text: this.wordBuffer.map(w => w.text).join(' '),
      words: [...this.wordBuffer],
      startTime: this.wordBuffer[0].start,
      endTime: this.wordBuffer[this.wordBuffer.length - 1].end,
      confidence: this.calculateAverageConfidence(),
      boundaryType: reason,
    };

    // Emit to listeners
    this.emit('sentence', sentence);

    // Clear buffers
    this.wordBuffer = [];
    this.lastEmitTime = Date.now();
    this.state = AssemblyState.IDLE;
  }

  /**
   * Calculate average confidence of words in buffer
   */
  private calculateAverageConfidence(): number {
    if (this.wordBuffer.length === 0) {
      return 0;
    }

    const sum = this.wordBuffer.reduce((acc, word) => acc + word.confidence, 0);
    return sum / this.wordBuffer.length;
  }

  /**
   * Reset the assembler state
   */
  reset(): void {
    if (this.boundaryTimeout) {
      clearTimeout(this.boundaryTimeout);
      this.boundaryTimeout = null;
    }

    this.wordBuffer = [];
    this.state = AssemblyState.IDLE;
    this.lastEmitTime = Date.now();
  }

  /**
   * Force emission of current buffer
   */
  async flush(): Promise<void> {
    if (this.wordBuffer.length > 0) {
      await this.emitSentence('timeout');
    }
  }

  /**
   * Get current state
   */
  getState(): AssemblyState {
    return this.state;
  }

  /**
   * Get current buffer size
   */
  getBufferSize(): number {
    return this.wordBuffer.length;
  }
}

