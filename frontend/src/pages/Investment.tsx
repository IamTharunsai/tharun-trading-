import { useQuery } from '@tanstack/react-query';
import { getPortfolio, getPositions, getTradeStats, getStocksUniverse, getRegimes } from '../services/api';
import { ResponsiveContainer, PieChart, Pie, Cell, Tooltip } from 'recharts';
import { TrendingUp, TrendingDown, DollarSign, Shield, BarChart2, Activity, Ban } from 'lucide-react';

const ASSET_COLORS = ['#FF8C42', '#2D8A4A', '#F5A623', '#DC2626', '#8B6F47', '#1B5E3F', '#C4A882', '#3B7DDB'];

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
  const { data: positions = [] } = useQuery({ queryKey: ['positions'], queryFn: getPositions, refetchInterval: 10000 });
  const { data: stats } = useQuery({ queryKey: ['trade-stats'], queryFn: getTradeStats });
  const { data: universe = [] } = useQuery({ queryKey: ['stocks-universe'], queryFn: getStocksUniverse, refetchInterval: 60000 });

  const openPositions: any[] = positions as any[];
  const positionAssets = openPositions.map(p => p.asset);
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
    value: (p.currentPrice || 0) * (p.quantity || 0),
  })).sort((a, b) => b.value - a.value);
  const allocationTotal = allocation.reduce((s, a) => s + a.value, 0) || 1;
  const pieData = allocation.map(a => ({ name: a.asset, value: a.value }));

  // Real trailing performance from actual trade history (backend sends these as toFixed() strings)
  const winRate      = stats?.winRate != null ? Number(stats.winRate) : null;
  const avgWin       = stats?.avgWin != null ? Number(stats.avgWin) : null;
  const avgLoss      = stats?.avgLoss != null ? Number(stats.avgLoss) : null;
  const profitFactor = stats?.profitFactor ?? null; // string, may be '∞'
  const totalTrades   = stats?.totalTrades ?? 0;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-sans font-bold text-2xl text-apex-text">Investment Plan</h1>
        <p className="font-mono text-xs text-apex-muted mt-1">
          Live portfolio composition + regime-driven strategy guidance — no fixed rules, agents adapt to current market conditions
        </p>
      </div>

      {/* Live Portfolio Stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {[
          { label: 'Portfolio Value',  value: `$${totalCapital.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`, icon: <DollarSign size={16} />, color: 'text-apex-accent' },
          { label: 'Deployed Capital', value: `$${invested.toFixed(2)}`,                                                                          icon: <BarChart2 size={16} />,  color: 'text-apex-green' },
          { label: 'Cash Available',   value: `$${cashBalance.toFixed(2)}`,                                                                       icon: <Shield size={16} />,     color: 'text-apex-muted' },
          { label: 'Total P&L',        value: `${pnlTotal >= 0 ? '+' : ''}$${pnlTotal.toFixed(2)}`,                                               icon: pnlTotal >= 0 ? <TrendingUp size={16} /> : <TrendingDown size={16} />, color: pnlTotal >= 0 ? 'text-apex-green' : 'text-apex-red' },
        ].map(s => (
          <div key={s.label} className="card">
            <div className="flex items-center gap-2 mb-2 text-apex-muted">{s.icon}<span className="font-mono text-xs uppercase tracking-widest">{s.label}</span></div>
            <div className={`font-sans font-bold text-xl ${s.color}`}>{s.value}</div>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Real Allocation Pie */}
        <div className="card">
          <h2 className="font-sans font-semibold text-apex-text mb-4">Capital Allocation (Actual Positions)</h2>
          {allocation.length === 0 ? (
            <div className="text-center py-10 font-mono text-xs text-apex-muted">No open positions — 100% cash</div>
          ) : (
            <>
              <ResponsiveContainer width="100%" height={200}>
                <PieChart>
                  <Pie data={pieData} cx="50%" cy="50%" innerRadius={50} outerRadius={80} dataKey="value" paddingAngle={2}>
                    {allocation.map((_, i) => <Cell key={i} fill={ASSET_COLORS[i % ASSET_COLORS.length]} />)}
                  </Pie>
                  <Tooltip formatter={(v: any) => [`$${Number(v).toFixed(2)}`]} contentStyle={{ background: '#FFFBF7', border: '1px solid #E8D5C4', borderRadius: 8, fontSize: 11, fontFamily: 'Space Mono' }} />
                </PieChart>
              </ResponsiveContainer>
              <div className="space-y-1 mt-2">
                {allocation.map((a, i) => (
                  <div key={a.asset} className="flex items-center gap-2 text-xs font-mono">
                    <div className="w-2.5 h-2.5 rounded-sm flex-shrink-0" style={{ background: ASSET_COLORS[i % ASSET_COLORS.length] }} />
                    <span className="text-apex-text flex-1 truncate">{a.asset}</span>
                    <span className="text-apex-muted">{((a.value / allocationTotal) * 100).toFixed(1)}%</span>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>

        {/* Regime-driven strategy guidance per held asset */}
        <div className="lg:col-span-2 card">
          <div className="flex items-center gap-2 mb-4">
            <Activity size={16} className="text-apex-accent" />
            <h2 className="font-sans font-semibold text-apex-text">Market Regime & Strategy Guidance</h2>
            <span className="font-mono text-[10px] text-apex-muted ml-auto">Detected hourly from live indicators — not hardcoded</span>
          </div>
          {openPositions.length === 0 ? (
            <div className="text-center py-10 font-mono text-xs text-apex-muted">No open positions to analyze</div>
          ) : (
            <div className="space-y-2">
              {openPositions.map(p => {
                const r = (regimes as Record<string, any>)[p.asset];
                const regime = r?.regime;
                return (
                  <div key={p.asset} className="p-3 rounded-lg border border-apex-border bg-apex-surface">
                    <div className="flex items-center justify-between flex-wrap gap-2">
                      <span className="font-sans font-bold text-sm text-apex-text">{p.asset}</span>
                      {regime ? (
                        <span className="font-mono text-xs font-bold px-2 py-0.5 rounded bg-apex-accent/10 text-apex-accent">
                          {REGIME_LABELS[regime] || regime}
                        </span>
                      ) : (
                        <span className="font-mono text-[10px] text-apex-muted">No cached regime read yet</span>
                      )}
                    </div>
                    {r && (
                      <div className="mt-2 space-y-1">
                        <div className="flex items-center gap-2 font-mono text-[10px] text-apex-green">
                          <TrendingUp size={11} /> Favored: {(r.allowedStrategies || []).join(', ') || '—'}
                        </div>
                        {(r.blockedStrategies || []).length > 0 && (
                          <div className="flex items-center gap-2 font-mono text-[10px] text-apex-red">
                            <Ban size={11} /> Blocked: {r.blockedStrategies.join(', ')}
                          </div>
                        )}
                        <div className="font-mono text-[10px] text-apex-muted">
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

      {/* Real trailing performance — replaces fantasy compounding projections */}
      <div className="card">
        <div className="flex items-center gap-2 mb-4">
          <BarChart2 size={16} className="text-apex-accent" />
          <h2 className="font-sans font-semibold text-apex-text">Trailing Performance ({totalTrades} closed trades)</h2>
          <span className="font-mono text-[10px] text-apex-muted ml-auto">Actual results, not projected</span>
        </div>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {[
            { label: 'Win Rate',      value: winRate !== null ? `${winRate.toFixed(1)}%` : '—', color: 'text-apex-accent' },
            { label: 'Avg Win',       value: avgWin !== null ? `+$${avgWin.toFixed(2)}` : '—',   color: 'text-apex-green' },
            { label: 'Avg Loss',      value: avgLoss !== null ? `-$${Math.abs(avgLoss).toFixed(2)}` : '—', color: 'text-apex-red' },
            { label: 'Profit Factor', value: profitFactor !== null ? String(profitFactor) : '—', color: 'text-apex-text' },
          ].map(s => (
            <div key={s.label} className="p-3 rounded-lg border border-apex-border bg-apex-surface">
              <div className="font-mono text-[10px] text-apex-muted uppercase mb-1">{s.label}</div>
              <div className={`font-sans font-bold text-lg ${s.color}`}>{s.value}</div>
            </div>
          ))}
        </div>
        {totalTrades === 0 && (
          <p className="font-mono text-[10px] text-apex-muted mt-3">No closed trades yet — stats populate as the agent council executes and exits positions.</p>
        )}
      </div>

      {/* Watchlist regime scan — assets currently tracked in the universe, even without a position */}
      {(universe as any[]).length > 0 && (
        <div className="card">
          <h2 className="font-sans font-semibold text-apex-text mb-4">Universe Snapshot</h2>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-apex-border">
                  {['Asset', 'Win Rate', 'Total P&L', 'Trades', 'Last Vote'].map(h => (
                    <th key={h} className="py-2 text-left font-mono text-xs text-apex-muted uppercase">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {(universe as any[]).slice(0, 12).map((u: any) => (
                  <tr key={u.symbol} className="border-b border-apex-border/50">
                    <td className="py-2 font-sans font-bold text-apex-text">{u.symbol}</td>
                    <td className="py-2 font-mono text-apex-muted">{u.winRate != null ? `${u.winRate.toFixed(1)}%` : '—'}</td>
                    <td className={`py-2 font-mono ${(u.totalPnl || 0) >= 0 ? 'text-apex-green' : 'text-apex-red'}`}>{u.totalPnl != null ? `${u.totalPnl >= 0 ? '+' : ''}$${u.totalPnl.toFixed(2)}` : '—'}</td>
                    <td className="py-2 font-mono text-apex-muted">{u.tradeCount ?? 0}</td>
                    <td className="py-2 font-mono text-apex-muted">{u.lastVote ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Current Open Positions */}
      {openPositions.length > 0 && (
        <div className="card">
          <h2 className="font-sans font-semibold text-apex-text mb-4">
            Open Positions ({openPositions.length})
          </h2>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-apex-border">
                  {['Asset', 'Entry', 'Current', 'Qty', 'Unr. P&L', 'Stop Loss', 'Take Profit'].map(h => (
                    <th key={h} className="py-2 text-left font-mono text-xs text-apex-muted uppercase first:pr-4 last:text-right">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {openPositions.map((pos: any) => {
                  const pnl = pos.unrealizedPnl || 0;
                  return (
                    <tr key={pos.id} className="border-b border-apex-border/50 hover:bg-apex-cream/30 transition-colors">
                      <td className="py-3 font-sans font-bold text-apex-text pr-4">{pos.asset}</td>
                      <td className="py-3 font-mono text-apex-muted">${pos.entryPrice?.toFixed(4)}</td>
                      <td className="py-3 font-mono text-apex-text">${pos.currentPrice?.toFixed(4)}</td>
                      <td className="py-3 font-mono text-apex-muted">{pos.quantity?.toFixed(4)}</td>
                      <td className={`py-3 font-mono font-bold ${pnl >= 0 ? 'text-apex-green' : 'text-apex-red'}`}>{pnl >= 0 ? '+' : ''}${pnl.toFixed(2)}</td>
                      <td className="py-3 font-mono text-apex-red">{pos.stopLossPrice ? `$${pos.stopLossPrice.toFixed(4)}` : '—'}</td>
                      <td className="py-3 font-mono text-apex-green text-right">{pos.takeProfitPrice ? `$${pos.takeProfitPrice.toFixed(4)}` : '—'}</td>
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
