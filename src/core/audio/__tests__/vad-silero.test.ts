import { describe, it, expect, beforeEach, vi } from 'vitest';
import { SileroVADProvider } from '../vad-silero';
import * as fs from 'fs';

// Create mocks that will be shared
const createMockSession = () => ({
  inputNames: ['input'],
  outputNames: ['output'],
  run: vi.fn(),
});

const createMockOrt = (mockSession: ReturnType<typeof createMockSession>) => ({
  InferenceSession: {
    create: vi.fn().mockResolvedValue(mockSession),
  },
  Tensor: class MockTensor {
    type: string;
    data: Float32Array | Float64Array | number[];
    dims: number[];
    
    constructor(type: string, data: Float32Array | Float64Array | number[], dims: number[]) {
      this.type = type;
      this.data = data;
      this.dims = dims;
    }
  },
});

// Mock onnxruntime-node
vi.mock('onnxruntime-node', () => {
  const mockSession = createMockSession();
  const mockOrt = createMockOrt(mockSession);
  
  // Store in global for test access
  (globalThis as any).__testMockOrt__ = mockOrt;
  (globalThis as any).__testMockSession__ = mockSession;
  
  return {
    default: mockOrt,
    ...mockOrt,
  };
});

// Mock fs.existsSync
vi.mock('fs', async () => {
  const actual = await vi.importActual<typeof fs>('fs');
  return {
    ...actual,
    existsSync: vi.fn(),
  };
});

describe('SileroVADProvider', () => {
  let provider: SileroVADProvider;
  let mockSession: ReturnType<typeof createMockSession>;
  let mockOrt: ReturnType<typeof createMockOrt>;

  beforeEach(() => {
    // Get mocks from global
    mockSession = (globalThis as any).__testMockSession__;
    mockOrt = (globalThis as any).__testMockOrt__;
    
    // Reset mocks
    vi.clearAllMocks();
    if (mockSession) {
      mockSession.run.mockClear();
    }
    if (mockOrt) {
      mockOrt.InferenceSession.create.mockClear();
      mockOrt.InferenceSession.create.mockResolvedValue(mockSession);
    }
    
    // Mock file system - return true for first path to allow initialization
    vi.mocked(fs.existsSync).mockReturnValue(true);
    
    provider = new SileroVADProvider();
  });

  describe('initialization', () => {
    it('should initialize successfully', async () => {
      await provider.initialize();
      expect(provider.getName()).toBe('silero');
      if (mockOrt) {
        expect(mockOrt.InferenceSession.create).toHaveBeenCalled();
      }
    });

    it('should handle initialization errors gracefully', async () => {
      vi.mocked(fs.existsSync).mockReturnValue(false);
      
      const errorProvider = new SileroVADProvider();
      await expect(errorProvider.initialize()).rejects.toThrow();
    });
  });

  describe('processing', () => {
    beforeEach(async () => {
      await provider.initialize();
    });

    it('should detect speech when probability is above threshold', async () => {
      if (!mockSession) return;
      
      const outputName = mockSession.outputNames[0] || 'output';
      const mockOutput = {
        [outputName]: {
          data: new Float32Array([0.2, 0.8]), // [NO_SPEECH=0.2, SPEECH=0.8]
        },
      };
      
      mockSession.run.mockImplementation(async (feeds: any) => {
        expect(feeds).toHaveProperty('input');
        return mockOutput;
      });

      const audioChunk = new Float32Array(1600);
      const result = await provider.process(audioChunk, 0.1);
      
      // speechActive = speechDetected || probability >= threshold
      // probability = 0.8 >= 0.5, so speech should be true
      expect(result.speech).toBe(true);
      expect(mockSession.run).toHaveBeenCalled();
    });

    it('should not detect speech when probability is below threshold', async () => {
      if (!mockSession) return;
      
      const outputName = mockSession.outputNames[0] || 'output';
      const mockOutput = {
        [outputName]: {
          data: new Float32Array([0.8, 0.2]), // SPEECH probability = 0.2
        },
      };
      
      mockSession.run.mockImplementation(async (feeds: any) => {
        expect(feeds).toHaveProperty('input');
        return mockOutput;
      });

      const result = await provider.process(new Float32Array(1600), 0.1);
      expect(result.speech).toBe(false);
    });

    it('should detect pause after silence duration', async () => {
      if (!mockSession) return;
      
      const outputName = mockSession.outputNames[0] || 'output';
      const speechOutput = {
        [outputName]: {
          data: new Float32Array([0.2, 0.8]),
        },
      };
      
      let callCount = 0;
      mockSession.run.mockImplementation(async (feeds: any) => {
        expect(feeds).toHaveProperty('input');
        callCount++;
        
        // First 3 calls: speech
        if (callCount <= 3) {
          return speechOutput;
        }
        
        // Subsequent: silence
        return {
          [outputName]: {
            data: new Float32Array([0.8, 0.2]),
          },
        };
      });
      
      // Establish speech state
      for (let i = 0; i < 3; i++) {
        await provider.process(new Float32Array(1600), 0.1);
      }

      // Process silence chunks (need 6+ for 500ms threshold)
      let result;
      for (let i = 0; i < 7; i++) {
        result = await provider.process(new Float32Array(1600), 0.01);
        if (result.pause) break;
      }

      expect(result!.pause).toBe(true);
    });

    it('should reset state correctly', () => {
      provider.resetState();
      expect(() => provider.resetState()).not.toThrow();
    });
  });
});
