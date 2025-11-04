import { describe, it, expect, beforeEach, vi } from 'vitest';
import { AIConsulEngine, EngineConfig, SessionConfig } from '../engine';
import { SessionManager } from '../session';
import { AudioCaptureManager } from '../audio/capture';

// Mock audio capture
vi.mock('../audio/capture');
vi.mock('../audio/whisper-local');
vi.mock('../audio/whisper-cloud');
vi.mock('../llm/router');
vi.mock('../context/rag-engine');

describe('Integration Tests', () => {
  describe('Session Flow', () => {
    it('should handle complete session lifecycle', async () => {
      const config: EngineConfig = {
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
            fallbacks: [],
          },
        },
      };

      const engine = new AIConsulEngine(config);
      const sessionManager = new SessionManager(engine);

      const sessionConfig: SessionConfig = {
        mode: 'job_interviews',
        context: {
          documents: ['resume.pdf'],
        },
      };

      // Mock initialization
      vi.spyOn(engine, 'initialize').mockResolvedValue(undefined);
      vi.spyOn(engine, 'startSession').mockResolvedValue(undefined);
      vi.spyOn(engine, 'stopSession').mockImplementation(() => {});

      await engine.initialize();
      await sessionManager.start(sessionConfig);

      expect(engine.getCurrentSession()).toEqual(sessionConfig);
      expect(sessionManager.getIsActive()).toBe(true);

      await sessionManager.stop();

      expect(sessionManager.getIsActive()).toBe(false);
    });
  });

  describe('Audio to Suggestion Pipeline', () => {
    it('should process audio chunk through pipeline', async () => {
      const config: EngineConfig = {
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
            fallbacks: [],
          },
        },
      };

      const engine = new AIConsulEngine(config);

      // Mock transcription
      vi.spyOn(engine, 'transcribe').mockResolvedValue(
        'Tell me about your experience'
      );

      // Mock suggestion generation
      vi.spyOn(engine, 'generateSuggestions').mockResolvedValue([
        { text: 'Use STAR method', useCase: 'interview_behavioral_nudge' },
      ]);

      const audioChunk = new Float32Array([0.1, 0.2, 0.3]);

      const transcription = await engine.transcribe(audioChunk);
      expect(transcription).toBe('Tell me about your experience');

      const sessionConfig: SessionConfig = {
        mode: 'job_interviews',
      };

      await engine.startSession(sessionConfig);
      const suggestions = await engine.generateSuggestions(transcription);

      expect(suggestions).toHaveLength(1);
      expect(suggestions[0].text).toBe('Use STAR method');
    });
  });
});

