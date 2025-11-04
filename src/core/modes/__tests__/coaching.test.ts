import { describe, it, expect, beforeEach, vi } from 'vitest';
import { CoachingMode, AudioMetrics } from '../coaching';

describe('CoachingMode', () => {
  let coaching: CoachingMode;

  beforeEach(() => {
    coaching = new CoachingMode();
  });

  describe('analyzeTranscription', () => {
    it('should calculate words per minute', () => {
      const transcription = 'This is a test transcription with several words';
      const durationSeconds = 10; // 10 seconds

      const metrics = coaching.analyzeTranscription(transcription, durationSeconds);

      expect(metrics.wordsPerMinute).toBeGreaterThan(0);
      expect(metrics.wordsPerMinute).toBeLessThan(1000); // Sanity check
    });

    it('should detect filler words', () => {
      const transcription = 'Um, well, you know, this is a test with like, um, filler words';
      const durationSeconds = 10;

      const metrics = coaching.analyzeTranscription(transcription, durationSeconds);

      expect(metrics.fillerWords).toBeGreaterThan(0);
    });

    it('should calculate energy level', () => {
      const transcription = 'This is exciting! What do you think?';
      const durationSeconds = 5;

      const metrics = coaching.analyzeTranscription(transcription, durationSeconds);

      expect(metrics.energy).toBeGreaterThanOrEqual(0);
      expect(metrics.energy).toBeLessThanOrEqual(1);
    });

    it('should emit metrics-updated event', () => {
      const onMetricsUpdated = vi.fn();
      coaching.on('metrics-updated', onMetricsUpdated);

      coaching.analyzeTranscription('Test transcription', 5);

      expect(onMetricsUpdated).toHaveBeenCalled();
    });

    it('should emit coaching-nudge when thresholds exceeded', () => {
      const onNudge = vi.fn();
      coaching.on('coaching-nudge', onNudge);

      // Very fast speech (simulated)
      const fastTranscription = Array(200).fill('word').join(' ');
      coaching.analyzeTranscription(fastTranscription, 30); // 200 words in 30 seconds = 400 WPM

      // Should trigger pacing nudge
      expect(onNudge).toHaveBeenCalled();
    });
  });

  describe('getMetricsHistory', () => {
    it('should return history of metrics', () => {
      coaching.analyzeTranscription('First transcription', 10);
      coaching.analyzeTranscription('Second transcription', 10);

      const history = coaching.getMetricsHistory();
      expect(history.length).toBe(2);
    });
  });

  describe('clearHistory', () => {
    it('should clear metrics history', () => {
      coaching.analyzeTranscription('Test', 10);
      coaching.clearHistory();

      const history = coaching.getMetricsHistory();
      expect(history.length).toBe(0);
    });
  });
});

