# Whisper.cpp Native Addon vs Child Process Analysis

## Current Implementation (Child Process)

**Status:** ✅ Working, tested, committed

**Approach:**
- Uses `whisper.cpp` binary via `spawn()`
- Converts Float32Array → WAV file → temp file
- Calls `whisper-cli` with language parameter
- Reads stdout for transcription

**Pros:**
- ✅ Simple, no native compilation needed
- ✅ Works across all platforms (macOS, Windows, Linux)
- ✅ Easy to debug (can run binary manually)
- ✅ No Node.js addon compilation issues
- ✅ Already implemented and tested
- ✅ Supports all whisper.cpp features (language, GPU, etc.)

**Cons:**
- ⚠️ File I/O overhead (WAV conversion + temp file)
- ⚠️ Process spawning overhead (~50-100ms)
- ⚠️ Memory overhead (separate process)
- ⚠️ Slightly higher latency

**Performance:**
- Latency: ~500-1000ms (including file I/O)
- Throughput: Good for real-time (1-2s chunks)

---

## Proposed Native Addon Approach

**Status:** ❓ Package `@fugood/whisper.node` doesn't exist

**Alternative Options:**

### Option 1: Use Existing Bindings

**Packages to investigate:**
- `whisper-node` - May exist but needs verification
- `@xenova/transformers` - Already have, but has issues
- Build custom addon using `node-addon-api`

### Option 2: Build Custom Native Addon

**Requirements:**
- C++ knowledge
- Node.js addon compilation
- Platform-specific builds (macOS, Windows, Linux)
- CI/CD for native builds

**Complexity:** High

---

## Performance Comparison

| Metric | Child Process | Native Addon (Estimated) |
|--------|---------------|--------------------------|
| Latency | 500-1000ms | 200-500ms (estimated) |
| Memory | ~200MB (process) | ~100MB (in-process) |
| CPU | Moderate | Lower (no IPC) |
| Setup Complexity | Low | High |
| Cross-platform | Easy | Complex |

---

## Recommendation

### Keep Current Approach + Optimize

**Why:**
1. ✅ Already working and tested
2. ✅ No native compilation needed
3. ✅ Easier maintenance
4. ✅ Better for Electron (native addons are tricky)

**Optimizations to Consider:**
1. **Reduce File I/O:**
   - Use named pipes (FIFO) instead of temp files
   - Or use stdin/stdout directly (if whisper-cli supports it)

2. **Keep Process Alive:**
   - Reuse whisper-cli process instead of spawning new one
   - Use persistent process with stdin/stdout

3. **Batch Processing:**
   - Buffer multiple chunks before transcribing
   - Reduce number of process calls

### If Native Addon is Required

**Steps:**
1. Research existing packages:
   ```bash
   npm search whisper node addon
   ```

2. Check whisper.cpp bindings:
   - Look for `whisper-node` or similar
   - Check whisper.cpp examples/addon.node

3. Build custom addon:
   - Use `node-addon-api`
   - Wrap whisper.cpp C API
   - Handle platform-specific builds

---

## Implementation Plan (If Proceeding with Native Addon)

### Phase 1: Research & Validation
- [ ] Verify if `@fugood/whisper.node` or similar exists
- [ ] Check whisper.cpp `examples/addon.node` directory
- [ ] Test existing bindings if found

### Phase 2: Prototype
- [ ] Create minimal native addon wrapper
- [ ] Test with simple audio buffer
- [ ] Benchmark vs child process

### Phase 3: Integration
- [ ] Replace child process with native addon
- [ ] Maintain backward compatibility
- [ ] Add fallback to child process if addon fails

### Phase 4: Optimization
- [ ] GPU acceleration
- [ ] Streaming support
- [ ] Memory optimization

---

## Alternative: Optimize Current Implementation

### Option A: Use stdin/stdout (if supported)
```typescript
// Instead of temp file, pipe audio directly
const proc = spawn('whisper-cli', ['-m', modelPath, '-f', '-'], {
  stdio: ['pipe', 'pipe', 'pipe']
});
proc.stdin.write(wavBuffer);
proc.stdin.end();
```

### Option B: Keep Process Alive
```typescript
// Reuse process for multiple transcriptions
class WhisperCppProcess {
  private proc: ChildProcess | null = null;
  
  async transcribe(audio: Float32Array): Promise<string> {
    if (!this.proc) {
      this.proc = spawn('whisper-cli', [...]);
      // Setup stdin/stdout handlers
    }
    // Send audio via stdin
    // Read from stdout
  }
}
```

### Option C: Use Named Pipes
```typescript
// Use FIFO instead of temp files (Unix only)
const fifo = '/tmp/whisper-fifo';
mkfifo(fifo, () => {
  // Write audio to fifo
  // Read transcription from stdout
});
```

---

## Conclusion

**For Now:** Keep child process approach, optimize if needed

**Future:** Consider native addon if:
- Performance becomes critical bottleneck
- We find a well-maintained package
- We have resources for custom addon development

**Priority:** Focus on features and stability over micro-optimizations

---

## References

- [whisper.cpp GitHub](https://github.com/ggml-org/whisper.cpp)
- [whisper.cpp Examples](https://github.com/ggml-org/whisper.cpp/tree/master/examples)
- [Node.js Addon API](https://nodejs.org/api/addons.html)
- [Current Implementation](../src/core/audio/whisper-cpp.ts)

