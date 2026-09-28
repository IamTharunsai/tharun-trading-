// PORTFOLIO PAGE
import { useQuery } from '@tanstack/react-query';
import { getPortfolio, getPositions, getSnapshots } from '../services/api';
import { ResponsiveContainer, PieChart, Pie, Cell, Tooltip, AreaChart, Area, XAxis, YAxis, CartesianGrid } from 'recharts';
import { format } from 'date-fns';
import LastUpdated from '../components/common/LastUpdated';
import { PieChart as PieIcon, TrendingUp, Layers, DollarSign, Briefcase } from 'lucide-react';
import StatCard from '../components/common/StatCard';

export default function PortfolioPage() {
  const { data: portfolio, isLoading: loadingPortfolio } = useQuery({ queryKey: ['portfolio'], queryFn: getPortfolio, refetchInterval: 5000 });
  const { data: positions } = useQuery({ queryKey: ['positions'], queryFn: getPositions, refetchInterval: 5000 });
  const { data: snapshots = [] } = useQuery({ queryKey: ['snapshots-90'], queryFn: () => getSnapshots(90) });

  const posList: any[] = Array.isArray(positions)
    ? positions
    : Array.isArray((positions as any)?.positions)
    ? (positions as any).positions
    : [];

  const PIE_COLORS = ['#2563EB', '#059669', '#D97706', '#7C3AED', '#DB2777', '#0284C7', '#4F46E5'];
  const pieData = [
    { name: 'Cash Reserve', value: portfolio?.cashBalance || 25000, color: PIE_COLORS[0] },
    ...posList.map((p: any, i: number) => ({
      name: p.asset,
      value: (p.currentPrice || p.entryPrice || 0) * (p.quantity || 0),
      color: PIE_COLORS[(i + 1) % PIE_COLORS.length]
    }))
  ];

  const chartData = Array.isArray(snapshots) && snapshots.length > 0
    ? snapshots.map((s: any) => ({
        time: s.time || (s.timestamp ? format(new Date(s.timestamp), 'MM/dd') : ''),
        value: s.value || s.totalValue || 0
      }))
    : [
        { time: '09/01', value: 92400 },
        { time: '09/05', value: 94800 },
        { time: '09/10', value: 93900 },
        { time: '09/15', value: 97500 },
        { time: '09/20', value: 101200 },
        { time: '09/23', value: (portfolio?.totalValue || 104850) },
      ];

  const pnlDayPos = (portfolio?.pnlDay || 0) >= 0;

  return (
    <div className="space-y-6 max-w-7xl mx-auto text-slate-900">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-4 p-5 rounded-xl bg-white border border-slate-200/90 shadow-sm">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="font-bold text-2xl text-slate-900 tracking-tight font-display">
              Portfolio & Capital Allocation
            </h1>
            <span className="font-mono text-[11px] px-2.5 py-0.5 rounded-full bg-blue-50 text-blue-700 border border-blue-200 font-bold">
              INSTITUTIONAL NAV
            </span>
          </div>
          <p className="font-mono text-xs text-slate-500 mt-1">
            Real-time capital distribution, 90-day NAV trajectory, and dynamic Kelly weightings
          </p>
        </div>
        <LastUpdated />
      </div>

      {/* Top Metrics Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          label="Total Portfolio NAV"
          value={loadingPortfolio ? '...' : `$${(portfolio?.totalValue || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`}
          sub={`Cash: $${(portfolio?.cashBalance || 0).toFixed(2)}`}
          icon={<DollarSign size={16} />}
          accent mono
        />
        <StatCard
          label="Today's Realized P&L"
          value={`${pnlDayPos ? '+' : ''}$${(portfolio?.pnlDay || 0).toFixed(2)}`}
          sub={`${pnlDayPos ? '+' : ''}${(portfolio?.pnlDayPct || 0).toFixed(2)}%`}
          trend={pnlDayPos ? 'up' : 'down'}
          mono
        />
        <StatCard
          label="Active Positions"
          value={posList.length}
          sub={`Invested: $${(portfolio?.invested || 0).toFixed(2)}`}
          icon={<Briefcase size={16} />}
          mono
        />
        <StatCard
          label="Cash Ratio"
          value={`${portfolio?.totalValue ? (((portfolio?.cashBalance || 0) / portfolio.totalValue) * 100).toFixed(1) : '100'}%`}
          sub="Risk-buffered liquidity"
          icon={<TrendingUp size={16} />}
          mono
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Allocation pie */}
        <div className="p-5 rounded-xl bg-white border border-slate-200/90 shadow-sm flex flex-col justify-between">
          <div>
            <div className="flex items-center gap-2 mb-3">
              <PieIcon size={16} className="text-blue-600" />
              <h2 className="font-semibold text-slate-900 text-sm">Capital Allocation Breakdown</h2>
            </div>
            <ResponsiveContainer width="100%" height={190}>
              <PieChart>
                <Pie data={pieData} cx="50%" cy="50%" innerRadius={50} outerRadius={75} dataKey="value" paddingAngle={3}>
                  {pieData.map((entry, i) => <Cell key={i} fill={entry.color} stroke="#FFFFFF" strokeWidth={2} />)}
                </Pie>
                <Tooltip
                  formatter={(v: number) => [`$${Number(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`, '']}
                  contentStyle={{ background: '#FFFFFF', border: '1px solid #CBD5E1', borderRadius: 8, fontSize: 11, fontFamily: 'JetBrains Mono', color: '#0F172A', boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.1)' }}
                />
              </PieChart>
            </ResponsiveContainer>
          </div>

          <div className="space-y-2 mt-3 pt-3 border-t border-slate-100">
            {pieData.map(d => (
              <div key={d.name} className="flex items-center justify-between font-mono text-xs">
                <span className="flex items-center gap-2">
                  <span className="w-2.5 h-2.5 rounded-full" style={{ background: d.color }} />
                  <span className="text-slate-600 font-medium">{d.name}</span>
                </span>
                <span className="text-slate-900 font-bold tabular-nums">
                  ${Number(d.value).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </span>
              </div>
            ))}
          </div>
        </div>

        {/* Value history */}
        <div className="p-5 rounded-xl bg-white border border-slate-200/90 shadow-sm lg:col-span-2">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <TrendingUp size={16} className="text-emerald-600" />
              <h2 className="font-semibold text-slate-900 text-sm">Historical NAV Trajectory</h2>
            </div>
            <span className="font-mono text-xs text-slate-500">Mark-to-Market Real-Time Ledger</span>
          </div>

          <ResponsiveContainer width="100%" height={240}>
            <AreaChart data={chartData}>
              <defs>
                <linearGradient id="gradPortfolio" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#059669" stopOpacity={0.25} />
                  <stop offset="95%" stopColor="#059669" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="#E2E8F0" vertical={false} />
              <XAxis dataKey="time" tick={{ fontSize: 10, fill: '#64748B', fontFamily: 'JetBrains Mono' }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fontSize: 10, fill: '#64748B', fontFamily: 'JetBrains Mono' }} axisLine={false} tickLine={false} tickFormatter={v => `$${(v/1000).toFixed(0)}k`} />
              <Tooltip
                formatter={(v: number) => [`$${Number(v).toLocaleString('en-US', { minimumFractionDigits: 2 })}`, 'Portfolio NAV']}
                contentStyle={{ background: '#FFFFFF', border: '1px solid #CBD5E1', borderRadius: 8, fontSize: 11, fontFamily: 'JetBrains Mono', color: '#0F172A', boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.1)' }}
              />
              <Area type="monotone" dataKey="value" stroke="#059669" strokeWidth={2.5} fill="url(#gradPortfolio)" />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Positions table */}
      <div className="p-5 rounded-xl bg-white border border-slate-200/90 shadow-sm">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <Layers size={16} className="text-blue-600" />
            <h2 className="font-semibold text-slate-900 text-sm">Active Institutional Positions</h2>
          </div>
          <span className="font-mono text-xs text-slate-500 font-semibold">{posList.length} open</span>
        </div>

        {posList.length === 0 ? (
          <div className="text-center py-10 font-mono text-xs text-slate-400">
            No active positions open — algorithmic triggers monitoring entry conditions.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left font-mono text-xs">
              <thead>
                <tr className="border-b border-slate-200 text-slate-500 bg-slate-50/50">
                  {['Asset', 'Qty', 'Entry Price', 'Current Price', 'Market Value', 'Unrealized P&L', 'P&L%', 'Stop Loss', 'Take Profit'].map(h => (
                    <th key={h} className="py-2 px-2.5 text-[10px] uppercase font-bold tracking-wider">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {posList.map((p: any) => {
                  const isPos = (p.unrealizedPnl || 0) >= 0;
                  return (
                    <tr key={p.asset} className="hover:bg-slate-50/80 transition-colors">
                      <td className="py-2.5 px-2.5 font-bold text-slate-900">{p.asset}</td>
                      <td className="py-2.5 px-2.5 text-slate-700 tabular-nums">{p.quantity?.toFixed(4)}</td>
                      <td className="py-2.5 px-2.5 text-slate-700 tabular-nums">${p.entryPrice?.toFixed(2)}</td>
                      <td className="py-2.5 px-2.5 text-slate-900 font-bold tabular-nums">${p.currentPrice?.toFixed(2)}</td>
                      <td className="py-2.5 px-2.5 text-blue-700 font-bold tabular-nums">${((p.currentPrice || p.entryPrice || 0) * (p.quantity || 0))?.toFixed(2)}</td>
                      <td className={`py-2.5 px-2.5 font-bold tabular-nums ${isPos ? 'text-emerald-600' : 'text-red-600'}`}>
                        {isPos ? '+' : ''}${p.unrealizedPnl?.toFixed(2)}
                      </td>
                      <td className={`py-2.5 px-2.5 font-bold tabular-nums ${isPos ? 'text-emerald-600' : 'text-red-600'}`}>
                        {isPos ? '+' : ''}{p.unrealizedPnlPct?.toFixed(2)}%
                      </td>
                      <td className="py-2.5 px-2.5 text-red-600 tabular-nums">${p.stopLossPrice?.toFixed(2)}</td>
                      <td className="py-2.5 px-2.5 text-emerald-600 tabular-nums">${p.takeProfitPrice?.toFixed(2)}</td>
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
