"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const electron_1 = require("electron");
// Expose protected methods that allow the renderer process to use
// the ipcRenderer without exposing the entire object
electron_1.contextBridge.exposeInMainWorld('electronAPI', {
    getDesktopSources: () => electron_1.ipcRenderer.invoke('get-desktop-sources'),
    getAppVersion: () => electron_1.ipcRenderer.invoke('app-version'),
    getPlatform: () => electron_1.ipcRenderer.invoke('platform'),
    invoke: (channel, data) => {
        const validChannels = ['start-session', 'stop-session', 'pause-session', 'session-manager-ready'];
        if (validChannels.includes(channel)) {
            return electron_1.ipcRenderer.invoke(channel, data);
        }
        return Promise.reject(new Error(`Invalid channel: ${channel}`));
    },
    on: (channel, callback) => {
        const validChannels = ['suggestions-update', 'transcriptions-update', 'session-status', 'error', 'start-audio-capture', 'stop-audio-capture', 'session-manager-ready'];
        if (validChannels.includes(channel)) {
            electron_1.ipcRenderer.on(channel, (_event, ...args) => callback(...args));
        }
    },
    removeListener: (channel, callback) => {
        const validChannels = ['suggestions-update', 'transcriptions-update', 'session-status', 'error', 'start-audio-capture', 'stop-audio-capture', 'session-manager-ready'];
        if (validChannels.includes(channel)) {
            electron_1.ipcRenderer.removeListener(channel, callback);
        }
    },
    send: (channel, data) => {
        const validChannels = ['update-settings', 'audio-chunk'];
        if (validChannels.includes(channel)) {
            electron_1.ipcRenderer.send(channel, data);
        }
    },
});
