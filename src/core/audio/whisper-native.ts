/**
 * WhisperNative - @fugood/whisper.node wrapper
 * 
 * High-performance native addon for Whisper transcription
 * - Direct PCM buffer input (no file I/O)
 * - GPU acceleration (Metal/CUDA/Vulkan)
 * - Lower latency than child process approach
 */

import { initWhisper, WhisperContext } from '@fugood/whisper.node';
import { EventEmitter } from 'events';
import * as path from 'path';
import * as fs from 'fs';
import { app } from 'electron';

export interface WhisperNativeConfig {
  modelPath?: string;
  modelSize?: 'tiny' | 'base' | 'small' | 'medium' | 'large';
  language?: string;
  useGpu?: boolean;
  libVariant?: 'default' | 'vulkan' | 'cuda';
  temperature?: number;
}

export interface TranscriptionResult {
  text: string;
  segments?: Array<{
    start: number;
    end: number;
    text: string;
  }>;
}

export class WhisperNative extends EventEmitter {
  private context: WhisperContext | null = null;
  private config: Required<Omit<WhisperNativeConfig, 'modelPath'>> & { modelPath?: string };
  private isInitialized = false;
  private initializationPromise: Promise<void> | null = null;
  private currentTranscription: { stop: () => Promise<void> } | null = null;

  constructor(config: WhisperNativeConfig = {}) {
    super();
    
    this.config = {
      modelSize: 'base',
      language: 'en',
      useGpu: true,
      libVariant: 'default',
      temperature: 0.0,
      modelPath: config.modelPath,
      ...config,
    };
  }

  /**
   * Initialize whisper.cpp context
   */
  async initialize(): Promise<void> {
    if (this.isInitialized) {
      return;
    }

    if (this.initializationPromise) {
      return this.initializationPromise;
    }

    this.initializationPromise = (async () => {
      try {
        const modelPath = this.config.modelPath || this.getDefaultModelPath();
        
        if (!fs.existsSync(modelPath)) {
          throw new Error(
            `Whisper model not found: ${modelPath}\n` +
            'Run: pnpm run download-models'
          );
        }

        console.log(`[WhisperNative] Loading model: ${modelPath}`);
        console.log(`[WhisperNative] GPU: ${this.config.useGpu}, Variant: ${this.config.libVariant}`);

        this.context = await initWhisper(
          {
            model: modelPath,
            useGpu: this.config.useGpu,
          },
          this.config.libVariant
        );

        this.isInitialized = true;
        console.log('[WhisperNative] Model loaded successfully');
        this.emit('initialized');
      } catch (error) {
        console.error('[WhisperNative] Initialization failed:', error);
        this.emit('error', error);
        throw error;
      } finally {
        this.initializationPromise = null;
      }
    })();

    return this.initializationPromise;
  }

  /**
   * Get default model path based on model size
   */
  private getDefaultModelPath(): string {
    const modelName = `ggml-${this.config.modelSize}.en.bin`;
    
    const possiblePaths = [
      // Electron app path
      path.join(app.getAppPath(), 'models', 'whisper', modelName),
      // Development paths
      path.join(process.cwd(), 'models', 'whisper', modelName),
      path.join(__dirname, '../../models/whisper', modelName),
      // User home cache
      path.join(require('os').homedir(), '.cache', 'ai-consul', 'models', 'whisper', modelName),
    ];

    for (const modelPath of possiblePaths) {
      if (fs.existsSync(modelPath)) {
        return modelPath;
      }
    }

    // Return first path as suggestion
    return possiblePaths[0];
  }

  /**
   * Transcribe audio buffer (Int16Array or ArrayBuffer)
   * @param audioBuffer - PCM 16-bit, mono, 16kHz audio data
   * @param options - Transcription options
   */
  async transcribe(
    audioBuffer: ArrayBuffer | Int16Array,
    options?: {
      language?: string;
      temperature?: number;
      translate?: boolean;
    }
  ): Promise<TranscriptionResult> {
    if (!this.context || !this.isInitialized) {
      await this.initialize();
    } else if (this.initializationPromise) {
      await this.initializationPromise;
    }

    if (!this.context) {
      throw new Error('WhisperNative not initialized');
    }

    // Convert Int16Array to ArrayBuffer if needed
    const buffer = audioBuffer instanceof Int16Array 
      ? audioBuffer.buffer 
      : audioBuffer;

    if (buffer.byteLength === 0) {
      return { text: '' };
    }

    try {
      // Cancel any ongoing transcription
      if (this.currentTranscription) {
        await this.currentTranscription.stop();
      }

      const { stop, promise } = this.context.transcribeData(buffer, {
        language: options?.language || this.config.language,
        temperature: options?.temperature ?? this.config.temperature,
        translate: options?.translate || false,
      });

      this.currentTranscription = { stop };

      const result = await promise;

      // Parse result
      const text = result?.text?.trim() || '';
      
      // Extract segments if available
      const segments = result?.segments?.map((seg: any) => ({
        start: seg.start || 0,
        end: seg.end || 0,
        text: seg.text || '',
      })) || [];

      this.currentTranscription = null;

      return {
        text,
        segments,
      };
    } catch (error) {
      this.currentTranscription = null;
      console.error('[WhisperNative] Transcription error:', error);
      throw error;
    }
  }

  /**
   * Transcribe Float32Array (converts to Int16 internally)
   */
  async transcribeFloat32(
    audio: Float32Array,
    options?: {
      language?: string;
      temperature?: number;
    }
  ): Promise<TranscriptionResult> {
    const int16 = this.float32ToInt16(audio);
    return this.transcribe(int16, options);
  }

  /**
   * Convert Float32Array to Int16Array
   */
  private float32ToInt16(float32: Float32Array): Int16Array {
    const int16 = new Int16Array(float32.length);
    for (let i = 0; i < float32.length; i++) {
      const s = Math.max(-1, Math.min(1, float32[i]));
      int16[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
    }
    return int16;
  }

  /**
   * Cancel current transcription
   */
  async cancel(): Promise<void> {
    if (this.currentTranscription) {
      await this.currentTranscription.stop();
      this.currentTranscription = null;
    }
  }

  /**
   * Release resources
   */
  async release(): Promise<void> {
    await this.cancel();
    
    if (this.context) {
      await this.context.release();
      this.context = null;
    }
    
    this.isInitialized = false;
    console.log('[WhisperNative] Released');
  }

  /**
   * Check if initialized
   */
  isReady(): boolean {
    return this.isInitialized && this.context !== null;
  }

  /**
   * Get model path
   */
  getModelPath(): string | null {
    return this.config.modelPath || this.getDefaultModelPath();
  }
}

