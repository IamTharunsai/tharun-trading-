// Analytics Page
import { useQuery } from '@tanstack/react-query';
import { getTradeStats, getSnapshots } from '../services/api';
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid, LineChart, Line } from 'recharts';
import StatCard from '../components/common/StatCard';

export default function AnalyticsPage() {
  const { data: stats } = useQuery({ queryKey: ['trade-stats'], queryFn: getTradeStats });
  const { data: snapshots = [] } = useQuery({ queryKey: ['snaps-all'], queryFn: () => getSnapshots(90) });

  const barData = snapshots.slice(-30).map((s: any, i: number) => ({
    day: i + 1,
    pnl: s.pnlDay || 0,
  }));

  return (
    <div className="space-y-6">
      <h1 className="font-sans font-bold text-2xl text-apex-text">Analytics</h1>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard label="Total Trades" value={stats?.totalTrades || 0} mono />
        <StatCard label="Win Rate" value={`${stats?.winRate || 0}%`} trend={parseFloat(stats?.winRate || '0') >= 50 ? 'up' : 'down'} mono />
        <StatCard label="Avg Win" value={`$${stats?.avgWin || '0.00'}`} trend="up" mono />
        <StatCard label="Avg Loss" value={`$${stats?.avgLoss || '0.00'}`} trend="down" mono />
        <StatCard label="Total P&L" value={`$${stats?.totalPnl || '0.00'}`} trend={parseFloat(stats?.totalPnl || '0') >= 0 ? 'up' : 'down'} mono />
        <StatCard label="Profit Factor" value={stats?.profitFactor || '—'} mono />
        <StatCard label="Best Trade" value={stats?.bestTrade?.asset || '—'} sub={`$${stats?.bestTrade?.pnl?.toFixed(2) || '0'}`} trend="up" />
        <StatCard label="Worst Trade" value={stats?.worstTrade?.asset || '—'} sub={`$${stats?.worstTrade?.pnl?.toFixed(2) || '0'}`} trend="down" />
      </div>

      <div className="card">
        <h2 className="font-sans font-semibold text-apex-text mb-4">Daily P&L (last 30 days)</h2>
        <ResponsiveContainer width="100%" height={250}>
          <BarChart data={barData}>
            <CartesianGrid strokeDasharray="3 3" stroke="#1E2D45" vertical={false} />
            <XAxis dataKey="day" tick={{ fontSize: 10, fill: '#4B6280', fontFamily: 'Space Mono' }} axisLine={false} tickLine={false} />
            <YAxis tick={{ fontSize: 10, fill: '#4B6280', fontFamily: 'Space Mono' }} axisLine={false} tickLine={false} tickFormatter={v => `$${v.toFixed(0)}`} />
            <Tooltip formatter={(v: number) => [`$${v.toFixed(2)}`, 'P&L']} contentStyle={{ background: '#111827', border: '1px solid #1E2D45', borderRadius: 8, fontSize: 11, fontFamily: 'Space Mono' }} />
            <Bar dataKey="pnl" fill="#00D4FF" radius={[3, 3, 0, 0]}
              label={false}
              // Color bars by positive/negative
            />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
