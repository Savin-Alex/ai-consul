import { EventEmitter } from 'events';
import { AIConsulEngine, SessionConfig, Suggestion } from './engine';
import { BrowserWindow } from 'electron';
import { VADProcessor } from './audio/vad';
import { WhisperStreamingEngine, StreamingTranscript } from './audio/whisper-streaming';
import { SentenceAssembler, CompleteSentence } from './audio/sentence-assembler';

interface TranscriptEntry {
  text: string;
  timestamp: number;
}

export interface AudioChunk {
  data: Float32Array;
  sampleRate: number;
  channels: number;
  timestamp: number;
  maxAmplitude?: number;
}

export class SessionManager extends EventEmitter {
  private engine: AIConsulEngine;
  private isActive = false;
  private currentConfig: SessionConfig | null = null;
  private mainWindow: BrowserWindow | null = null;
  private companionWindow: BrowserWindow | null = null;
  private transcriptWindow: BrowserWindow | null = null;
  private speechBuffer: Float32Array[] = [];
  private isTranscribing = false;
  private currentSampleRate = 16000;
  private targetSampleRate = 16000;
  private readonly maxBufferedDurationSeconds = 5.5;
  private transcripts: TranscriptEntry[] = [];
  
  // Streaming mode components
  private streamingMode: boolean = false;
  private streamingEngine: WhisperStreamingEngine | null = null;
  private sentenceAssembler: SentenceAssembler | null = null;

  constructor(engine: AIConsulEngine) {
    super();
    this.engine = engine;
  }

  setWindows(
    mainWindow: BrowserWindow,
    companionWindow: BrowserWindow,
    transcriptWindow?: BrowserWindow
  ): void {
    this.mainWindow = mainWindow;
    this.companionWindow = companionWindow;
    this.transcriptWindow = transcriptWindow ?? null;
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

    // Route to streaming or batch mode
    if (this.streamingMode && this.streamingEngine) {
      await this.processAudioChunkStreaming(chunk);
    } else {
      await this.processAudioChunkBatch(chunk);
    }
  }

  private async processAudioChunkStreaming(chunk: AudioChunk): Promise<void> {
    if (!this.streamingEngine) {
      return;
    }

    try {
      let audioData =
        chunk.sampleRate === this.targetSampleRate
          ? chunk.data
          : this.resampleBuffer(chunk.data, chunk.sampleRate, this.targetSampleRate);

      // Send directly to streaming engine
      await this.streamingEngine.addAudio(audioData, this.targetSampleRate);
    } catch (error) {
      console.error('[session] Streaming processing error:', error);
      this.emit('error', error);
    }
  }

  private async processAudioChunkBatch(chunk: AudioChunk): Promise<void> {
    const vad = this.engine.getVADProcessor();
    if (!vad) {
      if (process.env.DEBUG_AUDIO === 'true') {
        console.warn('[session] VAD processor unavailable, skipping chunk');
      }
      return;
    }

    try {
      let audioData =
        chunk.sampleRate === this.targetSampleRate
          ? chunk.data
          : this.resampleBuffer(chunk.data, chunk.sampleRate, this.targetSampleRate);

      this.currentSampleRate = this.targetSampleRate;

      const maxAmplitude =
        typeof chunk.maxAmplitude === 'number'
          ? chunk.maxAmplitude
          : this.computeMaxAmplitude(audioData);

      const vadResult = await vad.process(audioData, maxAmplitude);

      if (process.env.DEBUG_AUDIO === 'true') {
        console.log('[session] VAD result:', vadResult, 'buffer length:', this.speechBuffer.length);
      }

      if (vadResult.speech) {
        this.speechBuffer.push(audioData);

        const totalBufferedSamples = this.getBufferedSampleCount();
        const maxSamples = Math.floor(this.maxBufferedDurationSeconds * this.targetSampleRate);

        if (totalBufferedSamples >= maxSamples && !this.isTranscribing) {
          if (process.env.DEBUG_AUDIO === 'true') {
            console.log('[session] Max buffered duration reached, forcing transcription');
          }
          await this.transcribeBufferedSpeech('max-buffer');
        }
      }

      if (vadResult.pause && this.speechBuffer.length > 0 && !this.isTranscribing) {
        await this.transcribeBufferedSpeech('vad-pause');
      }
    } catch (error) {
      console.error('Session processing error:', error);
      this.emit('error', error);
    }
  }

  private computeMaxAmplitude(buffer: Float32Array): number {
    let max = 0;
    for (let i = 0; i < buffer.length; i++) {
      const value = Math.abs(buffer[i]);
      if (value > max) {
        max = value;
      }
    }
    return max;
  }

  private getBufferedSampleCount(): number {
    return this.speechBuffer.reduce((sum, chunk) => sum + chunk.length, 0);
  }

  private async transcribeBufferedSpeech(reason: 'vad-pause' | 'max-buffer'): Promise<void> {
    if (this.speechBuffer.length === 0 || this.isTranscribing) {
      return;
    }

    this.isTranscribing = true;
    const audioToTranscribe = this.combineBuffers(this.speechBuffer);
    this.speechBuffer = [];

    if (process.env.DEBUG_AUDIO === 'true') {
      console.log(`[session] Transcribing buffer due to ${reason}:`, {
        samples: audioToTranscribe.length,
        duration: audioToTranscribe.length / this.targetSampleRate,
      });
    }

    try {
      const transcription = await this.engine.transcribe(
        audioToTranscribe,
        this.targetSampleRate
      );

      if (process.env.DEBUG_AUDIO === 'true') {
        console.log('[session] Transcription result:', transcription);
      }

      if (
        transcription &&
        transcription.trim().length > 0 &&
        transcription.toLowerCase().trim() !== '[blank_audio]'
      ) {
        this.transcripts.push({
          text: transcription.trim(),
          timestamp: Date.now(),
        });
        this.sendTranscriptionsToUI();

        const suggestions = await this.engine.generateSuggestions(transcription);
        this.sendSuggestionsToUI(suggestions);
      }
    } catch (error) {
      console.error('[session] Transcription failed:', error);
      throw error;
    } finally {
      this.isTranscribing = false;
    }
  }

  async start(config: SessionConfig): Promise<void> {
    if (this.isActive) {
      throw new Error('Session is already active');
    }

    console.log('[session] Starting session with config:', config);

    this.currentConfig = config;
    this.transcripts = [];
    this.sendTranscriptionsToUI();
    this.speechBuffer = [];
    this.isTranscribing = false;

    // Check if streaming mode is enabled
    const engineConfig = this.engine.getTranscriptionConfig();
    const transcriptionMode = this.engine.getConfig().models.transcription.mode || 'batch';
    this.streamingMode = transcriptionMode === 'streaming' && engineConfig.allowLocal;

    // Initialize streaming components if enabled
    if (this.streamingMode) {
      await this.initializeStreamingMode();
    }

    // Start engine session
    await this.engine.startSession(config);
    console.log('[session] Engine session started');

    // Signal renderer to start audio capture
    if (this.mainWindow && !this.mainWindow.isDestroyed()) {
      this.mainWindow.webContents.send('start-audio-capture', {
        sources: ['microphone'],
        sampleRate: 16000,
        channels: 1,
        useAudioWorklet: true,
      });
      console.log('[session] Sent start-audio-capture signal to renderer');
    }

    this.isActive = true;
    console.log(`[session] Session marked as active (mode: ${this.streamingMode ? 'streaming' : 'batch'})`);
    this.emit('session-started', config);
  }

  private async initializeStreamingMode(): Promise<void> {
    try {
      const engineConfig = this.engine.getConfig();
      const streamingConfig = engineConfig.models.transcription.streaming || {};
      
      // Determine model size
      let modelSize: 'tiny' | 'base' | 'small' = 'base';
      if (engineConfig.models.transcription.primary.includes('small')) {
        modelSize = 'small';
      } else if (engineConfig.models.transcription.primary.includes('tiny')) {
        modelSize = 'tiny';
      }

      // Create streaming engine
      this.streamingEngine = new WhisperStreamingEngine({
        windowSize: streamingConfig.windowSize || 2.0,
        stepSize: streamingConfig.stepSize || 1.0,
        overlapRatio: streamingConfig.overlapRatio || 0.5,
        modelSize,
      });

      // Initialize streaming engine
      await this.streamingEngine.initialize();

      // Setup event handlers
      this.streamingEngine.on('interim', (transcript: StreamingTranscript) => {
        this.handleInterimTranscript(transcript);
      });

      this.streamingEngine.on('final', (transcript: StreamingTranscript) => {
        this.handleFinalTranscript(transcript);
      });

      this.streamingEngine.on('error', (error: Error) => {
        console.error('[session] Streaming engine error:', error);
        this.emit('error', error);
      });

      // Create sentence assembler
      this.sentenceAssembler = new SentenceAssembler();
      this.sentenceAssembler.on('sentence', (sentence: CompleteSentence) => {
        this.handleCompleteSentence(sentence);
      });

      console.log('[session] Streaming mode initialized');
    } catch (error) {
      console.error('[session] Failed to initialize streaming mode, falling back to batch:', error);
      this.streamingMode = false;
      this.streamingEngine = null;
      this.sentenceAssembler = null;
    }
  }

  private handleInterimTranscript(transcript: StreamingTranscript): void {
    // Send interim results to UI for real-time feedback
    if (this.transcriptWindow && !this.transcriptWindow.isDestroyed()) {
      this.transcriptWindow.webContents.send('interim-transcript', {
        text: transcript.text,
        timestamp: transcript.timestamp,
      });
    }

    if (this.mainWindow && !this.mainWindow.isDestroyed()) {
      this.mainWindow.webContents.send('interim-transcript', {
        text: transcript.text,
        timestamp: transcript.timestamp,
      });
    }
  }

  private handleFinalTranscript(transcript: StreamingTranscript): void {
    // Send to sentence assembler
    if (this.sentenceAssembler) {
      this.sentenceAssembler.addFinalTranscript(transcript.text, transcript.words || []);
    } else {
      // Fallback: add directly to transcripts
      this.transcripts.push({
        text: transcript.text,
        timestamp: transcript.timestamp,
      });
      this.sendTranscriptionsToUI();
    }
  }

  private async handleCompleteSentence(sentence: CompleteSentence): Promise<void> {
    // Add to transcripts
    this.transcripts.push({
      text: sentence.text,
      timestamp: sentence.startTime,
    });
    this.sendTranscriptionsToUI();

    // Generate suggestions
    try {
      const suggestions = await this.engine.generateSuggestions(sentence.text);
      this.sendSuggestionsToUI(suggestions);
    } catch (error) {
      console.error('[session] Failed to generate suggestions:', error);
    }
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

    // Flush streaming components if active
    if (this.streamingMode) {
      if (this.streamingEngine) {
        await this.streamingEngine.flush();
        this.streamingEngine.reset();
      }
      if (this.sentenceAssembler) {
        await this.sentenceAssembler.flush();
        this.sentenceAssembler.reset();
      }
    }

    // Signal renderer to stop audio capture
    if (this.mainWindow && !this.mainWindow.isDestroyed()) {
      this.mainWindow.webContents.send('stop-audio-capture');
    }

    this.engine.stopSession();
    this.currentConfig = null;
    this.isActive = false;
    this.speechBuffer = [];
    this.isTranscribing = false;
    this.streamingMode = false;
    this.streamingEngine = null;
    this.sentenceAssembler = null;
    this.sendSuggestionsToUI([]);
    this.transcripts = [];
    this.sendTranscriptionsToUI();
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

  private sendTranscriptionsToUI(): void {
    const payload = this.transcripts;

    if (this.transcriptWindow && !this.transcriptWindow.isDestroyed()) {
      this.transcriptWindow.webContents.send('transcriptions-update', payload);
    }

    if (this.mainWindow && !this.mainWindow.isDestroyed()) {
      this.mainWindow.webContents.send('transcriptions-update', payload);
    }
  }

  getIsActive(): boolean {
    return this.isActive;
  }

  getCurrentConfig(): SessionConfig | null {
    return this.currentConfig;
  }

  private combineBuffers(buffers: Float32Array[]): Float32Array {
    const totalLength = buffers.reduce((sum, buffer) => sum + buffer.length, 0);
    const combined = new Float32Array(totalLength);
    let offset = 0;

    for (const buffer of buffers) {
      combined.set(buffer, offset);
      offset += buffer.length;
    }

    return combined;
  }
}

