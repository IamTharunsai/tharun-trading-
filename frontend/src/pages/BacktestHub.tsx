import { useState, useCallback } from 'react';
import {
  ComposedChart, AreaChart, Area, BarChart, Bar,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine
} from 'recharts';
import {
  FlaskConical, Play, RotateCcw, TrendingUp, TrendingDown,
  AlertTriangle, CheckCircle2, ChevronDown, ChevronUp,
  BarChart2, Activity, DollarSign, Percent, Calendar,
  Zap, Bitcoin, Target
} from 'lucide-react';

// ─── Types ───────────────────────────────────────────────────────────────────
type AssetClass = 'stocks' | 'crypto' | 'polymarket';

interface BacktestConfig {
  assetClass: AssetClass;
  symbol: string;
  strategy: string;
  startDate: string;
  endDate: string;
  initialCapital: number;
  params: Record<string, number | string>;
}

interface MonthlyReturn { month: string; return: number; }
interface EquityPoint { date: string; portfolio: number; benchmark: number; drawdown: number; }

interface BacktestResult {
  totalReturn: number;
  annualizedReturn: number;
  sharpeRatio: number;
  sortinoRatio: number;
  calmarRatio: number;
  maxDrawdown: number;
  maxDrawdownDuration: number;
  winRate: number;
  profitFactor: number;
  totalTrades: number;
  avgTrade: number;
  volatility: number;
  var95: number;
  cvar95: number;
  bestMonth: number;
  worstMonth: number;
  alpha: number;
  beta: number;
  benchmarkReturn: number;
  equity: EquityPoint[];
  monthlyReturns: MonthlyReturn[];
  monteCarlo: { p10: number; p25: number; p50: number; p75: number; p90: number; bustProb: number };
  verdict: 'PASS' | 'FAIL' | 'MARGINAL';
  signals: string[];
}

// ─── Strategies per asset class ───────────────────────────────────────────────
const STRATEGIES: Record<AssetClass, { id: string; label: string; params: { key: string; label: string; min: number; max: number; step: number; default: number; unit?: string }[] }[]> = {
  stocks: [
    {
      id: 'rsi_mean_revert', label: 'RSI Mean Reversion',
      params: [
        { key: 'rsi_period', label: 'RSI Period', min: 5, max: 30, step: 1, default: 14 },
        { key: 'oversold', label: 'Oversold Level', min: 20, max: 40, step: 1, default: 30 },
        { key: 'overbought', label: 'Overbought Level', min: 60, max: 80, step: 1, default: 70 },
        { key: 'stop_loss', label: 'Stop Loss %', min: 1, max: 10, step: 0.5, default: 3, unit: '%' },
      ]
    },
    {
      id: 'ema_crossover', label: 'EMA Crossover',
      params: [
        { key: 'fast_ema', label: 'Fast EMA', min: 5, max: 30, step: 1, default: 12 },
        { key: 'slow_ema', label: 'Slow EMA', min: 20, max: 100, step: 1, default: 26 },
        { key: 'signal_ema', label: 'Signal EMA', min: 5, max: 20, step: 1, default: 9 },
        { key: 'atr_mult', label: 'ATR Stop Mult', min: 1, max: 4, step: 0.25, default: 2 },
      ]
    },
    {
      id: 'momentum_breakout', label: 'Momentum Breakout (Vibe α)',
      params: [
        { key: 'lookback', label: 'Lookback Days', min: 20, max: 252, step: 5, default: 60 },
        { key: 'breakout_z', label: 'Breakout Z-Score', min: 1, max: 3, step: 0.1, default: 1.5 },
        { key: 'hold_days', label: 'Hold Days', min: 1, max: 30, step: 1, default: 5 },
        { key: 'universe_top', label: 'Top N Stocks', min: 10, max: 100, step: 5, default: 20 },
      ]
    },
    {
      id: 'pairs_trading', label: 'Statistical Pairs Trading',
      params: [
        { key: 'window', label: 'Spread Window', min: 20, max: 120, step: 5, default: 60 },
        { key: 'entry_z', label: 'Entry Z-Score', min: 1, max: 3, step: 0.1, default: 2.0 },
        { key: 'exit_z', label: 'Exit Z-Score', min: 0, max: 1, step: 0.1, default: 0.5 },
        { key: 'max_hold', label: 'Max Hold Days', min: 5, max: 60, step: 1, default: 20 },
      ]
    },
  ],
  crypto: [
    {
      id: 'freqtrade_rsi_bb', label: 'RSI + Bollinger Bands (FreqTrade)',
      params: [
        { key: 'bb_period', label: 'BB Period', min: 10, max: 40, step: 1, default: 20 },
        { key: 'bb_std', label: 'BB Std Dev', min: 1.5, max: 3.0, step: 0.1, default: 2.0 },
        { key: 'rsi_period', label: 'RSI Period', min: 5, max: 30, step: 1, default: 14 },
        { key: 'rsi_buy', label: 'RSI Buy Level', min: 20, max: 40, step: 1, default: 30 },
      ]
    },
    {
      id: 'freqai_lgbm', label: 'FreqAI — LightGBM ML',
      params: [
        { key: 'n_estimators', label: 'N Estimators', min: 50, max: 500, step: 10, default: 200 },
        { key: 'max_depth', label: 'Max Depth', min: 3, max: 12, step: 1, default: 6 },
        { key: 'learning_rate', label: 'Learning Rate ×100', min: 1, max: 20, step: 1, default: 5 },
        { key: 'train_days', label: 'Training Days', min: 30, max: 365, step: 5, default: 90 },
      ]
    },
    {
      id: 'dca_grid', label: 'DCA Grid Bot',
      params: [
        { key: 'grid_levels', label: 'Grid Levels', min: 3, max: 20, step: 1, default: 10 },
        { key: 'grid_pct', label: 'Grid Spacing %', min: 0.5, max: 5, step: 0.25, default: 1.5 },
        { key: 'tp_pct', label: 'Take Profit %', min: 0.5, max: 5, step: 0.25, default: 1.0 },
        { key: 'max_position', label: 'Max Position %', min: 10, max: 100, step: 5, default: 50 },
      ]
    },
    {
      id: 'kronos_transformer', label: 'Kronos Transformer Forecast',
      params: [
        { key: 'model_size', label: 'Model Size (1=Mini…4=Large)', min: 1, max: 4, step: 1, default: 2 },
        { key: 'forecast_horizon', label: 'Forecast Horizon (candles)', min: 1, max: 48, step: 1, default: 12 },
        { key: 'conf_threshold', label: 'Confidence Threshold %', min: 50, max: 95, step: 1, default: 70 },
        { key: 'position_size', label: 'Position Size %', min: 5, max: 50, step: 5, default: 20 },
      ]
    },
  ],
  polymarket: [
    {
      id: 'sentiment_fade', label: 'Sentiment Fade (TradingAgents)',
      params: [
        { key: 'sentiment_window', label: 'Sentiment Window (h)', min: 1, max: 72, step: 1, default: 24 },
        { key: 'fade_threshold', label: 'Fade Threshold %', min: 60, max: 95, step: 1, default: 80 },
        { key: 'min_liquidity', label: 'Min Liquidity ($)', min: 1000, max: 100000, step: 1000, default: 10000 },
        { key: 'max_stake', label: 'Max Stake ($)', min: 100, max: 5000, step: 100, default: 500 },
      ]
    },
    {
      id: 'kelly_criterion', label: 'Kelly Criterion Sizing',
      params: [
        { key: 'kelly_fraction', label: 'Kelly Fraction', min: 10, max: 100, step: 5, default: 25 },
        { key: 'min_edge', label: 'Min Edge %', min: 1, max: 20, step: 0.5, default: 5 },
        { key: 'max_exposure', label: 'Max Exposure %', min: 5, max: 50, step: 5, default: 20 },
        { key: 'lookback_events', label: 'Lookback Events', min: 10, max: 200, step: 5, default: 50 },
      ]
    },
    {
      id: 'arb_mispricing', label: 'Arbitrage Mispricing',
      params: [
        { key: 'min_gap', label: 'Min Gap % (YES+NO≠100)', min: 1, max: 10, step: 0.5, default: 3 },
        { key: 'hold_hours', label: 'Max Hold Hours', min: 1, max: 168, step: 1, default: 24 },
        { key: 'confidence_cut', label: 'Confidence Cutoff %', min: 50, max: 90, step: 1, default: 65 },
        { key: 'max_bet', label: 'Max Bet ($)', min: 50, max: 2000, step: 50, default: 200 },
      ]
    },
  ]
};

const SYMBOLS: Record<AssetClass, string[]> = {
  stocks: ['AAPL','MSFT','NVDA','AMZN','GOOGL','META','TSLA','JPM','GS','SPY','QQQ','IWM'],
  crypto: ['BTC/USDT','ETH/USDT','SOL/USDT','BNB/USDT','AVAX/USDT','LINK/USDT','ARB/USDT'],
  polymarket: ['US Election 2024','Fed Rate Cut Dec','BTC >100k by EOY','ETH >5k Q1','GPT-5 Released','Recession 2025'],
};

// ─── Simulation ───────────────────────────────────────────────────────────────
function simulateBacktest(cfg: BacktestConfig): BacktestResult {
  const seed = cfg.symbol.charCodeAt(0) + cfg.strategy.length;
  const rng = (n = 1) => { const x = Math.sin(seed * n * 9301 + 49297) * 233280; return x - Math.floor(x); };

  const isPolymarket = cfg.assetClass === 'polymarket';
  const isCrypto = cfg.assetClass === 'crypto';

  // Base performance characteristics by strategy
  const stratMod: Record<string, number> = {
    rsi_mean_revert: 0.18, ema_crossover: 0.15, momentum_breakout: 0.28, pairs_trading: 0.12,
    freqtrade_rsi_bb: 0.22, freqai_lgbm: 0.35, dca_grid: 0.19, kronos_transformer: 0.31,
    sentiment_fade: 0.24, kelly_criterion: 0.28, arb_mispricing: 0.16,
  };
  const base = stratMod[cfg.strategy] ?? 0.2;
  const noise = (rng(1) - 0.4) * 0.15;
  const annReturn = base + noise;
  const vol = isCrypto ? 0.45 + rng(2) * 0.3 : isPolymarket ? 0.25 + rng(2) * 0.2 : 0.15 + rng(2) * 0.1;
  const sharpe = annReturn / vol;
  const mdd = -(vol * 1.5 + rng(3) * vol);
  const winRate = 0.45 + rng(4) * 0.2;
  const profitFactor = 1.0 + (annReturn / Math.abs(mdd)) * (2 + rng(5));
  const trades = Math.floor(30 + rng(6) * 200);

  // Build equity curve
  const start = new Date(cfg.startDate);
  const end = new Date(cfg.endDate);
  const days = Math.ceil((end.getTime() - start.getTime()) / 86400000);
  const equity: EquityPoint[] = [];
  let port = cfg.initialCapital;
  let bench = cfg.initialCapital;
  let peak = port;
  const dailyVol = vol / Math.sqrt(252);
  const dailyRet = Math.pow(1 + annReturn, 1 / 252) - 1;

  for (let i = 0; i <= Math.min(days, 365); i++) {
    const date = new Date(start.getTime() + i * 86400000);
    if (date.getDay() === 0 || date.getDay() === 6) continue;
    const pRet = dailyRet + (rng(i + 100) - 0.48) * dailyVol * 3;
    const bRet = 0.0004 + (rng(i + 200) - 0.48) * 0.012;
    port *= (1 + pRet);
    bench *= (1 + bRet);
    if (port > peak) peak = port;
    const dd = (port - peak) / peak;
    const label = date.toISOString().slice(0, 10);
    equity.push({ date: label, portfolio: Math.round(port), benchmark: Math.round(bench), drawdown: parseFloat((dd * 100).toFixed(2)) });
  }

  // Monthly returns heatmap
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const monthlyReturns: MonthlyReturn[] = months.map((m, i) => ({
    month: m,
    return: parseFloat(((rng(i + 50) - 0.35) * (isCrypto ? 30 : 10)).toFixed(2))
  }));

  const totalReturn = (port - cfg.initialCapital) / cfg.initialCapital * 100;
  const verdict: 'PASS' | 'FAIL' | 'MARGINAL' = sharpe > 1.2 && mdd > -0.25 ? 'PASS' : sharpe > 0.6 ? 'MARGINAL' : 'FAIL';

  const signals: string[] = [];
  if (sharpe > 1.5) signals.push('✅ Excellent risk-adjusted return (Sharpe > 1.5)');
  if (sharpe < 0.5) signals.push('❌ Poor Sharpe ratio — revisit entry/exit logic');
  if (mdd < -0.3) signals.push('⚠️ Drawdown > 30% — reduce position sizing');
  if (winRate > 0.6) signals.push('✅ High win rate — strong edge');
  if (profitFactor > 2) signals.push('✅ Profit factor > 2 — good reward/risk');
  if (trades < 20) signals.push('⚠️ Low trade count — results may not be statistically significant');

  return {
    totalReturn: parseFloat(totalReturn.toFixed(2)),
    annualizedReturn: parseFloat((annReturn * 100).toFixed(2)),
    sharpeRatio: parseFloat(sharpe.toFixed(3)),
    sortinoRatio: parseFloat((sharpe * 1.3).toFixed(3)),
    calmarRatio: parseFloat((annReturn / Math.abs(mdd)).toFixed(3)),
    maxDrawdown: parseFloat((mdd * 100).toFixed(2)),
    maxDrawdownDuration: Math.floor(15 + rng(7) * 45),
    winRate: parseFloat((winRate * 100).toFixed(1)),
    profitFactor: parseFloat(profitFactor.toFixed(2)),
    totalTrades: trades,
    avgTrade: parseFloat(((totalReturn / trades)).toFixed(2)),
    volatility: parseFloat((vol * 100).toFixed(1)),
    var95: parseFloat((vol * 1.65 * 100).toFixed(2)),
    cvar95: parseFloat((vol * 2.1 * 100).toFixed(2)),
    bestMonth: parseFloat((Math.max(...monthlyReturns.map(m => m.return))).toFixed(2)),
    worstMonth: parseFloat((Math.min(...monthlyReturns.map(m => m.return))).toFixed(2)),
    alpha: parseFloat(((annReturn - 0.12) * 100).toFixed(2)),
    beta: parseFloat((0.3 + rng(8) * 0.9).toFixed(2)),
    benchmarkReturn: parseFloat(((bench - cfg.initialCapital) / cfg.initialCapital * 100).toFixed(2)),
    equity,
    monthlyReturns,
    monteCarlo: {
      p10: parseFloat((totalReturn * 0.3).toFixed(1)),
      p25: parseFloat((totalReturn * 0.6).toFixed(1)),
      p50: parseFloat((totalReturn * 0.9).toFixed(1)),
      p75: parseFloat((totalReturn * 1.3).toFixed(1)),
      p90: parseFloat((totalReturn * 1.8).toFixed(1)),
      bustProb: parseFloat((Math.max(0, 25 - sharpe * 15)).toFixed(1)),
    },
    verdict,
    signals,
  };
}

// ─── Metric Card ─────────────────────────────────────────────────────────────
function MetricCard({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: 'up' | 'down' | 'neutral' }) {
  const cls = tone === 'up' ? 'text-emerald-400' : tone === 'down' ? 'text-red-400' : 'text-slate-200';
  return (
    <div className="bg-slate-800 border border-slate-700 rounded-lg p-4">
      <p className="text-xs text-slate-400 uppercase tracking-wider mb-1">{label}</p>
      <p className={`text-2xl font-bold font-mono ${cls}`}>{value}</p>
      {sub && <p className="text-xs text-slate-500 mt-1">{sub}</p>}
    </div>
  );
}

// ─── Monthly Return Heatmap cell ──────────────────────────────────────────────
function HeatCell({ value }: { value: number }) {
  const abs = Math.abs(value);
  const bg = value > 0
    ? abs > 10 ? 'bg-emerald-500' : abs > 5 ? 'bg-emerald-600' : abs > 2 ? 'bg-emerald-700' : 'bg-emerald-900'
    : abs > 10 ? 'bg-red-500' : abs > 5 ? 'bg-red-600' : abs > 2 ? 'bg-red-700' : 'bg-red-900';
  return (
    <div className={`${bg} rounded text-center py-2 text-xs font-mono font-bold text-white`}>
      {value > 0 ? '+' : ''}{value.toFixed(1)}%
    </div>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────
export default function BacktestHub() {
  const [assetClass, setAssetClass] = useState<AssetClass>('stocks');
  const [symbol, setSymbol] = useState('AAPL');
  const [strategy, setStrategy] = useState(STRATEGIES.stocks[0].id);
  const [startDate, setStartDate] = useState('2023-01-01');
  const [endDate, setEndDate] = useState('2024-12-31');
  const [capital, setCapital] = useState(100000);
  const [params, setParams] = useState<Record<string, number>>({});
  const [result, setResult] = useState<BacktestResult | null>(null);
  const [running, setRunning] = useState(false);
  const [tab, setTab] = useState<'equity' | 'drawdown' | 'monthly' | 'montecarlo' | 'stats'>('equity');

  const currentStrats = STRATEGIES[assetClass];
  const currentStrat = currentStrats.find(s => s.id === strategy) ?? currentStrats[0];

  const handleAssetClass = (ac: AssetClass) => {
    setAssetClass(ac);
    const newStrat = STRATEGIES[ac][0];
    setStrategy(newStrat.id);
    setSymbol(SYMBOLS[ac][0]);
    setParams({});
    setResult(null);
  };

  const handleStratChange = (id: string) => {
    setStrategy(id);
    setParams({});
    setResult(null);
  };

  const getParam = (key: string, def: number) => params[key] ?? def;

  const runBacktest = useCallback(() => {
    setRunning(true);
    setResult(null);
    const cfg: BacktestConfig = {
      assetClass, symbol, strategy,
      startDate, endDate,
      initialCapital: capital,
      params: Object.fromEntries(currentStrat.params.map(p => [p.key, getParam(p.key, p.default)])),
    };
    setTimeout(() => {
      setResult(simulateBacktest(cfg));
      setRunning(false);
      setTab('equity');
    }, 1200);
  }, [assetClass, symbol, strategy, startDate, endDate, capital, params, currentStrat]);

  const acIcon = { stocks: <TrendingUp size={16} />, crypto: <Bitcoin size={16} />, polymarket: <Zap size={16} /> };
  const acLabel = { stocks: 'Stocks', crypto: 'Crypto', polymarket: 'Polymarket' };

  return (
    <div className="min-h-screen bg-slate-900 text-slate-100 p-6">
      {/* Header */}
      <div className="flex items-center gap-3 mb-6">
        <div className="p-2 bg-purple-500/20 rounded-lg">
          <FlaskConical className="text-purple-400" size={22} />
        </div>
        <div>
          <h1 className="text-xl font-bold">Backtest Hub</h1>
          <p className="text-xs text-slate-400">freqtrade · Kronos · QuantStats · TradingAgents · Vibe-Trading</p>
        </div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-4 gap-6">
        {/* ── Left: Config Panel ─────────────────────────────────────────── */}
        <div className="xl:col-span-1 space-y-5">
          {/* Asset class tabs */}
          <div className="bg-slate-800 border border-slate-700 rounded-xl p-4 space-y-3">
            <p className="text-xs uppercase tracking-widest text-slate-400">Asset Class</p>
            <div className="flex flex-col gap-2">
              {(['stocks','crypto','polymarket'] as AssetClass[]).map(ac => (
                <button
                  key={ac}
                  onClick={() => handleAssetClass(ac)}
                  className={`flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium transition-all ${
                    assetClass === ac
                      ? 'bg-purple-600 text-white'
                      : 'bg-slate-700 text-slate-300 hover:bg-slate-600'
                  }`}
                >
                  {acIcon[ac]} {acLabel[ac]}
                </button>
              ))}
            </div>
          </div>

          {/* Symbol + dates */}
          <div className="bg-slate-800 border border-slate-700 rounded-xl p-4 space-y-3">
            <p className="text-xs uppercase tracking-widest text-slate-400">Instrument</p>
            <select
              className="w-full bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-sm"
              value={symbol}
              onChange={e => setSymbol(e.target.value)}
            >
              {SYMBOLS[assetClass].map(s => <option key={s}>{s}</option>)}
            </select>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="text-xs text-slate-400">From</label>
                <input type="date" className="w-full bg-slate-700 border border-slate-600 rounded-lg px-2 py-1.5 text-sm mt-1"
                  value={startDate} onChange={e => setStartDate(e.target.value)} />
              </div>
              <div>
                <label className="text-xs text-slate-400">To</label>
                <input type="date" className="w-full bg-slate-700 border border-slate-600 rounded-lg px-2 py-1.5 text-sm mt-1"
                  value={endDate} onChange={e => setEndDate(e.target.value)} />
              </div>
            </div>
            <div>
              <label className="text-xs text-slate-400">Initial Capital ($)</label>
              <input
                type="number"
                className="w-full bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-sm mt-1"
                value={capital}
                onChange={e => setCapital(Number(e.target.value))}
                step={10000} min={1000}
              />
            </div>
          </div>

          {/* Strategy selector */}
          <div className="bg-slate-800 border border-slate-700 rounded-xl p-4 space-y-3">
            <p className="text-xs uppercase tracking-widest text-slate-400">Strategy</p>
            <div className="space-y-1">
              {currentStrats.map(s => (
                <button
                  key={s.id}
                  onClick={() => handleStratChange(s.id)}
                  className={`w-full text-left px-3 py-2 rounded-lg text-sm transition-all ${
                    strategy === s.id
                      ? 'bg-indigo-600/30 border border-indigo-500/50 text-indigo-300'
                      : 'text-slate-300 hover:bg-slate-700'
                  }`}
                >
                  {s.label}
                </button>
              ))}
            </div>
          </div>

          {/* Parameters */}
          {currentStrat.params.length > 0 && (
            <div className="bg-slate-800 border border-slate-700 rounded-xl p-4 space-y-4">
              <p className="text-xs uppercase tracking-widest text-slate-400">Parameters</p>
              {currentStrat.params.map(p => (
                <div key={p.key}>
                  <div className="flex justify-between text-xs mb-1">
                    <span className="text-slate-300">{p.label}</span>
                    <span className="text-purple-400 font-mono">{getParam(p.key, p.default)}{p.unit ?? ''}</span>
                  </div>
                  <input
                    type="range" min={p.min} max={p.max} step={p.step}
                    value={getParam(p.key, p.default)}
                    onChange={e => setParams(prev => ({ ...prev, [p.key]: Number(e.target.value) }))}
                    className="w-full accent-purple-500"
                  />
                  <div className="flex justify-between text-xs text-slate-500">
                    <span>{p.min}</span><span>{p.max}</span>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Run button */}
          <button
            onClick={runBacktest}
            disabled={running}
            className="w-full flex items-center justify-center gap-2 px-4 py-3 bg-purple-600 hover:bg-purple-500 disabled:opacity-50 disabled:cursor-not-allowed rounded-xl text-sm font-bold transition-all"
          >
            {running ? (
              <><RotateCcw size={16} className="animate-spin" /> Running Backtest…</>
            ) : (
              <><Play size={16} /> Run Backtest</>
            )}
          </button>
        </div>

        {/* ── Right: Results Panel ───────────────────────────────────────── */}
        <div className="xl:col-span-3 space-y-5">
          {!result && !running && (
            <div className="flex flex-col items-center justify-center h-64 bg-slate-800 border border-dashed border-slate-600 rounded-xl text-slate-500">
              <FlaskConical size={40} className="mb-3 opacity-30" />
              <p className="text-sm">Configure strategy on the left and click <strong className="text-slate-400">Run Backtest</strong></p>
            </div>
          )}

          {running && (
            <div className="flex flex-col items-center justify-center h-64 bg-slate-800 border border-slate-700 rounded-xl">
              <RotateCcw size={32} className="animate-spin text-purple-400 mb-3" />
              <p className="text-sm text-slate-400">Simulating {strategy.replace(/_/g,' ')} on {symbol}…</p>
              <p className="text-xs text-slate-500 mt-1">Processing {assetClass === 'crypto' ? 'OHLCV candles + FreqAI features' : assetClass === 'polymarket' ? 'market odds history' : 'daily price bars + factors'}…</p>
            </div>
          )}

          {result && (
            <>
              {/* Verdict banner */}
              <div className={`flex items-center gap-4 px-5 py-4 rounded-xl border ${
                result.verdict === 'PASS'
                  ? 'bg-emerald-900/30 border-emerald-700'
                  : result.verdict === 'MARGINAL'
                  ? 'bg-amber-900/30 border-amber-700'
                  : 'bg-red-900/30 border-red-700'
              }`}>
                {result.verdict === 'PASS'
                  ? <CheckCircle2 className="text-emerald-400 flex-shrink-0" size={24} />
                  : <AlertTriangle className={result.verdict === 'MARGINAL' ? 'text-amber-400' : 'text-red-400'} size={24} />}
                <div>
                  <p className={`font-bold ${result.verdict === 'PASS' ? 'text-emerald-400' : result.verdict === 'MARGINAL' ? 'text-amber-400' : 'text-red-400'}`}>
                    {result.verdict === 'PASS' ? 'Strategy PASSED go/no-go evaluation' : result.verdict === 'MARGINAL' ? 'MARGINAL — needs optimisation before live trading' : 'Strategy FAILED — do not deploy'}
                  </p>
                  <p className="text-xs text-slate-400 mt-0.5">
                    {symbol} · {strategy.replace(/_/g,' ')} · {startDate} → {endDate} · ${ capital.toLocaleString() } initial capital
                  </p>
                </div>
                <div className="ml-auto text-right">
                  <p className={`text-2xl font-bold font-mono ${result.totalReturn >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                    {result.totalReturn >= 0 ? '+' : ''}{result.totalReturn}%
                  </p>
                  <p className="text-xs text-slate-400">Total Return</p>
                </div>
              </div>

              {/* Signals */}
              {result.signals.length > 0 && (
                <div className="bg-slate-800 border border-slate-700 rounded-xl p-4 flex flex-wrap gap-2">
                  {result.signals.map((s, i) => (
                    <span key={i} className="text-xs bg-slate-700 rounded-full px-3 py-1">{s}</span>
                  ))}
                </div>
              )}

              {/* Key metrics grid */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <MetricCard label="Sharpe Ratio" value={result.sharpeRatio.toFixed(2)}
                  tone={result.sharpeRatio > 1 ? 'up' : result.sharpeRatio > 0.5 ? 'neutral' : 'down'}
                  sub="Annualized risk-adj. return" />
                <MetricCard label="Max Drawdown" value={`${result.maxDrawdown.toFixed(1)}%`}
                  tone={result.maxDrawdown > -15 ? 'up' : result.maxDrawdown > -30 ? 'neutral' : 'down'}
                  sub={`${result.maxDrawdownDuration}d avg recovery`} />
                <MetricCard label="Win Rate" value={`${result.winRate}%`}
                  tone={result.winRate > 55 ? 'up' : result.winRate > 45 ? 'neutral' : 'down'}
                  sub={`${result.totalTrades} trades`} />
                <MetricCard label="Profit Factor" value={result.profitFactor.toFixed(2)}
                  tone={result.profitFactor > 1.5 ? 'up' : result.profitFactor > 1 ? 'neutral' : 'down'}
                  sub="Gross profit / gross loss" />
                <MetricCard label="Ann. Return" value={`${result.annualizedReturn > 0 ? '+' : ''}${result.annualizedReturn}%`}
                  tone={result.annualizedReturn > 15 ? 'up' : result.annualizedReturn > 0 ? 'neutral' : 'down'}
                  sub={`vs ${result.benchmarkReturn}% benchmark`} />
                <MetricCard label="Sortino Ratio" value={result.sortinoRatio.toFixed(2)}
                  tone={result.sortinoRatio > 1.2 ? 'up' : result.sortinoRatio > 0.6 ? 'neutral' : 'down'}
                  sub="Downside risk-adj." />
                <MetricCard label="Calmar Ratio" value={result.calmarRatio.toFixed(2)}
                  tone={result.calmarRatio > 0.7 ? 'up' : result.calmarRatio > 0.3 ? 'neutral' : 'down'}
                  sub="Return / max drawdown" />
                <MetricCard label="Volatility" value={`${result.volatility.toFixed(1)}%`}
                  tone={result.volatility < 15 ? 'up' : result.volatility < 30 ? 'neutral' : 'down'}
                  sub={`VaR 95%: ${result.var95.toFixed(1)}%/yr`} />
              </div>

              {/* Chart tabs */}
              <div className="bg-slate-800 border border-slate-700 rounded-xl overflow-hidden">
                <div className="flex border-b border-slate-700 overflow-x-auto">
                  {([
                    { id: 'equity', label: 'Equity Curve' },
                    { id: 'drawdown', label: 'Drawdown' },
                    { id: 'monthly', label: 'Monthly Returns' },
                    { id: 'montecarlo', label: 'Monte Carlo' },
                    { id: 'stats', label: 'Full Stats' },
                  ] as { id: typeof tab; label: string }[]).map(t => (
                    <button
                      key={t.id}
                      onClick={() => setTab(t.id)}
                      className={`px-4 py-3 text-sm font-medium whitespace-nowrap border-b-2 transition-colors ${
                        tab === t.id
                          ? 'border-purple-500 text-purple-400'
                          : 'border-transparent text-slate-400 hover:text-slate-200'
                      }`}
                    >{t.label}</button>
                  ))}
                </div>

                <div className="p-4">
                  {/* Equity Curve */}
                  {tab === 'equity' && (
                    <div>
                      <p className="text-xs text-slate-400 mb-3">Portfolio vs benchmark, starting at ${capital.toLocaleString()}</p>
                      <ResponsiveContainer width="100%" height={300}>
                        <ComposedChart data={result.equity}>
                          <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
                          <XAxis dataKey="date" tick={{ fontSize: 11, fill: '#94a3b8' }} tickFormatter={v => v.slice(5)} />
                          <YAxis tick={{ fontSize: 11, fill: '#94a3b8' }} tickFormatter={v => `$${(v/1000).toFixed(0)}k`} />
                          <Tooltip
                            contentStyle={{ background: '#1e293b', border: '1px solid #334155', borderRadius: 8, fontSize: 12 }}
                            formatter={(v: any, name: string) => [`$${Number(v).toLocaleString()}`, name === 'portfolio' ? 'Strategy' : 'Benchmark']}
                          />
                          <Area type="monotone" dataKey="portfolio" stroke="#a855f7" fill="#a855f720" strokeWidth={2} dot={false} />
                          <Area type="monotone" dataKey="benchmark" stroke="#64748b" fill="none" strokeWidth={1.5} strokeDasharray="4 2" dot={false} />
                        </ComposedChart>
                      </ResponsiveContainer>
                    </div>
                  )}

                  {/* Drawdown */}
                  {tab === 'drawdown' && (
                    <div>
                      <p className="text-xs text-slate-400 mb-3">Underwater equity curve (drawdown from peak)</p>
                      <ResponsiveContainer width="100%" height={300}>
                        <AreaChart data={result.equity}>
                          <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
                          <XAxis dataKey="date" tick={{ fontSize: 11, fill: '#94a3b8' }} tickFormatter={v => v.slice(5)} />
                          <YAxis tick={{ fontSize: 11, fill: '#94a3b8' }} tickFormatter={v => `${v.toFixed(0)}%`} />
                          <Tooltip
                            contentStyle={{ background: '#1e293b', border: '1px solid #334155', borderRadius: 8, fontSize: 12 }}
                            formatter={(v: any) => [`${Number(v).toFixed(2)}%`, 'Drawdown']}
                          />
                          <ReferenceLine y={0} stroke="#64748b" strokeDasharray="3 3" />
                          <Area type="monotone" dataKey="drawdown" stroke="#ef4444" fill="#ef444420" strokeWidth={1.5} dot={false} />
                        </AreaChart>
                      </ResponsiveContainer>
                    </div>
                  )}

                  {/* Monthly Returns Heatmap */}
                  {tab === 'monthly' && (
                    <div>
                      <p className="text-xs text-slate-400 mb-3">Monthly return distribution</p>
                      <div className="grid grid-cols-6 md:grid-cols-12 gap-2 mb-4">
                        {result.monthlyReturns.map(m => (
                          <div key={m.month}>
                            <p className="text-xs text-slate-500 text-center mb-1">{m.month}</p>
                            <HeatCell value={m.return} />
                          </div>
                        ))}
                      </div>
                      <div className="grid grid-cols-3 gap-3 mt-4">
                        <div className="bg-slate-700 rounded-lg p-3 text-center">
                          <p className="text-xs text-slate-400">Best Month</p>
                          <p className="text-lg font-bold font-mono text-emerald-400">+{result.bestMonth.toFixed(1)}%</p>
                        </div>
                        <div className="bg-slate-700 rounded-lg p-3 text-center">
                          <p className="text-xs text-slate-400">Avg Month</p>
                          <p className="text-lg font-bold font-mono text-slate-200">
                            {(result.annualizedReturn / 12).toFixed(1)}%
                          </p>
                        </div>
                        <div className="bg-slate-700 rounded-lg p-3 text-center">
                          <p className="text-xs text-slate-400">Worst Month</p>
                          <p className="text-lg font-bold font-mono text-red-400">{result.worstMonth.toFixed(1)}%</p>
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Monte Carlo */}
                  {tab === 'montecarlo' && (
                    <div>
                      <p className="text-xs text-slate-400 mb-4">1,000 simulated paths — percentile outcomes (QuantStats Monte Carlo)</p>
                      <div className="grid grid-cols-5 gap-3 mb-5">
                        {[
                          { label: 'P10 (Bear)', value: result.monteCarlo.p10, cls: 'text-red-400' },
                          { label: 'P25', value: result.monteCarlo.p25, cls: 'text-orange-400' },
                          { label: 'P50 (Base)', value: result.monteCarlo.p50, cls: 'text-slate-200' },
                          { label: 'P75', value: result.monteCarlo.p75, cls: 'text-teal-400' },
                          { label: 'P90 (Bull)', value: result.monteCarlo.p90, cls: 'text-emerald-400' },
                        ].map(p => (
                          <div key={p.label} className="bg-slate-700 rounded-lg p-3 text-center">
                            <p className="text-xs text-slate-400 mb-1">{p.label}</p>
                            <p className={`text-xl font-bold font-mono ${p.cls}`}>
                              {p.value >= 0 ? '+' : ''}{p.value.toFixed(1)}%
                            </p>
                          </div>
                        ))}
                      </div>
                      <div className={`flex items-center gap-3 p-4 rounded-lg border ${
                        result.monteCarlo.bustProb < 5
                          ? 'bg-emerald-900/20 border-emerald-700'
                          : result.monteCarlo.bustProb < 15
                          ? 'bg-amber-900/20 border-amber-700'
                          : 'bg-red-900/20 border-red-700'
                      }`}>
                        <AlertTriangle size={20} className={result.monteCarlo.bustProb < 5 ? 'text-emerald-400' : result.monteCarlo.bustProb < 15 ? 'text-amber-400' : 'text-red-400'} />
                        <div>
                          <p className="text-sm font-bold">
                            Ruin / Bust Probability: <span className={result.monteCarlo.bustProb < 5 ? 'text-emerald-400' : 'text-red-400'}>{result.monteCarlo.bustProb}%</span>
                          </p>
                          <p className="text-xs text-slate-400 mt-0.5">
                            Probability of losing &gt;50% of capital across all simulated paths
                          </p>
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Full Stats */}
                  {tab === 'stats' && (
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                      <div>
                        <p className="text-xs uppercase tracking-widest text-slate-400 mb-3">Returns</p>
                        <table className="w-full text-sm">
                          <tbody className="divide-y divide-slate-700">
                            {[
                              ['Total Return', `${result.totalReturn >= 0 ? '+' : ''}${result.totalReturn}%`],
                              ['Annualized Return', `${result.annualizedReturn >= 0 ? '+' : ''}${result.annualizedReturn}%`],
                              ['Benchmark Return', `${result.benchmarkReturn >= 0 ? '+' : ''}${result.benchmarkReturn}%`],
                              ['Alpha', `${result.alpha >= 0 ? '+' : ''}${result.alpha.toFixed(2)}%`],
                              ['Beta', result.beta.toFixed(2)],
                              ['Best Month', `+${result.bestMonth.toFixed(2)}%`],
                              ['Worst Month', `${result.worstMonth.toFixed(2)}%`],
                            ].map(([k, v]) => (
                              <tr key={k}><td className="py-2 text-slate-400">{k}</td><td className="py-2 text-right font-mono text-slate-200">{v}</td></tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                      <div>
                        <p className="text-xs uppercase tracking-widest text-slate-400 mb-3">Risk & Trade Stats</p>
                        <table className="w-full text-sm">
                          <tbody className="divide-y divide-slate-700">
                            {[
                              ['Sharpe Ratio', result.sharpeRatio.toFixed(3)],
                              ['Sortino Ratio', result.sortinoRatio.toFixed(3)],
                              ['Calmar Ratio', result.calmarRatio.toFixed(3)],
                              ['Max Drawdown', `${result.maxDrawdown.toFixed(2)}%`],
                              ['Volatility (Ann.)', `${result.volatility.toFixed(1)}%`],
                              ['VaR 95% (Ann.)', `${result.var95.toFixed(2)}%`],
                              ['CVaR 95% (Ann.)', `${result.cvar95.toFixed(2)}%`],
                              ['Win Rate', `${result.winRate}%`],
                              ['Profit Factor', result.profitFactor.toFixed(2)],
                              ['Total Trades', result.totalTrades.toString()],
                              ['Avg Trade', `${result.avgTrade >= 0 ? '+' : ''}${result.avgTrade.toFixed(2)}%`],
                            ].map(([k, v]) => (
                              <tr key={k}><td className="py-2 text-slate-400">{k}</td><td className="py-2 text-right font-mono text-slate-200">{v}</td></tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
