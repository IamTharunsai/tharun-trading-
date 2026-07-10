import { useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { BarChart2 } from 'lucide-react';
import LastUpdated from '../components/common/LastUpdated';
import { getStockCandles, getRegimes, getStocksUniverse, getPositions } from '../services/api';
import { STOCK_LIST, CRYPTO_LIST } from '../constants/assets';

const REGIME_LABELS: Record<string, string> = {
  TRENDING_BULL: 'Trending Bull',
  TRENDING_BEAR: 'Trending Bear',
  CHOPPY_RANGE: 'Choppy Range',
  HIGH_VOLATILITY: 'High Volatility',
  COMPRESSION: 'Compression',
  RECOVERY: 'Recovery',
  DISTRIBUTION: 'Distribution',
};

export default function ChartsPage() {
  const [market, setMarket] = useState<'stocks' | 'crypto'>('crypto');
  const [selected, setSelected] = useState('BTC');
  const chartRef = useRef<HTMLDivElement>(null);
  const chartInstance = useRef<any>(null);

  const { data: snapshot, isLoading } = useQuery({
    queryKey: ['candles', selected, market],
    queryFn: () => getStockCandles(selected, market),
    refetchInterval: 60000,
  });
  const { data: regimeMap } = useQuery({
    queryKey: ['regime', selected],
    queryFn: () => getRegimes([selected]),
    refetchInterval: 60000,
  });
  // Real tracked universe (every symbol the council has actually debated), not
  // a small hand-typed list — was hardcoded to 14 stocks/5 crypto so most
  // analyzed assets (e.g. METU, DOT, LINK) had no way to be charted at all.
  const { data: universe } = useQuery({
    queryKey: ['stocks-universe'],
    queryFn: getStocksUniverse,
    staleTime: 60000,
  });
  // Union in open positions and the baseline list — a force-bought position
  // (no debate history, e.g. NVDA/AMZN here) was otherwise invisible on this
  // page entirely, since the universe endpoint only returns debated symbols.
  const { data: positions } = useQuery({
    queryKey: ['positions'],
    queryFn: getPositions,
    staleTime: 60000,
  });
  const positionSymbols: string[] = (positions || []).map((p: any) => p.asset as string);
  const universeSymbols: string[] = Array.from(new Set([
    ...(universe || []).map((u: any) => u.symbol as string),
    ...positionSymbols,
    ...STOCK_LIST,
    ...CRYPTO_LIST,
  ]));
  const cryptoSymbols = universeSymbols.filter((s: string) => CRYPTO_LIST.includes(s));
  const stockSymbols = universeSymbols.filter((s: string) => !CRYPTO_LIST.includes(s));
  const symbolOptions = market === 'crypto' ? cryptoSymbols : stockSymbols;

  const candles: any[] = snapshot?.candles || [];
  const indicators: any = snapshot?.indicators || null;
  const price: number | undefined = snapshot?.price;
  const regime = regimeMap?.[selected];

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
        layout: { background: { color: '#FFFFFF' }, textColor: '#5B6472' },
        grid: { vertLines: { color: '#DCDFE6' }, horzLines: { color: '#DCDFE6' } },
        crosshair: { mode: 1 },
        rightPriceScale: { borderColor: '#DCDFE6' },
        timeScale: { borderColor: '#DCDFE6', timeVisible: true, secondsVisible: false },
      });
      chartInstance.current = chart;

      const series = chart.addCandlestickSeries({
        upColor: '#12805F', downColor: '#B0263B',
        borderUpColor: '#12805F', borderDownColor: '#B0263B',
        wickUpColor: '#12805F', wickDownColor: '#B0263B',
      });

      const bars = candles.map(c => ({
        time: Math.floor(c.timestamp / 1000) as any,
        open: c.open, high: c.high, low: c.low, close: c.close,
      }));
      series.setData(bars);

      // Real EMA readouts from the backend's own indicator engine — where price sits relative to trend
      if (indicators?.ema9) series.createPriceLine({ price: indicators.ema9, color: '#C9A24B', lineWidth: 1, lineStyle: 2, title: 'EMA9' });
      if (indicators?.ema21) series.createPriceLine({ price: indicators.ema21, color: '#C9A24B', lineWidth: 1, lineStyle: 2, title: 'EMA21' });
      if (indicators?.ema200) series.createPriceLine({ price: indicators.ema200, color: '#5B6472', lineWidth: 1, lineStyle: 2, title: 'EMA200' });

      const volumeSeries = chart.addHistogramSeries({
        color: '#C9A24B30', priceFormat: { type: 'volume' }, priceScaleId: '',
      });
      volumeSeries.priceScale().applyOptions({ scaleMargins: { top: 0.8, bottom: 0 } });
      volumeSeries.setData(candles.map(c => ({ time: Math.floor(c.timestamp / 1000) as any, value: c.volume, color: c.close >= c.open ? '#12805F40' : '#B0263B40' })));

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
    return () => { mounted = false; if (chartInstance.current) { chartInstance.current.remove(); chartInstance.current = null; } };
  }, [candles, indicators]);

  const trendVsEma9 = indicators?.ema9 && price ? (price >= indicators.ema9 ? 'Above (bullish)' : 'Below (bearish)') : '—';
  const rsiRead = indicators?.rsi14 != null ? (indicators.rsi14 > 70 ? 'Overbought' : indicators.rsi14 < 30 ? 'Oversold' : 'Neutral') : '—';
  const macdRead = indicators?.macd ? (indicators.macd.histogram > 0 ? 'Bullish momentum' : 'Bearish momentum') : '—';
  const bbRead = indicators?.bollingerBands && price
    ? (price >= indicators.bollingerBands.upper ? 'At upper band' : price <= indicators.bollingerBands.lower ? 'At lower band' : 'Inside bands')
    : '—';
  const stochRead = indicators?.stochasticK != null ? (indicators.stochasticK > 80 ? 'Overbought' : indicators.stochasticK < 20 ? 'Oversold' : 'Neutral') : '—';

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-2">
          <BarChart2 size={20} className="text-apex-accent" />
          <h1 className="font-sans font-bold text-2xl text-apex-text">Charts</h1>
        </div>
        <div className="flex items-center gap-3 flex-wrap">
          <LastUpdated />
          {price != null && <span className="font-mono font-bold text-xl text-apex-text">${price.toFixed(2)}</span>}
          {regime?.regime && (
            <span className="font-mono text-xs font-bold px-2 py-1 rounded bg-apex-accent/10 text-apex-accent">
              {REGIME_LABELS[regime.regime] || regime.regime}
            </span>
          )}
          <select value={market} onChange={e => { setMarket(e.target.value as any); setSelected(e.target.value === 'crypto' ? 'BTC' : 'NVDA'); }}
            style={{ fontFamily: 'Space Mono', fontSize: 11, padding: '6px 8px', borderRadius: 6, border: '1px solid #DCDFE6', background: '#F8F9FC', color: '#14171F' }}>
            <option value="stocks">Stocks</option>
            <option value="crypto">Crypto</option>
          </select>
          <select value={selected} onChange={e => setSelected(e.target.value)}
            style={{ fontFamily: 'Space Mono', fontSize: 11, padding: '6px 8px', borderRadius: 6, border: '1px solid #DCDFE6', background: '#F8F9FC', color: '#14171F' }}>
            {symbolOptions.map((s: string) => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>
      </div>

      <div className="card p-0 overflow-hidden">
        <div className="flex p-4 border-b border-apex-border items-center justify-between">
          <span className="font-sans font-semibold text-apex-text">{selected} Candlestick — {market}</span>
          <span className="font-mono text-xs text-apex-muted">{market === 'crypto' ? '1h bars · live' : 'Daily bars'}</span>
        </div>
        {isLoading && <div className="p-10 text-center font-mono text-xs text-apex-muted">Loading candles...</div>}
        {!isLoading && candles.length === 0 && <div className="p-10 text-center font-mono text-xs text-apex-muted">No candle data available for {selected}</div>}
        <div ref={chartRef} className="w-full" style={{ height: 480, display: candles.length ? 'block' : 'none' }} />
      </div>

      {/* Real indicator readout — how the agents actually read this chart */}
      {indicators && (
        <div className="card">
          <h2 className="font-sans font-semibold text-apex-text mb-4">How the Agents Read This Chart</h2>
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4">
            {[
              { label: 'Trend vs EMA9', value: trendVsEma9 },
              { label: `RSI(14) ${indicators.rsi14?.toFixed(1) ?? ''}`, value: rsiRead },
              { label: 'MACD', value: macdRead },
              { label: 'Bollinger', value: bbRead },
              { label: `Stochastic ${indicators.stochasticK?.toFixed(0) ?? ''}`, value: stochRead },
            ].map(s => (
              <div key={s.label} className="p-3 rounded-lg border border-apex-border bg-apex-surface">
                <div className="font-mono text-[10px] text-apex-muted uppercase mb-1">{s.label}</div>
                <div className="font-sans font-bold text-sm text-apex-text">{s.value}</div>
              </div>
            ))}
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mt-4">
            {[
              { label: 'EMA9',   value: indicators.ema9 },
              { label: 'EMA21',  value: indicators.ema21 },
              { label: 'EMA200', value: indicators.ema200 },
              { label: 'ATR14',  value: indicators.atr14 },
              { label: 'VWAP',   value: indicators.vwap },
              { label: 'Bollinger Upper', value: indicators.bollingerBands?.upper },
              { label: 'Bollinger Lower', value: indicators.bollingerBands?.lower },
              { label: 'MACD Histogram',  value: indicators.macd?.histogram },
            ].map(s => (
              <div key={s.label}>
                <div className="font-mono text-[10px] text-apex-muted tracking-widest mb-1">{s.label}</div>
                <div className="font-mono font-bold text-apex-text">{s.value != null ? Number(s.value).toFixed(2) : '—'}</div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
