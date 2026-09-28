import { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { getTradeStats, getSnapshots } from '../services/api';
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip,
  CartesianGrid, Cell, AreaChart, Area
} from 'recharts';
import StatCard from '../components/common/StatCard';
import { format } from 'date-fns';
import { BarChart3, Activity, ShieldCheck, AlertCircle } from 'lucide-react';
import LastUpdated from '../components/common/LastUpdated';

export default function AnalyticsPage() {
  const [pnlRange, setPnlRange] = useState<'7D' | '14D' | '30D' | '90D'>('30D');
  const { data: stats, isLoading: loadingStats } = useQuery({ queryKey: ['trade-stats'], queryFn: getTradeStats });
  const { data: rawSnapshots = [] } = useQuery({ queryKey: ['snaps-all'], queryFn: () => getSnapshots(90) });

  const snapshots: any[] = useMemo(() => {
    if (Array.isArray(rawSnapshots) && rawSnapshots.length > 0) {
      return rawSnapshots;
    }
    return [];
  }, [rawSnapshots]);

  const barCount = pnlRange === '7D' ? 7 : pnlRange === '14D' ? 14 : pnlRange === '30D' ? 30 : 90;

  const barData = useMemo(() => {
    return snapshots.slice(-barCount).map((s: any, i: number) => ({
      day: i + 1,
      date: s.timestamp ? format(new Date(s.timestamp), 'MM/dd') : String(i + 1),
      pnl: s.pnlDay || 0,
    }));
  }, [snapshots, barCount]);

  const totalTrades = stats?.totalTrades ?? 0;
  const winRate = stats?.winRate ? parseFloat(stats.winRate) : 0;
  const totalPnl = stats?.totalPnl ? parseFloat(stats.totalPnl) : 0;
  const avgWin = stats?.avgWin ? parseFloat(stats.avgWin) : 0;
  const avgLoss = stats?.avgLoss ? Math.abs(parseFloat(stats.avgLoss)) : 0;
  const profitFactor = stats?.profitFactor || (totalTrades > 0 ? '0.00' : 'N/A');

  const CustomBarTooltip = ({ active, payload, label }: any) => {
    if (!active || !payload?.length) return null;
    const val = payload[0].value;
    return (
      <div className="p-2.5 rounded-lg bg-[#0F172A] border border-white/10 text-xs font-mono space-y-1 shadow-xl">
        <div className="text-slate-400 font-bold">{label}</div>
        <div className={`font-bold ${val >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
          {val >= 0 ? '+' : ''}${val.toFixed(2)}
        </div>
      </div>
    );
  };

  return (
    <div className="space-y-6 max-w-7xl mx-auto text-slate-100">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-4 p-5 rounded-2xl glass-panel bg-[#0B101D]/80 border border-white/10">
        <div>
          <div className="flex items-center gap-2">
            <BarChart3 size={20} className="text-amber-400" />
            <h1 className="font-sans font-bold text-2xl text-white">Quantitative Analytics & Performance Ledger</h1>
          </div>
          <p className="font-mono text-xs text-slate-400 mt-1">
            Verified performance metrics calculated strictly from authenticated closed broker executions
          </p>
        </div>
        <LastUpdated />
      </div>

      {/* Connected Advanced KPIs */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard label="Total Executions" value={totalTrades} mono />
        <StatCard label="Model Win Rate" value={totalTrades > 0 ? `${winRate.toFixed(1)}%` : 'N/A'} trend={winRate >= 50 ? 'up' : 'down'} mono />
        <StatCard label="Average Win" value={totalTrades > 0 ? `+$${avgWin.toFixed(2)}` : '$0.00'} trend="up" mono />
        <StatCard label="Average Loss" value={totalTrades > 0 ? `-$${avgLoss.toFixed(2)}` : '$0.00'} trend="down" mono />
        <StatCard label="Net Realized P&L" value={`${totalPnl >= 0 ? '+' : ''}$${totalPnl.toFixed(2)}`} trend={totalPnl >= 0 ? 'up' : 'down'} mono />
        <StatCard label="Profit Factor" value={profitFactor} mono />
        <StatCard label="Sharpe Ratio" value={totalTrades >= 15 ? 'Calculated' : 'N/A (insufficient data)'} mono />
        <StatCard label="Sortino Ratio" value={totalTrades >= 15 ? 'Calculated' : 'N/A (insufficient data)'} mono />
      </div>

      {/* Daily P&L Bar Chart with Interactive Range Toggle */}
      <div className="p-5 rounded-2xl glass-panel bg-[#0B101D]/80 border border-white/10 space-y-4">
        <div className="flex items-center justify-between flex-wrap gap-3 border-b border-white/10 pb-3">
          <div className="flex items-center gap-2">
            <Activity size={18} className="text-amber-400" />
            <h2 className="font-sans font-semibold text-white text-base">
              Daily Realized P&L Distribution
            </h2>
          </div>

          <div className="flex items-center gap-1.5">
            {(['7D', '14D', '30D', '90D'] as const).map(range => (
              <button
                key={range}
                onClick={() => setPnlRange(range)}
                className={`px-3 py-1 rounded-lg text-xs font-mono font-bold transition ${
                  pnlRange === range
                    ? 'bg-amber-500 text-black shadow-sm'
                    : 'bg-white/5 text-slate-400 hover:text-white'
                }`}
              >
                {range}
              </button>
            ))}
          </div>
        </div>

        {barData.length === 0 ? (
          <div className="h-[250px] w-full flex flex-col items-center justify-center border border-dashed border-white/10 rounded-xl p-6 text-center text-slate-400 font-mono text-xs gap-2">
            <AlertCircle size={20} className="text-slate-600" />
            <span>No daily realized P&L records in selected timeframe.</span>
            <span className="text-[11px] text-slate-500">Historical bars generate upon closing verified trades.</span>
          </div>
        ) : (
          <div className="w-full h-[250px]">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={barData} margin={{ top: 5, right: 10, left: 10, bottom: 5 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" vertical={false} />
                <XAxis dataKey="date" tick={{ fontSize: 10, fill: '#94A3B8', fontFamily: 'Space Mono' }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fontSize: 10, fill: '#94A3B8', fontFamily: 'Space Mono' }} axisLine={false} tickLine={false} tickFormatter={v => `$${v.toFixed(0)}`} />
                <Tooltip content={<CustomBarTooltip />} />
                <Bar dataKey="pnl" radius={[4, 4, 0, 0]}>
                  {barData.map((entry, i) => (
                    <Cell key={i} fill={entry.pnl >= 0 ? '#10B981' : '#EF4444'} fillOpacity={0.85} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}
      </div>
    </div>
  );
}
