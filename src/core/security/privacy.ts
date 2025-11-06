interface PrivacyConfig {
  offlineFirst: boolean;
  cloudFallback: boolean;
  dataRetention: number; // days
}

export class SecureDataFlow {
  private privacyConfig: PrivacyConfig;
  private audioBuffers: Float32Array[] = [];
  private transcriptCache: string[] = [];

  constructor(privacyConfig: PrivacyConfig) {
    this.privacyConfig = privacyConfig;
  }

  async processSensitiveData(audioChunk: Float32Array): Promise<Float32Array> {
    // Store audio chunk temporarily
    this.audioBuffers.push(audioChunk);

    // Process locally first (always)
    return audioChunk;

    // Cloud processing would be handled by the calling code
    // based on privacyConfig.cloudFallback
  }

  async cleanupSensitiveData(): Promise<void> {
    // Securely wipe memory (best effort)
    this.secureWipe(this.audioBuffers);
    this.secureWipe(this.transcriptCache);

    // Clear arrays
    this.audioBuffers = [];
    this.transcriptCache = [];
  }

  private secureWipe<T extends any[]>(data: T): void {
    // Best effort memory wiping
    // In JavaScript, we can't guarantee memory is actually zeroed,
    // but we can clear references and overwrite
    if (Array.isArray(data)) {
      for (let i = 0; i < data.length; i++) {
        if (data[i] instanceof Float32Array) {
          data[i].fill(0);
        } else if (typeof data[i] === 'string') {
          data[i] = '';
        }
      }
    }
  }

  shouldUseCloud(): boolean {
    return this.privacyConfig.cloudFallback && !this.privacyConfig.offlineFirst;
  }
}

