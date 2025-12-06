/**
 * SileroVADNative - VAD using @fugood/whisper.node
 * 
 * Uses whisper.cpp's built-in VAD support for voice activity detection
 */

import { initWhisperVad, WhisperVadContext } from '@fugood/whisper.node';
import * as path from 'path';
import * as fs from 'fs';
import { app } from 'electron';

export interface VADResult {
  speech: boolean;
  probability: number;
  segments?: Array<{
    start: number;
    end: number;
  }>;
}

export class SileroVADNative {
  private vadContext: WhisperVadContext | null = null;
  private isInitialized = false;
  private initializationPromise: Promise<void> | null = null;
  private config: {
    modelPath?: string;
    useGpu?: boolean;
    libVariant?: 'default' | 'vulkan' | 'cuda';
    threshold?: number;
  };

  constructor(config: {
    modelPath?: string;
    useGpu?: boolean;
    libVariant?: 'default' | 'vulkan' | 'cuda';
    threshold?: number;
  } = {}) {
    this.config = {
      useGpu: true,
      libVariant: 'default',
      threshold: 0.5,
      ...config,
    };
  }

  /**
   * Initialize VAD context
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
          console.warn(
            `[SileroVADNative] VAD model not found: ${modelPath}\n` +
            'VAD will be disabled. Run: pnpm run download-vad-model'
          );
          // Don't throw - allow operation without VAD
          return;
        }

        console.log(`[SileroVADNative] Loading VAD model: ${modelPath}`);

        this.vadContext = await initWhisperVad(
          {
            model: modelPath,
            useGpu: this.config.useGpu,
            nThreads: 2,
          },
          this.config.libVariant
        );

        this.isInitialized = true;
        console.log('[SileroVADNative] VAD model loaded successfully');
      } catch (error) {
        console.error('[SileroVADNative] Initialization failed:', error);
        // Don't throw - allow operation without VAD
        this.isInitialized = false;
      } finally {
        this.initializationPromise = null;
      }
    })();

    return this.initializationPromise;
  }

  /**
   * Get default VAD model path
   */
  private getDefaultModelPath(): string {
    const possiblePaths = [
      path.join(app.getAppPath(), 'models', 'vad', 'ggml-vad.bin'),
      path.join(process.cwd(), 'models', 'vad', 'ggml-vad.bin'),
      path.join(__dirname, '../../models/vad', 'ggml-vad.bin'),
      path.join(require('os').homedir(), '.cache', 'ai-consul', 'models', 'vad', 'ggml-vad.bin'),
    ];

    for (const modelPath of possiblePaths) {
      if (fs.existsSync(modelPath)) {
        return modelPath;
      }
    }

    return possiblePaths[0];
  }

  /**
   * Detect speech in audio buffer
   * @param audioBuffer - PCM 16-bit, mono, 16kHz audio data
   * @param threshold - Speech probability threshold (default: 0.5)
   */
  async detectSpeech(
    audioBuffer: ArrayBuffer | Int16Array,
    threshold?: number
  ): Promise<VADResult> {
    if (!this.vadContext || !this.isInitialized) {
      // Try to initialize, but don't fail if VAD unavailable
      try {
        await this.initialize();
      } catch {
        // Return no speech if VAD unavailable
        return { speech: false, probability: 0 };
      }
    }

    if (!this.vadContext || !this.isInitialized) {
      return { speech: false, probability: 0 };
    }

    const buffer = audioBuffer instanceof Int16Array 
      ? audioBuffer.buffer 
      : audioBuffer;

    if (buffer.byteLength === 0) {
      return { speech: false, probability: 0 };
    }

    try {
      const result = await this.vadContext.detectSpeechData(buffer);
      
      const prob = result.speechProbability || 0;
      const speechThreshold = threshold ?? this.config.threshold ?? 0.5;

      return {
        speech: prob >= speechThreshold,
        probability: prob,
        segments: result.segments,
      };
    } catch (error) {
      console.error('[SileroVADNative] Detection error:', error);
      return { speech: false, probability: 0 };
    }
  }

  /**
   * Detect speech in Float32Array
   */
  async detectSpeechFloat32(
    audio: Float32Array,
    threshold?: number
  ): Promise<VADResult> {
    const int16 = this.float32ToInt16(audio);
    return this.detectSpeech(int16, threshold);
  }

  /**
   * Check if audio contains speech (convenience method)
   */
  async isSpeech(
    audio: Float32Array | ArrayBuffer | Int16Array,
    threshold?: number
  ): Promise<boolean> {
    if (audio instanceof Float32Array) {
      const result = await this.detectSpeechFloat32(audio, threshold);
      return result.speech;
    } else {
      const result = await this.detectSpeech(audio, threshold);
      return result.speech;
    }
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
   * Reset VAD state (if needed)
   */
  resetState(): void {
    // VAD context manages its own state
    // This is a placeholder for future state management
  }

  /**
   * Release resources
   */
  async release(): Promise<void> {
    if (this.vadContext) {
      await this.vadContext.release();
      this.vadContext = null;
    }
    this.isInitialized = false;
    console.log('[SileroVADNative] Released');
  }

  /**
   * Check if initialized
   */
  isReady(): boolean {
    return this.isInitialized && this.vadContext !== null;
  }
}

