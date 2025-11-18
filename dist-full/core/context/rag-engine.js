"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.RAGEngine = void 0;
const fs = __importStar(require("fs/promises"));
const path = __importStar(require("path"));
const pdf_parse_1 = __importDefault(require("pdf-parse"));
const mammoth_1 = __importDefault(require("mammoth"));
class RAGEngine {
    documents = new Map();
    initialized = false;
    async initialize() {
        this.initialized = true;
    }
    async loadDocuments(filePaths) {
        for (const filePath of filePaths) {
            try {
                const chunks = await this.loadDocument(filePath);
                this.documents.set(filePath, chunks);
            }
            catch (error) {
                console.error(`Failed to load document ${filePath}:`, error);
            }
        }
    }
    async loadDocument(filePath) {
        const ext = path.extname(filePath).toLowerCase();
        const content = await fs.readFile(filePath);
        let text = '';
        switch (ext) {
            case '.pdf':
                const pdfData = await (0, pdf_parse_1.default)(content);
                text = pdfData.text;
                break;
            case '.docx':
                const docxResult = await mammoth_1.default.extractRawText({ buffer: content });
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
        const chunks = [];
        for (let i = 0; i < paragraphs.length; i++) {
            chunks.push({
                text: paragraphs[i].trim(),
                source: path.basename(filePath),
                index: i,
            });
        }
        return chunks;
    }
    getRelevantContext(query, maxChunks = 3) {
        const allChunks = [];
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
    clear() {
        this.documents.clear();
    }
}
exports.RAGEngine = RAGEngine;
