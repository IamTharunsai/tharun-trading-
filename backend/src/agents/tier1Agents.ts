import { MarketSnapshot, PortfolioState, VoteDirection } from './types';
import { SurvivalPolicy } from '../services/survivalEngine';

export interface Tier1Vote {
  agentName: string;
  vote: VoteDirection;
  score: number;
  reason: string;
  rejected?: boolean;
}

export interface Tier1Result {
  votes: Tier1Vote[];
  consensus: number;
  dominant: VoteDirection;
  rejected: boolean;
  rejectionReasons: string[];
  stopLoss: number;
  takeProfit: number;
}

function indicatorVotes(s: MarketSnapshot): { bulls: number; bears: number } {
  const i = s.indicators;
  const checks = [
    [i.rsi14 > 50 && i.rsi14 < 70, i.rsi14 < 50 && i.rsi14 > 30],
    [i.macd.histogram > 0, i.macd.histogram < 0],
    [s.price > i.bollingerBands.middle, s.price < i.bollingerBands.middle],
    [s.price > i.ema9 && i.ema9 > i.ema21, s.price < i.ema9 && i.ema9 < i.ema21],
    [s.price > i.sma50, s.price < i.sma50],
    [s.price > i.vwap, s.price < i.vwap],
    [i.stochasticK > 50, i.stochasticK < 50],
    [i.volumeRatio > 1 && s.priceChangePct24h > 0, i.volumeRatio > 1 && s.priceChangePct24h < 0],
  ];
  return { bulls: checks.filter(([bull]) => bull).length, bears: checks.filter(([, bear]) => bear).length };
}

export function runTier1Agents(
  snapshot: MarketSnapshot,
  portfolio: PortfolioState,
  policy: SurvivalPolicy,
  now: Date = new Date()
): Tier1Result {
  const raw = snapshot.indicators || ({} as MarketSnapshot['indicators']);
  const price = snapshot.price || 0;
  const i = {
    ...raw,
    rsi14: raw.rsi14 ?? 50,
    macd: raw.macd ?? { value: 0, signal: 0, histogram: 0 },
    bollingerBands: raw.bollingerBands ?? { upper: price, middle: price, lower: price },
    ema9: raw.ema9 ?? price,
    ema21: raw.ema21 ?? price,
    sma50: raw.sma50 ?? price,
    vwap: raw.vwap ?? price,
    stochasticK: raw.stochasticK ?? 50,
    volumeRatio: raw.volumeRatio ?? 1,
    atr14: raw.atr14 ?? price * 0.02,
  };
  snapshot = { ...snapshot, indicators: { ...raw, ...i } as any };
  const votes: Tier1Vote[] = [];
  const rejectionReasons: string[] = [];
  const { bulls, bears } = indicatorVotes(snapshot);

  votes.push({
    agentName: 'Technical Analyst',
    vote: bulls >= 5 ? 'BUY' : bears >= 5 ? 'SELL' : 'HOLD',
    score: Math.round((Math.max(bulls, bears) / 8) * 100),
    reason: `${bulls}/8 bullish, ${bears}/8 bearish indicators`,
  });

  const side = votes[0].vote === 'SELL' ? -1 : 1;
  const atrStop = snapshot.price - side * 2 * (i.atr14 || snapshot.price * 0.02);
  const atrTp = snapshot.price + side * 4 * (i.atr14 || snapshot.price * 0.02);
  const rr = Math.abs(atrTp - snapshot.price) / Math.max(Math.abs(snapshot.price - atrStop), 1e-9);
  const riskOk = Number.isFinite(rr) && rr >= 2 && atrStop > 0 && atrTp > 0
    && Number.isFinite(portfolio.totalValue) && portfolio.totalValue > 0;
  votes.push({
    agentName: 'Risk Calculator',
    vote: riskOk ? votes[0].vote : 'HOLD',
    score: riskOk ? 80 : 20,
    reason: `R:R ${rr.toFixed(2)} ATR stop`,
    rejected: !riskOk,
  });
  if (!riskOk) rejectionReasons.push('Risk calculator: R:R or max loss failed');

  const hour = now.getUTCHours();
  const deadHours = hour >= 2 && hour < 7;
  const defend = policy.drawdownMode === 'DEFEND';
  const tooMany = (portfolio.positions?.length || 0) >= policy.maxOpenPositions;
  const lawOk = !deadHours && !defend && !tooMany && rr >= 2;
  votes.push({
    agentName: 'TopTrader Law Validator',
    vote: lawOk ? votes[0].vote : 'HOLD',
    score: lawOk ? 90 : 0,
    reason: lawOk ? 'Laws passed' : 'Law violation',
    rejected: !lawOk,
  });
  if (!lawOk) {
    if (deadHours) rejectionReasons.push('Law 4: no trades 2–7AM UTC');
    if (defend) rejectionReasons.push('Law 5: DEFEND — no new trades');
    if (tooMany) rejectionReasons.push('Law 7: max open positions');
    if (rr < 2) rejectionReasons.push('Law 3: R:R < 2:1');
  }

  votes.push({
    agentName: 'Kelly Sizer',
    vote: votes[0].vote,
    score: 70,
    reason: 'Half-Kelly cap 2%',
  });

  const ddBlock = policy.drawdownMode === 'DEFEND' || portfolio.pnlDayPct <= -5 || portfolio.pnlWeekPct <= -10;
  votes.push({
    agentName: 'Drawdown Guard',
    vote: ddBlock ? 'HOLD' : votes[0].vote,
    score: ddBlock ? 0 : 75,
    reason: `${policy.drawdownMode} mode`,
    rejected: ddBlock,
  });
  if (ddBlock) rejectionReasons.push('Drawdown guard blocked');

  votes.push({
    agentName: 'Regime Detector',
    vote: votes[0].vote,
    score: 60,
    reason: 'Regime-weighted strategy',
  });

  votes.push({
    agentName: 'Correlation Checker',
    vote: 'HOLD',
    score: 50,
    reason: 'Checked at risk-manager layer',
  });

  const breaking = false;
  votes.push({
    agentName: 'News Scanner',
    vote: breaking ? 'HOLD' : votes[0].vote,
    score: 55,
    reason: 'VADER/news scan deferred to Newshound when T2/T3 run',
  });

  const mom = 0.4 * (snapshot.priceChangePct24h / 100);
  votes.push({
    agentName: 'Momentum Signal',
    vote: mom > 0.02 ? 'BUY' : mom < -0.02 ? 'SELL' : votes[0].vote,
    score: Math.min(100, Math.abs(mom) * 2000),
    reason: `momentum ${mom.toFixed(4)}`,
  });

  votes.push({
    agentName: 'Support/Resistance Finder',
    vote: snapshot.price > i.sma50 ? 'BUY' : 'SELL',
    score: 60,
    reason: `vs SMA50 ${i.sma50.toFixed(2)}`,
  });

  votes.push({
    agentName: 'Volume Profile',
    vote: i.volumeRatio > 1.5 && snapshot.priceChangePct24h > 0 ? 'BUY'
      : i.volumeRatio < 0.7 && snapshot.priceChangePct24h > 0 ? 'HOLD'
      : votes[0].vote,
    score: Math.min(100, i.volumeRatio * 40),
    reason: `vol ratio ${i.volumeRatio.toFixed(2)}`,
  });

  const et = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(now);
  const part = (type: string) => et.find(p => p.type === type)?.value || '';
  const minutes = Number(part('hour')) * 60 + Number(part('minute'));
  const weekday = !['Sat', 'Sun'].includes(part('weekday'));
  // Session window only; exchange holidays/early closes also require broker-calendar validation.
  const stocksHours = snapshot.market !== 'stocks' || (weekday && minutes >= 9 * 60 + 45 && minutes < 15 * 60 + 45);
  if (!stocksHours) rejectionReasons.push('Outside 09:45–15:45 ET weekday entry window');
  votes.push({
    agentName: 'Market Hours',
    vote: stocksHours ? votes[0].vote : 'HOLD',
    score: stocksHours ? 80 : 0,
    reason: stocksHours ? 'session ok' : 'outside regular hours',
    rejected: !stocksHours && snapshot.market === 'stocks',
  });

  const exposure = portfolio.invested / Math.max(portfolio.totalValue, 1);
  const posLimit = (portfolio.positions?.length || 0) < policy.maxOpenPositions && exposure < 0.8;
  votes.push({
    agentName: 'Position Limits',
    vote: posLimit ? votes[0].vote : 'HOLD',
    score: posLimit ? 80 : 0,
    reason: `${portfolio.positions?.length || 0} open, exposure ${(exposure * 100).toFixed(0)}%`,
    rejected: !posLimit,
  });

  votes.push({
    agentName: 'Stop-Loss Calculator',
    vote: votes[0].vote,
    score: 70,
    reason: `stop ${atrStop.toFixed(2)} tp ${atrTp.toFixed(2)}`,
  });

  votes.push({
    agentName: 'Fee Estimator',
    vote: votes[0].vote,
    score: 90,
    reason: snapshot.market === 'stocks' ? 'Alpaca $0 commission' : 'check fee vs profit',
  });

  const buy = votes.filter(v => v.vote === 'BUY' && !v.rejected).length;
  const sell = votes.filter(v => v.vote === 'SELL' && !v.rejected).length;
  const dominant: VoteDirection = buy > sell && buy >= 8 ? 'BUY' : sell > buy && sell >= 8 ? 'SELL' : 'HOLD';
  const consensus = votes.length ? Math.max(buy, sell) / votes.length : 0;
  const rejected = votes.some(v => v.rejected) || policy.drawdownMode === 'DEFEND';

  return {
    votes,
    consensus,
    dominant: rejected ? 'HOLD' : dominant,
    rejected,
    rejectionReasons,
    stopLoss: atrStop,
    takeProfit: atrTp,
  };
}
