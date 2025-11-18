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
    const prompt = `You are an interviewer. Generate a professional interview question based on the conversation context:\n\n${context}\n\nGenerate a single interview question. Return ONLY the question, no quotes, no explanation.`;

    const response = await this.llmRouter.generate(prompt);

    // Clean up common prefixes and quotes
    const cleaned = response
      .replace(/^(Question:|Q:|Interviewer:)\s*/i, '')
      .replace(/^["']|["']$/g, '')
      .trim();

    return cleaned || 'Tell me about yourself.';
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

    const prompt = this.promptBuilder.buildPrompt(
      'simulation_summary',
      metricsSummary,
      ''
    );

    try {
      const response = await this.llmRouter.generate(
        prompt.userPrompt,
        prompt.systemPrompt
      );

      // Use output validator for structured output
      const validated = this.outputValidator.validate(
        response,
        'simulation_summary'
      );

      return {
        summary: validated.summary || 'Session completed.',
        strengths: validated.strengths || [],
        improvements: validated.improvements || [],
      };
    } catch (error) {
      console.error('Failed to generate session summary:', error);
      
      // Fallback
      return {
        summary: 'Session completed. Review the metrics to identify areas for improvement.',
        strengths: ['Good engagement', 'Clear communication', 'Professional demeanor'],
        improvements: ['Practice pacing', 'Reduce filler words', 'Increase energy'],
      };
    }
  }

  clearMetrics(): void {
    this.metrics = [];
  }

  /**
   * Get metrics trend analysis
   */
  getMetricsTrend(): { improving: boolean; details: string } {
    if (this.metrics.length < 2) {
      return { improving: true, details: 'Insufficient data for trend analysis' };
    }

    const recent = this.metrics.slice(-5);
    const first = recent[0];
    const last = recent[recent.length - 1];

    const fillersTrend = (first.fillerWords || 0) - (last.fillerWords || 0);
    const firstPacing = first.pacingWpm || 150;
    const lastPacing = last.pacingWpm || 150;
    const idealPacing = 150; // Target WPM
    const pacingTrend = Math.abs(idealPacing - lastPacing) < Math.abs(idealPacing - firstPacing);

    const improving = fillersTrend > 0 && pacingTrend;

    const details = [
      `Fillers: ${fillersTrend > 0 ? 'improving' : fillersTrend < 0 ? 'increasing' : 'stable'}`,
      `Pacing: ${pacingTrend ? 'improving' : 'needs work'} (${Math.round(firstPacing)} → ${Math.round(lastPacing)} WPM)`,
    ].join(', ');

    return {
      improving,
      details,
    };
  }
}

