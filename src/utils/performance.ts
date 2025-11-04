import { EventEmitter } from 'events';

export interface PerformanceMetrics {
  latency: {
    transcription: number; // milliseconds
    llm: number;
    total: number;
  };
  quality: {
    transcriptionAccuracy: number; // 0-1
    suggestionUsefulness: number; // 0-1 (from user ratings)
    userSatisfaction: number; // 0-1 (from feedback)
  };
}

export interface HardwareInfo {
  cpuCores: number;
  totalMemory: number; // bytes
  platform: string;
  tier: 'basic' | 'standard' | 'pro';
}

export class PerformanceMonitor extends EventEmitter {
  private metrics: PerformanceMetrics = {
    latency: {
      transcription: 0,
      llm: 0,
      total: 0,
    },
    quality: {
      transcriptionAccuracy: 0,
      suggestionUsefulness: 0,
      userSatisfaction: 0,
    },
  };

  private hardwareInfo: HardwareInfo | null = null;

  constructor() {
    super();
    this.detectHardware();
  }

  private detectHardware(): void {
    const cpuCores = navigator.hardwareConcurrency || 4;
    const totalMemory =
      (performance as any).memory?.jsHeapSizeLimit || 4 * 1024 * 1024 * 1024;
    const platform = navigator.platform || 'unknown';

    let tier: 'basic' | 'standard' | 'pro';
    if (cpuCores >= 8 && totalMemory >= 8 * 1024 * 1024 * 1024) {
      tier = 'pro';
    } else if (cpuCores >= 4 && totalMemory >= 4 * 1024 * 1024 * 1024) {
      tier = 'standard';
    } else {
      tier = 'basic';
    }

    this.hardwareInfo = {
      cpuCores,
      totalMemory,
      platform,
      tier,
    };
  }

  trackTranscriptionLatency(startTime: number, endTime: number): void {
    this.metrics.latency.transcription = endTime - startTime;
    this.updateTotalLatency();
  }

  trackLLMLatency(startTime: number, endTime: number): void {
    this.metrics.latency.llm = endTime - startTime;
    this.updateTotalLatency();
  }

  private updateTotalLatency(): void {
    this.metrics.latency.total =
      this.metrics.latency.transcription + this.metrics.latency.llm;
    this.emit('latency-updated', this.metrics.latency);
  }

  trackSuggestionRating(suggestionId: string, rating: number): void {
    // Simple average for now
    const current = this.metrics.quality.suggestionUsefulness;
    this.metrics.quality.suggestionUsefulness = (current + rating) / 2;
    this.emit('quality-updated', this.metrics.quality);
  }

  trackUserFeedback(satisfaction: number): void {
    this.metrics.quality.userSatisfaction = satisfaction;
    this.emit('quality-updated', this.metrics.quality);
  }

  getMetrics(): PerformanceMetrics {
    return { ...this.metrics };
  }

  getHardwareInfo(): HardwareInfo | null {
    return this.hardwareInfo;
  }

  anonymize(): any {
    // Remove any potentially identifying information
    return {
      latency: this.metrics.latency,
      quality: {
        transcriptionAccuracy: this.metrics.quality.transcriptionAccuracy,
        suggestionUsefulness: this.metrics.quality.suggestionUsefulness,
        userSatisfaction: this.metrics.quality.userSatisfaction,
      },
      hardwareTier: this.hardwareInfo?.tier,
    };
  }

  reset(): void {
    this.metrics = {
      latency: {
        transcription: 0,
        llm: 0,
        total: 0,
      },
      quality: {
        transcriptionAccuracy: 0,
        suggestionUsefulness: 0,
        userSatisfaction: 0,
      },
    };
  }
}

