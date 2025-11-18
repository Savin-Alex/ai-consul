"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ContextManager = void 0;
class ContextManager {
    exchanges = [];
    config;
    lastSummarizationTime = Date.now();
    constructor(config) {
        this.config = config;
    }
    addExchange(exchange) {
        this.exchanges.push(exchange);
        // Check if summarization is needed
        if (this.config.summarization.enabled &&
            Date.now() - this.lastSummarizationTime >
                this.config.summarization.interval) {
            this.summarize();
        }
    }
    getContext() {
        // Get recent exchanges, respecting token limit
        const recentExchanges = this.getRecentExchanges();
        return recentExchanges
            .map((ex) => `${ex.speaker}: ${ex.text}`)
            .join('\n');
    }
    getRecentExchanges() {
        // Simple token estimation: ~4 characters per token
        const maxChars = this.config.maxTokens * 4;
        let totalChars = 0;
        const recent = [];
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
    summarize() {
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
    clearExpiredData(retentionDays = 7) {
        const cutoff = Date.now() - retentionDays * 24 * 60 * 60 * 1000;
        this.exchanges = this.exchanges.filter((ex) => ex.timestamp > cutoff);
    }
    getAllExchanges() {
        return [...this.exchanges];
    }
    clear() {
        this.exchanges = [];
        this.lastSummarizationTime = Date.now();
    }
}
exports.ContextManager = ContextManager;
