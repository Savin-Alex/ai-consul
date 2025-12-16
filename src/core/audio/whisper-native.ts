/**
 * WhisperNative - whisper.cpp native addon wrapper using @fugood/whisper.node
 * 
 * DEBUG VERSION - Saves audio to files for analysis when DEBUG_AUDIO=true
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
  private debugAudioCounter = 0;

  constructor(config: WhisperNativeConfig = {}) {
    super();
    this.config = {
      modelSize: 'small', // Changed from 'base' to 'small'
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
        
        if (!path.isAbsolute(modelPath)) {
          modelPath = path.resolve(process.cwd(), modelPath);
        }
        
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

        const options: any = {
          model: modelPath,
          filePath: modelPath,
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

    return locations[0];
  }

  /**
   * Save Int16 PCM audio as WAV file for debugging
   */
  private saveDebugAudio(int16Audio: Int16Array, sampleRate: number = 16000): string {
    const debugDir = path.join(process.cwd(), 'debug-audio');
    if (!fs.existsSync(debugDir)) {
      fs.mkdirSync(debugDir, { recursive: true });
    }
    
    const filename = `debug-audio-${++this.debugAudioCounter}-${Date.now()}.wav`;
    const filepath = path.join(debugDir, filename);
    
    // Create WAV file header
    const numChannels = 1;
    const bitsPerSample = 16;
    const byteRate = sampleRate * numChannels * (bitsPerSample / 8);
    const blockAlign = numChannels * (bitsPerSample / 8);
    const dataSize = int16Audio.length * 2; // 2 bytes per Int16 sample
    const fileSize = 44 + dataSize - 8; // WAV header is 44 bytes, RIFF header excludes first 8 bytes
    
    const buffer = Buffer.alloc(44 + dataSize);
    
    // RIFF header
    buffer.write('RIFF', 0);
    buffer.writeUInt32LE(fileSize, 4);
    buffer.write('WAVE', 8);
    
    // fmt chunk
    buffer.write('fmt ', 12);
    buffer.writeUInt32LE(16, 16); // chunk size
    buffer.writeUInt16LE(1, 20); // audio format (1 = PCM)
    buffer.writeUInt16LE(numChannels, 22);
    buffer.writeUInt32LE(sampleRate, 24);
    buffer.writeUInt32LE(byteRate, 28);
    buffer.writeUInt16LE(blockAlign, 32);
    buffer.writeUInt16LE(bitsPerSample, 34);
    
    // data chunk
    buffer.write('data', 36);
    buffer.writeUInt32LE(dataSize, 40);
    
    // Copy audio data
    for (let i = 0; i < int16Audio.length; i++) {
      buffer.writeInt16LE(int16Audio[i], 44 + i * 2);
    }
    
    fs.writeFileSync(filepath, buffer);
    console.log(`[WhisperNative] DEBUG: Saved audio to ${filepath}`);
    
    return filepath;
  }

  /**
   * Transcribe audio buffer
   * @param audioBuffer - Int16Array or ArrayBuffer of 16-bit PCM, mono, 16kHz
   */
  async transcribe(
    audioBuffer: ArrayBuffer | Int16Array | SharedArrayBuffer,
    options?: { language?: string; temperature?: number; translate?: boolean; prompt?: string }
  ): Promise<TranscriptionResult> {
    if (!this.context || !this.isInitialized) {
      await this.initialize();
    } else if (this.initializationPromise) {
      await this.initializationPromise;
    }
    
    if (!this.context) {
      throw new Error('WhisperNative not initialized');
    }

    // Properly handle Int16Array buffer extraction
    let buffer: ArrayBuffer;
    if (audioBuffer instanceof Int16Array) {
      const sliced = audioBuffer.buffer.slice(
        audioBuffer.byteOffset,
        audioBuffer.byteOffset + audioBuffer.byteLength
      );
      // Ensure we have an ArrayBuffer (not SharedArrayBuffer)
      buffer = sliced instanceof SharedArrayBuffer 
        ? new ArrayBuffer(sliced.byteLength)
        : sliced;
      // Copy data if it was SharedArrayBuffer
      if (sliced instanceof SharedArrayBuffer) {
        new Uint8Array(buffer).set(new Uint8Array(sliced));
      }
    } else if (audioBuffer instanceof SharedArrayBuffer) {
      // Convert SharedArrayBuffer to ArrayBuffer
      buffer = new ArrayBuffer(audioBuffer.byteLength);
      new Uint8Array(buffer).set(new Uint8Array(audioBuffer));
    } else {
      buffer = audioBuffer as ArrayBuffer;
    }
    
    if (buffer.byteLength === 0) {
      return { text: '' };
    }

    // Get Int16Array view for debugging
    const int16View = new Int16Array(buffer);
    
    // DEBUG: Log detailed buffer info
    if (process.env.DEBUG_AUDIO === 'true') {
      const sampleCount = buffer.byteLength / 2;
      let maxSample = 0;
      let minSample = 0;
      let sumAbs = 0;
      const previewSamples = Math.min(100, int16View.length);
      for (let i = 0; i < previewSamples; i++) {
        const val = int16View[i];
        if (val > maxSample) maxSample = val;
        if (val < minSample) minSample = val;
        sumAbs += Math.abs(val);
      }
      const avgAbs = sumAbs / previewSamples;
      
      console.log('[WhisperNative] Transcribe buffer details:', {
        byteLength: buffer.byteLength,
        samplesCount: sampleCount,
        durationSeconds: (sampleCount / 16000).toFixed(2),
        maxSample: maxSample,
        minSample: minSample,
        avgAbsSample: avgAbs.toFixed(2),
        first10Samples: Array.from(int16View.slice(0, 10)),
        last10Samples: Array.from(int16View.slice(-10)),
      });
      
      // Save audio for debugging
      this.saveDebugAudio(int16View);
    }

    try {
      if (this.currentTranscription) {
        await this.currentTranscription.stop();
      }

      const transcribeOptions: any = {
        language: options?.language || this.config.language,
        temperature: options?.temperature ?? this.config.temperature,
        translate: options?.translate || false,
      };
      
      // Add prompt if provided (helps reduce hallucinations)
      if (options?.prompt) {
        transcribeOptions.prompt = options.prompt;
      }
      
      if (process.env.DEBUG_AUDIO === 'true') {
        console.log('[WhisperNative] Transcribe options:', transcribeOptions);
      }

      const { stop, promise } = this.context.transcribeData(buffer, transcribeOptions);

      this.currentTranscription = { stop };
      const result = await promise as any;
      
      // DEBUG: Log raw result
      if (process.env.DEBUG_AUDIO === 'true') {
        console.log('[WhisperNative] Raw result from whisper.cpp:', JSON.stringify(result, null, 2));
      }
      
      // FIX: @fugood/whisper.node returns 'result' property, not 'text'
      const rawText = (result?.result || result?.text || result?.transcription || '').trim();
      
      // Filter out Whisper hallucinations
      const text = this.filterHallucinations(rawText);
      
      // Also filter segment text
      const segments = result?.segments?.map((seg: any) => {
        const segText = this.filterHallucinations((seg.text || '').trim());
        return {
          start: seg.t0 ?? seg.start ?? seg.startTime ?? 0,
          end: seg.t1 ?? seg.end ?? seg.endTime ?? 0,
          text: segText,
        };
      }) ?? [];
      
      if (process.env.DEBUG_AUDIO === 'true') {
        console.log('[WhisperNative] Raw text:', rawText);
        console.log('[WhisperNative] Filtered text:', text);
        console.log('[WhisperNative] Extracted segments:', segments);
      }
      
      this.currentTranscription = null;
      return { text, segments };
    } catch (error) {
      this.currentTranscription = null;
      console.error('[WhisperNative] Transcription error:', error);
      throw error;
    }
  }

  /**
   * Filter out common Whisper hallucinations
   */
  private filterHallucinations(text: string): string {
    if (!text) return '';
    
    // Common hallucination patterns (case-insensitive)
    const hallucinations = [
      /^\s*\(.*?music.*?\)\s*$/i,           // (upbeat music), (soft music), etc.
      /^\s*\[.*?music.*?\]\s*$/i,           // [MUSIC], [Music playing], etc.
      /^\s*\(.*?silence.*?\)\s*$/i,         // (silence)
      /^\s*\[.*?silence.*?\]\s*$/i,         // [SILENCE]
      /^\s*\(.*?applause.*?\)\s*$/i,        // (applause)
      /^\s*\[.*?applause.*?\]\s*$/i,        // [APPLAUSE]
      /^\s*\(.*?laughter.*?\)\s*$/i,        // (laughter)
      /^\s*\[.*?laughter.*?\]\s*$/i,        // [LAUGHTER]
      /^\s*\(.*?laughing.*?\)\s*$/i,        // (laughing)
      /^\s*\(.*?cough.*?\)\s*$/i,           // (coughing)
      /^\s*\(.*?sigh.*?\)\s*$/i,            // (sighing)
      /^\s*\(.*?noise.*?\)\s*$/i,           // (background noise)
      /^\s*\(.*?inaudible.*?\)\s*$/i,       // (inaudible)
      /^\s*\[.*?inaudible.*?\]\s*$/i,       // [INAUDIBLE]
      /^\s*\(.*?blank.*?audio.*?\)\s*$/i,   // (blank audio)
      /^\s*\(.*?buzzer.*?\)\s*$/i,          // (buzzer) - ADDED
      /^\s*\(.*?beep.*?\)\s*$/i,            // (beep) - ADDED
      /^\s*\(.*?click.*?\)\s*$/i,           // (clicking) - ADDED
      /^\s*\(.*?static.*?\)\s*$/i,          // (static) - ADDED
      /^\s*\(.*?video.*?\)\s*$/i,           // (video plays) - ADDED
      /^\s*\(.*?phone.*?\)\s*$/i,           // (phone ringing) - ADDED
      /^\s*♪.*?♪\s*$/,                      // ♪ music notes ♪
      /^\s*\*.*?\*\s*$/,                    // *action descriptions*
      /^\s*\.+\s*$/,                        // Just dots/ellipsis
      /^\s*-+\s*$/,                         // Just dashes
      /^\s*thank you\.?\s*$/i,              // "Thank you" (common hallucination)
      /^\s*thanks for watching\.?\s*$/i,   // "Thanks for watching"
      /^\s*subscribe.*?\s*$/i,              // YouTube-style hallucinations
      /^\s*like and subscribe.*?\s*$/i,    // ADDED
      /^\s*please subscribe.*?\s*$/i,      // ADDED
      /^\s*you\s*$/i,                       // Just "you"
      /^\s*\.\.\.\s*$/,                     // Just "..."
      /^\s*um+\s*$/i,                       // Just "um" or "umm"
      /^\s*uh+\s*$/i,                       // Just "uh" or "uhh"
      /^\s*hmm+\s*$/i,                      // Just "hmm"
    ];
    
    for (const pattern of hallucinations) {
      if (pattern.test(text)) {
        if (process.env.DEBUG_AUDIO === 'true') {
          console.log(`[WhisperNative] Filtered hallucination: "${text}"`);
        }
        return '';
      }
    }
    
    return text;
  }

  /**
   * Normalize audio - boost quiet audio, reduce clipping
   */
  private normalizeAudio(audio: Float32Array): Float32Array {
    if (audio.length === 0) return audio;
    
    // Find max absolute value
    let maxVal = 0;
    for (let i = 0; i < audio.length; i++) {
      const absVal = Math.abs(audio[i]);
      if (absVal > maxVal) maxVal = absVal;
    }
    
    // If audio is essentially silent, return as-is
    if (maxVal < 0.01) {
      if (process.env.DEBUG_AUDIO === 'true') {
        console.log('[WhisperNative] Audio too quiet for normalization, returning as-is');
      }
      return audio;
    }
    
    // Normalize to 70% of max range to avoid clipping
    const targetPeak = 0.7;
    const scale = targetPeak / maxVal;
    
    const normalized = new Float32Array(audio.length);
    for (let i = 0; i < audio.length; i++) {
      normalized[i] = Math.max(-1, Math.min(1, audio[i] * scale));
    }
    
    return normalized;
  }

  /**
   * Transcribe Float32Array (converts to Int16 internally)
   */
  async transcribeFloat32(
    audio: Float32Array,
    options?: { language?: string; temperature?: number; prompt?: string }
  ): Promise<TranscriptionResult> {
    // Calculate stats before normalization
    let maxVal = 0;
    let minVal = 0;
    let sumAbs = 0;
    for (let i = 0; i < audio.length; i++) {
      if (audio[i] > maxVal) maxVal = audio[i];
      if (audio[i] < minVal) minVal = audio[i];
      sumAbs += Math.abs(audio[i]);
    }
    const avgAbs = sumAbs / audio.length;
    
    // Normalize audio to improve Whisper recognition
    const normalizedAudio = this.normalizeAudio(audio);
    
    // Calculate stats after normalization
    let normMaxVal = 0;
    let normMinVal = 0;
    for (let i = 0; i < normalizedAudio.length; i++) {
      if (normalizedAudio[i] > normMaxVal) normMaxVal = normalizedAudio[i];
      if (normalizedAudio[i] < normMinVal) normMinVal = normalizedAudio[i];
    }
    
    if (process.env.DEBUG_AUDIO === 'true') {
      console.log('[WhisperNative] transcribeFloat32 input:', {
        samples: audio.length,
        durationSeconds: (audio.length / 16000).toFixed(2),
        maxValue: maxVal.toFixed(4),
        minValue: minVal.toFixed(4),
        avgAbsValue: avgAbs.toFixed(4),
        normalizedMax: normMaxVal.toFixed(4),
        normalizedMin: normMinVal.toFixed(4),
      });
    }
    
    const int16 = this.float32ToInt16(normalizedAudio);
    
    if (process.env.DEBUG_AUDIO === 'true') {
      let int16Max = 0;
      let int16Min = 0;
      for (let i = 0; i < int16.length; i++) {
        if (int16[i] > int16Max) int16Max = int16[i];
        if (int16[i] < int16Min) int16Min = int16[i];
      }
      console.log('[WhisperNative] Int16 conversion result:', {
        samples: int16.length,
        maxValue: int16Max,
        minValue: int16Min,
      });
    }
    
    // Add initial prompt to bias toward speech transcription
    const optionsWithPrompt = {
      ...options,
      prompt: options?.prompt || 'Hello, how are you today?',
    };
    
    return this.transcribe(int16, optionsWithPrompt);
  }

  /**
   * Convert Float32Array (-1.0 to 1.0) to Int16Array (-32768 to 32767)
   * Uses symmetric conversion: multiply by 32767 and round
   */
  private float32ToInt16(float32: Float32Array): Int16Array {
    const int16 = new Int16Array(float32.length);
    for (let i = 0; i < float32.length; i++) {
      // Clamp to [-1, 1] range
      const s = Math.max(-1, Math.min(1, float32[i]));
      // Convert to Int16: multiply by 32767 and round
      // This gives symmetric range: -32767 to 32767 (not using -32768 to avoid asymmetry)
      int16[i] = Math.round(s * 32767);
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
