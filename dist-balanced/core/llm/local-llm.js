"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.LocalLLM = void 0;
const axios_1 = __importDefault(require("axios"));
class LocalLLM {
    client;
    baseURL = 'http://localhost:11434';
    constructor() {
        this.client = axios_1.default.create({
            baseURL: this.baseURL,
            timeout: 30000,
        });
    }
    async checkConnection() {
        try {
            const response = await this.client.get('/api/tags');
            return response.status === 200;
        }
        catch (error) {
            return false;
        }
    }
    async listModels() {
        try {
            const response = await this.client.get('/api/tags');
            return response.data.models?.map((m) => m.name) || [];
        }
        catch (error) {
            console.error('Failed to list Ollama models:', error);
            return [];
        }
    }
    async checkModelAvailable(modelName) {
        const models = await this.listModels();
        return models.some((m) => m === modelName || m.includes(modelName));
    }
    async generate(prompt, model = 'llama3:8b', systemPrompt) {
        try {
            const fullPrompt = systemPrompt ? `${systemPrompt}\n\n${prompt}` : prompt;
            const response = await this.client.post('/api/generate', {
                model,
                prompt: fullPrompt,
                stream: false,
                options: {
                    temperature: 0.7,
                    num_predict: 200,
                },
            }, {
                timeout: 60000,
            });
            // Handle streaming response
            if (typeof response.data === 'string') {
                // Parse JSON lines if streaming
                const lines = response.data.split('\n').filter((l) => l.trim());
                const lastLine = lines[lines.length - 1];
                const data = JSON.parse(lastLine);
                return data.response || '';
            }
            return response.data.response || '';
        }
        catch (error) {
            if (error.code === 'ECONNREFUSED') {
                throw new Error('Ollama is not running. Please start Ollama first.');
            }
            console.error('Ollama API error:', error);
            throw new Error(`Ollama generation failed: ${error.message}`);
        }
    }
    async generateStream(prompt, model = 'llama3:8b', onChunk, systemPrompt) {
        try {
            const fullPrompt = systemPrompt ? `${systemPrompt}\n\n${prompt}` : prompt;
            const response = await this.client.post('/api/generate', {
                model,
                prompt: fullPrompt,
                stream: true,
                options: {
                    temperature: 0.7,
                    num_predict: 200,
                },
            }, {
                responseType: 'stream',
                timeout: 60000,
            });
            response.data.on('data', (chunk) => {
                const lines = chunk.toString().split('\n').filter((l) => l.trim());
                for (const line of lines) {
                    try {
                        const data = JSON.parse(line);
                        if (data.response) {
                            onChunk(data.response);
                        }
                    }
                    catch (e) {
                        // Ignore parse errors
                    }
                }
            });
        }
        catch (error) {
            if (error.code === 'ECONNREFUSED') {
                throw new Error('Ollama is not running. Please start Ollama first.');
            }
            console.error('Ollama streaming error:', error);
            throw new Error(`Ollama streaming failed: ${error.message}`);
        }
    }
    parseModelString(modelString) {
        // Parse "ollama://llama3:8b" or "llama3:8b"
        const match = modelString.match(/(?:ollama:\/\/)?(.+)/);
        if (match) {
            const parts = match[1].split(':');
            return {
                model: parts[0],
                tag: parts[1] || 'latest',
            };
        }
        return { model: modelString };
    }
}
exports.LocalLLM = LocalLLM;
