import { useQuery } from '@tanstack/react-query';
import { getSnapshots } from '../../services/api';
import { ResponsiveContainer, AreaChart, Area, XAxis, YAxis, Tooltip, CartesianGrid } from 'recharts';
import { format } from 'date-fns';
import { TrendingUp } from 'lucide-react';

// ── PORTFOLIO CHART ───────────────────────────────────────────────────────────
export default function PortfolioChart() {
  const { data: snapshots = [] } = useQuery({ queryKey: ['snapshots'], queryFn: () => getSnapshots(30), refetchInterval: 60000 });

  const chartData = snapshots.map((s: any) => ({
    time: format(new Date(s.timestamp), 'MM/dd HH:mm'),
    value: s.totalValue,
    pnl: s.pnlDay
  }));

  const startVal = chartData[0]?.value || 0;
  const endVal = chartData[chartData.length - 1]?.value || 0;
  const isPositive = endVal >= startVal;

  const CustomTooltip = ({ active, payload }: any) => {
    if (!active || !payload?.length) return null;
    return (
      <div className="card text-xs font-mono p-2 space-y-1">
        <div className="text-apex-muted">{payload[0]?.payload?.time}</div>
        <div className="text-apex-text font-bold">${payload[0]?.value?.toFixed(2)}</div>
      </div>
    );
  };

  return (
    <div className="card">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <TrendingUp size={16} className="text-apex-accent" />
          <span className="font-sans font-semibold text-apex-text">Portfolio Value</span>
        </div>
        <span className={`font-mono text-sm font-bold ${isPositive ? 'text-apex-green' : 'text-apex-red'}`}>
          {isPositive ? '+' : ''}{(((endVal - startVal) / (startVal || 1)) * 100).toFixed(2)}%
        </span>
      </div>

      {chartData.length > 1 ? (
        <ResponsiveContainer width="100%" height={220}>
          <AreaChart data={chartData} margin={{ top: 5, right: 5, left: 5, bottom: 5 }}>
            <defs>
              <linearGradient id="portfolioGrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor={isPositive ? '#00FF88' : '#FF3B5C'} stopOpacity={0.3} />
                <stop offset="95%" stopColor={isPositive ? '#00FF88' : '#FF3B5C'} stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="#1E2D45" vertical={false} />
            <XAxis dataKey="time" tick={{ fontSize: 10, fill: '#4B6280', fontFamily: 'Space Mono' }} axisLine={false} tickLine={false} interval="preserveStartEnd" />
            <YAxis tick={{ fontSize: 10, fill: '#4B6280', fontFamily: 'Space Mono' }} axisLine={false} tickLine={false} tickFormatter={v => `$${v.toFixed(0)}`} />
            <Tooltip content={<CustomTooltip />} />
            <Area type="monotone" dataKey="value" stroke={isPositive ? '#00FF88' : '#FF3B5C'} strokeWidth={2} fill="url(#portfolioGrad)" />
          </AreaChart>
        </ResponsiveContainer>
      ) : (
        <div className="h-[220px] flex items-center justify-center font-mono text-xs text-apex-muted">
          Collecting data — check back after first trades
        </div>
      )}
    </div>
  );
}
