import * as fs from 'fs/promises';
import * as path from 'path';
import pdfParse from 'pdf-parse';
import mammoth from 'mammoth';
import { loadTransformers } from '../audio/transformers';

interface DocumentChunk {
  text: string;
  source: string;
  index: number;
  embedding?: number[];
}

export class RAGEngine {
  private documents: Map<string, DocumentChunk[]> = new Map();
  private initialized = false;
  private embedder: any | null = null;
  private useEmbeddings: boolean = true;

  async initialize(useEmbeddings: boolean = true): Promise<void> {
    this.useEmbeddings = useEmbeddings;
    
    if (useEmbeddings) {
      try {
        // Load transformers dynamically
        const { pipeline } = await loadTransformers();
        
        // Use a lightweight embedding model optimized for speed
        // 'Xenova/all-MiniLM-L6-v2' is a good balance of quality and performance
        this.embedder = await pipeline(
          'feature-extraction',
          'Xenova/all-MiniLM-L6-v2',
          {
            quantized: true, // Use quantized model for faster inference
          }
        );
        console.log('[RAG] Embeddings model loaded successfully');
      } catch (error) {
        console.warn('[RAG] Failed to load embeddings model, falling back to keyword matching:', error);
        this.useEmbeddings = false;
        this.embedder = null;
      }
    }
    
    this.initialized = true;
  }

  async loadDocuments(filePaths: string[]): Promise<void> {
    for (const filePath of filePaths) {
      try {
        const chunks = await this.loadDocument(filePath);
        this.documents.set(filePath, chunks);
      } catch (error) {
        console.error(`Failed to load document ${filePath}:`, error);
      }
    }
  }

  private async loadDocument(filePath: string): Promise<DocumentChunk[]> {
    const ext = path.extname(filePath).toLowerCase();
    const content = await fs.readFile(filePath);

    let text = '';

    switch (ext) {
      case '.pdf':
        const pdfData = await pdfParse(content);
        text = pdfData.text;
        break;
      case '.docx':
        const docxResult = await mammoth.extractRawText({ buffer: content });
        text = docxResult.value;
        break;
      case '.txt':
      case '.md':
        text = content.toString('utf-8');
        break;
      default:
        throw new Error(`Unsupported file type: ${ext}`);
    }

    // Simple chunking: split by paragraphs and create chunks
    const paragraphs = text.split(/\n\n+/).filter((p) => p.trim().length > 0);
    const chunks: DocumentChunk[] = [];

    for (let i = 0; i < paragraphs.length; i++) {
      chunks.push({
        text: paragraphs[i].trim(),
        source: path.basename(filePath),
        index: i,
      });
    }

    return chunks;
  }

  async getRelevantContext(query: string, maxChunks: number = 3): Promise<string> {
    if (!this.initialized) {
      await this.initialize();
    }

    const allChunks: Array<DocumentChunk & { score: number }> = [];

    if (this.useEmbeddings && this.embedder) {
      // Use embeddings-based similarity
      try {
        const queryEmbedding = await this.computeEmbedding(query);
        
        for (const [source, chunks] of this.documents.entries()) {
          for (const chunk of chunks) {
            // Compute embedding if not already cached
            if (!chunk.embedding) {
              chunk.embedding = await this.computeEmbedding(chunk.text);
            }
            
            // Compute cosine similarity
            const score = this.cosineSimilarity(queryEmbedding, chunk.embedding);
            
            if (score > 0.1) { // Threshold to filter out irrelevant chunks
              allChunks.push({ ...chunk, score });
            }
          }
        }
      } catch (error) {
        console.warn('[RAG] Embeddings computation failed, falling back to keyword matching:', error);
        return this.getRelevantContextKeyword(query, maxChunks);
      }
    } else {
      // Fallback to keyword matching
      return this.getRelevantContextKeyword(query, maxChunks);
    }

    // Sort by score and return top chunks
    allChunks.sort((a, b) => b.score - a.score);
    const topChunks = allChunks.slice(0, maxChunks);

    if (topChunks.length === 0) {
      return '';
    }

    return topChunks
      .map((chunk) => `${chunk.source}: ${chunk.text}`)
      .join('\n\n');
  }

  /**
   * Compute embedding for a text string
   */
  private async computeEmbedding(text: string): Promise<number[]> {
    if (!this.embedder) {
      throw new Error('Embedder not initialized');
    }

    const result = await this.embedder(text, {
      pooling: 'mean',
      normalize: true,
    });

    // Extract embedding vector from result
    // The result structure depends on the model - handle both tensor and array formats
    if (result && typeof result.data !== 'undefined') {
      // Tensor format
      return Array.from(result.data);
    } else if (Array.isArray(result)) {
      // Already an array
      return result;
    } else if (result && typeof result[Symbol.iterator] === 'function') {
      // Iterable (like Float32Array)
      return Array.from(result);
    } else {
      throw new Error('Unexpected embedding result format');
    }
  }

  /**
   * Compute cosine similarity between two embedding vectors
   */
  private cosineSimilarity(a: number[], b: number[]): number {
    if (a.length !== b.length) {
      throw new Error('Embedding dimensions must match');
    }

    let dotProduct = 0;
    let normA = 0;
    let normB = 0;

    for (let i = 0; i < a.length; i++) {
      dotProduct += a[i] * b[i];
      normA += a[i] * a[i];
      normB += b[i] * b[i];
    }

    const denominator = Math.sqrt(normA) * Math.sqrt(normB);
    if (denominator === 0) {
      return 0;
    }

    return dotProduct / denominator;
  }

  /**
   * Fallback keyword-based retrieval (original implementation)
   */
  private getRelevantContextKeyword(query: string, maxChunks: number = 3): string {
    const allChunks: Array<DocumentChunk & { score: number }> = [];

    // Simple keyword matching
    const queryWords = query
      .toLowerCase()
      .split(/\s+/)
      .filter((w) => w.length >= 3); // Include words 3+ chars

    for (const [source, chunks] of this.documents.entries()) {
      for (const chunk of chunks) {
        const chunkText = chunk.text.toLowerCase();
        let score = 0;

        for (const word of queryWords) {
          if (chunkText.includes(word)) {
            score += 1;
          }
        }

        if (score > 0) {
          allChunks.push({ ...chunk, score });
        }
      }
    }

    // Sort by score and return top chunks
    allChunks.sort((a, b) => b.score - a.score);
    const topChunks = allChunks.slice(0, maxChunks);

    if (topChunks.length === 0) {
      return '';
    }

    return topChunks
      .map((chunk) => `${chunk.source}: ${chunk.text}`)
      .join('\n\n');
  }

  clear(): void {
    this.documents.clear();
  }
}

