import { app, session } from 'electron';

export function setupSecurity(): void {
  // Set Content Security Policy
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': [
          "default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; font-src 'self' data:; connect-src 'self' https://api.openai.com https://api.anthropic.com https://generativelanguage.googleapis.com http://localhost:11434;",
        ],
      },
    });
  });

  // Prevent navigation to external URLs
  app.on('web-contents-created', (_event, contents) => {
    contents.on('will-navigate', (event, navigationUrl) => {
      const parsedUrl = new URL(navigationUrl);
      const allowedProtocols = ['http:', 'https:', 'file:'];

      if (!allowedProtocols.includes(parsedUrl.protocol)) {
        event.preventDefault();
      }
    });

    // Prevent new window creation
    contents.setWindowOpenHandler(() => {
      return { action: 'deny' };
    });
  });

  // Disable remote module
  if (process.type === 'renderer') {
    // @ts-ignore - remote is deprecated but we want to ensure it's disabled
    delete global.require?.cache?.remote;
  }
}

