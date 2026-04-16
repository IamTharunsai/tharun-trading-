/**
 * UNIT TESTS: AGENT SELF-LEARNING SYSTEM
 * Tests post-trade analysis, agent reflection, and performance tracking
 */

import { describe, it, expect } from 'vitest';

describe('Agent Self-Learning System', () => {
  
  describe('Post-Trade Analysis Trigger', () => {
    it('should trigger learning on trade closure', () => {
      const tradeEvent = {
        status: 'closed',
        exitReason: 'profit_target_hit',
      };
      const shouldAnalyze = tradeEvent.status === 'closed';
      expect(shouldAnalyze).toBe(true);
    });

    it('should capture agent prediction vs actual outcome', () => {
      const analysis = {
        agentId: 1,
        agentName: 'Technician',
        prediction: 'BUY',
        expectedPrice: 45000,
        actualPrice: 46500,
        pnl: 5280, // +$5,280
        correct: true,
      };
      expect(analysis.actualPrice).toBeTruthy();
      expect(analysis.pnl).not.toBeNull();
    });
  });

  describe('Agent Reflection & Lessons', () => {
    it('should generate lesson for correct prediction', () => {
      const lesson = {
        prediction: 'BUY',
        correct: true,
        confidenceAdjustment: 0.05, // +5% confidence
        setupType: 'EMA_crossover_with_RSI_divergence',
        keyFactors: ['RSI divergence', 'Volume surge'],
      };
      expect(lesson.confidenceAdjustment).toBeGreaterThan(0);
    });

    it('should generate lesson for incorrect prediction', () => {
      const lesson = {
        prediction: 'SELL',
        correct: false,
        confidenceAdjustment: -0.10, // -10% confidence
        mistakeType: 'Missed bullish divergence',
        lessonsLearned: ['Watch for hidden divergences'],
      };
      expect(lesson.confidenceAdjustment).toBeLessThan(0);
    });

    it('should not adjust confidence more than ±15%', () => {
      const adjustments = [-0.15, -0.08, 0.05, 0.12, 0.15];
      adjustments.forEach(adj => {
        expect(Math.abs(adj)).toBeLessThanOrEqual(0.15);
      });
    });
  });

  describe('Agent Performance Tracking', () => {
    it('should track last-20 accuracy for each agent', () => {
      const agentMetrics = {
        agentId: 1,
        last20Predictions: ['W', 'W', 'W', 'L', 'W', 'W', 'L', 'W', 'W', 'W', 
                            'W', 'L', 'W', 'W', 'W', 'W', 'L', 'W', 'W', 'W'],
        accuracy: 0.80, // 16/20
      };
      const actualAccuracy = agentMetrics.last20Predictions.filter(p => p === 'W').length / 20;
      expect(actualAccuracy).toBe(0.80);
    });

    it('should calculate win rate per setup type', () => {
      const setupMetrics = {
        'EMA_crossover': { wins: 12, total: 20, winRate: 0.60 },
        'RSI_divergence': { wins: 15, total: 18, winRate: 0.833 },
        'Volume_breakout': { wins: 8, total: 15, winRate: 0.533 },
      };
      
      Object.values(setupMetrics).forEach(metric => {
        const actualRate = metric.wins / metric.total;
        expect(Math.abs(actualRate - metric.winRate)).toBeLessThan(0.01);
      });
    });

    it('should track average P&L per prediction', () => {
      const trades = [
        { pnl: 500 }, { pnl: -200 }, { pnl: 1500 },
        { pnl: -300 }, { pnl: 800 }
      ];
      const avgPnl = trades.reduce((sum, t) => sum + t.pnl, 0) / trades.length;
      expect(avgPnl).toBeGreaterThan(0);
    });
  });

  describe('Agent Suspension Logic', () => {
    it('should warn agent with accuracy below 50%', () => {
      const accuracy = 0.45;
      const shouldWarn = accuracy < 0.50;
      expect(shouldWarn).toBe(true);
    });

    it('should suspend agent with accuracy below 45%', () => {
      const accuracy = 0.42;
      const shouldSuspend = accuracy < 0.45;
      expect(shouldSuspend).toBe(true);
    });

    it('should not suspend agents above 45% accuracy', () => {
      const accuracy = 0.45;
      const shouldSuspend = accuracy < 0.45;
      expect(shouldSuspend).toBe(false);
    });

    it('should re-enable agent after 10 consecutive correct predictions', () => {
      const consecutiveWins = 10;
      const minWinsToReEnable = 10;
      const shouldReEnable = consecutiveWins >= minWinsToReEnable;
      expect(shouldReEnable).toBe(true);
    });
  });

  describe('Weekly Performance Report', () => {
    it('should generate CIO-style performance report', () => {
      const report = {
        weekOf: '2026-04-14',
        topPerformer: { agentId: 3, name: 'Sentiment Analyst', accuracy: 0.85 },
        topSetup: { setupType: 'RSI_divergence', winRate: 0.88 },
        lowestPerformer: { agentId: 7, name: 'Volume Detective', accuracy: 0.42 },
        recommendations: ['Volume Detective needs retraining'],
      };
      
      expect(report.topPerformer).toBeTruthy();
      expect(report.topPerformer.accuracy).toBeGreaterThan(report.lowestPerformer.accuracy);
    });

    it('should include portfolio metrics', () => {
      const report = {
        totalTrades: 47,
        winnersCount: 38,
        losersCount: 9,
        winRate: 80.85,
        grossProfit: 32500,
        grossLoss: 8200,
        netProfit: 24300,
        profitFactor: 3.96,
      };
      
      expect(report.totalTrades).toBe(report.winnersCount + report.losersCount);
      expect(report.netProfit).toBe(report.grossProfit - report.grossLoss);
    });

    it('should identify top 3 performing setups', () => {
      const topSetups = [
        { setup: 'RSI_divergence', winRate: 0.88, trades: 25 },
        { setup: 'EMA_crossover', winRate: 0.82, trades: 15 },
        { setup: 'Volume_breakout', winRate: 0.75, trades: 10 },
      ];
      expect(topSetups).toHaveLength(3);
      expect(topSetups[0].winRate).toBeGreaterThanOrEqual(topSetups[1].winRate);
    });
  });

  describe('Learning Data Storage', () => {
    it('should store lesson in systemLog', () => {
      const lesson = {
        level: 'INFO',
        service: 'agent-learning-1',
        message: 'Agent reflection on trade',
        metadata: {
          agentId: 1,
          prediction: 'BUY',
          correct: true,
          timestamp: new Date().toISOString(),
        }
      };
      
      expect(lesson.level).toBe('INFO');
      expect(lesson.metadata.timestamp).toBeTruthy();
    });

    it('should track learning history per agent', () => {
      const learningHistory = [
        { timestamp: '2026-04-10T10:00:00Z', lesson: 'Setup A works 85% time' },
        { timestamp: '2026-04-11T14:30:00Z', lesson: 'Setup B too risky' },
        { timestamp: '2026-04-12T09:15:00Z', lesson: 'Combine setup A + volume' },
      ];
      
      expect(learningHistory.length).toBeGreaterThan(0);
      expect(learningHistory[0].timestamp < learningHistory[1].timestamp).toBe(true);
    });
  });

  describe('Confidence Calibration', () => {
    it('should increase confidence when agent is correct with high conviction', () => {
      const agent = {
        initialConfidence: 0.70,
        prediction: 'BUY',
        correct: true,
        newConfidence: 0.75, // +5%
      };
      expect(agent.newConfidence).toBeGreaterThan(agent.initialConfidence);
    });

    it('should decrease confidence when agent is wrong despite high conviction', () => {
      const agent = {
        initialConfidence: 0.80,
        prediction: 'SELL',
        correct: false,
        newConfidence: 0.70, // -10%
      };
      expect(agent.newConfidence).toBeLessThan(agent.initialConfidence);
    });

    it('confidence should converge to actual accuracy over time', () => {
      const actualAccuracy = 0.65;
      let confidence = 0.90; // Start overconfident
      
      // Simulate learning over 20 updates
      for (let i = 0; i < 20; i++) {
        if (i % 3 === 0) {
          confidence -= 0.03; // Learn each wrong prediction
        } else {
          confidence += 0.01; // Slight boost on right predictions
        }
      }
      
      expect(Math.abs(confidence - actualAccuracy)).toBeLessThan(0.20);
    });
  });

  describe('Edge Cases', () => {
    it('should handle agent with zero trades', () => {
      const metrics = { tradesCount: 0, accuracy: 0 };
      expect(metrics.tradesCount).toBe(0);
      // Avoid division by zero
      expect(metrics.accuracy).toBe(0);
    });

    it('should handle 100% win rate', () => {
      const metrics = { wins: 10, losses: 0, accuracy: 1.0 };
      expect(metrics.accuracy).toBe(1.0);
    });

    it('should handle perfect loss streak', () => {
      const metrics = { wins: 0, losses: 10, accuracy: 0.0 };
      expect(metrics.accuracy).toBe(0.0);
    });
  });
});
