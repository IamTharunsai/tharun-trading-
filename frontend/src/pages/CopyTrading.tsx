import { useState, useMemo } from 'react';
import {
  Users, TrendingUp, ShieldCheck, Zap, ArrowUpRight, CheckCircle,
  Pause, Play, AlertCircle, Sliders, DollarSign, Award, Clock,
  ArrowRight, Search, Activity, ChevronRight, X
} from 'lucide-react';
import toast from 'react-hot-toast';
import StatCard from '../components/common/StatCard';
import LastUpdated from '../components/common/LastUpdated';

interface MasterTrader {
  id: string;
  name: string;
  handle: string;
  avatar: string;
  badge: string;
  assetClass: string;
  roi30d: number;
  roiAllTime: number;
  winRate: number;
  maxDrawdown: number;
  copiers: number;
  aum: string;
  riskScore: number; // 1 to 10
  profitShare: number; // e.g. 10%
  description: string;
  activePositionsCount: number;
  sparkline: number[];
  recentTrades: { asset: string; type: 'BUY' | 'SELL'; pnlPct: number; time: string }[];
}

interface ActiveCopy {
  id: string;
  masterId: string;
  masterName: string;
  masterHandle: string;
  allocatedAmount: number;
  currentValue: number;
  pnl: number;
  pnlPct: number;
  activePositions: number;
  stopLossPct: number;
  status: 'ACTIVE' | 'PAUSED';
  startedAt: string;
}

const MASTER_TRADERS: MasterTrader[] = [
  {
    id: 'master-1',
    name: 'Citadel Momentum Alpha',
    handle: '@citadel_quant',
    avatar: '🏛️',
    badge: 'TOP EQUITIES',
    assetClass: 'US Stocks & ETFs',
    roi30d: 34.2,
    roiAllTime: 184.5,
    winRate: 78.5,
    maxDrawdown: -3.8,
    copiers: 1482,
    aum: '$4.8M',
    riskScore: 4,
    profitShare: 10,
    description: 'Multi-factor institutional momentum algorithm targeting high-beta tech breakouts with tight volume-weighted stop losses.',
    activePositionsCount: 4,
    sparkline: [100, 104, 102, 108, 114, 112, 119, 126, 124, 134.2],
    recentTrades: [
      { asset: 'NVDA', type: 'BUY', pnlPct: 6.4, time: '12m ago' },
      { asset: 'TSLA', type: 'BUY', pnlPct: 4.1, time: '2h ago' },
      { asset: 'MSFT', type: 'BUY', pnlPct: 2.8, time: '5h ago' },
    ]
  },
  {
    id: 'master-2',
    name: 'Satoshi On-Chain Whale Alpha',
    handle: '@whale_satoshi',
    avatar: '🐋',
    badge: 'CRYPTO TITAN',
    assetClass: 'Digital Assets (BTC/SOL/ETH)',
    roi30d: 52.1,
    roiAllTime: 312.0,
    winRate: 74.0,
    maxDrawdown: -7.2,
    copiers: 2340,
    aum: '$7.2M',
    riskScore: 7,
    profitShare: 12,
    description: 'Exploits funding rate imbalances, perpetual futures basis arbitrage, and on-chain whale liquidation cascades.',
    activePositionsCount: 5,
    sparkline: [100, 108, 105, 116, 122, 118, 131, 142, 138, 152.1],
    recentTrades: [
      { asset: 'SOL', type: 'BUY', pnlPct: 9.8, time: '24m ago' },
      { asset: 'BTC', type: 'BUY', pnlPct: 3.5, time: '1h ago' },
      { asset: 'ETH', type: 'BUY', pnlPct: 5.2, time: '4h ago' },
    ]
  },
  {
    id: 'master-3',
    name: 'Polymarket Superforecaster AI',
    handle: '@poly_superforecaster',
    avatar: '🔮',
    badge: 'BAYESIAN ORACLE',
    assetClass: 'Polymarket Event Contracts',
    roi30d: 38.6,
    roiAllTime: 142.8,
    winRate: 85.2,
    maxDrawdown: -2.4,
    copiers: 1120,
    aum: '$2.1M',
    riskScore: 3,
    profitShare: 10,
    description: 'Statistical probability delta exploitation across macro interest rate cuts, economic data releases, and tech milestone contracts.',
    activePositionsCount: 6,
    sparkline: [100, 103, 106, 110, 115, 119, 124, 129, 133, 138.6],
    recentTrades: [
      { asset: 'Fed 25bps Cut YES', type: 'BUY', pnlPct: 18.5, time: '40m ago' },
      { asset: 'US CPI <2.7% YES', type: 'BUY', pnlPct: 14.7, time: '3h ago' },
      { asset: 'Solana ATH Q3 YES', type: 'BUY', pnlPct: 54.8, time: '1d ago' },
    ]
  },
  {
    id: 'master-4',
    name: 'Renaissance Stat-Arb Matrix',
    handle: '@ren_matrix',
    avatar: '📐',
    badge: 'LOW VOLATILITY',
    assetClass: 'Market-Neutral Equities Pairs',
    roi30d: 21.4,
    roiAllTime: 96.2,
    winRate: 72.8,
    maxDrawdown: -1.8,
    copiers: 960,
    aum: '$3.5M',
    riskScore: 2,
    profitShare: 8,
    description: 'Co-integration mean-reversion algorithm designed for capital preservation and steady high Sharpe-ratio alpha generation.',
    activePositionsCount: 3,
    sparkline: [100, 102, 104, 106, 109, 111, 114, 117, 119, 121.4],
    recentTrades: [
      { asset: 'SPY Long / QQQ Short', type: 'BUY', pnlPct: 2.1, time: '35m ago' },
      { asset: 'AMD / INTC Spread', type: 'BUY', pnlPct: 3.4, time: '2h ago' },
    ]
  }
];

export default function CopyTradingPage() {
  const [selectedAssetClass, setSelectedAssetClass] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [selectedMaster, setSelectedMaster] = useState<MasterTrader | null>(null);

  // Copy Configuration Modal State
  const [copyAmount, setCopyAmount] = useState<number>(500);
  const [stopLossPct, setStopLossPct] = useState<number>(10);
  const [maxSlippage, setMaxSlippage] = useState<number>(0.2);
  const [autoCompound, setAutoCompound] = useState<boolean>(true);

  // User's active copied strategies
  const [activeCopies, setActiveCopies] = useState<ActiveCopy[]>([
    {
      id: 'copy-1',
      masterId: 'master-1',
      masterName: 'Citadel Momentum Alpha',
      masterHandle: '@citadel_quant',
      allocatedAmount: 1000,
      currentValue: 1142.50,
      pnl: 142.50,
      pnlPct: 14.25,
      activePositions: 4,
      stopLossPct: 10,
      status: 'ACTIVE',
      startedAt: '4 days ago',
    },
    {
      id: 'copy-2',
      masterId: 'master-3',
      masterName: 'Polymarket Superforecaster AI',
      masterHandle: '@poly_superforecaster',
      allocatedAmount: 500,
      currentValue: 588.20,
      pnl: 88.20,
      pnlPct: 17.64,
      activePositions: 3,
      stopLossPct: 8,
      status: 'ACTIVE',
      startedAt: '2 days ago',
    }
  ]);

  // Live Mirrored Trades Feed
  const [liveStream] = useState([
    { id: '1', master: '@citadel_quant', asset: 'NVDA', side: 'BUY', price: '$128.40', time: 'Just now', status: 'Mirrored at 0.04s latency' },
    { id: '2', master: '@poly_superforecaster', asset: 'Fed cuts rates >=25bps YES', side: 'BUY', price: '68¢', time: '2m ago', status: 'Order executed on Polymarket CLOB' },
    { id: '3', master: '@whale_satoshi', asset: 'SOL', side: 'BUY', price: '$154.20', time: '8m ago', status: 'Position opened (+7.2% trailing stop)' },
  ]);

  // Connected Portfolio KPIs
  const copyMetrics = useMemo(() => {
    const totalAllocated = activeCopies.reduce((acc, c) => acc + c.allocatedAmount, 0);
    const totalCurrentValue = activeCopies.reduce((acc, c) => acc + c.currentValue, 0);
    const totalPnl = activeCopies.reduce((acc, c) => acc + c.pnl, 0);
    const totalPnlPct = totalAllocated > 0 ? (totalPnl / totalAllocated) * 100 : 0;
    const totalActivePositions = activeCopies.reduce((acc, c) => acc + c.activePositions, 0);

    return {
      totalAllocated,
      totalCurrentValue,
      totalPnl,
      totalPnlPct,
      totalActivePositions,
      activeFollowedCount: activeCopies.filter(c => c.status === 'ACTIVE').length
    };
  }, [activeCopies]);

  const filteredMasters = MASTER_TRADERS.filter(m => {
    const matchesCategory = selectedAssetClass === 'all' ||
      (selectedAssetClass === 'stocks' && m.assetClass.includes('Stocks')) ||
      (selectedAssetClass === 'crypto' && m.assetClass.includes('Digital Assets')) ||
      (selectedAssetClass === 'polymarket' && m.assetClass.includes('Polymarket'));

    const matchesQuery = m.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      m.handle.toLowerCase().includes(searchQuery.toLowerCase()) ||
      m.description.toLowerCase().includes(searchQuery.toLowerCase());

    return matchesCategory && matchesQuery;
  });

  const handleStartCopy = () => {
    if (!selectedMaster) return;

    // Check if already copying
    const existing = activeCopies.find(c => c.masterId === selectedMaster.id);
    if (existing) {
      toast.error(`You are already copying ${selectedMaster.name}. Adjust allocation below.`);
      setSelectedMaster(null);
      return;
    }

    const newCopy: ActiveCopy = {
      id: `copy-${Date.now()}`,
      masterId: selectedMaster.id,
      masterName: selectedMaster.name,
      masterHandle: selectedMaster.handle,
      allocatedAmount: copyAmount,
      currentValue: copyAmount,
      pnl: 0,
      pnlPct: 0,
      activePositions: selectedMaster.activePositionsCount,
      stopLossPct: stopLossPct,
      status: 'ACTIVE',
      startedAt: 'Just now',
    };

    setActiveCopies(prev => [newCopy, ...prev]);
    toast.success(`Successfully started copying ${selectedMaster.name}! $${copyAmount} allocated.`);
    setSelectedMaster(null);
  };

  const handleToggleCopyStatus = (id: string) => {
    setActiveCopies(prev => prev.map(c => {
      if (c.id === id) {
        const nextStatus = c.status === 'ACTIVE' ? 'PAUSED' : 'ACTIVE';
        toast(nextStatus === 'ACTIVE' ? 'Mirroring resumed' : 'Mirroring paused', {
          icon: nextStatus === 'ACTIVE' ? '▶️' : '⏸️'
        });
        return { ...c, status: nextStatus };
      }
      return c;
    }));
  };

  const handleStopCopy = (id: string, name: string) => {
    setActiveCopies(prev => prev.filter(c => c.id !== id));
    toast.success(`Stopped copying ${name}. Open positions closed into cash balance.`);
  };

  return (
    <div className="space-y-6 max-w-7xl mx-auto text-slate-100">
      {/* ── Top Header Bar ────────────────────────────────────────── */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 p-5 rounded-2xl glass-panel bg-[#0B101D]/80 border border-white/10">
        <div>
          <div className="flex items-center gap-2">
            <span className="text-xs font-mono font-bold text-amber-400 tracking-wider">APEX SOCIAL QUANT & COPY TRADING</span>
            <span className="text-xs text-slate-500">·</span>
            <span className="text-xs font-mono text-emerald-400 flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
              MIRROR LATENCY: 12ms
            </span>
          </div>
          <h1 className="text-2xl font-bold tracking-tight text-white mt-1 font-display">
            Institutional Copy Trading & Master Strategies
          </h1>
          <p className="text-sm text-slate-400 mt-0.5 font-mono">
            Automatically mirror verified quant models, Polymarket superforecasters, and momentum funds with sub-millisecond execution.
          </p>
        </div>

        <LastUpdated />
      </div>

      {/* ── Connected KPIs ────────────────────────────────────────── */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          label="Total Copied Capital"
          value={`$${copyMetrics.totalAllocated.toFixed(2)}`}
          mono
        />
        <StatCard
          label="Current Copied Value"
          value={`$${copyMetrics.totalCurrentValue.toFixed(2)}`}
          trend={copyMetrics.totalPnl >= 0 ? 'up' : 'down'}
          mono
        />
        <StatCard
          label="Net Copy P&L"
          value={`${copyMetrics.totalPnl >= 0 ? '+' : ''}$${copyMetrics.totalPnl.toFixed(2)} (+${copyMetrics.totalPnlPct.toFixed(1)}%)`}
          trend={copyMetrics.totalPnl >= 0 ? 'up' : 'down'}
          mono
        />
        <StatCard
          label="Active Mirrored Positions"
          value={`${copyMetrics.totalActivePositions} Positions`}
          mono
        />
      </div>

      {/* ── Active Copied Portfolios Ledger ───────────────────────── */}
      {activeCopies.length > 0 && (
        <div className="p-5 rounded-xl glass-panel bg-[#0B101D]/80 border border-white/10 space-y-4">
          <div className="flex items-center justify-between border-b border-white/10 pb-3">
            <div className="flex items-center gap-2">
              <Users size={16} className="text-amber-400" />
              <h2 className="text-base font-bold text-white font-sans">
                My Active Copied Portfolios & Allocations
              </h2>
            </div>
            <span className="text-xs font-mono text-emerald-400 font-bold">
              {copyMetrics.activeFollowedCount} Active Traders Monitored 24/7
            </span>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left font-mono text-xs">
              <thead>
                <tr className="border-b border-white/10 text-slate-400 pb-2">
                  <th className="py-2.5 px-3">MASTER TRADER</th>
                  <th className="py-2.5 px-3">ALLOCATED ($)</th>
                  <th className="py-2.5 px-3">CURRENT VALUE ($)</th>
                  <th className="py-2.5 px-3">NET RETURN (P&L)</th>
                  <th className="py-2.5 px-3">MIRRORED POSITIONS</th>
                  <th className="py-2.5 px-3">STOP LOSS</th>
                  <th className="py-2.5 px-3">STATUS</th>
                  <th className="py-2.5 px-3 text-right">ACTIONS</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5">
                {activeCopies.map(copy => {
                  const isPos = copy.pnl >= 0;
                  return (
                    <tr key={copy.id} className="hover:bg-white/[0.02] transition">
                      <td className="py-3 px-3">
                        <div className="font-bold text-white">{copy.masterName}</div>
                        <div className="text-[11px] text-slate-400">{copy.masterHandle} · Started {copy.startedAt}</div>
                      </td>
                      <td className="py-3 px-3 text-slate-300 font-bold tabular-nums">
                        ${copy.allocatedAmount.toFixed(2)}
                      </td>
                      <td className="py-3 px-3 text-amber-300 font-bold tabular-nums">
                        ${copy.currentValue.toFixed(2)}
                      </td>
                      <td className={`py-3 px-3 font-bold tabular-nums ${isPos ? 'text-emerald-400' : 'text-rose-400'}`}>
                        {isPos ? '+' : ''}${copy.pnl.toFixed(2)} ({isPos ? '+' : ''}{copy.pnlPct.toFixed(1)}%)
                      </td>
                      <td className="py-3 px-3 text-slate-300">
                        {copy.activePositions} live orders
                      </td>
                      <td className="py-3 px-3 text-slate-400">
                        -{copy.stopLossPct}% threshold
                      </td>
                      <td className="py-3 px-3">
                        <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                          copy.status === 'ACTIVE'
                            ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'
                            : 'bg-amber-500/20 text-amber-300 border border-amber-500/30'
                        }`}>
                          {copy.status}
                        </span>
                      </td>
                      <td className="py-3 px-3 text-right">
                        <div className="flex items-center justify-end gap-2">
                          <button
                            onClick={() => handleToggleCopyStatus(copy.id)}
                            className="px-2 py-1 rounded bg-white/5 hover:bg-white/10 text-slate-300 hover:text-white transition"
                            title={copy.status === 'ACTIVE' ? 'Pause copy' : 'Resume copy'}
                          >
                            {copy.status === 'ACTIVE' ? <Pause size={12} /> : <Play size={12} />}
                          </button>
                          <button
                            onClick={() => handleStopCopy(copy.id, copy.masterName)}
                            className="px-2.5 py-1 rounded bg-red-500/10 hover:bg-red-500/20 text-red-400 border border-red-500/30 text-[11px] font-bold transition"
                          >
                            STOP COPY
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ── Search & Filters Bar ──────────────────────────────────── */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 p-4 rounded-xl glass-panel bg-[#0B101D]/70 border border-white/10">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-xs font-mono text-slate-400 mr-1">Asset Class:</span>
          {[
            { id: 'all', label: 'All Master Strategies' },
            { id: 'stocks', label: 'Stocks & Equities' },
            { id: 'crypto', label: 'Crypto & Digital Assets' },
            { id: 'polymarket', label: 'Polymarket Predictions' },
          ].map(btn => (
            <button
              key={btn.id}
              onClick={() => setSelectedAssetClass(btn.id)}
              className={`px-3.5 py-1.5 rounded-lg text-xs font-mono font-bold transition ${
                selectedAssetClass === btn.id
                  ? 'bg-amber-500 text-black shadow-md shadow-amber-500/20'
                  : 'bg-white/5 text-slate-400 hover:text-white border border-white/5'
              }`}
            >
              {btn.label}
            </button>
          ))}
        </div>

        <div className="relative">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            type="text"
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            placeholder="Search quant strategy or trader..."
            className="pl-9 pr-4 py-1.5 bg-black/50 border border-white/10 rounded-lg text-xs font-mono text-white focus:outline-none focus:border-amber-400 w-64"
          />
        </div>
      </div>

      {/* ── Master Trader Leaderboard Cards ───────────────────────── */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
        {filteredMasters.map(master => {
          const isBeingCopied = activeCopies.some(c => c.masterId === master.id);

          return (
            <div
              key={master.id}
              className="p-5 rounded-xl glass-panel bg-[#0B101D]/80 border border-white/10 hover:border-amber-500/30 transition-all flex flex-col justify-between space-y-4"
            >
              <div>
                {/* Header Profile Row */}
                <div className="flex items-start justify-between">
                  <div className="flex items-center gap-3">
                    <div className="w-11 h-11 rounded-xl bg-white/5 border border-white/10 flex items-center justify-center text-2xl">
                      {master.avatar}
                    </div>
                    <div>
                      <div className="flex items-center gap-2">
                        <h3 className="font-bold text-white text-base leading-tight font-sans">
                          {master.name}
                        </h3>
                        <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-amber-500/10 text-amber-300 border border-amber-500/30 font-bold">
                          {master.badge}
                        </span>
                      </div>
                      <div className="text-xs font-mono text-slate-400 mt-0.5">
                        {master.handle} · {master.assetClass}
                      </div>
                    </div>
                  </div>

                  <div className="text-right">
                    <div className="text-[10px] font-mono text-slate-400 uppercase">30D RETURN</div>
                    <div className="text-lg font-bold font-mono text-emerald-400 tabular-nums">
                      +{master.roi30d}%
                    </div>
                  </div>
                </div>

                {/* Description */}
                <p className="text-xs text-slate-300 leading-relaxed font-sans mt-3">
                  {master.description}
                </p>

                {/* Core Metrics Grid */}
                <div className="grid grid-cols-4 gap-2 p-3 rounded-lg bg-black/40 border border-white/5 text-center mt-3 font-mono">
                  <div>
                    <div className="text-[10px] text-slate-400">WIN RATE</div>
                    <div className="text-xs font-bold text-white">{master.winRate}%</div>
                  </div>
                  <div>
                    <div className="text-[10px] text-slate-400">MAX DD</div>
                    <div className="text-xs font-bold text-rose-400">{master.maxDrawdown}%</div>
                  </div>
                  <div>
                    <div className="text-[10px] text-slate-400">COPIERS</div>
                    <div className="text-xs font-bold text-amber-300">{master.copiers}</div>
                  </div>
                  <div>
                    <div className="text-[10px] text-slate-400">AUM</div>
                    <div className="text-xs font-bold text-white">{master.aum}</div>
                  </div>
                </div>

                {/* Recent Trades Preview */}
                <div className="mt-3">
                  <div className="text-[10px] font-mono text-slate-400 uppercase mb-1.5 flex items-center justify-between">
                    <span>Recent Mirrored Trades:</span>
                    <span className="text-emerald-400">{master.activePositionsCount} Active Positions</span>
                  </div>
                  <div className="flex items-center gap-2 flex-wrap">
                    {master.recentTrades.map((t, idx) => (
                      <div
                        key={idx}
                        className="px-2.5 py-1 rounded bg-white/5 border border-white/5 text-[11px] font-mono flex items-center gap-1.5"
                      >
                        <span className="font-bold text-white">{t.asset}</span>
                        <span className="text-emerald-400 font-bold">+{t.pnlPct}%</span>
                        <span className="text-slate-500 text-[9px]">{t.time}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              {/* Bottom Action */}
              <div className="pt-3 border-t border-white/10 flex items-center justify-between">
                <div className="text-xs font-mono text-slate-400">
                  Performance Fee: <span className="text-white font-bold">{master.profitShare}% of profits</span>
                </div>

                <button
                  onClick={() => setSelectedMaster(master)}
                  className={`flex items-center gap-1.5 px-4 py-2 text-xs font-mono font-bold rounded-lg transition-all ${
                    isBeingCopied
                      ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 hover:bg-emerald-500/30'
                      : 'bg-amber-500 hover:bg-amber-400 text-black shadow-md shadow-amber-500/20'
                  }`}
                >
                  <span>{isBeingCopied ? 'MANAGE COPY' : 'COPY STRATEGY'}</span>
                  <ArrowUpRight size={14} />
                </button>
              </div>
            </div>
          );
        })}
      </div>

      {/* ── Live Master Order Execution Stream ─────────────────────── */}
      <div className="p-5 rounded-xl glass-panel bg-[#0B101D]/80 border border-white/10 space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Activity size={16} className="text-emerald-400" />
            <h3 className="text-sm font-bold text-white font-sans">
              Live Master Order Execution Stream
            </h3>
          </div>
          <span className="text-xs font-mono text-slate-400 flex items-center gap-1.5">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
            Zero-Intervention Auto Mirroring Active
          </span>
        </div>

        <div className="space-y-2 font-mono text-xs">
          {liveStream.map(stream => (
            <div
              key={stream.id}
              className="p-3 rounded-lg bg-black/40 border border-white/5 flex items-center justify-between flex-wrap gap-2"
            >
              <div className="flex items-center gap-3">
                <span className="text-amber-400 font-bold">{stream.master}</span>
                <span className="text-slate-400">executed</span>
                <span className="px-2 py-0.5 rounded bg-emerald-500/10 text-emerald-400 font-bold text-[10px]">
                  {stream.side} {stream.asset}
                </span>
                <span className="text-white font-bold">{stream.price}</span>
              </div>
              <div className="flex items-center gap-3 text-slate-400 text-[11px]">
                <span className="text-emerald-400">{stream.status}</span>
                <span>{stream.time}</span>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* ── Copy Strategy Modal ───────────────────────────────────── */}
      {selectedMaster && (
        <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="w-full max-w-lg p-6 rounded-2xl glass-panel bg-[#0B0F19] border border-amber-500/30 space-y-5 animate-in fade-in zoom-in-95 duration-200">
            <div className="flex items-start justify-between">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-white/5 border border-white/10 flex items-center justify-center text-2xl">
                  {selectedMaster.avatar}
                </div>
                <div>
                  <span className="text-[10px] font-mono text-amber-400 font-bold uppercase tracking-wider">
                    COPY STRATEGY
                  </span>
                  <h3 className="text-base font-bold text-white mt-0.5">
                    {selectedMaster.name}
                  </h3>
                </div>
              </div>
              <button
                onClick={() => setSelectedMaster(null)}
                className="text-slate-400 hover:text-white text-lg font-bold"
              >
                ✕
              </button>
            </div>

            <div className="p-3 rounded-xl bg-black/40 border border-white/5 space-y-2 text-xs font-mono">
              <div className="flex justify-between">
                <span className="text-slate-400">Target Asset Class:</span>
                <span className="text-white font-bold">{selectedMaster.assetClass}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-400">30D Quant Return:</span>
                <span className="text-emerald-400 font-bold">+{selectedMaster.roi30d}%</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-400">Profit Share / Performance Fee:</span>
                <span className="text-amber-300 font-bold">{selectedMaster.profitShare}% (High-Water Mark)</span>
              </div>
            </div>

            <div className="space-y-4">
              <div>
                <label className="text-xs font-mono text-slate-300 block mb-1">
                  ALLOCATION CAPITAL ($ USD):
                </label>
                <div className="relative">
                  <DollarSign size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-amber-400" />
                  <input
                    type="number"
                    min={50}
                    max={50000}
                    value={copyAmount}
                    onChange={e => setCopyAmount(Number(e.target.value))}
                    className="w-full bg-black/60 border border-white/10 rounded-xl pl-8 pr-3 py-2.5 text-sm font-mono text-white focus:outline-none focus:border-amber-400"
                  />
                </div>
              </div>

              <div>
                <div className="flex justify-between text-xs font-mono mb-1">
                  <span className="text-slate-300">MAX STOP-LOSS DRAWDOWN PROTECTION:</span>
                  <span className="text-rose-400 font-bold">-{stopLossPct}%</span>
                </div>
                <input
                  type="range"
                  min={3}
                  max={25}
                  value={stopLossPct}
                  onChange={e => setStopLossPct(Number(e.target.value))}
                  className="w-full accent-rose-400"
                />
                <span className="text-[11px] text-slate-500 font-mono">
                  Automatically stops copying and closes positions if capital drops by {stopLossPct}%.
                </span>
              </div>

              <div className="flex items-center justify-between p-3 rounded-lg bg-black/40 border border-white/5 text-xs font-mono">
                <span className="text-slate-300">Auto-Compound Realized Profits:</span>
                <button
                  type="button"
                  onClick={() => setAutoCompound(!autoCompound)}
                  className={`px-3 py-1 rounded text-[11px] font-bold transition ${
                    autoCompound ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30' : 'bg-white/5 text-slate-400'
                  }`}
                >
                  {autoCompound ? 'ENABLED' : 'DISABLED'}
                </button>
              </div>
            </div>

            <button
              onClick={handleStartCopy}
              className="w-full py-3 bg-amber-500 hover:bg-amber-400 text-black font-mono font-bold rounded-xl text-xs transition-colors shadow-lg shadow-amber-500/20 flex items-center justify-center gap-2"
            >
              <Zap size={14} />
              <span>CONFIRM & ACTIVATE INSTANT COPYING</span>
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
