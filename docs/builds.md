# Build & Packaging Notes

## Native Dependencies

- `onnxruntime-node` and other native modules must remain unpacked in the ASAR to avoid runtime loading failures. See `electron-builder.yml` (`asarUnpack`) for the maintained list.
- Always run `pnpm run validate:deps` after adding a native dependency; it flags packages that exceed size budgets or require special handling.
- Current size budgets:
  - `onnxruntime-node`: < 300MB
  - Local-first dependencies total: < 300MB

## Dynamic Dependency Loading

- Local-first audio engines should import heavy modules only when needed (e.g., `await import('onnxruntime-node')` in the local Whisper/VAD initializers).
- Cloud engines (`assemblyai`, `@deepgram/sdk`, `ws`) should be lazy-loaded and skipped entirely when `process.env.INCLUDE_CLOUD === 'false'`.
- The `DynamicDependencyLoader` class in `src/core/audio/dynamic-loader.ts` provides centralized lazy loading for all transcription dependencies.

## Build Variants

| Variant      | Env Flags                            | Description                                    |
|--------------|--------------------------------------|------------------------------------------------|
| `local-only` | `INCLUDE_CLOUD=false BUNDLE_MODELS=true` | Ships bundled models, no cloud dependencies.   |
| `balanced`   | `INCLUDE_CLOUD=true BUNDLE_MODELS=false` | Prefers local but downloads models on demand. |
| `full`       | `INCLUDE_CLOUD=true BUNDLE_MODELS=true`  | Includes local models and cloud fallbacks.    |

### Building Variants

```bash
# Build all variants
pnpm run build:variants

# Build specific variant
pnpm run build:local-only
pnpm run build:balanced
pnpm run build:full
```

## Transcription Priority Modes

The application supports multiple transcription priority modes configured via `TRANSCRIPTION_MODE` environment variable or programmatically:

- **`local-only`**: Only uses local transcription engines (Whisper, ONNX). No cloud fallback.
- **`local-first`**: Prioritizes local engines but allows cloud fallback if local fails.
- **`balanced`**: Mixes local and cloud engines for optimal performance.
- **`cloud-first`**: Prioritizes cloud engines but allows local fallback.
- **`cloud-only`**: Only uses cloud transcription engines. No local processing.

### Configuration

Priority modes are configured via `src/core/config/transcription.ts`:

```typescript
import { resolveTranscriptionConfig } from './core/config/transcription';

const config = resolveTranscriptionConfig({ 
  mode: 'local-first',
  localTimeoutMs: 2000,
  cloudTimeoutMs: 750,
  privacyMode: false
});
```

Environment variables:
- `TRANSCRIPTION_MODE`: One of the modes above
- `TRANSCRIPTION_PRIVACY_MODE`: `true`/`false` (disables cloud when true)
- `TRANSCRIPTION_LOCAL_TIMEOUT_MS`: Timeout for local engines (default: 2000ms)
- `TRANSCRIPTION_CLOUD_TIMEOUT_MS`: Timeout for cloud engines (default: 750ms)

## Validation Workflow

1. `pnpm run analyze:deps -- --summary` – inventory dependency sizes (JSON if no `--summary`).
2. `pnpm run validate:deps` – enforce size budgets and builder rules.
3. `pnpm run analyze:bundle` – produce Vite/Electron bundle report.
4. `pnpm run test:packaging` – build & package, then verify artifact sizes via `scripts/check-package-size.js`.
5. `pnpm run test` – run all unit and integration tests including dependency budget tests.

## Benchmarking

### Latency & Memory Benchmarks

Run benchmarks to measure transcription performance across different modes:

```bash
# Benchmark all modes
pnpm run benchmark

# Benchmark only local modes
pnpm run benchmark:local

# Custom benchmark configuration
tsx scripts/benchmark.ts --modes local-only,balanced --iterations 10
```

Results are saved to `benchmark-results.json` with:
- Average latency per mode
- Memory usage delta
- Success rates

### Word Error Rate (WER) Validation

Validate transcription accuracy using WER metrics:

```bash
pnpm run validate:wer
```

The script compares transcribed text against reference transcripts and calculates:
- Word Error Rate (WER)
- Substitutions, deletions, insertions
- Per-test-case and aggregate statistics

Results are saved to `wer-results.json`.

## Testing

### Unit Tests

```bash
# Run all tests
pnpm run test

# Run specific test suites
pnpm vitest run tests/deps/dependency-limits.test.ts
pnpm vitest run tests/integration/priority-modes.test.ts
pnpm vitest run tests/resilience/network-memory.test.ts
```

### Test Coverage

- **Dependency Budget Tests**: Enforce size limits for native dependencies
- **Priority Mode Integration Tests**: Verify transcription priority modes work correctly
- **Resilience Tests**: Test network failures, memory pressure, concurrent requests

## Performance Considerations

- **Lazy Loading**: Heavy dependencies are only loaded when needed, reducing initial bundle size
- **Dynamic Imports**: Cloud dependencies are conditionally imported based on build variant
- **Memory Management**: Large audio chunks are processed in batches to prevent memory leaks
- **Error Handling**: Graceful fallback between engines when one fails

## Troubleshooting

### Build Issues

- If native modules fail to load, ensure they're listed in `electron-builder.yml` `asarUnpack`
- Run `pnpm run validate:deps` to check for size budget violations
- Check `electron-builder.yml` for correct file exclusion patterns

### Runtime Issues

- Verify transcription mode configuration matches your use case
- Check environment variables are set correctly
- Review benchmark results to identify performance bottlenecks
- Use WER validation to diagnose transcription accuracy issues


