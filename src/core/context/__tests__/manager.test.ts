import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ContextManager } from '../manager';

describe('ContextManager', () => {
  let manager: ContextManager;

  beforeEach(() => {
    manager = new ContextManager({
      maxTokens: 4000,
      summarization: {
        enabled: true,
        interval: 300000,
      },
    });
  });

  describe('addExchange', () => {
    it('should add conversation exchange', () => {
      manager.addExchange({
        speaker: 'user',
        text: 'Hello, how are you?',
        timestamp: Date.now(),
      });

      const context = manager.getContext();
      expect(context).toContain('user: Hello, how are you?');
    });

    it('should add multiple exchanges', () => {
      manager.addExchange({
        speaker: 'user',
        text: 'First message',
        timestamp: Date.now(),
      });

      manager.addExchange({
        speaker: 'other',
        text: 'Second message',
        timestamp: Date.now(),
      });

      const context = manager.getContext();
      expect(context).toContain('user: First message');
      expect(context).toContain('other: Second message');
    });
  });

  describe('getContext', () => {
    it('should return formatted context', () => {
      manager.addExchange({
        speaker: 'user',
        text: 'Test message',
        timestamp: Date.now(),
      });

      const context = manager.getContext();
      expect(context).toBe('user: Test message');
    });

    it('should respect maxTokens limit', () => {
      // Add many exchanges
      for (let i = 0; i < 100; i++) {
        manager.addExchange({
          speaker: 'user',
          text: 'This is a very long message that takes up many tokens ' + i,
          timestamp: Date.now(),
        });
      }

      const context = manager.getContext();
      const contextLength = context.length;
      const maxChars = 4000 * 4; // Rough token estimation

      expect(contextLength).toBeLessThanOrEqual(maxChars);
    });

    it('should return most recent exchanges first', () => {
      manager.addExchange({
        speaker: 'user',
        text: 'First',
        timestamp: Date.now() - 1000,
      });

      manager.addExchange({
        speaker: 'user',
        text: 'Second',
        timestamp: Date.now(),
      });

      const context = manager.getContext();
      const lastIndex = context.lastIndexOf('Second');
      const firstIndex = context.indexOf('First');

      expect(lastIndex).toBeGreaterThan(firstIndex);
    });
  });

  describe('clearExpiredData', () => {
    it('should clear expired exchanges', () => {
      const oldTimestamp = Date.now() - 8 * 24 * 60 * 60 * 1000; // 8 days ago
      const recentTimestamp = Date.now();

      manager.addExchange({
        speaker: 'user',
        text: 'Old message',
        timestamp: oldTimestamp,
      });

      manager.addExchange({
        speaker: 'user',
        text: 'Recent message',
        timestamp: recentTimestamp,
      });

      manager.clearExpiredData(7); // 7 day retention

      const context = manager.getContext();
      expect(context).not.toContain('Old message');
      expect(context).toContain('Recent message');
    });
  });

  describe('clear', () => {
    it('should clear all exchanges', () => {
      manager.addExchange({
        speaker: 'user',
        text: 'Test message',
        timestamp: Date.now(),
      });

      manager.clear();

      const context = manager.getContext();
      expect(context).toBe('');
    });
  });
});

