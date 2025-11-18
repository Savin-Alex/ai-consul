// Prompt library loading is now handled in engine.ts with proper validation
// This file no longer loads the library directly

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

interface CachedPrompt {
  systemPrompt: string;
  userPromptTemplate: string; // Template without conversation context
  timestamp: number;
}

export class PromptBuilder {
  private library: PromptLibrary | null;
  private promptCache: Map<string, CachedPrompt> = new Map();
  private readonly CACHE_TTL_MS = 3600000; // 1 hour
  private readonly MAX_CACHE_SIZE = 100; // Maximum cached prompts

  constructor(library: any) {
    // Allow null initially - will be set during engine initialization
    // Validation happens when buildPrompt is called
    this.library = library as PromptLibrary | null;
  }
  
  /**
   * Set the prompt library (called during engine initialization)
   */
  setLibrary(library: PromptLibrary): void {
    if (!library) {
      throw new Error('Prompt library is required.');
    }
    this.library = library;
  }

  /**
   * Generate a cache key based on mode, tone, and RAG context
   */
  private getCacheKey(
    mode: PromptMode,
    ragContext: string,
    tone: 'formal' | 'friendly' | 'slang'
  ): string {
    // Use first 50 chars of RAG context for cache key (RAG context changes less frequently)
    const ragHash = ragContext.substring(0, 50).replace(/\s+/g, '');
    return `${mode}:${tone}:${ragHash}`;
  }

  /**
   * Simple hash function for cache key
   */
  private simpleHash(str: string): string {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = (hash << 5) - hash + char;
      hash = hash & hash; // Convert to 32-bit integer
    }
    return Math.abs(hash).toString(36);
  }

  /**
   * Clean expired entries from cache
   */
  private cleanCache(): void {
    const now = Date.now();
    const keysToDelete: string[] = [];

    for (const [key, cached] of this.promptCache.entries()) {
      if (now - cached.timestamp > this.CACHE_TTL_MS) {
        keysToDelete.push(key);
      }
    }

    for (const key of keysToDelete) {
      this.promptCache.delete(key);
    }

    // If cache is still too large, remove oldest entries
    if (this.promptCache.size > this.MAX_CACHE_SIZE) {
      const entries = Array.from(this.promptCache.entries())
        .sort((a, b) => a[1].timestamp - b[1].timestamp);
      
      const toRemove = entries.slice(0, this.promptCache.size - this.MAX_CACHE_SIZE);
      for (const [key] of toRemove) {
        this.promptCache.delete(key);
      }
    }
  }

  buildPrompt(
    mode: PromptMode,
    conversationContext: string,
    ragContext: string,
    tone: 'formal' | 'friendly' | 'slang' = 'friendly'
  ): { systemPrompt: string; userPrompt: string } {
    if (!this.library) {
      throw new Error('Prompt library is not loaded. Ensure engine is initialized before using PromptBuilder.');
    }
    
    const coreMeta = this.library.core_meta_prompt;
    const modeConfig = this.library.prompt_modes[mode];

    if (!modeConfig) {
      throw new Error(`Unknown prompt mode: ${mode}`);
    }

    // Clean cache periodically
    this.cleanCache();

    // Try to get cached prompt
    const cacheKey = this.getCacheKey(mode, ragContext, tone);
    const cached = this.promptCache.get(cacheKey);

    let systemPrompt: string;
    let userPromptTemplate: string;

    if (cached && Date.now() - cached.timestamp < this.CACHE_TTL_MS) {
      // Use cached system prompt and template
      systemPrompt = cached.systemPrompt;
      userPromptTemplate = cached.userPromptTemplate;
    } else {
      // Build system prompt (static parts)
      const systemPromptParts = [
        coreMeta.prompt_text,
        coreMeta.tone_mode_instruction.replace('`UI Tone`', tone),
        coreMeta.fallback_rules,
        modeConfig.prompt_text,
      ];

      systemPrompt = systemPromptParts.join('\n\n');

      // Build user prompt template (without conversation context)
      const userPromptParts = [];

      if (ragContext) {
        userPromptParts.push(`RAG Context:\n${ragContext}\n`);
      }

      userPromptParts.push(`Conversation History:\n{{conversationContext}}\n`);
      userPromptParts.push(
        `Generate suggestions based on the most recent conversation turn.`
      );

      userPromptTemplate = userPromptParts.join('\n');

      // Cache the prompt
      this.promptCache.set(cacheKey, {
        systemPrompt,
        userPromptTemplate,
        timestamp: Date.now(),
      });
    }

    // Inject conversation context into template
    const userPrompt = userPromptTemplate.replace(
      '{{conversationContext}}',
      conversationContext
    );

    return { systemPrompt, userPrompt };
  }

  /**
   * Clear the prompt cache
   */
  clearCache(): void {
    this.promptCache.clear();
  }

  /**
   * Get cache statistics
   */
  getCacheStats(): { size: number; maxSize: number; ttlMs: number } {
    return {
      size: this.promptCache.size,
      maxSize: this.MAX_CACHE_SIZE,
      ttlMs: this.CACHE_TTL_MS,
    };
  }

  getModeOutputSchema(mode: PromptMode): any {
    if (!this.library) {
      throw new Error('Prompt library is not loaded. Ensure engine is initialized before using PromptBuilder.');
    }
    
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

