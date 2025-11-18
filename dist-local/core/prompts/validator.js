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
exports.OutputValidator = void 0;
// Load JSON at runtime using fs to avoid import path issues
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const promptLibraryPath = path.join(__dirname, '../../../ai_prompt_library_final_v2.1.json');
const promptLibrary = JSON.parse(fs.readFileSync(promptLibraryPath, 'utf-8'));
class OutputValidator {
    library;
    constructor(library) {
        this.library = library;
    }
    validate(llmResponse, mode) {
        // Try to parse JSON from LLM response
        let parsed;
        try {
            // Extract JSON from response if it's wrapped in text
            const jsonMatch = llmResponse.match(/\{[\s\S]*\}/);
            if (jsonMatch) {
                parsed = JSON.parse(jsonMatch[0]);
            }
            else {
                parsed = JSON.parse(llmResponse);
            }
        }
        catch (error) {
            console.warn('Failed to parse LLM response as JSON:', error);
            // Fallback: try to extract suggestions from plain text
            return this.extractFromText(llmResponse);
        }
        // Get schema for mode
        const modeConfig = this.library.prompt_modes[mode];
        const schema = modeConfig?.output_schema || modeConfig?.output_schemas?.coaching_nudge;
        if (!schema) {
            return this.extractFromText(llmResponse);
        }
        // Validate against schema
        const suggestions = parsed.suggestions || [];
        const useCase = parsed.use_case;
        // Validate suggestions array
        if (!Array.isArray(suggestions) || suggestions.length === 0) {
            return this.extractFromText(llmResponse);
        }
        // Enforce max length and count
        const validatedSuggestions = suggestions
            .slice(0, 3) // Max 3 suggestions
            .map((s) => {
            const words = s.trim().split(/\s+/);
            // Enforce 12-word limit
            if (words.length > 12) {
                return words.slice(0, 12).join(' ');
            }
            return s.trim();
        })
            .filter((s) => s.length > 0);
        // Validate use_case enum if provided
        if (useCase && schema.properties?.use_case?.enum) {
            const validUseCases = schema.properties.use_case.enum;
            if (!validUseCases.includes(useCase)) {
                // Use first valid use case as fallback
                return {
                    suggestions: validatedSuggestions,
                    useCase: validUseCases[0],
                };
            }
        }
        return {
            suggestions: validatedSuggestions,
            useCase: useCase || schema.properties?.use_case?.enum?.[0],
        };
    }
    extractFromText(text) {
        // Fallback: extract suggestions from bullet points or numbered lists
        const lines = text.split('\n').filter((line) => line.trim().length > 0);
        const suggestions = [];
        for (const line of lines) {
            const trimmedLine = line.trim();
            // Match bullet points, numbered lists, or dashes (with optional leading whitespace)
            const match = trimmedLine.match(/^[-•*\d+\.]\s+(.+)$/);
            if (match) {
                const suggestion = match[1].trim();
                const words = suggestion.split(/\s+/);
                if (words.length <= 12 && suggestion.length > 0) {
                    suggestions.push(suggestion);
                }
                if (suggestions.length >= 3)
                    break;
            }
        }
        // If no structured suggestions found, try to extract first sentence
        if (suggestions.length === 0) {
            const firstSentence = text.split(/[.!?]/)[0].trim();
            if (firstSentence.length > 0 && firstSentence.length < 100) {
                suggestions.push(firstSentence);
            }
        }
        return {
            suggestions: suggestions.slice(0, 3),
        };
    }
}
exports.OutputValidator = OutputValidator;
