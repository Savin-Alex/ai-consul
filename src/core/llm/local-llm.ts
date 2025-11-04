import axios, { AxiosInstance } from 'axios';

export interface LocalLLMResponse {
  text: string;
  done: boolean;
}

export class LocalLLM {
  private client: AxiosInstance;
  private baseURL: string = 'http://localhost:11434';

  constructor() {
    this.client = axios.create({
      baseURL: this.baseURL,
      timeout: 30000,
    });
  }

  async checkConnection(): Promise<boolean> {
    try {
      const response = await this.client.get('/api/tags');
      return response.status === 200;
    } catch (error) {
      return false;
    }
  }

  async listModels(): Promise<string[]> {
    try {
      const response = await this.client.get('/api/tags');
      return response.data.models?.map((m: any) => m.name) || [];
    } catch (error) {
      console.error('Failed to list Ollama models:', error);
      return [];
    }
  }

  async checkModelAvailable(modelName: string): Promise<boolean> {
    const models = await this.listModels();
    return models.some((m) => m === modelName || m.includes(modelName));
  }

  async generate(
    prompt: string,
    model: string = 'llama3:8b',
    systemPrompt?: string
  ): Promise<string> {
    try {
      const fullPrompt = systemPrompt ? `${systemPrompt}\n\n${prompt}` : prompt;

      const response = await this.client.post(
        '/api/generate',
        {
          model,
          prompt: fullPrompt,
          stream: false,
          options: {
            temperature: 0.7,
            num_predict: 200,
          },
        },
        {
          timeout: 60000,
        }
      );

      // Handle streaming response
      if (typeof response.data === 'string') {
        // Parse JSON lines if streaming
        const lines = response.data.split('\n').filter((l) => l.trim());
        const lastLine = lines[lines.length - 1];
        const data = JSON.parse(lastLine);
        return data.response || '';
      }

      return response.data.response || '';
    } catch (error: any) {
      if (error.code === 'ECONNREFUSED') {
        throw new Error('Ollama is not running. Please start Ollama first.');
      }
      console.error('Ollama API error:', error);
      throw new Error(`Ollama generation failed: ${error.message}`);
    }
  }

  async generateStream(
    prompt: string,
    model: string = 'llama3:8b',
    onChunk: (chunk: string) => void,
    systemPrompt?: string
  ): Promise<void> {
    try {
      const fullPrompt = systemPrompt ? `${systemPrompt}\n\n${prompt}` : prompt;

      const response = await this.client.post(
        '/api/generate',
        {
          model,
          prompt: fullPrompt,
          stream: true,
          options: {
            temperature: 0.7,
            num_predict: 200,
          },
        },
        {
          responseType: 'stream',
          timeout: 60000,
        }
      );

      response.data.on('data', (chunk: Buffer) => {
        const lines = chunk.toString().split('\n').filter((l) => l.trim());
        for (const line of lines) {
          try {
            const data = JSON.parse(line);
            if (data.response) {
              onChunk(data.response);
            }
          } catch (e) {
            // Ignore parse errors
          }
        }
      });
    } catch (error: any) {
      if (error.code === 'ECONNREFUSED') {
        throw new Error('Ollama is not running. Please start Ollama first.');
      }
      console.error('Ollama streaming error:', error);
      throw new Error(`Ollama streaming failed: ${error.message}`);
    }
  }

  parseModelString(modelString: string): { model: string; tag?: string } {
    // Parse "ollama://llama3:8b" or "llama3:8b"
    const match = modelString.match(/(?:ollama:\/\/)?(.+)/);
    if (match) {
      const parts = match[1].split(':');
      return {
        model: parts[0],
        tag: parts[1] || 'latest',
      };
    }
    return { model: modelString };
  }
}

