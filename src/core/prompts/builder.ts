// Load JSON at runtime using fs to avoid import path issues
import * as fs from 'fs';
import * as path from 'path';

const promptLibraryPath = path.join(__dirname, '../../../ai_prompt_library_final_v2.1.json');
const promptLibrary = JSON.parse(fs.readFileSync(promptLibraryPath, 'utf-8'));

type PromptMode = 'education' | 'work_meetings' | 'job_interviews' | 'chat_messaging' | 'simulation_coaching';

interface PromptLibrary {
  core_meta_prompt: {
    prompt_text: string;
    tone_mode_instruction: string;
    fallback_rules: string;
  };
  prompt_modes: {
    [key: string]: {
      prompt_text: string;
      output_schema?: any;
    };
  };
}

export class PromptBuilder {
  private library: PromptLibrary;

  constructor(library: any) {
    this.library = library as PromptLibrary;
  }

  buildPrompt(
    mode: PromptMode,
    conversationContext: string,
    ragContext: string,
    tone: 'formal' | 'friendly' | 'slang' = 'friendly'
  ): { systemPrompt: string; userPrompt: string } {
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
    userPromptParts.push(
      `Generate suggestions based on the most recent conversation turn.`
    );

    const userPrompt = userPromptParts.join('\n');

    return { systemPrompt, userPrompt };
  }

  getModeOutputSchema(mode: PromptMode): any {
    const modeConfig = this.library.prompt_modes[mode];
    if (modeConfig?.output_schema) {
      return modeConfig.output_schema;
    }
    // Fallback to coaching_nudge schema for simulation mode
    if (mode === 'simulation_coaching') {
      const simMode = modeConfig as any;
      return simMode?.output_schemas?.coaching_nudge;
    }
    return null;
  }
}

