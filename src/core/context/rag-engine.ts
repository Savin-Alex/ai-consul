import * as fs from 'fs/promises';
import * as path from 'path';
import pdfParse from 'pdf-parse';
import mammoth from 'mammoth';

interface DocumentChunk {
  text: string;
  source: string;
  index: number;
}

export class RAGEngine {
  private documents: Map<string, DocumentChunk[]> = new Map();
  private initialized = false;

  async initialize(): Promise<void> {
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

  getRelevantContext(query: string, maxChunks: number = 3): string {
    const allChunks: Array<DocumentChunk & { score: number }> = [];

    // Simple keyword matching (can be enhanced with embeddings later)
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

