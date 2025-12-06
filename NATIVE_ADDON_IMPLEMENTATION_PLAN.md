# Native Addon Implementation Plan

## Available Options

### Option 1: whisper.cpp Official Addon (`examples/addon.node`)

**Status:** ✅ Exists in our repo, needs compilation

**Pros:**
- Official whisper.cpp addon
- Supports VAD (Voice Activity Detection)
- GPU acceleration support
- Well-maintained

**Cons:**
- Requires compilation with `cmake-js`
- File-based input (`fname_inp`) - not direct buffer
- Need to build for Electron (different Node.js version)

**Usage:**
```javascript
const { whisper } = require('../../build/Release/addon.node');
const whisperAsync = promisify(whisper);

const result = await whisperAsync({
  language: "en",
  model: "models/ggml-base.en.bin",
  fname_inp: "audio.wav",  // File path, not buffer
  use_gpu: true
});
```

### Option 2: whisper-node Package

**Status:** ✅ Available on npm

**Pros:**
- Easy installation (`npm install whisper-node`)
- Pre-compiled (maybe)
- Simple API

**Cons:**
- Also file-based input
- Less control over internals
- May not support direct buffer input

**Usage:**
```javascript
import whisper from 'whisper-node';
const transcript = await whisper("example/sample.wav");
```

### Option 3: Custom Native Addon (Your Proposal)

**Status:** ❓ Need to build from scratch

**Pros:**
- Direct buffer input (Float32Array/Int16Array)
- No file I/O overhead
- Full control
- Optimized for real-time

**Cons:**
- Requires C++ development
- Need to maintain native code
- Platform-specific builds
- Electron compatibility issues

---

## Key Issue: File vs Buffer Input

**Current Problem:**
- Both existing addons use **file input** (`fname_inp`)
- Your proposal needs **direct buffer input** (Float32Array)
- This is the main advantage of native addon approach

**Solution Options:**

### A. Modify Existing Addon
- Fork `whisper.cpp/examples/addon.node`
- Add buffer input support
- Compile for Electron

### B. Build Custom Addon
- Use `node-addon-api`
- Wrap whisper.cpp C API
- Support direct buffer input

### C. Hybrid Approach
- Use addon for transcription
- Keep file I/O but optimize (named pipes, memory-mapped files)

---

## Recommended Implementation Strategy

### Phase 1: Evaluate Existing Addon (1-2 days)

1. **Test whisper.cpp addon:**
   ```bash
   cd whisper.cpp/examples/addon.node
   npm install
   npx cmake-js compile -T addon.node -B Release
   ```

2. **Check if we can modify for buffer input:**
   - Review `addon.cpp` source
   - See if whisper.cpp C API supports buffer input
   - Estimate modification effort

3. **Benchmark vs current approach:**
   - Test latency
   - Test memory usage
   - Test CPU usage

### Phase 2: Decision Point

**If addon can be modified easily:**
- Proceed with modified addon
- Add buffer input support
- Integrate with existing code

**If addon modification is complex:**
- Keep current child process approach
- Optimize with named pipes or stdin/stdout
- Consider custom addon later if needed

### Phase 3: Integration (if proceeding)

1. **Create wrapper:**
   ```typescript
   // src/core/audio/whisper-native.ts
   export class WhisperNative {
     async transcribe(audio: Float32Array): Promise<string> {
       // Convert to WAV buffer
       // Call native addon
       // Return text
     }
   }
   ```

2. **Update engine.ts:**
   - Add `WhisperNative` option
   - Fallback to child process if addon fails

3. **Test thoroughly:**
   - All platforms (macOS, Windows, Linux)
   - Electron compatibility
   - Performance benchmarks

---

## Implementation Details (If Building Custom Addon)

### Required Changes to Your Proposal

1. **Package Name:**
   - `@fugood/whisper.node` doesn't exist
   - Use `whisper.cpp/examples/addon.node` as base
   - Or build custom addon

2. **Buffer Input:**
   - whisper.cpp C API uses `whisper_full()` with audio buffer
   - Need to expose this in addon
   - Handle Float32Array → int16 conversion

3. **Model Loading:**
   - Keep model in memory (not reload each time)
   - Support model switching
   - Handle initialization errors

4. **VAD Integration:**
   - whisper.cpp addon already supports VAD
   - Can use Silero VAD model
   - Or use built-in VAD

### Code Structure

```typescript
// src/core/audio/whisper-native.ts
import { whisper } from '../../build/Release/addon.node';

export class WhisperNative {
  private context: any = null;
  
  async initialize(modelPath: string): Promise<void> {
    // Load model (keep in memory)
    this.context = await loadModel(modelPath);
  }
  
  async transcribe(audio: Float32Array): Promise<string> {
    // Convert Float32Array to int16
    const int16 = this.float32ToInt16(audio);
    
    // Call native addon with buffer
    const result = await whisper({
      context: this.context,
      audio: int16.buffer,
      sampleRate: 16000,
      language: 'en'
    });
    
    return result.text;
  }
}
```

---

## Comparison Table

| Feature | Child Process | Official Addon | Custom Addon |
|---------|--------------|---------------|--------------|
| **Setup** | ✅ Easy | ⚠️ Compile needed | ❌ Complex |
| **Buffer Input** | ❌ File only | ❌ File only | ✅ Direct |
| **Latency** | ~500-1000ms | ~200-500ms | ~100-300ms |
| **Memory** | ~200MB | ~100MB | ~100MB |
| **GPU Support** | ✅ Yes | ✅ Yes | ✅ Yes |
| **VAD Support** | ❌ Separate | ✅ Built-in | ✅ Built-in |
| **Maintenance** | ✅ Low | ⚠️ Medium | ❌ High |
| **Cross-platform** | ✅ Easy | ⚠️ Complex | ❌ Very Complex |

---

## Final Recommendation

### Short Term (Now):
**Keep current child process approach** - it works, is tested, and is maintainable.

### Medium Term (1-2 weeks):
**Test whisper.cpp official addon:**
1. Compile `examples/addon.node`
2. Test with file input
3. Benchmark performance
4. If significantly faster, integrate as option

### Long Term (If needed):
**Build custom addon** only if:
- Performance becomes critical bottleneck
- We need direct buffer input
- We have resources for C++ development
- We can maintain cross-platform builds

---

## Next Steps

1. **Immediate:** Test whisper.cpp addon compilation
2. **This week:** Benchmark addon vs child process
3. **Decision:** Choose approach based on results
4. **Implementation:** Integrate chosen approach

---

## References

- [whisper.cpp addon.node example](../whisper.cpp/examples/addon.node)
- [whisper-node npm package](https://www.npmjs.com/package/whisper-node)
- [Current implementation](../src/core/audio/whisper-cpp.ts)
- [Node.js Addon API](https://nodejs.org/api/addons.html)

