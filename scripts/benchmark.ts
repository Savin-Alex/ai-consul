#!/usr/bin/env tsx
/**
 * Benchmark harness for measuring transcription latency and memory usage
 * across different engines and priority modes.
 */

import * as fs from 'fs';
import * as path from 'path';
import { performance } from 'perf_hooks';
import { AIConsulEngine, EngineConfig } from '../src/core/engine';
import { resolveTranscriptionConfig, TranscriptionMode } from '../src/core/config/transcription';

interface BenchmarkResult {
  mode: TranscriptionMode;
  engine: string;
  latencyMs: number;
  memoryMB: number;
  success: boolean;
  error?: string;
}

interface BenchmarkConfig {
  audioFile?: string;
  sampleRate?: number;
  iterations?: number;
  modes?: TranscriptionMode[];
}

const DEFAULT_CONFIG: Required<BenchmarkConfig> = {
  audioFile: path.join(__dirname, '../test-fixtures/sample-audio.wav'),
  sampleRate: 16000,
  iterations: 5,
  modes: ['local-only', 'local-first', 'balanced', 'cloud-first', 'cloud-only'],
};

function getMemoryUsageMB(): number {
  const usage = process.memoryUsage();
  return usage.heapUsed / (1024 * 1024);
}

function generateTestAudio(durationSeconds: number = 1.0, sampleRate: number = 16000): Float32Array {
  const samples = durationSeconds * sampleRate;
  const audio = new Float32Array(samples);
  
  // Generate a simple sine wave for testing
  const frequency = 440; // A4 note
  for (let i = 0; i < samples; i++) {
    audio[i] = Math.sin(2 * Math.PI * frequency * i / sampleRate) * 0.5;
  }
  
  return audio;
}

async function benchmarkEngine(
  engine: AIConsulEngine,
  audioChunk: Float32Array,
  sampleRate: number,
  mode: TranscriptionMode
): Promise<BenchmarkResult> {
  const config = resolveTranscriptionConfig({ mode });
  const startMemory = getMemoryUsageMB();
  const startTime = performance.now();
  
  try {
    await engine.initialize();
    const result = await engine.transcribe(audioChunk, sampleRate);
    
    const endTime = performance.now();
    const endMemory = getMemoryUsageMB();
    const latencyMs = endTime - startTime;
    const memoryMB = endMemory - startMemory;
    
    return {
      mode,
      engine: config.failoverOrder[0],
      latencyMs,
      memoryMB,
      success: true,
    };
  } catch (error) {
    const endTime = performance.now();
    return {
      mode,
      engine: config.failoverOrder[0],
      latencyMs: endTime - startTime,
      memoryMB: getMemoryUsageMB() - startMemory,
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

async function runBenchmark(config: BenchmarkConfig = {}): Promise<void> {
  const finalConfig = { ...DEFAULT_CONFIG, ...config };
  const results: BenchmarkResult[] = [];
  
  // Generate test audio if file doesn't exist
  let audioChunk: Float32Array;
  if (fs.existsSync(finalConfig.audioFile)) {
    // TODO: Load actual WAV file
    audioChunk = generateTestAudio(1.0, finalConfig.sampleRate);
  } else {
    audioChunk = generateTestAudio(1.0, finalConfig.sampleRate);
  }
  
  console.log('🚀 Starting transcription benchmarks...\n');
  console.log(`Configuration:`);
  console.log(`  Audio duration: ${(audioChunk.length / finalConfig.sampleRate).toFixed(2)}s`);
  console.log(`  Sample rate: ${finalConfig.sampleRate}Hz`);
  console.log(`  Iterations: ${finalConfig.iterations}`);
  console.log(`  Modes: ${finalConfig.modes.join(', ')}\n`);
  
  for (const mode of finalConfig.modes) {
    console.log(`📊 Benchmarking ${mode} mode...`);
    
    const engineConfig: EngineConfig = {
      privacy: {
        offlineFirst: mode === 'local-only' || mode === 'local-first',
        cloudFallback: mode !== 'local-only' && mode !== 'cloud-only',
        dataRetention: 7,
      },
      performance: {
        hardwareTier: 'auto-detect',
        latencyTarget: 5000,
        qualityPreference: 'balanced',
      },
      models: {
        transcription: {
          primary: mode.startsWith('local') ? 'local-whisper-base' : 'cloud-whisper',
          fallback: 'cloud-whisper',
        },
        llm: {
          primary: 'ollama://llama3:8b',
          fallbacks: [],
        },
      },
    };
    
    const modeResults: BenchmarkResult[] = [];
    
    for (let i = 0; i < finalConfig.iterations; i++) {
      const engine = new AIConsulEngine(engineConfig);
      const result = await benchmarkEngine(engine, audioChunk, finalConfig.sampleRate, mode);
      modeResults.push(result);
      
      // Cleanup
      engine.stopSession();
      
      // Small delay between iterations
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    
    // Calculate averages
    const successful = modeResults.filter(r => r.success);
    if (successful.length > 0) {
      const avgLatency = successful.reduce((sum, r) => sum + r.latencyMs, 0) / successful.length;
      const avgMemory = successful.reduce((sum, r) => sum + r.memoryMB, 0) / successful.length;
      
      console.log(`  ✅ Average latency: ${avgLatency.toFixed(2)}ms`);
      console.log(`  ✅ Average memory delta: ${avgMemory.toFixed(2)}MB`);
      console.log(`  ✅ Success rate: ${successful.length}/${finalConfig.iterations}\n`);
      
      results.push({
        mode,
        engine: successful[0].engine,
        latencyMs: avgLatency,
        memoryMB: avgMemory,
        success: true,
      });
    } else {
      console.log(`  ❌ All iterations failed\n`);
      results.push({
        mode,
        engine: 'unknown',
        latencyMs: 0,
        memoryMB: 0,
        success: false,
        error: 'All iterations failed',
      });
    }
  }
  
  // Print summary
  console.log('📈 Benchmark Summary\n');
  console.log('Mode              | Engine          | Latency (ms) | Memory (MB) | Status');
  console.log('------------------|-----------------|--------------|-------------|--------');
  
  for (const result of results) {
    const mode = result.mode.padEnd(17);
    const engine = result.engine.padEnd(15);
    const latency = result.latencyMs.toFixed(2).padStart(12);
    const memory = result.memoryMB.toFixed(2).padStart(11);
    const status = result.success ? '✅' : '❌';
    
    console.log(`${mode} | ${engine} | ${latency} | ${memory} | ${status}`);
  }
  
  // Save results to file
  const resultsFile = path.join(__dirname, '../benchmark-results.json');
  fs.writeFileSync(resultsFile, JSON.stringify(results, null, 2));
  console.log(`\n💾 Results saved to ${resultsFile}`);
}

// CLI interface
if (require.main === module) {
  const args = process.argv.slice(2);
  const config: BenchmarkConfig = {};
  
  for (let i = 0; i < args.length; i += 2) {
    const key = args[i]?.replace('--', '');
    const value = args[i + 1];
    
    switch (key) {
      case 'audio-file':
        config.audioFile = value;
        break;
      case 'sample-rate':
        config.sampleRate = parseInt(value, 10);
        break;
      case 'iterations':
        config.iterations = parseInt(value, 10);
        break;
      case 'modes':
        config.modes = value.split(',') as TranscriptionMode[];
        break;
    }
  }
  
  runBenchmark(config).catch(console.error);
}

export { runBenchmark, BenchmarkResult, BenchmarkConfig };



