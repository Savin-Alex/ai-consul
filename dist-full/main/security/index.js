"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.setupSecurity = setupSecurity;
const electron_1 = require("electron");
function setupSecurity() {
    // Set Content Security Policy
    electron_1.session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
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
    electron_1.app.on('web-contents-created', (_event, contents) => {
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
        const { require: nodeRequire } = global;
        if (nodeRequire?.cache && 'remote' in nodeRequire.cache) {
            delete nodeRequire.cache.remote;
        }
    }
}
