interface ConversationExchange {
  speaker: 'user' | 'other' | 'system';
  text: string;
  timestamp: number;
}

interface ContextManagerConfig {
  maxTokens: number;
  summarization: {
    enabled: boolean;
    interval: number; // milliseconds
  };
}

export class ContextManager {
  private exchanges: ConversationExchange[] = [];
  private config: ContextManagerConfig;
  private lastSummarizationTime: number = Date.now();

  constructor(config: ContextManagerConfig) {
    this.config = config;
  }

  addExchange(exchange: ConversationExchange): void {
    this.exchanges.push(exchange);

    // Check if summarization is needed
    if (
      this.config.summarization.enabled &&
      Date.now() - this.lastSummarizationTime >
        this.config.summarization.interval
    ) {
      this.summarize();
    }
  }

  getContext(): string {
    // Get recent exchanges, respecting token limit
    const recentExchanges = this.getRecentExchanges();
    return recentExchanges
      .map((ex) => `${ex.speaker}: ${ex.text}`)
      .join('\n');
  }

  private getRecentExchanges(): ConversationExchange[] {
    // Simple token estimation: ~4 characters per token
    const maxChars = this.config.maxTokens * 4;
    let totalChars = 0;
    const recent: ConversationExchange[] = [];

    // Start from most recent and work backwards
    for (let i = this.exchanges.length - 1; i >= 0; i--) {
      const exchange = this.exchanges[i];
      const exchangeChars = exchange.text.length;

      if (totalChars + exchangeChars > maxChars) {
        break;
      }

      recent.unshift(exchange);
      totalChars += exchangeChars;
    }

    return recent;
  }

  private summarize(): void {
    // Simple summarization: keep first and last N exchanges, summarize middle
    if (this.exchanges.length < 10) {
      return; // Not enough to summarize
    }

    const keepCount = 5;
    const recent = this.exchanges.slice(-keepCount);
    const old = this.exchanges.slice(0, -keepCount);

    // Create summary of old exchanges
    const summaryText = old
      .map((ex) => `${ex.speaker}: ${ex.text}`)
      .join('; ');

    // Replace old exchanges with summary
    this.exchanges = [
      {
        speaker: 'system',
        text: `[Summary of earlier conversation: ${summaryText.substring(0, 500)}]`,
        timestamp: Date.now(),
      },
      ...recent,
    ];

    this.lastSummarizationTime = Date.now();
  }

  clearExpiredData(retentionDays: number = 7): void {
    const cutoff = Date.now() - retentionDays * 24 * 60 * 60 * 1000;
    this.exchanges = this.exchanges.filter(
      (ex) => ex.timestamp > cutoff
    );
  }

  getAllExchanges(): ConversationExchange[] {
    return [...this.exchanges];
  }

  clear(): void {
    this.exchanges = [];
    this.lastSummarizationTime = Date.now();
  }
}

