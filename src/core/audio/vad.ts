import { VADProvider, VADResult } from './vad-provider';
import { DefaultVADProvider } from './vad-default';
import { SileroVADProvider } from './vad-silero';
import { VADProviderType } from '../config/transcription';

// Re-export VADResult for backward compatibility
export type { VADResult };

export class VADProcessor {
  private provider: VADProvider | null = null;
  private providerType: VADProviderType = 'default';
  private initializationPromise: Promise<void> | null = null;

  constructor(providerType: VADProviderType = 'default') {
    this.providerType = providerType;
    this.initializationPromise = this.initialize();
  }

  /**
   * Create a VAD provider instance based on type
   */
  private createProvider(type: VADProviderType): VADProvider {
    switch (type) {
      case 'silero':
        return new SileroVADProvider();
      case 'default':
      default:
        return new DefaultVADProvider();
    }
  }

  private async initialize(): Promise<void> {
    if (this.provider) {
      return;
    }

    try {
      console.log(`[VAD] Initializing ${this.providerType} VAD provider...`);
      this.provider = this.createProvider(this.providerType);
      await this.provider.initialize();
      console.log(`[VAD] ${this.providerType} VAD provider initialized`);
    } catch (error) {
      console.error(`[VAD] Failed to initialize ${this.providerType} VAD provider:`, error);
      // Fallback to default provider if Silero fails
      if (this.providerType !== 'default') {
        console.warn('[VAD] Falling back to default VAD provider');
        this.providerType = 'default';
        this.provider = this.createProvider('default');
        await this.provider.initialize();
      } else {
        throw error;
      }
    } finally {
      this.initializationPromise = null;
    }
  }

  public async isReady(): Promise<void> {
    if (!this.provider) {
      if (!this.initializationPromise) {
        this.initializationPromise = this.initialize();
      }
      return this.initializationPromise;
    }

    return this.provider.isReady();
  }

  public resetState(): void {
    if (this.provider) {
      this.provider.resetState();
      if (process.env.DEBUG_AUDIO === 'true') {
        console.log(`[VAD] State reset (provider: ${this.provider.getName()})`);
      }
    }
  }

  public async process(audioChunk: Float32Array, maxAmplitude?: number): Promise<VADResult> {
    if (!audioChunk || audioChunk.length === 0) {
      if (process.env.DEBUG_AUDIO === 'true') {
        console.warn('[VAD] Received empty audio chunk, skipping.');
      }
      return { speech: false, pause: false };
    }

    if (!this.provider) {
      await this.isReady();
    }

    if (!this.provider) {
      console.warn('[VAD] Provider unavailable');
      return { speech: false, pause: false };
    }

    try {
      return await this.provider.process(audioChunk, maxAmplitude);
    } catch (error) {
      console.error('[VAD] Error processing audio chunk:', error);
      return { speech: false, pause: false };
    }
  }

  /**
   * Get the current provider name
   */
  public getProviderName(): string {
    return this.provider?.getName() || this.providerType;
  }
}

