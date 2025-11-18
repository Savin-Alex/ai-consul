import { EventEmitter } from 'events';

export interface AudioMetrics {
  wordsPerMinute: number;
  fillerWords: number;
  pauseDuration: number;
  energy: number; // 0-1 scale
}

export interface CoachingNudge {
  type: 'pacing' | 'filler_words' | 'energy';
  message: string;
}

export interface CoachingConfig {
  pacing: { min: number; max: number };
  fillerRate: number; // percentage
  energyThreshold: number;
}

const DEFAULT_CONFIG: CoachingConfig = {
  pacing: { min: 100, max: 180 },
  fillerRate: 5,
  energyThreshold: 0.3,
};

export class CoachingMode extends EventEmitter {
  private metricsHistory: AudioMetrics[] = [];
  private config: CoachingConfig;
  private fillerWordPatterns = [
    /\b(um|uh|er|ah|like|you know|so|well)\b/gi,
    /\b(actually|basically|literally|obviously|honestly)\b/gi,
    /\b(kinda|sorta|wanna|gonna)\b/gi,
    /\b(repeat|again|I mean)\b/gi,
  ];

  constructor(config: Partial<CoachingConfig> = {}) {
    super();
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  analyzeTranscription(
    transcription: string,
    durationSeconds: number,
    audioMetrics?: { avgAmplitude: number; variability?: number }
  ): AudioMetrics {
    const words = transcription.split(/\s+/).filter((w) => w.length > 0);
    const wordCount = words.length;
    const wordsPerMinute = (wordCount / durationSeconds) * 60;

    // Count filler words
    let fillerCount = 0;
    for (const pattern of this.fillerWordPatterns) {
      const matches = transcription.match(pattern);
      if (matches) {
        fillerCount += matches.length;
      }
    }

    // Calculate energy: use audio metrics if available, otherwise estimate from text
    let energy: number;
    if (audioMetrics) {
      // Use actual audio characteristics
      const variability = audioMetrics.variability || 0.5;
      energy = Math.min(1, audioMetrics.avgAmplitude * (1 + variability));
    } else {
      // Fallback to text-based heuristics
      const exclamationCount = (transcription.match(/!/g) || []).length;
      const questionCount = (transcription.match(/\?/g) || []).length;
      const capsWords = words.filter((w) => /^[A-Z]/.test(w)).length;
      energy = Math.min(1, (exclamationCount + questionCount + capsWords / wordCount) / 3);
    }

    // Estimate pause duration (simple: count punctuation as pauses)
    const pauseCount = (transcription.match(/[.,;:]/g) || []).length;
    const pauseDuration = pauseCount * 0.5; // Rough estimate

    const metrics: AudioMetrics = {
      wordsPerMinute,
      fillerWords: fillerCount,
      pauseDuration,
      energy,
    };

    this.metricsHistory.push(metrics);
    this.emit('metrics-updated', metrics);

    // Generate coaching nudges if thresholds are exceeded
    this.checkAndEmitNudges(metrics);

    return metrics;
  }

  private checkAndEmitNudges(metrics: AudioMetrics): void {
    const nudges: CoachingNudge[] = [];

    // Pacing: use configurable thresholds
    if (metrics.wordsPerMinute > this.config.pacing.max) {
      nudges.push({
        type: 'pacing',
        message: `Pacing: Too fast (${Math.round(metrics.wordsPerMinute)} WPM, target: ${this.config.pacing.max} WPM)`,
      });
    } else if (metrics.wordsPerMinute < this.config.pacing.min) {
      nudges.push({
        type: 'pacing',
        message: `Pacing: Too slow (${Math.round(metrics.wordsPerMinute)} WPM, target: ${this.config.pacing.min} WPM)`,
      });
    }

    // Filler words: use configurable rate
    const fillerRate = (metrics.fillerWords / metrics.wordsPerMinute) * 100;
    if (fillerRate > this.config.fillerRate) {
      nudges.push({
        type: 'filler_words',
        message: `Reduce filler words (${fillerRate.toFixed(1)}% filler rate, target: <${this.config.fillerRate}%)`,
      });
    }

    // Energy: use configurable threshold
    if (metrics.energy < this.config.energyThreshold) {
      nudges.push({
        type: 'energy',
        message: `Increase energy (current: ${metrics.energy.toFixed(2)}, target: >${this.config.energyThreshold})`,
      });
    }

    if (nudges.length > 0) {
      this.emit('coaching-nudge', nudges);
    }
  }

  getMetricsHistory(): AudioMetrics[] {
    return [...this.metricsHistory];
  }

  clearHistory(): void {
    this.metricsHistory = [];
  }
}

