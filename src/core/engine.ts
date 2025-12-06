import { EventEmitter } from 'events';
import { LocalWhisper } from './audio/whisper-local';
import { CloudWhisper } from './audio/whisper-cloud';
import { AssemblyAIStreaming } from './audio/assemblyai-streaming';
import { DeepgramStreaming } from './audio/deepgram-streaming';
import { LLMRouter } from './llm/router';
import { ContextManager } from './context/manager';
import { RAGEngine } from './context/rag-engine';
import { SecureDataFlow } from './security/privacy';
import { PromptBuilder } from './prompts/builder';
import { OutputValidator } from './prompts/validator';
import { VADProcessor } from './audio/vad';
import { resolveTranscriptionConfig, TranscriptionPriorityConfig } from './config/transcription';
// Load JSON at runtime using fs to avoid import path issues
import * as fs from 'fs/promises';
import * as path from 'path';
import { existsSync } from 'fs';

let promptLibrary: any = null;
let promptLibraryLoadPromise: Promise<any> | null = null;

/**
 * Load prompt library with validation and error handling
 * Uses async file operations to avoid blocking event loop
 */
async function loadPromptLibrary(): Promise<any> {
  if (promptLibrary) {
    return promptLibrary;
  }

  if (promptLibraryLoadPromise) {
    return promptLibraryLoadPromise;
  }

  promptLibraryLoadPromise = (async () => {
    try {
      // Resolve path safely
      const promptLibraryPath = path.resolve(__dirname, '../../ai_prompt_library_final_v2.1.json');
      
      // Validate path is within expected directory (security check)
      const expectedDir = path.resolve(__dirname, '../../');
      const resolvedPath = path.resolve(promptLibraryPath);
      if (!resolvedPath.startsWith(expectedDir)) {
        throw new Error(`Invalid prompt library path: ${promptLibraryPath}`);
      }

      // Check if file exists
      if (!existsSync(resolvedPath)) {
        throw new Error(`Prompt library not found at ${resolvedPath}`);
      }

      // Read file asynchronously
      const fileContent = await fs.readFile(resolvedPath, 'utf-8');
      
      // Parse JSON with error handling
      try {
        promptLibrary = JSON.parse(fileContent);
        return promptLibrary;
      } catch (parseError) {
        throw new Error(`Failed to parse prompt library JSON: ${parseError instanceof Error ? parseError.message : String(parseError)}`);
      }
    } catch (error) {
      promptLibraryLoadPromise = null; // Reset on error
      console.error('Failed to load prompt library:', error);
      throw error;
    }
  })();

  return promptLibraryLoadPromise;
}

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
      primary: 'local-whisper-tiny' | 'local-whisper-base' | 'local-whisper-small' | 'cloud-whisper';
      fallback: 'cloud-whisper';
      mode?: 'batch' | 'streaming'; // Transcription mode
      streaming?: {
        windowSize?: number;
        stepSize?: number;
        overlapRatio?: number;
      };
    };
    llm: {
      primary: string; // e.g., 'ollama://llama3:8b'
      fallbacks: string[]; // e.g., ['gpt-4o-mini', 'claude-3-haiku']
    };
  };
  transcriptionPriority?: Partial<TranscriptionPriorityConfig>;
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

export class AIConsulEngine extends EventEmitter {
  private config: EngineConfig;
  private transcriptionConfig: TranscriptionPriorityConfig;
  private localWhisper: LocalWhisper | null = null;
  private cloudWhisper: CloudWhisper | null = null;
  private assemblyAIStreaming: AssemblyAIStreaming | null = null;
  private deepgramStreaming: DeepgramStreaming | null = null;
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
    super();
    this.config = config;
    this.transcriptionConfig = resolveTranscriptionConfig({
      mode: config.transcriptionPriority?.mode,
      privacyMode: config.transcriptionPriority?.privacyMode ?? (config.privacy.offlineFirst && !config.privacy.cloudFallback),
      allowCloud:
        config.transcriptionPriority?.allowCloud ??
        (config.privacy.cloudFallback || config.models.transcription.fallback === 'cloud-whisper'),
      allowLocal: config.transcriptionPriority?.allowLocal ?? true,
      localTimeoutMs: config.transcriptionPriority?.localTimeoutMs,
      cloudTimeoutMs: config.transcriptionPriority?.cloudTimeoutMs,
      costLimitUsd: config.transcriptionPriority?.costLimitUsd,
      failoverOrder: config.transcriptionPriority?.failoverOrder,
    });
    const wantsCloud =
      config.models.transcription.primary === 'cloud-whisper' ||
      config.models.transcription.fallback === 'cloud-whisper' ||
      this.transcriptionConfig.allowCloud;
    if (wantsCloud && this.transcriptionConfig.allowCloud) {
      try {
        this.cloudWhisper = new CloudWhisper();
      } catch (error) {
        console.warn(
          'Cloud Whisper initialization skipped:',
          error instanceof Error ? error.message : error
        );
        this.cloudWhisper = null;
      }
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
    // Prompt library will be loaded asynchronously during initialize()
    // Initialize with null - library will be set in initialize()
    this.promptBuilder = new PromptBuilder(null);
    this.outputValidator = new OutputValidator(null);
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

        // Load prompt library first (required for promptBuilder and outputValidator)
        console.log('Loading prompt library...');
        const library = await loadPromptLibrary();
        this.promptBuilder.setLibrary(library);
        this.outputValidator.setLibrary(library);
        console.log('Prompt library loaded');

        console.log('Initializing RAG engine...');
        await this.ragEngine.initialize();
        console.log('RAG engine initialized');

    if (this.transcriptionConfig.allowLocal) {
          let modelSize: 'tiny' | 'base' | 'small' = 'tiny';
          if (this.config.models.transcription.primary.includes('small')) {
            modelSize = 'small';
          } else if (this.config.models.transcription.primary.includes('base')) {
            modelSize = 'base';
          }
          console.log(`Initializing Whisper model (model size: ${modelSize})...`);
      await this.getLocalWhisper().initialize(modelSize);
          console.log('Whisper model initialized');
        }

        if (!this.vadProcessor) {
          console.log('[engine] Initializing VAD...');
          const vadProvider = this.transcriptionConfig.vadProvider || 'default';
          this.vadProcessor = new VADProcessor(vadProvider);
          try {
            await this.vadProcessor.isReady();
            const providerName = this.vadProcessor.getProviderName ? this.vadProcessor.getProviderName() : vadProvider;
            console.log(`[engine] VAD initialized (provider: ${providerName})`);
          } catch (error) {
            // VAD initialization failed, but we can continue without it
            // The VADProcessor should have already fallen back to default
            console.warn('[engine] VAD initialization had issues, but continuing with available provider');
            const providerName = this.vadProcessor.getProviderName ? this.vadProcessor.getProviderName() : 'default';
            console.log(`[engine] Using VAD provider: ${providerName}`);
          }
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
    let lastError: Error | null = null;
    for (const engineKey of this.transcriptionConfig.failoverOrder) {
      if (!this.isEngineAllowed(engineKey)) {
        continue;
      }
      try {
        const timeout = this.getTimeoutForEngine(engineKey);
        const result = await this.withTimeout(
          this.transcribeWithEngine(engineKey, audioChunk, sampleRate),
          timeout,
        );
        if (typeof result === 'string') {
          if (result.trim().length > 0) {
            return result;
          }
          return '';
        }
        // If result is an object (shouldn't happen, but handle gracefully)
        // Type assertion needed because transcribeWithEngine returns Promise<string>
        // but some engines might return objects in error cases
        const resultAsAny = result as any;
        if (resultAsAny && typeof resultAsAny === 'object') {
          console.warn(`[engine] Unexpected object result from ${engineKey}, attempting to extract text`);
          // Try to extract text property if it exists
          if ('text' in resultAsAny && typeof resultAsAny.text === 'string') {
            return resultAsAny.text;
          }
          // If it's a StreamingTranscript-like object, extract text
          if ('text' in resultAsAny) {
            return String(resultAsAny.text);
          }
          // Last resort: stringify the object (shouldn't happen in normal flow)
          console.error(`[engine] Cannot extract text from object result:`, resultAsAny);
          continue; // Try next engine
        }
      } catch (error) {
        console.warn(`[engine] ${engineKey} transcription failed:`, error);
        if (error instanceof Error) {
          lastError = error;
        } else {
          lastError = new Error(String(error));
        }
      }
    }

    if (lastError) {
      throw lastError;
    }

    throw new Error('All transcription engines failed or are unavailable');
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
    // Validate mode is supported
    const supportedModes: SessionConfig['mode'][] = [
      'job_interviews',
      'work_meetings',
      'education',
      'chat_messaging',
      'simulation_coaching',
    ];
    
    if (!supportedModes.includes(session.mode)) {
      throw new Error(`Unsupported session mode: ${session.mode}`);
    }
    
    // Type-safe mode conversion
    const promptMode: 'education' | 'work_meetings' | 'job_interviews' | 'chat_messaging' | 'simulation_coaching' = 
      session.mode as 'education' | 'work_meetings' | 'job_interviews' | 'chat_messaging' | 'simulation_coaching';
    
    const prompt = this.promptBuilder.buildPrompt(
      promptMode,
      this.contextManager.getContext(),
      await this.ragEngine.getRelevantContext(transcription)
    );

    // Generate via LLM router
    const llmResponse = await this.llmRouter.generate(
      prompt.userPrompt,
      prompt.systemPrompt
    );

    // Validate output
    const validated = this.outputValidator.validate(
      llmResponse,
      promptMode
    );

    return validated.suggestions.map((text) => ({
      text,
      useCase: validated.useCase,
    }));
  }

  private async transcribeWithEngine(
    engineKey: TranscriptionPriorityConfig['failoverOrder'][number],
    audioChunk: Float32Array<ArrayBufferLike>,
    sampleRate: number,
  ): Promise<string> {
    switch (engineKey) {
      case 'local-whisper':
        return this.getLocalWhisper().transcribe(audioChunk, sampleRate);
      case 'cloud-assembly':
        return this.transcribeWithAssemblyAI(audioChunk, sampleRate);
      case 'cloud-deepgram':
        return this.transcribeWithDeepgram(audioChunk, sampleRate);
      default:
        // Fallback to OpenAI Whisper batch API
        return this.getCloudWhisper().transcribe(audioChunk);
    }
  }

  private async transcribeWithAssemblyAI(
    audioChunk: Float32Array,
    sampleRate: number
  ): Promise<string> {
    if (!this.assemblyAIStreaming) {
      try {
        this.assemblyAIStreaming = new AssemblyAIStreaming();
        await this.assemblyAIStreaming.connect();
        
        // Setup event handlers for streaming transcripts
        this.assemblyAIStreaming.on('final', (transcript) => {
          this.emit('streaming-transcript-final', transcript);
        });
        
        this.assemblyAIStreaming.on('interim', (transcript) => {
          this.emit('streaming-transcript-interim', transcript);
        });
      } catch (error) {
        console.error('[engine] Failed to initialize AssemblyAI streaming:', error);
        throw new Error(`AssemblyAI streaming not available: ${error instanceof Error ? error.message : String(error)}`);
      }
    }

    if (!this.assemblyAIStreaming.getIsConnected()) {
      await this.assemblyAIStreaming.connect();
    }

    // For batch API compatibility, use transcribe method
    // For true streaming, use sendAudio and handle events
    return this.assemblyAIStreaming.transcribe(audioChunk, sampleRate);
  }

  private async transcribeWithDeepgram(
    audioChunk: Float32Array,
    sampleRate: number
  ): Promise<string> {
    if (!this.deepgramStreaming) {
      try {
        this.deepgramStreaming = new DeepgramStreaming();
        await this.deepgramStreaming.connect();
        
        // Setup event handlers for streaming transcripts
        this.deepgramStreaming.on('final', (transcript) => {
          this.emit('streaming-transcript-final', transcript);
        });
        
        this.deepgramStreaming.on('interim', (transcript) => {
          this.emit('streaming-transcript-interim', transcript);
        });
      } catch (error) {
        console.error('[engine] Failed to initialize Deepgram streaming:', error);
        throw new Error(`Deepgram streaming not available: ${error instanceof Error ? error.message : String(error)}`);
      }
    }

    if (!this.deepgramStreaming.getIsConnected()) {
      await this.deepgramStreaming.connect();
    }

    // For batch API compatibility, use transcribe method
    // For true streaming, use sendAudio and handle events
    return this.deepgramStreaming.transcribe(audioChunk, sampleRate);
  }

  private isEngineAllowed(engineKey: TranscriptionPriorityConfig['failoverOrder'][number]): boolean {
    if (!this.transcriptionConfig.allowCloud && engineKey.startsWith('cloud')) {
      return false;
    }
    if (!this.transcriptionConfig.allowLocal && engineKey.startsWith('local')) {
      return false;
    }
    if ((engineKey === 'cloud-assembly' || engineKey === 'cloud-deepgram') && !this.transcriptionConfig.allowCloud) {
      return false;
    }
    if (engineKey === 'cloud-assembly' || engineKey === 'cloud-deepgram') {
      return true;
    }
    if (engineKey === 'local-onnx') {
      return false; // Placeholder until ONNX pipeline is implemented
    }
    return true;
  }

  private getTimeoutForEngine(engineKey: TranscriptionPriorityConfig['failoverOrder'][number]): number {
    const isCloud = engineKey.startsWith('cloud');
    return isCloud ? this.transcriptionConfig.cloudTimeoutMs : this.transcriptionConfig.localTimeoutMs;
  }

  private async withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
    if (timeoutMs <= 0 || Number.isNaN(timeoutMs)) {
      return promise;
    }
    const timeoutPromise = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error(`Timeout after ${timeoutMs}ms`)), timeoutMs),
    );
    return Promise.race([promise, timeoutPromise]);
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
    
    // Cleanup streaming connections
    this.cleanupStreamingConnections();
  }

  /**
   * Cleanup streaming connections
   */
  private async cleanupStreamingConnections(): Promise<void> {
    if (this.assemblyAIStreaming) {
      try {
        await this.assemblyAIStreaming.disconnect();
      } catch (error) {
        console.error('[engine] Error disconnecting AssemblyAI:', error);
      }
      this.assemblyAIStreaming = null;
    }
    
    if (this.deepgramStreaming) {
      try {
        await this.deepgramStreaming.disconnect();
      } catch (error) {
        console.error('[engine] Error disconnecting Deepgram:', error);
      }
      this.deepgramStreaming = null;
    }
  }

  getCurrentSession(): SessionConfig | null {
    return this.currentSession;
  }

  getTranscriptionConfig(): TranscriptionPriorityConfig {
    return this.transcriptionConfig;
  }

  getConfig(): EngineConfig {
    return this.config;
  }

  private getLocalWhisper(): LocalWhisper {
    if (!this.localWhisper) {
      this.localWhisper = new LocalWhisper();
    }
    return this.localWhisper;
  }

  private getCloudWhisper(): CloudWhisper {
    if (!this.cloudWhisper) {
      this.cloudWhisper = new CloudWhisper();
    }
    return this.cloudWhisper;
  }
}

