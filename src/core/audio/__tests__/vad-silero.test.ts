import { describe, it, expect, beforeEach, vi } from 'vitest';
import { SileroVADProvider } from '../vad-silero';
import { loadTransformers } from '../transformers';

vi.mock('../transformers');

describe('SileroVADProvider', () => {
  let provider: SileroVADProvider;
  let mockPipeline: any;

  beforeEach(() => {
    provider = new SileroVADProvider();
    mockPipeline = vi.fn().mockResolvedValue([
      { label: 'SPEECH', score: 0.8 },
      { label: 'NO_SPEECH', score: 0.2 },
    ]);

    vi.mocked(loadTransformers).mockResolvedValue({
      pipeline: vi.fn().mockResolvedValue(mockPipeline),
      env: {},
    } as any);
  });

  describe('initialization', () => {
    it('should initialize successfully', async () => {
      await provider.initialize();
      expect(provider.getName()).toBe('silero');
    });

    it('should handle initialization errors gracefully', async () => {
      vi.mocked(loadTransformers).mockRejectedValueOnce(new Error('Load failed'));

      await expect(provider.initialize()).rejects.toThrow();
    });
  });

  describe('processing', () => {
    beforeEach(async () => {
      await provider.initialize();
    });

    it('should detect speech when probability is above threshold', async () => {
      mockPipeline.mockResolvedValueOnce([
        { label: 'SPEECH', score: 0.8 },
      ]);

      const result = await provider.process(new Float32Array(1600), 0.1);

      expect(result.speech).toBe(true);
    });

    it('should not detect speech when probability is below threshold', async () => {
      mockPipeline.mockResolvedValueOnce([
        { label: 'NO_SPEECH', score: 0.8 },
      ]);

      const result = await provider.process(new Float32Array(1600), 0.1);

      expect(result.speech).toBe(false);
    });

    it('should detect pause after silence duration', async () => {
      // First chunk: speech
      mockPipeline.mockResolvedValueOnce([
        { label: 'SPEECH', score: 0.8 },
      ]);
      await provider.process(new Float32Array(1600), 0.1);

      // Second chunk: silence (should trigger pause after duration)
      // minSilenceDurationMs is typically 500ms, each chunk is ~100ms at 16kHz
      // So we need at least 5-6 chunks of silence
      mockPipeline.mockResolvedValue([
        { label: 'NO_SPEECH', score: 0.8 },
      ]);

      // Process multiple silence chunks to exceed minSilenceDurationMs (500ms)
      // Each chunk is ~100ms, so we need at least 6 chunks
      let result;
      for (let i = 0; i < 7; i++) {
        result = await provider.process(new Float32Array(1600), 0.01);
        if (result.pause) {
          break; // Pause detected, stop processing
        }
      }

      expect(result!.pause).toBe(true);
    });

    it('should reset state correctly', () => {
      provider.resetState();
      // State should be reset (no way to directly check, but should not throw)
      expect(() => provider.resetState()).not.toThrow();
    });
  });
});



