/**
 * WhisperNative - whisper.cpp native addon wrapper using @fugood/whisper.node
 * 
 * Replaces @xenova/transformers WASM implementation with native whisper.cpp for:
 * - 2-5x faster transcription
 * - Better handling of quiet audio (reduces hallucinations)
 * - Direct PCM buffer input (no file I/O)
 * - GPU acceleration (Metal on Mac, CUDA on Windows/Linux)
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

  async initialize(): Promise<void> {
    if (this.isInitialized) return;
    if (this.initializationPromise) return this.initializationPromise;

    this.initializationPromise = (async () => {
      try {
        let modelPath = this.config.modelPath || this.getDefaultModelPath();
        
        // Resolve to absolute path - @fugood/whisper.node requires absolute paths
        if (!path.isAbsolute(modelPath)) {
          modelPath = path.resolve(process.cwd(), modelPath);
        }
        
        // Normalize path separators (important for cross-platform)
        modelPath = path.normalize(modelPath);
        
        if (!fs.existsSync(modelPath)) {
          throw new Error(`Whisper model not found: ${modelPath}\nRun: pnpm run download-models`);
        }
        
        console.log(`[WhisperNative] Loading model from: ${modelPath}`);
        console.log(`[WhisperNative] Model exists: ${fs.existsSync(modelPath)}`);
        console.log(`[WhisperNative] Model file size: ${fs.statSync(modelPath).size} bytes`);
        console.log(`[WhisperNative] Config:`, {
          modelSize: this.config.modelSize,
          language: this.config.language,
          useGpu: this.config.useGpu,
          libVariant: this.config.libVariant
        });

        // @fugood/whisper.node API: initWhisper(options, variant)
        // Type definition says 'filePath', but README shows 'model' - try both
        const options: any = {
          model: modelPath, // README shows this
          filePath: modelPath, // Type definition requires this
          useGpu: this.config.useGpu ?? true,
        };
        
        console.log(`[WhisperNative] Calling initWhisper with options:`, {
          model: options.model,
          filePath: options.filePath,
          useGpu: options.useGpu
        });
        
        this.context = await initWhisper(
          options,
          this.config.libVariant
        );
        
        this.isInitialized = true;
        console.log('[WhisperNative] Model loaded successfully');
        this.emit('initialized');
      } catch (error) {
        console.error('[WhisperNative] Initialization error:', error);
        this.emit('error', error);
        throw error;
      } finally {
        this.initializationPromise = null;
      }
    })();
    
    return this.initializationPromise;
  }

  private getDefaultModelPath(): string {
    const modelName = `ggml-${this.config.modelSize}.en.bin`;
    const locations = [
      path.join(app.getAppPath(), 'models', 'whisper', modelName),
      path.join(process.cwd(), 'models', 'whisper', modelName),
      path.join(__dirname, '../../../models', 'whisper', modelName),
      path.join(app.getPath('userData'), 'models', 'whisper', modelName),
    ];

    for (const loc of locations) {
      if (fs.existsSync(loc)) {
        return loc;
      }
    }

    // Return first location as default (will throw error in initialize if not found)
    return locations[0];
  }

  /**
   * Transcribe audio buffer
   * @param audioBuffer - Int16Array or ArrayBuffer of 16-bit PCM, mono, 16kHz
   */
  async transcribe(
    audioBuffer: ArrayBuffer | Int16Array | SharedArrayBuffer,
    options?: { language?: string; temperature?: number; translate?: boolean }
  ): Promise<TranscriptionResult> {
    if (!this.context || !this.isInitialized) {
      await this.initialize();
    } else if (this.initializationPromise) {
      await this.initializationPromise;
    }
    
    if (!this.context) {
      throw new Error('WhisperNative not initialized');
    }

    const buffer = audioBuffer instanceof Int16Array ? audioBuffer.buffer : audioBuffer;
    if (buffer.byteLength === 0) {
      return { text: '' };
    }

    try {
      // Cancel any ongoing transcription
      if (this.currentTranscription) {
        await this.currentTranscription.stop();
      }

      const { stop, promise } = this.context.transcribeData(buffer as ArrayBuffer, {
        language: options?.language || this.config.language,
        temperature: options?.temperature ?? this.config.temperature,
        translate: options?.translate || false,
      });

      this.currentTranscription = { stop };
      const result = await promise as any;
      
      // Handle different result formats - @fugood/whisper.node may return different structures
      const text = (result?.text || result?.transcription || '').trim();
      const segments = result?.segments?.map((seg: any) => ({
        start: seg.start ?? seg.startTime ?? 0,
        end: seg.end ?? seg.endTime ?? 0,
        text: seg.text || '',
      })) ?? [];
      
      this.currentTranscription = null;
      return { text, segments };
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
    options?: { language?: string; temperature?: number }
  ): Promise<TranscriptionResult> {
    const int16 = this.float32ToInt16(audio);
    return this.transcribe(int16, options);
  }

  /**
   * Convert Float32Array (-1.0 to 1.0) to Int16Array (-32768 to 32767)
   */
  private float32ToInt16(float32: Float32Array): Int16Array {
    const int16 = new Int16Array(float32.length);
    for (let i = 0; i < float32.length; i++) {
      const s = Math.max(-1, Math.min(1, float32[i]));
      int16[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
    }
    return int16;
  }

  async cancel(): Promise<void> {
    if (this.currentTranscription) {
      await this.currentTranscription.stop();
      this.currentTranscription = null;
    }
  }

  async release(): Promise<void> {
    await this.cancel();
    if (this.context) {
      await this.context.release();
      this.context = null;
    }
    this.isInitialized = false;
  }

  isReady(): boolean {
    return this.isInitialized && this.context !== null;
  }

  getModelPath(): string | null {
    return this.config.modelPath || this.getDefaultModelPath();
  }
}

