import { describe, it, expect, beforeEach, vi } from 'vitest';
import { SessionManager, AudioChunk } from '../session';
import type { AIConsulEngine, SessionConfig, Suggestion } from '../engine';
import type { VADProcessor } from '../audio/vad';

describe('SessionManager', () => {
  let sessionManager: SessionManager;
  let engineMock: {
    startSession: ReturnType<typeof vi.fn>;
    transcribe: ReturnType<typeof vi.fn>;
    generateSuggestions: ReturnType<typeof vi.fn>;
    stopSession: ReturnType<typeof vi.fn>;
    getVADProcessor: ReturnType<typeof vi.fn>;
  };
  let vadMock: {
    process: ReturnType<typeof vi.fn>;
    resetState: ReturnType<typeof vi.fn>;
  };

  const createChunk = (): AudioChunk => ({
    data: new Float32Array(1600).fill(0.1),
    sampleRate: 16000,
    channels: 1,
    timestamp: Date.now(),
    maxAmplitude: 0.1,
  });

  beforeEach(() => {
    vadMock = {
      process: vi.fn(),
      resetState: vi.fn(),
    };

    engineMock = {
      startSession: vi.fn<[SessionConfig], Promise<void>>().mockResolvedValue(undefined),
      transcribe: vi.fn<[Float32Array, number], Promise<string>>(),
      generateSuggestions: vi.fn<[string], Promise<Suggestion[]>>(),
      stopSession: vi.fn(),
      getVADProcessor: vi.fn<[], VADProcessor | null>(),
    };

    engineMock.transcribe.mockResolvedValue('');
    engineMock.generateSuggestions.mockResolvedValue([]);
    engineMock.getVADProcessor.mockReturnValue(vadMock as unknown as VADProcessor);

    sessionManager = new SessionManager(engineMock as unknown as AIConsulEngine);
  });

  it('transcribes buffered speech when VAD detects a pause', async () => {
    engineMock.transcribe.mockResolvedValue('mock transcript');
    engineMock.generateSuggestions.mockResolvedValue([]);
    vadMock.process
      .mockResolvedValueOnce({ speech: true, pause: false })
      .mockResolvedValueOnce({ speech: false, pause: true });

    await sessionManager.start({ mode: 'job_interviews' });

    await sessionManager.processAudioChunk(createChunk());
    await sessionManager.processAudioChunk(createChunk());

    expect(engineMock.transcribe).toHaveBeenCalledTimes(1);

    const [bufferArg, sampleRateArg] = engineMock.transcribe.mock.calls[0];
    expect(bufferArg).toBeInstanceOf(Float32Array);
    expect(bufferArg.length).toBe(1600);
    expect(sampleRateArg).toBe(16000);
    expect(engineMock.generateSuggestions).toHaveBeenCalledWith('mock transcript');
    expect(vadMock.process).toHaveBeenCalledWith(expect.any(Float32Array), 0.1);
  });

  it('does not transcribe until a pause is detected', async () => {
    vadMock.process.mockResolvedValue({ speech: true, pause: false });
    await sessionManager.start({ mode: 'job_interviews' });

    await sessionManager.processAudioChunk(createChunk());

    expect(engineMock.transcribe).not.toHaveBeenCalled();
    expect(vadMock.process).toHaveBeenCalledWith(expect.any(Float32Array), 0.1);
  });
});
