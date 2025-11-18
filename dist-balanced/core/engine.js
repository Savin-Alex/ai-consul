"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.AIConsulEngine = void 0;
const whisper_local_1 = require("./audio/whisper-local");
const whisper_cloud_1 = require("./audio/whisper-cloud");
const router_1 = require("./llm/router");
const manager_1 = require("./context/manager");
const rag_engine_1 = require("./context/rag-engine");
const privacy_1 = require("./security/privacy");
const builder_1 = require("./prompts/builder");
const validator_1 = require("./prompts/validator");
const vad_1 = require("./audio/vad");
const transcription_1 = require("./config/transcription");
// Load JSON at runtime using fs to avoid import path issues
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const promptLibraryPath = path.join(__dirname, '../../ai_prompt_library_final_v2.1.json');
const promptLibrary = JSON.parse(fs.readFileSync(promptLibraryPath, 'utf-8'));
class AIConsulEngine {
    config;
    transcriptionConfig;
    localWhisper = null;
    cloudWhisper = null;
    llmRouter;
    contextManager;
    ragEngine;
    secureDataFlow;
    promptBuilder;
    outputValidator;
    currentSession = null;
    isInitialized = false;
    initializationPromise = null;
    vadProcessor = null;
    constructor(config) {
        this.config = config;
        this.transcriptionConfig = (0, transcription_1.resolveTranscriptionConfig)({
            mode: config.transcriptionPriority?.mode,
            privacyMode: config.transcriptionPriority?.privacyMode ?? (config.privacy.offlineFirst && !config.privacy.cloudFallback),
            allowCloud: config.transcriptionPriority?.allowCloud ??
                (config.privacy.cloudFallback || config.models.transcription.fallback === 'cloud-whisper'),
            allowLocal: config.transcriptionPriority?.allowLocal ?? true,
            localTimeoutMs: config.transcriptionPriority?.localTimeoutMs,
            cloudTimeoutMs: config.transcriptionPriority?.cloudTimeoutMs,
            costLimitUsd: config.transcriptionPriority?.costLimitUsd,
            failoverOrder: config.transcriptionPriority?.failoverOrder,
        });
        const wantsCloud = config.models.transcription.primary === 'cloud-whisper' ||
            config.models.transcription.fallback === 'cloud-whisper' ||
            this.transcriptionConfig.allowCloud;
        if (wantsCloud && this.transcriptionConfig.allowCloud) {
            try {
                this.cloudWhisper = new whisper_cloud_1.CloudWhisper();
            }
            catch (error) {
                console.warn('Cloud Whisper initialization skipped:', error instanceof Error ? error.message : error);
                this.cloudWhisper = null;
            }
        }
        this.llmRouter = new router_1.LLMRouter(config);
        this.contextManager = new manager_1.ContextManager({
            maxTokens: 4000,
            summarization: {
                enabled: true,
                interval: 300000, // 5 minutes
            },
        });
        this.ragEngine = new rag_engine_1.RAGEngine();
        this.secureDataFlow = new privacy_1.SecureDataFlow(config.privacy);
        this.promptBuilder = new builder_1.PromptBuilder(promptLibrary);
        this.outputValidator = new validator_1.OutputValidator(promptLibrary);
    }
    async initialize() {
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
                if (this.transcriptionConfig.allowLocal) {
                    let modelSize = 'tiny';
                    if (this.config.models.transcription.primary.includes('small')) {
                        modelSize = 'small';
                    }
                    else if (this.config.models.transcription.primary.includes('base')) {
                        modelSize = 'base';
                    }
                    console.log(`Initializing Whisper model (model size: ${modelSize})...`);
                    await this.getLocalWhisper().initialize(modelSize);
                    console.log('Whisper model initialized');
                }
                if (!this.vadProcessor) {
                    console.log('[engine] Initializing VAD...');
                    this.vadProcessor = new vad_1.VADProcessor();
                    await this.vadProcessor.isReady();
                    console.log('[engine] VAD initialized');
                }
                this.isInitialized = true;
                console.log('Engine initialization complete');
            }
            catch (error) {
                console.error('Error during engine initialization:', error);
                throw error;
            }
            finally {
                this.initializationPromise = null;
            }
        })();
        return this.initializationPromise;
    }
    getVADProcessor() {
        return this.vadProcessor;
    }
    async transcribe(audioChunk, sampleRate = 16000) {
        let lastError = null;
        for (const engineKey of this.transcriptionConfig.failoverOrder) {
            if (!this.isEngineAllowed(engineKey)) {
                continue;
            }
            try {
                const timeout = this.getTimeoutForEngine(engineKey);
                const result = await this.withTimeout(this.transcribeWithEngine(engineKey, audioChunk, sampleRate), timeout);
                if (typeof result === 'string') {
                    if (result.trim().length > 0) {
                        return result;
                    }
                    return '';
                }
                if (result && typeof result === 'object') {
                    return result;
                }
            }
            catch (error) {
                console.warn(`[engine] ${engineKey} transcription failed:`, error);
                if (error instanceof Error) {
                    lastError = error;
                }
                else {
                    lastError = new Error(String(error));
                }
            }
        }
        if (lastError) {
            throw lastError;
        }
        throw new Error('All transcription engines failed or are unavailable');
    }
    async generateSuggestions(transcription) {
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
        const prompt = this.promptBuilder.buildPrompt(session.mode, // Type assertion for mode compatibility
        this.contextManager.getContext(), this.ragEngine.getRelevantContext(transcription));
        // Generate via LLM router
        const llmResponse = await this.llmRouter.generate(prompt.userPrompt, prompt.systemPrompt);
        // Validate output
        const validated = this.outputValidator.validate(llmResponse, session.mode // Type assertion for mode compatibility
        );
        return validated.suggestions.map((text) => ({
            text,
            useCase: validated.useCase,
        }));
    }
    async transcribeWithEngine(engineKey, audioChunk, sampleRate) {
        switch (engineKey) {
            case 'local-whisper':
                return this.getLocalWhisper().transcribe(audioChunk, sampleRate);
            case 'cloud-assembly':
            case 'cloud-deepgram':
                return this.getCloudWhisper().transcribe(audioChunk);
            default:
                throw new Error(`Transcription engine "${engineKey}" not implemented`);
        }
    }
    isEngineAllowed(engineKey) {
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
    getTimeoutForEngine(engineKey) {
        const isCloud = engineKey.startsWith('cloud');
        return isCloud ? this.transcriptionConfig.cloudTimeoutMs : this.transcriptionConfig.localTimeoutMs;
    }
    async withTimeout(promise, timeoutMs) {
        if (timeoutMs <= 0 || Number.isNaN(timeoutMs)) {
            return promise;
        }
        const timeoutPromise = new Promise((_, reject) => setTimeout(() => reject(new Error(`Timeout after ${timeoutMs}ms`)), timeoutMs));
        return Promise.race([promise, timeoutPromise]);
    }
    async startSession(config) {
        this.currentSession = config;
        if (this.vadProcessor) {
            this.vadProcessor.resetState();
        }
        if (config.context?.documents) {
            await this.ragEngine.loadDocuments(config.context.documents);
        }
    }
    stopSession() {
        this.currentSession = null;
        if (this.vadProcessor) {
            this.vadProcessor.resetState();
        }
        this.contextManager.clearExpiredData();
        this.secureDataFlow.cleanupSensitiveData();
    }
    getCurrentSession() {
        return this.currentSession;
    }
    getTranscriptionConfig() {
        return this.transcriptionConfig;
    }
    getLocalWhisper() {
        if (!this.localWhisper) {
            this.localWhisper = new whisper_local_1.LocalWhisper();
        }
        return this.localWhisper;
    }
    getCloudWhisper() {
        if (!this.cloudWhisper) {
            this.cloudWhisper = new whisper_cloud_1.CloudWhisper();
        }
        return this.cloudWhisper;
    }
}
exports.AIConsulEngine = AIConsulEngine;
