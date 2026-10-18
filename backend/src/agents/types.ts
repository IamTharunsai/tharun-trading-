// ── AGENT TYPES ───────────────────────────────────────────────────────────────

export type VoteDirection = 'BUY' | 'SELL' | 'HOLD';
export type Market = 'crypto' | 'stocks' | 'forex';

export interface MarketSnapshot {
  asset: string;
  market: Market;
  price: number;
  priceChange24h: number;
  priceChangePct24h: number;
  volume24h: number;
  volumeChange: number | null;
  high24h: number;
  low24h: number;
  marketCap?: number;
  // Provider candle periods; consult dataEvidence for the stock timeframe/window.
  candles: Candle[];
  // Technical indicators
  indicators: TechnicalIndicators;
  // Order book snapshot
  bidPrice: number;
  askPrice: number;
  spread: number;
  timestamp: number;
  dataEvidence?: { source: string; timeframe: '1Day'; priceObservedAt: number; quoteObservedAt: number;
    receivedAt: number; historyFirstPeriodAt: number; historyLastPeriodAt: number; completedBars: number;
    changeWindow: 'latest_trade_vs_previous_daily_close'; volumeWindow: 'provider_daily_bar' };
}

export interface Candle {
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  timestamp: number;
}

export interface TechnicalIndicators {
  rsi14: number;
  macd: { value: number; signal: number; histogram: number };
  bollingerBands: { upper: number; middle: number; lower: number };
  ema9: number;
  ema21: number;
  ema200: number;
  sma50: number;
  sma200: number;
  atr14: number;
  obv: number;
  stochasticK: number;
  stochasticD: number;
  volumeAvg20: number;
  vwap: number;
  fibonacci: { r236: number; r382: number; r500: number; r618: number; r786: number };
  week52High: number;
  week52Low: number;
  distanceFrom52wHigh: number;
  isAboveSma50: boolean;
  isAboveSma200: boolean;
  isSma50AboveSma200: boolean;  // golden cross
  volumeRatio: number;          // today vol / 20d avg vol
}

export interface AgentVote {
  agentId: string | number;
  agentName: string;
  vote: VoteDirection;
  confidence: number; // 0-100
  reasoning: string;
  keyFactors: string[];
  riskWarnings: string[];
  executionTime: number; // ms
  timestamp: number;
  // Optional fields for specialized agents
  waveCount?: number;
  putCallRatio?: number;
  market?: string;
  exchange1?: string;
  exchange2?: string;
  spread?: number;
  strategyAllocation?: Record<string, number>;
  [key: string]: any; // Allow other custom fields
}

export interface VotingResult {
  asset: string;
  finalDecision: VoteDirection;
  goVotes: number;
  noGoVotes: number;
  avgConfidence: number;
  shouldExecute: boolean;
  blockReason?: string;
  agentVotes: AgentVote[];
  timestamp: number;
}

export interface TradeSignal {
  asset: string;
  market: Market;
  direction: VoteDirection;
  confidence: number; // percentage, 0-100; never a fraction
  entryPrice: number;
  stopLossPrice: number;
  takeProfitPrice: number;
  positionSizePct: number;
  reasoning: string;
  agentDecisionId: string;
  voteCounts?: { supporting: number; opposing: number; abstaining: number };
}

export interface PortfolioState {
  accountId?: string;
  brokerMode?: 'paper' | 'live';
  buyingPower?: number;
  riskDataComplete?: boolean;
  capitalRisk?: import('../services/cashFlowRisk').CashFlowRiskMetrics;
  accountingComplete?: boolean;
  historyDataComplete?: boolean;
  totalValue: number;
  cashBalance: number;
  invested: number;
  pnlDay: number | null;
  pnlDayPct: number | null;
  pnlWeekPct: number | null;
  pnlTotal: number;
  positions: any[];
  dailyLossToday: number | null;
  tradesExecutedToday: number;
  drawdownFromPeak: number | null;
}
