# Native Addon Integration Plan - @fugood/whisper.node

## Overview

This plan integrates `@fugood/whisper.node` as a high-performance alternative to the current child process approach. The implementation maintains backward compatibility while providing significant performance improvements.

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│                    Engine Layer                          │
│  ┌──────────────────────────────────────────────────┐  │
│  │  AIConsulEngine                                  │  │
│  │  - Manages transcription providers              │  │
│  │  - Routes to appropriate provider                │  │
│  └──────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────┘
                        │
        ┌───────────────┼───────────────┐
        │               │               │
┌───────▼──────┐ ┌─────▼──────┐ ┌─────▼──────┐
│ WhisperNative│ │ WhisperCpp │ │LocalWhisper│
│ (NEW)        │ │ (Current)  │ │ (Legacy)   │
│              │ │            │ │            │
│ - Native     │ │ - Child    │ │ - WASM     │
│ - Direct     │ │ - Process  │ │ - Broken   │
│ - GPU        │ │ - File I/O │ │            │
└──────────────┘ └────────────┘ └────────────┘
```

## Implementation Phases

### Phase 1: Install & Setup (30 minutes)
### Phase 2: Create Wrapper Classes (2-3 hours)
### Phase 3: Integrate with Engine (1-2 hours)
### Phase 4: Add VAD Support (1-2 hours)
### Phase 5: Testing & Benchmarking (2-3 hours)
### Phase 6: Migration & Cleanup (1 hour)

---

## Phase 1: Install & Setup

### Step 1.1: Install Package

```bash
cd "/Users/alexander/Documents/CriticalSuccess/Ai Consul"
pnpm add @fugood/whisper.node
```

### Step 1.2: Update package.json Scripts

Add model download script:

```json
{
  "scripts": {
    "download-models": "bash scripts/download-models.sh",
    "download-vad-model": "bash scripts/download-vad-model.sh"
  }
}
```

### Step 1.3: Create Model Download Scripts

**File: `scripts/download-models.sh`**

```bash
#!/bin/bash
# Download Whisper models for @fugood/whisper.node

set -e

MODELS_DIR="./models/whisper"
mkdir -p "$MODELS_DIR"

echo "Downloading Whisper models..."

# Base English model (recommended for real-time)
curl -L -o "$MODELS_DIR/ggml-base.en.bin" \
  "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.en.bin"

# Tiny model (fastest, lower accuracy)
curl -L -o "$MODELS_DIR/ggml-tiny.en.bin" \
  "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-tiny.en.bin"

# Small model (balanced)
curl -L -o "$MODELS_DIR/ggml-small.en.bin" \
  "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-small.en.bin"

echo "✅ Models downloaded to $MODELS_DIR"
```

**File: `scripts/download-vad-model.sh`**

```bash
#!/bin/bash
# Download Silero VAD model for @fugood/whisper.node

set -e

MODELS_DIR="./models/vad"
mkdir -p "$MODELS_DIR"

echo "Downloading Silero VAD model..."

curl -L -o "$MODELS_DIR/ggml-vad.bin" \
  "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/models/ggml-vad.bin"

echo "✅ VAD model downloaded to $MODELS_DIR"
```

---

## Phase 2: Create Wrapper Classes

### File: `src/core/audio/whisper-native.ts`

```typescript
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
  private config: Required<WhisperNativeConfig>;
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
      modelPath: '',
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
   * Detect available GPU backend
   */
  private detectLibVariant(): 'default' | 'vulkan' | 'cuda' {
    // On macOS, default includes Metal
    if (process.platform === 'darwin') {
      return 'default';
    }

    // On Windows/Linux, try to detect GPU
    // For now, use default (can be enhanced with GPU detection)
    return 'default';
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
```

### File: `src/core/audio/silero-vad-native.ts`

```typescript
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
          throw new Error(
            `VAD model not found: ${modelPath}\n` +
            'Run: pnpm run download-vad-model'
          );
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
        throw error;
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
      await this.initialize();
    } else if (this.initializationPromise) {
      await this.initializationPromise;
    }

    if (!this.vadContext) {
      throw new Error('SileroVADNative not initialized');
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
```

---

## Phase 3: Integrate with Engine

### Update: `src/core/config/transcription.ts`

Add new transcription provider options:

```typescript
export interface EngineConfig {
  models: {
    transcription: {
      primary: 
        | 'local-whisper-tiny' 
        | 'local-whisper-base' 
        | 'local-whisper-small'
        | 'whisper-cpp-tiny'
        | 'whisper-cpp-base'
        | 'whisper-cpp-small'
        | 'whisper-cpp-medium'
        | 'whisper-native-tiny'    // NEW
        | 'whisper-native-base'   // NEW
        | 'whisper-native-small'  // NEW
        | 'cloud-whisper';
      fallback: 'cloud-whisper';
      // ... rest of config
    };
  };
}
```

### Update: `src/core/engine.ts`

Add WhisperNative support:

```typescript
import { WhisperNative } from './audio/whisper-native';
import { SileroVADNative } from './audio/silero-vad-native';

export class AIConsulEngine extends EventEmitter {
  private whisperNative: WhisperNative | null = null;
  private vadNative: SileroVADNative | null = null;
  
  // ... existing code ...

  private async initializeTranscription(): Promise<void> {
    const primary = this.config.models.transcription.primary;
    
    // Check if native addon is requested
    if (primary.startsWith('whisper-native-')) {
      const modelSize = primary.replace('whisper-native-', '') as 'tiny' | 'base' | 'small';
      
      this.whisperNative = new WhisperNative({
        modelSize,
        language: 'en',
        useGpu: true,
        libVariant: 'default', // Can be enhanced with auto-detection
      });
      
      try {
        await this.whisperNative.initialize();
        console.log('[engine] WhisperNative initialized');
      } catch (error) {
        console.error('[engine] WhisperNative initialization failed:', error);
        // Fallback to child process
        await this.initializeWhisperCpp(modelSize);
      }
    } else if (primary.startsWith('whisper-cpp-')) {
      // Existing whisper-cpp implementation
      const modelSize = primary.replace('whisper-cpp-', '') as 'tiny' | 'base' | 'small' | 'medium';
      await this.initializeWhisperCpp(modelSize);
    } else {
      // Existing local-whisper implementation
      // ...
    }
  }

  async transcribe(
    audioChunk: Float32Array,
    sampleRate: number = 16000,
    language?: string
  ): Promise<string> {
    // Route to appropriate provider
    if (this.whisperNative?.isReady()) {
      try {
        const result = await this.whisperNative.transcribeFloat32(audioChunk, {
          language: language || 'en',
        });
        return result.text;
      } catch (error) {
        console.error('[engine] WhisperNative transcription failed:', error);
        // Fallback to child process
        if (this.whisperCpp) {
          return this.whisperCpp.transcribe(audioChunk, sampleRate, language || 'en');
        }
        throw error;
      }
    }
    
    // Existing fallback logic...
    if (this.whisperCpp) {
      return this.whisperCpp.transcribe(audioChunk, sampleRate, language || 'en');
    }
    
    // ... rest of fallback chain
  }
}
```

---

## Phase 4: Create RealtimeTranscriber (Optional)

### File: `src/core/audio/realtime-transcriber.ts`

```typescript
/**
 * RealtimeTranscriber - Orchestrates VAD + Whisper for real-time transcription
 * 
 * Uses WhisperNative and SileroVADNative for optimal performance
 */

import { EventEmitter } from 'events';
import { WhisperNative } from './whisper-native';
import { SileroVADNative } from './silero-vad-native';

export interface TranscriptEvent {
  text: string;
  speaker: 'user' | 'remote';
  timestamp: number;
  type: 'interim' | 'final';
  confidence?: number;
}

export interface RealtimeTranscriberConfig {
  processIntervalMs?: number;
  minAudioMs?: number;
  maxBufferMs?: number;
  vadThreshold?: number;
  silenceTimeoutMs?: number;
  keepContextMs?: number;
}

export class RealtimeTranscriber extends EventEmitter {
  private whisper: WhisperNative;
  private vad: SileroVADNative;
  private config: Required<RealtimeTranscriberConfig>;
  
  private micBuffer: Float32Array[] = [];
  private systemBuffer: Float32Array[] = [];
  
  private processing = false;
  private interval: NodeJS.Timer | null = null;
  private lastSpeechTime: { mic: number; system: number } = { mic: 0, system: 0 };
  private isInitialized = false;
  private readonly SAMPLE_RATE = 16000;

  constructor(config: RealtimeTranscriberConfig = {}) {
    super();
    
    this.config = {
      processIntervalMs: 500,
      minAudioMs: 1000,
      maxBufferMs: 30000,
      vadThreshold: 0.5,
      silenceTimeoutMs: 1000,
      keepContextMs: 2000,
      ...config,
    };
    
    this.whisper = new WhisperNative({
      modelSize: 'base',
      useGpu: true,
    });
    
    this.vad = new SileroVADNative({
      useGpu: true,
      threshold: this.config.vadThreshold,
    });
  }

  async initialize(): Promise<void> {
    console.log('[RealtimeTranscriber] Initializing...');
    
    await Promise.all([
      this.whisper.initialize(),
      this.vad.initialize(),
    ]);
    
    this.isInitialized = true;
    console.log('[RealtimeTranscriber] Ready');
  }

  start(): void {
    if (!this.isInitialized) {
      throw new Error('RealtimeTranscriber not initialized');
    }
    if (this.interval) return;
    
    this.interval = setInterval(() => {
      this.processBuffers();
    }, this.config.processIntervalMs);
    
    console.log('[RealtimeTranscriber] Started');
  }

  stop(): void {
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
    }
    console.log('[RealtimeTranscriber] Stopped');
  }

  async feedAudio(chunk: Float32Array, source: 'mic' | 'system'): Promise<void> {
    if (!this.isInitialized) return;
    
    const isSpeech = await this.vad.isSpeech(chunk, this.config.vadThreshold);
    
    if (isSpeech) {
      this.lastSpeechTime[source] = Date.now();
      
      if (source === 'mic') {
        this.micBuffer.push(chunk);
      } else {
        this.systemBuffer.push(chunk);
      }
    } else {
      const silenceDuration = Date.now() - this.lastSpeechTime[source];
      if (silenceDuration >= this.config.silenceTimeoutMs) {
        await this.emitFinalTranscript(source);
      }
    }
    
    this.enforceMaxBuffer(source);
  }

  private async processBuffers(): Promise<void> {
    if (this.processing) return;
    this.processing = true;
    
    try {
      await Promise.all([
        this.processBuffer('mic'),
        this.processBuffer('system'),
      ]);
    } finally {
      this.processing = false;
    }
  }

  private async processBuffer(source: 'mic' | 'system'): Promise<void> {
    const buffer = source === 'mic' ? this.micBuffer : this.systemBuffer;
    const totalSamples = buffer.reduce((sum, b) => sum + b.length, 0);
    const durationMs = (totalSamples / this.SAMPLE_RATE) * 1000;
    
    if (durationMs < this.config.minAudioMs) return;
    
    const combined = this.combineBuffers(buffer);
    const result = await this.whisper.transcribeFloat32(combined);
    
    if (result.text) {
      const isFinal = this.detectSentenceEnd(result.text);
      
      this.emit('transcript', {
        text: result.text,
        speaker: source === 'mic' ? 'user' : 'remote',
        timestamp: Date.now(),
        type: isFinal ? 'final' : 'interim',
      } as TranscriptEvent);
      
      if (isFinal) {
        this.clearBuffer(source);
      } else {
        this.trimBuffer(source);
      }
    }
  }

  private async emitFinalTranscript(source: 'mic' | 'system'): Promise<void> {
    const buffer = source === 'mic' ? this.micBuffer : this.systemBuffer;
    if (buffer.length === 0) return;
    
    const combined = this.combineBuffers(buffer);
    const result = await this.whisper.transcribeFloat32(combined);
    
    if (result.text) {
      this.emit('transcript', {
        text: result.text,
        speaker: source === 'mic' ? 'user' : 'remote',
        timestamp: Date.now(),
        type: 'final',
      } as TranscriptEvent);
    }
    
    this.clearBuffer(source);
  }

  private combineBuffers(buffers: Float32Array[]): Float32Array {
    const totalLength = buffers.reduce((sum, b) => sum + b.length, 0);
    const combined = new Float32Array(totalLength);
    let offset = 0;
    
    for (const buffer of buffers) {
      combined.set(buffer, offset);
      offset += buffer.length;
    }
    
    return combined;
  }

  private trimBuffer(source: 'mic' | 'system'): void {
    const keepSamples = (this.config.keepContextMs / 1000) * this.SAMPLE_RATE;
    const buffer = source === 'mic' ? this.micBuffer : this.systemBuffer;
    const totalSamples = buffer.reduce((sum, b) => sum + b.length, 0);
    
    if (totalSamples > keepSamples) {
      const combined = this.combineBuffers(buffer);
      const trimmed = combined.slice(-keepSamples);
      
      if (source === 'mic') {
        this.micBuffer = [trimmed];
      } else {
        this.systemBuffer = [trimmed];
      }
    }
  }

  private clearBuffer(source: 'mic' | 'system'): void {
    if (source === 'mic') {
      this.micBuffer = [];
    } else {
      this.systemBuffer = [];
    }
    this.vad.resetState();
  }

  private enforceMaxBuffer(source: 'mic' | 'system'): void {
    const buffer = source === 'mic' ? this.micBuffer : this.systemBuffer;
    const maxSamples = (this.config.maxBufferMs / 1000) * this.SAMPLE_RATE;
    const totalSamples = buffer.reduce((sum, b) => sum + b.length, 0);
    
    if (totalSamples > maxSamples) {
      console.warn(`[RealtimeTranscriber] Buffer overflow for ${source}, forcing emit`);
      this.emitFinalTranscript(source);
    }
  }

  private detectSentenceEnd(text: string): boolean {
    return /[.!?]\s*$/.test(text);
  }

  async release(): Promise<void> {
    this.stop();
    await Promise.all([
      this.whisper.release(),
      this.vad.release(),
    ]);
    this.isInitialized = false;
  }
}
```

---

## Phase 5: Testing & Benchmarking

### File: `scripts/test-whisper-native.ts`

```typescript
/**
 * Test script for WhisperNative
 */

import { WhisperNative } from '../src/core/audio/whisper-native';
import * as fs from 'fs';

async function testWhisperNative() {
  console.log('Testing WhisperNative...');
  
  const whisper = new WhisperNative({
    modelSize: 'base',
    useGpu: true,
  });
  
  try {
    // Initialize
    console.log('Initializing...');
    await whisper.initialize();
    console.log('✅ Initialized');
    
    // Load test audio (Float32Array, 16kHz mono)
    // This would come from your audio capture
    const testAudio = new Float32Array(16000 * 3); // 3 seconds
    
    // Transcribe
    console.log('Transcribing...');
    const start = Date.now();
    const result = await whisper.transcribeFloat32(testAudio);
    const duration = Date.now() - start;
    
    console.log(`✅ Transcription complete in ${duration}ms`);
    console.log(`Text: ${result.text}`);
    
    // Release
    await whisper.release();
    console.log('✅ Released');
  } catch (error) {
    console.error('❌ Error:', error);
  }
}

testWhisperNative();
```

### Benchmark Script

```typescript
/**
 * Benchmark WhisperNative vs WhisperCpp
 */

import { WhisperNative } from '../src/core/audio/whisper-native';
import { WhisperCpp } from '../src/core/audio/whisper-cpp';

async function benchmark() {
  const testAudio = new Float32Array(16000 * 5); // 5 seconds
  
  // Test WhisperNative
  const native = new WhisperNative({ modelSize: 'base' });
  await native.initialize();
  
  const nativeStart = Date.now();
  const nativeResult = await native.transcribeFloat32(testAudio);
  const nativeDuration = Date.now() - nativeStart;
  
  await native.release();
  
  // Test WhisperCpp
  const cpp = new WhisperCpp();
  await cpp.initialize('base');
  
  const cppStart = Date.now();
  const cppResult = await cpp.transcribe(testAudio, 16000);
  const cppDuration = Date.now() - cppStart;
  
  console.log('Benchmark Results:');
  console.log(`WhisperNative: ${nativeDuration}ms`);
  console.log(`WhisperCpp:    ${cppDuration}ms`);
  console.log(`Speedup:      ${(cppDuration / nativeDuration).toFixed(2)}x`);
}
```

---

## Phase 6: Migration Strategy

### Step 1: Add as Optional Provider

1. Install package
2. Add wrapper classes
3. Integrate as new option in engine
4. Keep existing implementation as fallback

### Step 2: Test in Development

1. Test basic transcription
2. Test VAD
3. Benchmark performance
4. Test error handling

### Step 3: Make Default (If Successful)

1. Update default config to use `whisper-native-base`
2. Keep child process as fallback
3. Monitor for issues

### Step 4: Cleanup (Optional)

1. Remove child process implementation if not needed
2. Update documentation
3. Remove old model download scripts

---

## Configuration Example

### Default Config (Using Native Addon)

```typescript
const engine = new AIConsulEngine({
  models: {
    transcription: {
      primary: 'whisper-native-base',  // Use native addon
      fallback: 'whisper-cpp-base',    // Fallback to child process
    },
  },
});
```

### With VAD

```typescript
const transcriber = new RealtimeTranscriber({
  vadThreshold: 0.5,
  minAudioMs: 1000,
  processIntervalMs: 500,
});

await transcriber.initialize();
transcriber.start();

transcriber.on('transcript', (event) => {
  console.log(`[${event.speaker}] ${event.text}`);
});
```

---

## Error Handling

### GPU Detection Failure

```typescript
try {
  const whisper = new WhisperNative({ useGpu: true });
  await whisper.initialize();
} catch (error) {
  // Fallback to CPU
  const whisper = new WhisperNative({ useGpu: false });
  await whisper.initialize();
}
```

### Model Not Found

```typescript
if (!fs.existsSync(modelPath)) {
  console.warn('Model not found, downloading...');
  await downloadModel(modelSize);
}
```

---

## Success Criteria

- [ ] Package installs without errors
- [ ] Model loads successfully
- [ ] Transcription works with Float32Array input
- [ ] VAD detects speech correctly
- [ ] GPU acceleration works (if available)
- [ ] Performance is 2-5x faster than child process
- [ ] Error handling works correctly
- [ ] Works on macOS, Windows, Linux
- [ ] Works in Electron environment
- [ ] No memory leaks in long sessions

---

## Timeline Estimate

- **Phase 1:** 30 minutes
- **Phase 2:** 2-3 hours
- **Phase 3:** 1-2 hours
- **Phase 4:** 1-2 hours (optional)
- **Phase 5:** 2-3 hours
- **Phase 6:** 1 hour

**Total:** 8-12 hours of development time

---

## Next Steps

1. Install package: `pnpm add @fugood/whisper.node`
2. Download models: `pnpm run download-models`
3. Implement wrapper classes
4. Integrate with engine
5. Test and benchmark
6. Deploy

