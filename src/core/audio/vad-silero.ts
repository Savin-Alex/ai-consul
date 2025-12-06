/**
 * Silero VAD Implementation
 * More accurate VAD using Silero VAD model
 * Optional enhancement over default VAD
 */

import * as path from 'path';
import * as fs from 'fs';
import { VADProvider, VADResult, VADEvent } from './vad-provider';

enum VadState {
  IDLE = 'idle',
  SPEECH_START = 'speech_start',
  SPEAKING = 'speaking',
  POSSIBLE_END = 'possible_end',
}

export class SileroVADProvider implements VADProvider {
  private session: any = null; // ONNX Runtime InferenceSession
  private ort: any = null; // ONNX Runtime module
  private isInitialized = false;
  private initializationPromise: Promise<void> | null = null;
  private initializationError: Error | null = null;

  private state: VadState = VadState.IDLE;
  private speechDetected = false;
  private accumulatedSilenceMs = 0;
  private silenceTimer: { start: number } | null = null;

  private readonly sampleRate = 16000;
  private readonly speechProbThreshold = 0.5;
  private readonly minSpeechDurationMs = 250;
  private readonly minSilenceDurationMs = 500;

  getName(): string {
    return 'silero';
  }

  async initialize(): Promise<void> {
    if (this.isInitialized) {
      return;
    }

    if (this.initializationPromise) {
      return this.initializationPromise;
    }

    this.initializationPromise = (async () => {
      this.initializationError = null;

      try {
        console.log('[SileroVAD] Initializing Silero VAD model...');
        
        // Try to load ONNX Runtime
        try {
          this.ort = require('onnxruntime-node');
        } catch (error) {
          throw new Error('onnxruntime-node is not available. Please install it: npm install onnxruntime-node');
        }

        // Check for local model file (try multiple possible locations)
        // Prefer quantized models for better performance, then full precision
        const possiblePaths = [
          // Quantized models (best performance) - from onnx-community/silero-vad
          path.join(process.cwd(), 'models', 'silero-vad', 'onnx', 'model_q4f16.onnx'),
          path.join(process.cwd(), 'models', 'silero-vad', 'onnx', 'model_fp16.onnx'),
          path.join(process.cwd(), 'models', 'silero-vad', 'onnx', 'model_q4.onnx'),
          // Full precision models
          path.join(process.cwd(), 'models', 'silero-vad', 'onnx', 'model.onnx'),
          // Alternative: direct silero_vad.onnx file (from other sources)
          path.join(process.cwd(), 'models', 'silero-vad', 'silero_vad.onnx'),
          // Production build paths (quantized first)
          path.join(__dirname, '../../models/silero-vad/onnx/model_q4f16.onnx'),
          path.join(__dirname, '../../models/silero-vad/onnx/model_fp16.onnx'),
          path.join(__dirname, '../../models/silero-vad/onnx/model.onnx'),
          path.join(__dirname, '../../models/silero-vad/silero_vad.onnx'),
        ];

        let modelPath: string | null = null;
        for (const testPath of possiblePaths) {
          if (fs.existsSync(testPath)) {
            modelPath = path.resolve(testPath);
            console.log(`[SileroVAD] Found model at: ${modelPath}`);
            break;
          }
        }

        if (!modelPath) {
          throw new Error(
            `Silero VAD model not found. Checked paths:\n${possiblePaths.map(p => `  - ${p}`).join('\n')}\n\n` +
            'Please download it using:\n' +
            '  huggingface-cli download onnx-community/silero-vad onnx/model_q4f16.onnx --local-dir ./models/silero-vad\n' +
            '  (or onnx/model.onnx for full precision)'
          );
        }

        this.session = await this.ort.InferenceSession.create(modelPath);

        this.isInitialized = true;
        console.log('[SileroVAD] Silero VAD initialized');
      } catch (error) {
        const wrapped = this.normalizeInitializationError(error);
        this.initializationError = wrapped;
        console.error('[SileroVAD] Failed to initialize VAD model:', wrapped);
        throw wrapped;
      } finally {
        this.initializationPromise = null;
      }
    })();

    return this.initializationPromise;
  }

  async isReady(): Promise<void> {
    // If initialization failed, throw the error
    // This allows VADProcessor to catch it and fallback
    if (this.initializationError) {
      throw this.initializationError;
    }

    if (this.isInitialized) {
      return;
    }

    if (!this.initializationPromise) {
      this.initializationPromise = this.initialize();
    }

    try {
      return await this.initializationPromise;
    } catch (error) {
      // Re-throw to allow fallback handling
      throw error;
    }
  }

  resetState(): void {
    if (!this.isInitialized || this.initializationError) {
      return;
    }
    this.state = VadState.IDLE;
    this.speechDetected = false;
    this.accumulatedSilenceMs = 0;
    this.silenceTimer = null;
    if (process.env.DEBUG_AUDIO === 'true') {
      console.log('[SileroVAD] State reset');
    }
  }

  async process(audioChunk: Float32Array, maxAmplitude?: number): Promise<VADResult> {
    if (!audioChunk || audioChunk.length === 0) {
      if (process.env.DEBUG_AUDIO === 'true') {
        console.warn('[SileroVAD] Received empty audio chunk, skipping.');
      }
      return { speech: false, pause: false };
    }

    if (this.initializationError) {
      throw this.initializationError;
    }

    if (!this.isInitialized) {
      await this.isReady();
    }

    if (!this.session) {
      console.warn('[SileroVAD] Model session unavailable');
      return { speech: false, pause: false };
    }

    try {
      // Silero VAD expects audio in specific format
      // Input shape: [1, samples] where samples should be 512, 1024, 1536, or 2560
      // We need to pad/truncate to one of these sizes
      const targetSizes = [512, 1024, 1536, 2560];
      let processedAudio = audioChunk;
      
      // Find the closest target size
      let targetSize = targetSizes[0];
      for (const size of targetSizes) {
        if (audioChunk.length >= size) {
          targetSize = size;
        } else {
          break;
        }
      }
      
      // Pad or truncate to target size
      if (audioChunk.length !== targetSize) {
        processedAudio = new Float32Array(targetSize);
        if (audioChunk.length > targetSize) {
          // Take the last targetSize samples
          processedAudio.set(audioChunk.slice(-targetSize));
        } else {
          // Pad with zeros
          processedAudio.set(audioChunk);
        }
      }

      // Prepare input tensor: shape [1, targetSize]
      // ONNX Runtime expects Float32Array and shape array
      if (!this.ort) {
        throw new Error('ONNX Runtime not loaded');
      }
      const inputTensor = new this.ort.Tensor('float32', new Float32Array(processedAudio), [1, targetSize]);
      
      // Run inference - Silero VAD input name is typically 'input' or 'waveform'
      const inputName = this.session.inputNames[0] || 'input';
      const results = await this.session.run({ [inputName]: inputTensor });
      
      // Silero VAD outputs a single probability value
      // Output shape is typically [1, 1] for speech probability
      // Or [1, 2] for [NO_SPEECH, SPEECH] probabilities
      let speechProbability = 0;
      
      // Get the output tensor (usually first output or named 'output')
      const outputName = this.session.outputNames[0] || 'output';
      const outputTensor = results[outputName];
      
      if (outputTensor) {
        const data = outputTensor.data;
        
        if (data instanceof Float32Array || data instanceof Float64Array) {
          // If output is [NO_SPEECH, SPEECH], take the SPEECH probability (index 1)
          // Or if it's a single value, use it directly
          if (data.length >= 2) {
            speechProbability = data[1]; // SPEECH probability
          } else if (data.length === 1) {
            speechProbability = data[0];
          }
        } else if (Array.isArray(data)) {
          if (data.length >= 2) {
            speechProbability = data[1];
          } else if (data.length === 1) {
            speechProbability = data[0];
          }
        } else if (typeof data === 'number') {
          speechProbability = data;
        }
      }

      // Update state machine
      const vadEvent = this.updateState(speechProbability);
      const chunkDurationMs = (audioChunk.length / this.sampleRate) * 1000;

      let pauseDetected = false;

      // Handle state transitions
      switch (vadEvent.type) {
        case 'speech_start':
          this.speechDetected = true;
          this.accumulatedSilenceMs = 0;
          this.silenceTimer = null;
          break;

        case 'speech_active':
          if (this.speechDetected) {
            this.accumulatedSilenceMs = 0;
            this.silenceTimer = null;
          }
          break;

        case 'speech_end':
          pauseDetected = true;
          this.speechDetected = false;
          this.accumulatedSilenceMs = 0;
          this.silenceTimer = null;
          break;
      }

      // Check for pause based on silence duration
      if (this.speechDetected && speechProbability < this.speechProbThreshold) {
        if (!this.silenceTimer) {
          this.silenceTimer = { start: Date.now() };
        }
        this.accumulatedSilenceMs += chunkDurationMs;

        if (this.accumulatedSilenceMs >= this.minSilenceDurationMs) {
          pauseDetected = true;
          this.speechDetected = false;
          this.accumulatedSilenceMs = 0;
          this.silenceTimer = null;
        }
      }

      const speechActive = this.speechDetected || speechProbability >= this.speechProbThreshold;

      if (process.env.DEBUG_AUDIO === 'true') {
        console.log('[SileroVAD] result:', {
          probability: speechProbability.toFixed(3),
          state: this.state,
          speechActive,
          pauseDetected,
          accumulatedSilence: this.accumulatedSilenceMs.toFixed(0) + 'ms',
        });
      }

      return {
        speech: speechActive,
        pause: pauseDetected,
      };
    } catch (error) {
      console.error('[SileroVAD] Error processing audio chunk:', error);
      return { speech: false, pause: false };
    }
  }

  private updateState(probability: number): VADEvent {
    const previousState = this.state;

    switch (this.state) {
      case VadState.IDLE:
        if (probability > this.speechProbThreshold) {
          this.state = VadState.SPEECH_START;
          return { type: 'speech_start', probability };
        }
        break;

      case VadState.SPEECH_START:
        this.state = VadState.SPEAKING;
        return { type: 'speech_active', probability };

      case VadState.SPEAKING:
        if (probability < this.speechProbThreshold) {
          this.state = VadState.POSSIBLE_END;
          // Don't emit speech_end immediately, wait for confirmation
          return { type: 'speech_active', probability };
        }
        return { type: 'speech_active', probability };

      case VadState.POSSIBLE_END:
        if (probability > this.speechProbThreshold) {
          // Speech resumed, not actually ended
          this.state = VadState.SPEAKING;
          return { type: 'speech_active', probability };
        } else {
          // Confirmed end of speech
          this.state = VadState.IDLE;
          return { type: 'speech_end', probability };
        }
    }

    return { type: 'speech_active', probability };
  }

  private normalizeInitializationError(error: unknown): Error {
    if (error instanceof Error) {
      if (error.message.includes('Unauthorized access to file') || error.message.includes('not found')) {
        const hint =
          'Please download the model manually: huggingface-cli download freddyaboulton/silero-vad silero_vad.onnx --local-dir ./models/silero-vad';
        return new Error(`${error.message}. ${hint}`);
      }
      return error;
    }

    return new Error('Unknown error during Silero VAD initialization');
  }
}



