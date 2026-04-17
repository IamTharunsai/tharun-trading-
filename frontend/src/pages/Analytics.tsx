import { useQuery } from '@tanstack/react-query';
import { getTradeStats, getSnapshots } from '../services/api';
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid, Cell, LineChart, Line, AreaChart, Area } from 'recharts';
import StatCard from '../components/common/StatCard';
import { format } from 'date-fns';

export default function AnalyticsPage() {
  const { data: stats } = useQuery({ queryKey: ['trade-stats'], queryFn: getTradeStats });
  const { data: snapshots = [] } = useQuery({ queryKey: ['snaps-all'], queryFn: () => getSnapshots(90) });

  const barData = (snapshots as any[]).slice(-30).map((s: any, i: number) => ({
    day: i + 1,
    date: s.timestamp ? format(new Date(s.timestamp), 'MM/dd') : String(i + 1),
    pnl: s.pnlDay || 0,
  }));

  const valueData = (snapshots as any[]).slice(-90).map((s: any) => ({
    time: s.timestamp ? format(new Date(s.timestamp), 'MM/dd') : '',
    value: s.totalValue || 0,
  }));

  const totalPnl = parseFloat(stats?.totalPnl || '0');
  const winRate  = parseFloat(stats?.winRate  || '0');

  const CustomBarTooltip = ({ active, payload, label }: any) => {
    if (!active || !payload?.length) return null;
    const val = payload[0].value;
    return (
      <div className="card text-xs font-mono p-2 space-y-1">
        <div className="text-apex-muted">{label}</div>
        <div className={`font-bold ${val >= 0 ? 'text-apex-green' : 'text-apex-red'}`}>
          {val >= 0 ? '+' : ''}${val.toFixed(2)}
        </div>
      </div>
    );
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-sans font-bold text-2xl text-apex-text">Analytics</h1>
        <p className="font-mono text-xs text-apex-muted mt-1">Deep performance analysis across all trades</p>
      </div>

      {/* Stats Grid */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard label="Total Trades"   value={stats?.totalTrades || 0} mono />
        <StatCard label="Win Rate"        value={`${stats?.winRate || 0}%`} trend={winRate >= 50 ? 'up' : 'down'} mono />
        <StatCard label="Avg Win"         value={`$${stats?.avgWin || '0.00'}`}  trend="up" mono />
        <StatCard label="Avg Loss"        value={`$${stats?.avgLoss || '0.00'}`} trend="down" mono />
        <StatCard label="Total P&L"       value={`${totalPnl >= 0 ? '+' : ''}$${stats?.totalPnl || '0.00'}`} trend={totalPnl >= 0 ? 'up' : 'down'} mono />
        <StatCard label="Profit Factor"   value={stats?.profitFactor || '—'} mono />
        <StatCard label="Best Trade"      value={stats?.bestTrade?.asset  || '—'} sub={`$${(stats?.bestTrade?.pnl  || 0).toFixed(2)}`} trend="up" />
        <StatCard label="Worst Trade"     value={stats?.worstTrade?.asset || '—'} sub={`$${(stats?.worstTrade?.pnl || 0).toFixed(2)}`} trend="down" />
      </div>

      {/* Daily P&L Bar Chart */}
      <div className="card">
        <h2 className="font-sans font-semibold text-apex-text mb-4">Daily P&L — Last 30 Days</h2>
        {barData.length > 0 ? (
          <ResponsiveContainer width="100%" height={250}>
            <BarChart data={barData} margin={{ top: 5, right: 10, left: 10, bottom: 5 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#E8D5C4" vertical={false} />
              <XAxis dataKey="date" tick={{ fontSize: 10, fill: '#8B6F47', fontFamily: 'Space Mono' }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fontSize: 10, fill: '#8B6F47', fontFamily: 'Space Mono' }} axisLine={false} tickLine={false} tickFormatter={v => `$${v.toFixed(0)}`} />
              <Tooltip content={<CustomBarTooltip />} />
              <Bar dataKey="pnl" radius={[3, 3, 0, 0]}>
                {barData.map((entry, i) => (
                  <Cell key={i} fill={entry.pnl >= 0 ? '#2D8A4A' : '#DC2626'} fillOpacity={0.85} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        ) : (
          <div className="h-[250px] flex items-center justify-center font-mono text-xs text-apex-muted">
            No trade data yet. Start trading to see analytics.
          </div>
        )}
      </div>

      {/* Portfolio Value Chart */}
      <div className="card">
        <h2 className="font-sans font-semibold text-apex-text mb-4">Portfolio Value — 90 Days</h2>
        {valueData.length > 1 ? (
          <ResponsiveContainer width="100%" height={200}>
            <AreaChart data={valueData} margin={{ top: 5, right: 10, left: 10, bottom: 5 }}>
              <defs>
                <linearGradient id="valGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%"  stopColor="#FF8C42" stopOpacity={0.25} />
                  <stop offset="95%" stopColor="#FF8C42" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="#E8D5C4" vertical={false} />
              <XAxis dataKey="time" tick={{ fontSize: 10, fill: '#8B6F47', fontFamily: 'Space Mono' }} axisLine={false} tickLine={false} interval="preserveStartEnd" />
              <YAxis tick={{ fontSize: 10, fill: '#8B6F47', fontFamily: 'Space Mono' }} axisLine={false} tickLine={false} tickFormatter={v => `$${v.toFixed(0)}`} />
              <Tooltip formatter={(v: number) => [`$${v.toFixed(2)}`, 'Value']} contentStyle={{ background: '#FFFBF7', border: '1px solid #E8D5C4', borderRadius: 8, fontSize: 11, fontFamily: 'Space Mono' }} />
              <Area type="monotone" dataKey="value" stroke="#FF8C42" strokeWidth={2} fill="url(#valGrad)" />
            </AreaChart>
          </ResponsiveContainer>
        ) : (
          <div className="h-[200px] flex items-center justify-center font-mono text-xs text-apex-muted">
            Portfolio snapshots appear here (taken every 5 minutes when trading).
          </div>
        )}
      </div>

      {/* Summary stats */}
      <div className="grid grid-cols-3 gap-4">
        {[
          { label: 'Win / Loss Ratio', value: stats?.profitFactor || '—', color: 'text-apex-green' },
          { label: 'Win Rate',          value: `${stats?.winRate || 0}%`, color: winRate >= 50 ? 'text-apex-green' : 'text-apex-red' },
          { label: 'Total P&L',         value: `${totalPnl >= 0 ? '+' : ''}$${(totalPnl).toFixed(2)}`, color: totalPnl >= 0 ? 'text-apex-green' : 'text-apex-red' },
        ].map(s => (
          <div key={s.label} className="card text-center">
            <div className="font-mono text-xs text-apex-muted mb-2 uppercase tracking-widest">{s.label}</div>
            <div className={`font-sans font-bold text-2xl ${s.color}`}>{s.value}</div>
          </div>
        ))}
      </div>
    </div>
  );
}
