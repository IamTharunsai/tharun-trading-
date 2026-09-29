import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { getPortfolioSnapshots } from '../../services/api';
import { ResponsiveContainer, AreaChart, Area, XAxis, YAxis, Tooltip, CartesianGrid, Line } from 'recharts';
import { TrendingUp, BarChart2 } from 'lucide-react';

interface ChartPoint {
  time: string;
  value: number;
  benchmark: number | null;
}

export default function PortfolioChart() {
  const [timeframe, setTimeframe] = useState<'24H' | '7D' | '30D' | 'ALL'>('7D');
  const [showBenchmark, setShowBenchmark] = useState(true);

  const { data: rawSnapshots } = useQuery({
    queryKey: ['portfolio-snapshots', timeframe],
    queryFn: () => getPortfolioSnapshots(timeframe),
    refetchInterval: 30000,
    staleTime: 15000
  });

  const chartData: ChartPoint[] = (() => {
    if (!rawSnapshots || !Array.isArray(rawSnapshots) || rawSnapshots.length === 0) {
      return [];
    }
    return rawSnapshots.map((s: any) => {
      const d = s.timestamp ? new Date(s.timestamp) : null;
      const bench = typeof s.benchmark === 'number' ? s.benchmark : typeof s.sp500Benchmark === 'number' ? s.sp500Benchmark : null;
      return {
        time: s.time || (d && Number.isFinite(d.getTime()) ? d.toLocaleString('en-US', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }) : ''),
        value: typeof s.value === 'number' ? s.value : Number(s.totalValue) || 0,
        // Only a real benchmark series — never mirror the portfolio line.
        benchmark: bench,
      };
    }).filter((p: ChartPoint) => p.value > 0);
  })();

  const hasData = chartData.length > 0;
  const startVal = hasData ? chartData[0].value : 0;
  const endVal = hasData ? chartData[chartData.length - 1].value : 0;
  const returnPct = hasData && startVal > 0 ? (((endVal - startVal) / startVal) * 100).toFixed(2) : '0.00';
  const isPositive = parseFloat(returnPct) >= 0;
  const hasBenchmark = chartData.some(p => p.benchmark !== null);
  const maxDrawdownPct = (() => {
    let peak = -Infinity, dd = 0;
    for (const p of chartData) {
      peak = Math.max(peak, p.value);
      if (peak > 0) dd = Math.max(dd, (peak - p.value) / peak);
    }
    return dd * 100;
  })();

  const CustomTooltip = ({ active, payload, label }: any) => {
    if (!active || !payload?.length) return null;
    return (
      <div className="p-3 rounded-xl bg-white border border-slate-200 text-xs font-mono space-y-1.5 shadow-xl">
        <div className="text-slate-500 font-bold">{label}</div>
        <div className="flex items-center justify-between gap-4">
          <span className="text-emerald-600 font-semibold">Portfolio NAV:</span>
          <span className="text-slate-900 font-bold">${payload[0]?.value?.toLocaleString()}</span>
        </div>
        {payload[1] && (
          <div className="flex items-center justify-between gap-4 text-slate-500">
            <span>S&P 500 Benchmark:</span>
            <span className="text-slate-700 font-bold">${payload[1]?.value?.toLocaleString()}</span>
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="p-5 rounded-xl bg-white border border-slate-200/90 shadow-sm space-y-4">
      {/* Header with Timeframe toggles */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-100 pb-3">
        <div className="flex items-center gap-2">
          <TrendingUp size={18} className="text-emerald-600" />
          <span className="font-bold text-slate-900 text-base">Portfolio NAV & Verified Ledger History</span>
          <span className="text-xs font-mono text-slate-400">· Stored Snapshots</span>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          {/* S&P 500 Benchmark Toggle */}
          <button
            onClick={() => setShowBenchmark(!showBenchmark)}
            className={`px-2.5 py-1 rounded-lg text-xs font-mono font-bold transition border ${
              showBenchmark
                ? 'bg-blue-50 text-blue-700 border-blue-200'
                : 'bg-slate-50 text-slate-500 border-slate-200 hover:text-slate-800'
            }`}
          >
            S&P 500 BENCHMARK
          </button>

          {/* Timeframes */}
          {(['24H', '7D', '30D', 'ALL'] as const).map(tf => (
            <button
              key={tf}
              onClick={() => setTimeframe(tf)}
              className={`px-3 py-1 rounded-lg text-xs font-mono font-bold transition ${
                timeframe === tf
                  ? 'bg-blue-600 text-white shadow-xs'
                  : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
              }`}
            >
              {tf}
            </button>
          ))}
        </div>
      </div>

      {/* Trajectory KPIs */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 py-1">
        <div className="p-2.5 rounded-lg bg-slate-50 border border-slate-200 text-xs font-mono">
          <div className="text-slate-500">PERIOD RETURN</div>
          <div className={`font-bold text-sm ${hasData ? (isPositive ? 'text-emerald-600' : 'text-red-600') : 'text-slate-400'}`}>
            {hasData && startVal > 0 ? `${isPositive ? '+' : ''}${returnPct}%` : '—'}
          </div>
        </div>
        <div className="p-2.5 rounded-lg bg-slate-50 border border-slate-200 text-xs font-mono">
          <div className="text-slate-500">SHARPE RATIO</div>
          <div className="font-bold text-sm text-slate-700">
            {'—'}
          </div>
        </div>
        <div className="p-2.5 rounded-lg bg-slate-50 border border-slate-200 text-xs font-mono">
          <div className="text-slate-500">MAX DRAWDOWN</div>
          <div className="font-bold text-sm text-slate-700">
            {chartData.length >= 2 ? `-${maxDrawdownPct.toFixed(2)}%` : '—'}
          </div>
        </div>
        <div className="p-2.5 rounded-lg bg-slate-50 border border-slate-200 text-xs font-mono">
          <div className="text-slate-500">RECORDED SNAPS</div>
          <div className="font-bold text-sm text-blue-700">
            {chartData.length}
          </div>
        </div>
      </div>

      {/* Chart Canvas */}
      {!hasData ? (
        <div className="h-[280px] w-full flex flex-col items-center justify-center border border-dashed border-slate-200 rounded-xl p-6 text-center text-slate-500 font-mono text-xs gap-3 bg-slate-50/50">
          <BarChart2 size={24} className="text-slate-400" />
          <p className="max-w-md text-slate-600">
            No historical equity snapshots recorded yet. Connect Alpaca brokerage or execute paper trades to populate the authenticated performance curve.
          </p>
          <span className="text-[11px] text-slate-400">
            Non-negotiable rule enforced: No random or synthetic curves are generated.
          </span>
        </div>
      ) : (
        <div className="w-full h-[280px]">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={chartData} margin={{ top: 10, right: 10, left: 10, bottom: 0 }}>
              <defs>
                <linearGradient id="chartNavGradient" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#059669" stopOpacity={0.25} />
                  <stop offset="95%" stopColor="#059669" stopOpacity={0.0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="#E2E8F0" vertical={false} />
              <XAxis dataKey="time" stroke="#64748B" fontSize={10} tickLine={false} axisLine={false} />
              <YAxis stroke="#64748B" fontSize={10} tickLine={false} axisLine={false} domain={['auto', 'auto']} tickFormatter={v => `$${v.toLocaleString()}`} />
              <Tooltip content={<CustomTooltip />} />
              <Area type="monotone" dataKey="value" stroke="#059669" strokeWidth={2} fillOpacity={1} fill="url(#chartNavGradient)" />
              {showBenchmark && hasBenchmark && (
                <Line type="monotone" dataKey="benchmark" stroke="#2563EB" strokeWidth={1.5} strokeDasharray="4 4" dot={false} />
              )}
            </AreaChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
}
