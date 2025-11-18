# AudioWorklet Fix

## Problem
AudioWorklet was failing to load with error: `DOMException: The user aborted a request.`

## Root Cause
The AudioWorklet processor file (`audio-worklet-processor.js`) was located in `src/core/audio/`, but Vite's dev server (which serves from `src/renderer` as root) couldn't access it.

## Solution

### 1. Copy Worklet File to Public Directory
The worklet file has been copied to `src/renderer/public/core/audio/audio-worklet-processor.js` so Vite can serve it.

### 2. Updated Path Resolution
The path resolution in `src/renderer/utils/audio-capture.ts` now uses `/core/audio/audio-worklet-processor.js` which Vite serves from the public directory.

### 3. Vite Plugin for Auto-Copy
Added a Vite plugin that automatically copies the worklet file during build/start, ensuring it's always in sync.

## Files Changed

1. **`src/renderer/utils/audio-capture.ts`**
   - Updated path resolution to use `/core/audio/audio-worklet-processor.js`
   - Added better error handling and logging
   - Added file verification before loading

2. **`vite.config.ts`**
   - Added `publicDir: 'public'` configuration
   - Added custom plugin to copy worklet file automatically
   - Ensured `copyPublicDir: true` in build config

3. **`src/renderer/public/core/audio/audio-worklet-processor.js`**
   - Copied from `src/core/audio/audio-worklet-processor.js`
   - This file is served by Vite at `/core/audio/audio-worklet-processor.js`

## Testing

1. **Restart the dev server**:
   ```bash
   pnpm run dev
   ```

2. **Check console logs** - you should see:
   ```
   [audio-capture] Loading AudioWorklet from: http://localhost:5173/core/audio/audio-worklet-processor.js
   [audio-capture] AudioWorklet file verified, loading module...
   [audio-capture] AudioWorklet module loaded successfully
   [audio-capture] AudioWorkletNode created successfully
   [audio-capture] AudioWorklet processor ready
   ```

3. **If it still fails**, check:
   - Browser console for the actual error
   - Network tab to see if the file is being requested
   - Verify the file exists at `src/renderer/public/core/audio/audio-worklet-processor.js`

## Production Build

The worklet file will be automatically copied to `dist/renderer/core/audio/` during the build process, so production builds should work correctly.

## Alternative: If Still Having Issues

If AudioWorklet still doesn't work, the app will automatically fall back to `ScriptProcessorNode`, which works but is deprecated. The fallback is already implemented and working.

