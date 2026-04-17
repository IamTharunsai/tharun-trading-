import { useEffect, useRef, useState } from 'react';
import { BarChart2 } from 'lucide-react';
import { useStore } from '../store';

const CRYPTO_ASSETS = ['BTC', 'ETH', 'SOL', 'BNB', 'ADA'];

export default function ChartsPage() {
  const [selected, setSelected] = useState('BTC');
  const prices = useStore(s => s.prices);
  const chartRef = useRef<HTMLDivElement>(null);
  const chartInstance = useRef<any>(null);
  const seriesRef = useRef<any>(null);
  const [chartLoaded, setChartLoaded] = useState(false);
  const [high24, setHigh24] = useState<number | null>(null);
  const [low24, setLow24] = useState<number | null>(null);

  useEffect(() => {
    let mounted = true;

    const initChart = async () => {
      const { createChart } = await import('lightweight-charts');
      if (!chartRef.current || !mounted) return;

      // Cleanup previous
      if (chartInstance.current) {
        chartInstance.current.remove();
        chartInstance.current = null;
      }

      const chart = createChart(chartRef.current, {
        width: chartRef.current.clientWidth,
        height: 480,
        layout: { background: { color: '#FFFBF7' }, textColor: '#8B6F47' },
        grid: { vertLines: { color: '#E8D5C4' }, horzLines: { color: '#E8D5C4' } },
        crosshair: { mode: 1 },
        rightPriceScale: { borderColor: '#E8D5C4' },
        timeScale: { borderColor: '#E8D5C4', timeVisible: true, secondsVisible: false },
      });

      const series = chart.addCandlestickSeries({
        upColor: '#2D8A4A',
        downColor: '#DC2626',
        borderUpColor: '#2D8A4A',
        borderDownColor: '#DC2626',
        wickUpColor: '#2D8A4A',
        wickDownColor: '#DC2626',
      });

      chartInstance.current = chart;
      seriesRef.current = series;

      // Fetch real candle data from Binance
      try {
        const res = await fetch(`https://api.binance.us/api/v3/klines?symbol=${selected}USDT&interval=1h&limit=200`);
        const data = await res.json();
        const candles = data.map((k: any[]) => ({
          time: Math.floor(k[0] / 1000) as any,
          open: parseFloat(k[1]),
          high: parseFloat(k[2]),
          low: parseFloat(k[3]),
          close: parseFloat(k[4]),
        }));
        series.setData(candles);
        chart.timeScale().fitContent();
        // Calculate 24h high/low from last 24 candles (1H * 24 = 24h)
        const last24 = candles.slice(-24);
        setHigh24(Math.max(...last24.map((c: any) => c.high)));
        setLow24(Math.min(...last24.map((c: any) => c.low)));
      } catch {
        // If fetch fails, show placeholder
      }

      // Add volume series
      const volumeSeries = chart.addHistogramSeries({
        color: '#FF8C4220',
        priceFormat: { type: 'volume' },
        priceScaleId: '',
      });
      volumeSeries.priceScale().applyOptions({ scaleMargins: { top: 0.8, bottom: 0 } });

      setChartLoaded(true);

      // Resize handler
      const resizeObserver = new ResizeObserver(() => {
        if (chartRef.current && chartInstance.current) {
          chartInstance.current.applyOptions({ width: chartRef.current.clientWidth });
        }
      });
      if (chartRef.current) resizeObserver.observe(chartRef.current);

      return () => resizeObserver.disconnect();
    };

    initChart();
    return () => { mounted = false; };
  }, [selected]);

  const currentPrice = prices[selected];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <BarChart2 size={20} className="text-apex-accent" />
          <h1 className="font-sans font-bold text-2xl text-apex-text">Charts</h1>
        </div>
        {currentPrice && (
          <div className="flex items-center gap-4">
            <span className="font-mono font-bold text-xl text-apex-text">${currentPrice.price?.toFixed(2)}</span>
            <span className={`font-mono text-sm font-bold ${(currentPrice.change24h || 0) >= 0 ? 'text-apex-green' : 'text-apex-red'}`}>
              {(currentPrice.change24h || 0) >= 0 ? '+' : ''}{currentPrice.change24h?.toFixed(2)}%
            </span>
          </div>
        )}
      </div>

      {/* Asset selector */}
      <div className="flex gap-2">
        {CRYPTO_ASSETS.map(a => (
          <button key={a} onClick={() => setSelected(a)}
            className={`px-4 py-1.5 rounded-lg font-mono text-sm font-bold transition-all ${
              selected === a
                ? 'bg-apex-accent/10 border border-apex-accent text-apex-accent'
                : 'bg-apex-surface border border-apex-border text-apex-muted hover:text-apex-text'
            }`}
          >
            {a}
          </button>
        ))}
      </div>

      {/* Chart */}
      <div className="card p-0 overflow-hidden">
        <div className="p-4 border-b border-apex-border flex items-center justify-between">
          <span className="font-sans font-semibold text-apex-text">{selected}/USDT — 1H Candlestick</span>
          <span className="font-mono text-xs text-apex-muted">Powered by Binance • Live</span>
        </div>
        <div ref={chartRef} className="w-full" style={{ minHeight: 480 }} />
      </div>

      {/* Current price stats */}
      {currentPrice && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[
            { label: '24h High', value: high24 ? `$${high24.toFixed(2)}` : `$${currentPrice.price?.toFixed(2)}` },
            { label: '24h Low',  value: low24  ? `$${low24.toFixed(2)}`  : `$${currentPrice.price?.toFixed(2)}` },
            { label: '24h Volume', value: (currentPrice.volume24h || 0).toLocaleString('en-US', { maximumFractionDigits: 0 }) },
            { label: '24h Change', value: `${(currentPrice.change24h || 0).toFixed(2)}%` },
          ].map(({ label, value }) => (
            <div key={label} className="card">
              <div className="font-mono text-[10px] text-apex-muted uppercase tracking-widest mb-1">{label}</div>
              <div className="font-mono font-bold text-apex-text">{value}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
