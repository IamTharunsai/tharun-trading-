// PORTFOLIO PAGE
import { useQuery } from '@tanstack/react-query';
import { getPortfolio, getPositions, getSnapshots } from '../services/api';
import { ResponsiveContainer, PieChart, Pie, Cell, Tooltip, AreaChart, Area, XAxis, YAxis, CartesianGrid } from 'recharts';
import { format } from 'date-fns';

export default function PortfolioPage() {
  const { data: portfolio } = useQuery({ queryKey: ['portfolio'], queryFn: getPortfolio, refetchInterval: 5000 });
  const { data: positions = [] } = useQuery({ queryKey: ['positions'], queryFn: getPositions, refetchInterval: 5000 });
  const { data: snapshots = [] } = useQuery({ queryKey: ['snapshots-90'], queryFn: () => getSnapshots(90) });

  const pieData = [
    { name: 'Cash', value: portfolio?.cashBalance || 0, color: '#4B6280' },
    ...positions.map((p: any) => ({ name: p.asset, value: p.currentPrice * p.quantity, color: '#00D4FF' }))
  ];

  const chartData = snapshots.map((s: any) => ({
    time: format(new Date(s.timestamp), 'MM/dd'),
    value: s.totalValue
  }));

  return (
    <div className="space-y-6">
      <h1 className="font-sans font-bold text-2xl text-apex-text">Portfolio</h1>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Allocation pie */}
        <div className="card">
          <h2 className="font-sans font-semibold text-apex-text mb-4">Allocation</h2>
          <ResponsiveContainer width="100%" height={200}>
            <PieChart>
              <Pie data={pieData} cx="50%" cy="50%" innerRadius={50} outerRadius={80} dataKey="value" paddingAngle={2}>
                {pieData.map((entry, i) => <Cell key={i} fill={entry.color} opacity={i === 0 ? 0.5 : 1} />)}
              </Pie>
              <Tooltip formatter={(v: number) => [`$${v.toFixed(2)}`, '']} contentStyle={{ background: '#111827', border: '1px solid #1E2D45', borderRadius: 8, fontSize: 11, fontFamily: 'Space Mono' }} />
            </PieChart>
          </ResponsiveContainer>
          <div className="space-y-1 mt-2">
            {pieData.map(d => (
              <div key={d.name} className="flex items-center justify-between font-mono text-xs">
                <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full" style={{ background: d.color }} /><span className="text-apex-muted">{d.name}</span></span>
                <span className="text-apex-text">${d.value.toFixed(2)}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Value history */}
        <div className="card lg:col-span-2">
          <h2 className="font-sans font-semibold text-apex-text mb-4">90-Day Value History</h2>
          <ResponsiveContainer width="100%" height={240}>
            <AreaChart data={chartData}>
              <defs>
                <linearGradient id="grad2" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#00D4FF" stopOpacity={0.3} />
                  <stop offset="95%" stopColor="#00D4FF" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="#1E2D45" vertical={false} />
              <XAxis dataKey="time" tick={{ fontSize: 10, fill: '#4B6280', fontFamily: 'Space Mono' }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fontSize: 10, fill: '#4B6280', fontFamily: 'Space Mono' }} axisLine={false} tickLine={false} tickFormatter={v => `$${v.toFixed(0)}`} />
              <Tooltip formatter={(v: number) => [`$${v.toFixed(2)}`, 'Value']} contentStyle={{ background: '#111827', border: '1px solid #1E2D45', borderRadius: 8, fontSize: 11, fontFamily: 'Space Mono' }} />
              <Area type="monotone" dataKey="value" stroke="#00D4FF" strokeWidth={2} fill="url(#grad2)" />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Positions table */}
      <div className="card">
        <h2 className="font-sans font-semibold text-apex-text mb-4">Open Positions</h2>
        {positions.length === 0 ? (
          <div className="text-center py-8 font-mono text-xs text-apex-muted">No open positions</div>
        ) : (
          <table className="w-full">
            <thead>
              <tr className="border-b border-apex-border">
                {['Asset', 'Qty', 'Entry Price', 'Current Price', 'Value', 'Unrealized P&L', 'P&L%', 'Stop Loss', 'Take Profit'].map(h => (
                  <th key={h} className="pb-2 text-left font-mono text-[10px] text-apex-muted uppercase tracking-widest pr-3">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {positions.map((p: any) => {
                const isPos = (p.unrealizedPnl || 0) >= 0;
                return (
                  <tr key={p.asset} className="border-b border-apex-border/30 hover:bg-apex-surface/50">
                    <td className="py-2.5 font-sans font-bold text-apex-text pr-3">{p.asset}</td>
                    <td className="py-2.5 font-mono text-xs text-apex-text pr-3">{p.quantity?.toFixed(4)}</td>
                    <td className="py-2.5 font-mono text-xs text-apex-text pr-3">${p.entryPrice?.toFixed(2)}</td>
                    <td className="py-2.5 font-mono text-xs text-apex-text pr-3">${p.currentPrice?.toFixed(2)}</td>
                    <td className="py-2.5 font-mono text-xs text-apex-text pr-3">${(p.currentPrice * p.quantity)?.toFixed(2)}</td>
                    <td className={`py-2.5 font-mono text-xs font-bold pr-3 ${isPos ? 'text-apex-green' : 'text-apex-red'}`}>{isPos ? '+' : ''}${p.unrealizedPnl?.toFixed(2)}</td>
                    <td className={`py-2.5 font-mono text-xs pr-3 ${isPos ? 'text-apex-green' : 'text-apex-red'}`}>{isPos ? '+' : ''}{p.unrealizedPnlPct?.toFixed(2)}%</td>
                    <td className="py-2.5 font-mono text-xs text-apex-red pr-3">${p.stopLossPrice?.toFixed(2)}</td>
                    <td className="py-2.5 font-mono text-xs text-apex-green">${p.takeProfitPrice?.toFixed(2)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
