import { describe, it, expect, beforeEach, vi } from 'vitest';
import { LocalLLM } from '../local-llm';
import axios from 'axios';

vi.mock('axios');
const mockedAxios = vi.mocked(axios);

describe('LocalLLM', () => {
  let localLLM: LocalLLM;
  let mockAxiosInstance: any;

  beforeEach(() => {
    // Create a mock axios instance before LocalLLM constructor runs
    mockAxiosInstance = {
      get: vi.fn(),
      post: vi.fn(),
    };
    
    mockedAxios.create = vi.fn(() => mockAxiosInstance) as any;
    
    localLLM = new LocalLLM();
    vi.clearAllMocks();
  });

  describe('checkConnection', () => {
    it('should return true when Ollama is running', async () => {
      mockAxiosInstance.get = vi.fn().mockResolvedValue({ status: 200 });

      const result = await localLLM.checkConnection();
      expect(result).toBe(true);
      expect(mockAxiosInstance.get).toHaveBeenCalledWith('/api/tags');
    });

    it('should return false when Ollama is not running', async () => {
      mockAxiosInstance.get = vi.fn().mockRejectedValue(new Error('Connection refused'));

      const result = await localLLM.checkConnection();
      expect(result).toBe(false);
    });
  });

  describe('listModels', () => {
    it('should return list of available models', async () => {
      const mockModels = {
        models: [
          { name: 'llama3:8b' },
          { name: 'phi3:mini' },
        ],
      };

      mockAxiosInstance.get = vi.fn().mockResolvedValue({ data: mockModels });

      const models = await localLLM.listModels();
      expect(models).toEqual(['llama3:8b', 'phi3:mini']);
    });

    it('should return empty array on error', async () => {
      mockAxiosInstance.get = vi.fn().mockRejectedValue(new Error('Failed'));

      const models = await localLLM.listModels();
      expect(models).toEqual([]);
    });
  });

  describe('generate', () => {
    it('should generate text from Ollama', async () => {
      const mockResponse = {
        response: 'This is a generated response',
      };

      mockAxiosInstance.post = vi.fn().mockResolvedValue({ data: mockResponse });

      const result = await localLLM.generate('Test prompt', 'llama3:8b');
      expect(result).toBe('This is a generated response');
    });

    it('should include system prompt when provided', async () => {
      mockAxiosInstance.post = vi.fn().mockResolvedValue({
        data: { response: 'Response' },
      });

      await localLLM.generate('User prompt', 'llama3:8b', 'System prompt');
      
      expect(mockAxiosInstance.post).toHaveBeenCalledWith(
        '/api/generate',
        expect.objectContaining({
          prompt: 'System prompt\n\nUser prompt',
        }),
        expect.any(Object)
      );
    });

    it('should throw error when Ollama is not running', async () => {
      mockAxiosInstance.post = vi.fn().mockRejectedValue({
        code: 'ECONNREFUSED',
        message: 'Connection refused',
      });

      await expect(localLLM.generate('Test prompt')).rejects.toThrow(
        'Ollama is not running'
      );
    });
  });

  describe('parseModelString', () => {
    it('should parse ollama:// model string', () => {
      const result = localLLM.parseModelString('ollama://llama3:8b');
      expect(result).toEqual({ model: 'llama3', tag: '8b' });
    });

    it('should parse simple model string', () => {
      const result = localLLM.parseModelString('llama3:8b');
      expect(result).toEqual({ model: 'llama3', tag: '8b' });
    });

    it('should handle model without tag', () => {
      const result = localLLM.parseModelString('llama3');
      expect(result).toEqual({ model: 'llama3', tag: 'latest' });
    });
  });
});

