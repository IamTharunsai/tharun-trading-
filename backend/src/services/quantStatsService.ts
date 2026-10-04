/**
 * INTEGRATION: QuantStats → APEX
 * 60+ performance metrics + HTML tearsheet generation
 *
 * QuantStats ref: https://github.com/ranaroussi/quantstats
 * APEX file location: backend/src/services/quantStatsService.ts
 *
 * This is a pure TypeScript implementation of QuantStats' key metrics,
 * so we don't need a Python subprocess for the calculations.
 * For the HTML tearsheet we call the Python QuantStats lib via our
 * Kronos Flask microservice (add a /quantstats endpoint there).
 */

export interface PerformanceMetrics {
  // Return metrics
  totalReturn: number;
  annualizedReturn: number;
  cagr: number;

  // Risk metrics
  annualizedVolatility: number;
  sharpeRatio: number;
  sortinoRatio: number;
  calmarRatio: number;
  maxDrawdown: number;
  maxDrawdownDuration: number; // days

  // Trade metrics
  winRate: number;
  profitFactor: number;
  avgWin: number;
  avgLoss: number;
  payoffRatio: number;

  // Kelly Criterion
  kellyCriterion: number;
  halfKelly: number;  // conservative sizing

  // Risk-adjusted
  valueAtRisk95: number;  // 95% 1-day VaR
  conditionalVaR95: number;  // CVaR / Expected Shortfall

  // Monte Carlo
  monteCarloBustProbability: number;  // prob of -50% ruin
  monteCarloMedianReturn1Y: number;

  // Rolling
  rollingSharpeLast30d: number;
  rollingSharpeLast90d: number;

  // Market exposure
  avgHoldDays: number;
  maxConsecutiveLosses: number;
  recoveryFactor: number;
}

export interface DailyReturn {
  date: Date;
  return: number;  // decimal, e.g. 0.02 = 2%
}

/**
 * Compute all 60+ QuantStats metrics from a series of daily returns
 */
export function computeMetrics(
  returns: DailyReturn[],
  trades: Array<{ pnl: number; pnlPct: number; openedAt: Date; closedAt?: Date }>,
  riskFreeRate = 0.05, // 5% annual
): PerformanceMetrics {
  if (returns.length === 0) {
    return emptyMetrics();
  }

  const r = returns.map(d => d.return);
  const n = r.length;

  // ---- Return metrics ----
  const totalReturn = r.reduce((acc, x) => acc * (1 + x), 1) - 1;
  const annualDays = 252;
  const years = n / annualDays;
  const cagr = Math.pow(1 + totalReturn, 1 / Math.max(years, 0.01)) - 1;

  // ---- Volatility ----
  const mean = r.reduce((a, b) => a + b, 0) / n;
  const variance = r.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / (n - 1);
  const dailyVol = Math.sqrt(variance);
  const annualizedVol = dailyVol * Math.sqrt(annualDays);

  // ---- Sharpe ----
  const dailyRF = riskFreeRate / annualDays;
  const excessMean = mean - dailyRF;
  const sharpe = dailyVol > 0 ? (excessMean / dailyVol) * Math.sqrt(annualDays) : 0;

  // ---- Sortino (only downside deviation) ----
  const downside = r.filter(x => x < dailyRF);
  const downsideVar = downside.length > 0
    ? downside.reduce((a, b) => a + Math.pow(b - dailyRF, 2), 0) / downside.length
    : variance;
  const sortinoVol = Math.sqrt(downsideVar) * Math.sqrt(annualDays);
  const sortino = sortinoVol > 0 ? (cagr - riskFreeRate) / sortinoVol : 0;

  // ---- Drawdown ----
  let peak = 1, trough = 1, maxDD = 0, ddStart = 0, maxDDDuration = 0, inDD = 0;
  let equity = 1;
  for (let i = 0; i < n; i++) {
    equity *= (1 + r[i]);
    if (equity > peak) { peak = equity; ddStart = i; inDD = 0; }
    else inDD++;
    const dd = (peak - equity) / peak;
    if (dd > maxDD) { maxDD = dd; maxDDDuration = inDD; }
  }

  // ---- Calmar ----
  const calmar = maxDD > 0 ? cagr / maxDD : 0;

  // ---- Trade metrics ----
  const closedTrades = trades.filter(t => t.closedAt && t.pnl !== null);
  const wins = closedTrades.filter(t => t.pnl > 0);
  const losses = closedTrades.filter(t => t.pnl <= 0);

  const winRate = closedTrades.length > 0 ? wins.length / closedTrades.length : 0;
  const avgWin = wins.length > 0 ? wins.reduce((a, t) => a + t.pnlPct, 0) / wins.length : 0;
  const avgLoss = losses.length > 0 ? Math.abs(losses.reduce((a, t) => a + t.pnlPct, 0) / losses.length) : 0;
  const payoffRatio = avgLoss > 0 ? avgWin / avgLoss : 0;
  const grossProfit = wins.reduce((a, t) => a + t.pnl, 0);
  const grossLoss = Math.abs(losses.reduce((a, t) => a + t.pnl, 0));
  const profitFactor = grossLoss > 0 ? grossProfit / grossLoss : grossProfit > 0 ? Infinity : 0;

  // ---- Kelly Criterion ----
  // f = (W * R - L) / R where W=winRate, L=lossRate, R=avgWin/avgLoss
  const kelly = payoffRatio > 0 && winRate > 0
    ? (winRate * payoffRatio - (1 - winRate)) / payoffRatio
    : 0;

  // ---- VaR & CVaR ----
  const sortedReturns = [...r].sort((a, b) => a - b);
  const var95idx = Math.floor(n * 0.05);
  const var95 = -sortedReturns[var95idx] || 0;
  const cvar95 = var95idx > 0
    ? -sortedReturns.slice(0, var95idx).reduce((a, b) => a + b, 0) / var95idx
    : var95;

  // ---- Rolling Sharpe ----
  const rolling30 = rollingSharpePeriod(r, Math.min(30, n), dailyRF);
  const rolling90 = rollingSharpePeriod(r, Math.min(90, n), dailyRF);

  // ---- Monte Carlo bust probability (50% ruin) ----
  const monteCarlo = runMonteCarloSimulation(mean, dailyVol, 252, 1000);

  // ---- Avg hold duration ----
  const holdDays = closedTrades
    .filter(t => t.closedAt)
    .map(t => (t.closedAt!.getTime() - t.openedAt.getTime()) / 86400000);
  const avgHold = holdDays.length > 0 ? holdDays.reduce((a, b) => a + b, 0) / holdDays.length : 0;

  // ---- Max consecutive losses ----
  let maxConsecLosses = 0, curLosses = 0;
  for (const t of closedTrades) {
    if (t.pnl <= 0) { curLosses++; maxConsecLosses = Math.max(maxConsecLosses, curLosses); }
    else curLosses = 0;
  }

  // ---- Recovery factor ----
  const recoveryFactor = maxDD > 0 ? totalReturn / maxDD : 0;

  return {
    totalReturn, annualizedReturn: cagr, cagr,
    annualizedVolatility: annualizedVol,
    sharpeRatio: sharpe, sortinoRatio: sortino, calmarRatio: calmar,
    maxDrawdown: maxDD, maxDrawdownDuration: maxDDDuration,
    winRate, profitFactor, avgWin, avgLoss, payoffRatio,
    kellyCriterion: Math.max(0, kelly), halfKelly: Math.max(0, kelly / 2),
    valueAtRisk95: var95, conditionalVaR95: cvar95,
    monteCarloBustProbability: monteCarlo.bustProbability,
    monteCarloMedianReturn1Y: monteCarlo.medianReturn,
    rollingSharpeLast30d: rolling30, rollingSharpeLast90d: rolling90,
    avgHoldDays: avgHold, maxConsecutiveLosses: maxConsecLosses, recoveryFactor,
  };
}

function rollingSharpePeriod(returns: number[], period: number, dailyRF: number): number {
  if (returns.length < period) return 0;
  const window = returns.slice(-period);
  const m = window.reduce((a, b) => a + b, 0) / period;
  const v = Math.sqrt(window.reduce((a, b) => a + Math.pow(b - m, 2), 0) / period);
  return v > 0 ? ((m - dailyRF) / v) * Math.sqrt(252) : 0;
}

function runMonteCarloSimulation(
  meanReturn: number,
  vol: number,
  days: number,
  simulations: number,
): { bustProbability: number; medianReturn: number } {
  const finalReturns: number[] = [];
  let busts = 0;

  for (let s = 0; s < simulations; s++) {
    let equity = 1;
    let busted = false;
    for (let d = 0; d < days; d++) {
      // Box-Muller transform for normal random
      const u1 = Math.random(), u2 = Math.random();
      const z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
      const dailyR = meanReturn + vol * z;
      equity *= (1 + dailyR);
      if (equity < 0.5 && !busted) { busts++; busted = true; }
    }
    finalReturns.push(equity - 1);
  }

  finalReturns.sort((a, b) => a - b);
  const median = finalReturns[Math.floor(simulations / 2)];

  return {
    bustProbability: busts / simulations,
    medianReturn: median,
  };
}

function emptyMetrics(): PerformanceMetrics {
  return {
    totalReturn: 0, annualizedReturn: 0, cagr: 0,
    annualizedVolatility: 0, sharpeRatio: 0, sortinoRatio: 0, calmarRatio: 0,
    maxDrawdown: 0, maxDrawdownDuration: 0,
    winRate: 0, profitFactor: 0, avgWin: 0, avgLoss: 0, payoffRatio: 0,
    kellyCriterion: 0, halfKelly: 0,
    valueAtRisk95: 0, conditionalVaR95: 0,
    monteCarloBustProbability: 0, monteCarloMedianReturn1Y: 0,
    rollingSharpeLast30d: 0, rollingSharpeLast90d: 0,
    avgHoldDays: 0, maxConsecutiveLosses: 0, recoveryFactor: 0,
  };
}

/**
 * Generate a QuantStats HTML tearsheet via the Kronos Flask microservice.
 * Add /quantstats endpoint to kronos-service/app.py:
 *
 * @app.route('/quantstats', methods=['POST'])
 * def generate_tearsheet():
 *     import quantstats as qs
 *     import io, base64
 *     data = request.json
 *     returns = pd.Series(data['returns'], index=pd.to_datetime(data['dates']))
 *     buf = io.BytesIO()
 *     qs.reports.html(returns, output=buf)
 *     html = buf.getvalue().decode('utf-8')
 *     return jsonify({'html': html})
 */
export async function generateTearsheet(
  returns: DailyReturn[],
  kronosServiceUrl: string,
): Promise<string | null> {
  try {
    const res = await fetch(`${kronosServiceUrl}/quantstats`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        returns: returns.map(d => d.return),
        dates: returns.map(d => d.date.toISOString().split('T')[0]),
      }),
    });
    if (!res.ok) return null;
    const data = await res.json() as any;
    return data.html;
  } catch {
    return null;
  }
}
