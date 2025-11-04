import { describe, it, expect, beforeEach, vi } from 'vitest';
import { LLMRouter } from '../router';
import { EngineConfig } from '../../engine';
import { LocalLLM } from '../local-llm';

vi.mock('../local-llm');
vi.mock('../cloud-llm');

describe('LLMRouter', () => {
  let router: LLMRouter;
  let config: EngineConfig;

  beforeEach(() => {
    config = {
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
          primary: 'local-whisper-tiny',
          fallback: 'cloud-whisper',
        },
        llm: {
          primary: 'ollama://llama3:8b',
          fallbacks: ['gpt-4o-mini'],
        },
      },
    };

    router = new LLMRouter(config);
  });

  describe('generate', () => {
    it('should use local LLM when available', async () => {
      const localLLM = vi.mocked(LocalLLM);
      const checkConnectionSpy = vi.fn().mockResolvedValue(true);
      const checkModelAvailableSpy = vi.fn().mockResolvedValue(true);
      const generateSpy = vi.fn().mockResolvedValue('Local response');

      localLLM.prototype.checkConnection = checkConnectionSpy;
      localLLM.prototype.checkModelAvailable = checkModelAvailableSpy;
      localLLM.prototype.generate = generateSpy;

      const result = await router.generate('Test prompt');

      expect(result).toBe('Local response');
      expect(checkConnectionSpy).toHaveBeenCalled();
      expect(generateSpy).toHaveBeenCalledWith(
        'Test prompt',
        'llama3:8b',
        undefined
      );
    });

    it('should fallback to cloud when local LLM unavailable', async () => {
      process.env.OPENAI_API_KEY = 'test-key';
      config.privacy.cloudFallback = true;

      const localLLM = vi.mocked(LocalLLM);
      localLLM.prototype.checkConnection = vi.fn().mockResolvedValue(false);

      // Mock OpenAI service
      const { OpenAIService } = await import('../cloud-llm');
      const openAIService = vi.mocked(OpenAIService);
      openAIService.prototype.generate = vi
        .fn()
        .mockResolvedValue({ text: 'Cloud response' });

      router = new LLMRouter(config);

      const result = await router.generate('Test prompt');

      expect(result).toBe('Cloud response');
    });

    it('should throw error when all services fail', async () => {
      const localLLM = vi.mocked(LocalLLM);
      localLLM.prototype.checkConnection = vi.fn().mockResolvedValue(false);

      config.privacy.cloudFallback = false;
      router = new LLMRouter(config);

      await expect(router.generate('Test prompt')).rejects.toThrow(
        'All LLM services failed'
      );
    });
  });
});

