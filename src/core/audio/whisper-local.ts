// Dynamic import for ES module support
let pipeline: any;
let env: any;

async function loadTransformers() {
  if (!pipeline || !env) {
    // Use Function constructor to force true dynamic import (not transformed by TypeScript)
    const importTransformers = new Function('specifier', 'return import(specifier)');
    const transformers = await importTransformers('@xenova/transformers');
    pipeline = transformers.pipeline;
    env = transformers.env;
    
    // Disable local model files to use CDN
    env.allowLocalModels = false;
    env.allowRemoteModels = true;
  }
  return { pipeline, env };
}

export class LocalWhisper {
  private model: any = null;
  private processor: any = null;
  private isInitialized = false;
  private modelSize: 'tiny' | 'base' = 'tiny';

  async initialize(modelSize: 'tiny' | 'base' = 'tiny'): Promise<void> {
    if (this.isInitialized && this.modelSize === modelSize) {
      return;
    }

    this.modelSize = modelSize;
    const modelName = `Xenova/whisper-${modelSize}`;

    try {
      console.log(`Loading Whisper model: ${modelName}`);
      
      // Load transformers dynamically
      const { pipeline: pipelineFn } = await loadTransformers();
      
      // Load the model and processor
      this.processor = await pipelineFn(
        'automatic-speech-recognition',
        modelName,
        {
          quantized: true, // Use quantized models for faster loading
        }
      );

      this.isInitialized = true;
      console.log('Whisper model loaded successfully');
    } catch (error) {
      console.error('Failed to load Whisper model:', error);
      throw new Error(`Failed to initialize Whisper: ${error}`);
    }
  }

  async transcribe(audioChunk: Float32Array, sampleRate: number = 16000): Promise<string> {
    if (!this.isInitialized) {
      await this.initialize();
    }

    try {
      // Convert Float32Array to format expected by transformers
      // The pipeline expects audio in a specific format
      const audioData = {
        raw: audioChunk,
        sampling_rate: sampleRate,
      };

      const result = await this.processor(audioData, {
        return_timestamps: false,
        chunk_length_s: 30,
      });

      return result.text || '';
    } catch (error) {
      console.error('Whisper transcription error:', error);
      throw new Error(`Transcription failed: ${error}`);
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

