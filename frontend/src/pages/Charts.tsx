import { useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  BarChart2, Cpu, Eye, Filter, Layers, TrendingUp, TrendingDown,
  Activity, ShieldCheck, CheckCircle2, AlertTriangle, Info,
  Sliders, RefreshCw, Zap, Clock, Compass, Target, Crosshair, Calendar, List
} from 'lucide-react';
import LastUpdated from '../components/common/LastUpdated';
import {
  getStockCandles, getRegimes, getChartIntelligence, getLiveChart, getPredictions
} from '../services/api';
import SymbolPicker from '../components/common/SymbolPicker';
import { useSelectedSymbol } from '../hooks/useDefaultSymbol';
import { glossaryTitle } from '../constants/glossary';

const REGIME_LABELS: Record<string, string> = {
  TRENDING_BULL: 'Trending Bull',
  TRENDING_BEAR: 'Trending Bear',
  CHOPPY_RANGE: 'Choppy Range',
  HIGH_VOLATILITY: 'High Volatility',
  COMPRESSION: 'Compression',
  RECOVERY: 'Recovery',
  DISTRIBUTION: 'Distribution',
  BULL_TREND: 'Bull Trend',
  BEAR_TREND: 'Bear Trend',
  SIDEWAYS: 'Sideways Chop',
  HIGH_VOL: 'High Volatility',
  CRASH: 'Crash / Capitulation'
};

export default function ChartsPage() {
  const { symbol: selected, market, setSymbol: setSelected, isLoading: defaultLoading } = useSelectedSymbol('all');
  const [timeframe, setTimeframe] = useState<'1m' | '5m' | '15m' | '1h' | '4h' | '1D' | '1W'>('1D');
  const [range, setRange] = useState<'1D' | '5D' | '1M' | '3M' | '6M' | '1Y'>('3M');
  const [activeTab, setActiveTab] = useState<'chart' | 'candles_table' | 'polymarket' | 'ca_cnn' | 'ca_regime' | 'ca_confluence' | 'volume_micro' | 'diagnostic'>('chart');
  
  const chartRef = useRef<HTMLDivElement>(null);
  const chartInstance = useRef<any>(null);

  // Queries
  const { data: liveChartData, isLoading: liveChartLoading, refetch: refetchLiveChart } = useQuery({
    queryKey: ['live-chart', selected, timeframe, range],
    queryFn: () => getLiveChart(selected, timeframe, range),
    refetchInterval: 30000,
    enabled: !!selected,
  });

  const { data: snapshot, isLoading: candlesLoading } = useQuery({
    queryKey: ['candles', selected, market],
    queryFn: () => getStockCandles(selected, market),
    refetchInterval: 60000,
    enabled: !!selected && market === 'crypto',
  });

  const { data: predictions } = useQuery({
    queryKey: ['predictions'],
    queryFn: getPredictions,
    refetchInterval: 30000,
  });

  const { data: regimeMap } = useQuery({
    queryKey: ['regime', selected],
    queryFn: () => getRegimes([selected]),
    refetchInterval: 60000,
    enabled: !!selected,
  });

  const { data: chartAi, isLoading: aiLoading, refetch: refetchAi } = useQuery({
    queryKey: ['chart-ai', selected, market],
    queryFn: () => getChartIntelligence(selected, market),
    refetchInterval: 60000,
    enabled: !!selected,
  });

  // Candles & Indicators resolution
  const hasLiveCandles = liveChartData?.candles && liveChartData.candles.length > 0;
  const candles: any[] = hasLiveCandles ? liveChartData.candles : (snapshot?.candles || []);
  const indicators: any = liveChartData?.indicators || snapshot?.indicators || null;
  const price: number | undefined = liveChartData?.currentPrice ?? snapshot?.price;
  const levels: any = liveChartData?.levels || null;
  const regime = regimeMap?.[selected];

  // Render TradingView Lightweight Charts with dynamic stop-loss, targets, vwap & pivots
  useEffect(() => {
    let mounted = true;

    const render = async () => {
      const { createChart } = await import('lightweight-charts');
      if (!chartRef.current || !mounted || candles.length === 0) return;

      if (chartInstance.current) {
        chartInstance.current.remove();
        chartInstance.current = null;
      }

      const chart = createChart(chartRef.current, {
        width: chartRef.current.clientWidth,
        height: 480,
        // Explicit locale: some browsers/OSes report tags like "en-US@posix"
        // that Intl rejects, which crashed chart creation (blank chart).
        localization: { locale: 'en-US' },
        layout: { background: { color: '#FFFFFF' }, textColor: '#475569' },
        grid: { vertLines: { color: '#F1F5F9' }, horzLines: { color: '#F1F5F9' } },
        crosshair: { mode: 1 },
        rightPriceScale: { borderColor: '#CBD5E1' },
        timeScale: { borderColor: '#CBD5E1', timeVisible: true, secondsVisible: false },
      });
      chartInstance.current = chart;

      const series = chart.addCandlestickSeries({
        upColor: '#10B981', downColor: '#EF4444',
        borderUpColor: '#10B981', borderDownColor: '#EF4444',
        wickUpColor: '#10B981', wickDownColor: '#EF4444',
      });

      const bars = candles.map(c => ({
        time: Math.floor(c.timestamp / 1000) as any,
        open: c.open, high: c.high, low: c.low, close: c.close,
      }));
      series.setData(bars);

      // Stop Loss & Take Profit Visual Drawing Lines
      if (levels?.entryPrice) {
        series.createPriceLine({
          price: levels.entryPrice,
          color: '#3B82F6',
          lineWidth: 1,
          lineStyle: 2,
          title: `ENTRY: $${levels.entryPrice.toFixed(2)}`
        });
      }
      if (levels?.stopLoss) {
        series.createPriceLine({
          price: levels.stopLoss,
          color: '#EF4444',
          lineWidth: 2,
          lineStyle: 0,
          title: `STOP: $${levels.stopLoss.toFixed(2)} (-${levels.stopLossPct}%)`
        });
      }
      if (levels?.takeProfit1) {
        series.createPriceLine({
          price: levels.takeProfit1,
          color: '#10B981',
          lineWidth: 2,
          lineStyle: 0,
          title: `TP1 (2:1): $${levels.takeProfit1.toFixed(2)} (+${levels.takeProfit1GainPct}%)`
        });
      }
      if (levels?.takeProfit2) {
        series.createPriceLine({
          price: levels.takeProfit2,
          color: '#06B6D4',
          lineWidth: 1,
          lineStyle: 2,
          title: `TP2 (3:1): $${levels.takeProfit2.toFixed(2)} (+${levels.takeProfit2GainPct}%)`
        });
      }
      if (levels?.vwap) {
        series.createPriceLine({
          price: levels.vwap,
          color: '#8B5CF6',
          lineWidth: 1,
          lineStyle: 0,
          title: 'VWAP'
        });
      }

      if (indicators?.ema9) series.createPriceLine({ price: indicators.ema9, color: '#F59E0B', lineWidth: 1, lineStyle: 2, title: 'EMA9' });
      if (indicators?.ema21) series.createPriceLine({ price: indicators.ema21, color: '#38BDF8', lineWidth: 1, lineStyle: 2, title: 'EMA21' });
      if (indicators?.ema200) series.createPriceLine({ price: indicators.ema200, color: '#64748B', lineWidth: 1, lineStyle: 2, title: 'EMA200' });

      const volumeSeries = chart.addHistogramSeries({
        color: '#64748B30', priceFormat: { type: 'volume' }, priceScaleId: '',
      });
      volumeSeries.priceScale().applyOptions({ scaleMargins: { top: 0.8, bottom: 0 } });
      volumeSeries.setData(candles.map(c => ({
        time: Math.floor(c.timestamp / 1000) as any,
        value: c.volume,
        color: c.close >= c.open ? '#10B98140' : '#EF444440'
      })));

      chart.timeScale().fitContent();

      const resizeObserver = new ResizeObserver(() => {
        if (chartRef.current && chartInstance.current) {
          chartInstance.current.applyOptions({ width: chartRef.current.clientWidth });
        }
      });
      resizeObserver.observe(chartRef.current);
      return () => resizeObserver.disconnect();
    };

    render();
    return () => {
      mounted = false;
      if (chartInstance.current) {
        chartInstance.current.remove();
        chartInstance.current = null;
      }
    };
  }, [candles, indicators, levels]);

  const trendVsEma9 = indicators?.ema9 && price ? (price >= indicators.ema9 ? 'Above (bullish)' : 'Below (bearish)') : '—';
  const rsiRead = indicators?.rsi14 != null ? (indicators.rsi14 > 70 ? 'Overbought' : indicators.rsi14 < 30 ? 'Oversold' : 'Neutral') : '—';
  const macdRead = indicators?.macd ? (indicators.macd.histogram > 0 ? 'Bullish momentum' : 'Bearish momentum') : '—';
  const bbRead = indicators?.bollingerBands && price
    ? (price >= indicators.bollingerBands.upper ? 'At upper band' : price <= indicators.bollingerBands.lower ? 'At lower band' : 'Inside bands')
    : '—';

  // The chart-AI heuristics are only meaningful when real indicators exist; otherwise the
  // backend falls back to synthetic inputs (e.g. EMA = price × 0.99), so hide them.
  const aiUsable = !!chartAi && !!indicators;
  const cnn = aiUsable ? chartAi?.patternCnn : null;
  const regimeFilter = aiUsable ? chartAi?.regimeFilter : null;
  const confluence = aiUsable ? chartAi?.multiTimeframeConfluence : null;
  const volumeMicro = aiUsable ? chartAi?.volumeMicrostructure : null;
  const diagnostic = aiUsable ? chartAi?.diagnosticAudit : null;
  const rvolNum = typeof volumeMicro?.relativeVolume?.rvol === 'number' && volumeMicro.relativeVolume.rvol > 0 ? volumeMicro.relativeVolume.rvol : null;
  const vwapDiff = typeof volumeMicro?.priceVsVwap?.diffPct === 'number' ? volumeMicro.priceVsVwap.diffPct : null;

  return (
    <div className="space-y-6">
      {/* Header & Controls */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-2">
          <BarChart2 size={22} className="text-apex-accent" />
          <div>
            <h1 className="font-sans font-bold text-2xl text-apex-text">05 · Chart Intelligence Lab</h1>
            <p className="font-sans text-xs text-apex-muted">
              Candlestick AI at Machine Speed: Pattern CNN, Regime Multipliers, Confluence Engine & Microstructure
            </p>
          </div>
        </div>

        <div className="flex items-center gap-3 flex-wrap">
          <LastUpdated />
          {price != null && (
            <div className="font-mono font-bold text-xl text-apex-text bg-apex-surface px-3 py-1 rounded-lg border border-apex-border">
              ${price.toFixed(2)}
            </div>
          )}
          {regimeFilter?.activeRegime && (
            <span className="font-mono text-xs font-bold px-2.5 py-1 rounded bg-apex-accent/10 text-apex-accent border border-apex-accent/20">
              {REGIME_LABELS[regimeFilter.activeRegime] || regimeFilter.activeRegime}
            </span>
          )}
          <SymbolPicker value={selected} onChange={(sym, meta) => setSelected(sym, meta)} data-testid="symbol-picker" />
          <button
            data-testid="recalibrate-ai"
            disabled={!selected}
            onClick={() => refetchAi()}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-apex-border bg-apex-surface hover:bg-apex-surface-2 text-xs font-mono text-apex-text"
          >
            <RefreshCw size={13} className={aiLoading ? 'animate-spin' : ''} />
            <span>Recalibrate AI</span>
          </button>
        </div>
      </div>

      {!selected && (
        <div className="card p-10 text-center" data-testid="chart-empty">
          <div className="font-sans font-bold text-apex-text mb-1">{defaultLoading ? 'Loading…' : 'Pick a symbol'}</div>
          <div className="font-mono text-xs text-apex-muted">Use the symbol picker above to choose any US stock or crypto asset.</div>
        </div>
      )}

      {/* Top heuristic KPI banner — only computed values, no marketing "edge" claims */}
      {selected && (
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <div className="card p-4 border-l-4 border-l-apex-accent" data-testid="kpi-pattern">
          <div className="flex items-center justify-between text-xs font-mono text-apex-muted uppercase">
            <span>CA-1 Pattern Heuristic</span>
            <Cpu size={15} className="text-apex-accent" />
          </div>
          <div className="mt-2 flex items-baseline gap-2">
            <span className="font-mono text-2xl font-bold text-apex-text">
              {typeof cnn?.rawConfidence === 'number' ? `${cnn.rawConfidence}%` : '—'}
            </span>
            <span className="font-mono text-[10px] font-bold text-slate-500 bg-slate-100 px-1.5 py-0.5 rounded">
              unvalidated · no measured edge
            </span>
          </div>
          <div className="mt-1 font-sans text-[11px] text-apex-muted">
            Direction: <strong className="text-apex-text">{cnn?.predictedDirection || '—'}</strong> (RSI/EMA/MACD rule)
          </div>
        </div>

        <div className="card p-4 border-l-4 border-l-blue-500" data-testid="kpi-regime">
          <div className="flex items-center justify-between text-xs font-mono text-apex-muted uppercase">
            <span>CA-2 Regime</span>
            <Filter size={15} className="text-blue-500" />
          </div>
          <div className="mt-2 flex items-baseline gap-2">
            <span className="font-mono text-2xl font-bold text-blue-600">
              {regimeFilter?.activeRegime ? (REGIME_LABELS[regimeFilter.activeRegime] || regimeFilter.activeRegime) : '—'}
            </span>
          </div>
          <div className="mt-1 font-sans text-[11px] text-apex-muted">
            Verdict: <strong className="text-apex-text">{regimeFilter?.verdict || '—'}</strong>
            {typeof regimeFilter?.regimeMultiplier === 'number' && <> · weight {regimeFilter.regimeMultiplier}x (unvalidated)</>}
          </div>
        </div>

        <div className="card p-4 border-l-4 border-l-emerald-500" data-testid="kpi-confluence">
          <div className="flex items-center justify-between text-xs font-mono text-apex-muted uppercase">
            <span>CA-3 Timeframe Agreement</span>
            <Layers size={15} className="text-emerald-500" />
          </div>
          <div className="mt-2 flex items-baseline gap-2">
            <span className="font-mono text-2xl font-bold text-emerald-600">
              {typeof confluence?.confluenceScore === 'number' ? `${(confluence.confluenceScore * 100).toFixed(0)}%` : '—'}
            </span>
            <span className="font-mono text-[10px] font-bold text-slate-500 bg-slate-100 px-1.5 py-0.5 rounded">
              heuristic score
            </span>
          </div>
          <div className="mt-1 font-sans text-[11px] text-apex-muted">
            Status: <strong className="text-apex-text">{confluence?.alignmentStatus?.replace(/_/g, ' ') || '—'}</strong>
          </div>
        </div>

        <div className="card p-4 border-l-4 border-l-purple-500" data-testid="kpi-volume">
          <div className="flex items-center justify-between text-xs font-mono text-apex-muted uppercase">
            <span>Relative Volume & VWAP</span>
            <Activity size={15} className="text-purple-500" />
          </div>
          <div className="mt-2 flex items-baseline gap-2">
            <span className="font-mono text-2xl font-bold text-purple-600">
              {rvolNum !== null ? `${rvolNum}x RVol` : 'RVol —'}
            </span>
            <span className="font-mono text-xs font-bold text-purple-600 bg-purple-500/10 px-1.5 py-0.5 rounded">
              {volumeMicro?.priceVsVwap?.status?.replace(/_/g, ' ') || 'VWAP —'}
            </span>
          </div>
          <div className="mt-1 font-sans text-[11px] text-apex-muted truncate">
            {vwapDiff !== null ? `Price vs VWAP: ${vwapDiff > 0 ? '+' : ''}${vwapDiff}%` : 'No volume data'}
          </div>
        </div>
      </div>
      )}

      {/* Navigation Sub-Tabs */}
      <div className="flex items-center gap-2 border-b border-apex-border pb-2 flex-wrap">
        <button
          data-testid="tab-chart"
          onClick={() => setActiveTab('chart')}
          className={`font-mono text-xs px-3.5 py-1.5 rounded-lg transition-colors flex items-center gap-1.5 ${
            activeTab === 'chart'
              ? 'bg-apex-accent text-white font-bold'
              : 'text-apex-muted hover:text-apex-text hover:bg-apex-surface-2'
          }`}
        >
          <BarChart2 size={13} />
          <span>Interactive Candlesticks</span>
        </button>

        <button
          data-testid="tab-candles-table"
          onClick={() => setActiveTab('candles_table')}
          className={`font-mono text-xs px-3.5 py-1.5 rounded-lg transition-colors flex items-center gap-1.5 ${
            activeTab === 'candles_table'
              ? 'bg-apex-accent text-white font-bold'
              : 'text-apex-muted hover:text-apex-text hover:bg-apex-surface-2'
          }`}
        >
          <List size={13} />
          <span>Candle-by-Candle Inspector</span>
        </button>

        <button
          data-testid="tab-polymarket"
          onClick={() => setActiveTab('polymarket')}
          className={`font-mono text-xs px-3.5 py-1.5 rounded-lg transition-colors flex items-center gap-1.5 ${
            activeTab === 'polymarket'
              ? 'bg-apex-accent text-white font-bold'
              : 'text-apex-muted hover:text-apex-text hover:bg-apex-surface-2'
          }`}
        >
          <Compass size={13} />
          <span>Polymarket Alpha & Probabilities</span>
        </button>

        <button
          data-testid="tab-ca-cnn"
          onClick={() => setActiveTab('ca_cnn')}
          className={`font-mono text-xs px-3.5 py-1.5 rounded-lg transition-colors flex items-center gap-1.5 ${
            activeTab === 'ca_cnn'
              ? 'bg-apex-accent text-white font-bold'
              : 'text-apex-muted hover:text-apex-text hover:bg-apex-surface-2'
          }`}
        >
          <Cpu size={13} />
          <span>CA-1: Pattern CNN (30×4)</span>
        </button>

        <button
          data-testid="tab-ca-regime"
          onClick={() => setActiveTab('ca_regime')}
          className={`font-mono text-xs px-3.5 py-1.5 rounded-lg transition-colors flex items-center gap-1.5 ${
            activeTab === 'ca_regime'
              ? 'bg-apex-accent text-white font-bold'
              : 'text-apex-muted hover:text-apex-text hover:bg-apex-surface-2'
          }`}
        >
          <Filter size={13} />
          <span>CA-2: Regime Filter</span>
        </button>

        <button
          data-testid="tab-ca-confluence"
          onClick={() => setActiveTab('ca_confluence')}
          className={`font-mono text-xs px-3.5 py-1.5 rounded-lg transition-colors flex items-center gap-1.5 ${
            activeTab === 'ca_confluence'
              ? 'bg-apex-accent text-white font-bold'
              : 'text-apex-muted hover:text-apex-text hover:bg-apex-surface-2'
          }`}
        >
          <Layers size={13} />
          <span>CA-3: Confluence (1H/4H/D)</span>
        </button>

        <button
          data-testid="tab-volume-micro"
          onClick={() => setActiveTab('volume_micro')}
          className={`font-mono text-xs px-3.5 py-1.5 rounded-lg transition-colors flex items-center gap-1.5 ${
            activeTab === 'volume_micro'
              ? 'bg-apex-accent text-white font-bold'
              : 'text-apex-muted hover:text-apex-text hover:bg-apex-surface-2'
          }`}
        >
          <Activity size={13} />
          <span>Volume & OBV Microstructure</span>
        </button>

        <button
          data-testid="tab-diagnostic"
          onClick={() => setActiveTab('diagnostic')}
          className={`font-mono text-xs px-3.5 py-1.5 rounded-lg transition-colors flex items-center gap-1.5 ${
            activeTab === 'diagnostic'
              ? 'bg-apex-accent text-white font-bold'
              : 'text-apex-muted hover:text-apex-text hover:bg-apex-surface-2'
          }`}
        >
          <CheckCircle2 size={13} />
          <span>Chart & Options Diagnostic Audit</span>
        </button>
      </div>

      {/* Main Chart View */}
      {selected && activeTab === 'chart' && (
        <div className="space-y-4">
          {/* Timeframe & Calendar Filter Bar */}
          <div className="flex items-center justify-between flex-wrap gap-3 bg-apex-surface p-3 rounded-xl border border-apex-border">
            <div className="flex items-center gap-1.5">
              <span className="font-mono text-[10px] text-apex-muted uppercase font-semibold mr-1">Timeframe:</span>
              {(['1m', '5m', '15m', '1h', '4h', '1D', '1W'] as const).map(tf => (
                <button
                  key={tf}
                  data-testid={`timeframe-${tf}`}
                  onClick={() => setTimeframe(tf)}
                  className={`font-mono text-xs px-2.5 py-1 rounded transition-colors ${
                    timeframe === tf
                      ? 'bg-apex-accent text-white font-bold shadow-sm'
                      : 'bg-apex-surface-2 text-apex-muted hover:text-apex-text'
                  }`}
                >
                  {tf}
                </button>
              ))}
            </div>

            <div className="flex items-center gap-1.5">
              <span className="font-mono text-[10px] text-apex-muted uppercase font-semibold mr-1">Range:</span>
              {(['1D', '5D', '1M', '3M', '6M', '1Y'] as const).map(r => (
                <button
                  key={r}
                  data-testid={`range-${r}`}
                  onClick={() => setRange(r)}
                  className={`font-mono text-xs px-2.5 py-1 rounded transition-colors ${
                    range === r
                      ? 'bg-emerald-600 text-white font-bold shadow-sm'
                      : 'bg-apex-surface-2 text-apex-muted hover:text-apex-text'
                  }`}
                >
                  {r}
                </button>
              ))}
            </div>
          </div>

          {/* Dynamic Stop-Loss & Take-Profit Levels HUD */}
          {levels && typeof levels.entryPrice === 'number' && typeof levels.stopLoss === 'number' && typeof levels.takeProfit1 === 'number' && typeof levels.takeProfit2 === 'number' && typeof levels.vwap === 'number' && (
            <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
              <div className="p-3 rounded-lg bg-blue-500/10 border border-blue-500/30">
                <div className="font-mono text-[10px] text-blue-400 font-semibold uppercase">Calculated Entry</div>
                <div className="font-mono text-base font-bold text-blue-300 mt-0.5">${levels.entryPrice.toFixed(2)}</div>
                <div className="font-mono text-[10px] text-blue-400/80 mt-0.5">Live Market Quote</div>
              </div>

              <div className="p-3 rounded-lg bg-rose-500/10 border border-rose-500/30">
                <div className="font-mono text-[10px] text-rose-400 font-semibold uppercase">Dynamic Stop Loss</div>
                <div className="font-mono text-base font-bold text-rose-300 mt-0.5">${levels.stopLoss.toFixed(2)}</div>
                <div className="font-mono text-[10px] text-rose-400/80 mt-0.5">-{levels.stopLossPct}% (2× ATR)</div>
              </div>

              <div className="p-3 rounded-lg bg-emerald-500/10 border border-emerald-500/30">
                <div className="font-mono text-[10px] text-emerald-400 font-semibold uppercase">Take Profit 1 (2:1)</div>
                <div className="font-mono text-base font-bold text-emerald-300 mt-0.5">${levels.takeProfit1.toFixed(2)}</div>
                <div className="font-mono text-[10px] text-emerald-400/80 mt-0.5">+{levels.takeProfit1GainPct}% (LAW 3)</div>
              </div>

              <div className="p-3 rounded-lg bg-cyan-500/10 border border-cyan-500/30">
                <div className="font-mono text-[10px] text-cyan-400 font-semibold uppercase">Take Profit 2 (3:1)</div>
                <div className="font-mono text-base font-bold text-cyan-300 mt-0.5">${levels.takeProfit2.toFixed(2)}</div>
                <div className="font-mono text-[10px] text-cyan-400/80 mt-0.5">+{levels.takeProfit2GainPct}% Runner</div>
              </div>

              <div className="p-3 rounded-lg bg-purple-500/10 border border-purple-500/30">
                <div className="font-mono text-[10px] text-purple-400 font-semibold uppercase">VWAP & Pivot</div>
                <div className="font-mono text-base font-bold text-purple-300 mt-0.5">${levels.vwap.toFixed(2)}</div>
                <div className="font-mono text-[10px] text-purple-400/80 mt-0.5">PP: {typeof levels.pivotPoint === 'number' ? `$${levels.pivotPoint.toFixed(2)}` : '—'}</div>
              </div>
            </div>
          )}

          <div className="p-0 overflow-hidden bg-white border border-slate-200/90 rounded-xl shadow-sm">
            <div className="flex p-4 border-b border-slate-100 items-center justify-between flex-wrap gap-2 bg-slate-50/50">
              <span className="font-semibold text-slate-900 flex items-center gap-2">
                <span>{selected} Candlestick & Level Lab — {timeframe} ({range})</span>
                <span className="font-mono text-xs px-2 py-0.5 rounded bg-blue-50 text-blue-700 border border-blue-200 font-bold">
                  🛑 Stop: ${levels?.stopLoss || '—'} · 🎯 TP: ${levels?.takeProfit1 || '—'} · VWAP: ${levels?.vwap || '—'}
                </span>
              </span>
              {hasLiveCandles ? (
                <span className="font-mono text-xs text-emerald-600 font-bold flex items-center gap-1">
                  <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
                  Live data {liveChartData?.source ? `· ${liveChartData.source}` : ''}
                </span>
              ) : (
                <span className="font-mono text-xs text-slate-400 font-bold">No live feed</span>
              )}
            </div>

            {(candlesLoading || liveChartLoading) && <div className="p-10 text-center font-mono text-xs text-slate-400">Streaming real-time chart candles...</div>}
            {!candlesLoading && !liveChartLoading && candles.length === 0 && (
              <div className="p-10 text-center font-mono text-xs text-slate-400">No candle data available for {selected}</div>
            )}
            <div ref={chartRef} className="w-full" style={{ height: 480, display: candles.length ? 'block' : 'none' }} />
          </div>

          {/* Quick Technical Indicator Readings */}
          {indicators && (
            <div className="card">
              <h2 className="font-sans font-semibold text-apex-text mb-4">How Institutional Algorithmic Engines Read This Chart</h2>
              <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4">
                {[
                  { label: 'Trend vs EMA9', value: trendVsEma9 },
                  { label: `RSI(14) ${indicators.rsi14?.toFixed(1) ?? ''}`, value: rsiRead },
                  { label: 'MACD Momentum', value: macdRead },
                  { label: 'Bollinger Band State', value: bbRead },
                  { label: 'VWAP Relationship', value: volumeMicro?.priceVsVwap?.status?.replace(/_/g, ' ') || '—' },
                ].map(s => (
                  <div key={s.label} className="p-3 rounded-lg border border-apex-border bg-apex-surface" title={glossaryTitle(s.label)}>
                    <div className="font-mono text-[10px] text-apex-muted uppercase mb-1 border-b border-dotted border-apex-muted/50 inline-block">{s.label}</div>
                    <div className="font-sans font-bold text-sm text-apex-text">{s.value}</div>
                  </div>
                ))}
              </div>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mt-4">
                {[
                  { label: 'EMA9', value: indicators.ema9 },
                  { label: 'EMA21', value: indicators.ema21 },
                  { label: 'EMA200', value: indicators.ema200 },
                  { label: 'VWAP', value: indicators.vwap },
                  { label: 'ATR14', value: indicators.atr14 },
                  { label: 'Bollinger Upper', value: indicators.bollingerBands?.upper },
                  { label: 'Bollinger Lower', value: indicators.bollingerBands?.lower },
                  { label: 'MACD Histogram', value: indicators.macd?.histogram },
                ].map(s => (
                  <div key={s.label} title={glossaryTitle(s.label)}>
                    <div className="font-mono text-[10px] text-apex-muted tracking-widest mb-1 border-b border-dotted border-apex-muted/50 inline-block">{s.label}</div>
                    <div className="font-mono font-bold text-apex-text">{s.value != null ? Number(s.value).toFixed(2) : '—'}</div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Candle-by-Candle Quantitative Inspector */}
      {activeTab === 'candles_table' && (
        <div className="space-y-4">
          <div className="card bg-white border border-slate-200/90 rounded-xl p-5 shadow-sm">
            <div className="flex items-center justify-between flex-wrap gap-4 border-b border-slate-100 pb-4">
              <div>
                <h2 className="font-sans font-bold text-lg text-slate-900 flex items-center gap-2">
                  <List size={18} className="text-emerald-600" />
                  Candle-by-Candle Microstructure Inspector: {selected} ({timeframe})
                </h2>
                <p className="font-mono text-xs text-slate-500 mt-1">
                  Full tick-level breakdown of every candlestick up and down with body-to-wick mathematical classification
                </p>
              </div>
              <div className="flex items-center gap-2">
                <span className="font-mono text-xs px-2.5 py-1 rounded bg-slate-100 border border-slate-200 text-slate-700 font-bold">
                  {candles.length} Candles Loaded
                </span>
              </div>
            </div>

            <div className="overflow-x-auto mt-4">
              <table className="w-full text-left font-mono text-xs">
                <thead>
                  <tr className="border-b border-slate-200 text-slate-500 uppercase text-[10px] bg-slate-50/50">
                    <th className="py-2.5 px-3">Date / Time</th>
                    <th className="py-2.5 px-3">Type</th>
                    <th className="py-2.5 px-3">Open</th>
                    <th className="py-2.5 px-3">High</th>
                    <th className="py-2.5 px-3">Low</th>
                    <th className="py-2.5 px-3">Close</th>
                    <th className="py-2.5 px-3">Change %</th>
                    <th className="py-2.5 px-3">Upper Wick</th>
                    <th className="py-2.5 px-3">Lower Wick</th>
                    <th className="py-2.5 px-3">Pattern Detected</th>
                    <th className="py-2.5 px-3 text-right">Volume</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {[...candles].reverse().map((c: any, idx: number) => {
                    const isBull = c.isBullish ?? (c.close >= c.open);
                    return (
                      <tr key={idx} className="hover:bg-slate-50/80 transition-colors">
                        <td className="py-2.5 px-3 text-slate-700 font-sans">
                          {Number.isFinite(new Date(c.timestamp).getTime()) ? new Date(c.timestamp).toLocaleString('en-US', {
                            month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit'
                          }) : '—'}
                        </td>
                        <td className="py-2.5 px-3">
                          <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                            isBull ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                                   : 'bg-rose-50 text-rose-700 border border-rose-200'
                          }`}>
                            {isBull ? '▲ BULL' : '▼ BEAR'}
                          </span>
                        </td>
                        <td className="py-2.5 px-3 text-slate-800">${c.open?.toFixed(2)}</td>
                        <td className="py-2.5 px-3 text-emerald-600 font-bold">${c.high?.toFixed(2)}</td>
                        <td className="py-2.5 px-3 text-rose-600 font-bold">${c.low?.toFixed(2)}</td>
                        <td className="py-2.5 px-3 text-slate-900 font-bold">${c.close?.toFixed(2)}</td>
                        <td className={`py-2.5 px-3 font-bold ${isBull ? 'text-emerald-600' : 'text-rose-600'}`}>
                          {typeof c.changePct === 'number' ? `${c.changePct >= 0 ? '+' : ''}${c.changePct.toFixed(2)}%` : '—'}
                        </td>
                        <td className="py-2.5 px-3 text-slate-500">{typeof c.wickUpper === 'number' ? `$${c.wickUpper.toFixed(2)}` : '—'}</td>
                        <td className="py-2.5 px-3 text-slate-500">{typeof c.wickLower === 'number' ? `$${c.wickLower.toFixed(2)}` : '—'}</td>
                        <td className="py-2.5 px-3">
                          <span className={`px-2 py-0.5 rounded text-[10px] font-sans ${
                            c.pattern && c.pattern !== 'Standard'
                              ? 'bg-amber-50 text-amber-700 border border-amber-200 font-bold'
                              : 'text-slate-500'
                          }`}>
                            {c.pattern || 'Standard'}
                          </span>
                        </td>
                        <td className="py-2.5 px-3 text-right text-slate-500">
                          {c.volume ? c.volume.toLocaleString() : '—'}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* Polymarket Alpha & Probabilities Tab */}
      {activeTab === 'polymarket' && (
        <div className="space-y-4">
          <div className="card bg-white border border-slate-200/90 rounded-xl p-5 shadow-sm">
            <div className="flex items-center justify-between flex-wrap gap-4 border-b border-slate-100 pb-4">
              <div>
                <h2 className="font-sans font-bold text-lg text-slate-900 flex items-center gap-2">
                  <Compass size={18} className="text-blue-600" />
                  Polymarket Live Probabilities & Edge Radar
                </h2>
                <p className="font-mono text-xs text-slate-500 mt-1">
                  Autonomous probability analysis: implied market probability vs Bayesian AI fair value & Kelly criterion sizing
                </p>
              </div>
              <div className="flex items-center gap-2">
                <span className="font-mono text-xs px-2.5 py-1 rounded bg-blue-50 border border-blue-200 text-blue-700 font-bold">
                  {Array.isArray(predictions) ? `${predictions.length} markets` : 'No data'}
                </span>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 mt-4">
              {(Array.isArray(predictions) ? predictions : []).length === 0 && (
                <div className="col-span-full text-center py-8 font-mono text-xs text-slate-400">No prediction markets returned by the API.</div>
              )}
              {(Array.isArray(predictions) ? predictions : []).map((pred: any) => {
                const yesPrice: number | null = typeof pred.yesPrice === 'number' ? pred.yesPrice : null;
                const noPrice: number | null = typeof pred.noPrice === 'number' ? pred.noPrice : (yesPrice !== null ? 1 - yesPrice : null);
                const ev: number | null = typeof pred.expectedValue === 'number' ? pred.expectedValue
                  : (typeof pred.impliedProbability === 'number' && yesPrice !== null ? (pred.impliedProbability - yesPrice) * 100 : null);
                const hasEdge = ev !== null && ev > 3;

                return (
                  <div key={pred.id} className="p-4 rounded-xl bg-slate-50 border border-slate-200 hover:border-slate-300 transition-all flex flex-col justify-between space-y-4">
                    <div>
                      <div className="flex items-center justify-between gap-2 mb-2">
                        <span className="font-mono text-[10px] text-slate-500 uppercase tracking-wider">{pred.category || '—'}</span>
                        <span className={`font-mono text-[10px] px-2 py-0.5 rounded font-bold ${
                          hasEdge ? 'bg-emerald-50 text-emerald-700 border border-emerald-200' : 'bg-slate-200 text-slate-600'
                        }`}>
                          {ev === null ? 'EV —' : hasEdge ? `+${ev.toFixed(1)}% EV EDGE` : 'NO EDGE'}
                        </span>
                      </div>
                      <h3 className="font-sans font-bold text-sm text-slate-900 line-clamp-2" title={pred.title}>
                        {pred.title}
                      </h3>
                    </div>

                    <div className="space-y-2">
                      <div className="flex items-center justify-between font-mono text-xs">
                        <span className="text-emerald-700 font-bold">YES: {yesPrice !== null ? `$${yesPrice.toFixed(2)} (${(yesPrice * 100).toFixed(0)}%)` : '—'}</span>
                        <span className="text-rose-700 font-bold">NO: {noPrice !== null ? `$${noPrice.toFixed(2)} (${(noPrice * 100).toFixed(0)}%)` : '—'}</span>
                      </div>

                      <div className="w-full bg-slate-200 rounded-full h-2 overflow-hidden flex">
                        <div className="bg-emerald-500 h-2" style={{ width: `${(yesPrice ?? 0) * 100}%` }} />
                        <div className="bg-rose-500 h-2" style={{ width: `${(noPrice ?? 0) * 100}%` }} />
                      </div>

                      <div className="flex items-center justify-between text-[11px] font-mono text-slate-500 pt-1">
                        <span>Kelly Size: <strong className="text-slate-800">{typeof pred.kellyFraction === 'number' ? `${(pred.kellyFraction * 100).toFixed(1)}%` : '—'}</strong></span>
                        <span>Vol: <strong className="text-slate-800">${pred.volume24h ? (pred.volume24h / 1000).toFixed(0) + 'k' : '—'}</strong></span>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* CA-1: Pattern CNN Analyzer */}
      {activeTab === 'ca_cnn' && cnn && (
        <div className="space-y-4">
          <div className="card p-6 border-l-4 border-l-apex-accent">
            <div className="flex items-center justify-between flex-wrap gap-3">
              <div>
                <span className="font-mono text-xs text-apex-accent font-bold uppercase tracking-wider">CA-1 · Candlestick AI Architecture</span>
                <h2 className="font-sans font-bold text-xl text-apex-text mt-1">
                  Pattern CNN (Convolutional Neural Network)
                </h2>
                <p className="font-sans text-xs text-apex-muted mt-1 max-w-3xl">
                  The probabilities below come from a rule-based heuristic over RSI, EMA9/EMA21 and MACD on the latest candles. No trained model accuracy or edge has been measured for this system, so treat them as descriptive, not predictive.
                </p>
              </div>
              <div className="text-right">
                <div className="font-mono text-3xl font-bold text-apex-text">{cnn.rawConfidence}%</div>
                <div className="font-mono text-xs text-slate-500 font-bold">Predicted: {cnn.predictedDirection} (heuristic — edge not measured)</div>
              </div>
            </div>

            {/* Neural Net Probabilities */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 my-6">
              <div className="p-4 rounded-lg bg-emerald-500/10 border border-emerald-500/20">
                <div className="font-mono text-xs text-emerald-600 font-bold uppercase">P(UP) Forward Direction</div>
                <div className="font-mono text-3xl font-bold text-emerald-600 mt-1">
                  {typeof cnn.probabilities?.up === 'number' ? `${(cnn.probabilities.up * 100).toFixed(1)}%` : '—'}
                </div>
                <div className="font-sans text-[11px] text-apex-muted mt-1">Bullish continuation / expansion probability</div>
              </div>

              <div className="p-4 rounded-lg bg-amber-500/10 border border-amber-500/20">
                <div className="font-mono text-xs text-amber-600 font-bold uppercase">P(FLAT) Mean Reversion</div>
                <div className="font-mono text-3xl font-bold text-amber-600 mt-1">
                  {typeof cnn.probabilities?.flat === 'number' ? `${(cnn.probabilities.flat * 100).toFixed(1)}%` : '—'}
                </div>
                <div className="font-sans text-[11px] text-apex-muted mt-1">Rangebound chop within 0.5 ATR buffer</div>
              </div>

              <div className="p-4 rounded-lg bg-rose-500/10 border border-rose-500/20">
                <div className="font-mono text-xs text-rose-600 font-bold uppercase">P(DOWN) Distribution</div>
                <div className="font-mono text-3xl font-bold text-rose-600 mt-1">
                  {typeof cnn.probabilities?.down === 'number' ? `${(cnn.probabilities.down * 100).toFixed(1)}%` : '—'}
                </div>
                <div className="font-sans text-[11px] text-apex-muted mt-1">Bearish distribution / liquidation probability</div>
              </div>
            </div>

            {/* Visual 30x4 Matrix Heatmap Representation */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <span className="font-sans font-bold text-sm text-apex-text">Normalized 30-Day OHLC Input Tensor (Shape: [30, 4])</span>
                <span className="font-mono text-[10px] text-apex-muted">Values clamped in [0.000, 1.000] range</span>
              </div>
              <div className="p-3 rounded-lg bg-apex-surface border border-apex-border overflow-x-auto">
                <div className="grid grid-flow-col auto-cols-max gap-1">
                  {(Array.isArray(cnn.normalizedMatrix) ? cnn.normalizedMatrix : []).map((candleRow: number[], idx: number) => (
                    <div key={idx} className="flex flex-col gap-1 items-center">
                      {candleRow.map((val: number, cIdx: number) => (
                        <div
                          key={cIdx}
                          title={`Day T-${30 - idx} [${['Open', 'High', 'Low', 'Close'][cIdx]}]: ${val}`}
                          className="w-4 h-4 rounded-sm flex items-center justify-center text-[7px] font-mono select-none"
                          style={{
                            backgroundColor: cIdx === 3
                              ? (val >= candleRow[0] ? `rgba(18, 128, 95, ${Math.max(0.2, val)})` : `rgba(176, 38, 59, ${Math.max(0.2, val)})`)
                              : `rgba(91, 100, 114, ${Math.max(0.15, val * 0.8)})`,
                            color: val > 0.5 ? '#FFFFFF' : '#14171F'
                          }}
                        />
                      ))}
                      <span className="font-mono text-[8px] text-apex-muted">{idx + 1}</span>
                    </div>
                  ))}
                </div>
              </div>
              <div className="flex items-center justify-between font-mono text-[10px] text-apex-muted mt-1.5">
                <span>Row legend: 1=Open, 2=High, 3=Low, 4=Close</span>
                <span>Day T-30 ─────────────► Day T-0 (Current)</span>
              </div>
            </div>

            <div className="mt-6 p-3 rounded-lg bg-amber-50 border border-amber-200 font-sans text-xs text-amber-800">
              Accuracy / edge statistics are not shown because none have been measured on this system's own trades.
            </div>
          </div>
        </div>
      )}

      {/* CA-2: Regime-Context Pattern Filter */}
      {activeTab === 'ca_regime' && regimeFilter && (
        <div className="space-y-4">
          <div className="card p-6 border-l-4 border-l-blue-500">
            <div className="flex items-center justify-between flex-wrap gap-3">
              <div>
                <span className="font-mono text-xs text-blue-500 font-bold uppercase tracking-wider">CA-2 · Context Optimization</span>
                <h2 className="font-sans font-bold text-xl text-apex-text mt-1">
                  Regime-Context Pattern Filter (regime filter · unvalidated)
                </h2>
                <p className="font-sans text-xs text-apex-muted mt-1 max-w-3xl">
                  The same pattern can mean different things in different regimes, so the heuristic direction is re-weighted by the detected regime. The weights are fixed rules, not fitted on data, and have not been validated.
                </p>
              </div>
              <div className="text-right">
                <span className="font-mono text-3xl font-bold text-blue-600">{regimeFilter.regimeMultiplier}x</span>
                <div className="font-mono text-xs text-apex-muted">Regime weight (unvalidated)</div>
              </div>
            </div>

            {/* Multipliers Matrix */}
            <div className="grid grid-cols-1 md:grid-cols-5 gap-3 my-5">
              {[
                { regime: 'BULL_TREND', mult: '+35% Bull / -20% Bear', active: regimeFilter.activeRegime === 'BULL_TREND' },
                { regime: 'BEAR_TREND', mult: '+40% Bear / -35% Bull', active: regimeFilter.activeRegime === 'BEAR_TREND' },
                { regime: 'SIDEWAYS', mult: '-15% Breakout / +45% Mean Rev', active: regimeFilter.activeRegime === 'SIDEWAYS' },
                { regime: 'HIGH_VOL', mult: '-25% All (Extreme Only)', active: regimeFilter.activeRegime === 'HIGH_VOL' },
                { regime: 'CRASH', mult: 'Capitulation Only (RSI < 20)', active: regimeFilter.activeRegime === 'CRASH' }
              ].map(r => (
                <div
                  key={r.regime}
                  className={`p-3 rounded-lg border transition-all ${
                    r.active
                      ? 'border-blue-500 bg-blue-500/10 shadow-sm'
                      : 'border-apex-border bg-apex-surface opacity-70'
                  }`}
                >
                  <div className="font-mono text-[10px] text-apex-muted uppercase font-bold">{r.regime}</div>
                  <div className="font-mono text-xs font-bold text-apex-text mt-1">{r.mult}</div>
                  {r.active && <div className="font-mono text-[10px] text-blue-600 font-bold mt-1">● Active State</div>}
                </div>
              ))}
            </div>

            <div className="p-4 rounded-lg bg-apex-surface-2 border border-apex-border">
              <div className="flex items-center gap-2 mb-1">
                <CheckCircle2 size={16} className="text-blue-500" />
                <span className="font-sans font-bold text-sm text-apex-text">Context Filter Evaluation</span>
              </div>
              <p className="font-sans text-xs text-apex-text leading-relaxed">
                {regimeFilter.explanation}
              </p>
              <div className="mt-2 font-mono text-[10px] text-apex-muted">
                Signal suppressed: <strong className="text-apex-text">{regimeFilter.falseSignalEliminated ? 'YES (signal suppressed by regime rule)' : 'NO'}</strong>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* CA-3: Multi-Timeframe Confluence Detector */}
      {activeTab === 'ca_confluence' && confluence && (
        <div className="space-y-4">
          <div className="card p-6 border-l-4 border-l-emerald-500">
            <div className="flex items-center justify-between flex-wrap gap-3">
              <div>
                <span className="font-mono text-xs text-emerald-500 font-bold uppercase tracking-wider">CA-3 · Confluence Engine</span>
                <h2 className="font-sans font-bold text-xl text-apex-text mt-1">
                  Multi-Timeframe Agreement (heuristic)
                </h2>
                <p className="font-sans text-xs text-apex-muted mt-1 max-w-3xl">
                  Scores whether short-, medium- and long-horizon indicators point the same way. Scores are rule-based; no win-rate improvement has been measured.
                </p>
              </div>
              <div className="text-right">
                <div className="font-mono text-3xl font-bold text-emerald-600">
                  {typeof confluence.confluenceScore === 'number' ? `${(confluence.confluenceScore * 100).toFixed(0)}%` : '—'}
                </div>
                <div className="font-mono text-xs text-apex-muted">Agreement score</div>
              </div>
            </div>

            {/* Timeframe Gauge Cards */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 my-6">
              {[
                { label: 'Short horizon', data: confluence.timeframes?.h1 },
                { label: 'Medium horizon', data: confluence.timeframes?.h4 },
                { label: 'Long horizon', data: confluence.timeframes?.daily },
              ].filter(tf => tf.data).map(tf => (
                <div key={tf.label} className="p-4 rounded-lg bg-apex-surface border border-apex-border">
                  <div className="flex items-center justify-between">
                    <span className="font-mono text-[10px] text-apex-muted uppercase font-bold">{tf.label}</span>
                    <span className={`font-mono text-xs font-bold px-2 py-0.5 rounded ${
                      tf.data.direction === 'UP' ? 'bg-emerald-500/10 text-emerald-600' : 'bg-rose-500/10 text-rose-600'
                    }`}>
                      {tf.data.direction}
                    </span>
                  </div>
                  <div className="mt-2 font-mono text-2xl font-bold text-apex-text">
                    {typeof tf.data.score === 'number' ? `${(tf.data.score * 100).toFixed(0)}% Score` : '—'}
                  </div>
                  <div className="mt-1 font-sans text-xs text-apex-muted">
                    RSI: {tf.data.rsi ?? '—'}
                  </div>
                </div>
              ))}
            </div>

            {/* Sizing & Rules Card */}
            <div className="p-4 rounded-lg bg-apex-surface-2 border border-apex-border space-y-3">
              <div className="flex items-center justify-between">
                <span className="font-sans font-bold text-sm text-apex-text">Position Sizing & Execution Protocol</span>
                <span className="font-mono text-xs font-bold text-emerald-600 bg-emerald-500/10 px-2 py-0.5 rounded">
                  {typeof confluence.positionSizingMultiplier === 'number' ? `${(confluence.positionSizingMultiplier * 100).toFixed(0)}% sizing rule` : '—'}
                </span>
              </div>
              <p className="font-sans text-xs text-apex-text leading-relaxed">
                {String(confluence.recommendation || '—').replace(/\s*\(\+?\d+% win rate edge\)/i, '')}
              </p>
              <div className="font-mono text-[11px] text-apex-muted border-t border-apex-border pt-2">
                Agreement score = mean of the three horizon scores = {typeof confluence.confluenceScore === 'number' ? confluence.confluenceScore.toFixed(2) : '—'}.
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Volume Microstructure & OBV Divergence */}
      {activeTab === 'volume_micro' && volumeMicro && (
        <div className="space-y-4">
          <div className="card p-6 border-l-4 border-l-purple-500">
            <div className="flex items-center justify-between flex-wrap gap-3">
              <div>
                <span className="font-mono text-xs text-purple-600 font-bold uppercase tracking-wider">Microstructure Analysis</span>
                <h2 className="font-sans font-bold text-xl text-apex-text mt-1">
                  Volume Microstructure: The Real Institutional Signal
                </h2>
                <p className="font-sans text-xs text-apex-muted mt-1 max-w-3xl">
                  Price can be manipulated for seconds; volume cannot. When price moves on 10x volume, that is real institutional demand. When it moves on 0.3x volume, it is a head fake.
                </p>
              </div>
              <div className="text-right">
                <span className="font-mono text-2xl font-bold text-purple-600">{volumeMicro.relativeVolume.rvol}x RVol</span>
                <div className="font-mono text-xs text-apex-muted">Relative Volume Ratio</div>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 my-6">
              {/* VWAP Card */}
              <div className="p-4 rounded-lg bg-apex-surface border border-apex-border">
                <div className="flex items-center justify-between">
                  <span className="font-mono text-xs text-purple-600 font-bold uppercase">VWAP Relationship</span>
                  <span className="font-mono text-xs font-bold text-emerald-600">
                    {volumeMicro.priceVsVwap.continuationProbability}% Continuation Prob
                  </span>
                </div>
                <div className="mt-2 font-mono text-xl font-bold text-apex-text">
                  {volumeMicro.priceVsVwap.status.replace(/_/g, ' ')} ({volumeMicro.priceVsVwap.diffPct > 0 ? '+' : ''}{volumeMicro.priceVsVwap.diffPct}%)
                </div>
                <p className="mt-2 font-sans text-xs text-apex-muted leading-relaxed">
                  {volumeMicro.priceVsVwap.institutionalAction}
                </p>
              </div>

              {/* OBV Divergence Card */}
              <div className="p-4 rounded-lg bg-apex-surface border border-apex-border">
                <div className="flex items-center justify-between">
                  <span className="font-mono text-xs text-purple-600 font-bold uppercase">OBV Divergence Radar</span>
                  <span className="font-mono text-xs font-bold text-purple-600 bg-purple-500/10 px-2 py-0.5 rounded">
                    {volumeMicro.obvAnalysis.leadTimeWeeks} Lead Time
                  </span>
                </div>
                <div className="mt-2 font-mono text-xl font-bold text-apex-text">
                  {volumeMicro.obvAnalysis.trend} Phase
                </div>
                <p className="mt-2 font-sans text-xs text-apex-muted leading-relaxed">
                  {volumeMicro.obvAnalysis.warning}
                </p>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Chart & Option Diagnostic Audit */}
      {activeTab === 'diagnostic' && diagnostic && (
        <div className="space-y-4">
          <div className="card p-6 border-l-4 border-l-emerald-500">
            <div className="flex items-center justify-between flex-wrap gap-3">
              <div>
                <span className="font-mono text-xs text-emerald-600 font-bold uppercase tracking-wider">Quality Assurance & Signal Pruning</span>
                <h2 className="font-sans font-bold text-xl text-apex-text mt-1">
                  Chart & Indicator Diagnostic Audit
                </h2>
                <p className="font-sans text-xs text-apex-muted mt-1 max-w-3xl">
                  Evaluation: "Are all charts and options working well, or whether do we need them or not?" Pruning redundant noise indicators prevents analysis paralysis and algorithmic lag.
                </p>
              </div>
              <div className="flex items-center gap-3">
                <div className="text-center p-3 rounded-lg bg-emerald-500/10 border border-emerald-500/20">
                  <div className="font-mono text-2xl font-bold text-emerald-600">{diagnostic.overallChartHealthScore}%</div>
                  <div className="font-mono text-[10px] text-apex-muted">Chart Health</div>
                </div>
                <div className="text-center p-3 rounded-lg bg-apex-surface-2 border border-apex-border">
                  <div className="font-mono text-2xl font-bold text-apex-text">{diagnostic.essentialCount} / {diagnostic.indicators.length}</div>
                  <div className="font-mono text-[10px] text-apex-muted">Essential Kept</div>
                </div>
              </div>
            </div>

            {/* Diagnostic Table */}
            <div className="mt-6 overflow-x-auto">
              <table className="w-full text-left font-sans text-xs">
                <thead>
                  <tr className="border-b border-apex-border text-apex-muted font-mono text-[10px] uppercase">
                    <th className="pb-3">Indicator / Option</th>
                    <th className="pb-3">Current Value</th>
                    <th className="pb-3">Reliability</th>
                    <th className="pb-3">Signal Edge</th>
                    <th className="pb-3">Do We Need It?</th>
                    <th className="pb-3">Action Recommendation</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-apex-border">
                  {diagnostic.indicators.map((ind: any) => (
                    <tr key={ind.indicator} className="hover:bg-apex-surface-2/40 transition-colors">
                      <td className="py-3 font-mono font-bold text-apex-text">{ind.indicator}</td>
                      <td className="py-3 font-mono text-apex-text">{ind.currentValue}</td>
                      <td className="py-3">
                        <div className="flex items-center gap-2">
                          <div className="w-16 bg-apex-border rounded-full h-1.5 overflow-hidden">
                            <div className="bg-emerald-500 h-1.5 rounded-full" style={{ width: `${ind.reliabilityScore}%` }} />
                          </div>
                          <span className="font-mono text-xs">{ind.reliabilityScore}%</span>
                        </div>
                      </td>
                      <td className="py-3">
                        <span className={`font-mono text-[10px] px-2 py-0.5 rounded font-bold ${
                          ind.status === 'STRONG_EDGE' ? 'bg-emerald-500/10 text-emerald-600' :
                          ind.status === 'WORKING_WELL' ? 'bg-blue-500/10 text-blue-600' :
                          'bg-amber-500/10 text-amber-600'
                        }`}>
                          {ind.status.replace(/_/g, ' ')}
                        </span>
                      </td>
                      <td className="py-3">
                        {ind.needIt ? (
                          <span className="font-mono text-xs font-bold text-emerald-600 flex items-center gap-1">
                            <CheckCircle2 size={13} /> YES (Essential)
                          </span>
                        ) : (
                          <span className="font-mono text-xs font-bold text-amber-600 flex items-center gap-1">
                            <AlertTriangle size={13} /> NO (Prune Noise)
                          </span>
                        )}
                      </td>
                      <td className="py-3 font-sans text-xs text-apex-muted">
                        {ind.recommendation}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="mt-4 p-3 rounded-lg bg-apex-surface border border-apex-border font-sans text-xs text-apex-muted">
              <strong>Summary Verdict:</strong> {diagnostic.summary}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
