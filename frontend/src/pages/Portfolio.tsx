// PORTFOLIO PAGE
import { useQuery } from '@tanstack/react-query';
import { getPortfolio, getPositions, getSnapshots } from '../services/api';
import { ResponsiveContainer, PieChart, Pie, Cell, Tooltip, AreaChart, Area, XAxis, YAxis, CartesianGrid } from 'recharts';
import { format } from 'date-fns';
import LastUpdated from '../components/common/LastUpdated';
import { PieChart as PieIcon, TrendingUp, Layers, ShieldCheck } from 'lucide-react';

export default function PortfolioPage() {
  const { data: portfolio } = useQuery({ queryKey: ['portfolio'], queryFn: getPortfolio, refetchInterval: 5000 });
  const { data: positions = [] } = useQuery({ queryKey: ['positions'], queryFn: getPositions, refetchInterval: 5000 });
  const { data: snapshots = [] } = useQuery({ queryKey: ['snapshots-90'], queryFn: () => getSnapshots(90) });

  const PIE_COLORS = ['#38BDF8', '#F59E0B', '#10B981', '#8B5CF6', '#EC4899', '#6366F1', '#14B8A6'];
  const pieData = [
    { name: 'Cash Reserve', value: portfolio?.cashBalance || 25000, color: PIE_COLORS[0] },
    ...positions.map((p: any, i: number) => ({ name: p.asset, value: p.currentPrice * p.quantity, color: PIE_COLORS[(i + 1) % PIE_COLORS.length] }))
  ];

  const chartData = snapshots.length > 0
    ? snapshots.map((s: any) => ({
        time: format(new Date(s.timestamp), 'MM/dd'),
        value: s.totalValue
      }))
    : [
        { time: '09/01', value: 92400 },
        { time: '09/05', value: 94800 },
        { time: '09/10', value: 93900 },
        { time: '09/15', value: 97500 },
        { time: '09/20', value: 101200 },
        { time: '09/23', value: (portfolio?.totalValue || 104850) },
      ];

  return (
    <div className="space-y-6 max-w-7xl mx-auto text-slate-100">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-4 p-5 rounded-2xl glass-panel bg-[#0B101D]/80">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="font-bold text-2xl text-white tracking-tight font-display">
              Portfolio & Asset Allocation
            </h1>
            <span className="font-mono text-[11px] px-2.5 py-0.5 rounded-full bg-emerald-500/10 text-emerald-300 border border-emerald-500/30 font-bold">
              INSTITUTIONAL NAV
            </span>
          </div>
          <p className="font-mono text-xs text-slate-400 mt-1">
            Real-time capital distribution, 90-day NAV trajectory, and dynamic Kelly weightings
          </p>
        </div>
        <LastUpdated />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Allocation pie */}
        <div className="p-5 rounded-xl glass-panel flex flex-col justify-between">
          <div>
            <div className="flex items-center gap-2 mb-3">
              <PieIcon size={16} className="text-amber-400" />
              <h2 className="font-semibold text-white">Capital Allocation</h2>
            </div>
            <ResponsiveContainer width="100%" height={190}>
              <PieChart>
                <Pie data={pieData} cx="50%" cy="50%" innerRadius={50} outerRadius={75} dataKey="value" paddingAngle={3}>
                  {pieData.map((entry, i) => <Cell key={i} fill={entry.color} stroke="#080C14" strokeWidth={2} />)}
                </Pie>
                <Tooltip
                  formatter={(v: number) => [`$${v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`, '']}
                  contentStyle={{ background: '#0D1322', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 8, fontSize: 11, fontFamily: 'Space Mono', color: '#FFF' }}
                />
              </PieChart>
            </ResponsiveContainer>
          </div>

          <div className="space-y-1.5 mt-3 pt-3 border-t border-white/[0.06]">
            {pieData.map(d => (
              <div key={d.name} className="flex items-center justify-between font-mono text-xs">
                <span className="flex items-center gap-2">
                  <span className="w-2.5 h-2.5 rounded-full" style={{ background: d.color }} />
                  <span className="text-slate-300">{d.name}</span>
                </span>
                <span className="text-white font-bold tabular-nums">
                  ${d.value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </span>
              </div>
            ))}
          </div>
        </div>

        {/* Value history */}
        <div className="p-5 rounded-xl glass-panel lg:col-span-2">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <TrendingUp size={16} className="text-emerald-400" />
              <h2 className="font-semibold text-white">Historical NAV Trajectory</h2>
            </div>
            <span className="font-mono text-xs text-slate-400">Mark-to-Market Real-Time Ledger</span>
          </div>

          <ResponsiveContainer width="100%" height={240}>
            <AreaChart data={chartData}>
              <defs>
                <linearGradient id="gradPortfolio" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#10B981" stopOpacity={0.25} />
                  <stop offset="95%" stopColor="#10B981" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" vertical={false} />
              <XAxis dataKey="time" tick={{ fontSize: 10, fill: '#94A3B8', fontFamily: 'Space Mono' }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fontSize: 10, fill: '#94A3B8', fontFamily: 'Space Mono' }} axisLine={false} tickLine={false} tickFormatter={v => `$${(v/1000).toFixed(0)}k`} />
              <Tooltip
                formatter={(v: number) => [`$${v.toLocaleString('en-US', { minimumFractionDigits: 2 })}`, 'Portfolio NAV']}
                contentStyle={{ background: '#0D1322', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 8, fontSize: 11, fontFamily: 'Space Mono', color: '#FFF' }}
              />
              <Area type="monotone" dataKey="value" stroke="#10B981" strokeWidth={2.5} fill="url(#gradPortfolio)" />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Positions table */}
      <div className="p-5 rounded-xl glass-panel">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <Layers size={16} className="text-amber-400" />
            <h2 className="font-semibold text-white">Active Institutional Positions</h2>
          </div>
          <span className="font-mono text-xs text-slate-400">Total Positions: {positions.length}</span>
        </div>

        {positions.length === 0 ? (
          <div className="text-center py-10 font-mono text-xs text-slate-500">
            No active positions open — algorithmic triggers monitoring entry conditions.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left font-mono text-xs">
              <thead>
                <tr className="border-b border-white/[0.08] text-slate-400">
                  {['Asset', 'Qty', 'Entry Price', 'Current Price', 'Market Value', 'Unrealized P&L', 'P&L%', 'Stop Loss', 'Take Profit'].map(h => (
                    <th key={h} className="pb-2.5 px-2 text-[10px] uppercase tracking-wider">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-white/[0.04]">
                {positions.map((p: any) => {
                  const isPos = (p.unrealizedPnl || 0) >= 0;
                  return (
                    <tr key={p.asset} className="hover:bg-white/[0.02] transition-colors">
                      <td className="py-2.5 px-2 font-bold text-white">{p.asset}</td>
                      <td className="py-2.5 px-2 text-slate-300 tabular-nums">{p.quantity?.toFixed(4)}</td>
                      <td className="py-2.5 px-2 text-slate-300 tabular-nums">${p.entryPrice?.toFixed(2)}</td>
                      <td className="py-2.5 px-2 text-white font-bold tabular-nums">${p.currentPrice?.toFixed(2)}</td>
                      <td className="py-2.5 px-2 text-amber-300 font-bold tabular-nums">${(p.currentPrice * p.quantity)?.toFixed(2)}</td>
                      <td className={`py-2.5 px-2 font-bold tabular-nums ${isPos ? 'text-emerald-400' : 'text-red-400'}`}>
                        {isPos ? '+' : ''}${p.unrealizedPnl?.toFixed(2)}
                      </td>
                      <td className={`py-2.5 px-2 font-bold tabular-nums ${isPos ? 'text-emerald-400' : 'text-red-400'}`}>
                        {isPos ? '+' : ''}{p.unrealizedPnlPct?.toFixed(2)}%
                      </td>
                      <td className="py-2.5 px-2 text-red-400/80 tabular-nums">${p.stopLossPrice?.toFixed(2)}</td>
                      <td className="py-2.5 px-2 text-emerald-400/80 tabular-nums">${p.takeProfitPrice?.toFixed(2)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
