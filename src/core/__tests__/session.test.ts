import { describe, it, expect, beforeEach, vi } from 'vitest';
import { SessionManager, AudioChunk } from '../session';
import type { AIConsulEngine, SessionConfig, Suggestion } from '../engine';

describe('SessionManager', () => {
  let sessionManager: SessionManager;
  let engineMock: {
    startSession: ReturnType<typeof vi.fn>;
    transcribe: ReturnType<typeof vi.fn>;
    generateSuggestions: ReturnType<typeof vi.fn>;
    stopSession: ReturnType<typeof vi.fn>;
  };

  const createChunk = (): AudioChunk => ({
    data: new Float32Array(4096).fill(0.1),
    sampleRate: 16000,
    channels: 1,
    timestamp: Date.now(),
  });

  beforeEach(() => {
    engineMock = {
      startSession: vi.fn<[SessionConfig], Promise<void>>().mockResolvedValue(undefined),
      transcribe: vi.fn<[Float32Array, number], Promise<string>>(),
      generateSuggestions: vi.fn<[string], Promise<Suggestion[]>>(),
      stopSession: vi.fn(),
    };

    engineMock.transcribe.mockResolvedValue('');
    engineMock.generateSuggestions.mockResolvedValue([]);

    sessionManager = new SessionManager(engineMock as unknown as AIConsulEngine);
  });

  it('buffers at least 2.5 seconds of audio before transcribing', async () => {
    engineMock.transcribe.mockResolvedValue('mock transcript');
    engineMock.generateSuggestions.mockResolvedValue([]);

    await sessionManager.start({ mode: 'job_interviews' });

    for (let i = 0; i < 9; i++) {
      await sessionManager.processAudioChunk(createChunk());
    }

    expect(engineMock.transcribe).not.toHaveBeenCalled();

    await sessionManager.processAudioChunk(createChunk());

    expect(engineMock.transcribe).toHaveBeenCalledTimes(1);

    const [bufferArg, sampleRateArg] = engineMock.transcribe.mock.calls[0];
    expect(bufferArg).toBeInstanceOf(Float32Array);
    expect(bufferArg.length).toBe(40960);
    expect(sampleRateArg).toBe(16000);
  });

  it('skips suggestion generation when transcription is empty', async () => {
    engineMock.transcribe.mockResolvedValue('');

    await sessionManager.start({ mode: 'job_interviews' });

    for (let i = 0; i < 10; i++) {
      await sessionManager.processAudioChunk(createChunk());
    }

    expect(engineMock.generateSuggestions).not.toHaveBeenCalled();
  });
});
