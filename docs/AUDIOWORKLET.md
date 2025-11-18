# AudioWorklet Implementation Guide

## Why Both TypeScript and JavaScript Files Exist

The AudioWorklet processor requires special handling in Electron:

1. **AudioWorklet API Limitation**: The `audioWorklet.addModule()` API requires a URL to a JavaScript file. It cannot directly load TypeScript files.

2. **Electron Path Resolution**: AudioWorklet modules run in a separate audio rendering thread and must be accessible via HTTP/HTTPS or `file://` protocol. In Electron, this means the file must be in the built output directory.

3. **Current Implementation**: 
   - **Source of Truth**: `src/core/audio/audio-worklet-processor.ts` - TypeScript source with full type safety
   - **Runtime File**: `src/core/audio/audio-worklet-processor.js` - JavaScript file that gets loaded at runtime

## Current Status

The JavaScript file is manually maintained and must be kept in sync with the TypeScript source. This is a temporary solution until we implement proper build pipeline integration.

## Future Improvement: Automated Build

The ideal solution is to configure the build pipeline to automatically compile the TypeScript worklet file to JavaScript:

### Option 1: Vite Plugin (Recommended for Renderer)

Since the renderer uses Vite, we can create a Vite plugin that:
1. Compiles `audio-worklet-processor.ts` to JavaScript
2. Copies it to the dist folder with the correct path
3. Ensures it's accessible via the renderer's URL scheme

### Option 2: TypeScript Compiler (For Main Process)

If the worklet is used in the main process, configure `tsconfig.main.json` to:
1. Include the worklet file
2. Output it to the correct location in `dist/`
3. Ensure proper module format

### Option 3: Separate Build Step

Create a dedicated build script that:
1. Compiles the TypeScript worklet file
2. Copies it to both renderer and main dist folders
3. Runs as part of the build process

## Usage

The AudioWorklet processor is loaded in `src/core/audio/capture.ts` (main process) and `src/renderer/utils/audio-capture.ts` (renderer process).

Path resolution:
- **Development**: `/src/core/audio/audio-worklet-processor.js` (via Vite dev server)
- **Production**: `/dist/core/audio/audio-worklet-processor.js` (from built files)

## Migration Path

1. ✅ Keep TypeScript source as single source of truth
2. ✅ Document why JS file exists
3. ⏳ Configure build pipeline to auto-generate JS from TS
4. ⏳ Remove manual JS file once automation is working
5. ⏳ Add tests to ensure TS and JS stay in sync

## Type Safety Benefits

Even though the runtime file is JavaScript, maintaining TypeScript source provides:
- Compile-time type checking
- Better IDE support and autocomplete
- Self-documenting code with types
- Safer refactoring



