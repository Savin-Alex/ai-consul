import { LLMRouter } from '../llm/router';
import { PromptBuilder } from '../prompts/builder';
import { OutputValidator } from '../prompts/validator';
// @ts-ignore - JSON import
import promptLibrary from '../../../../ai_prompt_library_final_v2.1.json';

export interface SimulationMetrics {
  pacingWpm?: number;
  fillerWords?: number;
  energy?: number;
}

export interface SessionSummary {
  summary: string;
  strengths: string[];
  improvements: string[];
}

export class SimulationMode {
  private llmRouter: LLMRouter;
  private promptBuilder: PromptBuilder;
  private outputValidator: OutputValidator;
  private metrics: SimulationMetrics[] = [];

  constructor(llmRouter: LLMRouter) {
    this.llmRouter = llmRouter;
    this.promptBuilder = new PromptBuilder(promptLibrary);
    this.outputValidator = new OutputValidator(promptLibrary);
  }

  async generateQuestion(context: string): Promise<string> {
    const prompt = `You are an interviewer. Generate a professional interview question based on the conversation context:\n\n${context}\n\nGenerate a single interview question.`;

    const response = await this.llmRouter.generate(prompt);

    // Parse response to extract question
    const questionMatch = response.match(/["'](.+?)["']/);
    if (questionMatch) {
      return questionMatch[1];
    }

    return response.trim();
  }

  async generateFeedback(userAnswer: string, question: string): Promise<string> {
    const prompt = `You are an interviewer providing feedback. The question was: "${question}"\n\nThe candidate's answer was: "${userAnswer}"\n\nProvide constructive, encouraging feedback in 2-3 sentences.`;

    const response = await this.llmRouter.generate(prompt);
    return response.trim();
  }

  async generateCoachingNudge(
    metrics: SimulationMetrics,
    context: string
  ): Promise<{ suggestions: string[]; useCase: string }> {
    const prompt = this.promptBuilder.buildPrompt(
      'simulation_coaching',
      context,
      ''
    );

    // Add metrics to prompt
    const metricsPrompt = `Current metrics:\n- Pacing: ${metrics.pacingWpm || 'N/A'} WPM\n- Filler words: ${metrics.fillerWords || 'N/A'}\n- Energy: ${metrics.energy || 'N/A'}\n\nGenerate coaching suggestions.`;

    const response = await this.llmRouter.generate(
      metricsPrompt,
      prompt.systemPrompt
    );

    const validated = this.outputValidator.validate(response, 'simulation_coaching');
    return {
      suggestions: validated.suggestions,
      useCase: validated.useCase || 'coach_pacing',
    };
  }

  addMetrics(metrics: SimulationMetrics): void {
    this.metrics.push(metrics);
  }

  async generateSessionSummary(): Promise<SessionSummary> {
    const metricsSummary = this.metrics
      .map((m, i) => `Metric ${i + 1}: WPM=${m.pacingWpm}, Fillers=${m.fillerWords}`)
      .join('\n');

    const prompt = `Generate a session summary based on the following metrics:\n\n${metricsSummary}\n\nProvide:\n1. A 1-paragraph summary\n2. 3 specific strengths\n3. 3 actionable areas for improvement\n\nDo not use numeric scores. Format as JSON with keys: summary, strengths (array), improvements (array).`;

    try {
      const response = await this.llmRouter.generate(prompt);
      const jsonMatch = response.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);
        return {
          summary: parsed.summary || 'Session completed.',
          strengths: parsed.strengths || [],
          improvements: parsed.improvements || [],
        };
      }
    } catch (error) {
      console.error('Failed to generate session summary:', error);
    }

    // Fallback
    return {
      summary: 'Session completed. Review the metrics to identify areas for improvement.',
      strengths: ['Good engagement', 'Clear communication', 'Professional demeanor'],
      improvements: ['Practice pacing', 'Reduce filler words', 'Increase energy'],
    };
  }

  clearMetrics(): void {
    this.metrics = [];
  }
}

