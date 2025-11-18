import { describe, it, expect, beforeEach, vi } from 'vitest';
import { AudioCaptureManager } from '../capture';

// Mock AudioContext and related APIs
global.AudioContext = vi.fn().mockImplementation(() => ({
  sampleRate: 48000,
  audioWorklet: {
    addModule: vi.fn().mockResolvedValue(undefined),
  },
  createMediaStreamSource: vi.fn().mockReturnValue({
    connect: vi.fn(),
  }),
  createScriptProcessor: vi.fn().mockReturnValue({
    connect: vi.fn(),
    disconnect: vi.fn(),
    onaudioprocess: null,
  }),
  close: vi.fn().mockResolvedValue(undefined),
  destination: {},
})) as any;

global.AudioWorkletNode = vi.fn().mockImplementation(() => ({
  port: {
    onmessage: null,
    close: vi.fn(),
  },
  disconnect: vi.fn(),
  connect: vi.fn(),
})) as any;

global.MediaStream = vi.fn().mockImplementation(() => ({
  getTracks: vi.fn().mockReturnValue([
    {
      stop: vi.fn(),
    },
  ]),
})) as any;

global.navigator = {
  mediaDevices: {
    getUserMedia: vi.fn().mockResolvedValue(new MediaStream()),
  },
} as any;

describe('AudioCaptureManager', () => {
  let captureManager: AudioCaptureManager;

  beforeEach(() => {
    captureManager = new AudioCaptureManager();
    vi.clearAllMocks();
  });

  describe('AudioWorklet support', () => {
    it('should attempt to use AudioWorklet when available', async () => {
      const audioContext = new AudioContext();
      const mockStream = new MediaStream();

      await captureManager.startCapture({
        sources: ['microphone'],
        sampleRate: 16000,
        useAudioWorklet: true,
      });

      expect(audioContext.audioWorklet?.addModule).toHaveBeenCalled();
    });

    it('should fallback to ScriptProcessorNode if AudioWorklet fails', async () => {
      const audioContext = new AudioContext();
      (audioContext.audioWorklet!.addModule as any).mockRejectedValueOnce(
        new Error('AudioWorklet not supported')
      );

      await captureManager.startCapture({
        sources: ['microphone'],
        sampleRate: 16000,
        useAudioWorklet: true,
      });

      // Should fallback to ScriptProcessorNode
      expect(audioContext.createScriptProcessor).toHaveBeenCalled();
    });

    it('should emit audio chunks when using AudioWorklet', async () => {
      const chunks: any[] = [];
      captureManager.on('audio-chunk', (chunk) => {
        chunks.push(chunk);
      });

      await captureManager.startCapture({
        sources: ['microphone'],
        sampleRate: 16000,
        useAudioWorklet: true,
      });

      // Simulate AudioWorklet message
      const audioWorkletNode = new AudioWorkletNode(new AudioContext(), 'test');
      audioWorkletNode.port.onmessage?.({
        data: {
          type: 'audio-chunk',
          data: new Float32Array([0.1, 0.2, 0.3]),
          timestamp: Date.now(),
          sampleRate: 16000,
        },
      } as any);

      expect(chunks.length).toBeGreaterThan(0);
      expect(chunks[0].sampleRate).toBe(16000);
    });
  });

  describe('backward compatibility', () => {
    it('should use ScriptProcessorNode when AudioWorklet is disabled', async () => {
      const audioContext = new AudioContext();

      await captureManager.startCapture({
        sources: ['microphone'],
        sampleRate: 16000,
        useAudioWorklet: false,
      });

      expect(audioContext.createScriptProcessor).toHaveBeenCalled();
    });
  });
});

