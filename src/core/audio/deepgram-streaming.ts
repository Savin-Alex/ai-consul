/**
 * Deepgram Real-Time Streaming Transcription
 * WebSocket-based streaming transcription with low latency
 */

import { createClient, LiveTranscriptionEvents } from '@deepgram/sdk';
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

export class DeepgramStreaming extends EventEmitter {
  private connection: any = null;
  private apiKey: string;
  private isConnected = false;
  private sampleRate: number = 16000;
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
    this.apiKey = apiKey || process.env.DEEPGRAM_API_KEY || '';
    if (!this.apiKey) {
      throw new Error('Deepgram API key required. Set DEEPGRAM_API_KEY environment variable.');
    }
    this.reconnectionConfig = { ...DEFAULT_RECONNECTION_CONFIG, ...reconnectionConfig };
  }

  async connect(): Promise<void> {
    if (this.isConnected && this.connection) {
      return;
    }

    try {
      const deepgram = createClient(this.apiKey);
      this.connection = deepgram.listen.live({
        model: 'nova-2',
        language: 'en-US',
        smart_format: true,
        interim_results: true,
        punctuate: true,
        endpointing: 300, // ms of silence before finalizing
      });

      // Setup event handlers
      this.connection.on(LiveTranscriptionEvents.Open, () => {
        this.isConnected = true;
        this.reconnectAttempts = 0; // Reset on successful connection
        this.isReconnecting = false;
        if (this.reconnectTimer) {
          clearTimeout(this.reconnectTimer);
          this.reconnectTimer = null;
        }
        this.emit('connected');
        console.log('[Deepgram] Connected to real-time transcription');
      });

      this.connection.on(LiveTranscriptionEvents.Error, (error: Error) => {
        console.error('[Deepgram] Error:', error);
        this.isConnected = false;
        this.emit('error', error);
        this.handleDisconnection();
      });

      this.connection.on(LiveTranscriptionEvents.Close, () => {
        this.isConnected = false;
        console.log('[Deepgram] Disconnected');
        this.emit('disconnected');
        this.handleDisconnection();
      });

      this.connection.on(LiveTranscriptionEvents.Transcript, (data: any) => {
        this.handleTranscript(data);
      });

      // Connect to Deepgram
      this.connection.start();
    } catch (error) {
      console.error('[Deepgram] Failed to connect:', error);
      this.isConnected = false;
      throw error;
    }
  }

  private handleTranscript(data: any): void {
    const transcript = data.channel?.alternatives?.[0];
    if (!transcript) {
      return;
    }

    const isFinal = data.is_final || false;
    const text = transcript.transcript || '';
    const confidence = transcript.confidence || 0;
    const words = transcript.words?.map((w: any) => ({
      text: w.word,
      start: w.start,
      end: w.end,
      confidence: w.confidence || 0,
    }));

    const streamingTranscript: StreamingTranscript = {
      text,
      words,
      confidence,
      isFinal,
      timestamp: Date.now(),
    };

    if (isFinal) {
      this.transcriptBuffer.push(text);
      this.emit('final', streamingTranscript);
    } else {
      this.emit('interim', streamingTranscript);
    }
  }

  async sendAudio(audioChunk: Float32Array): Promise<void> {
    // If not connected, buffer audio for later transmission
    if (!this.connection || !this.isConnected) {
      if (this.reconnectionConfig.enabled && !this.isReconnecting) {
        this.bufferAudio(audioChunk);
        // Trigger reconnection if not already attempting
        this.handleDisconnection();
        return;
      }
      throw new Error('Not connected to Deepgram. Call connect() first.');
    }

    try {
      // Convert Float32 to Int16 PCM
      const pcm = this.float32ToPCM16(audioChunk);
      this.connection.send(pcm.buffer);
    } catch (error) {
      console.error('[Deepgram] Failed to send audio:', error);
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
      console.warn('[Deepgram] Audio buffer full, dropping oldest chunks');
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
      console.error('[Deepgram] Max recursion depth reached, stopping reconnection attempts');
      this.currentRecursionDepth = 0;
      this.emit('reconnection-failed');
      this.clearAudioBuffer();
      return;
    }

    if (this.reconnectAttempts >= this.reconnectionConfig.maxRetries) {
      console.error('[Deepgram] Max reconnection attempts reached');
      this.currentRecursionDepth = 0;
      this.emit('reconnection-failed');
      this.clearAudioBuffer();
      return;
    }

    // Prevent overlapping reconnection attempts
    if (this.reconnectTimer) {
      console.warn('[Deepgram] Reconnection already in progress, skipping duplicate call');
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
      `[Deepgram] Attempting reconnection ${this.reconnectAttempts}/${this.reconnectionConfig.maxRetries} in ${delay}ms`
    );

    this.reconnectTimer = setTimeout(async () => {
      // Clear timer reference before attempting reconnection
      this.reconnectTimer = null;
      
      try {
        // Clean up old connection
        if (this.connection) {
          try {
            this.connection.finish();
          } catch (e) {
            // Ignore cleanup errors
          }
          this.connection = null;
        }

        // Attempt reconnection
        await this.connect();
        this.isReconnecting = false;
        this.reconnectAttempts = 0;
        this.currentRecursionDepth = 0; // Reset on success

        // Flush buffered audio
        await this.flushAudioBuffer();

        console.log('[Deepgram] Reconnection successful');
        this.emit('reconnected');
      } catch (error) {
        console.error('[Deepgram] Reconnection failed:', error);
        this.isReconnecting = false;
        // Use iterative retry with proper timer management
        if (this.currentRecursionDepth < this.maxRecursionDepth) {
          // Schedule next attempt (iterative, not recursive)
          setTimeout(() => { 
            if (!this.isReconnecting && !this.reconnectTimer) {
              this.handleDisconnection(); 
            }
          }, 0);
        } else {
          // Max depth reached, stop trying
          this.currentRecursionDepth = 0;
          this.emit('reconnection-failed');
          this.clearAudioBuffer();
        }
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

    console.log(`[Deepgram] Flushing ${this.audioBuffer.length} buffered audio chunks`);
    for (const chunk of this.audioBuffer) {
      try {
        const pcm = this.float32ToPCM16(chunk);
        this.connection.send(pcm.buffer);
      } catch (error) {
        console.warn('[Deepgram] Failed to flush buffered audio chunk:', error);
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
   * Convert Float32Array to Int16 PCM for Deepgram
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

    if (this.connection) {
      try {
        this.connection.finish();
      } catch (error) {
        console.error('[Deepgram] Error during disconnect:', error);
      }
      this.connection = null;
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
        reject(new Error('Deepgram transcription timeout'));
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



