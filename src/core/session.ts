import { EventEmitter } from 'events';
import { AIConsulEngine, SessionConfig, Suggestion } from './engine';
import { BrowserWindow } from 'electron';

export interface AudioChunk {
  data: Float32Array;
  sampleRate: number;
  channels: number;
  timestamp: number;
}

export class SessionManager extends EventEmitter {
  private engine: AIConsulEngine;
  private isActive = false;
  private currentConfig: SessionConfig | null = null;
  private mainWindow: BrowserWindow | null = null;
  private companionWindow: BrowserWindow | null = null;
  private audioBuffers: Float32Array[] = [];
  private bufferedSamples = 0;
  private isProcessingChunk = false;
  private currentSampleRate = 16000;
  private targetSampleRate = 16000;

  constructor(engine: AIConsulEngine) {
    super();
    this.engine = engine;
  }

  setWindows(mainWindow: BrowserWindow, companionWindow: BrowserWindow): void {
    this.mainWindow = mainWindow;
    this.companionWindow = companionWindow;
  }

  private resampleBuffer(
    input: Float32Array,
    sourceRate: number,
    targetRate: number
  ): Float32Array {
    const sourceArray = input;

    if (sourceRate === targetRate || sourceArray.length === 0) {
      const copy = new Float32Array(sourceArray.length);
      copy.set(sourceArray);
      return copy;
    }

    const ratio = sourceRate / targetRate;
    const outputLength = Math.round(sourceArray.length / ratio);
    const output = new Float32Array(outputLength);

    for (let i = 0; i < outputLength; i++) {
      const sourceIndex = i * ratio;
      const indexFloor = Math.floor(sourceIndex);
      const indexCeil = Math.min(indexFloor + 1, sourceArray.length - 1);
      const weight = sourceIndex - indexFloor;

      output[i] =
        sourceArray[indexFloor] +
        (sourceArray[indexCeil] - sourceArray[indexFloor]) * weight;
    }

    return output;
  }

  async processAudioChunk(chunk: AudioChunk): Promise<void> {
    if (!this.isActive) {
      if (process.env.DEBUG_AUDIO === 'true') {
        console.log('[session] ignoring audio chunk - session not active');
      }
      return;
    }

    try {
      if (process.env.DEBUG_AUDIO === 'true') {
        console.log(
          '[session] chunk received',
          chunk.sampleRate,
          chunk.data.length,
          'samples, buffered:',
          this.bufferedSamples
        );
      }

      this.audioBuffers.push(chunk.data);
      this.bufferedSamples += chunk.data.length;
      this.currentSampleRate = chunk.sampleRate || this.currentSampleRate;

      const minSamples = Math.round(this.currentSampleRate * 1.5); // ~1.5 seconds

      if (process.env.DEBUG_AUDIO === 'true') {
        console.log('[session] buffer status:', {
          bufferedSamples: this.bufferedSamples,
          minSamples: minSamples,
          isProcessingChunk: this.isProcessingChunk,
          bufferCount: this.audioBuffers.length,
          willProcess: !this.isProcessingChunk && this.bufferedSamples >= minSamples
        });
      }

      if (this.isProcessingChunk || this.bufferedSamples < minSamples) {
        return;
      }

      const combinedBuffer = new Float32Array(this.bufferedSamples);
      let offset = 0;
      for (const buffer of this.audioBuffers) {
        combinedBuffer.set(buffer, offset);
        offset += buffer.length;
      }

      // Reset buffers before processing to allow new data to accumulate
      this.audioBuffers = [];
      this.bufferedSamples = 0;
      this.isProcessingChunk = true;

      if (process.env.DEBUG_AUDIO === 'true') {
        console.log('[session] processing buffer of', combinedBuffer.length, 'samples');
      }

      let processedBuffer: Float32Array = combinedBuffer;
      let processedSampleRate = this.currentSampleRate;

      if (processedSampleRate !== this.targetSampleRate) {
        processedBuffer = this.resampleBuffer(
          combinedBuffer,
          processedSampleRate,
          this.targetSampleRate
        );
        processedSampleRate = this.targetSampleRate;

        if (process.env.DEBUG_AUDIO === 'true') {
          console.log(
            '[session] resampled buffer to',
            processedSampleRate,
            'Hz with',
            processedBuffer.length,
            'samples'
          );
        }
      }

      // Transcribe audio
      if (process.env.DEBUG_AUDIO === 'true') {
        console.log('[session] SENDING TO TRANSCRIPTION:', {
          bufferLength: processedBuffer.length,
          sampleRate: processedSampleRate,
          duration: processedBuffer.length / processedSampleRate,
          maxAmplitude: Math.max(...Array.from(processedBuffer)),
          minAmplitude: Math.min(...Array.from(processedBuffer)),
          avgAmplitude: processedBuffer.reduce((sum, val) => sum + Math.abs(val), 0) / processedBuffer.length
        });
      }

      console.log('[session] About to call engine.transcribe...');
      const transcription = await this.engine.transcribe(
        processedBuffer,
        processedSampleRate
      );
      console.log('[session] Transcription result received:', transcription);

      if (process.env.DEBUG_AUDIO === 'true') {
        console.log('[session] transcription result:', transcription);
      }

      if (!transcription || transcription.trim().length === 0) {
        this.isProcessingChunk = false;
        return;
      }

      // Generate suggestions
      const suggestions = await this.engine.generateSuggestions(transcription);

      // Send to UI
      this.sendSuggestionsToUI(suggestions);
    } catch (error) {
      console.error('Session processing error:', error);
      this.emit('error', error);
    } finally {
      this.isProcessingChunk = false;
    }
  }

  async start(config: SessionConfig): Promise<void> {
    if (this.isActive) {
      throw new Error('Session is already active');
    }

    console.log('[session] Starting session with config:', config);

    this.currentConfig = config;

    // Start engine session
    await this.engine.startSession(config);
    console.log('[session] Engine session started');

    // Signal renderer to start audio capture
    if (this.mainWindow && !this.mainWindow.isDestroyed()) {
      this.mainWindow.webContents.send('start-audio-capture', {
        sources: ['microphone'],
        sampleRate: 16000,
        channels: 1,
      });
      console.log('[session] Sent start-audio-capture signal to renderer');
    }

    this.isActive = true;
    console.log('[session] Session marked as active');
    this.emit('session-started', config);
  }

  async pause(): Promise<void> {
    console.log('[session] Pause called, isActive:', this.isActive);
    if (!this.isActive) {
      console.log('[session] Session not active, cannot pause');
      return;
    }

    console.log('[session] Pausing session');

    // Signal renderer to stop audio capture
    if (this.mainWindow && !this.mainWindow.isDestroyed()) {
      this.mainWindow.webContents.send('stop-audio-capture');
      console.log('[session] Sent stop-audio-capture signal to renderer');
    }

    this.isActive = false;
    console.log('[session] Session marked as inactive');
    this.emit('session-paused');
  }

  async stop(): Promise<void> {
    if (!this.isActive && !this.currentConfig) return;

    // Signal renderer to stop audio capture
    if (this.mainWindow && !this.mainWindow.isDestroyed()) {
      this.mainWindow.webContents.send('stop-audio-capture');
    }

    this.engine.stopSession();
    this.currentConfig = null;
    this.isActive = false;
    this.audioBuffers = [];
    this.bufferedSamples = 0;
    this.isProcessingChunk = false;
    this.sendSuggestionsToUI([]);
    this.emit('session-stopped');
  }

  private sendSuggestionsToUI(suggestions: Suggestion[]): void {
    // Send to companion window via IPC
    if (this.companionWindow && !this.companionWindow.isDestroyed()) {
      this.companionWindow.webContents.send('suggestions-update', suggestions);
    }

    // Also send to main window if needed
    if (this.mainWindow && !this.mainWindow.isDestroyed()) {
      this.mainWindow.webContents.send('suggestions-update', suggestions);
    }
  }

  getIsActive(): boolean {
    return this.isActive;
  }

  getCurrentConfig(): SessionConfig | null {
    return this.currentConfig;
  }
}

