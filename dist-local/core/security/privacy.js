"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.SecureDataFlow = void 0;
class SecureDataFlow {
    privacyConfig;
    audioBuffers = [];
    transcriptCache = [];
    constructor(privacyConfig) {
        this.privacyConfig = privacyConfig;
    }
    async processSensitiveData(audioChunk) {
        // Store audio chunk temporarily
        this.audioBuffers.push(audioChunk);
        // Process locally first (always)
        return audioChunk;
        // Cloud processing would be handled by the calling code
        // based on privacyConfig.cloudFallback
    }
    async cleanupSensitiveData() {
        // Securely wipe memory (best effort)
        this.secureWipe(this.audioBuffers);
        this.secureWipe(this.transcriptCache);
        // Clear arrays
        this.audioBuffers = [];
        this.transcriptCache = [];
    }
    secureWipe(data) {
        // Best effort memory wiping
        // In JavaScript, we can't guarantee memory is actually zeroed,
        // but we can clear references and overwrite
        if (Array.isArray(data)) {
            for (let i = 0; i < data.length; i++) {
                if (data[i] instanceof Float32Array) {
                    data[i].fill(0);
                }
                else if (typeof data[i] === 'string') {
                    data[i] = '';
                }
            }
        }
    }
    shouldUseCloud() {
        return this.privacyConfig.cloudFallback && !this.privacyConfig.offlineFirst;
    }
}
exports.SecureDataFlow = SecureDataFlow;
