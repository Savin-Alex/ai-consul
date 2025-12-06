import { describe, it, expect } from 'vitest';
import { resolveTranscriptionConfig, TranscriptionPriorityConfig, normalizeMode } from '../transcription';

describe('TranscriptionConfig', () => {
  describe('resolveTranscriptionConfig', () => {
    it('should use silero as default VAD provider', () => {
      const config = resolveTranscriptionConfig();
      expect(config.vadProvider).toBe('silero');
    });

    it('should allow overriding VAD provider', () => {
      const config = resolveTranscriptionConfig({ vadProvider: 'default' });
      expect(config.vadProvider).toBe('default');
    });

    it('should respect VAD_PROVIDER environment variable', () => {
      const originalEnv = process.env.VAD_PROVIDER;
      
      process.env.VAD_PROVIDER = 'default';
      const config1 = resolveTranscriptionConfig();
      expect(config1.vadProvider).toBe('default');
      
      process.env.VAD_PROVIDER = 'silero';
      const config2 = resolveTranscriptionConfig();
      expect(config2.vadProvider).toBe('silero');
      
      // Restore original value
      if (originalEnv) {
        process.env.VAD_PROVIDER = originalEnv;
      } else {
        delete process.env.VAD_PROVIDER;
      }
    });

    it('should use local-first as default mode', () => {
      const config = resolveTranscriptionConfig();
      expect(config.mode).toBe('local-first');
    });

    it('should allow overriding mode', () => {
      const config = resolveTranscriptionConfig({ mode: 'cloud-only' });
      expect(config.mode).toBe('cloud-only');
    });

    it('should set allowCloud to false when privacyMode is true', () => {
      const config = resolveTranscriptionConfig({ privacyMode: true });
      expect(config.privacyMode).toBe(true);
      expect(config.allowCloud).toBe(false);
    });

    it('should set allowLocal to false when mode is cloud-only', () => {
      const config = resolveTranscriptionConfig({ mode: 'cloud-only' });
      expect(config.mode).toBe('cloud-only');
      expect(config.allowLocal).toBe(false);
    });

    it('should set failoverOrder correctly for each mode', () => {
      const localOnly = resolveTranscriptionConfig({ mode: 'local-only' });
      expect(localOnly.failoverOrder).toEqual(['local-whisper', 'local-onnx']);

      const cloudOnly = resolveTranscriptionConfig({ mode: 'cloud-only' });
      expect(cloudOnly.failoverOrder).toEqual(['cloud-assembly', 'cloud-deepgram']);

      const localFirst = resolveTranscriptionConfig({ mode: 'local-first' });
      expect(localFirst.failoverOrder).toEqual(['local-whisper', 'local-onnx', 'cloud-assembly', 'cloud-deepgram']);
    });
  });

  describe('normalizeMode', () => {
    it('should return default mode for undefined input', () => {
      expect(normalizeMode(undefined)).toBe('local-first');
    });

    it('should normalize valid mode strings', () => {
      expect(normalizeMode('LOCAL-FIRST')).toBe('local-first');
      expect(normalizeMode('Cloud-Only')).toBe('cloud-only');
      expect(normalizeMode('balanced')).toBe('balanced');
    });

    it('should return default for invalid mode strings', () => {
      expect(normalizeMode('invalid-mode')).toBe('local-first');
    });
  });
});


