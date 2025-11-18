import { describe, it, expect, beforeEach, vi } from 'vitest';
import { AudioCaptureManager } from '../capture';

// Mock AudioContext and related APIs
const mockAddModule = vi.fn().mockResolvedValue(undefined);
const mockCreateMediaStreamSource = vi.fn().mockReturnValue({
  connect: vi.fn(),
});
const mockCreateScriptProcessor = vi.fn().mockReturnValue({
  connect: vi.fn(),
  disconnect: vi.fn(),
  onaudioprocess: null,
});

class MockAudioContext {
  sampleRate = 48000;
  audioWorklet = {
    addModule: mockAddModule,
  };
  createMediaStreamSource = mockCreateMediaStreamSource;
  createScriptProcessor = mockCreateScriptProcessor;
  close = vi.fn().mockResolvedValue(undefined);
  destination = {};
}

const mockAudioWorkletNodePort = {
  onmessage: null,
  close: vi.fn(),
};
const mockDisconnect = vi.fn();
const mockConnect = vi.fn();

class MockAudioWorkletNode {
  port = mockAudioWorkletNodePort;
  disconnect = mockDisconnect;
  connect = mockConnect;
  constructor(context: any, name: string) {
    // Store constructor args for testing
  }
}

global.AudioContext = MockAudioContext as any;
global.AudioWorkletNode = MockAudioWorkletNode as any;

// Create a proper MediaStream constructor
class MockMediaStream {
  getTracks = vi.fn().mockReturnValue([
    {
      stop: vi.fn(),
    },
  ]);
}

global.MediaStream = MockMediaStream as any;

Object.defineProperty(global, 'navigator', {
  value: {
    mediaDevices: {
      getUserMedia: vi.fn().mockResolvedValue(new MockMediaStream()),
    },
  },
  writable: true,
  configurable: true,
});

// Mock window for AudioWorklet path resolution
global.window = {
  location: {
    href: 'http://localhost:3000',
  },
} as any;

describe('AudioCaptureManager', () => {
  let captureManager: AudioCaptureManager;

  beforeEach(() => {
    captureManager = new AudioCaptureManager();
    vi.clearAllMocks();
    // Reset mocks
    mockAddModule.mockResolvedValue(undefined);
    mockCreateScriptProcessor.mockReturnValue({
      connect: vi.fn(),
      disconnect: vi.fn(),
      onaudioprocess: null,
    });
  });

  describe('AudioWorklet support', () => {
    it('should attempt to use AudioWorklet when available', async () => {
      await captureManager.startCapture({
        sources: ['microphone'],
        sampleRate: 16000,
        useAudioWorklet: true,
      });

      expect(mockAddModule).toHaveBeenCalled();
    });

    it('should fallback to ScriptProcessorNode if AudioWorklet fails', async () => {
      mockAddModule.mockRejectedValueOnce(new Error('AudioWorklet not supported'));

      await captureManager.startCapture({
        sources: ['microphone'],
        sampleRate: 16000,
        useAudioWorklet: true,
      });

      // Should fallback to ScriptProcessorNode
      expect(mockCreateScriptProcessor).toHaveBeenCalled();
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
      await captureManager.startCapture({
        sources: ['microphone'],
        sampleRate: 16000,
        useAudioWorklet: false,
      });

      expect(mockCreateScriptProcessor).toHaveBeenCalled();
    });
  });
});



