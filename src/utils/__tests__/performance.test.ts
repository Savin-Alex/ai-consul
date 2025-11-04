import { describe, it, expect, beforeEach } from 'vitest';
import { PerformanceMonitor } from '../performance';

// Mock navigator and performance APIs
Object.defineProperty(global, 'navigator', {
  value: {
    hardwareConcurrency: 8,
    platform: 'MacIntel',
  },
  writable: true,
});

Object.defineProperty(global, 'performance', {
  value: {
    memory: {
      jsHeapSizeLimit: 8 * 1024 * 1024 * 1024, // 8GB
    },
  },
  writable: true,
});

describe('PerformanceMonitor', () => {
  let monitor: PerformanceMonitor;

  beforeEach(() => {
    monitor = new PerformanceMonitor();
  });

  describe('detectHardware', () => {
    it('should detect hardware tier correctly', () => {
      const hardwareInfo = monitor.getHardwareInfo();

      expect(hardwareInfo).toBeDefined();
      expect(hardwareInfo?.cpuCores).toBe(8);
      expect(['basic', 'standard', 'pro']).toContain(hardwareInfo?.tier);
    });

    it('should classify as pro for high-end hardware', () => {
      global.navigator.hardwareConcurrency = 16;
      global.performance.memory = {
        jsHeapSizeLimit: 16 * 1024 * 1024 * 1024,
      } as any;

      const newMonitor = new PerformanceMonitor();
      const hardwareInfo = newMonitor.getHardwareInfo();

      expect(hardwareInfo?.tier).toBe('pro');
    });
  });

  describe('trackTranscriptionLatency', () => {
    it('should track transcription latency', () => {
      const startTime = Date.now();
      const endTime = startTime + 100; // 100ms

      monitor.trackTranscriptionLatency(startTime, endTime);

      const metrics = monitor.getMetrics();
      expect(metrics.latency.transcription).toBe(100);
    });
  });

  describe('trackLLMLatency', () => {
    it('should track LLM latency', () => {
      const startTime = Date.now();
      const endTime = startTime + 500; // 500ms

      monitor.trackLLMLatency(startTime, endTime);

      const metrics = monitor.getMetrics();
      expect(metrics.latency.llm).toBe(500);
    });

    it('should update total latency', () => {
      monitor.trackTranscriptionLatency(0, 100);
      monitor.trackLLMLatency(0, 500);

      const metrics = monitor.getMetrics();
      expect(metrics.latency.total).toBe(600);
    });
  });

  describe('trackSuggestionRating', () => {
    it('should track suggestion ratings', () => {
      monitor.trackSuggestionRating('suggestion-1', 0.8);
      monitor.trackSuggestionRating('suggestion-2', 0.9);

      const metrics = monitor.getMetrics();
      expect(metrics.quality.suggestionUsefulness).toBeGreaterThan(0);
    });
  });

  describe('anonymize', () => {
    it('should return anonymized metrics', () => {
      monitor.trackTranscriptionLatency(0, 100);
      monitor.trackLLMLatency(0, 200);

      const anonymized = monitor.anonymize();

      expect(anonymized.latency).toBeDefined();
      expect(anonymized.hardwareTier).toBeDefined();
      expect(anonymized).not.toHaveProperty('cpuCores');
      expect(anonymized).not.toHaveProperty('totalMemory');
    });
  });

  describe('reset', () => {
    it('should reset all metrics', () => {
      monitor.trackTranscriptionLatency(0, 100);
      monitor.trackLLMLatency(0, 200);
      monitor.trackUserFeedback(0.8);

      monitor.reset();

      const metrics = monitor.getMetrics();
      expect(metrics.latency.transcription).toBe(0);
      expect(metrics.latency.llm).toBe(0);
      expect(metrics.quality.userSatisfaction).toBe(0);
    });
  });
});

