import { describe, it, expect, beforeEach } from 'vitest';
import { PromptBuilder } from '../builder';
import * as fs from 'fs';
import * as path from 'path';

const promptLibraryPath = path.join(__dirname, '../../../../ai_prompt_library_final_v2.1.json');
const promptLibrary = JSON.parse(fs.readFileSync(promptLibraryPath, 'utf-8'));

describe('PromptBuilder', () => {
  let builder: PromptBuilder;

  beforeEach(() => {
    builder = new PromptBuilder(promptLibrary);
  });

  describe('buildPrompt', () => {
    it('should build prompt for job_interviews mode', () => {
      const conversationContext = 'user: Tell me about yourself';
      const ragContext = 'Resume.txt: Led migration project in 2022';

      const result = builder.buildPrompt(
        'job_interviews',
        conversationContext,
        ragContext
      );

      expect(result.systemPrompt).toContain('AI Consul');
      expect(result.systemPrompt).toContain('JOB INTERVIEW MODE');
      expect(result.userPrompt).toContain(conversationContext);
      expect(result.userPrompt).toContain(ragContext);
    });

    it('should include tone mode instruction', () => {
      const result = builder.buildPrompt(
        'job_interviews',
        '',
        '',
        'formal'
      );

      expect(result.systemPrompt).toContain('formal');
    });

    it('should handle different modes', () => {
      const modes: Array<'education' | 'work_meetings' | 'job_interviews'> = [
        'education',
        'work_meetings',
        'job_interviews',
      ];

      modes.forEach((mode) => {
        const result = builder.buildPrompt(mode, 'context', 'rag');
        expect(result.systemPrompt).toBeDefined();
        expect(result.userPrompt).toBeDefined();
      });
    });

    it('should include RAG context when provided', () => {
      const ragContext = 'Document: Important information';
      const result = builder.buildPrompt(
        'job_interviews',
        'conversation',
        ragContext
      );

      expect(result.userPrompt).toContain('RAG Context');
      expect(result.userPrompt).toContain(ragContext);
    });

    it('should include conversation history', () => {
      const conversationContext = 'user: Hello\nother: Hi there';
      const result = builder.buildPrompt(
        'job_interviews',
        conversationContext,
        ''
      );

      expect(result.userPrompt).toContain('Conversation History');
      expect(result.userPrompt).toContain(conversationContext);
    });
  });

  describe('getModeOutputSchema', () => {
    it('should return schema for job_interviews mode', () => {
      const schema = builder.getModeOutputSchema('job_interviews');
      expect(schema).toBeDefined();
      expect(schema.properties).toBeDefined();
      expect(schema.properties.suggestions).toBeDefined();
    });

    it('should return schema for education mode', () => {
      const schema = builder.getModeOutputSchema('education');
      expect(schema).toBeDefined();
    });

    it('should return coaching_nudge schema for simulation mode', () => {
      const schema = builder.getModeOutputSchema('simulation_coaching');
      expect(schema).toBeDefined();
    });
  });
});

