import { contextBridge, ipcRenderer } from 'electron';

// Expose protected methods that allow the renderer process to use
// the ipcRenderer without exposing the entire object
contextBridge.exposeInMainWorld('electronAPI', {
  getDesktopSources: () => ipcRenderer.invoke('get-desktop-sources'),
  getAppVersion: () => ipcRenderer.invoke('app-version'),
  getPlatform: () => ipcRenderer.invoke('platform'),
  invoke: (channel: string, data?: any) => {
    const validChannels = ['start-session', 'stop-session', 'pause-session', 'session-manager-ready'];
    if (validChannels.includes(channel)) {
      return ipcRenderer.invoke(channel, data);
    }
    return Promise.reject(new Error(`Invalid channel: ${channel}`));
  },
  on: (channel: string, callback: (...args: any[]) => void) => {
    const validChannels = ['suggestions-update', 'session-status', 'error', 'start-audio-capture', 'stop-audio-capture', 'session-manager-ready'];
    if (validChannels.includes(channel)) {
      ipcRenderer.on(channel, (_event, ...args) => callback(...args));
    }
  },
  send: (channel: string, data: any) => {
    const validChannels = ['update-settings', 'audio-chunk'];
    if (validChannels.includes(channel)) {
      ipcRenderer.send(channel, data);
    }
  },
});

