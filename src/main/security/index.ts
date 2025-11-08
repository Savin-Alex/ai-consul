import { app, session } from 'electron';

export function setupSecurity(): void {
  // Set Content Security Policy
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': [
          "default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; font-src 'self' data:; media-src 'self' blob: data:; connect-src 'self' blob: https://api.openai.com https://api.anthropic.com https://generativelanguage.googleapis.com http://localhost:11434;",
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
  if ((process as NodeJS.Process & { type?: string }).type === 'renderer') {
    const { require: nodeRequire } = global as typeof global & { require?: NodeRequire };
    if (nodeRequire?.cache && 'remote' in nodeRequire.cache) {
      delete nodeRequire.cache.remote;
    }
  }
}

