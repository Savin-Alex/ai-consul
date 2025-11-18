# Transcription Debug Guide

## Issue
Audio chunks are being received but all have `maxAmplitude: 0` and `avgAmplitude: 0`, indicating no audio is being captured.

## Potential Causes

### 1. AudioContext Suspended (Most Likely)
Modern browsers require user interaction before AudioContext can start. The AudioContext might be in `suspended` state.

**Fix Applied**: Added automatic resume of AudioContext if suspended.

### 2. Microphone Permissions
The browser might not have microphone permissions granted.

**Check**: Look in browser console for permission errors.

**Fix**: Grant microphone permissions in:
- macOS: System Preferences → Security & Privacy → Microphone → Electron
- Or check the browser permission prompt

### 3. Microphone Not Selected/Active
The selected microphone might not be active or might be muted.

**Check**: The new debug logs will show:
- Audio track information
- Whether tracks are enabled/muted
- Track readyState

### 4. ScriptProcessorNode Not Processing
The fallback ScriptProcessorNode might not be receiving audio.

**Check**: Look for `[audio-capture] ScriptProcessorNode processing audio` logs in console.

## Debug Steps

1. **Restart the app** with the new debug logging:
   ```bash
   pnpm run dev
   ```

2. **Check the renderer console** (DevTools) for:
   - `[audio-capture] AudioContext created:` - Should show state: 'running'
   - `[audio-capture] MediaStream audio tracks:` - Should show enabled tracks
   - `[audio-capture] ScriptProcessorNode processing audio:` - Should show non-zero amplitudes

3. **Check microphone permissions**:
   - Look for permission prompts
   - Check macOS System Preferences → Security & Privacy → Microphone

4. **Test with actual speech**:
   - Speak into the microphone
   - Check if `maxAmplitude` values increase in the logs

## Expected Logs

When working correctly, you should see:
```
[audio-capture] AudioContext created: { sampleRate: 16000, state: 'running', ... }
[audio-capture] MediaStream audio tracks: { count: 1, tracks: [{ enabled: true, muted: false, ... }] }
[audio-capture] ScriptProcessorNode connected to audio graph
[audio-capture] ScriptProcessorNode processing audio: { maxAmplitude: 0.123, avgAmplitude: 0.045, ... }
```

## If Still Not Working

1. **Check renderer console** for errors
2. **Verify microphone works** in other apps
3. **Try selecting a different microphone** in settings
4. **Check if AudioWorklet is being used** (it might be failing silently)

## Next Steps

After restarting, check the console logs and share:
- AudioContext state
- MediaStream track information  
- Any errors in renderer console
- Whether ScriptProcessorNode logs show non-zero amplitudes

