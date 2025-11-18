# Launch Commands for AI Consul

## Quick Start (Development Mode)

### Option 1: Launch Full App (Recommended)
```bash
pnpm run dev
```
This command runs both the Electron main process and the Vite renderer concurrently.

### Option 2: Launch Components Separately
```bash
# Terminal 1: Main process
pnpm run dev:main

# Terminal 2: Renderer (Vite dev server)
pnpm run dev:renderer
```

## Prerequisites

### 1. Install Dependencies
```bash
pnpm install
```

### 2. Build Before First Run (if needed)
```bash
pnpm run build:main
```

## Environment Variables (Optional)

Create a `.env` file in the root directory for cloud services:

```bash
# Cloud Transcription APIs (optional)
ASSEMBLYAI_API_KEY=your_key_here
DEEPGRAM_API_KEY=your_key_here

# LLM APIs (optional)
OPENAI_API_KEY=sk-...
ANTHROPIC_API_KEY=sk-ant-...
GOOGLE_API_KEY=...

# Streaming Configuration (optional)
ENABLE_STREAMING=true
STREAMING_WINDOW_SIZE=2.0
STREAMING_STEP_SIZE=1.0
STREAMING_OVERLAP_RATIO=0.5

# VAD Provider (optional)
VAD_PROVIDER=default  # or 'silero'

# Debug Audio (optional)
DEBUG_AUDIO=true
```

## Production Build & Launch

### Build for Production
```bash
# Standard build
pnpm run build

# Build variants
pnpm run build:local-only   # Local-only features
pnpm run build:balanced      # Balanced (cloud + local, no bundled models)
pnpm run build:full         # Full (cloud + local + bundled models)
```

### Launch Production Build
```bash
# After building
electron .

# Or build and package for macOS
pnpm run build:mac

# Or build and package for Windows
pnpm run build:win
```

## Troubleshooting

### If app doesn't start:
1. **Check dependencies**: `pnpm install`
2. **Rebuild main process**: `pnpm run build:main`
3. **Check for errors**: Look at terminal output

### If streaming doesn't work:
1. **Check environment variables**: Ensure `ENABLE_STREAMING=true` if using streaming mode
2. **Check API keys**: Cloud streaming requires `ASSEMBLYAI_API_KEY` or `DEEPGRAM_API_KEY`
3. **Check logs**: Look for `[session] Streaming mode initialized` in console

### If audio capture fails:
1. **Grant microphone permissions**: macOS System Preferences → Security & Privacy → Microphone
2. **Check browser console**: For renderer process errors
3. **Enable debug**: Set `DEBUG_AUDIO=true` in environment

## Common Commands Reference

```bash
# Development
pnpm run dev                    # Launch in dev mode
pnpm run dev:main              # Main process only
pnpm run dev:renderer          # Renderer only

# Building
pnpm run build                 # Full build
pnpm run build:main           # Build main process only
pnpm run build:renderer       # Build renderer only

# Testing
pnpm test                      # Run all tests
pnpm run test:ui              # Run tests with UI
pnpm run test:coverage        # Run tests with coverage

# Type Checking
pnpm run type-check            # TypeScript type checking
pnpm run lint                  # ESLint checking
```

## Notes

- The app runs on Electron, so it will open a desktop window
- Development mode includes hot-reload for the renderer (React/Vite)
- Main process changes require restart (Ctrl+C and run `pnpm run dev` again)
- Streaming mode is enabled by default if `ENABLE_STREAMING=true` is set
- Local-only mode works without any API keys

