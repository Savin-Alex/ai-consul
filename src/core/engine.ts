import { LocalWhisper } from './audio/whisper-local';
import { CloudWhisper } from './audio/whisper-cloud';
import { LLMRouter } from './llm/router';
import { ContextManager } from './context/manager';
import { RAGEngine } from './context/rag-engine';
import { SecureDataFlow } from './security/privacy';
import { PromptBuilder } from './prompts/builder';
import { OutputValidator } from './prompts/validator';
import { VADProcessor } from './audio/vad';
// Load JSON at runtime using fs to avoid import path issues
import * as fs from 'fs';
import * as path from 'path';

const promptLibraryPath = path.join(__dirname, '../../ai_prompt_library_final_v2.1.json');
const promptLibrary = JSON.parse(fs.readFileSync(promptLibraryPath, 'utf-8'));

export interface EngineConfig {
  privacy: {
    offlineFirst: boolean;
    cloudFallback: boolean;
    dataRetention: number; // days
  };
  performance: {
    hardwareTier: 'basic' | 'standard' | 'pro' | 'auto-detect';
    latencyTarget: number; // milliseconds
    qualityPreference: 'speed' | 'quality' | 'balanced';
  };
  models: {
    transcription: {
      primary: 'local-whisper-tiny' | 'local-whisper-base' | 'cloud-whisper';
      fallback: 'cloud-whisper';
    };
    llm: {
      primary: string; // e.g., 'ollama://llama3:8b'
      fallbacks: string[]; // e.g., ['gpt-4o-mini', 'claude-3-haiku']
    };
  };
}

export interface SessionConfig {
  mode: 'job_interviews' | 'work_meetings' | 'education' | 'chat_messaging' | 'simulation_coaching';
  context?: {
    documents?: string[];
    skills?: string[];
    participants?: string[];
  };
  persona?: string;
  suggestions?: {
    types?: string[];
    timing?: 'post-question' | 'real-time';
  };
  coaching?: {
    metrics?: string[];
    feedback?: 'end-of-session' | 'real-time';
  };
}

export interface Suggestion {
  text: string;
  useCase?: string;
}

export class AIConsulEngine {
  private config: EngineConfig;
  private localWhisper: LocalWhisper;
  private cloudWhisper: CloudWhisper | null;
  private llmRouter: LLMRouter;
  private contextManager: ContextManager;
  private ragEngine: RAGEngine;
  private secureDataFlow: SecureDataFlow;
  private promptBuilder: PromptBuilder;
  private outputValidator: OutputValidator;
  private currentSession: SessionConfig | null = null;
  private isInitialized = false;
  private initializationPromise: Promise<void> | null = null;
  private vadProcessor: VADProcessor | null = null;

  constructor(config: EngineConfig) {
    this.config = config;
    this.localWhisper = new LocalWhisper();

    const wantsCloudTranscription =
      config.models.transcription.primary === 'cloud-whisper' ||
      config.models.transcription.fallback === 'cloud-whisper';
    const allowCloudFallback = config.privacy.cloudFallback || wantsCloudTranscription;

    if (allowCloudFallback) {
      try {
        this.cloudWhisper = new CloudWhisper();
      } catch (error) {
        console.warn(
          'Cloud Whisper initialization skipped:',
          error instanceof Error ? error.message : error
        );
        this.cloudWhisper = null;
      }
    } else {
      this.cloudWhisper = null;
    }
    this.llmRouter = new LLMRouter(config);
    this.contextManager = new ContextManager({
      maxTokens: 4000,
      summarization: {
        enabled: true,
        interval: 300000, // 5 minutes
      },
    });
    this.ragEngine = new RAGEngine();
    this.secureDataFlow = new SecureDataFlow(config.privacy);
    this.promptBuilder = new PromptBuilder(promptLibrary);
    this.outputValidator = new OutputValidator(promptLibrary);
  }

  async initialize(): Promise<void> {
    if (this.isInitialized) {
      return;
    }

    if (this.initializationPromise) {
      return this.initializationPromise;
    }

    this.initializationPromise = (async () => {
      try {
        console.log('Starting engine initialization...');

        console.log('Initializing RAG engine...');
        await this.ragEngine.initialize();
        console.log('RAG engine initialized');

        if (
          this.config.models.transcription.primary.startsWith('local-whisper')
        ) {
          const modelSize = this.config.models.transcription.primary.includes('base')
            ? 'base'
            : 'tiny';
          console.log(`Initializing Whisper model (model size: ${modelSize})...`);
          await this.localWhisper.initialize(modelSize);
          console.log('Whisper model initialized');
        }

        if (!this.vadProcessor) {
          console.log('[engine] Initializing VAD...');
          this.vadProcessor = new VADProcessor();
          await this.vadProcessor.isReady();
          console.log('[engine] VAD initialized');
        }

        this.isInitialized = true;
        console.log('Engine initialization complete');
      } catch (error) {
        console.error('Error during engine initialization:', error);
        throw error;
      } finally {
        this.initializationPromise = null;
      }
    })();

    return this.initializationPromise;
  }

  public getVADProcessor(): VADProcessor | null {
    return this.vadProcessor;
  }

  async transcribe(audioChunk: Float32Array<ArrayBufferLike>, sampleRate: number = 16000): Promise<string> {
    try {
      // Try primary transcription method
      if (
        this.config.models.transcription.primary.startsWith('local-whisper')
      ) {
        try {
          const transcript = await this.localWhisper.transcribe(audioChunk, sampleRate);
          if (transcript && transcript.trim().length > 0) {
            return transcript;
          }
          return '';
        } catch (error) {
          console.warn('Local Whisper transcription failed, attempting fallback if available.', error);
        }
      } else if (
        this.config.models.transcription.primary === 'cloud-whisper'
      ) {
        if (!this.cloudWhisper) {
          throw new Error('Cloud transcription is unavailable: missing API key');
        }
        return await this.cloudWhisper.transcribe(audioChunk);
      }

      // Fallback to cloud if enabled
      if (
        this.config.models.transcription.fallback === 'cloud-whisper' &&
        this.config.privacy.cloudFallback &&
        this.cloudWhisper
      ) {
        return await this.cloudWhisper.transcribe(audioChunk);
      }

      return '';
    } catch (error) {
      console.error('Transcription error:', error);
      throw error;
    }
  }

  async generateSuggestions(transcription: string): Promise<Suggestion[]> {
    const session = this.currentSession;

    if (!session) {
      console.warn('[engine] generateSuggestions called with no active session. Skipping.');
      return [];
    }

    // Add to context
    this.contextManager.addExchange({
      speaker: 'user',
      text: transcription,
      timestamp: Date.now(),
    });

    // Build prompt with mode awareness
    const prompt = this.promptBuilder.buildPrompt(
      session.mode as any, // Type assertion for mode compatibility
      this.contextManager.getContext(),
      this.ragEngine.getRelevantContext(transcription)
    );

    // Generate via LLM router
    const llmResponse = await this.llmRouter.generate(
      prompt.userPrompt,
      prompt.systemPrompt
    );

    // Validate output
    const validated = this.outputValidator.validate(
      llmResponse,
      session.mode as any // Type assertion for mode compatibility
    );

    return validated.suggestions.map((text) => ({
      text,
      useCase: validated.useCase,
    }));
  }

  async startSession(config: SessionConfig): Promise<void> {
    this.currentSession = config;

    if (this.vadProcessor) {
      this.vadProcessor.resetState();
    }

    if (config.context?.documents) {
      await this.ragEngine.loadDocuments(config.context.documents);
    }
  }

  stopSession(): void {
    this.currentSession = null;
    if (this.vadProcessor) {
      this.vadProcessor.resetState();
    }
    this.contextManager.clearExpiredData();
    this.secureDataFlow.cleanupSensitiveData();
  }

  getCurrentSession(): SessionConfig | null {
    return this.currentSession;
  }
}

