/**
 * Whisper.cpp Implementation
 * High-performance C++ implementation of Whisper for local transcription
 * Uses whisper.cpp models (GGML format) for efficient on-device transcription
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { spawn } from 'child_process';
import { tmpdir } from 'os';
import { randomBytes } from 'crypto';

export class WhisperCpp {
  private modelPath: string | null = null;
  private modelSize: 'tiny' | 'base' | 'small' | 'medium' = 'base';
  private isInitialized = false;
  private initializationPromise: Promise<void> | null = null;
  private binaryPath: string | null = null;

  /**
   * Initialize whisper.cpp with a model
   * @param modelSize - Size of the model to use
   * @param modelPath - Optional path to a specific model file
   */
  async initialize(
    modelSize: 'tiny' | 'base' | 'small' | 'medium' = 'base',
    modelPath?: string
  ): Promise<void> {
    if (this.isInitialized && this.modelSize === modelSize && !modelPath) {
      return;
    }

    if (this.initializationPromise && this.modelSize === modelSize && !modelPath) {
      return this.initializationPromise;
    }

    this.modelSize = modelSize;

    this.initializationPromise = (async () => {
      try {
        console.log(`[whisper-cpp] Initializing with model size: ${modelSize}`);

        // Find or download model
        if (modelPath) {
          this.modelPath = path.resolve(modelPath);
        } else {
          this.modelPath = await this.findOrDownloadModel(modelSize);
        }

        if (!this.modelPath || !fs.existsSync(this.modelPath)) {
          throw new Error(
            `Whisper model not found: ${this.modelPath}. Please download it manually or set WHISPER_MODEL_PATH.`
          );
        }

        // Find whisper.cpp binary
        this.binaryPath = await this.findWhisperBinary();

        if (!this.binaryPath || !fs.existsSync(this.binaryPath)) {
          throw new Error(
            `Whisper.cpp binary not found at: ${this.binaryPath}. ` +
            `Please build whisper.cpp: git clone https://github.com/ggerganov/whisper.cpp.git && cd whisper.cpp && make`
          );
        }

        this.isInitialized = true;
        console.log(`[whisper-cpp] Initialized with model: ${this.modelPath}`);
      } catch (error) {
        console.error('[whisper-cpp] Failed to initialize:', error);
        throw new Error(`Failed to initialize Whisper.cpp: ${error}`);
      } finally {
        this.initializationPromise = null;
      }
    })();

    return this.initializationPromise;
  }

  /**
   * Find or download a Whisper model
   */
  private async findOrDownloadModel(
    modelSize: 'tiny' | 'base' | 'small' | 'medium'
  ): Promise<string> {
    // Support both standard and quantized models
    const modelName = `ggml-${modelSize}.bin`;
    const modelNameEn = `ggml-${modelSize}.en.bin`; // English-only models are smaller
    const quantizedNames = [
      `ggml-${modelSize}-q5_1.bin`,
      `ggml-${modelSize}-q8_0.bin`,
    ];

    // Check common model locations
    // Priority: whisper.cpp/models > project models > cache
    const possiblePaths = [
      // Environment variable (highest priority)
      process.env.WHISPER_MODEL_PATH,
      // whisper.cpp models directory (if cloned in project)
      path.join(process.cwd(), 'whisper.cpp', 'models', modelName),
      ...quantizedNames.map(name => path.join(process.cwd(), 'whisper.cpp', 'models', name)),
      // Project models directory
      path.join(process.cwd(), 'models', 'whisper', modelName),
      path.join(process.cwd(), 'models', 'whisper', modelNameEn),
      ...quantizedNames.map(name => path.join(process.cwd(), 'models', 'whisper', name)),
      // User cache directory
      path.join(os.homedir(), '.cache', 'ai-consul', 'whisper', modelName),
      path.join(os.homedir(), '.cache', 'ai-consul', 'whisper', modelNameEn),
      // System-wide cache
      path.join(os.tmpdir(), 'ai-consul', 'whisper', modelName),
    ];

    for (const modelPath of possiblePaths) {
      if (modelPath && fs.existsSync(modelPath)) {
        console.log(`[whisper-cpp] Found model at: ${modelPath}`);
        return modelPath;
      }
    }

    // Model not found - provide instructions
    const suggestedPath = path.join(process.cwd(), 'models', 'whisper', modelName);
    console.warn(
      `[whisper-cpp] Model not found. Please download it to: ${suggestedPath}`
    );
    console.warn(
      `[whisper-cpp] Download from: https://huggingface.co/ggerganov/whisper.cpp/tree/main`
    );
    console.warn(
      `[whisper-cpp] Or use: curl -L -o ${suggestedPath} https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-${modelSize}.bin`
    );

    return suggestedPath; // Return suggested path even if it doesn't exist yet
  }

  /**
   * Find whisper.cpp binary
   * Checks common locations where whisper.cpp might be built
   */
  private async findWhisperBinary(): Promise<string | null> {
    // Check common locations relative to project
    // Note: whisper-cli is the recommended binary (main is deprecated)
    const possiblePaths = [
      // Environment variable (highest priority)
      process.env.WHISPER_CPP_BINARY,
      // In project directory - whisper-cli (recommended)
      path.join(process.cwd(), 'whisper.cpp', 'build', 'bin', 'whisper-cli'),
      // In project directory - main (deprecated but still works)
      path.join(process.cwd(), 'whisper.cpp', 'build', 'bin', 'main'),
      // Alternative locations
      path.join(process.cwd(), 'whisper.cpp', 'main'),
      path.join(process.cwd(), '..', 'whisper.cpp', 'build', 'bin', 'whisper-cli'),
      path.join(process.cwd(), '..', 'whisper.cpp', 'build', 'bin', 'main'),
      // System-wide installation (check last)
      'whisper-cli',
      'whisper',
    ].filter(Boolean) as string[];

    for (const binPath of possiblePaths) {
      if (binPath === 'whisper') {
        // Check if it's in PATH
        try {
          const { execFile } = await import('child_process');
          const { promisify } = await import('util');
          const execFileAsync = promisify(execFile);
          await execFileAsync('which', ['whisper']);
          return 'whisper';
        } catch {
          continue;
        }
      }

      if (binPath && fs.existsSync(binPath)) {
        // Check if it's executable
        try {
          fs.accessSync(binPath, fs.constants.X_OK);
          console.log(`[whisper-cpp] Found binary at: ${binPath}`);
          return binPath;
        } catch {
          // Not executable, but exists - might still work on some systems
          console.log(`[whisper-cpp] Found binary at: ${binPath} (may need chmod +x)`);
          return binPath;
        }
      }
    }

    return null;
  }

  /**
   * Transcribe audio using whisper.cpp
   * @param audioChunk - Audio data as Float32Array
   * @param sampleRate - Sample rate of the audio (default: 16000)
   * @param language - Language code (e.g., 'en', 'ru', 'auto'). Default: 'en'
   * @returns Transcribed text
   */
  async transcribe(
    audioChunk: Float32Array,
    sampleRate: number = 16000,
    language: string = 'en'
  ): Promise<string> {
    if (!audioChunk || audioChunk.length === 0) {
      if (process.env.DEBUG_AUDIO === 'true') {
        console.warn('[whisper-cpp] Received empty audio buffer, skipping transcription.');
      }
      return '';
    }

    // Ensure model is initialized
    if (!this.isInitialized) {
      await this.initialize();
    } else if (this.initializationPromise) {
      await this.initializationPromise;
    }

    if (!this.modelPath || !fs.existsSync(this.modelPath)) {
      throw new Error('Whisper model not available. Please initialize first.');
    }

    try {
      if (process.env.DEBUG_AUDIO === 'true') {
        console.log(
          `[whisper-cpp] transcribing ${audioChunk.length} samples at ${sampleRate}Hz (${audioChunk.length / sampleRate}s)`
        );
      }

      // Convert Float32Array to WAV format
      const wavBuffer = this.float32ToWav(audioChunk, sampleRate);

      // Save to temporary file
      const tempFile = path.join(
        tmpdir(),
        `whisper-${randomBytes(8).toString('hex')}.wav`
      );
      fs.writeFileSync(tempFile, wavBuffer);

      try {
        // Use whisper.cpp binary
        if (!this.binaryPath) {
          throw new Error('Whisper.cpp binary not initialized');
        }
        return await this.transcribeWithBinary(tempFile, language);
      } finally {
        // Clean up temp file
        try {
          fs.unlinkSync(tempFile);
        } catch (cleanupError) {
          console.warn('[whisper-cpp] Failed to cleanup temp file:', cleanupError);
        }
      }
    } catch (error) {
      console.error('[whisper-cpp] Transcription error:', error);
      if (error instanceof Error) {
        throw new Error(`Transcription failed: ${error.message}`);
      }
      throw new Error(`Transcription failed: ${String(error)}`);
    }
  }

  /**
   * Transcribe using whisper.cpp binary via spawn
   */
  private async transcribeWithBinary(audioFile: string, language: string = 'en'): Promise<string> {
    if (!this.binaryPath || !this.modelPath) {
      throw new Error('Whisper binary or model not available');
    }

    return new Promise((resolve, reject) => {
      const args = [
        '-m',
        this.modelPath,
        '-f',
        audioFile,
        '-l',
        language, // Language code (en, ru, auto, etc.)
        '--no-timestamps', // Remove timestamps
        '-t',
        '4', // Thread count (adjust based on CPU cores)
        '--print-colors',
        'false', // Disable colored output
        // Note: -otxt writes to file, we'll read from stdout instead
      ];

      if (process.env.DEBUG_AUDIO === 'true') {
        console.log(`[whisper-cpp] Running: ${this.binaryPath} ${args.join(' ')}`);
      }

      const proc = spawn(this.binaryPath, args);
      let stdout = '';
      let stderr = '';

      proc.stdout.on('data', (data) => {
        stdout += data.toString();
      });

      proc.stderr.on('data', (data) => {
        stderr += data.toString();
      });

      proc.on('close', (code) => {
        if (code === 0) {
          // Parse output - whisper.cpp outputs text to stdout
          // It may also create a .txt file if -otxt is used, but we're not using that flag
          let text = stdout.trim();
          
          // Sometimes whisper.cpp outputs to stderr instead of stdout
          if (!text && stderr) {
            // Filter out non-text lines (like progress indicators)
            const stderrLines = stderr.split('\n').filter((line) => {
              const trimmed = line.trim();
              // Skip lines that look like progress or metadata
              return trimmed && 
                     !trimmed.startsWith('whisper_model_load:') &&
                     !trimmed.startsWith('system_info:') &&
                     !trimmed.match(/^\d+%$/);
            });
            text = stderrLines.join(' ').trim();
          }

          // If still no text, check if a .txt file was created (some versions create it anyway)
          if (!text) {
            const txtFile = audioFile.replace(/\.wav$/, '.txt');
            if (fs.existsSync(txtFile)) {
              text = fs.readFileSync(txtFile, 'utf-8').trim();
              // Clean up the txt file
              try {
                fs.unlinkSync(txtFile);
              } catch {
                // Ignore cleanup errors
              }
            }
          }
          
          if (process.env.DEBUG_AUDIO === 'true') {
            console.log(`[whisper-cpp] Transcription result: "${text}"`);
            if (stderr && stderr.trim()) {
              console.log(`[whisper-cpp] stderr output: ${stderr.substring(0, 200)}`);
            }
          }

          resolve(text || '');
        } else {
          const errorMsg = stderr || `whisper.cpp exited with code ${code}`;
          console.error(`[whisper-cpp] Error: ${errorMsg}`);
          // Sometimes whisper.cpp returns non-zero but still produces output
          if (stdout.trim()) {
            resolve(stdout.trim());
          } else {
            reject(new Error(`Whisper.cpp transcription failed: ${errorMsg}`));
          }
        }
      });

      proc.on('error', (error) => {
        console.error('[whisper-cpp] Process error:', error);
        reject(new Error(`Failed to spawn whisper.cpp process: ${error.message}`));
      });
    });
  }

  /**
   * Convert Float32Array to WAV format
   */
  private float32ToWav(float32Array: Float32Array, sampleRate: number): Buffer {
    const length = float32Array.length;
    const buffer = Buffer.allocUnsafe(44 + length * 2); // WAV header + 16-bit PCM data

    // WAV header
    buffer.write('RIFF', 0);
    buffer.writeUInt32LE(36 + length * 2, 4); // File size - 8
    buffer.write('WAVE', 8);
    buffer.write('fmt ', 12);
    buffer.writeUInt32LE(16, 16); // Subchunk1Size
    buffer.writeUInt16LE(1, 20); // AudioFormat (PCM)
    buffer.writeUInt16LE(1, 22); // NumChannels (mono)
    buffer.writeUInt32LE(sampleRate, 24); // SampleRate
    buffer.writeUInt32LE(sampleRate * 2, 28); // ByteRate
    buffer.writeUInt16LE(2, 32); // BlockAlign
    buffer.writeUInt16LE(16, 34); // BitsPerSample
    buffer.write('data', 36);
    buffer.writeUInt32LE(length * 2, 40); // Subchunk2Size

    // Convert float32 (-1.0 to 1.0) to int16 (-32768 to 32767)
    for (let i = 0; i < length; i++) {
      const sample = Math.max(-1, Math.min(1, float32Array[i]));
      const int16 = sample < 0 ? sample * 0x8000 : sample * 0x7fff;
      buffer.writeInt16LE(int16, 44 + i * 2);
    }

    return buffer;
  }

  /**
   * Transcribe multiple audio chunks in batch
   */
  async transcribeBatch(
    audioChunks: Float32Array[],
    sampleRate: number = 16000
  ): Promise<string[]> {
    const results: string[] = [];

    for (const chunk of audioChunks) {
      try {
        const text = await this.transcribe(chunk, sampleRate);
        if (text) {
          results.push(text);
        }
      } catch (error) {
        console.error('[whisper-cpp] Batch transcription error:', error);
        // Continue with next chunk
      }
    }

    return results;
  }

  getIsInitialized(): boolean {
    return this.isInitialized;
  }

  getModelPath(): string | null {
    return this.modelPath;
  }
}

