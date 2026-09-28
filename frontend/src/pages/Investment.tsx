import { useQuery } from '@tanstack/react-query';
import { getPortfolio, getPositions, getTradeStats, getStocksUniverse, getRegimes } from '../services/api';
import { ResponsiveContainer, PieChart, Pie, Cell, Tooltip } from 'recharts';
import { TrendingUp, TrendingDown, DollarSign, Shield, BarChart2, Activity, Ban, Layers } from 'lucide-react';
import LastUpdated from '../components/common/LastUpdated';

const ASSET_COLORS = ['#2563EB', '#059669', '#D97706', '#7C3AED', '#DB2777', '#0284C7', '#4F46E5', '#0D9488'];

const REGIME_LABELS: Record<string, string> = {
  TRENDING_BULL: 'Trending Bull',
  TRENDING_BEAR: 'Trending Bear',
  CHOPPY_RANGE: 'Choppy Range',
  HIGH_VOLATILITY: 'High Volatility',
  COMPRESSION: 'Compression',
  RECOVERY: 'Recovery',
  DISTRIBUTION: 'Distribution',
};

export default function InvestmentPage() {
  const { data: portfolio } = useQuery({ queryKey: ['portfolio'], queryFn: getPortfolio, refetchInterval: 10000 });
  const { data: positions } = useQuery({ queryKey: ['positions'], queryFn: getPositions, refetchInterval: 10000 });
  const { data: stats } = useQuery({ queryKey: ['trade-stats'], queryFn: getTradeStats });
  const { data: universe } = useQuery({ queryKey: ['stocks-universe'], queryFn: getStocksUniverse, refetchInterval: 60000 });

  const openPositions: any[] = Array.isArray(positions)
    ? positions
    : Array.isArray((positions as any)?.positions)
    ? (positions as any).positions
    : [];

  const universeList: any[] = Array.isArray(universe)
    ? universe
    : Array.isArray((universe as any)?.stocks)
    ? (universe as any).stocks
    : [];

  const positionAssets = openPositions.map(p => p.asset).filter(Boolean);
  const { data: regimes = {} } = useQuery({
    queryKey: ['regimes', positionAssets.join(',')],
    queryFn: () => getRegimes(positionAssets),
    enabled: positionAssets.length > 0,
    refetchInterval: 60000,
  });

  const totalCapital = portfolio?.totalValue || 0;
  const cashBalance  = portfolio?.cashBalance || 0;
  const invested     = portfolio?.invested || 0;
  const pnlTotal     = portfolio?.pnlTotal || 0;

  // Real capital allocation: actual position market value as % of invested capital
  const allocation = openPositions.map(p => ({
    asset: p.asset,
    value: (p.currentPrice || p.entryPrice || 0) * (p.quantity || 0),
  })).sort((a, b) => b.value - a.value);
  const allocationTotal = allocation.reduce((s, a) => s + a.value, 0) || 1;
  const pieData = allocation.map(a => ({ name: a.asset, value: a.value }));

  // Real trailing performance from actual trade history
  const winRate      = stats?.winRate != null ? Number(stats.winRate) : null;
  const avgWin       = stats?.avgWin != null ? Number(stats.avgWin) : null;
  const avgLoss      = stats?.avgLoss != null ? Number(stats.avgLoss) : null;
  const profitFactor = stats?.profitFactor ?? null;
  const totalTrades  = stats?.totalTrades ?? 0;

  return (
    <div className="space-y-6 max-w-7xl mx-auto text-slate-900">
      <div className="flex items-center justify-between flex-wrap gap-2 p-5 rounded-xl bg-white border border-slate-200/90 shadow-sm">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="font-bold text-2xl text-slate-900 tracking-tight font-display">Investment Strategy & Asset Guidance</h1>
            <span className="font-mono text-[11px] px-2.5 py-0.5 rounded-full bg-blue-50 text-blue-700 border border-blue-200 font-bold">
              REGIME ADAPTATION
            </span>
          </div>
          <p className="font-mono text-xs text-slate-500 mt-1">
            Live portfolio composition + regime-driven strategy guidance — no fixed rules, agents adapt to market conditions
          </p>
        </div>
        <LastUpdated />
      </div>

      {/* Live Portfolio Stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {[
          { label: 'Portfolio Value',  value: `$${totalCapital.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`, icon: <DollarSign size={16} />, color: 'text-blue-700' },
          { label: 'Deployed Capital', value: `$${invested.toFixed(2)}`, icon: <BarChart2 size={16} />, color: 'text-emerald-600' },
          { label: 'Cash Available',   value: `$${cashBalance.toFixed(2)}`, icon: <Shield size={16} />, color: 'text-slate-700' },
          { label: 'Total P&L',        value: `${pnlTotal >= 0 ? '+' : ''}$${pnlTotal.toFixed(2)}`, icon: pnlTotal >= 0 ? <TrendingUp size={16} /> : <TrendingDown size={16} />, color: pnlTotal >= 0 ? 'text-emerald-600' : 'text-red-600' },
        ].map(s => (
          <div key={s.label} className="p-4 rounded-xl bg-white border border-slate-200/90 shadow-sm">
            <div className="flex items-center justify-between mb-2">
              <span className="font-mono text-[10px] uppercase tracking-wider font-semibold text-slate-500">{s.label}</span>
              <span className="text-blue-600">{s.icon}</span>
            </div>
            <div className={`font-mono font-bold text-2xl tabular-nums ${s.color}`}>{s.value}</div>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Real Allocation Pie */}
        <div className="p-5 rounded-xl bg-white border border-slate-200/90 shadow-sm flex flex-col justify-between">
          <div>
            <h2 className="font-semibold text-slate-900 text-sm mb-4">Capital Allocation (Actual Positions)</h2>
            {allocation.length === 0 ? (
              <div className="text-center py-10 font-mono text-xs text-slate-400">No open positions — 100% cash reserve</div>
            ) : (
              <>
                <ResponsiveContainer width="100%" height={200}>
                  <PieChart>
                    <Pie data={pieData} cx="50%" cy="50%" innerRadius={50} outerRadius={80} dataKey="value" paddingAngle={2}>
                      {allocation.map((_, i) => <Cell key={i} fill={ASSET_COLORS[i % ASSET_COLORS.length]} stroke="#FFFFFF" strokeWidth={2} />)}
                    </Pie>
                    <Tooltip formatter={(v: any) => [`$${Number(v).toFixed(2)}`]} contentStyle={{ background: '#FFFFFF', border: '1px solid #CBD5E1', borderRadius: 8, fontSize: 11, fontFamily: 'JetBrains Mono', color: '#0F172A', boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.1)' }} />
                  </PieChart>
                </ResponsiveContainer>
                <div className="space-y-1.5 mt-2">
                  {allocation.map((a, i) => (
                    <div key={a.asset} className="flex items-center gap-2 text-xs font-mono">
                      <div className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ background: ASSET_COLORS[i % ASSET_COLORS.length] }} />
                      <span className="text-slate-900 font-semibold flex-1 truncate">{a.asset}</span>
                      <span className="text-slate-500 font-bold tabular-nums">{((a.value / allocationTotal) * 100).toFixed(1)}%</span>
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>
        </div>

        {/* Regime-driven strategy guidance per held asset */}
        <div className="lg:col-span-2 p-5 rounded-xl bg-white border border-slate-200/90 shadow-sm">
          <div className="flex items-center gap-2 mb-4">
            <Activity size={16} className="text-blue-600" />
            <h2 className="font-semibold text-slate-900 text-sm">Market Regime & Strategy Guidance</h2>
            <span className="font-mono text-[10px] text-slate-500 ml-auto">Detected hourly from live indicators · Machine adaptive</span>
          </div>
          {openPositions.length === 0 ? (
            <div className="text-center py-10 font-mono text-xs text-slate-400">No open positions to analyze</div>
          ) : (
            <div className="space-y-2.5">
              {openPositions.map(p => {
                const r = (regimes as Record<string, any>)[p.asset];
                const regime = r?.regime;
                return (
                  <div key={p.asset} className="p-3 rounded-lg border border-slate-200 bg-slate-50">
                    <div className="flex items-center justify-between flex-wrap gap-2">
                      <span className="font-bold text-sm text-slate-900">{p.asset}</span>
                      {regime ? (
                        <span className="font-mono text-xs font-bold px-2 py-0.5 rounded bg-blue-50 text-blue-700 border border-blue-200">
                          {REGIME_LABELS[regime] || regime}
                        </span>
                      ) : (
                        <span className="font-mono text-[10px] text-slate-400">Monitoring indicators</span>
                      )}
                    </div>
                    {r && (
                      <div className="mt-2 space-y-1">
                        <div className="flex items-center gap-2 font-mono text-[11px] text-emerald-600 font-semibold">
                          <TrendingUp size={12} /> Favored: {(r.allowedStrategies || []).join(', ') || '—'}
                        </div>
                        {(r.blockedStrategies || []).length > 0 && (
                          <div className="flex items-center gap-2 font-mono text-[11px] text-red-600 font-semibold">
                            <Ban size={12} /> Blocked: {r.blockedStrategies.join(', ')}
                          </div>
                        )}
                        <div className="font-mono text-[11px] text-slate-500">
                          Position sizing: {r.positionSizeMultiplier}x normal · {r.reasoning || ''}
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* Real trailing performance */}
      <div className="p-5 rounded-xl bg-white border border-slate-200/90 shadow-sm">
        <div className="flex items-center gap-2 mb-4">
          <BarChart2 size={16} className="text-blue-600" />
          <h2 className="font-semibold text-slate-900 text-sm">Trailing Performance ({totalTrades} closed trades)</h2>
          <span className="font-mono text-[10px] text-slate-500 ml-auto">Actual results, not projected</span>
        </div>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {[
            { label: 'Win Rate',      value: winRate !== null ? `${winRate.toFixed(1)}%` : '—', color: 'text-blue-700' },
            { label: 'Avg Win',       value: avgWin !== null ? `+$${avgWin.toFixed(2)}` : '—',   color: 'text-emerald-600' },
            { label: 'Avg Loss',      value: avgLoss !== null ? `-$${Math.abs(avgLoss).toFixed(2)}` : '—', color: 'text-red-600' },
            { label: 'Profit Factor', value: profitFactor !== null ? String(profitFactor) : '—', color: 'text-slate-900' },
          ].map(s => (
            <div key={s.label} className="p-3.5 rounded-lg border border-slate-200 bg-slate-50">
              <div className="font-mono text-[10px] text-slate-500 uppercase font-semibold mb-1">{s.label}</div>
              <div className={`font-mono font-bold text-xl tabular-nums ${s.color}`}>{s.value}</div>
            </div>
          ))}
        </div>
        {totalTrades === 0 && (
          <p className="font-mono text-[11px] text-slate-400 mt-3">No closed trades yet — stats populate as the agent council executes and exits positions.</p>
        )}
      </div>

      {/* Watchlist regime scan */}
      {universeList.length > 0 && (
        <div className="p-5 rounded-xl bg-white border border-slate-200/90 shadow-sm">
          <h2 className="font-semibold text-slate-900 text-sm mb-4">Universe Snapshot</h2>
          <div className="overflow-x-auto">
            <table className="w-full text-xs font-mono">
              <thead>
                <tr className="border-b border-slate-200 text-slate-500 bg-slate-50/50">
                  {['Asset', 'Win Rate', 'Total P&L', 'Trades', 'Last Vote'].map(h => (
                    <th key={h} className="py-2 px-2.5 text-left text-[10px] uppercase font-bold tracking-wider">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {universeList.slice(0, 12).map((u: any) => (
                  <tr key={u.symbol} className="hover:bg-slate-50/80 transition-colors">
                    <td className="py-2 px-2.5 font-bold text-slate-900">{u.symbol}</td>
                    <td className="py-2 px-2.5 text-slate-600 tabular-nums">{u.winRate != null ? `${u.winRate.toFixed(1)}%` : '—'}</td>
                    <td className={`py-2 px-2.5 font-bold tabular-nums ${(u.totalPnl || 0) >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>
                      {u.totalPnl != null ? `${u.totalPnl >= 0 ? '+' : ''}$${u.totalPnl.toFixed(2)}` : '—'}
                    </td>
                    <td className="py-2 px-2.5 text-slate-600 tabular-nums">{u.tradeCount ?? 0}</td>
                    <td className="py-2 px-2.5">
                      <span className={`text-[10px] px-2 py-0.5 rounded font-bold ${
                        u.lastVote === 'BUY' ? 'bg-emerald-50 text-emerald-700 border border-emerald-200' :
                        u.lastVote === 'SELL' ? 'bg-red-50 text-red-700 border border-red-200' : 'bg-slate-100 text-slate-600'
                      }`}>
                        {u.lastVote ?? '—'}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Current Open Positions */}
      {openPositions.length > 0 && (
        <div className="p-5 rounded-xl bg-white border border-slate-200/90 shadow-sm">
          <div className="flex items-center gap-2 mb-4">
            <Layers size={16} className="text-blue-600" />
            <h2 className="font-semibold text-slate-900 text-sm">
              Open Positions ({openPositions.length})
            </h2>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-xs font-mono">
              <thead>
                <tr className="border-b border-slate-200 text-slate-500 bg-slate-50/50">
                  {['Asset', 'Entry', 'Current', 'Qty', 'Unr. P&L', 'Stop Loss', 'Take Profit'].map(h => (
                    <th key={h} className="py-2 px-2.5 text-left text-[10px] uppercase font-bold tracking-wider">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {openPositions.map((pos: any) => {
                  const pnl = pos.unrealizedPnl || 0;
                  const isPos = pnl >= 0;
                  return (
                    <tr key={pos.id || pos.asset} className="hover:bg-slate-50/80 transition-colors">
                      <td className="py-2.5 px-2.5 font-bold text-slate-900">{pos.asset}</td>
                      <td className="py-2.5 px-2.5 text-slate-700 tabular-nums">${pos.entryPrice?.toFixed(2)}</td>
                      <td className="py-2.5 px-2.5 text-slate-900 font-bold tabular-nums">${pos.currentPrice?.toFixed(2)}</td>
                      <td className="py-2.5 px-2.5 text-slate-700 tabular-nums">{pos.quantity?.toFixed(4)}</td>
                      <td className={`py-2.5 px-2.5 font-bold tabular-nums ${isPos ? 'text-emerald-600' : 'text-red-600'}`}>
                        {isPos ? '+' : ''}${pnl.toFixed(2)}
                      </td>
                      <td className="py-2.5 px-2.5 text-red-600 tabular-nums">${pos.stopLossPrice?.toFixed(2) || '—'}</td>
                      <td className="py-2.5 px-2.5 text-emerald-600 tabular-nums">${pos.takeProfitPrice?.toFixed(2) || '—'}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
