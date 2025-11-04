import { EventEmitter } from 'events';
import { AIConsulEngine, SessionConfig, Suggestion } from './engine';
import { AudioCaptureManager, AudioChunk } from './audio/capture';
import { ipcMain, BrowserWindow } from 'electron';

export class SessionManager extends EventEmitter {
  private engine: AIConsulEngine;
  private audioManager: AudioCaptureManager;
  private isActive = false;
  private currentConfig: SessionConfig | null = null;
  private mainWindow: BrowserWindow | null = null;
  private companionWindow: BrowserWindow | null = null;

  constructor(engine: AIConsulEngine) {
    super();
    this.engine = engine;
    this.audioManager = new AudioCaptureManager();
    this.setupAudioHandlers();
  }

  setWindows(mainWindow: BrowserWindow, companionWindow: BrowserWindow): void {
    this.mainWindow = mainWindow;
    this.companionWindow = companionWindow;
  }

  private setupAudioHandlers(): void {
    this.audioManager.on('audio-chunk', async (chunk: AudioChunk) => {
      if (!this.isActive) return;

      try {
        // Transcribe audio
        const transcription = await this.engine.transcribe(chunk.data);

        if (!transcription || transcription.trim().length === 0) {
          return;
        }

        // Generate suggestions
        const suggestions = await this.engine.generateSuggestions(transcription);

        // Send to UI
        this.sendSuggestionsToUI(suggestions);
      } catch (error) {
        console.error('Session processing error:', error);
        this.emit('error', error);
      }
    });
  }

  async start(config: SessionConfig): Promise<void> {
    if (this.isActive) {
      throw new Error('Session is already active');
    }

    this.currentConfig = config;

    // Start engine session
    await this.engine.startSession(config);

    // Start audio capture
    await this.audioManager.startCapture({
      sources: ['microphone'], // Can be extended to include system audio
      sampleRate: 16000,
      channels: 1,
    });

    this.isActive = true;
    this.emit('session-started', config);
  }

  async pause(): Promise<void> {
    if (!this.isActive) return;

    await this.audioManager.stopCapture();
    this.isActive = false;
    this.emit('session-paused');
  }

  async stop(): Promise<void> {
    if (!this.isActive && !this.currentConfig) return;

    await this.audioManager.stopCapture();
    this.engine.stopSession();
    this.currentConfig = null;
    this.isActive = false;
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

