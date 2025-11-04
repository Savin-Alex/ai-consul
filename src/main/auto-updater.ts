import { autoUpdater } from 'electron-updater';
import { app } from 'electron';
import * as dotenv from 'dotenv';

dotenv.config();

export function setupAutoUpdater(): void {
  // Configure auto-updater
  autoUpdater.setFeedURL({
    provider: 'github',
    owner: 'your-company',
    repo: 'ai-consul',
  });

  // Custom update endpoint if provided
  if (process.env.UPDATE_ENDPOINT) {
    autoUpdater.setFeedURL({
      provider: 'generic',
      url: process.env.UPDATE_ENDPOINT,
    });
  }

  autoUpdater.checkForUpdatesAndNotify();

  // Check for updates every 4 hours
  setInterval(() => {
    autoUpdater.checkForUpdatesAndNotify();
  }, 4 * 60 * 60 * 1000);

  autoUpdater.on('checking-for-update', () => {
    console.log('Checking for update...');
  });

  autoUpdater.on('update-available', () => {
    console.log('Update available');
  });

  autoUpdater.on('update-not-available', () => {
    console.log('Update not available');
  });

  autoUpdater.on('error', (err) => {
    console.error('Error in auto-updater:', err);
  });

  autoUpdater.on('update-downloaded', () => {
    console.log('Update downloaded, will install on restart');
    // Optionally prompt user to restart
  });
}

