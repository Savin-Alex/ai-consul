import { z } from 'zod';
// @ts-ignore - JSON import
import promptLibrary from '../../../../ai_prompt_library_final_v2.1.json';

type PromptMode = 'education' | 'work_meetings' | 'job_interviews' | 'chat_messaging' | 'simulation_coaching';

interface PromptLibrary {
  prompt_modes: {
    [key: string]: {
      output_schema?: any;
      output_schemas?: {
        coaching_nudge?: any;
      };
    };
  };
}

interface ValidatedOutput {
  suggestions: string[];
  useCase?: string;
}

export class OutputValidator {
  private library: PromptLibrary;

  constructor(library: any) {
    this.library = library as PromptLibrary;
  }

  validate(llmResponse: string, mode: PromptMode): ValidatedOutput {
    // Try to parse JSON from LLM response
    let parsed: any;
    try {
      // Extract JSON from response if it's wrapped in text
      const jsonMatch = llmResponse.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        parsed = JSON.parse(jsonMatch[0]);
      } else {
        parsed = JSON.parse(llmResponse);
      }
    } catch (error) {
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
      .map((s: string) => {
        const words = s.trim().split(/\s+/);
        // Enforce 12-word limit
        if (words.length > 12) {
          return words.slice(0, 12).join(' ');
        }
        return s.trim();
      })
      .filter((s: string) => s.length > 0);

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

  private extractFromText(text: string): ValidatedOutput {
    // Fallback: extract suggestions from bullet points or numbered lists
    const lines = text.split('\n').filter((line) => line.trim().length > 0);
    const suggestions: string[] = [];

    for (const line of lines) {
      // Match bullet points, numbered lists, or dashes
      const match = line.match(/^[-•*\d+\.]\s*(.+)/);
      if (match) {
        const suggestion = match[1].trim();
        const words = suggestion.split(/\s+/);
        if (words.length <= 12 && suggestion.length > 0) {
          suggestions.push(suggestion);
        }
        if (suggestions.length >= 3) break;
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

