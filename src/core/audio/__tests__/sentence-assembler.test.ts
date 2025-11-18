import { describe, it, expect, beforeEach, vi } from 'vitest';
import { SentenceAssembler, Word, CompleteSentence } from '../sentence-assembler';

describe('SentenceAssembler', () => {
  let assembler: SentenceAssembler;

  beforeEach(() => {
    assembler = new SentenceAssembler();
  });

  describe('punctuation boundary detection', () => {
    it('should emit sentence on punctuation', async () => {
      const sentences: CompleteSentence[] = [];
      assembler.on('sentence', (sentence) => {
        sentences.push(sentence);
      });

      const words: Word[] = [
        { text: 'Hello', start: 0, end: 500, confidence: 0.9 },
        { text: 'world.', start: 500, end: 1000, confidence: 0.9 },
      ];

      await assembler.addFinalTranscript('Hello world.', words);

      // Wait for boundary confirmation delay
      await new Promise(resolve => setTimeout(resolve, 250));

      expect(sentences.length).toBeGreaterThan(0);
      if (sentences.length > 0) {
        expect(sentences[0].boundaryType).toBe('punctuation');
        expect(sentences[0].text).toContain('world');
      }
    });

    it('should detect question marks as boundaries', async () => {
      const sentences: CompleteSentence[] = [];
      assembler.on('sentence', (sentence) => {
        sentences.push(sentence);
      });

      const words: Word[] = [
        { text: 'What', start: 0, end: 300, confidence: 0.9 },
        { text: 'is', start: 300, end: 500, confidence: 0.9 },
        { text: 'this?', start: 500, end: 1000, confidence: 0.9 },
      ];

      await assembler.addFinalTranscript('What is this?', words);
      await new Promise(resolve => setTimeout(resolve, 250));

      expect(sentences.length).toBeGreaterThan(0);
    });
  });

  describe('silence boundary detection', () => {
    it('should emit sentence on silence gap', async () => {
      const sentences: CompleteSentence[] = [];
      assembler.on('sentence', (sentence) => {
        sentences.push(sentence);
      });

      const words: Word[] = [
        { text: 'Hello', start: 0, end: 500, confidence: 0.9 },
        { text: 'world', start: 1500, end: 2000, confidence: 0.9 }, // 1000ms gap
      ];

      await assembler.addFinalTranscript('Hello world', words);

      expect(sentences.length).toBeGreaterThan(0);
      if (sentences.length > 0) {
        expect(sentences[0].boundaryType).toBe('silence');
      }
    });
  });

  describe('timeout boundary', () => {
    it('should emit sentence on timeout', async () => {
      const sentences: CompleteSentence[] = [];
      assembler.on('sentence', (sentence) => {
        sentences.push(sentence);
      });

      const words: Word[] = [
        { text: 'This', start: 0, end: 500, confidence: 0.9 },
        { text: 'is', start: 500, end: 800, confidence: 0.9 },
        { text: 'a', start: 800, end: 1000, confidence: 0.9 },
        { text: 'long', start: 1000, end: 1500, confidence: 0.9 },
        { text: 'sentence', start: 1500, end: 2000, confidence: 0.9 },
      ];

      await assembler.addFinalTranscript('This is a long sentence', words);

      // Wait for timeout (maxSentenceDuration = 8000ms)
      await new Promise(resolve => setTimeout(resolve, 8500));

      expect(sentences.length).toBeGreaterThan(0);
      if (sentences.length > 0) {
        expect(sentences[0].boundaryType).toBe('timeout');
      }
    });
  });

  describe('state management', () => {
    it('should reset correctly', () => {
      assembler.reset();
      expect(assembler.getState()).toBe('idle');
      expect(assembler.getBufferSize()).toBe(0);
    });

    it('should flush remaining buffer', async () => {
      const sentences: CompleteSentence[] = [];
      assembler.on('sentence', (sentence) => {
        sentences.push(sentence);
      });

      await assembler.addFinalTranscript('Hello world', []);
      await assembler.flush();

      expect(sentences.length).toBeGreaterThan(0);
    });
  });
});

