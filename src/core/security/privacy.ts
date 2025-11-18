interface PrivacyConfig {
  offlineFirst: boolean;
  cloudFallback: boolean;
  dataRetention: number; // days
}

export class SecureDataFlow {
  private privacyConfig: PrivacyConfig;
  private audioBuffers: Float32Array[] = [];
  private transcriptCache: string[] = [];
  private retentionTimer: NodeJS.Timeout | null = null;

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

  /**
   * Start data retention timer
   * Automatically cleans up sensitive data after retention period expires
   */
  startRetentionTimer(): void {
    this.stopRetentionTimer(); // Clear any existing timer

    const retentionMs = this.privacyConfig.dataRetention * 24 * 60 * 60 * 1000;

    this.retentionTimer = setTimeout(() => {
      this.cleanupSensitiveData();
      console.log('[privacy] Data retention period expired, cleaned up sensitive data');
    }, retentionMs);
  }

  /**
   * Stop data retention timer
   */
  stopRetentionTimer(): void {
    if (this.retentionTimer) {
      clearTimeout(this.retentionTimer);
      this.retentionTimer = null;
    }
  }

  async cleanupSensitiveData(): Promise<void> {
    // Stop retention timer if running
    this.stopRetentionTimer();

    // Securely wipe memory (best effort)
    this.secureWipe(this.audioBuffers);
    this.secureWipe(this.transcriptCache);

    // Clear arrays
    this.audioBuffers = [];
    this.transcriptCache = [];
  }

  /**
   * Secure wipe - JavaScript limitations
   *
   * Note: JavaScript/Node.js cannot guarantee memory is actually zeroed
   * due to garbage collection and memory management. For true secure wiping,
   * consider:
   *
   * 1. Using native modules (C++ addon) for memory operations
   * 2. Minimizing sensitive data retention time
   * 3. Using secure memory allocators (if available)
   * 4. Running in a secure environment with memory protection
   *
   * This implementation provides best-effort clearing with multi-pass wiping
   * to reduce the likelihood of data recovery from memory dumps.
   *
   * @param data - Array of sensitive data to wipe
   */
  private secureWipe<T extends any[]>(data: T): void {
    if (!Array.isArray(data) || data.length === 0) {
      return;
    }

    // Multi-pass wiping (paranoid mode)
    // Pass 1: Fill with random data
    // Pass 2: Fill with zeros
    // Pass 3: Fill with ones (invert pattern)
    // Pass 4: Final zero fill

    for (let pass = 0; pass < 4; pass++) {
      for (let i = 0; i < data.length; i++) {
        if (data[i] instanceof Float32Array) {
          const buffer = data[i];
          switch (pass) {
            case 0:
              // Fill with random data
              for (let j = 0; j < buffer.length; j++) {
                buffer[j] = Math.random() * 2 - 1; // Random float between -1 and 1
              }
              break;
            case 1:
              // Fill with zeros
              buffer.fill(0);
              break;
            case 2:
              // Fill with ones (invert pattern)
              buffer.fill(1);
              break;
            case 3:
              // Final zero fill
              buffer.fill(0);
              break;
          }
        } else if (typeof data[i] === 'string') {
          // For strings, overwrite with random characters then clear
          if (pass === 0) {
            // Overwrite with random characters
            data[i] = 'x'.repeat(data[i].length);
          } else {
            // Clear string
            data[i] = '';
          }
        } else if (data[i] && typeof data[i] === 'object') {
          // Recursively wipe object properties
          this.secureWipeObject(data[i], pass);
        }
      }
    }

    // Clear references
    data.length = 0;
  }

  /**
   * Recursively wipe object properties
   */
  private secureWipeObject(obj: any, pass: number): void {
    if (!obj || typeof obj !== 'object') {
      return;
    }

    for (const key in obj) {
      if (Object.prototype.hasOwnProperty.call(obj, key)) {
        const value = obj[key];

        if (value instanceof Float32Array) {
          if (pass === 0) {
            value.fill(Math.random() * 2 - 1);
          } else {
            value.fill(0);
          }
        } else if (typeof value === 'string') {
          if (pass === 0) {
            obj[key] = 'x'.repeat(value.length);
          } else {
            obj[key] = '';
          }
        } else if (Array.isArray(value)) {
          this.secureWipe(value);
        } else if (value && typeof value === 'object') {
          this.secureWipeObject(value, pass);
        } else {
          // For primitives, set to zero/null
          obj[key] = null;
        }
      }
    }
  }

  shouldUseCloud(): boolean {
    return this.privacyConfig.cloudFallback && !this.privacyConfig.offlineFirst;
  }
}

