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

  async transcribe(audioChunk: Float32Array<ArrayBufferLike>, sampleRate: number = 16000): Promise<string> {
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
        console.log(`[whisper] transcribing ${audioChunk.length} samples at ${sampleRate}Hz (${audioChunk.length / sampleRate}s)`);
        console.log(`[whisper] audio data stats:`, {
          length: audioChunk.length,
          max: Math.max(...Array.from(audioChunk)),
          min: Math.min(...Array.from(audioChunk)),
          avg: audioChunk.reduce((sum, val) => sum + Math.abs(val), 0) / audioChunk.length,
          sampleRate: sampleRate,
          expectedDuration: audioChunk.length / sampleRate
        });
      }

      // Try to get model info for debugging
      if (this.processor && this.processor.model && process.env.DEBUG_AUDIO === 'true') {
        try {
          const model = this.processor.model;
          if (model.inputs) {
            console.log('[whisper] Model input names:', model.inputs.map((inp: any) => inp.name || inp));
          }
          if (model.session && model.session.inputNames) {
            console.log('[whisper] ONNX session input names:', model.session.inputNames);
          }
        } catch (debugError) {
          // Ignore debug errors
        }
      }

      const result = await this.processor(audioChunk, {
        return_timestamps: false,
        sampling_rate: sampleRate,
        language: 'english',
        task: 'transcribe',
      });

      if (process.env.DEBUG_AUDIO === 'true') {
        console.log(`[whisper] result:`, result);
        console.log(`[whisper] extracted text: "${result.text}"`);
      }

      return result.text || '';
    } catch (error) {
      console.error('Whisper transcription error:', error);
      
      // Enhanced error logging for input name issues
      if (error instanceof Error && error.message.includes('Invalid input name')) {
        console.error('[whisper] Input name error detected. Attempting to inspect model inputs...');
        try {
          if (this.processor?.model?.session) {
            const session = this.processor.model.session;
            console.error('[whisper] Expected input names:', session.inputNames || 'unknown');
            console.error('[whisper] Model metadata:', {
              inputNames: session.inputNames,
              outputNames: session.outputNames,
            });
          }
          // Also check processor model structure
          if (this.processor?.model) {
            console.error('[whisper] Processor model keys:', Object.keys(this.processor.model));
            if (this.processor.model.model) {
              console.error('[whisper] Nested model keys:', Object.keys(this.processor.model.model));
            }
          }
        } catch (inspectError) {
          console.error('[whisper] Could not inspect model:', inspectError);
        }
        
        // Suggest clearing cache and retrying
        console.error('[whisper] This might be a model cache issue. Try clearing the transformers cache:');
        console.error('[whisper]   rm -rf ~/.cache/ai-consul/transformers');
        console.error('[whisper]   or set TRANSFORMERS_CACHE environment variable');
      }
      
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

