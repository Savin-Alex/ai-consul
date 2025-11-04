import { describe, it, expect, beforeEach } from 'vitest';
import { OutputValidator } from '../validator';
// @ts-ignore
import promptLibrary from '../../../../../ai_prompt_library_final_v2.1.json';

describe('OutputValidator', () => {
  let validator: OutputValidator;

  beforeEach(() => {
    validator = new OutputValidator(promptLibrary);
  });

  describe('validate', () => {
    it('should validate correct JSON response', () => {
      const llmResponse = JSON.stringify({
        suggestions: ['Ask about tech stack', 'Mention Q4 results'],
        use_case: 'interview_rag_reminder',
      });

      const result = validator.validate(llmResponse, 'job_interviews');

      expect(result.suggestions).toHaveLength(2);
      expect(result.suggestions[0]).toBe('Ask about tech stack');
      expect(result.useCase).toBe('interview_rag_reminder');
    });

    it('should enforce 12-word limit', () => {
      const longSuggestion =
        'This is a very long suggestion that exceeds the twelve word limit and should be truncated';
      const llmResponse = JSON.stringify({
        suggestions: [longSuggestion],
        use_case: 'interview_behavioral_nudge',
      });

      const result = validator.validate(llmResponse, 'job_interviews');

      const words = result.suggestions[0].split(/\s+/);
      expect(words.length).toBeLessThanOrEqual(12);
    });

    it('should enforce max 3 suggestions', () => {
      const llmResponse = JSON.stringify({
        suggestions: [
          'Suggestion 1',
          'Suggestion 2',
          'Suggestion 3',
          'Suggestion 4',
          'Suggestion 5',
        ],
        use_case: 'interview_behavioral_nudge',
      });

      const result = validator.validate(llmResponse, 'job_interviews');

      expect(result.suggestions.length).toBeLessThanOrEqual(3);
    });

    it('should extract suggestions from text with bullet points', () => {
      const llmResponse = `
        Here are some suggestions:
        - Ask about the team structure
        - Mention your AWS experience
        - Discuss the project timeline
      `;

      const result = validator.validate(llmResponse, 'job_interviews');

      expect(result.suggestions.length).toBeGreaterThan(0);
      expect(result.suggestions[0]).toContain('team structure');
    });

    it('should handle invalid JSON gracefully', () => {
      const llmResponse = 'This is not valid JSON but has some text';

      const result = validator.validate(llmResponse, 'job_interviews');

      expect(result.suggestions).toBeDefined();
      expect(Array.isArray(result.suggestions)).toBe(true);
    });

    it('should validate use_case enum', () => {
      const llmResponse = JSON.stringify({
        suggestions: ['Test suggestion'],
        use_case: 'invalid_use_case',
      });

      const result = validator.validate(llmResponse, 'job_interviews');

      // Should fallback to first valid use case
      expect(result.useCase).toBeDefined();
    });
  });
});

