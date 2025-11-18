import { EventEmitter } from 'events';
import { AIConsulEngine, SessionConfig, Suggestion } from './engine';
import { BrowserWindow } from 'electron';
import { VADProcessor } from './audio/vad';
import { VADResult } from './audio/vad-provider';
import { WhisperStreamingEngine, StreamingTranscript } from './audio/whisper-streaming';
import { SentenceAssembler, CompleteSentence } from './audio/sentence-assembler';
import { AssemblyAIStreaming } from './audio/assemblyai-streaming';
import { DeepgramStreaming } from './audio/deepgram-streaming';

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
  private isStopping = false; // Flag to allow processing during flush phase
  private currentConfig: SessionConfig | null = null;
  private mainWindow: BrowserWindow | null = null;
  private companionWindow: BrowserWindow | null = null;
  private transcriptWindow: BrowserWindow | null = null;
  private speechBuffer: Float32Array[] = [];
  private isTranscribing = false;
  private currentSampleRate = 16000;
  private targetSampleRate = 16000;
  private readonly maxBufferedDurationSeconds = 5.5;
  private readonly speechEndTimeoutMs = 1500; // Trigger transcription after 1.5s of no speech
  private speechEndTimeout: NodeJS.Timeout | null = null;
  private transcripts: TranscriptEntry[] = [];
  
  // Streaming mode components
  private streamingMode: boolean = false;
  private streamingEngine: WhisperStreamingEngine | null = null;
  private sentenceAssembler: SentenceAssembler | null = null;
  private cloudStreamingService: AssemblyAIStreaming | DeepgramStreaming | null = null;
  private streamingServiceType: 'local' | 'assemblyai' | 'deepgram' | 'hybrid' = 'local';
  
  // Event listener references for cleanup (prevents memory leaks)
  private cloudStreamingEventHandlers: {
    interim?: (transcript: StreamingTranscript) => void;
    final?: (transcript: StreamingTranscript) => void;
    error?: (error: Error) => void;
  } = {};

  /**
   * Check if a transcription text is music-related or non-speech content
   * Filters out various music patterns: [music], (music), (upbeat music), etc.
   */
  private isMusicOrNonSpeech(text: string): boolean {
    if (!text || text.length === 0) {
      return true;
    }

    const lowerText = text.toLowerCase().trim();

    // Check for blank audio markers
    if (lowerText === '[blank_audio]' || lowerText === '(blank audio)') {
      return true;
    }

    // Check for bracket-based music markers: [music], [Music], [music playing], etc.
    if (
      lowerText === '[music]' ||
      lowerText.startsWith('[music') ||
      lowerText.includes('[music]') ||
      lowerText.match(/\[.*music.*\]/i)
    ) {
      return true;
    }

    // Check for parenthesis-based music markers: (music), (upbeat music), (background music), etc.
    if (
      lowerText === '(music)' ||
      lowerText.startsWith('(music') ||
      lowerText.includes('(music)') ||
      lowerText.match(/\(.*music.*\)/i) ||
      lowerText.match(/\(.*upbeat.*music.*\)/i) ||
      lowerText.match(/\(.*background.*music.*\)/i)
    ) {
      return true;
    }

    // Check for other common music-related patterns
    const musicPatterns = [
      /^music\s+playing$/i,
      /^instrumental$/i,
      /^background\s+music$/i,
      /^upbeat\s+music$/i,
      /^music$/i,
    ];

    for (const pattern of musicPatterns) {
      if (pattern.test(lowerText)) {
        return true;
      }
    }

    return false;
  }

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
    // Check if streaming mode is enabled AND streaming engine is available
    if (this.streamingMode) {
      if (this.streamingEngine || this.cloudStreamingService) {
        await this.processAudioChunkStreaming(chunk);
      } else {
        // Streaming mode enabled but no engine available - fallback to batch
        console.warn('[session] Streaming mode enabled but no engine available, falling back to batch mode');
        await this.processAudioChunkBatch(chunk);
      }
    } else {
      await this.processAudioChunkBatch(chunk);
    }
  }

  private async processAudioChunkStreaming(chunk: AudioChunk): Promise<void> {
    // Early return if session is not active
    if (!this.isActive) {
      return;
    }

    try {
      let audioData =
        chunk.sampleRate === this.targetSampleRate
          ? chunk.data
          : this.resampleBuffer(chunk.data, chunk.sampleRate, this.targetSampleRate);

      // Validate audio data
      if (!audioData || audioData.length === 0) {
        if (process.env.DEBUG_AUDIO === 'true') {
          console.warn('[session] Empty audio data in streaming mode');
        }
        return;
      }

      // Route to appropriate streaming service
      if (this.streamingServiceType === 'assemblyai' || this.streamingServiceType === 'deepgram') {
        // Use cloud streaming service
        if (this.cloudStreamingService && this.cloudStreamingService.getIsConnected()) {
          try {
            await this.cloudStreamingService.sendAudio(audioData);
          } catch (error) {
            console.warn('[session] Cloud streaming send failed, falling back to local:', error);
            // Fallback to local if cloud fails
            if (this.streamingEngine) {
              await this.streamingEngine.addAudio(audioData, this.targetSampleRate);
            }
          }
        } else {
          console.warn('[session] Cloud streaming service not available, falling back to local');
          if (this.streamingEngine) {
            await this.streamingEngine.addAudio(audioData, this.targetSampleRate);
          } else {
            // No streaming engine available - fallback to batch mode for this chunk
            console.warn('[session] No streaming engine available, processing in batch mode');
            await this.processAudioChunkBatch(chunk);
          }
        }
      } else if (this.streamingServiceType === 'hybrid') {
        // Send to both local and cloud (local for low latency, cloud for accuracy)
        if (this.streamingEngine) {
          try {
            await this.streamingEngine.addAudio(audioData, this.targetSampleRate);
          } catch (error) {
            console.warn('[session] Local streaming engine error:', error);
          }
        }
        if (this.cloudStreamingService && this.cloudStreamingService.getIsConnected()) {
          // Send to cloud asynchronously (don't wait)
          this.cloudStreamingService.sendAudio(audioData).catch((error) => {
            console.warn('[session] Cloud streaming send failed:', error);
            // Emit error through event system to ensure it's handled
            this.emit('error', error instanceof Error ? error : new Error(String(error)));
          });
        }
      } else {
        // Local-only streaming
        if (this.streamingEngine) {
          try {
            await this.streamingEngine.addAudio(audioData, this.targetSampleRate);
          } catch (error) {
            console.error('[session] Local streaming engine error:', error);
            this.emit('error', error instanceof Error ? error : new Error(String(error)));
            // Fallback to batch mode
            await this.processAudioChunkBatch(chunk);
          }
        } else {
          // No local engine - fallback to batch
          console.warn('[session] Local streaming engine not available, falling back to batch mode');
          await this.processAudioChunkBatch(chunk);
        }
      }
    } catch (error) {
      console.error('[session] Streaming processing error:', error);
      this.emit('error', error instanceof Error ? error : new Error(String(error)));
      // Try batch mode as fallback
      try {
        await this.processAudioChunkBatch(chunk);
      } catch (batchError) {
        console.error('[session] Batch mode fallback also failed:', batchError);
      }
    }
  }

  private async processAudioChunkBatch(chunk: AudioChunk): Promise<void> {
    // Early return if session is not active and not stopping (allow processing during flush)
    if (!this.isActive && !this.isStopping) {
      return;
    }

    const vad = this.engine.getVADProcessor();
    if (!vad) {
      if (process.env.DEBUG_AUDIO === 'true') {
        console.warn('[session] VAD processor unavailable, skipping chunk');
      }
      return;
    }

    try {
      // Validate chunk data
      if (!chunk || !chunk.data || chunk.data.length === 0) {
        if (process.env.DEBUG_AUDIO === 'true') {
          console.warn('[session] Invalid audio chunk, skipping');
        }
        return;
      }

      let audioData =
        chunk.sampleRate === this.targetSampleRate
          ? chunk.data
          : this.resampleBuffer(chunk.data, chunk.sampleRate, this.targetSampleRate);

      // Validate resampled data
      if (!audioData || audioData.length === 0) {
        console.warn('[session] Resampling produced empty audio, skipping');
        return;
      }

      this.currentSampleRate = this.targetSampleRate;

      const maxAmplitude =
        typeof chunk.maxAmplitude === 'number'
          ? chunk.maxAmplitude
          : this.computeMaxAmplitude(audioData);

      // Process VAD with timeout to prevent hanging
      let vadResult;
      try {
        vadResult = await Promise.race([
          vad.process(audioData, maxAmplitude),
          new Promise<VADResult>((resolve) => 
            setTimeout(() => resolve({ speech: false, pause: false }), 1000)
          )
        ]);
      } catch (vadError) {
        console.error('[session] VAD processing error:', vadError);
        // Default to speech detection on VAD error to avoid blocking
        vadResult = { speech: true, pause: false };
      }

      if (process.env.DEBUG_AUDIO === 'true') {
        console.log('[session] VAD result:', vadResult, 'buffer length:', this.speechBuffer.length, 'isTranscribing:', this.isTranscribing);
      }

      if (vadResult.speech) {
        // Clear any pending speech end timeout since we're detecting speech
        if (this.speechEndTimeout) {
          clearTimeout(this.speechEndTimeout);
          this.speechEndTimeout = null;
        }

        this.speechBuffer.push(audioData);

        const totalBufferedSamples = this.getBufferedSampleCount();
        const maxSamples = Math.floor(this.maxBufferedDurationSeconds * this.targetSampleRate);
        
        // Hard limit: prevent buffer overflow (2x max duration as absolute maximum)
        const hardLimitSamples = maxSamples * 2;
        if (totalBufferedSamples > hardLimitSamples) {
          console.warn('[session] Buffer overflow detected, forcing immediate transcription');
          // Force transcription even if already transcribing to prevent memory issues
          if (this.isTranscribing) {
            // If already transcribing, remove oldest chunks to make room (preserve recent audio)
            // Remove enough chunks to get back under maxSamples
            const samplesToRemove = totalBufferedSamples - maxSamples;
            let removedSamples = 0;
            while (removedSamples < samplesToRemove && this.speechBuffer.length > 0) {
              const removedChunk = this.speechBuffer.shift();
              if (removedChunk) {
                removedSamples += removedChunk.length;
              }
            }
            console.warn('[session] Removed oldest chunks to prevent overflow, preserved recent audio');
          } else {
            // Clear timeout before transcription
            if (this.speechEndTimeout) {
              clearTimeout(this.speechEndTimeout);
              this.speechEndTimeout = null;
            }
            // Don't await - let it run asynchronously to avoid blocking
            this.transcribeBufferedSpeech('max-buffer').catch((error) => {
              console.error('[session] Transcription error (non-blocking):', error);
            });
          }
        } else if (totalBufferedSamples >= maxSamples && !this.isTranscribing) {
          if (process.env.DEBUG_AUDIO === 'true') {
            console.log('[session] Max buffered duration reached, forcing transcription');
          }
          // Clear timeout before transcription
          if (this.speechEndTimeout) {
            clearTimeout(this.speechEndTimeout);
            this.speechEndTimeout = null;
          }
          // Don't await - let it run asynchronously to avoid blocking
          this.transcribeBufferedSpeech('max-buffer').catch((error) => {
            console.error('[session] Transcription error (non-blocking):', error);
          });
        }
      } else {
        // Speech not detected - handle pause or set timeout for transcription
        if (vadResult.pause && this.speechBuffer.length > 0 && !this.isTranscribing) {
          // Clear timeout since we're transcribing now
          if (this.speechEndTimeout) {
            clearTimeout(this.speechEndTimeout);
            this.speechEndTimeout = null;
          }
          // Don't await - let it run asynchronously to avoid blocking
          this.transcribeBufferedSpeech('vad-pause').catch((error) => {
            console.error('[session] Transcription error (non-blocking):', error);
          });
        } else if (!vadResult.speech && this.speechBuffer.length > 0 && !this.isTranscribing && !this.speechEndTimeout) {
          // No speech detected, but we have buffered audio - set timeout to transcribe
          // This handles cases where pause detection doesn't trigger
          if (process.env.DEBUG_AUDIO === 'true') {
            console.log('[session] Speech stopped, setting timeout to transcribe buffered audio');
          }
          this.speechEndTimeout = setTimeout(() => {
            if (this.speechBuffer.length > 0 && !this.isTranscribing && this.isActive) {
              if (process.env.DEBUG_AUDIO === 'true') {
                console.log('[session] Speech end timeout triggered, transcribing buffered audio');
              }
              this.transcribeBufferedSpeech('speech-end-timeout').catch((error) => {
                console.error('[session] Transcription error (non-blocking):', error);
              });
            }
            this.speechEndTimeout = null;
          }, this.speechEndTimeoutMs);
        }
      }
    } catch (error) {
      console.error('[session] Batch processing error:', error);
      this.emit('error', error instanceof Error ? error : new Error(String(error)));
      // Don't re-throw - allow processing to continue
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

  private async transcribeBufferedSpeech(reason: 'vad-pause' | 'max-buffer' | 'speech-end-timeout'): Promise<void> {
    if (this.speechBuffer.length === 0 || this.isTranscribing) {
      if (process.env.DEBUG_AUDIO === 'true' && this.isTranscribing) {
        console.log('[session] Skipping transcription - already in progress');
      }
      return;
    }

    // Clear speech end timeout since we're transcribing now
    if (this.speechEndTimeout) {
      clearTimeout(this.speechEndTimeout);
      this.speechEndTimeout = null;
    }

    // Set flag immediately to prevent concurrent transcriptions
    this.isTranscribing = true;
    const bufferChunkCount = this.speechBuffer.length;
    const audioToTranscribe = this.combineBuffers(this.speechBuffer);
    this.speechBuffer = [];

    console.log(`[session] Transcribing buffer due to ${reason}:`, {
      samples: audioToTranscribe.length,
      duration: (audioToTranscribe.length / this.targetSampleRate).toFixed(2) + 's',
      bufferChunks: bufferChunkCount,
    });

    try {
      // Validate audio before transcription
      if (!audioToTranscribe || audioToTranscribe.length === 0) {
        console.warn('[session] Empty audio buffer, skipping transcription');
        return;
      }

      const transcription = await this.engine.transcribe(
        audioToTranscribe,
        this.targetSampleRate
      );

      if (process.env.DEBUG_AUDIO === 'true') {
        console.log('[session] Transcription result:', transcription);
      }

      // Validate transcription result
      if (!transcription || typeof transcription !== 'string') {
        console.warn('[session] Invalid transcription result:', transcription);
        return;
      }

      const trimmedText = transcription.trim();
      if (
        trimmedText.length > 2 && // Filter out very short transcriptions that are likely noise
        !this.isMusicOrNonSpeech(trimmedText)
      ) {
        if (process.env.DEBUG_AUDIO === 'true') {
          console.log('[session] Accepting transcription:', trimmedText);
        }
        this.transcripts.push({
          text: trimmedText,
          timestamp: Date.now(),
        });
        this.sendTranscriptionsToUI();

        // Generate suggestions asynchronously to avoid blocking
        this.engine.generateSuggestions(trimmedText)
          .then((suggestions) => {
            this.sendSuggestionsToUI(suggestions);
          })
          .catch((error) => {
            console.error('[session] Failed to generate suggestions:', error);
            // Don't throw - suggestions are optional
          });
      } else {
        if (process.env.DEBUG_AUDIO === 'true' || this.isMusicOrNonSpeech(trimmedText)) {
          console.log('[session] Filtered out transcription (music/non-speech):', trimmedText);
        }
      }
    } catch (error) {
      console.error('[session] Transcription failed:', error);
      // Don't re-throw - allow processing to continue
      // Emit error event instead
      this.emit('error', error instanceof Error ? error : new Error(String(error)));
    } finally {
      // Always reset flag, even on error
      this.isTranscribing = false;
    }
  }

  async start(config: SessionConfig): Promise<void> {
    // If session is already active, stop it first to ensure clean state
    if (this.isActive) {
      console.warn('[session] Session already active, stopping it first');
      try {
        await this.stop();
        // Small delay to ensure cleanup completes
        await new Promise(resolve => setTimeout(resolve, 100));
      } catch (error) {
        console.error('[session] Error stopping existing session:', error);
        // Continue anyway - we'll try to start fresh
      }
    }

    console.log('[session] Starting session with config:', config);

    try {
      this.currentConfig = config;
      this.transcripts = [];
      this.sendTranscriptionsToUI();
      this.speechBuffer = [];
      this.isTranscribing = false;
      // Clear any pending speech end timeout
      if (this.speechEndTimeout) {
        clearTimeout(this.speechEndTimeout);
        this.speechEndTimeout = null;
      }

      // Check if streaming mode is enabled
      const engineConfig = this.engine.getTranscriptionConfig();
      const transcriptionMode = this.engine.getConfig().models.transcription.mode || 'batch';
      this.streamingMode = transcriptionMode === 'streaming' && engineConfig.allowLocal;
      console.log(`[session] Streaming mode: ${this.streamingMode}`);

      // Initialize streaming components if enabled
      if (this.streamingMode) {
        try {
          await this.initializeStreamingMode();
          console.log('[session] Streaming mode initialized');
        } catch (error) {
          console.error('[session] Failed to initialize streaming mode:', error);
          // Fallback to batch mode
          this.streamingMode = false;
        }
      }

      // Start engine session
      await this.engine.startSession(config);
      console.log('[session] Engine session started');

      // Mark as active BEFORE starting audio capture to ensure chunks are processed
      this.isActive = true;
      console.log(`[session] Session marked as active (mode: ${this.streamingMode ? 'streaming' : 'batch'})`);

      // Signal renderer to start audio capture
      if (this.mainWindow && !this.mainWindow.isDestroyed()) {
        this.mainWindow.webContents.send('start-audio-capture', {
          sources: ['microphone'],
          sampleRate: 16000,
          channels: 1,
          useAudioWorklet: true,
        });
        console.log('[session] Sent start-audio-capture signal to renderer');
      } else {
        console.warn('[session] Main window not available, cannot start audio capture');
      }

      this.emit('session-started', config);
    } catch (error) {
      // Ensure cleanup on error
      console.error('[session] Error starting session:', error);
      this.isActive = false;
      this.currentConfig = null;
      throw error;
    }
  }

  private async initializeStreamingMode(): Promise<void> {
    try {
      const engineConfig = this.engine.getConfig();
      const transcriptionConfig = this.engine.getTranscriptionConfig();
      const streamingConfig = engineConfig.models.transcription.streaming || {};
      
      // Determine streaming service type based on configuration
      const failoverOrder = transcriptionConfig.failoverOrder || [];
      
      // Check if cloud streaming is preferred (check failoverOrder first)
      if (failoverOrder[0] === 'cloud-assembly') {
        this.streamingServiceType = 'assemblyai';
      } else if (failoverOrder[0] === 'cloud-deepgram') {
        this.streamingServiceType = 'deepgram';
      } else if (transcriptionConfig.allowCloud && transcriptionConfig.allowLocal) {
        // Check if cloud services are in failover order for hybrid mode
        const hasCloudInOrder = failoverOrder.some(engine => 
          engine === 'cloud-assembly' || engine === 'cloud-deepgram'
        );
        if (hasCloudInOrder) {
          this.streamingServiceType = 'hybrid'; // Use local first, fallback to cloud
        } else {
          this.streamingServiceType = 'local';
        }
      } else {
        this.streamingServiceType = 'local';
      }

      // Initialize cloud streaming service if needed
      if (this.streamingServiceType === 'assemblyai' || this.streamingServiceType === 'hybrid') {
        try {
          this.cloudStreamingService = new AssemblyAIStreaming();
          await this.cloudStreamingService.connect();
          
          // Store event handler references for cleanup
          this.cloudStreamingEventHandlers.interim = (transcript: StreamingTranscript) => {
            this.handleInterimTranscript(transcript);
          };
          this.cloudStreamingEventHandlers.final = (transcript: StreamingTranscript) => {
            this.handleFinalTranscript(transcript);
          };
          this.cloudStreamingEventHandlers.error = (error: Error) => {
            console.error('[session] Cloud streaming error:', error);
            // Fallback to local if in hybrid mode
            if (this.streamingServiceType === 'hybrid' && this.streamingEngine) {
              console.log('[session] Falling back to local streaming');
              this.streamingServiceType = 'local';
            } else {
              this.emit('error', error);
            }
          };
          
          // Attach event handlers
          this.cloudStreamingService.on('interim', this.cloudStreamingEventHandlers.interim);
          this.cloudStreamingService.on('final', this.cloudStreamingEventHandlers.final);
          this.cloudStreamingService.on('error', this.cloudStreamingEventHandlers.error);
          
          console.log('[session] AssemblyAI streaming initialized');
        } catch (error) {
          console.warn('[session] Failed to initialize AssemblyAI streaming:', error);
          if (this.streamingServiceType === 'assemblyai') {
            // If AssemblyAI was required, try Deepgram
            this.streamingServiceType = 'deepgram';
          } else {
            // Fallback to local
            this.streamingServiceType = 'local';
          }
        }
      }
      
      if (this.streamingServiceType === 'deepgram' && !this.cloudStreamingService) {
        try {
          this.cloudStreamingService = new DeepgramStreaming();
          await this.cloudStreamingService.connect();
          
          // Store event handler references for cleanup
          this.cloudStreamingEventHandlers.interim = (transcript: StreamingTranscript) => {
            this.handleInterimTranscript(transcript);
          };
          this.cloudStreamingEventHandlers.final = (transcript: StreamingTranscript) => {
            this.handleFinalTranscript(transcript);
          };
          this.cloudStreamingEventHandlers.error = (error: Error) => {
            console.error('[session] Cloud streaming error:', error);
            this.emit('error', error);
          };
          
          // Attach event handlers
          this.cloudStreamingService.on('interim', this.cloudStreamingEventHandlers.interim);
          this.cloudStreamingService.on('final', this.cloudStreamingEventHandlers.final);
          this.cloudStreamingService.on('error', this.cloudStreamingEventHandlers.error);
          
          console.log('[session] Deepgram streaming initialized');
        } catch (error) {
          console.warn('[session] Failed to initialize Deepgram streaming:', error);
          // Fallback to local
          this.streamingServiceType = 'local';
        }
      }

      // Initialize local streaming engine (always for hybrid mode or as fallback)
      if (this.streamingServiceType === 'local' || this.streamingServiceType === 'hybrid') {
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
          // In hybrid mode, fallback to cloud
          if (this.streamingServiceType === 'hybrid' && this.cloudStreamingService) {
            console.log('[session] Falling back to cloud streaming');
            this.streamingServiceType = this.cloudStreamingService instanceof AssemblyAIStreaming ? 'assemblyai' : 'deepgram';
          } else {
            this.emit('error', error);
          }
        });
      }

      // Create sentence assembler (used for all streaming modes)
      this.sentenceAssembler = new SentenceAssembler();
      this.sentenceAssembler.on('sentence', (sentence: CompleteSentence) => {
        this.handleCompleteSentence(sentence);
      });

      console.log(`[session] Streaming mode initialized (type: ${this.streamingServiceType})`);
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
    // Filter out non-speech transcriptions (same as batch mode)
    const text = transcript.text?.trim() || '';
    if (
      text.length <= 2 || // Filter out very short transcriptions that are likely noise
      this.isMusicOrNonSpeech(text)
    ) {
      if (process.env.DEBUG_AUDIO === 'true') {
        console.log('[session] Filtered out transcription:', text);
      }
      return;
    }

    // Send to sentence assembler
    if (this.sentenceAssembler) {
      this.sentenceAssembler.addFinalTranscript(text, transcript.words || []);
    } else {
      // Fallback: add directly to transcripts
      this.transcripts.push({
        text: text,
        timestamp: transcript.timestamp,
      });
      this.sendTranscriptionsToUI();
    }
  }

  private async handleCompleteSentence(sentence: CompleteSentence): Promise<void> {
    // Filter out non-speech transcriptions (same as batch mode)
    const text = sentence.text?.trim() || '';
    if (
      text.length <= 2 || // Filter out very short transcriptions that are likely noise
      this.isMusicOrNonSpeech(text)
    ) {
      if (process.env.DEBUG_AUDIO === 'true') {
        console.log('[session] Filtered out sentence:', text);
      }
      return;
    }

    // Add to transcripts
    this.transcripts.push({
      text: text,
      timestamp: sentence.startTime,
    });
    this.sendTranscriptionsToUI();

    // Generate suggestions
    try {
      const suggestions = await this.engine.generateSuggestions(text);
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
    // Always allow stop to be called, even if session appears inactive
    // This ensures cleanup happens properly
    const wasActive = this.isActive;
    const hadConfig = !!this.currentConfig;
    
    if (!wasActive && !hadConfig) {
      console.log('[session] Stop called but session not active and no config');
      // Still ensure cleanup
      this.isActive = false;
      this.isTranscribing = false;
      return;
    }

    console.log('[session] Stopping session...', { wasActive, hadConfig });

    // Set stopping flag to allow processing during flush phase
    // Keep isActive=true until after flush completes to allow final chunks
    this.isStopping = true;
    
    // Reset transcription flag to allow cleanup
    this.isTranscribing = false;

    // Clear any pending speech end timeout
    if (this.speechEndTimeout) {
      clearTimeout(this.speechEndTimeout);
      this.speechEndTimeout = null;
    }

    // Signal renderer to stop audio capture first (non-blocking)
    try {
      if (this.mainWindow && !this.mainWindow.isDestroyed()) {
        this.mainWindow.webContents.send('stop-audio-capture');
        console.log('[session] Sent stop-audio-capture signal to renderer');
      }
    } catch (error) {
      console.warn('[session] Error sending stop-audio-capture:', error);
    }

    // Flush streaming components if active (with timeout to prevent hanging)
    if (this.streamingMode) {
      // Remove event listeners first to prevent memory leaks
      if (this.cloudStreamingService) {
        if (this.cloudStreamingEventHandlers.interim) {
          this.cloudStreamingService.removeListener('interim', this.cloudStreamingEventHandlers.interim);
        }
        if (this.cloudStreamingEventHandlers.final) {
          this.cloudStreamingService.removeListener('final', this.cloudStreamingEventHandlers.final);
        }
        if (this.cloudStreamingEventHandlers.error) {
          this.cloudStreamingService.removeListener('error', this.cloudStreamingEventHandlers.error);
        }
        // Clear handler references
        this.cloudStreamingEventHandlers = {};
      }

      const flushPromises: Promise<void>[] = [];
      const timeoutIds: NodeJS.Timeout[] = [];
      
      if (this.streamingEngine) {
        const timeoutPromise = new Promise<void>((resolve) => {
          const timeoutId = setTimeout(() => resolve(), 1000); // 1s timeout
          timeoutIds.push(timeoutId);
        });
        flushPromises.push(
          Promise.race([
            this.streamingEngine.flush(),
            timeoutPromise
          ]).then(() => {
            this.streamingEngine?.reset();
          })
        );
      }
      
      if (this.cloudStreamingService) {
        const timeoutPromise = new Promise<void>((resolve) => {
          const timeoutId = setTimeout(() => resolve(), 2000); // 2s timeout
          timeoutIds.push(timeoutId);
        });
        flushPromises.push(
          Promise.race([
            this.cloudStreamingService.disconnect(),
            timeoutPromise
          ]).then(() => {
            this.cloudStreamingService = null;
          })
        );
      }
      
      if (this.sentenceAssembler) {
        const timeoutPromise = new Promise<void>((resolve) => {
          const timeoutId = setTimeout(() => resolve(), 500); // 500ms timeout
          timeoutIds.push(timeoutId);
        });
        flushPromises.push(
          Promise.race([
            this.sentenceAssembler.flush(),
            timeoutPromise
          ]).then(() => {
            this.sentenceAssembler?.reset();
          })
        );
      }

      // Wait for all flush operations with overall timeout
      try {
        const overallTimeoutPromise = new Promise<void>((resolve) => {
          const timeoutId = setTimeout(() => {
            console.warn('[session] Flush operations timed out, forcing stop');
            resolve();
          }, 3000); // 3s overall timeout
          timeoutIds.push(timeoutId);
        });
        await Promise.race([
          Promise.all(flushPromises).catch((error) => {
            console.warn('[session] Some flush operations failed:', error);
          }),
          overallTimeoutPromise
        ]);
      } catch (error) {
        console.warn('[session] Error during streaming cleanup:', error);
      } finally {
        // Clean up all timeout timers
        timeoutIds.forEach(id => clearTimeout(id));
      }
    }

    // Clean up state (ensure all flags are reset)
    try {
      await this.engine.stopSession();
      console.log('[session] Engine session stopped');
    } catch (error) {
      console.warn('[session] Error stopping engine session:', error);
      // Continue with cleanup even if engine stop fails
    }
    
    // Always reset state, regardless of errors
    this.currentConfig = null;
    this.speechBuffer = [];
    this.isTranscribing = false; // Ensure flag is reset
    this.streamingMode = false;
    this.streamingEngine = null;
    this.sentenceAssembler = null;
    this.cloudStreamingService = null;
    this.streamingServiceType = 'local';
    this.isStopping = false; // Reset stopping flag

    try {
      this.sendSuggestionsToUI([]);
      this.transcripts = [];
      this.sendTranscriptionsToUI();
    } catch (error) {
      console.warn('[session] Error sending final UI updates:', error);
    }

    // Mark as inactive AFTER all cleanup is complete
    // This ensures final chunks can be processed during flush
    this.isActive = false;

    console.log('[session] Session stopped successfully');
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

