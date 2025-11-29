import { CircularBuffer } from './circular-buffer';

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
  maxExchanges?: number; // Maximum number of exchanges to keep in memory
}

interface CompressedSummary {
  text: string;
  originalCount: number;
  timestamp: number;
}

export class ContextManager {
  private exchanges: CircularBuffer<ConversationExchange>;
  private config: ContextManagerConfig;
  private lastSummarizationTime: number = Date.now();
  private summaryCache: CompressedSummary | null = null;
  private readonly MAX_EXCHANGES: number;

  constructor(config: ContextManagerConfig) {
    this.config = config;
    // Use circular buffer with reasonable default (1000 exchanges)
    // This prevents unbounded memory growth
    this.MAX_EXCHANGES = config.maxExchanges || 1000;
    this.exchanges = new CircularBuffer<ConversationExchange>(this.MAX_EXCHANGES);
  }

  addExchange(exchange: ConversationExchange): void {
    // Add to circular buffer (automatically handles overflow)
    this.exchanges.push(exchange);

    // Invalidate summary cache when new exchange is added
    this.summaryCache = null;

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
    
    // Build context string
    const contextParts: string[] = [];
    
    // Add cached summary if available and relevant
    if (this.summaryCache) {
      contextParts.push(this.summaryCache.text);
    }
    
    // Add recent exchanges
    const recentText = recentExchanges
      .map((ex) => `${ex.speaker}: ${ex.text}`)
      .join('\n');
    
    if (recentText) {
      contextParts.push(recentText);
    }
    
    return contextParts.join('\n\n');
  }

  private getRecentExchanges(): ConversationExchange[] {
    // Simple token estimation: ~4 characters per token
    const maxChars = this.config.maxTokens * 4;
    let totalChars = 0;
    const recent: ConversationExchange[] = [];

    // Get all exchanges (newest to oldest from circular buffer)
    const allExchanges = this.exchanges.toArrayReversed();

    // Start from most recent and work backwards
    for (const exchange of allExchanges) {
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
    const allExchanges = this.exchanges.toArray();
    
    // Simple summarization: keep first and last N exchanges, summarize middle
    if (allExchanges.length < 10) {
      return; // Not enough to summarize
    }

    const keepCount = 5;
    const recent = allExchanges.slice(-keepCount);
    const old = allExchanges.slice(0, -keepCount);

    // Create summary of old exchanges
    const summaryText = old
      .map((ex) => `${ex.speaker}: ${ex.text}`)
      .join('; ');

    // Compress summary (limit to 500 chars)
    const compressedSummary: CompressedSummary = {
      text: `[Summary of earlier conversation (${old.length} exchanges): ${summaryText.substring(0, 500)}]`,
      originalCount: old.length,
      timestamp: Date.now()
    };

    // Cache the summary
    this.summaryCache = compressedSummary;

    // Remove old exchanges and add summary as system message
    // Note: We can't directly remove from circular buffer, so we rebuild it
    const newExchanges = new CircularBuffer<ConversationExchange>(this.MAX_EXCHANGES);
    
    // Add summary as system exchange
    newExchanges.push({
      speaker: 'system',
      text: compressedSummary.text,
      timestamp: Date.now(),
    });
    
    // Add recent exchanges
    for (const exchange of recent) {
      newExchanges.push(exchange);
    }
    
    // Replace buffer
    this.exchanges = newExchanges;

    this.lastSummarizationTime = Date.now();
  }

  clearExpiredData(retentionDays: number = 7): void {
    const cutoff = Date.now() - retentionDays * 24 * 60 * 60 * 1000;
    const allExchanges = this.exchanges.toArray();
    const validExchanges = allExchanges.filter(
      (ex) => ex.timestamp > cutoff
    );

    // Rebuild buffer with only valid exchanges
    const newExchanges = new CircularBuffer<ConversationExchange>(this.MAX_EXCHANGES);
    for (const exchange of validExchanges) {
      newExchanges.push(exchange);
    }
    this.exchanges = newExchanges;
    
    // Clear summary cache if it's expired
    if (this.summaryCache && this.summaryCache.timestamp < cutoff) {
      this.summaryCache = null;
    }
  }

  getAllExchanges(): ConversationExchange[] {
    return this.exchanges.toArray();
  }

  clear(): void {
    this.exchanges.clear();
    this.summaryCache = null;
    this.lastSummarizationTime = Date.now();
  }

  /**
   * Get memory usage statistics
   */
  getMemoryStats(): {
    exchangeCount: number;
    maxCapacity: number;
    hasSummaryCache: boolean;
  } {
    return {
      exchangeCount: this.exchanges.getSize(),
      maxCapacity: this.exchanges.getCapacity(),
      hasSummaryCache: this.summaryCache !== null
    };
  }
}

