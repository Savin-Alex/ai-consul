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

export class CoachingMode extends EventEmitter {
  private metricsHistory: AudioMetrics[] = [];
  private fillerWordPatterns = [
    /\b(um|uh|er|ah|like|you know|so|well)\b/gi,
  ];

  analyzeTranscription(transcription: string, durationSeconds: number): AudioMetrics {
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

    // Estimate energy (simple heuristic: exclamation marks, question marks, capitalization)
    const exclamationCount = (transcription.match(/!/g) || []).length;
    const questionCount = (transcription.match(/\?/g) || []).length;
    const capsWords = words.filter((w) => /^[A-Z]/.test(w)).length;
    const energy = Math.min(1, (exclamationCount + questionCount + capsWords / wordCount) / 3);

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

    // Pacing: too fast (>180 WPM) or too slow (<100 WPM)
    if (metrics.wordsPerMinute > 180) {
      nudges.push({
        type: 'pacing',
        message: 'Pacing: Too fast',
      });
    } else if (metrics.wordsPerMinute < 100) {
      nudges.push({
        type: 'pacing',
        message: 'Pacing: Too slow',
      });
    }

    // Filler words: more than 5 per 100 words
    const fillerRate = (metrics.fillerWords / metrics.wordsPerMinute) * 100;
    if (fillerRate > 5) {
      nudges.push({
        type: 'filler_words',
        message: 'Reduce filler words',
      });
    }

    // Energy: too low (<0.3)
    if (metrics.energy < 0.3) {
      nudges.push({
        type: 'energy',
        message: 'Increase energy',
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

