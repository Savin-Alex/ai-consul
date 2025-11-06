import { LocalWhisper } from './audio/whisper-local';
import { CloudWhisper } from './audio/whisper-cloud';
import { LLMRouter } from './llm/router';
import { ContextManager } from './context/manager';
import { RAGEngine } from './context/rag-engine';
import { SecureDataFlow } from './security/privacy';
import { PromptBuilder } from './prompts/builder';
import { OutputValidator } from './prompts/validator';
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
  private cloudWhisper: CloudWhisper;
  private llmRouter: LLMRouter;
  private contextManager: ContextManager;
  private ragEngine: RAGEngine;
  private secureDataFlow: SecureDataFlow;
  private promptBuilder: PromptBuilder;
  private outputValidator: OutputValidator;
  private currentSession: SessionConfig | null = null;
  private isInitialized = false;

  constructor(config: EngineConfig) {
    this.config = config;
    this.localWhisper = new LocalWhisper();
    this.cloudWhisper = new CloudWhisper();
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
      console.log('Engine already initialized');
      return;
    }

    try {
      console.log('Starting engine initialization...');
      
      // Initialize RAG engine (fast, synchronous)
      console.log('Initializing RAG engine...');
      await this.ragEngine.initialize();
      console.log('RAG engine initialized');

      // Initialize Whisper in background (can take time, especially first load)
      // Don't block on this - it will initialize when needed
      if (
        this.config.models.transcription.primary.startsWith('local-whisper')
      ) {
        const modelSize = this.config.models.transcription.primary.includes('base')
          ? 'base'
          : 'tiny';
        console.log(`Starting Whisper initialization in background (model size: ${modelSize})...`);
        // Initialize in background, don't wait
        this.localWhisper.initialize(modelSize).then(() => {
          console.log('Whisper initialized in background');
        }).catch((error) => {
          console.error('Whisper initialization failed (will retry when needed):', error);
        });
      }

      this.isInitialized = true;
      console.log('Engine initialization complete (Whisper loading in background)');
    } catch (error) {
      console.error('Error during engine initialization:', error);
      throw error;
    }
  }

  async transcribe(audioChunk: Float32Array): Promise<string> {
    try {
      // Try primary transcription method
      if (
        this.config.models.transcription.primary.startsWith('local-whisper')
      ) {
        const transcript = await this.localWhisper.transcribe(audioChunk);
        if (transcript) {
          return transcript;
        }
      }

      // Fallback to cloud if enabled
      if (
        this.config.models.transcription.fallback === 'cloud-whisper' &&
        this.config.privacy.cloudFallback
      ) {
        return await this.cloudWhisper.transcribe(audioChunk);
      }

      throw new Error('Transcription failed');
    } catch (error) {
      console.error('Transcription error:', error);
      throw error;
    }
  }

  async generateSuggestions(transcription: string): Promise<Suggestion[]> {
    if (!this.currentSession) {
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
      this.currentSession.mode as any, // Type assertion for mode compatibility
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
      this.currentSession.mode as any // Type assertion for mode compatibility
    );

    return validated.suggestions.map((text) => ({
      text,
      useCase: validated.useCase,
    }));
  }

  async startSession(config: SessionConfig): Promise<void> {
    this.currentSession = config;

    // Load RAG documents if provided
    if (config.context?.documents) {
      await this.ragEngine.loadDocuments(config.context.documents);
    }
  }

  stopSession(): void {
    this.currentSession = null;
    this.contextManager.clearExpiredData();
    this.secureDataFlow.cleanupSensitiveData();
  }

  getCurrentSession(): SessionConfig | null {
    return this.currentSession;
  }
}

