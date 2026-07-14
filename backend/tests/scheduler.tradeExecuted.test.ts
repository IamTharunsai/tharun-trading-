// Regression test for a live production bug: the market-open/mid-day/crypto
// scan loops decided "trade found, stop scanning" based on the debate
// engine's `executionApproved` (set when the committee wants to trade,
// BEFORE risk validation or the broker call). A trade blocked by Top Trader
// Rules or rejected by the broker still left `executionApproved: true`, so
// the scanner gave up on the rest of its candidate batch even though nothing
// actually executed — confirmed live on 2026-07-14 (BTC blocked by Top
// Trader Rules, TCBK rejected by Alpaca with a 422, both logged "✅ Trade
// executed" and stopped their scan). `runDebateForAsset` must set
// `transcript.tradeExecuted` from executeTradeSignal's real return value.

jest.mock('../src/services/marketData', () => ({
  buildMarketSnapshot: jest.fn().mockResolvedValue({
    price: 100,
    priceChangePct24h: 0,
    volume24h: 1000,
    indicators: {
      bollingerBands: { upper: 110, middle: 100, lower: 90 },
      rsi14: 50, macd: { histogram: 0 }, ema9: 100, ema21: 100, ema200: 100,
      volumeAvg20: 1000, atr14: 1,
    },
  }),
  CRYPTO_ASSETS: ['BTC'],
  getCurrentPrices: jest.fn(() => ({})),
  getNextStockBatch: jest.fn(),
  getTotalStockCount: jest.fn(),
  refreshOpenPositionStockPrices: jest.fn(),
}));
jest.mock('../src/services/deepAnalysisService', () => ({ refreshFundamentalsForSymbol: jest.fn() }));
jest.mock('../src/services/stockScreener', () => ({ runDailyScreen: jest.fn() }));
jest.mock('../src/services/regimeDetector', () => ({
  detectMarketRegime: jest.fn().mockResolvedValue({ regime: 'TRENDING_BULL' }),
}));
jest.mock('../src/services/selfLearning', () => ({ runPostTradeAnalysis: jest.fn(), generateWeeklyReport: jest.fn() }));
jest.mock('../src/services/portfolio', () => ({
  getPortfolioState: jest.fn().mockResolvedValue({ totalValue: 100000, pnlDayPct: 0 }),
}));
jest.mock('../src/services/journalGenerator', () => ({ generateDailyJournal: jest.fn() }));
jest.mock('../src/agents/orchestrator', () => ({ isKillSwitchActive: jest.fn(() => false) }));
jest.mock('../src/services/polymarket', () => ({ scanPolymarketOpportunities: jest.fn(), placePolymarketBet: jest.fn() }));
jest.mock('../src/utils/prisma', () => ({
  prisma: {
    position: { findFirst: jest.fn().mockResolvedValue(null) },
    agentDecision: { findFirst: jest.fn().mockResolvedValue({ id: 'decision-1' }) },
  },
}));
jest.mock('../src/trading/riskManager', () => ({
  validateTradeSignal: jest.fn().mockResolvedValue({ approved: true }),
  checkStopLosses: jest.fn(),
}));

const baseTranscript = {
  round1: [], round2: [], round3: [],
  masterSynthesis: 'test',
  finalDecision: 'BUY' as const,
  finalConfidence: 80,
  executionApproved: true,
  positionSizePct: 1,
  stopLossPrice: 95,
  takeProfitPrice: 110,
};

jest.mock('../src/agents/debateEngine', () => ({
  runInvestmentCommitteeDebate: jest.fn().mockResolvedValue({ ...baseTranscript }),
}));
jest.mock('../src/trading/executionEngine', () => ({ executeTradeSignal: jest.fn() }));

import { executeTradeSignal } from '../src/trading/executionEngine';
import { runDebateForAsset } from '../src/jobs/scheduler';

describe('runDebateForAsset — tradeExecuted reflects the real execution outcome', () => {
  it('sets tradeExecuted true when executeTradeSignal actually places the order', async () => {
    (executeTradeSignal as jest.Mock).mockResolvedValue(true);
    const transcript = await runDebateForAsset('AAPL', 'stocks');
    expect(transcript?.tradeExecuted).toBe(true);
  });

  it('sets tradeExecuted false when executeTradeSignal is blocked/rejected, even though the debate approved', async () => {
    (executeTradeSignal as jest.Mock).mockResolvedValue(false);
    const transcript = await runDebateForAsset('TCBK', 'stocks');
    expect(transcript?.executionApproved).toBe(true);
    expect(transcript?.tradeExecuted).toBe(false);
  });
});
