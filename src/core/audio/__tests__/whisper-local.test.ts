import { describe, it, expect, vi, beforeEach } from 'vitest';
import { LocalWhisper } from '../whisper-local';

describe('LocalWhisper', () => {
  let whisper: LocalWhisper;

  beforeEach(() => {
    whisper = new LocalWhisper();
    (whisper as any).isInitialized = true;
  });

  it('passes raw Float32Array and sampling rate to the processor', async () => {
    const processorMock = vi.fn().mockResolvedValue({ text: 'hello world' });
    (whisper as any).processor = processorMock;

    const chunk = new Float32Array([0.1, -0.2, 0.3]);
    const transcript = await whisper.transcribe(chunk, 16000);

    expect(transcript).toBe('hello world');
    expect(processorMock).toHaveBeenCalledWith(chunk, {
      return_timestamps: false,
      sampling_rate: 16000,
      language: 'english',
      task: 'transcribe',
    });
  });

  it('wraps processor errors with descriptive message', async () => {
    const processorError = new Error('boom');
    (whisper as any).processor = vi.fn().mockRejectedValue(processorError);

    await expect(whisper.transcribe(new Float32Array([0.1]), 16000)).rejects.toThrow(
      'Transcription failed: boom'
    );
  });
});
