import { describe, it, expect, beforeEach, vi } from 'vitest';
import { AudioWorkletHandler } from '../audio-worklet-handler';
import { AudioChunk } from '../audio-capture';

describe('AudioWorkletHandler', () => {
  let mockWorkletNode: AudioWorkletNode;
  let mockManager: {
    processAudioChunk: ReturnType<typeof vi.fn>;
    handleWorkletError: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    // Create mock MessagePort
    const mockPort = {
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      start: vi.fn(),
      close: vi.fn(),
      postMessage: vi.fn(),
    } as any;

    // Create mock AudioWorkletNode
    mockWorkletNode = {
      port: mockPort,
      disconnect: vi.fn(),
      onprocessorerror: null,
    } as any;

    mockManager = {
      processAudioChunk: vi.fn(),
      handleWorkletError: vi.fn(),
    };
  });

  describe('Initialization', () => {
    it('should initialize with worklet node', () => {
      const handler = new AudioWorkletHandler(mockWorkletNode, mockManager);
      handler.initialize();

      expect(mockWorkletNode.port.addEventListener).toHaveBeenCalledWith('message', expect.any(Function));
      expect(mockWorkletNode.port.addEventListener).toHaveBeenCalledWith('messageerror', expect.any(Function));
      expect(mockWorkletNode.port.start).toHaveBeenCalled();
    });

    it('should throw if initialized after cleanup', () => {
      const handler = new AudioWorkletHandler(mockWorkletNode, mockManager);
      handler.cleanup();
      
      expect(() => handler.initialize()).toThrow('Handler already cleaned up');
    });
  });

  describe('Message Handling', () => {
    it('should process audio-chunk messages', () => {
      const handler = new AudioWorkletHandler(mockWorkletNode, mockManager);
      handler.initialize();

      // Get the message handler
      const messageHandler = (mockWorkletNode.port.addEventListener as ReturnType<typeof vi.fn>).mock.calls.find(
        (call: any[]) => call[0] === 'message'
      )?.[1];

      expect(messageHandler).toBeDefined();

      // Create test audio data
      const audioData = new Float32Array([0.1, 0.2, 0.3]);
      const messageEvent = {
        data: {
          type: 'audio-chunk',
          data: audioData,
          sampleRate: 16000,
          timestamp: Date.now(),
        }
      } as MessageEvent;

      // Call handler
      messageHandler(messageEvent);

      // Verify manager.processAudioChunk was called
      expect(mockManager.processAudioChunk).toHaveBeenCalledWith(
        expect.objectContaining({
          data: audioData,
          sampleRate: 16000,
        })
      );
    });

    it('should handle processor-ready messages', () => {
      const handler = new AudioWorkletHandler(mockWorkletNode, mockManager);
      handler.initialize();

      const messageHandler = (mockWorkletNode.port.addEventListener as ReturnType<typeof vi.fn>).mock.calls.find(
        (call: any[]) => call[0] === 'message'
      )?.[1];

      const messageEvent = {
        data: {
          type: 'processor-ready',
          sourceSampleRate: 48000,
          targetSampleRate: 16000,
        }
      } as MessageEvent;

      messageHandler(messageEvent);

      // Should not call processAudioChunk for processor-ready
      expect(mockManager.processAudioChunk).not.toHaveBeenCalled();
    });

    it('should handle error messages', () => {
      const handler = new AudioWorkletHandler(mockWorkletNode, mockManager);
      handler.initialize();

      const messageHandler = (mockWorkletNode.port.addEventListener as ReturnType<typeof vi.fn>).mock.calls.find(
        (call: any[]) => call[0] === 'message'
      )?.[1];

      const messageEvent = {
        data: {
          type: 'error',
          message: 'Test error',
        }
      } as MessageEvent;

      messageHandler(messageEvent);

      expect(mockManager.handleWorkletError).toHaveBeenCalled();
    });
  });

  describe('Cleanup', () => {
    it('should remove all event listeners on cleanup', () => {
      const handler = new AudioWorkletHandler(mockWorkletNode, mockManager);
      handler.initialize();

      // Get handlers
      const messageHandler = (mockWorkletNode.port.addEventListener as ReturnType<typeof vi.fn>).mock.calls.find(
        (call: any[]) => call[0] === 'message'
      )?.[1];
      const errorHandler = (mockWorkletNode.port.addEventListener as ReturnType<typeof vi.fn>).mock.calls.find(
        (call: any[]) => call[0] === 'messageerror'
      )?.[1];

      handler.cleanup();

      expect(mockWorkletNode.port.removeEventListener).toHaveBeenCalledWith('message', messageHandler);
      expect(mockWorkletNode.port.removeEventListener).toHaveBeenCalledWith('messageerror', errorHandler);
      expect(mockWorkletNode.port.close).toHaveBeenCalled();
      expect(mockWorkletNode.disconnect).toHaveBeenCalled();
    });

    it('should verify cleanup with isClean()', () => {
      const handler = new AudioWorkletHandler(mockWorkletNode, mockManager);
      handler.initialize();

      expect(handler.isClean()).toBe(false);

      handler.cleanup();

      expect(handler.isClean()).toBe(true);
    });

    it('should ignore messages after cleanup', () => {
      const handler = new AudioWorkletHandler(mockWorkletNode, mockManager);
      handler.initialize();

      const messageHandler = (mockWorkletNode.port.addEventListener as ReturnType<typeof vi.fn>).mock.calls.find(
        (call: any[]) => call[0] === 'message'
      )?.[1];

      handler.cleanup();

      const messageEvent = {
        data: {
          type: 'audio-chunk',
          data: new Float32Array([0.1]),
          sampleRate: 16000,
          timestamp: Date.now(),
        }
      } as MessageEvent;

      messageHandler(messageEvent);

      // Should not process messages after cleanup
      expect(mockManager.processAudioChunk).not.toHaveBeenCalled();
    });
  });

  describe('Error Handling', () => {
    it('should handle port errors', () => {
      const handler = new AudioWorkletHandler(mockWorkletNode, mockManager);
      handler.initialize();

      const errorHandler = (mockWorkletNode.port.addEventListener as ReturnType<typeof vi.fn>).mock.calls.find(
        (call: any[]) => call[0] === 'messageerror'
      )?.[1];

      // Create a mock error event
      const errorEvent = { type: 'error' } as Event;

      errorHandler(errorEvent);

      expect(mockManager.handleWorkletError).toHaveBeenCalledWith(errorEvent);
      expect(handler.isClean()).toBe(true); // Should auto-cleanup on error
    });
  });
});


