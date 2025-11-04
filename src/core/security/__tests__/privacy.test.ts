import { describe, it, expect, beforeEach } from 'vitest';
import { SecureDataFlow } from '../privacy';

describe('SecureDataFlow', () => {
  let secureFlow: SecureDataFlow;

  beforeEach(() => {
    secureFlow = new SecureDataFlow({
      offlineFirst: true,
      cloudFallback: false,
      dataRetention: 7,
    });
  });

  describe('processSensitiveData', () => {
    it('should process audio chunk', async () => {
      const audioChunk = new Float32Array([0.1, 0.2, 0.3, 0.4]);
      const result = await secureFlow.processSensitiveData(audioChunk);

      expect(result).toBeInstanceOf(Float32Array);
      expect(result.length).toBe(audioChunk.length);
    });
  });

  describe('shouldUseCloud', () => {
    it('should return false when offlineFirst is true', () => {
      expect(secureFlow.shouldUseCloud()).toBe(false);
    });

    it('should return true when cloudFallback is enabled', () => {
      const cloudFlow = new SecureDataFlow({
        offlineFirst: false,
        cloudFallback: true,
        dataRetention: 7,
      });

      expect(cloudFlow.shouldUseCloud()).toBe(true);
    });
  });

  describe('cleanupSensitiveData', () => {
    it('should cleanup data', async () => {
      const audioChunk = new Float32Array([0.1, 0.2, 0.3]);
      await secureFlow.processSensitiveData(audioChunk);

      await expect(
        secureFlow.cleanupSensitiveData()
      ).resolves.not.toThrow();
    });
  });
});

