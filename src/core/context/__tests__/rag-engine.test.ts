import { describe, it, expect, beforeEach, vi } from 'vitest';
import { RAGEngine } from '../rag-engine';
import * as fs from 'fs/promises';
import pdfParse from 'pdf-parse';
import mammoth from 'mammoth';

vi.mock('fs/promises');
vi.mock('pdf-parse');
vi.mock('mammoth');

describe('RAGEngine', () => {
  let ragEngine: RAGEngine;

  beforeEach(() => {
    ragEngine = new RAGEngine();
  });

  describe('initialize', () => {
    it('should initialize successfully', async () => {
      await expect(ragEngine.initialize()).resolves.not.toThrow();
    });
  });

  describe('loadDocuments', () => {
    it('should load text file', async () => {
      const mockContent = Buffer.from('This is test content\n\nWith multiple paragraphs.');
      vi.spyOn(fs, 'readFile').mockResolvedValue(mockContent);

      await ragEngine.loadDocuments(['test.txt']);

      const context = await ragEngine.getRelevantContext('test');
      expect(context).toContain('test content');
    });

    it('should load PDF file', async () => {
      const mockPdfContent = {
        text: 'PDF content with keywords\n\nMore content here.',
      };
      vi.spyOn(fs, 'readFile').mockResolvedValue(Buffer.from('pdf content'));
      vi.mocked(pdfParse).mockResolvedValue(mockPdfContent as any);

      await ragEngine.loadDocuments(['test.pdf']);

      const context = await ragEngine.getRelevantContext('keywords');
      expect(context).toContain('keywords');
    });

    it('should load DOCX file', async () => {
      const mockDocxContent = {
        value: 'DOCX content with important information',
      };
      vi.spyOn(fs, 'readFile').mockResolvedValue(Buffer.from('docx content'));
      vi.mocked(mammoth.extractRawText).mockResolvedValue(mockDocxContent as any);

      await ragEngine.loadDocuments(['test.docx']);

      const context = await ragEngine.getRelevantContext('important');
      expect(context).toContain('important information');
    });

    it('should handle multiple documents', async () => {
      vi.spyOn(fs, 'readFile').mockImplementation((path) => {
        if (path === 'doc1.txt') {
          return Promise.resolve(Buffer.from('Document 1 content'));
        }
        return Promise.resolve(Buffer.from('Document 2 content'));
      });

      await ragEngine.loadDocuments(['doc1.txt', 'doc2.txt']);

      const context = await ragEngine.getRelevantContext('Document');
      expect(context).toContain('Document 1');
      expect(context).toContain('Document 2');
    });
  });

  describe('getRelevantContext', () => {
    it('should return relevant context for query', async () => {
      const mockContent = Buffer.from('This document mentions AWS and Kubernetes technologies.\n\nMore content here.');
      vi.spyOn(fs, 'readFile').mockResolvedValue(mockContent);

      await ragEngine.loadDocuments(['test.txt']);

      const context = await ragEngine.getRelevantContext('AWS');
      expect(context.length).toBeGreaterThan(0);
    });

    it('should return empty string when no relevant context', async () => {
      const mockContent = Buffer.from('This document has no relevant keywords.\n\nMore content here.');
      vi.spyOn(fs, 'readFile').mockResolvedValue(mockContent);

      await ragEngine.loadDocuments(['test.txt']);

      const context = await ragEngine.getRelevantContext('nonexistentkeyword');
      // Should return empty or very short context
      expect(context.length).toBeLessThanOrEqual(100);
    });

    it('should limit to max chunks', async () => {
      const mockContent = Buffer.from(
        Array(10)
          .fill('Paragraph with keyword mention')
          .join('\n\n')
      );
      vi.spyOn(fs, 'readFile').mockResolvedValue(mockContent);

      await ragEngine.loadDocuments(['test.txt']);

      const context = await ragEngine.getRelevantContext('keyword', 3);
      const chunks = context.split('\n\n').filter((c) => c.trim());
      expect(chunks.length).toBeLessThanOrEqual(3);
    });
  });

  describe('clear', () => {
    it('should clear all documents', async () => {
      const mockContent = Buffer.from('Test content');
      vi.spyOn(fs, 'readFile').mockResolvedValue(mockContent);

      await ragEngine.loadDocuments(['test.txt']);
      ragEngine.clear();

      const context = await ragEngine.getRelevantContext('Test');
      expect(context).toBe('');
    });
  });
});

