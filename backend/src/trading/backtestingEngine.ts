/** Dated OHLC research replay. Never impersonates specialist council inference. */
import { z } from 'zod';
import { fetchHistoricalBars, historicalRange, HistoricalBar } from './historicalBars';
import { replayLedger } from './replayLedger';

export const backtestConfigSchema = z.object({
  startDate: z.string(), endDate: z.string(),
  initialCapital: z.number().finite().positive().max(1e10),
  symbols: z.array(z.string().regex(/^[A-Z][A-Z0-9.-]{0,14}$|^[A-Z0-9]{2,15}\/USDT$/)).min(1).max(10)
    .refine(symbols => new Set(symbols).size === symbols.length, 'Symbols must be unique'),
  strategy: z.literal('momentum_baseline').default('momentum_baseline'),
  lookbackBars: z.number().int().min(2).max(3000).default(20),
  momentumThresholdPct: z.number().finite().min(0).max(100).default(1),
  riskPerTrade: z.number().finite().positive().max(100).default(1),
  maxPositionSize: z.number().finite().positive().max(100).default(10),
  brokerFeesPct: z.number().finite().min(0).max(10).default(0.1),
  slippageBps: z.number().finite().min(0).max(1000).default(3),
  stopLossPct: z.number().finite().positive().lt(100).default(3),
  maxHoldBars: z.number().int().min(1).max(3000).default(4),
}).strict();
export type BacktestConfig = z.input<typeof backtestConfigSchema>;
export interface TradeRecord {
  timestamp: string; exitTimestamp: string; signalTimestamp: string; symbol: string;
  direction: 'BUY'; entryPrice: number; exitPrice: number; quantity: number;
  pnl: number; pnlPct: number; fees: number; holding_hours: number; exitReason: string;
  confidence: null; agents: never[]; regime: 'UNCLASSIFIED';
}
export interface BacktestResults {
  configuration: z.output<typeof backtestConfigSchema>;
  totalTrades: number; totalTradess: number; winningTrades: number; losingTrades: number;
  winRate: number; profitFactor: number | null; sharpeRatio: null; maxDrawdown: number;
  totalReturn: number; returnPct: number; finalEquity: number; cash: number; openPositions: number;
  totalFees: number; avgWin: number; avgLoss: number; avgTradeSize: number;
  largestWin: number; largestLoss: number; holdingTimeAvg: number; riskFreeRate: null;
  agentAccuracy: Record<string, never>; regimePerformance: Record<string, never>;
  sampleTrades: TradeRecord[]; equity: ReturnType<typeof replayLedger>['equity'];
  strategy: { id: string; parameters: Record<string, number>; councilReplay: false };
  dataCoverage: Record<string, { bars: number; firstOpen: string; lastCompleted: string }>;
  limitations: string[];
}

export async function runBacktest(input: BacktestConfig): Promise<BacktestResults> {
  const config = backtestConfigSchema.parse(input);
  historicalRange(config.startDate, config.endDate);
  const data: Record<string, HistoricalBar[]> = {};
  for (const symbol of config.symbols) {
    try { data[symbol] = await fetchHistoricalBars(symbol, config.startDate, config.endDate); }
    catch { throw new Error(`Historical data unavailable for ${symbol}`); }
  }
  const replay = replayLedger(data, {
    initialCapital: config.initialCapital, feePct: config.brokerFeesPct, slippageBps: config.slippageBps,
    riskPct: config.riskPerTrade, maxPositionPct: config.maxPositionSize,
    stopLossPct: config.stopLossPct, maxHoldBars: config.maxHoldBars,
  }, (_symbol, history) => {
    if (history.length <= config.lookbackBars) return false;
    const first = history[history.length - 1 - config.lookbackBars].close;
    return (history[history.length - 1].close / first - 1) * 100 > config.momentumThresholdPct;
  });
  const trades: TradeRecord[] = replay.trades.map(t => ({
    timestamp: new Date(t.enteredAt).toISOString(), exitTimestamp: new Date(t.exitedAt).toISOString(),
    signalTimestamp: new Date(t.signalAt).toISOString(), symbol: t.symbol, direction: 'BUY',
    entryPrice: t.entryPrice, exitPrice: t.exitPrice, quantity: t.quantity, pnl: t.pnl,
    pnlPct: t.pnl / (t.entryPrice * t.quantity) * 100, fees: t.fees,
    holding_hours: (t.exitedAt - t.enteredAt) / 3600000, exitReason: t.exitReason,
    confidence: null, agents: [], regime: 'UNCLASSIFIED',
  }));
  const wins = trades.filter(t => t.pnl > 0), losses = trades.filter(t => t.pnl < 0);
  const grossWins = wins.reduce((sum, t) => sum + t.pnl, 0), grossLosses = -losses.reduce((sum, t) => sum + t.pnl, 0);
  const totalReturn = replay.finalEquity - config.initialCapital;
  return {
    configuration: config,
    totalTrades: trades.length, totalTradess: trades.length, winningTrades: wins.length, losingTrades: losses.length,
    winRate: trades.length ? wins.length / trades.length * 100 : 0,
    profitFactor: grossLosses ? grossWins / grossLosses : null, sharpeRatio: null,
    maxDrawdown: replay.maxDrawdown, totalReturn, returnPct: totalReturn / config.initialCapital * 100,
    finalEquity: replay.finalEquity, cash: replay.cash, openPositions: replay.openPositions, totalFees: replay.totalFees,
    avgWin: wins.length ? grossWins / wins.length : 0, avgLoss: losses.length ? grossLosses / losses.length : 0,
    avgTradeSize: trades.length ? trades.reduce((sum, t) => sum + t.quantity * t.entryPrice, 0) / trades.length : 0,
    largestWin: Math.max(0, ...trades.map(t => t.pnl)), largestLoss: Math.min(0, ...trades.map(t => t.pnl)),
    holdingTimeAvg: trades.length ? trades.reduce((sum, t) => sum + t.holding_hours, 0) / trades.length : 0,
    riskFreeRate: null, agentAccuracy: {}, regimePerformance: {}, sampleTrades: trades.slice(0, 50), equity: replay.equity,
    strategy: { id: config.strategy, councilReplay: false, parameters: { lookbackBars: config.lookbackBars,
      momentumThresholdPct: config.momentumThresholdPct, stopLossPct: config.stopLossPct, maxHoldBars: config.maxHoldBars,
      riskPerTrade: config.riskPerTrade, maxPositionSize: config.maxPositionSize,
      brokerFeesPct: config.brokerFeesPct, slippageBps: config.slippageBps } },
    dataCoverage: Object.fromEntries(Object.entries(data).map(([s, bars]) => [s, { bars: bars.length,
      firstOpen: new Date(bars[0].openTime).toISOString(), lastCompleted: new Date(bars[bars.length - 1].timestamp).toISOString() }])),
    limitations: ['UNQUALIFIED_RESEARCH', 'Momentum baseline, not specialist council replay or established economic edge',
      'Stock USD and crypto USDT share nominal dollar accounting units; conversion and stablecoin peg risk are not modeled',
      'Long-only fractional research quantities; venue precision and liquidity unverified',
      'One full bar delay before entry; hourly OHLC stop/terminal-close assumptions, not verified venue fills',
      'Simultaneous allocations use lexical symbol priority; opening-print liquidity is assumed, not measured',
      'Drawdown uses observed event valuations, not a verified intra-hour equity path; gaps can exceed planned stop risk',
      'Configured fees/slippage; historical financing, dividends, service costs and corporate-action ledger incomplete',
      'Universe survivorship, missing bars, market calendar, stale marks and actual provider coverage unverified',
      'Sharpe, statistical trial correction, walk-forward and untouched holdout qualification unavailable'],
  };
}

export function evaluateBacktestResults(_results: BacktestResults) {
  return { canGoLive: false, issues: [
    'UNQUALIFIED_SIMULATION: live qualification requires independent data, execution, costs, trial-count/statistical correction, walk-forward and health evidence',
  ] };
}
