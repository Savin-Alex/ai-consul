import { loadTransformers } from './transformers';

export class LocalWhisper {
  private model: any = null;
  private processor: any = null;
  private isInitialized = false;
  private modelSize: 'tiny' | 'base' | 'small' = 'base';
  private initializationPromise: Promise<void> | null = null;

  async initialize(modelSize: 'tiny' | 'base' | 'small' = 'base'): Promise<void> {
    if (this.isInitialized && this.modelSize === modelSize) {
      return;
    }

    if (this.initializationPromise && this.modelSize === modelSize) {
      return this.initializationPromise;
    }

    this.modelSize = modelSize;
    const modelName = `Xenova/whisper-${modelSize}`;

    this.initializationPromise = (async () => {
      try {
        console.log(`Loading Whisper model: ${modelName}`);

        const { pipeline: pipelineFn } = await loadTransformers();

        this.processor = await pipelineFn(
          'automatic-speech-recognition',
          modelName,
          {
            quantized: true,
          }
        );

        this.isInitialized = true;
        console.log('Whisper model loaded successfully');
      } catch (error) {
        console.error('Failed to load Whisper model:', error);
        throw new Error(`Failed to initialize Whisper: ${error}`);
      } finally {
        this.initializationPromise = null;
      }
    })();

    return this.initializationPromise;
  }

  async transcribe(audioChunk: Float32Array, sampleRate: number = 16000): Promise<string> {
    if (!audioChunk || audioChunk.length === 0) {
      if (process.env.DEBUG_AUDIO === 'true') {
        console.warn('[whisper] Received empty audio buffer, skipping transcription.');
      }
      return '';
    }

    // Ensure model is fully initialized before transcribing
    if (!this.isInitialized) {
      await this.initialize();
    } else if (this.initializationPromise) {
      // Wait for ongoing initialization to complete
      await this.initializationPromise;
    }

    // Double-check processor is ready
    if (!this.processor) {
      throw new Error('Whisper processor is not available. Model may not be fully initialized.');
    }

    try {
      if (process.env.DEBUG_AUDIO === 'true') {
        // Calculate max/min safely (avoid stack overflow with large arrays)
        let max = -Infinity;
        let min = Infinity;
        for (let i = 0; i < audioChunk.length; i++) {
          const val = audioChunk[i];
          if (val > max) max = val;
          if (val < min) min = val;
        }
        
        console.log(`[whisper] transcribing ${audioChunk.length} samples at ${sampleRate}Hz (${audioChunk.length / sampleRate}s)`);
        console.log(`[whisper] audio data stats:`, {
          length: audioChunk.length,
          max: max,
          min: min,
          avg: audioChunk.reduce((sum, val) => sum + Math.abs(val), 0) / audioChunk.length,
          sampleRate: sampleRate,
          expectedDuration: audioChunk.length / sampleRate
        });
      }

      // Normalize audio amplitude if too quiet (helps Whisper detect speech better)
      // Whisper works better with normalized audio - low amplitude can cause hallucinations
      let normalizedAudio = audioChunk;
      let maxAmplitude = 0;
      for (let i = 0; i < audioChunk.length; i++) {
        const abs = Math.abs(audioChunk[i]);
        if (abs > maxAmplitude) maxAmplitude = abs;
      }
      
      if (maxAmplitude > 0 && maxAmplitude < 0.1) {
        // Audio is too quiet, normalize to reasonable level (50% of max range)
        // This helps Whisper distinguish speech from background noise
        const targetMax = 0.5;
        const scaleFactor = targetMax / maxAmplitude;
        normalizedAudio = new Float32Array(audioChunk.length);
        let newMax = 0;
        for (let i = 0; i < audioChunk.length; i++) {
          const scaled = audioChunk[i] * scaleFactor;
          normalizedAudio[i] = Math.max(-1, Math.min(1, scaled));
          const abs = Math.abs(normalizedAudio[i]);
          if (abs > newMax) newMax = abs;
        }
        
        console.log(`[whisper] Audio normalized (too quiet): ${maxAmplitude.toFixed(4)} -> ${newMax.toFixed(4)}`);
      }

      // Use basic parameters - transformers.js may not support all Whisper parameters
      // Audio normalization above should help reduce hallucinations from quiet audio
      const transcriptionOptions: any = {
        return_timestamps: false,
        sampling_rate: sampleRate,
        language: 'english',
        task: 'transcribe',
      };

      // Try to add prompt if supported (some versions of transformers.js support this)
      // If not supported, it will be ignored silently
      transcriptionOptions.initial_prompt = "This is a conversation. The person is speaking clearly.";

      const result = await this.processor(normalizedAudio, transcriptionOptions);

      if (process.env.DEBUG_AUDIO === 'true') {
        console.log(`[whisper] result:`, result);
        console.log(`[whisper] extracted text: "${result.text}"`);
      }

      return result.text || '';
    } catch (error) {
      console.error('Whisper transcription error:', error);
      if (error instanceof Error) {
        console.error('Whisper transcription stack:', error.stack);
        throw new Error(`Transcription failed: ${error.message}`);
      }
      throw new Error(`Transcription failed: ${String(error)}`);
    }
  }

  async transcribeBatch(audioChunks: Float32Array[], sampleRate: number = 16000): Promise<string[]> {
    const results: string[] = [];
    
    for (const chunk of audioChunks) {
      try {
        const text = await this.transcribe(chunk, sampleRate);
        if (text) {
          results.push(text);
        }
      } catch (error) {
        console.error('Batch transcription error:', error);
        // Continue with next chunk
      }
    }

    return results;
  }

  getIsInitialized(): boolean {
    return this.isInitialized;
  }
}

