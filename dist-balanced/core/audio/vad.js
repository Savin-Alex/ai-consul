"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.VADProcessor = void 0;
const transformers_1 = require("./transformers");
class VADProcessor {
    vad = null;
    isInitialized = false;
    initializationPromise = null;
    initializationError = null;
    speechDetected = false;
    accumulatedSilenceMs = 0;
    silenceChunkCount = 0;
    sampleRate = 16000;
    minSilenceDurationMs = 1200;
    speechThreshold = 0.5;
    energyThreshold = 0.01;
    speechConfidenceThreshold = 0.25;
    pauseDelayChunks = 10;
    constructor() {
        this.initializationPromise = this.initialize();
    }
    async initialize() {
        const { pipeline: pipelineFn } = await (0, transformers_1.loadTransformers)();
        if (this.isInitialized) {
            return;
        }
        this.initializationError = null;
        try {
            console.log('[VAD] Initializing speech-commands VAD model...');
            this.vad = await pipelineFn('audio-classification', 'Xenova/ast-finetuned-speech-commands-v2', {
                quantized: true,
                use_cache: false,
            });
            this.isInitialized = true;
            console.log('[VAD] Speech-commands VAD initialized');
        }
        catch (error) {
            const wrapped = this.normalizeInitializationError(error);
            this.initializationError = wrapped;
            console.error('[VAD] Failed to initialize VAD model:', wrapped);
            throw wrapped;
        }
        finally {
            this.initializationPromise = null;
        }
    }
    async isReady() {
        if (this.initializationError) {
            throw this.initializationError;
        }
        if (this.isInitialized) {
            return;
        }
        if (!this.initializationPromise) {
            this.initializationPromise = this.initialize();
        }
        return this.initializationPromise;
    }
    resetState() {
        if (!this.isInitialized || this.initializationError) {
            return;
        }
        this.speechDetected = false;
        this.accumulatedSilenceMs = 0;
        this.silenceChunkCount = 0;
        if (process.env.DEBUG_AUDIO === 'true') {
            console.log('[VAD] State reset');
        }
    }
    async process(audioChunk, maxAmplitude) {
        if (!audioChunk || audioChunk.length === 0) {
            if (process.env.DEBUG_AUDIO === 'true') {
                console.warn('[VAD] Received empty audio chunk, skipping.');
            }
            return { speech: false, pause: false };
        }
        if (this.initializationError) {
            throw this.initializationError;
        }
        if (!this.isInitialized) {
            await this.isReady();
        }
        if (!this.vad) {
            console.warn('[VAD] Processor unavailable');
            return { speech: false, pause: false };
        }
        try {
            const results = await this.vad(audioChunk, { topk: null });
            const outputs = Array.isArray(results) ? results : [results];
            let silenceScore = 0;
            let speechScore = 0;
            let topResult = null;
            for (const item of outputs) {
                if (!item || typeof item !== 'object')
                    continue;
                const rawLabel = typeof item.label === 'string' ? item.label : '';
                const label = rawLabel.toLowerCase();
                const score = typeof item.score === 'number' ? item.score : 0;
                if (!topResult || score > topResult.score) {
                    topResult = { label: rawLabel, score };
                }
                if (rawLabel === '_unknown_' || label.includes('unknown')) {
                    silenceScore = Math.max(silenceScore, score);
                }
                else {
                    speechScore = Math.max(speechScore, score);
                }
            }
            const topLabel = topResult?.label ?? '';
            const topScore = topResult?.score ?? 0;
            const isUnknownTop = topLabel === '_unknown_' || topLabel.toLowerCase().includes('unknown');
            const energyLevel = typeof maxAmplitude === 'number' ? maxAmplitude : this.computeMaxAmplitude(audioChunk);
            const meetsEnergy = energyLevel >= this.energyThreshold;
            const meetsConfidence = topScore >= this.speechConfidenceThreshold;
            const isSpeech = meetsEnergy && meetsConfidence && !isUnknownTop;
            const chunkDurationMs = (audioChunk.length / this.sampleRate) * 1000;
            let pauseDetected = false;
            if (isSpeech) {
                this.speechDetected = true;
                this.accumulatedSilenceMs = 0;
                this.silenceChunkCount = 0;
            }
            else if (this.speechDetected) {
                this.accumulatedSilenceMs += chunkDurationMs;
                this.silenceChunkCount += 1;
                if (this.accumulatedSilenceMs >= this.minSilenceDurationMs) {
                    pauseDetected = true;
                    this.speechDetected = false;
                    this.accumulatedSilenceMs = 0;
                    this.silenceChunkCount = 0;
                }
                else if (this.silenceChunkCount >= this.pauseDelayChunks) {
                    pauseDetected = true;
                    this.speechDetected = false;
                    this.accumulatedSilenceMs = 0;
                    this.silenceChunkCount = 0;
                }
            }
            const speechActive = isSpeech || this.speechDetected;
            if (process.env.DEBUG_AUDIO === 'true') {
                const topLabel = topResult
                    ? `${topResult.label} (${topResult.score.toFixed(2)})`
                    : 'n/a';
                console.log('[VAD] scores:', {
                    top: topLabel,
                    silenceScore: silenceScore.toFixed(2),
                    speechScore: speechScore.toFixed(2),
                    energy: energyLevel.toFixed(4),
                    meetsEnergy,
                    topScore: topScore.toFixed(2),
                    meetsConfidence,
                    isUnknownTop,
                    isSpeech,
                    speechActive,
                    pauseDetected,
                });
            }
            return {
                speech: speechActive,
                pause: pauseDetected,
            };
        }
        catch (error) {
            console.error('[VAD] Error processing audio chunk:', error);
            return { speech: false, pause: false };
        }
    }
    normalizeInitializationError(error) {
        if (error instanceof Error) {
            if (error.message.includes('Unauthorized access to file')) {
                const hint = 'Ensure the application can access Hugging Face to download the Xenova/ast-finetuned-speech-commands-v2 assets.';
                return new Error(`${error.message} ${hint}`);
            }
            return error;
        }
        return new Error('Unknown error during VAD initialization');
    }
    computeMaxAmplitude(buffer) {
        let max = 0;
        for (let i = 0; i < buffer.length; i++) {
            const value = Math.abs(buffer[i]);
            if (value > max) {
                max = value;
            }
        }
        return max;
    }
}
exports.VADProcessor = VADProcessor;
