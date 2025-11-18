# Troubleshooting Guide

## Current Status

Your app is running successfully on the `stream-upgrade` branch! Here's what's working and what needs attention:

### ✅ Working Features

1. **Audio Capture**: Successfully capturing audio from microphone
2. **Voice Activity Detection (VAD)**: Detecting speech and pauses correctly
3. **Whisper Transcription**: Successfully transcribing speech:
   - " Oh, let's start."
   - " In the tent."
   - " The application."
   - " My name is Alex Alexander under"
   - " Once yours."

### ⚠️ Issues Found

#### 1. LLM Services Failing

**Error**: `Error: All LLM services failed. Please check your configuration and connection.`

**Cause**: 
- Your app is configured to use Ollama (local LLM) as the primary LLM
- Ollama is not running or not accessible at `http://localhost:11434`
- Cloud fallback is disabled (`cloudFallback: false`)

**Solutions**:

**Option A: Start Ollama (Recommended for Privacy)**
```bash
# Install Ollama if not installed
# macOS: brew install ollama
# Or download from https://ollama.ai

# Start Ollama service
ollama serve

# In another terminal, pull a model
ollama pull llama3:8b

# Verify it's running
curl http://localhost:11434/api/tags
```

**Option B: Enable Cloud Fallback**
If you want to use cloud LLMs when Ollama isn't available, you need to:
1. Set environment variables for API keys:
   ```bash
   export OPENAI_API_KEY=sk-...
   # OR
   export ANTHROPIC_API_KEY=sk-ant-...
   ```

2. Update the engine configuration in `src/main/main.ts` to enable cloud fallback:
   ```typescript
   privacy: {
     offlineFirst: true,
     cloudFallback: true,  // Change this to true
     dataRetention: 7,
   },
   ```

#### 2. AudioWorklet Failing

**Error**: `DOMException: The user aborted a request.`

**Status**: This is **not critical** - the app automatically falls back to ScriptProcessorNode, which works fine.

**Cause**: The AudioWorklet processor file might not be loading correctly in Electron's renderer process.

**Note**: The fallback works, but ScriptProcessorNode is deprecated. For production, you may want to:
1. Ensure the worklet file is properly bundled
2. Check that the path resolution works in production builds
3. Consider using a different approach for Electron (like native modules)

**Current Workaround**: The app automatically uses ScriptProcessorNode when AudioWorklet fails, so this doesn't block functionality.

## Quick Fixes

### To Fix LLM Issues Right Now:

1. **Check if Ollama is running**:
   ```bash
   curl http://localhost:11434/api/tags
   ```

2. **If Ollama is not running**, start it:
   ```bash
   ollama serve
   ```

3. **If you don't have Ollama installed**:
   - Install from https://ollama.ai
   - Or enable cloud fallback (see Option B above)

### To Verify Everything Works:

1. **Start Ollama** (if using local LLM)
2. **Restart the app**: `pnpm run dev`
3. **Start a session** and speak
4. **Check console** - you should see successful LLM responses instead of errors

## Configuration Summary

Your current configuration:
- **Branch**: `stream-upgrade` ✅
- **Transcription Mode**: `batch` (streaming not enabled via env var)
- **Privacy Mode**: `local-first` with `cloudFallback: false`
- **Primary LLM**: `ollama://llama3:8b` (requires Ollama running)
- **VAD Provider**: `default` (WebRTC-based)

## Next Steps

1. **For immediate use**: Start Ollama and pull a model
2. **For production**: Consider enabling cloud fallback as a safety net
3. **For streaming**: Set `ENABLE_STREAMING=true` in your environment to test streaming features

## Testing Streaming Features

To test the new streaming features you just implemented:

```bash
# Set environment variable
export ENABLE_STREAMING=true

# Optional: Configure streaming parameters
export STREAMING_WINDOW_SIZE=2.0
export STREAMING_STEP_SIZE=1.0
export STREAMING_OVERLAP_RATIO=0.5

# Restart the app
pnpm run dev
```

This will enable:
- Continuous streaming transcription
- Lower latency
- Real-time interim results

