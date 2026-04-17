import { useQuery } from '@tanstack/react-query';
import { getPortfolio, getPositions, getTradeStats } from '../services/api';
import { ResponsiveContainer, PieChart, Pie, Cell, Tooltip, AreaChart, Area, XAxis, YAxis, CartesianGrid } from 'recharts';
import { TrendingUp, TrendingDown, DollarSign, Target, Shield, BarChart2, Clock, Zap } from 'lucide-react';

const STRATEGY_COLORS = ['#FF8C42', '#2D8A4A', '#F5A623', '#DC2626', '#8B6F47', '#1B5E3F'];

const STRATEGIES = [
  { name: 'Crypto Momentum',    pct: 30, return: '8–15%',  timeframe: 'Days–Weeks',  icon: '₿', risk: 'High' },
  { name: 'Stock Momentum',     pct: 20, return: '5–10%',  timeframe: 'Weeks',       icon: '📈', risk: 'Medium' },
  { name: 'Prediction Markets', pct: 15, return: '10–20%', timeframe: 'Event-based', icon: '🎯', risk: 'High' },
  { name: 'Options Premium',    pct: 15, return: '3–5%',   timeframe: 'Monthly',     icon: '📉', risk: 'Medium' },
  { name: 'Arbitrage',          pct: 10, return: '2–4%',   timeframe: 'Instant',     icon: '⚖️', risk: 'Low' },
  { name: 'Cash Reserve',       pct: 10, return: '0%',     timeframe: 'Always',      icon: '💵', risk: 'None' },
];

const LONG_TERM_HOLDINGS = [
  { asset: 'BTC',  name: 'Bitcoin',    allocation: 40, horizon: '3–5 years',  thesis: 'Store of value, institutional adoption, limited supply' },
  { asset: 'ETH',  name: 'Ethereum',   allocation: 25, horizon: '3–5 years',  thesis: 'Smart contract leader, DeFi backbone, deflationary post-merge' },
  { asset: 'SOL',  name: 'Solana',     allocation: 10, horizon: '2–3 years',  thesis: 'High-throughput L1, growing DeFi/NFT ecosystem' },
  { asset: 'NVDA', name: 'NVIDIA',     allocation: 15, horizon: '5–10 years', thesis: 'AI compute dominance, GPU monopoly for ML training' },
  { asset: 'MSFT', name: 'Microsoft',  allocation: 10, horizon: '5–10 years', thesis: 'Cloud (Azure), AI integration, stable dividend growth' },
];

const DCA_PLAN = [
  { asset: 'BTC',  weekly: 100, monthly: 400, strategy: 'Buy regardless of price — dollar cost average over market cycles' },
  { asset: 'ETH',  weekly: 50,  monthly: 200, strategy: 'Accumulate during corrections > 20% from ATH' },
  { asset: 'NVDA', weekly: 75,  monthly: 300, strategy: 'Buy on earnings dips, accumulate before AI product cycles' },
];

function compoundGrowth(principal: number, annualRate: number, years: number) {
  return principal * Math.pow(1 + annualRate / 100, years);
}

export default function InvestmentPage() {
  const { data: portfolio } = useQuery({ queryKey: ['portfolio'], queryFn: getPortfolio, refetchInterval: 10000 });
  const { data: positions = [] } = useQuery({ queryKey: ['positions'], queryFn: getPositions, refetchInterval: 10000 });
  const { data: stats } = useQuery({ queryKey: ['trade-stats'], queryFn: getTradeStats });

  const totalCapital = portfolio?.totalValue || 10000;
  const cashBalance  = portfolio?.cashBalance || 0;
  const invested     = portfolio?.invested || 0;
  const pnlTotal     = portfolio?.pnlTotal || 0;
  const openPositions = (positions as any[]).length;

  const pieData = STRATEGIES.map(s => ({ name: s.name, value: s.pct }));

  // Projection scenarios for long-term compounding
  const projections = [1, 3, 5, 10].map(years => ({
    years,
    conservative: compoundGrowth(totalCapital, 12, years),
    base:         compoundGrowth(totalCapital, 22, years),
    optimistic:   compoundGrowth(totalCapital, 40, years),
  }));

  const projChartData = projections.map(p => ({
    years: `${p.years}Y`,
    conservative: Math.round(p.conservative),
    base:         Math.round(p.base),
    optimistic:   Math.round(p.optimistic),
  }));

  // DCA monthly totals
  const monthlyDCA = DCA_PLAN.reduce((s, d) => s + d.monthly, 0);
  const yearlyDCA  = monthlyDCA * 12;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-sans font-bold text-2xl text-apex-text">Investment Plan</h1>
        <p className="font-mono text-xs text-apex-muted mt-1">
          Active trading strategies + long-term compounding portfolio
        </p>
      </div>

      {/* Live Portfolio Stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {[
          { label: 'Portfolio Value',   value: `$${totalCapital.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`, icon: <DollarSign size={16} />, color: 'text-apex-accent' },
          { label: 'Deployed Capital',  value: `$${invested.toFixed(2)}`,                                                                          icon: <BarChart2 size={16} />,  color: 'text-apex-green' },
          { label: 'Cash Available',    value: `$${cashBalance.toFixed(2)}`,                                                                        icon: <Shield size={16} />,     color: 'text-apex-muted' },
          { label: 'Total P&L',         value: `${pnlTotal >= 0 ? '+' : ''}$${pnlTotal.toFixed(2)}`,                                               icon: pnlTotal >= 0 ? <TrendingUp size={16} /> : <TrendingDown size={16} />, color: pnlTotal >= 0 ? 'text-apex-green' : 'text-apex-red' },
        ].map(s => (
          <div key={s.label} className="card">
            <div className="flex items-center gap-2 mb-2 text-apex-muted">{s.icon}<span className="font-mono text-xs uppercase tracking-widest">{s.label}</span></div>
            <div className={`font-sans font-bold text-xl ${s.color}`}>{s.value}</div>
          </div>
        ))}
      </div>

      {/* Active Strategies */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Allocation Pie */}
        <div className="card">
          <h2 className="font-sans font-semibold text-apex-text mb-4">Capital Allocation</h2>
          <ResponsiveContainer width="100%" height={200}>
            <PieChart>
              <Pie data={pieData} cx="50%" cy="50%" innerRadius={50} outerRadius={80} dataKey="value" paddingAngle={2}>
                {STRATEGIES.map((_, i) => <Cell key={i} fill={STRATEGY_COLORS[i]} />)}
              </Pie>
              <Tooltip formatter={(v: any) => [`${v}%`]} contentStyle={{ background: '#FFFBF7', border: '1px solid #E8D5C4', borderRadius: 8, fontSize: 11, fontFamily: 'Space Mono' }} />
            </PieChart>
          </ResponsiveContainer>
          <div className="space-y-1 mt-2">
            {STRATEGIES.map((s, i) => (
              <div key={s.name} className="flex items-center gap-2 text-xs font-mono">
                <div className="w-2.5 h-2.5 rounded-sm flex-shrink-0" style={{ background: STRATEGY_COLORS[i] }} />
                <span className="text-apex-text flex-1 truncate">{s.name}</span>
                <span className="text-apex-muted">{s.pct}%</span>
              </div>
            ))}
          </div>
        </div>

        {/* Strategy Details */}
        <div className="lg:col-span-2 card">
          <h2 className="font-sans font-semibold text-apex-text mb-4">Active Strategies</h2>
          <div className="space-y-2">
            {STRATEGIES.map((s, i) => (
              <div key={s.name} className="flex items-start gap-3 p-3 rounded-lg" style={{ background: `${STRATEGY_COLORS[i]}10`, border: `1px solid ${STRATEGY_COLORS[i]}30` }}>
                <span className="text-lg">{s.icon}</span>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between">
                    <span className="font-sans font-semibold text-sm text-apex-text">{s.name}</span>
                    <span className="font-mono text-xs text-apex-muted">{s.pct}% · ${((totalCapital * s.pct) / 100).toLocaleString('en-US', { maximumFractionDigits: 0 })}</span>
                  </div>
                  <div className="flex items-center gap-3 mt-1">
                    <span className="font-mono text-xs text-apex-green">↑ {s.return}/yr</span>
                    <span className="font-mono text-xs text-apex-muted">⏱ {s.timeframe}</span>
                    <span className={`font-mono text-xs ${s.risk === 'High' ? 'text-apex-red' : s.risk === 'Medium' ? 'text-apex-yellow' : s.risk === 'Low' ? 'text-apex-green' : 'text-apex-muted'}`}>
                      {s.risk} risk
                    </span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Long-Term Holdings */}
      <div className="card">
        <div className="flex items-center gap-2 mb-4">
          <Clock size={16} className="text-apex-accent" />
          <h2 className="font-sans font-semibold text-apex-text">Long-Term Holdings (HODL Portfolio)</h2>
          <span className="font-mono text-xs text-apex-muted ml-auto">Buy & Hold · Years-long horizon</span>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
          {LONG_TERM_HOLDINGS.map(h => (
            <div key={h.asset} className="p-3 rounded-lg border border-apex-border bg-apex-surface">
              <div className="flex items-center justify-between mb-2">
                <div>
                  <span className="font-sans font-bold text-apex-text">{h.asset}</span>
                  <span className="font-mono text-xs text-apex-muted ml-2">{h.name}</span>
                </div>
                <span className="font-mono text-sm font-bold text-apex-accent">{h.allocation}%</span>
              </div>
              <div className="font-mono text-[10px] text-apex-muted mb-1">⏱ {h.horizon}</div>
              <div className="font-mono text-[10px] text-apex-text leading-relaxed">{h.thesis}</div>
              <div className="mt-2 h-1 bg-apex-border rounded-full overflow-hidden">
                <div className="h-full bg-apex-accent rounded-full" style={{ width: `${h.allocation}%` }} />
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* DCA Plan */}
      <div className="card">
        <div className="flex items-center gap-2 mb-4">
          <Zap size={16} className="text-apex-accent" />
          <h2 className="font-sans font-semibold text-apex-text">Dollar Cost Averaging (DCA) Plan</h2>
          <div className="ml-auto font-mono text-xs text-apex-muted">
            ${monthlyDCA}/month · ${yearlyDCA.toLocaleString()}/year
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-apex-border">
                <th className="text-left py-2 font-mono text-xs text-apex-muted uppercase">Asset</th>
                <th className="text-right py-2 font-mono text-xs text-apex-muted uppercase">Weekly</th>
                <th className="text-right py-2 font-mono text-xs text-apex-muted uppercase">Monthly</th>
                <th className="text-left py-2 pl-4 font-mono text-xs text-apex-muted uppercase">Strategy</th>
              </tr>
            </thead>
            <tbody>
              {DCA_PLAN.map(d => (
                <tr key={d.asset} className="border-b border-apex-border/50 hover:bg-apex-cream/40 transition-colors">
                  <td className="py-3 font-sans font-bold text-apex-text">{d.asset}</td>
                  <td className="py-3 text-right font-mono text-apex-muted">${d.weekly}</td>
                  <td className="py-3 text-right font-mono font-bold text-apex-green">${d.monthly}</td>
                  <td className="py-3 pl-4 font-mono text-xs text-apex-muted">{d.strategy}</td>
                </tr>
              ))}
              <tr className="bg-apex-cream/50">
                <td className="py-2 font-sans font-bold text-apex-text">TOTAL</td>
                <td className="py-2 text-right font-mono font-bold text-apex-accent">${DCA_PLAN.reduce((s, d) => s + d.weekly, 0)}</td>
                <td className="py-2 text-right font-mono font-bold text-apex-accent">${monthlyDCA}</td>
                <td className="py-2 pl-4 font-mono text-xs text-apex-green">+${yearlyDCA.toLocaleString()} annually</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      {/* Compounding Projections */}
      <div className="card">
        <div className="flex items-center gap-2 mb-4">
          <Target size={16} className="text-apex-accent" />
          <h2 className="font-sans font-semibold text-apex-text">Long-Term Growth Projections</h2>
          <span className="font-mono text-xs text-apex-muted ml-auto">Starting: ${totalCapital.toLocaleString('en-US', { maximumFractionDigits: 0 })}</span>
        </div>

        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
          {projections.map(p => (
            <div key={p.years} className="p-3 rounded-lg border border-apex-border bg-apex-surface">
              <div className="font-mono text-xs text-apex-muted mb-2 uppercase">{p.years} Year{p.years > 1 ? 's' : ''}</div>
              <div className="space-y-1">
                <div className="flex justify-between">
                  <span className="font-mono text-[10px] text-apex-muted">Conservative</span>
                  <span className="font-mono text-[10px] font-bold text-apex-muted">${p.conservative.toLocaleString('en-US', { maximumFractionDigits: 0 })}</span>
                </div>
                <div className="flex justify-between">
                  <span className="font-mono text-[10px] text-apex-green">Base Case</span>
                  <span className="font-mono text-[10px] font-bold text-apex-green">${p.base.toLocaleString('en-US', { maximumFractionDigits: 0 })}</span>
                </div>
                <div className="flex justify-between">
                  <span className="font-mono text-[10px] text-apex-accent">Optimistic</span>
                  <span className="font-mono text-[10px] font-bold text-apex-accent">${p.optimistic.toLocaleString('en-US', { maximumFractionDigits: 0 })}</span>
                </div>
              </div>
            </div>
          ))}
        </div>

        <div className="text-xs font-mono text-apex-muted p-3 bg-apex-cream/50 rounded-lg">
          <strong className="text-apex-text">Assumptions:</strong> Conservative = 12% APY (S&P average) · Base Case = 22% APY (active trading) · Optimistic = 40% APY (bull market).
          Projections compound annually and do not include DCA contributions. Past performance does not guarantee future results.
        </div>
      </div>

      {/* Current Open Positions */}
      {openPositions > 0 && (
        <div className="card">
          <h2 className="font-sans font-semibold text-apex-text mb-4">
            Open Positions ({openPositions})
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
                {(positions as any[]).map((pos: any) => {
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
