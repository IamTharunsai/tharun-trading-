import { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { getTrades } from '../services/api';
import { tradeOutcome } from '../utils/trades';
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip,
  CartesianGrid, Cell
} from 'recharts';
import StatCard from '../components/common/StatCard';
import { format } from 'date-fns';
import { BarChart3, Activity, AlertCircle } from 'lucide-react';
import LastUpdated from '../components/common/LastUpdated';

export default function AnalyticsPage() {
  const [pnlRange, setPnlRange] = useState<'7D' | '14D' | '30D' | '90D'>('30D');
  // Everything here is computed from CLOSED trades — no snapshot/placeholder series.
  const { data: closedData, isLoading } = useQuery({
    queryKey: ['trades-closed-analytics'],
    queryFn: () => getTrades(1, 1000, { status: 'CLOSED' }),
    refetchInterval: 60000,
  });

  const closedTrades: any[] = useMemo(() => {
    const list: any[] = Array.isArray(closedData?.trades) ? closedData.trades : Array.isArray(closedData) ? closedData : [];
    return list.filter(t => String(t?.status || '').toUpperCase() === 'CLOSED' && tradeOutcome(t) !== 'REJECTED' && Number.isFinite(Number(t.pnl)));
  }, [closedData]);

  const dayCount = pnlRange === '7D' ? 7 : pnlRange === '14D' ? 14 : pnlRange === '30D' ? 30 : 90;

  // Group realized P&L by distinct calendar day of the close.
  const barData = useMemo(() => {
    const cutoff = Date.now() - dayCount * 86400000;
    const byDay = new Map<string, { pnl: number; trades: number }>();
    for (const t of closedTrades) {
      const d = new Date(t.closedAt || t.updatedAt || t.openedAt);
      if (!Number.isFinite(d.getTime()) || d.getTime() < cutoff) continue;
      const key = format(d, 'yyyy-MM-dd');
      const cur = byDay.get(key) || { pnl: 0, trades: 0 };
      cur.pnl += Number(t.pnl);
      cur.trades += 1;
      byDay.set(key, cur);
    }
    return Array.from(byDay.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, v]) => ({ key, date: format(new Date(`${key}T12:00:00`), 'MM/dd'), pnl: Number(v.pnl.toFixed(2)), trades: v.trades }));
  }, [closedTrades, dayCount]);

  const winners = closedTrades.filter(t => Number(t.pnl) > 0);
  const losers = closedTrades.filter(t => Number(t.pnl) < 0);
  const totalTrades = closedTrades.length;
  const winRate = totalTrades ? (winners.length / totalTrades) * 100 : null;
  const grossWin = winners.reduce((s2, t) => s2 + Number(t.pnl), 0);
  const grossLoss = Math.abs(losers.reduce((s2, t) => s2 + Number(t.pnl), 0));
  const avgWin = winners.length ? grossWin / winners.length : null;
  const profitFactor = grossLoss > 0 ? (grossWin / grossLoss).toFixed(2) : '—';

  const CustomBarTooltip = ({ active, payload, label }: any) => {
    if (!active || !payload?.length) return null;
    const val = payload[0].value;
    return (
      <div className="p-2.5 rounded-lg bg-white border border-slate-200 text-xs font-mono space-y-1 shadow-md">
        <div className="text-slate-500 font-bold">{label}{payload[0]?.payload?.trades ? ` · ${payload[0].payload.trades} trade${payload[0].payload.trades === 1 ? '' : 's'}` : ''}</div>
        <div className={`font-bold tabular-nums ${val >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>
          {val >= 0 ? '+' : ''}${val.toFixed(2)}
        </div>
      </div>
    );
  };

  return (
    <div className="space-y-6 max-w-7xl mx-auto text-slate-900">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-4 p-5 rounded-xl bg-white border border-slate-200/90 shadow-sm">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="font-bold text-2xl text-slate-900 tracking-tight font-display">
              Quantitative Analytics & Performance Ledger
            </h1>
            <span className="font-mono text-[11px] px-2.5 py-0.5 rounded-full bg-blue-50 text-blue-700 border border-blue-200 font-bold">
              CLOSED TRADES ONLY
            </span>
          </div>
          <p className="font-mono text-xs text-slate-500 mt-1">
            Verified performance metrics calculated strictly from authenticated closed broker executions
          </p>
        </div>
        <LastUpdated />
      </div>

      {/* Connected Advanced KPIs */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard testId="stat-closed-trades" label="Closed Trades" value={isLoading ? '...' : totalTrades} mono />
        <StatCard testId="stat-win-rate" label="Win Rate (closed)" value={winRate === null ? '—' : `${winRate.toFixed(1)}%`} trend={winRate === null ? undefined : winRate >= 50 ? 'up' : 'down'} mono />
        <StatCard testId="stat-avg-win" label="Average Win" value={avgWin === null ? '—' : `+$${avgWin.toFixed(2)}`} trend={avgWin === null ? undefined : 'up'} mono />
        <StatCard testId="stat-profit-factor" label="Profit Factor" value={profitFactor} mono />
      </div>

      {/* Daily P&L Bar Chart with Interactive Range Toggle */}
      <div className="p-5 rounded-xl bg-white border border-slate-200/90 shadow-sm space-y-4">
        <div className="flex items-center justify-between flex-wrap gap-3 border-b border-slate-100 pb-3">
          <div className="flex items-center gap-2">
            <Activity size={18} className="text-blue-600" />
            <h2 className="font-semibold text-slate-900 text-sm">
              Daily Realized P&L Distribution
            </h2>
          </div>

          <div className="flex items-center gap-1.5">
            {(['7D', '14D', '30D', '90D'] as const).map(range => (
              <button
                key={range}
                data-testid={`pnl-range-${range}`}
                onClick={() => setPnlRange(range)}
                className={`px-3 py-1 rounded-lg text-xs font-mono font-bold transition ${
                  pnlRange === range
                    ? 'bg-blue-600 text-white shadow-xs'
                    : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                }`}
              >
                {range}
              </button>
            ))}
          </div>
        </div>

        {barData.length === 0 ? (
          <div className="h-[250px] w-full flex flex-col items-center justify-center border border-dashed border-slate-200 rounded-xl p-6 text-center text-slate-400 font-mono text-xs gap-2 bg-slate-50/50">
            <AlertCircle size={20} className="text-slate-400" />
            <span className="text-slate-600" data-testid="pnl-empty">{totalTrades === 0 ? 'No closed trades yet.' : 'No trades closed in the selected timeframe.'}</span>
            <span className="text-[11px] text-slate-400">Bars appear once trades are closed (one bar per calendar day).</span>
          </div>
        ) : (
          <div className="w-full h-[250px]">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={barData} margin={{ top: 5, right: 10, left: 10, bottom: 5 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#E2E8F0" vertical={false} />
                <XAxis dataKey="date" tick={{ fontSize: 10, fill: '#64748B', fontFamily: 'JetBrains Mono' }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fontSize: 10, fill: '#64748B', fontFamily: 'JetBrains Mono' }} axisLine={false} tickLine={false} tickFormatter={v => `$${v.toFixed(0)}`} />
                <Tooltip content={<CustomBarTooltip />} />
                <Bar dataKey="pnl" radius={[4, 4, 0, 0]}>
                  {barData.map((entry, i) => (
                    <Cell key={i} fill={entry.pnl >= 0 ? '#059669' : '#DC2626'} fillOpacity={0.85} />
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
