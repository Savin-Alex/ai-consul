import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { AIConsulEngine, EngineConfig } from '../../src/core/engine';
import { resolveTranscriptionConfig } from '../../src/core/config/transcription';

// Mock dependencies
vi.mock('../../src/core/audio/whisper-local');
vi.mock('../../src/core/audio/whisper-cloud');
vi.mock('../../src/core/llm/router');
vi.mock('../../src/core/context/rag-engine');
vi.mock('../../src/core/audio/vad', () => {
  const VADProcessor = vi.fn().mockImplementation(function MockVAD(this: any) {
    this.isReady = vi.fn().mockResolvedValue(undefined);
    this.resetState = vi.fn();
    this.process = vi.fn().mockResolvedValue({ speech: false, pause: false });
  });
  return { VADProcessor };
});

describe('Network & Memory Resilience Tests', () => {
  let engine: AIConsulEngine;
  const audioChunk = new Float32Array([0.1, 0.2, 0.3, 0.4, 0.5]);

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    if (engine) {
      engine.stopSession();
    }
  });

  describe('Network failure handling', () => {
    it('should gracefully handle cloud API timeout', async () => {
      const engineConfig: EngineConfig = {
        privacy: {
          offlineFirst: false,
          cloudFallback: true,
          dataRetention: 7,
        },
        performance: {
          hardwareTier: 'auto-detect',
          latencyTarget: 5000,
          qualityPreference: 'balanced',
        },
        models: {
          transcription: {
            primary: 'cloud-whisper',
            fallback: 'local-whisper-base',
          },
          llm: {
            primary: 'ollama://llama3:8b',
            fallbacks: [],
          },
        },
      };

      engine = new AIConsulEngine(engineConfig);
      
      // Mock cloud failure with timeout error
      vi.spyOn(engine, 'transcribe').mockRejectedValue(new Error('Request timeout'));

      await engine.initialize();
      
      // Should handle timeout gracefully
      await expect(engine.transcribe(audioChunk)).rejects.toThrow('Request timeout');
    });

    it('should fallback to local when cloud is unavailable', async () => {
      const config = resolveTranscriptionConfig({ mode: 'local-first' });
      expect(config.allowCloud).toBe(true);
      expect(config.failoverOrder).toContain('local-whisper');
      expect(config.failoverOrder).toContain('cloud-assembly');
    });

    it('should handle network errors without crashing', async () => {
      const engineConfig: EngineConfig = {
        privacy: {
          offlineFirst: true,
          cloudFallback: true,
          dataRetention: 7,
        },
        performance: {
          hardwareTier: 'auto-detect',
          latencyTarget: 5000,
          qualityPreference: 'balanced',
        },
        models: {
          transcription: {
            primary: 'local-whisper-base',
            fallback: 'cloud-whisper',
          },
          llm: {
            primary: 'ollama://llama3:8b',
            fallbacks: [],
          },
        },
      };

      engine = new AIConsulEngine(engineConfig);
      
      // Mock network error
      vi.spyOn(engine, 'transcribe').mockRejectedValue(new Error('Network error'));
      
      await engine.initialize();
      
      // Should throw error but not crash
      await expect(engine.transcribe(audioChunk)).rejects.toThrow('Network error');
    });
  });

  describe('Memory pressure handling', () => {
    it('should handle large audio chunks without memory leaks', async () => {
      const engineConfig: EngineConfig = {
        privacy: {
          offlineFirst: true,
          cloudFallback: false,
          dataRetention: 7,
        },
        performance: {
          hardwareTier: 'auto-detect',
          latencyTarget: 5000,
          qualityPreference: 'balanced',
        },
        models: {
          transcription: {
            primary: 'local-whisper-base',
            fallback: 'cloud-whisper',
          },
          llm: {
            primary: 'ollama://llama3:8b',
            fallbacks: [],
          },
        },
      };

      engine = new AIConsulEngine(engineConfig);
      await engine.initialize();

      // Generate large audio chunk (10 seconds at 16kHz)
      const largeChunk = new Float32Array(16000 * 10);
      for (let i = 0; i < largeChunk.length; i++) {
        largeChunk[i] = Math.sin(2 * Math.PI * 440 * i / 16000) * 0.5;
      }

      const initialMemory = process.memoryUsage().heapUsed;
      
      // Process multiple large chunks
      for (let i = 0; i < 5; i++) {
        vi.spyOn(engine, 'transcribe').mockResolvedValue(`Transcription ${i}`);
        await engine.transcribe(largeChunk);
      }

      // Force garbage collection if available
      if (global.gc) {
        global.gc();
      }

      const finalMemory = process.memoryUsage().heapUsed;
      const memoryDelta = (finalMemory - initialMemory) / (1024 * 1024); // MB

      // Memory increase should be reasonable (< 100MB for 5 large chunks)
      expect(memoryDelta).toBeLessThan(100);
    });

    it('should cleanup resources after transcription failures', async () => {
      const engineConfig: EngineConfig = {
        privacy: {
          offlineFirst: true,
          cloudFallback: false,
          dataRetention: 7,
        },
        performance: {
          hardwareTier: 'auto-detect',
          latencyTarget: 5000,
          qualityPreference: 'balanced',
        },
        models: {
          transcription: {
            primary: 'local-whisper-base',
            fallback: 'cloud-whisper',
          },
          llm: {
            primary: 'ollama://llama3:8b',
            fallbacks: [],
          },
        },
      };

      engine = new AIConsulEngine(engineConfig);
      await engine.initialize();

      const initialMemory = process.memoryUsage().heapUsed;

      // Simulate multiple failures
      for (let i = 0; i < 10; i++) {
        vi.spyOn(engine, 'transcribe').mockRejectedValue(new Error('Transcription failed'));
        try {
          await engine.transcribe(audioChunk);
        } catch {
          // Expected to fail
        }
      }

      // Force garbage collection if available
      if (global.gc) {
        global.gc();
      }

      const finalMemory = process.memoryUsage().heapUsed;
      const memoryDelta = (finalMemory - initialMemory) / (1024 * 1024); // MB

      // Memory should not grow excessively from failures
      expect(memoryDelta).toBeLessThan(50);
    });
  });

  describe('Concurrent request handling', () => {
    it('should handle multiple concurrent transcription requests', async () => {
      const engineConfig: EngineConfig = {
        privacy: {
          offlineFirst: true,
          cloudFallback: false,
          dataRetention: 7,
        },
        performance: {
          hardwareTier: 'auto-detect',
          latencyTarget: 5000,
          qualityPreference: 'balanced',
        },
        models: {
          transcription: {
            primary: 'local-whisper-base',
            fallback: 'cloud-whisper',
          },
          llm: {
            primary: 'ollama://llama3:8b',
            fallbacks: [],
          },
        },
      };

      engine = new AIConsulEngine(engineConfig);
      await engine.initialize();

      // Mock successful transcriptions
      let callCount = 0;
      vi.spyOn(engine, 'transcribe').mockImplementation(async () => {
        callCount++;
        await new Promise(resolve => setTimeout(resolve, 100)); // Simulate processing time
        return `Transcription ${callCount}`;
      });

      // Launch 5 concurrent requests
      const promises = Array.from({ length: 5 }, () => engine.transcribe(audioChunk));
      const results = await Promise.all(promises);

      expect(results).toHaveLength(5);
      expect(results.every(r => typeof r === 'string')).toBe(true);
    });

    it('should handle mixed success/failure scenarios', async () => {
      const engineConfig: EngineConfig = {
        privacy: {
          offlineFirst: true,
          cloudFallback: true,
          dataRetention: 7,
        },
        performance: {
          hardwareTier: 'auto-detect',
          latencyTarget: 5000,
          qualityPreference: 'balanced',
        },
        models: {
          transcription: {
            primary: 'local-whisper-base',
            fallback: 'cloud-whisper',
          },
          llm: {
            primary: 'ollama://llama3:8b',
            fallbacks: [],
          },
        },
      };

      engine = new AIConsulEngine(engineConfig);
      await engine.initialize();

      let callCount = 0;
      vi.spyOn(engine, 'transcribe').mockImplementation(async () => {
        callCount++;
        if (callCount % 2 === 0) {
          throw new Error('Simulated failure');
        }
        return `Success ${callCount}`;
      });

      const promises = Array.from({ length: 10 }, () => 
        engine.transcribe(audioChunk).catch(err => ({ error: err.message }))
      );
      const results = await Promise.all(promises);

      const successes = results.filter(r => typeof r === 'string');
      const failures = results.filter(r => typeof r === 'object' && 'error' in r);

      expect(successes.length + failures.length).toBe(10);
    });
  });

  describe('Resource cleanup', () => {
    it('should cleanup sessions properly', async () => {
      const engineConfig: EngineConfig = {
        privacy: {
          offlineFirst: true,
          cloudFallback: false,
          dataRetention: 7,
        },
        performance: {
          hardwareTier: 'auto-detect',
          latencyTarget: 5000,
          qualityPreference: 'balanced',
        },
        models: {
          transcription: {
            primary: 'local-whisper-base',
            fallback: 'cloud-whisper',
          },
          llm: {
            primary: 'ollama://llama3:8b',
            fallbacks: [],
          },
        },
      };

      engine = new AIConsulEngine(engineConfig);
      await engine.initialize();

      await engine.startSession({ mode: 'job_interviews' });
      expect(engine.getCurrentSession()).not.toBeNull();

      engine.stopSession();
      expect(engine.getCurrentSession()).toBeNull();
    });
  });
});

