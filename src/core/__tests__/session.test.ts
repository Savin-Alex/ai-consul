import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
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
    getTranscriptionConfig: ReturnType<typeof vi.fn>;
    getConfig: ReturnType<typeof vi.fn>;
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
      getTranscriptionConfig: vi.fn().mockReturnValue({
        mode: 'local-first',
        allowLocal: true,
        allowCloud: false,
        privacyMode: true,
      }),
      getConfig: vi.fn().mockReturnValue({
        models: {
          transcription: {
            mode: 'batch',
            primary: 'local-whisper-tiny',
            fallback: 'cloud-whisper',
          },
        },
      }),
    };

    engineMock.transcribe.mockResolvedValue('');
    engineMock.generateSuggestions.mockResolvedValue([]);
    engineMock.getVADProcessor.mockReturnValue(vadMock as unknown as VADProcessor);

    sessionManager = new SessionManager(engineMock as unknown as AIConsulEngine);
  });

  afterEach(async () => {
    // Clean up any active sessions and timers
    if (sessionManager.getIsActive()) {
      await sessionManager.stop();
    }
    vi.clearAllTimers();
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

  it('prevents stale timeout callback execution', async () => {
    vi.useFakeTimers();
    
    engineMock.transcribe.mockResolvedValue('mock transcript');
    // First chunk has speech (adds to buffer), second has no speech (triggers timeout)
    vadMock.process
      .mockResolvedValueOnce({ speech: true, pause: false })
      .mockResolvedValueOnce({ speech: false, pause: false }); // No speech, triggers timeout

    await sessionManager.start({ mode: 'job_interviews' });

    // Process chunk with speech (adds to buffer)
    await sessionManager.processAudioChunk(createChunk());
    
    // Process chunk without speech (should trigger timeout)
    await sessionManager.processAudioChunk(createChunk());
    
    // Get the timeout ID
    const firstTimeoutId = (sessionManager as any).speechEndTimeout;
    expect(firstTimeoutId).toBeTruthy();

    // Stop session before timeout fires (clears the timeout)
    await sessionManager.stop();
    
    // Verify timeout was cleared
    expect((sessionManager as any).speechEndTimeout).toBeNull();

    // Fast-forward time to when timeout would have fired
    vi.advanceTimersByTime(2000); // More than speechEndTimeoutMs (1500ms)
    await vi.runAllTimersAsync();

    // Verify transcription was NOT called because session was stopped
    expect(engineMock.transcribe).not.toHaveBeenCalled();
    
    vi.useRealTimers();
  });

  it('transcribes buffered speech after speech end timeout', async () => {
    vi.useFakeTimers();
    
    engineMock.transcribe.mockResolvedValue('mock transcript');
    vadMock.process
      .mockResolvedValueOnce({ speech: true, pause: false })
      .mockResolvedValueOnce({ speech: false, pause: false }); // No speech, triggers timeout

    await sessionManager.start({ mode: 'job_interviews' });

    // Process chunk that triggers speech end timeout
    await sessionManager.processAudioChunk(createChunk());
    await sessionManager.processAudioChunk(createChunk());

    // Verify timeout was set
    expect((sessionManager as any).speechEndTimeout).toBeTruthy();

    // Fast-forward time to trigger timeout
    vi.advanceTimersByTime(2000); // More than speechEndTimeoutMs (1500ms)
    await vi.runAllTimersAsync();

    // Verify transcription was called after timeout
    expect(engineMock.transcribe).toHaveBeenCalledTimes(1);
    
    vi.useRealTimers();
  });
});
