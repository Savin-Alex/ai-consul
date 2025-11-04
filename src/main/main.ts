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
      preload: path.join(__dirname, 'preload.cjs'),
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
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.cjs'),
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

// Session management IPC handlers
ipcMain.handle('start-session', async (_event, config) => {
  if (!sessionManager) {
    throw new Error('Session manager not initialized');
  }
  await sessionManager.start(config);
  return { success: true };
});

ipcMain.handle('stop-session', async () => {
  if (!sessionManager) {
    return { success: false };
  }
  await sessionManager.stop();
  return { success: true };
});

ipcMain.handle('pause-session', async () => {
  if (!sessionManager) {
    return { success: false };
  }
  await sessionManager.pause();
  return { success: true };
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

  await engine.initialize();

  // Initialize session manager
  sessionManager = new SessionManager(engine);
  if (mainWindow && companionWindow) {
    sessionManager.setWindows(mainWindow, companionWindow);
  }

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

