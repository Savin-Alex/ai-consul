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

  constructor(engine: AIConsulEngine) {
    super();
    this.engine = engine;
  }

  setWindows(mainWindow: BrowserWindow, companionWindow: BrowserWindow): void {
    this.mainWindow = mainWindow;
    this.companionWindow = companionWindow;
  }

  async processAudioChunk(chunk: AudioChunk): Promise<void> {
    if (!this.isActive) return;

    try {
      this.audioBuffers.push(chunk.data);
      this.bufferedSamples += chunk.data.length;
      this.currentSampleRate = chunk.sampleRate || this.currentSampleRate;

      const minSamples = Math.round(this.currentSampleRate * 1.5); // ~1.5 seconds

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

      // Transcribe audio
      const transcription = await this.engine.transcribe(
        combinedBuffer,
        this.currentSampleRate
      );

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

    this.currentConfig = config;

    // Start engine session
    await this.engine.startSession(config);

    // Signal renderer to start audio capture
    if (this.mainWindow && !this.mainWindow.isDestroyed()) {
      this.mainWindow.webContents.send('start-audio-capture', {
        sources: ['microphone'],
        sampleRate: 16000,
        channels: 1,
      });
    }

    this.isActive = true;
    this.emit('session-started', config);
  }

  async pause(): Promise<void> {
    if (!this.isActive) return;

    // Signal renderer to stop audio capture
    if (this.mainWindow && !this.mainWindow.isDestroyed()) {
      this.mainWindow.webContents.send('stop-audio-capture');
    }

    this.isActive = false;
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

