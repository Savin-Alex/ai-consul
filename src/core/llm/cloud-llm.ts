import axios, { AxiosInstance } from 'axios';

export interface LLMResponse {
  text: string;
  usage?: {
    promptTokens: number;
    completionTokens: number;
  };
}

export class OpenAIService {
  private apiKey: string;
  private client: AxiosInstance;

  constructor(apiKey: string) {
    this.apiKey = apiKey;
    this.client = axios.create({
      baseURL: 'https://api.openai.com/v1',
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
      },
    });
  }

  async generate(
    prompt: string,
    model: string = 'gpt-4o-mini',
    systemPrompt?: string
  ): Promise<LLMResponse> {
    try {
      const messages = [];
      if (systemPrompt) {
        messages.push({ role: 'system', content: systemPrompt });
      }
      messages.push({ role: 'user', content: prompt });

      const response = await this.client.post('/chat/completions', {
        model,
        messages,
        temperature: 0.7,
        max_tokens: 200,
      });

      return {
        text: response.data.choices[0].message.content,
        usage: {
          promptTokens: response.data.usage.prompt_tokens,
          completionTokens: response.data.usage.completion_tokens,
        },
      };
    } catch (error) {
      console.error('OpenAI API error:', error);
      throw new Error('OpenAI API request failed');
    }
  }
}

export class AnthropicService {
  private apiKey: string;
  private client: AxiosInstance;

  constructor(apiKey: string) {
    this.apiKey = apiKey;
    this.client = axios.create({
      baseURL: 'https://api.anthropic.com/v1',
      headers: {
        'x-api-key': this.apiKey,
        'anthropic-version': '2023-06-01',
        'Content-Type': 'application/json',
      },
    });
  }

  async generate(
    prompt: string,
    model: string = 'claude-3-haiku-20240307',
    systemPrompt?: string
  ): Promise<LLMResponse> {
    try {
      const messages = [{ role: 'user', content: prompt }];

      const response = await this.client.post('/messages', {
        model,
        max_tokens: 200,
        system: systemPrompt,
        messages,
      });

      return {
        text: response.data.content[0].text,
        usage: {
          promptTokens: response.data.usage.input_tokens,
          completionTokens: response.data.usage.output_tokens,
        },
      };
    } catch (error) {
      console.error('Anthropic API error:', error);
      throw new Error('Anthropic API request failed');
    }
  }
}

export class GoogleAIService {
  private apiKey: string;
  private client: AxiosInstance;

  constructor(apiKey: string) {
    this.apiKey = apiKey;
    this.client = axios.create({
      baseURL: 'https://generativelanguage.googleapis.com/v1beta',
      params: {
        key: this.apiKey,
      },
    });
  }

  async generate(
    prompt: string,
    model: string = 'gemini-pro',
    systemPrompt?: string
  ): Promise<LLMResponse> {
    try {
      const fullPrompt = systemPrompt ? `${systemPrompt}\n\n${prompt}` : prompt;

      const response = await this.client.post(
        `/models/${model}:generateContent`,
        {
          contents: [
            {
              parts: [{ text: fullPrompt }],
            },
          ],
          generationConfig: {
            temperature: 0.7,
            maxOutputTokens: 200,
          },
        }
      );

      return {
        text: response.data.candidates[0].content.parts[0].text,
      };
    } catch (error) {
      console.error('Google AI API error:', error);
      throw new Error('Google AI API request failed');
    }
  }
}

