/**
 * AssemblyAI Real-Time Streaming Transcription
 * WebSocket-based streaming transcription with sub-second latency
 */

import { RealtimeTranscriber } from 'assemblyai';
import { EventEmitter } from 'events';

export interface StreamingTranscript {
  text: string;
  words?: Array<{
    text: string;
    start: number; // in seconds
    end: number; // in seconds
    confidence: number;
  }>;
  confidence: number;
  isFinal: boolean;
  timestamp: number;
}

export interface ReconnectionConfig {
  enabled: boolean;
  maxRetries: number;
  initialDelay: number; // milliseconds
  maxDelay: number; // milliseconds
  backoffMultiplier: number;
}

const DEFAULT_RECONNECTION_CONFIG: ReconnectionConfig = {
  enabled: true,
  maxRetries: 5,
  initialDelay: 1000, // 1 second
  maxDelay: 30000, // 30 seconds
  backoffMultiplier: 2,
};

export class AssemblyAIStreaming extends EventEmitter {
  private transcriber: RealtimeTranscriber | null = null;
  private apiKey: string;
  private isConnected = false;
  private sampleRate: number = 16000;
  private pendingTranscripts: Map<string, StreamingTranscript> = new Map();
  private transcriptBuffer: string[] = [];
  
  // Reconnection state
  private reconnectionConfig: ReconnectionConfig;
  private reconnectAttempts = 0;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private isReconnecting = false;
  private audioBuffer: Float32Array[] = []; // Buffer audio during disconnection
  private maxBufferDuration = 5000; // 5 seconds of audio
  private maxRecursionDepth = 10; // Prevent infinite recursion
  private currentRecursionDepth = 0;

  constructor(apiKey?: string, reconnectionConfig?: Partial<ReconnectionConfig>) {
    super();
    this.apiKey = apiKey || process.env.ASSEMBLYAI_API_KEY || '';
    if (!this.apiKey) {
      throw new Error('AssemblyAI API key required. Set ASSEMBLYAI_API_KEY environment variable.');
    }
    this.reconnectionConfig = { ...DEFAULT_RECONNECTION_CONFIG, ...reconnectionConfig };
  }

  async connect(): Promise<void> {
    if (this.isConnected && this.transcriber) {
      return;
    }

    try {
      this.transcriber = new RealtimeTranscriber({
        token: this.apiKey,
        sampleRate: this.sampleRate,
        encoding: 'pcm_s16le',
      });

      // Setup event handlers
      this.transcriber.on('open', () => {
        this.isConnected = true;
        this.reconnectAttempts = 0; // Reset on successful connection
        this.isReconnecting = false;
        if (this.reconnectTimer) {
          clearTimeout(this.reconnectTimer);
          this.reconnectTimer = null;
        }
        this.emit('connected');
        console.log('[AssemblyAI] Connected to real-time transcription');
      });

      this.transcriber.on('error', (error: Error) => {
        console.error('[AssemblyAI] Error:', error);
        this.isConnected = false;
        this.emit('error', error);
        this.handleDisconnection();
      });

      this.transcriber.on('close', (code: number, reason: string) => {
        this.isConnected = false;
        console.log('[AssemblyAI] Disconnected:', code, reason);
        this.emit('disconnected', { code, reason });
        this.handleDisconnection();
      });

      this.transcriber.on('transcript', (transcript: any) => {
        this.handleTranscript(transcript);
      });

      // Connect to AssemblyAI
      await this.transcriber.connect();
    } catch (error) {
      console.error('[AssemblyAI] Failed to connect:', error);
      this.isConnected = false;
      throw error;
    }
  }

  private handleTranscript(transcript: any): void {
    if (transcript.message_type === 'PartialTranscript') {
      // Interim result
      const streamingTranscript: StreamingTranscript = {
        text: transcript.text || '',
        confidence: transcript.confidence || 0,
        isFinal: false,
        timestamp: Date.now(),
      };

      this.emit('interim', streamingTranscript);
    } else if (transcript.message_type === 'FinalTranscript') {
      // Final result
      const streamingTranscript: StreamingTranscript = {
        text: transcript.text || '',
        words: transcript.words?.map((w: any) => ({
          text: w.text,
          start: w.start / 1000, // Convert ms to seconds
          end: w.end / 1000,
          confidence: w.confidence || 0,
        })),
        confidence: transcript.confidence || 0,
        isFinal: true,
        timestamp: Date.now(),
      };

      this.transcriptBuffer.push(transcript.text);
      this.emit('final', streamingTranscript);
    }
  }

  async sendAudio(audioChunk: Float32Array): Promise<void> {
    // If not connected, buffer audio for later transmission
    if (!this.transcriber || !this.isConnected) {
      if (this.reconnectionConfig.enabled && !this.isReconnecting) {
        this.bufferAudio(audioChunk);
        // Trigger reconnection if not already attempting
        this.handleDisconnection();
        return;
      }
      throw new Error('Not connected to AssemblyAI. Call connect() first.');
    }

    try {
      // Convert Float32 to Int16 PCM
      const pcm = this.float32ToPCM16(audioChunk);
      this.transcriber.sendAudio(pcm.buffer);
    } catch (error) {
      console.error('[AssemblyAI] Failed to send audio:', error);
      this.isConnected = false;
      // Buffer the failed chunk and attempt reconnection
      if (this.reconnectionConfig.enabled) {
        this.bufferAudio(audioChunk);
        this.handleDisconnection();
      }
      throw error;
    }
  }

  /**
   * Buffer audio during disconnection
   */
  private bufferAudio(audioChunk: Float32Array): void {
    // Estimate buffer duration (rough calculation: samples / sampleRate * 1000ms)
    const chunkDuration = (audioChunk.length / this.sampleRate) * 1000;
    const currentBufferDuration = this.audioBuffer.reduce(
      (sum, chunk) => sum + (chunk.length / this.sampleRate) * 1000,
      0
    );

    // Only buffer if under max duration
    if (currentBufferDuration + chunkDuration <= this.maxBufferDuration) {
      this.audioBuffer.push(audioChunk);
    } else {
      console.warn('[AssemblyAI] Audio buffer full, dropping oldest chunks');
      // Remove oldest chunks to make room
      while (
        this.audioBuffer.reduce((sum, chunk) => sum + (chunk.length / this.sampleRate) * 1000, 0) +
          chunkDuration >
        this.maxBufferDuration
      ) {
        this.audioBuffer.shift();
      }
      this.audioBuffer.push(audioChunk);
    }
  }

  /**
   * Handle disconnection and attempt reconnection
   * Uses iterative approach instead of recursion to prevent stack overflow
   */
  private handleDisconnection(): void {
    if (!this.reconnectionConfig.enabled || this.isReconnecting) {
      return;
    }

    // Prevent infinite recursion
    if (this.currentRecursionDepth >= this.maxRecursionDepth) {
      console.error('[AssemblyAI] Max recursion depth reached, stopping reconnection attempts');
      this.currentRecursionDepth = 0;
      this.emit('reconnection-failed');
      this.clearAudioBuffer();
      return;
    }

    if (this.reconnectAttempts >= this.reconnectionConfig.maxRetries) {
      console.error('[AssemblyAI] Max reconnection attempts reached');
      this.currentRecursionDepth = 0;
      this.emit('reconnection-failed');
      this.clearAudioBuffer();
      return;
    }

    this.isReconnecting = true;
    this.reconnectAttempts++;
    this.currentRecursionDepth++;

    // Calculate delay with exponential backoff
    const delay = Math.min(
      this.reconnectionConfig.initialDelay *
        Math.pow(this.reconnectionConfig.backoffMultiplier, this.reconnectAttempts - 1),
      this.reconnectionConfig.maxDelay
    );

    console.log(
      `[AssemblyAI] Attempting reconnection ${this.reconnectAttempts}/${this.reconnectionConfig.maxRetries} in ${delay}ms`
    );

    this.reconnectTimer = setTimeout(async () => {
      try {
        // Clean up old transcriber
        if (this.transcriber) {
          try {
            await this.transcriber.close();
          } catch (e) {
            // Ignore cleanup errors
          }
          this.transcriber = null;
        }

        // Attempt reconnection
        await this.connect();
        this.isReconnecting = false;
        this.reconnectAttempts = 0;
        this.currentRecursionDepth = 0; // Reset on success

        // Flush buffered audio
        await this.flushAudioBuffer();

        console.log('[AssemblyAI] Reconnection successful');
        this.emit('reconnected');
      } catch (error) {
        console.error('[AssemblyAI] Reconnection failed:', error);
        this.isReconnecting = false;
        // Use iterative retry instead of recursion
        // Schedule next attempt instead of calling recursively
        setTimeout(() => {
          this.handleDisconnection();
        }, 0);
      }
    }, delay);
  }

  /**
   * Flush buffered audio after reconnection
   */
  private async flushAudioBuffer(): Promise<void> {
    if (this.audioBuffer.length === 0 || !this.isConnected) {
      return;
    }

    console.log(`[AssemblyAI] Flushing ${this.audioBuffer.length} buffered audio chunks`);
    for (const chunk of this.audioBuffer) {
      try {
        const pcm = this.float32ToPCM16(chunk);
        this.transcriber!.sendAudio(pcm.buffer);
      } catch (error) {
        console.warn('[AssemblyAI] Failed to flush buffered audio chunk:', error);
      }
    }
    this.clearAudioBuffer();
  }

  /**
   * Clear audio buffer
   */
  private clearAudioBuffer(): void {
    this.audioBuffer = [];
  }

  /**
   * Convert Float32Array to Int16 PCM for AssemblyAI
   */
  private float32ToPCM16(float32Array: Float32Array): Int16Array {
    const pcm = new Int16Array(float32Array.length);
    for (let i = 0; i < float32Array.length; i++) {
      const s = Math.max(-1, Math.min(1, float32Array[i]));
      pcm[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
    }
    return pcm;
  }

  /**
   * Get accumulated transcript text
   */
  getAccumulatedTranscript(): string {
    return this.transcriptBuffer.join(' ');
  }

  /**
   * Clear transcript buffer
   */
  clearBuffer(): void {
    this.transcriptBuffer = [];
  }

  async disconnect(): Promise<void> {
    // Cancel any pending reconnection attempts
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.isReconnecting = false;
    this.reconnectAttempts = 0;

    if (this.transcriber) {
      try {
        await this.transcriber.close();
      } catch (error) {
        console.error('[AssemblyAI] Error during disconnect:', error);
      }
      this.transcriber = null;
      this.isConnected = false;
      this.clearBuffer();
      this.clearAudioBuffer();
    }
  }

  getIsConnected(): boolean {
    return this.isConnected;
  }

  /**
   * Transcribe a single audio chunk (for batch compatibility)
   * Note: This buffers audio and waits for final transcript
   */
  async transcribe(audioChunk: Float32Array, sampleRate: number = 16000): Promise<string> {
    if (!this.isConnected) {
      await this.connect();
    }

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('AssemblyAI transcription timeout'));
      }, 10000); // 10 second timeout

      const handler = (transcript: StreamingTranscript) => {
        if (transcript.isFinal) {
          clearTimeout(timeout);
          this.removeListener('final', handler);
          resolve(transcript.text);
        }
      };

      this.on('final', handler);
      this.sendAudio(audioChunk).catch((error) => {
        clearTimeout(timeout);
        this.removeListener('final', handler);
        reject(error);
      });
    });
  }
}



