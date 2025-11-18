"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
const electron_1 = require("electron");
const path = __importStar(require("path"));
const security_1 = require("./security");
const auto_updater_1 = require("./auto-updater");
const engine_1 = require("../core/engine");
const session_1 = require("../core/session");
const error_handler_1 = require("../utils/error-handler");
let mainWindow = null;
let companionWindow = null;
let transcriptWindow = null;
let engine = null;
let sessionManager = null;
const isDev = process.env.NODE_ENV === 'development' || !electron_1.app.isPackaged;
function createMainWindow() {
    mainWindow = new electron_1.BrowserWindow({
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
    }
    else {
        mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'));
    }
    mainWindow.on('closed', () => {
        mainWindow = null;
    });
}
function createCompanionWindow() {
    companionWindow = new electron_1.BrowserWindow({
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
    }
    else {
        companionWindow.loadFile(path.join(__dirname, '../renderer/index.html'), {
            hash: 'companion',
        });
    }
    companionWindow.on('closed', () => {
        companionWindow = null;
    });
}
function createTranscriptWindow() {
    transcriptWindow = new electron_1.BrowserWindow({
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
    });
    if (isDev) {
        transcriptWindow.loadURL('http://localhost:5173/transcript');
    }
    else {
        transcriptWindow.loadFile(path.join(__dirname, '../renderer/index.html'), {
            hash: 'transcript',
        });
    }
    transcriptWindow.on('closed', () => {
        transcriptWindow = null;
    });
}
// IPC Handlers
electron_1.ipcMain.handle('get-desktop-sources', async () => {
    const sources = await electron_1.desktopCapturer.getSources({
        types: ['window', 'screen'],
        thumbnailSize: { width: 0, height: 0 },
    });
    return sources.map((source) => ({
        id: source.id,
        name: source.name,
    }));
});
electron_1.ipcMain.handle('app-version', () => {
    return electron_1.app.getVersion();
});
electron_1.ipcMain.handle('platform', () => {
    return process.platform;
});
// Check if session manager is ready
// If not ready, try to create it immediately (fallback for race conditions)
electron_1.ipcMain.handle('session-manager-ready', () => {
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
                engine = new engine_1.AIConsulEngine({
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
                        },
                        llm: {
                            primary: 'ollama://llama3:8b',
                            fallbacks: ['gpt-4o-mini', 'claude-3-haiku'],
                        },
                    },
                });
                console.log('Engine created in IPC handler');
            }
            catch (error) {
                console.error('Error creating engine in IPC handler:', error);
            }
        }
        // Now create session manager if engine exists
        if (engine !== null) {
            console.log('Creating session manager with existing engine...');
            try {
                sessionManager = new session_1.SessionManager(engine);
                console.log('Session manager created successfully in IPC handler');
                if (mainWindow && companionWindow) {
                    sessionManager.setWindows(mainWindow, companionWindow, transcriptWindow ?? undefined);
                    console.log('Session manager windows set in IPC handler');
                }
                else {
                    console.warn('Windows not available in IPC handler');
                }
            }
            catch (error) {
                console.error('Error creating session manager in IPC handler:', error);
                console.error('Error stack:', error instanceof Error ? error.stack : 'No stack');
            }
        }
        else {
            console.error('Cannot create session manager: engine is null');
        }
    }
    const ready = sessionManager !== null;
    console.log(`=== IPC handler returning: ready=${ready} ===`);
    return { ready };
});
// Session management IPC handlers - registered at module load, sessionManager checked at runtime
electron_1.ipcMain.handle('start-session', async (_event, config) => {
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
    }
    catch (error) {
        if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send('error', error.message || 'Failed to start session');
        }
        throw error;
    }
});
electron_1.ipcMain.handle('stop-session', async () => {
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
    }
    catch (error) {
        if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send('error', error.message || 'Failed to stop session');
        }
        return { success: false };
    }
});
electron_1.ipcMain.handle('pause-session', async () => {
    if (!sessionManager) {
        return { success: false, error: 'Session manager not initialized' };
    }
    try {
        await sessionManager.pause();
        return { success: true };
    }
    catch (error) {
        if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send('error', error.message || 'Failed to pause session');
        }
        return { success: false };
    }
});
// Handle audio chunks from renderer
electron_1.ipcMain.on('audio-chunk', async (_event, chunkData) => {
    try {
        console.log('[main] audio-chunk IPC received:', {
            dataLength: chunkData.data?.length,
            sampleRate: chunkData.sampleRate,
            channels: chunkData.channels,
            timestamp: chunkData.timestamp,
            hasSessionManager: !!sessionManager
        });
        if (!sessionManager) {
            console.error('[main] No session manager available');
            return;
        }
        // Convert array back to Float32Array
        const float32Array = new Float32Array(chunkData.data);
        const maxAmplitude = float32Array.reduce((max, value) => Math.max(max, Math.abs(value)), 0);
        const avgAmplitude = float32Array.reduce((sum, val) => sum + Math.abs(val), 0) / float32Array.length;
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
    }
    catch (error) {
        console.error('[main] Error processing audio chunk:', error);
    }
});
// Initialize immediately when app is ready
electron_1.app.whenReady().then(async () => {
    console.log('=== app.whenReady() fired ===');
    (0, error_handler_1.setupErrorHandling)();
    (0, security_1.setupSecurity)();
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
    engine = new engine_1.AIConsulEngine({
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
        sessionManager = new session_1.SessionManager(engine);
        console.log('Session manager created successfully');
        console.log('Session manager is not null:', sessionManager !== null);
        // Set windows if they exist
        if (mainWindow && companionWindow) {
            sessionManager.setWindows(mainWindow, companionWindow, transcriptWindow ?? undefined);
            console.log('Session manager windows set');
        }
        else {
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
            }
            else {
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
    }
    catch (error) {
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
        }
        catch (error) {
            console.error('=== Error during engine initialization ===');
            console.error('Error:', error);
            console.error('Stack:', error instanceof Error ? error.stack : 'No stack');
            if (mainWindow && !mainWindow.isDestroyed()) {
                mainWindow.webContents.send('error', `Engine initialization failed: ${error}`);
            }
        }
    })();
    if (!isDev) {
        (0, auto_updater_1.setupAutoUpdater)();
    }
    electron_1.app.on('activate', () => {
        if (electron_1.BrowserWindow.getAllWindows().length === 0) {
            createMainWindow();
            createCompanionWindow();
            createTranscriptWindow();
            if (sessionManager && mainWindow && companionWindow) {
                sessionManager.setWindows(mainWindow, companionWindow, transcriptWindow ?? undefined);
            }
        }
    });
});
electron_1.app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
        electron_1.app.quit();
    }
});
electron_1.app.on('before-quit', () => {
    if (companionWindow) {
        companionWindow.destroy();
    }
});
