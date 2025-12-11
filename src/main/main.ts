import { app, BrowserWindow, ipcMain, desktopCapturer } from 'electron';
import * as path from 'path';
import { setupSecurity } from './security';
import { setupAutoUpdater } from './auto-updater';
import { AIConsulEngine } from '../core/engine';
import { SessionManager } from '../core/session';
import { setupErrorHandling } from '../utils/error-handler';

let mainWindow: BrowserWindow | null = null;
let companionWindow: BrowserWindow | null = null;
let transcriptWindow: BrowserWindow | null = null;
let engine: AIConsulEngine | null = null;
let sessionManager: SessionManager | null = null;

const isDev = process.env.NODE_ENV === 'development' || !app.isPackaged;

function createMainWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 800,
    minHeight: 600,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js'),
      sandbox: false,
    },
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
  });

  if (isDev) {
    mainWindow.loadURL('http://localhost:5173');
    mainWindow.webContents.openDevTools();
  } else {
    mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'));
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

function createCompanionWindow(): void {
  companionWindow = new BrowserWindow({
    width: 400,
    height: 300,
    frame: false,
    alwaysOnTop: true,
    transparent: true,
    skipTaskbar: true,
    movable: true,
    resizable: true,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js'),
      sandbox: false,
    },
  });

  if (isDev) {
    companionWindow.loadURL('http://localhost:5173/companion');
  } else {
    companionWindow.loadFile(path.join(__dirname, '../renderer/index.html'), {
      hash: 'companion',
    });
  }

  companionWindow.on('closed', () => {
    companionWindow = null;
  });
}

function createTranscriptWindow(): void {
  transcriptWindow = new BrowserWindow({
    width: 500,
    height: 600,
    minWidth: 320,
    minHeight: 400,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js'),
      sandbox: false,
    },
    title: 'AI Consul Transcript',
    show: false, // Don't show immediately - will be shown when needed
  });

  if (isDev) {
    transcriptWindow.loadURL('http://localhost:5173/transcript');
  } else {
    transcriptWindow.loadFile(path.join(__dirname, '../renderer/index.html'), {
      hash: 'transcript',
    });
  }

  // Show window when ready to receive messages
  transcriptWindow.webContents.once('did-finish-load', () => {
    if (transcriptWindow && !transcriptWindow.isDestroyed()) {
      transcriptWindow.show();
      console.log('[main] Transcript window ready and shown');
    }
  });

  transcriptWindow.on('closed', () => {
    transcriptWindow = null;
  });
}

// IPC Handlers
ipcMain.handle('get-desktop-sources', async () => {
  const sources = await desktopCapturer.getSources({
    types: ['window', 'screen'],
    thumbnailSize: { width: 0, height: 0 },
  });
  return sources.map((source) => ({
    id: source.id,
    name: source.name,
  }));
});

ipcMain.handle('app-version', () => {
  return app.getVersion();
});

ipcMain.handle('platform', () => {
  return process.platform;
});

// Check if session manager is ready
// If not ready, try to create it immediately (fallback for race conditions)
ipcMain.handle('session-manager-ready', () => {
  console.log('=== IPC handler called ===');
  console.log('sessionManager:', sessionManager);
  console.log('engine:', engine);
  console.log('mainWindow:', mainWindow !== null);
  console.log('companionWindow:', companionWindow !== null);
  
  if (sessionManager === null) {
    console.log('Session manager is null, attempting to create...');
    
    // Try to create engine if it doesn't exist
    if (engine === null) {
      console.log('Engine is also null, creating engine first...');
      try {
        const enableStreaming = process.env.ENABLE_STREAMING === 'true';
        const transcriptionMode = enableStreaming ? 'streaming' : 'batch';
        
        engine = new AIConsulEngine({
          privacy: {
            offlineFirst: true,
            cloudFallback: false,
            dataRetention: 7,
          },
          performance: {
            hardwareTier: 'auto-detect',
            latencyTarget: 5000,
            qualityPreference: 'balanced',
          },
          models: {
            transcription: {
              primary: 'local-whisper-base',
              fallback: 'cloud-whisper',
              mode: transcriptionMode,
              streaming: enableStreaming ? {
                windowSize: parseFloat(process.env.STREAMING_WINDOW_SIZE || '2.0'),
                stepSize: parseFloat(process.env.STREAMING_STEP_SIZE || '1.0'),
                overlapRatio: parseFloat(process.env.STREAMING_OVERLAP_RATIO || '0.5'),
              } : undefined,
            },
            llm: {
              primary: 'ollama://llama3:8b',
              fallbacks: ['gpt-4o-mini', 'claude-3-haiku'],
            },
          },
        });
        console.log('Engine created in IPC handler');
      } catch (error) {
        console.error('Error creating engine in IPC handler:', error);
      }
    }
    
    // Now create session manager if engine exists
    if (engine !== null) {
      console.log('Creating session manager with existing engine...');
      try {
        sessionManager = new SessionManager(engine);
        console.log('Session manager created successfully in IPC handler');
        
        if (mainWindow && companionWindow) {
          sessionManager.setWindows(mainWindow, companionWindow, transcriptWindow ?? undefined);
          console.log('Session manager windows set in IPC handler');
        } else {
          console.warn('Windows not available in IPC handler');
        }
      } catch (error) {
        console.error('Error creating session manager in IPC handler:', error);
        console.error('Error stack:', error instanceof Error ? error.stack : 'No stack');
      }
    } else {
      console.error('Cannot create session manager: engine is null');
    }
  }
  
  const ready = sessionManager !== null;
  console.log(`=== IPC handler returning: ready=${ready} ===`);
  return { ready };
});

// Session management IPC handlers - registered at module load, sessionManager checked at runtime
ipcMain.handle('start-session', async (_event, config) => {
  console.log('[main] start-session IPC handler called with config:', config);
  if (!sessionManager) {
    console.error('[main] Session manager not initialized');
    throw new Error('Session manager not initialized. Please wait for the app to finish loading.');
  }
  try {
    console.log('[main] Calling sessionManager.start()');
    await sessionManager.start(config);
    console.log('[main] sessionManager.start() completed successfully');
    // Send status update to renderer
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('session-status', { isActive: true, mode: config.mode });
    }
    return { success: true };
  } catch (error: any) {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('error', error.message || 'Failed to start session');
    }
    throw error;
  }
});

ipcMain.handle('stop-session', async () => {
  console.log('[main] stop-session IPC handler called');
  if (!sessionManager) {
    console.error('[main] Session manager not initialized');
    return { success: false, error: 'Session manager not initialized' };
  }
  try {
    console.log('[main] Calling sessionManager.stop()');
    // Add timeout to prevent hanging
    const stopPromise = sessionManager.stop();
    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error('Stop session timed out after 5 seconds')), 5000);
    });
    
    await Promise.race([stopPromise, timeoutPromise]);
    console.log('[main] sessionManager.stop() completed');
    
    // Send status update to renderer
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('session-status', { isActive: false });
    }
    return { success: true };
  } catch (error: any) {
    console.error('[main] Error stopping session:', error);
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('error', error.message || 'Failed to stop session');
      mainWindow.webContents.send('session-status', { isActive: false });
    }
    // Still return success to allow UI to update
    return { success: false, error: error.message };
  }
});

ipcMain.handle('pause-session', async () => {
  if (!sessionManager) {
    return { success: false, error: 'Session manager not initialized' };
  }
  try {
    await sessionManager.pause();
    return { success: true };
  } catch (error: any) {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('error', error.message || 'Failed to pause session');
    }
    return { success: false };
  }
});

// Handle audio chunks from renderer
ipcMain.on('audio-chunk', async (_event, chunkData: { 
  data: string; // Base64 encoded Float32Array buffer
  dataLength: number; // Original array length
  sampleRate: number; 
  channels: number; 
  timestamp: number 
}) => {
  try {
    console.log('[main] audio-chunk IPC received:', {
      dataLength: chunkData.dataLength,
      sampleRate: chunkData.sampleRate,
      channels: chunkData.channels,
      timestamp: chunkData.timestamp,
      hasSessionManager: !!sessionManager
    });

    if (!sessionManager) {
      console.error('[main] No session manager available');
      return;
    }

    // Decode base64 back to Float32Array
    let binaryString: string;
    try {
      binaryString = atob(chunkData.data);
    } catch (error) {
      console.error('[main] Failed to decode base64 audio data:', error);
      return;
    }
    
    // Convert binary string to Uint8Array
    const uint8Array = new Uint8Array(binaryString.length);
    for (let i = 0; i < binaryString.length; i++) {
      uint8Array[i] = binaryString.charCodeAt(i);
    }
    
    // Expected byte length: Float32Array length * 4 bytes per float
    const expectedByteLength = chunkData.dataLength * Float32Array.BYTES_PER_ELEMENT;
    
    // Validate buffer size matches expected
    if (uint8Array.length !== expectedByteLength) {
      console.error('[main] Audio buffer size mismatch after decode:', {
        expectedBytes: expectedByteLength,
        actualBytes: uint8Array.length,
        expectedSamples: chunkData.dataLength,
        actualSamples: uint8Array.length / Float32Array.BYTES_PER_ELEMENT
      });
      return;
    }
    
    // Create Float32Array from the decoded buffer
    // Use the buffer directly - it should be correctly aligned
    const float32Array = new Float32Array(uint8Array.buffer, 0, chunkData.dataLength);
    
    // Validate decoded length matches expected
    if (float32Array.length !== chunkData.dataLength) {
      console.error('[main] Audio data length mismatch after decode:', {
        expected: chunkData.dataLength,
        actual: float32Array.length
      });
      return;
    }
    
    // Debug: Log first few samples to verify data integrity
    if (process.env.DEBUG_AUDIO === 'true' && float32Array.length > 0) {
      console.log('[main] Decoded audio sample preview:', {
        first3: Array.from(float32Array.slice(0, 3)),
        max: Math.max(...Array.from(float32Array.slice(0, 100))),
        min: Math.min(...Array.from(float32Array.slice(0, 100)))
      });
    }

    // Calculate amplitude safely (avoid stack overflow with large arrays)
    let maxAmplitude = 0;
    let sumAmplitude = 0;
    for (let i = 0; i < float32Array.length; i++) {
      const abs = Math.abs(float32Array[i]);
      if (abs > maxAmplitude) {
        maxAmplitude = abs;
      }
      sumAmplitude += abs;
    }
    const avgAmplitude = sumAmplitude / float32Array.length;
    
    const chunk = {
      data: float32Array,
      sampleRate: chunkData.sampleRate,
      channels: chunkData.channels,
      timestamp: chunkData.timestamp,
      maxAmplitude,
    };

    console.log('[main] Processing audio chunk:', {
      dataLength: float32Array.length,
      sampleRate: chunk.sampleRate,
      channels: chunk.channels,
      maxAmplitude,
      avgAmplitude,
    });

    await sessionManager.processAudioChunk(chunk);
    console.log('[main] Audio chunk processed successfully');
  } catch (error) {
    console.error('[main] Error processing audio chunk:', error);
  }
});

// Initialize immediately when app is ready
app.whenReady().then(async () => {
  console.log('=== app.whenReady() fired ===');
  setupErrorHandling();
  setupSecurity();
  
  // Create windows FIRST - they must exist before session manager
  console.log('Creating windows...');
  createMainWindow();
  createCompanionWindow();
  createTranscriptWindow();
  console.log('Windows created');
  
  // Wait a moment for windows to be fully created
  await new Promise(resolve => setTimeout(resolve, 100));
  console.log('Windows ready, proceeding with initialization');

  // Initialize AI engine object (not initialized yet, just created)
  // Check if streaming mode is enabled via environment variable
  const enableStreaming = process.env.ENABLE_STREAMING === 'true';
  const transcriptionMode = enableStreaming ? 'streaming' : 'batch';
  
  engine = new AIConsulEngine({
    privacy: {
      offlineFirst: true,
      cloudFallback: false,
      dataRetention: 7,
    },
    performance: {
      hardwareTier: 'auto-detect',
      latencyTarget: 5000,
      qualityPreference: 'balanced',
    },
    models: {
      transcription: {
        primary: 'local-whisper-base',
        fallback: 'cloud-whisper',
        mode: transcriptionMode,
        streaming: enableStreaming ? {
          windowSize: parseFloat(process.env.STREAMING_WINDOW_SIZE || '2.0'),
          stepSize: parseFloat(process.env.STREAMING_STEP_SIZE || '1.0'),
          overlapRatio: parseFloat(process.env.STREAMING_OVERLAP_RATIO || '0.5'),
        } : undefined,
      },
      llm: {
        primary: 'ollama://llama3:8b',
        fallbacks: ['gpt-4o-mini', 'claude-3-haiku'],
      },
    },
  });

  // Create session manager IMMEDIATELY after engine object is created
  // This happens synchronously, before renderer starts polling
  try {
    console.log('=== Creating session manager ===');
    console.log('Engine object exists:', engine !== null);
    console.log('Main window exists:', mainWindow !== null);
    console.log('Companion window exists:', companionWindow !== null);
    
    sessionManager = new SessionManager(engine);
    console.log('Session manager created successfully');
    console.log('Session manager is not null:', sessionManager !== null);
    
    // Set windows if they exist
    if (mainWindow && companionWindow) {
      sessionManager.setWindows(mainWindow, companionWindow, transcriptWindow ?? undefined);
      console.log('Session manager windows set');
    } else {
      console.warn('Windows not ready, session manager created without window context');
    }
    
    // Verify the handler will return true
    const handlerCheck = sessionManager !== null;
    console.log('IPC handler will return ready:', handlerCheck);
    
    // Notify renderer that session manager is ready
    // Use 'did-finish-load' event to ensure renderer is ready to receive
    const notifyReady = () => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        console.log('Sending session-manager-ready event to renderer');
        mainWindow.webContents.send('session-manager-ready', { ready: true });
      } else {
        console.error('Main window is destroyed, cannot send ready event');
      }
    };
    
    // Wait for renderer to finish loading, then notify
    if (mainWindow) {
      mainWindow.webContents.once('did-finish-load', () => {
        console.log('Renderer finished loading, sending ready event');
        notifyReady();
        // Also send after a short delay to be safe
        setTimeout(notifyReady, 100);
        setTimeout(notifyReady, 500);
      });
      
      // If already loaded, send immediately
      if (mainWindow.webContents.isLoading() === false) {
        setTimeout(notifyReady, 100);
      }
    }
    
    console.log('=== Session manager initialization complete ===');
  } catch (error) {
    console.error('=== ERROR creating session manager ===');
    console.error('Error:', error);
    console.error('Stack:', error instanceof Error ? error.stack : 'No stack');
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('error', `Session manager creation failed: ${error}`);
    }
  }

  // Initialize engine in background (non-blocking)
  (async () => {
    try {
      console.log('=== Starting engine initialization (background) ===');
      console.log('Initializing AI engine...');
      await engine.initialize();
      console.log('AI engine initialized successfully');
      console.log('=== Engine initialization complete ===');
    } catch (error) {
      console.error('=== Error during engine initialization ===');
      console.error('Error:', error);
      console.error('Stack:', error instanceof Error ? error.stack : 'No stack');
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('error', `Engine initialization failed: ${error}`);
      }
    }
  })();

  if (!isDev) {
    setupAutoUpdater();
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createMainWindow();
      createCompanionWindow();
      createTranscriptWindow();
      if (sessionManager && mainWindow && companionWindow) {
        sessionManager.setWindows(mainWindow, companionWindow, transcriptWindow ?? undefined);
      }
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('before-quit', () => {
  if (companionWindow) {
    companionWindow.destroy();
  }
});

