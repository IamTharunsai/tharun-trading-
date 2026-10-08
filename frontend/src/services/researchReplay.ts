export interface ResearchConfig {
  startDate: string; endDate: string; initialCapital: number; symbols: string[];
  strategy: 'momentum_baseline'; lookbackBars: number; momentumThresholdPct: number;
  riskPerTrade: number; maxPositionSize: number; brokerFeesPct: number;
  slippageBps: number; stopLossPct: number; maxHoldBars: number;
}
export interface ResearchResult {
  configuration: ResearchConfig;
  finalEquity: number; cash: number; totalReturn: number; returnPct: number;
  totalFees: number; maxDrawdown: number; totalTrades: number; openPositions: number;
  winRate: number; profitFactor: number | null; sharpeRatio: null;
  equity: { timestamp: number; cash: number; holdings: number; equity: number }[];
  sampleTrades: { timestamp: string; exitTimestamp: string; signalTimestamp: string; symbol: string;
    entryPrice: number; exitPrice: number; quantity: number; pnl: number; fees: number; exitReason: string }[];
  dataCoverage: Record<string, { bars: number; firstOpen: string; lastCompleted: string }>;
  limitations: string[];
  strategy: { id: 'momentum_baseline'; councilReplay: false; parameters: Record<string, number> };
}
const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);
const object = (value: unknown): value is Record<string, any> => !!value && typeof value === 'object' && !Array.isArray(value);
const date = (value: unknown) => typeof value === 'string' && Number.isFinite(Date.parse(value));

/** Refuse legacy simulated/invalid responses rather than synthesize replacement metrics. */
export function parseResearchResponse(payload: unknown, requested: ResearchConfig): ResearchResult {
  const initialCapital = requested.initialCapital;
  const fail = () => { throw new Error('The backend returned an incompatible research result. Check the backend version and retry.'); };
  if (!object(payload) || payload.success !== true || !object(payload.results)
    || !object(payload.evaluation) || payload.evaluation.canGoLive !== false) return fail();
  const r = payload.results;
  if (!object(r.configuration) || !Array.isArray(r.configuration.symbols)
    || r.configuration.symbols.length !== requested.symbols.length
    || r.configuration.symbols.some((s: unknown, i: number) => s !== requested.symbols[i])) return fail();
  for (const key of ['startDate', 'endDate', 'initialCapital', 'strategy', 'lookbackBars', 'momentumThresholdPct',
    'riskPerTrade', 'maxPositionSize', 'brokerFeesPct', 'slippageBps', 'stopLossPct', 'maxHoldBars'] as const) {
    if (r.configuration[key] !== requested[key]) return fail();
  }
  const from = Date.parse(`${requested.startDate}T00:00:00Z`), until = Date.parse(`${requested.endDate}T00:00:00Z`) + 86400000;
  if (!Number.isFinite(from) || !Number.isFinite(until)) return fail();
  for (const key of ['finalEquity', 'cash', 'totalReturn', 'returnPct', 'totalFees', 'maxDrawdown', 'totalTrades', 'openPositions', 'winRate']) {
    if (!finite(r[key])) return fail();
  }
  if (!finite(initialCapital) || initialCapital <= 0 || r.totalFees < 0 || r.cash < -1e-7
    || r.finalEquity < 0 || r.maxDrawdown < 0 || r.maxDrawdown > 100
    || !Number.isInteger(r.totalTrades) || r.totalTrades < 0 || !Number.isInteger(r.openPositions) || r.openPositions < 0
    || r.winRate < 0 || r.winRate > 100 || r.sharpeRatio !== null
    || (r.profitFactor !== null && (!finite(r.profitFactor) || r.profitFactor < 0))) return fail();
  const tolerance = Math.max(1e-5, initialCapital * 1e-8);
  if (Math.abs(r.finalEquity - initialCapital - r.totalReturn) > tolerance
    || Math.abs(r.totalReturn / initialCapital * 100 - r.returnPct) > 1e-5) return fail();
  if (!Array.isArray(r.equity) || !r.equity.length || r.equity.length > 200000 || !Array.isArray(r.sampleTrades)
    || !Array.isArray(r.limitations) || !r.limitations.every((s: unknown) => typeof s === 'string')
    || !object(r.dataCoverage) || !object(r.strategy) || r.strategy.id !== 'momentum_baseline'
    || r.strategy.councilReplay !== false || !object(r.strategy.parameters)) return fail();
  let previous = -Infinity;
  for (const point of r.equity) {
    if (!object(point) || ![point.timestamp, point.cash, point.holdings, point.equity].every(finite)
      || point.timestamp <= previous || point.timestamp < from || point.timestamp > until
      || point.cash < -1e-7 || point.holdings < -1e-7
      || Math.abs(point.cash + point.holdings - point.equity) > tolerance) return fail();
    previous = point.timestamp;
  }
  if (Math.abs(r.equity[r.equity.length - 1].equity - r.finalEquity) > tolerance) return fail();
  const last = r.equity[r.equity.length - 1];
  if (Math.abs(last.cash - r.cash) > tolerance || r.cash > r.finalEquity + tolerance
    || (r.openPositions === 0 && last.holdings > tolerance) || (r.openPositions > 0 && last.holdings <= 0)) return fail();
  for (const trade of r.sampleTrades) {
    if (!object(trade) || !date(trade.timestamp) || !date(trade.exitTimestamp) || !date(trade.signalTimestamp)
      || Date.parse(trade.signalTimestamp) >= Date.parse(trade.timestamp) || Date.parse(trade.exitTimestamp) < Date.parse(trade.timestamp)
      || Date.parse(trade.signalTimestamp) < from || Date.parse(trade.exitTimestamp) > until
      || typeof trade.symbol !== 'string' || typeof trade.exitReason !== 'string'
      || !requested.symbols.includes(trade.symbol)
      || ![trade.entryPrice, trade.exitPrice, trade.quantity, trade.pnl, trade.fees].every(finite)
      || trade.entryPrice <= 0 || trade.exitPrice <= 0 || trade.quantity <= 0 || trade.fees < 0
      || Math.abs((trade.exitPrice - trade.entryPrice) * trade.quantity - trade.fees - trade.pnl) > tolerance) return fail();
  }
  if (r.sampleTrades.length !== Math.min(50, r.totalTrades) || !Object.keys(r.dataCoverage).length || Object.keys(r.dataCoverage).length > 10) return fail();
  if (Object.keys(r.dataCoverage).length !== requested.symbols.length
    || requested.symbols.some(s => !Object.prototype.hasOwnProperty.call(r.dataCoverage, s))) return fail();
  for (const coverage of Object.values(r.dataCoverage)) {
    if (!object(coverage) || !Number.isInteger(coverage.bars) || coverage.bars < 1
      || !date(coverage.firstOpen) || !date(coverage.lastCompleted)
      || Date.parse(coverage.firstOpen) >= Date.parse(coverage.lastCompleted)
      || Date.parse(coverage.firstOpen) < from || Date.parse(coverage.lastCompleted) > until) return fail();
  }
  for (const [key, value] of Object.entries(r.strategy.parameters)) {
    if (!Object.prototype.hasOwnProperty.call(requested, key) || requested[key as keyof ResearchConfig] !== value) return fail();
  }
  if (!Object.values(r.strategy.parameters).every(finite)) return fail();
  return r as ResearchResult;
}

export function researchSymbols(text: string): string[] {
  const symbols = text.split(/[\s,]+/).filter(Boolean).map(s => s.toUpperCase());
  if (!symbols.length || symbols.length > 10 || new Set(symbols).size !== symbols.length
    || symbols.some(s => !/^[A-Z][A-Z0-9.-]{0,14}$|^[A-Z0-9]{2,15}\/USDT$/.test(s))) {
    throw new Error('Enter 1–10 unique stock tickers or BASE/USDT crypto pairs, separated by commas. Other quote conversions are not modeled.');
  }
  return symbols;
}
