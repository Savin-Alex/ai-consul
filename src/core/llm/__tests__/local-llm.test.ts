import { describe, it, expect, beforeEach, vi } from 'vitest';
import { LocalLLM } from '../local-llm';
import axios from 'axios';

vi.mock('axios');
const mockedAxios = vi.mocked(axios);

describe('LocalLLM', () => {
  let localLLM: LocalLLM;

  beforeEach(() => {
    localLLM = new LocalLLM();
    vi.clearAllMocks();
  });

  describe('checkConnection', () => {
    it('should return true when Ollama is running', async () => {
      const mockGet = vi.fn().mockResolvedValue({ status: 200 });
      mockedAxios.create = vi.fn(() => ({
        get: mockGet,
        post: vi.fn(),
      })) as any;

      const result = await localLLM.checkConnection();
      expect(result).toBe(true);
    });

    it('should return false when Ollama is not running', async () => {
      const mockGet = vi.fn().mockRejectedValue(new Error('Connection refused'));
      mockedAxios.create = vi.fn(() => ({
        get: mockGet,
        post: vi.fn(),
      })) as any;

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

      const mockGet = vi.fn().mockResolvedValue({ data: mockModels });
      mockedAxios.create = vi.fn(() => ({
        get: mockGet,
        post: vi.fn(),
      })) as any;

      const models = await localLLM.listModels();
      expect(models).toEqual(['llama3:8b', 'phi3:mini']);
    });

    it('should return empty array on error', async () => {
      const mockGet = vi.fn().mockRejectedValue(new Error('Failed'));
      mockedAxios.create = vi.fn(() => ({
        get: mockGet,
        post: vi.fn(),
      })) as any;

      const models = await localLLM.listModels();
      expect(models).toEqual([]);
    });
  });

  describe('generate', () => {
    it('should generate text from Ollama', async () => {
      const mockResponse = {
        response: 'This is a generated response',
      };

      const mockPost = vi.fn().mockResolvedValue({ data: mockResponse });
      mockedAxios.create = vi.fn(() => ({
        get: vi.fn(),
        post: mockPost,
      })) as any;

      const result = await localLLM.generate('Test prompt', 'llama3:8b');
      expect(result).toBe('This is a generated response');
    });

    it('should include system prompt when provided', async () => {
      const postSpy = vi.fn().mockResolvedValue({
        data: { response: 'Response' },
      });

      mockedAxios.create = vi.fn(() => ({
        get: vi.fn(),
        post: postSpy,
      })) as any;

      await localLLM.generate('User prompt', 'llama3:8b', 'System prompt');
      
      expect(postSpy).toHaveBeenCalledWith(
        '/api/generate',
        expect.objectContaining({
          prompt: 'System prompt\n\nUser prompt',
        }),
        expect.any(Object)
      );
    });

    it('should throw error when Ollama is not running', async () => {
      const mockPost = vi.fn().mockRejectedValue({
        code: 'ECONNREFUSED',
        message: 'Connection refused',
      });

      mockedAxios.create = vi.fn(() => ({
        get: vi.fn(),
        post: mockPost,
      })) as any;

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

