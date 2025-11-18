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
exports.PromptBuilder = void 0;
// Load JSON at runtime using fs to avoid import path issues
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const promptLibraryPath = path.join(__dirname, '../../../ai_prompt_library_final_v2.1.json');
const promptLibrary = JSON.parse(fs.readFileSync(promptLibraryPath, 'utf-8'));
class PromptBuilder {
    library;
    constructor(library) {
        this.library = library;
    }
    buildPrompt(mode, conversationContext, ragContext, tone = 'friendly') {
        const coreMeta = this.library.core_meta_prompt;
        const modeConfig = this.library.prompt_modes[mode];
        if (!modeConfig) {
            throw new Error(`Unknown prompt mode: ${mode}`);
        }
        // Build system prompt
        const systemPromptParts = [
            coreMeta.prompt_text,
            coreMeta.tone_mode_instruction.replace('`UI Tone`', tone),
            coreMeta.fallback_rules,
            modeConfig.prompt_text,
        ];
        const systemPrompt = systemPromptParts.join('\n\n');
        // Build user prompt with context
        const userPromptParts = [];
        if (ragContext) {
            userPromptParts.push(`RAG Context:\n${ragContext}\n`);
        }
        userPromptParts.push(`Conversation History:\n${conversationContext}\n`);
        userPromptParts.push(`Generate suggestions based on the most recent conversation turn.`);
        const userPrompt = userPromptParts.join('\n');
        return { systemPrompt, userPrompt };
    }
    getModeOutputSchema(mode) {
        const modeConfig = this.library.prompt_modes[mode];
        if (modeConfig?.output_schema) {
            return modeConfig.output_schema;
        }
        // Fallback to coaching_nudge schema for simulation mode
        if (mode === 'simulation_coaching') {
            const simMode = modeConfig;
            return simMode?.output_schemas?.coaching_nudge;
        }
        return null;
    }
}
exports.PromptBuilder = PromptBuilder;
