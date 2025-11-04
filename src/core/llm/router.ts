import { EngineConfig } from '../engine';
import { LocalLLM } from './local-llm';
import {
  OpenAIService,
  AnthropicService,
  GoogleAIService,
} from './cloud-llm';
import * as dotenv from 'dotenv';

dotenv.config();

export class LLMRouter {
  private config: EngineConfig;
  private localLLM: LocalLLM;
  private openAIService?: OpenAIService;
  private anthropicService?: AnthropicService;
  private googleAIService?: GoogleAIService;

  constructor(config: EngineConfig) {
    this.config = config;
    this.localLLM = new LocalLLM();

    // Initialize cloud services if API keys are available and cloud fallback is enabled
    if (config.privacy.cloudFallback) {
      if (process.env.OPENAI_API_KEY) {
        this.openAIService = new OpenAIService(process.env.OPENAI_API_KEY);
      }
      if (process.env.ANTHROPIC_API_KEY) {
        this.anthropicService = new AnthropicService(
          process.env.ANTHROPIC_API_KEY
        );
      }
      if (process.env.GOOGLE_API_KEY) {
        this.googleAIService = new GoogleAIService(process.env.GOOGLE_API_KEY);
      }
    }
  }

  async generate(
    prompt: string,
    systemPrompt?: string
  ): Promise<string> {
    // Try primary model first (local)
    try {
      const primaryModel = this.config.models.llm.primary;
      const parsed = this.localLLM.parseModelString(primaryModel);

      // Check if Ollama is available
      const isConnected = await this.localLLM.checkConnection();
      if (isConnected) {
        const modelAvailable = await this.localLLM.checkModelAvailable(
          `${parsed.model}:${parsed.tag || 'latest'}`
        );

        if (modelAvailable) {
          const response = await this.localLLM.generate(
            prompt,
            `${parsed.model}:${parsed.tag || 'latest'}`,
            systemPrompt
          );
          return response;
        }
      }
    } catch (error) {
      console.warn('Primary LLM failed, trying fallbacks:', error);
    }

    // Try fallbacks if cloud fallback is enabled
    if (this.config.privacy.cloudFallback) {
      for (const fallbackModel of this.config.models.llm.fallbacks) {
        try {
          let response: string;

          if (fallbackModel.startsWith('gpt-')) {
            if (!this.openAIService) {
              continue;
            }
            const result = await this.openAIService.generate(
              prompt,
              fallbackModel,
              systemPrompt
            );
            response = result.text;
          } else if (fallbackModel.startsWith('claude-')) {
            if (!this.anthropicService) {
              continue;
            }
            const result = await this.anthropicService.generate(
              prompt,
              fallbackModel,
              systemPrompt
            );
            response = result.text;
          } else if (fallbackModel.startsWith('gemini-')) {
            if (!this.googleAIService) {
              continue;
            }
            const result = await this.googleAIService.generate(
              prompt,
              fallbackModel,
              systemPrompt
            );
            response = result.text;
          } else {
            continue;
          }

          return response;
        } catch (error) {
          console.warn(`Fallback model ${fallbackModel} failed:`, error);
          continue;
        }
      }
    }

    throw new Error(
      'All LLM services failed. Please check your configuration and connection.'
    );
  }
}

