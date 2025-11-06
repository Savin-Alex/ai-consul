import { app, BrowserWindow, ipcMain, desktopCapturer } from 'electron';
import * as path from 'path';
import { setupSecurity } from './security';
import { setupAutoUpdater } from './auto-updater';
import { AIConsulEngine } from '../core/engine';
import { SessionManager } from '../core/session';
import { setupErrorHandling } from '../utils/error-handler';

let mainWindow: BrowserWindow | null = null;
let companionWindow: BrowserWindow | null = null;
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
ipcMain.handle('session-manager-ready', () => {
  const ready = sessionManager !== null;
  console.log(`session-manager-ready check: ${ready}`);
  return { ready };
});

// Session management IPC handlers - registered at module load, sessionManager checked at runtime
ipcMain.handle('start-session', async (_event, config) => {
  if (!sessionManager) {
    throw new Error('Session manager not initialized. Please wait for the app to finish loading.');
  }
  try {
    await sessionManager.start(config);
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
  if (!sessionManager) {
    return { success: false, error: 'Session manager not initialized' };
  }
  try {
    await sessionManager.stop();
    // Send status update to renderer
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('session-status', { isActive: false });
    }
    return { success: true };
  } catch (error: any) {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('error', error.message || 'Failed to stop session');
    }
    return { success: false };
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
ipcMain.on('audio-chunk', async (_event, chunkData: { data: number[]; sampleRate: number; channels: number; timestamp: number }) => {
  if (!sessionManager) return;
  
  // Convert array back to Float32Array
  const float32Array = new Float32Array(chunkData.data);
  const chunk = {
    data: float32Array,
    sampleRate: chunkData.sampleRate,
    channels: chunkData.channels,
    timestamp: chunkData.timestamp,
  };
  
  await sessionManager.processAudioChunk(chunk);
});

app.whenReady().then(async () => {
  setupErrorHandling();
  setupSecurity();
  createMainWindow();
  createCompanionWindow();

  // Initialize AI engine
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
        primary: 'local-whisper-tiny',
        fallback: 'cloud-whisper',
      },
      llm: {
        primary: 'ollama://llama3:8b',
        fallbacks: ['gpt-4o-mini', 'claude-3-haiku'],
      },
    },
  });

  // Create session manager immediately (don't wait for engine initialization)
  console.log('Creating session manager immediately...');
  sessionManager = new SessionManager(engine);
  console.log('Session manager created, ready:', sessionManager !== null);
  
  if (mainWindow && companionWindow) {
    sessionManager.setWindows(mainWindow, companionWindow);
    console.log('Session manager windows set');
  }
  
  // Notify renderer that session manager is ready immediately
  const notifyReady = () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      console.log('Sending session-manager-ready event to renderer');
      mainWindow.webContents.send('session-manager-ready', { ready: true });
    } else {
      console.error('Main window is destroyed, cannot send ready event');
    }
  };
  
  // Send immediately and multiple times
  setTimeout(notifyReady, 100);
  setTimeout(notifyReady, 500);
  setTimeout(notifyReady, 1000);
  setTimeout(notifyReady, 2000);

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
      if (sessionManager && mainWindow && companionWindow) {
        sessionManager.setWindows(mainWindow, companionWindow);
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

