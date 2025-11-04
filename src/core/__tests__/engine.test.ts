import { describe, it, expect, beforeEach, vi } from 'vitest';
import { AIConsulEngine, EngineConfig, SessionConfig } from '../engine';
import { LocalWhisper } from '../audio/whisper-local';
import { LLMRouter } from '../llm/router';
import { ContextManager } from '../context/manager';
import { RAGEngine } from '../context/rag-engine';

// Mock dependencies
vi.mock('../audio/whisper-local');
vi.mock('../audio/whisper-cloud');
vi.mock('../llm/router');
vi.mock('../context/rag-engine');

describe('AIConsulEngine', () => {
  let engine: AIConsulEngine;
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

    engine = new AIConsulEngine(config);
  });

  describe('initialize', () => {
    it('should initialize successfully', async () => {
      const localWhisper = vi.mocked(LocalWhisper);
      localWhisper.prototype.initialize = vi.fn().mockResolvedValue(undefined);

      await expect(engine.initialize()).resolves.not.toThrow();
    });

    it('should initialize with correct model size', async () => {
      const localWhisper = vi.mocked(LocalWhisper);
      const initializeSpy = vi
        .fn()
        .mockResolvedValue(undefined);
      localWhisper.prototype.initialize = initializeSpy;

      config.models.transcription.primary = 'local-whisper-base';
      engine = new AIConsulEngine(config);

      await engine.initialize();
      expect(initializeSpy).toHaveBeenCalledWith('base');
    });
  });

  describe('transcribe', () => {
    it('should transcribe audio using local whisper', async () => {
      const localWhisper = vi.mocked(LocalWhisper);
      const transcribeSpy = vi
        .fn()
        .mockResolvedValue('Hello, this is a test transcription');
      localWhisper.prototype.transcribe = transcribeSpy;
      localWhisper.prototype.initialize = vi.fn().mockResolvedValue(undefined);

      await engine.initialize();
      const audioChunk = new Float32Array([0.1, 0.2, 0.3]);
      const result = await engine.transcribe(audioChunk);

      expect(result).toBe('Hello, this is a test transcription');
      expect(transcribeSpy).toHaveBeenCalledWith(audioChunk);
    });

    it('should throw error when transcription fails', async () => {
      const localWhisper = vi.mocked(LocalWhisper);
      localWhisper.prototype.transcribe = vi
        .fn()
        .mockRejectedValue(new Error('Transcription failed'));
      localWhisper.prototype.initialize = vi.fn().mockResolvedValue(undefined);

      await engine.initialize();
      const audioChunk = new Float32Array([0.1, 0.2, 0.3]);

      await expect(engine.transcribe(audioChunk)).rejects.toThrow(
        'Transcription failed'
      );
    });
  });

  describe('startSession', () => {
    it('should start a session with configuration', async () => {
      const sessionConfig: SessionConfig = {
        mode: 'job_interviews',
        context: {
          documents: ['resume.pdf'],
        },
      };

      await engine.initialize();
      await expect(engine.startSession(sessionConfig)).resolves.not.toThrow();

      const currentSession = engine.getCurrentSession();
      expect(currentSession).toEqual(sessionConfig);
    });
  });

  describe('stopSession', () => {
    it('should stop session and clear data', async () => {
      const sessionConfig: SessionConfig = {
        mode: 'job_interviews',
      };

      await engine.initialize();
      await engine.startSession(sessionConfig);
      engine.stopSession();

      expect(engine.getCurrentSession()).toBeNull();
    });
  });
});

