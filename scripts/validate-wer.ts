#!/usr/bin/env tsx
/**
 * Word Error Rate (WER) validation script for transcription accuracy testing.
 * 
 * WER = (S + D + I) / N
 * Where:
 *   S = number of substitutions
 *   D = number of deletions
 *   I = number of insertions
 *   N = number of words in reference
 */

import * as fs from 'fs';
import * as path from 'path';
import { AIConsulEngine, EngineConfig } from '../src/core/engine';

interface TestCase {
  audioFile: string;
  reference: string;
  description?: string;
}

interface WERResult {
  testCase: string;
  reference: string;
  hypothesis: string;
  wer: number;
  substitutions: number;
  deletions: number;
  insertions: number;
  referenceWords: number;
  success: boolean;
  error?: string;
}

function normalizeText(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\w\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function tokenize(text: string): string[] {
  return normalizeText(text).split(/\s+/).filter(word => word.length > 0);
}

function levenshteinDistance(ref: string[], hyp: string[]): {
  distance: number;
  substitutions: number;
  deletions: number;
  insertions: number;
} {
  const m = ref.length;
  const n = hyp.length;
  
  // Create distance matrix
  const dp: number[][] = Array(m + 1)
    .fill(null)
    .map(() => Array(n + 1).fill(0));
  
  // Initialize base cases
  for (let i = 0; i <= m; i++) {
    dp[i][0] = i; // deletions
  }
  for (let j = 0; j <= n; j++) {
    dp[0][j] = j; // insertions
  }
  
  // Fill the matrix
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (ref[i - 1] === hyp[j - 1]) {
        dp[i][j] = dp[i - 1][j - 1]; // match
      } else {
        dp[i][j] = Math.min(
          dp[i - 1][j] + 1,     // deletion
          dp[i][j - 1] + 1,     // insertion
          dp[i - 1][j - 1] + 1 // substitution
        );
      }
    }
  }
  
  // Trace back to count operations
  let i = m;
  let j = n;
  let substitutions = 0;
  let deletions = 0;
  let insertions = 0;
  
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && ref[i - 1] === hyp[j - 1]) {
      i--;
      j--;
    } else if (i > 0 && j > 0 && dp[i][j] === dp[i - 1][j - 1] + 1) {
      substitutions++;
      i--;
      j--;
    } else if (i > 0 && dp[i][j] === dp[i - 1][j] + 1) {
      deletions++;
      i--;
    } else {
      insertions++;
      j--;
    }
  }
  
  return {
    distance: dp[m][n],
    substitutions,
    deletions,
    insertions,
  };
}

function calculateWER(reference: string, hypothesis: string): {
  wer: number;
  substitutions: number;
  deletions: number;
  insertions: number;
  referenceWords: number;
} {
  const refTokens = tokenize(reference);
  const hypTokens = tokenize(hypothesis);
  
  if (refTokens.length === 0) {
    return {
      wer: hypTokens.length > 0 ? 1 : 0,
      substitutions: 0,
      deletions: 0,
      insertions: hypTokens.length,
      referenceWords: 0,
    };
  }
  
  const { substitutions, deletions, insertions } = levenshteinDistance(refTokens, hypTokens);
  const totalErrors = substitutions + deletions + insertions;
  const wer = totalErrors / refTokens.length;
  
  return {
    wer,
    substitutions,
    deletions,
    insertions,
    referenceWords: refTokens.length,
  };
}

async function validateWER(
  engine: AIConsulEngine,
  testCase: TestCase,
  audioChunk?: Float32Array
): Promise<WERResult> {
  try {
    await engine.initialize();
    
    // If no audio chunk provided, generate a simple test audio
    const testAudio = audioChunk || new Float32Array(16000); // 1 second of silence
    
    const hypothesis = await engine.transcribe(testAudio, 16000);
    const result = calculateWER(testCase.reference, hypothesis);
    
    return {
      testCase: testCase.description || testCase.audioFile,
      reference: testCase.reference,
      hypothesis,
      ...result,
      success: true,
    };
  } catch (error) {
    return {
      testCase: testCase.description || testCase.audioFile,
      reference: testCase.reference,
      hypothesis: '',
      wer: 1.0,
      substitutions: 0,
      deletions: 0,
      insertions: 0,
      referenceWords: tokenize(testCase.reference).length,
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

async function runWERValidation(
  testCases: TestCase[],
  engineConfig: EngineConfig
): Promise<void> {
  console.log('🔍 Starting WER Validation...\n');
  console.log(`Test cases: ${testCases.length}`);
  console.log(`Engine: ${engineConfig.models.transcription.primary}\n`);
  
  const engine = new AIConsulEngine(engineConfig);
  const results: WERResult[] = [];
  
  for (const testCase of testCases) {
    console.log(`📝 Testing: ${testCase.description || testCase.audioFile}`);
    
    // Load audio file if it exists
    let audioChunk: Float32Array | undefined;
    if (fs.existsSync(testCase.audioFile)) {
      // TODO: Implement WAV file loading
      audioChunk = undefined; // Placeholder
    }
    
    const result = await validateWER(engine, testCase, audioChunk);
    results.push(result);
    
    if (result.success) {
      console.log(`  ✅ WER: ${(result.wer * 100).toFixed(2)}%`);
      console.log(`     Substitutions: ${result.substitutions}, Deletions: ${result.deletions}, Insertions: ${result.insertions}`);
    } else {
      console.log(`  ❌ Failed: ${result.error}\n`);
    }
  }
  
  // Calculate average WER
  const successful = results.filter(r => r.success);
  if (successful.length > 0) {
    const avgWER = successful.reduce((sum, r) => sum + r.wer, 0) / successful.length;
    const totalWords = successful.reduce((sum, r) => sum + r.referenceWords, 0);
    const totalErrors = successful.reduce((sum, r) => sum + r.substitutions + r.deletions + r.insertions, 0);
    
    console.log('\n📊 Summary');
    console.log('─'.repeat(60));
    console.log(`Average WER: ${(avgWER * 100).toFixed(2)}%`);
    console.log(`Total reference words: ${totalWords}`);
    console.log(`Total errors: ${totalErrors}`);
    console.log(`Success rate: ${successful.length}/${results.length}`);
    
    // Print detailed results table
    console.log('\n📋 Detailed Results');
    console.log('─'.repeat(60));
    console.log('Test Case'.padEnd(30) + 'WER'.padStart(10) + 'Errors'.padStart(10) + 'Status'.padStart(10));
    console.log('─'.repeat(60));
    
    for (const result of results) {
      const testCase = result.testCase.substring(0, 28).padEnd(30);
      const wer = result.success ? `${(result.wer * 100).toFixed(2)}%` : 'N/A';
      const errors = result.success 
        ? `${result.substitutions + result.deletions + result.insertions}` 
        : 'N/A';
      const status = result.success ? '✅' : '❌';
      
      console.log(`${testCase}${wer.padStart(10)}${errors.padStart(10)}${status.padStart(10)}`);
    }
  }
  
  // Save results to file
  const resultsFile = path.join(__dirname, '../wer-results.json');
  fs.writeFileSync(resultsFile, JSON.stringify(results, null, 2));
  console.log(`\n💾 Results saved to ${resultsFile}`);
}

// CLI interface
if (require.main === module) {
  // Example test cases - in real usage, these would be loaded from a file
  const testCases: TestCase[] = [
    {
      audioFile: 'test-fixtures/sample1.wav',
      reference: 'Hello, this is a test transcription',
      description: 'Basic greeting',
    },
    {
      audioFile: 'test-fixtures/sample2.wav',
      reference: 'The quick brown fox jumps over the lazy dog',
      description: 'Pangram test',
    },
  ];
  
  const engineConfig: EngineConfig = {
    privacy: {
      offlineFirst: true,
      cloudFallback: false,
      dataRetention: 7,
    },
    performance: {
      hardwareTier: 'auto-detect',
      latencyTarget: 5000,
      qualityPreference: 'balanced',
    },
    models: {
      transcription: {
        primary: 'local-whisper-base',
        fallback: 'cloud-whisper',
      },
      llm: {
        primary: 'ollama://llama3:8b',
        fallbacks: [],
      },
    },
  };
  
  runWERValidation(testCases, engineConfig).catch(console.error);
}

export { runWERValidation, calculateWER, WERResult, TestCase };

