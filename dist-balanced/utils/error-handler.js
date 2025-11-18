"use strict";
// Sentry integration - install @sentry/electron if needed
// import * as Sentry from '@sentry/electron/main';
Object.defineProperty(exports, "__esModule", { value: true });
exports.setupErrorHandling = setupErrorHandling;
exports.handleError = handleError;
exports.getUserFriendlyError = getUserFriendlyError;
function setupErrorHandling() {
    // Setup Sentry if DSN is provided
    const sentryDsn = process.env.SENTRY_DSN;
    // if (sentryDsn) {
    //   Sentry.init({
    //     dsn: sentryDsn,
    //     environment: process.env.NODE_ENV || 'development',
    //   });
    // }
    // Global error handlers
    process.on('uncaughtException', (error) => {
        console.error('Uncaught Exception:', error);
        // if (sentryDsn) {
        //   Sentry.captureException(error);
        // }
    });
    process.on('unhandledRejection', (reason, promise) => {
        console.error('Unhandled Rejection at:', promise, 'reason:', reason);
        // if (sentryDsn) {
        //   Sentry.captureException(reason as Error);
        // }
    });
}
function handleError(error, context) {
    console.error(`Error${context ? ` in ${context}` : ''}:`, error);
    // if (process.env.SENTRY_DSN) {
    //   Sentry.captureException(error, {
    //     tags: { context },
    //   });
    // }
}
function getUserFriendlyError(error) {
    const errorMessages = {
        'Ollama is not running': 'Ollama is not running. Please start Ollama and try again.',
        'Transcription failed': 'Audio transcription failed. Please check your microphone and try again.',
        'All LLM services failed': 'AI service is unavailable. Please check your internet connection and API keys.',
        'Session is already active': 'A session is already running. Please stop the current session first.',
    };
    for (const [key, message] of Object.entries(errorMessages)) {
        if (error.message.includes(key)) {
            return message;
        }
    }
    return 'An unexpected error occurred. Please try again.';
}
