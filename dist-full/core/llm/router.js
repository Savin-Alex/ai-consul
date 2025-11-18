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
Object.defineProperty(exports, "__esModule", { value: true });
exports.LLMRouter = void 0;
const local_llm_1 = require("./local-llm");
const cloud_llm_1 = require("./cloud-llm");
const dotenv = __importStar(require("dotenv"));
dotenv.config();
class LLMRouter {
    config;
    localLLM;
    openAIService;
    anthropicService;
    googleAIService;
    constructor(config) {
        this.config = config;
        this.localLLM = new local_llm_1.LocalLLM();
        // Initialize cloud services if API keys are available and cloud fallback is enabled
        if (config.privacy.cloudFallback) {
            if (process.env.OPENAI_API_KEY) {
                this.openAIService = new cloud_llm_1.OpenAIService(process.env.OPENAI_API_KEY);
            }
            if (process.env.ANTHROPIC_API_KEY) {
                this.anthropicService = new cloud_llm_1.AnthropicService(process.env.ANTHROPIC_API_KEY);
            }
            if (process.env.GOOGLE_API_KEY) {
                this.googleAIService = new cloud_llm_1.GoogleAIService(process.env.GOOGLE_API_KEY);
            }
        }
    }
    async generate(prompt, systemPrompt) {
        // Try primary model first (local)
        try {
            const primaryModel = this.config.models.llm.primary;
            const parsed = this.localLLM.parseModelString(primaryModel);
            // Check if Ollama is available
            const isConnected = await this.localLLM.checkConnection();
            if (isConnected) {
                const modelAvailable = await this.localLLM.checkModelAvailable(`${parsed.model}:${parsed.tag || 'latest'}`);
                if (modelAvailable) {
                    const response = await this.localLLM.generate(prompt, `${parsed.model}:${parsed.tag || 'latest'}`, systemPrompt);
                    return response;
                }
            }
        }
        catch (error) {
            console.warn('Primary LLM failed, trying fallbacks:', error);
        }
        // Try fallbacks if cloud fallback is enabled
        if (this.config.privacy.cloudFallback) {
            for (const fallbackModel of this.config.models.llm.fallbacks) {
                try {
                    let response;
                    if (fallbackModel.startsWith('gpt-')) {
                        if (!this.openAIService) {
                            continue;
                        }
                        const result = await this.openAIService.generate(prompt, fallbackModel, systemPrompt);
                        response = result.text;
                    }
                    else if (fallbackModel.startsWith('claude-')) {
                        if (!this.anthropicService) {
                            continue;
                        }
                        const result = await this.anthropicService.generate(prompt, fallbackModel, systemPrompt);
                        response = result.text;
                    }
                    else if (fallbackModel.startsWith('gemini-')) {
                        if (!this.googleAIService) {
                            continue;
                        }
                        const result = await this.googleAIService.generate(prompt, fallbackModel, systemPrompt);
                        response = result.text;
                    }
                    else {
                        continue;
                    }
                    return response;
                }
                catch (error) {
                    console.warn(`Fallback model ${fallbackModel} failed:`, error);
                    continue;
                }
            }
        }
        throw new Error('All LLM services failed. Please check your configuration and connection.');
    }
}
exports.LLMRouter = LLMRouter;
