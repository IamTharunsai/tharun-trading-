import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  getCopyTradingStrategies,
  getCopyTradingFollowers,
  createCopyFollower,
  toggleCopyFollower,
  deleteCopyFollower,
  getCopyTradingAuditLog
} from '../services/api';
import toast from 'react-hot-toast';
import {
  Users, ShieldCheck, Zap, TrendingUp, CheckCircle2,
  PauseCircle, PlayCircle, Plus, Trash2, ArrowUpRight,
  Sliders, AlertTriangle, Layers, Clock, Activity
} from 'lucide-react';
import LastUpdated from '../components/common/LastUpdated';

export default function CopyTradingPage() {
  const queryClient = useQueryClient();
  const [showAddModal, setShowAddModal] = useState(false);

  // Form State
  const [followerName, setFollowerName] = useState('Paper Sub-Account ($100 Micro)');
  const [accountType, setAccountType] = useState<'ALPACA_PAPER' | 'POLYMARKET_PAPER' | 'WEBHOOK_MIRROR'>('ALPACA_PAPER');
  const [allocatedCapitalUSD, setAllocatedCapitalUSD] = useState(100);
  const [maxAllocationPct, setMaxAllocationPct] = useState(20);
  const [slippageCeilingBps, setSlippageCeilingBps] = useState(15);
  const [dailyMaxLossUSD, setDailyMaxLossUSD] = useState(5.0);
  const [selectedStrategies, setSelectedStrategies] = useState<string[]>([
    'strat-intraday-momentum',
    'strat-cross-industry-ripple'
  ]);

  // Queries
  const { data: strategies = [], isLoading: loadingStrats } = useQuery({
    queryKey: ['copy-trading-strategies'],
    queryFn: getCopyTradingStrategies,
    refetchInterval: 30000
  });

  const { data: followers = [], isLoading: loadingFollowers } = useQuery({
    queryKey: ['copy-trading-followers'],
    queryFn: getCopyTradingFollowers,
    refetchInterval: 10000
  });

  const { data: auditLogs = [], isLoading: loadingLogs } = useQuery({
    queryKey: ['copy-trading-audit'],
    queryFn: () => getCopyTradingAuditLog(50),
    refetchInterval: 10000
  });

  // Mutations
  const toggleMutation = useMutation({
    mutationFn: (id: string) => toggleCopyFollower(id),
    onSuccess: (data: any) => {
      queryClient.invalidateQueries({ queryKey: ['copy-trading-followers'] });
      toast.success(`Follower status updated: ${data?.follower?.status}`);
    },
    onError: (err: any) => {
      toast.error(err?.response?.data?.error || 'Failed to toggle follower state');
    }
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => deleteCopyFollower(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['copy-trading-followers'] });
      toast.success('Follower portfolio removed');
    },
    onError: (err: any) => {
      toast.error(err?.response?.data?.error || 'Failed to delete follower');
    }
  });

  const createMutation = useMutation({
    mutationFn: () => createCopyFollower({
      name: followerName,
      accountType,
      allocatedCapitalUSD: Number(allocatedCapitalUSD),
      maxAllocationPct: Number(maxAllocationPct),
      slippageCeilingBps: Number(slippageCeilingBps),
      dailyMaxLossUSD: Number(dailyMaxLossUSD),
      subscribedStrategyIds: selectedStrategies
    }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['copy-trading-followers'] });
      setShowAddModal(false);
      toast.success('New follower portfolio registered & actively copying');
    },
    onError: (err: any) => {
      toast.error(err?.response?.data?.error || 'Failed to create follower');
    }
  });

  const toggleStrategySelection = (id: string) => {
    if (selectedStrategies.includes(id)) {
      setSelectedStrategies(selectedStrategies.filter(s => s !== id));
    } else {
      setSelectedStrategies([...selectedStrategies, id]);
    }
  };

  return (
    <div className="space-y-6 max-w-7xl mx-auto text-slate-900">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-4 p-5 rounded-xl bg-white border border-slate-200/90 shadow-sm">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <span className="text-[11px] font-mono font-bold text-blue-700 uppercase tracking-wider">INSTITUTIONAL SIGNAL MIRRORING</span>
            <span className="text-slate-300">·</span>
            <span className="text-[11px] font-mono text-emerald-600 font-semibold flex items-center gap-1">
              <ShieldCheck size={13} />
              INDEPENDENT RISK CHECKS ACTIVE
            </span>
          </div>
          <h1 className="font-sans font-bold text-2xl text-slate-900 tracking-tight">
            Institutional Copy Trading & Multi-Account Allocation
          </h1>
          <p className="font-mono text-xs text-slate-500 mt-1">
            Mirror verified autonomous strategies directly into follower paper accounts with independent risk boundaries, slippage ceilings, and micro-compounding controls
          </p>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={() => setShowAddModal(true)}
            className="flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-white font-mono text-xs font-bold transition shadow-xs"
          >
            <Plus size={14} />
            <span>REGISTER FOLLOWER ACCOUNT</span>
          </button>
          <LastUpdated />
        </div>
      </div>

      {/* ── SECTION 1: MASTER STRATEGIES LEADERBOARD ────────────────── */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <TrendingUp size={16} className="text-blue-600" />
            <h2 className="font-bold text-base text-slate-900">Verified Master Autonomous Strategies</h2>
          </div>
          <span className="text-xs font-mono text-slate-500">Live Mathematical Models & P&L Records</span>
        </div>

        {loadingStrats ? (
          <div className="text-center py-10 font-mono text-xs text-slate-400">Loading strategy models…</div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            {strategies.map((strat: any) => (
              <div
                key={strat.id}
                className="p-4 rounded-xl bg-white border border-slate-200/90 shadow-sm hover:border-blue-300 transition-all flex flex-col justify-between"
              >
                <div>
                  <div className="flex items-start justify-between gap-2 mb-2">
                    <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-blue-50 text-blue-700 font-bold border border-blue-200">
                      {strat.assetClass}
                    </span>
                    <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-emerald-50 text-emerald-700 font-bold border border-emerald-200">
                      {strat.riskRating}
                    </span>
                  </div>

                  <h3 className="font-bold text-sm text-slate-900 leading-snug">
                    {strat.name}
                  </h3>
                  <p className="text-xs text-slate-500 mt-1 line-clamp-2 leading-relaxed">
                    {strat.description}
                  </p>

                  <div className="grid grid-cols-2 gap-2 mt-4 pt-3 border-t border-slate-100 font-mono text-xs">
                    <div>
                      <div className="text-[10px] text-slate-400">WIN RATE</div>
                      <div className="text-emerald-600 font-bold text-sm">{strat.verifiedWinRate}%</div>
                    </div>
                    <div>
                      <div className="text-[10px] text-slate-400">PROFIT FACTOR</div>
                      <div className="text-slate-900 font-bold text-sm">{strat.profitFactor}x</div>
                    </div>
                    <div>
                      <div className="text-[10px] text-slate-400">MAX DRAWDOWN</div>
                      <div className="text-slate-700 font-bold">-{strat.maxDrawdownPct}%</div>
                    </div>
                    <div>
                      <div className="text-[10px] text-slate-400">MIN CAPITAL</div>
                      <div className="text-blue-700 font-bold">${strat.minCapitalRequired}</div>
                    </div>
                  </div>
                </div>

                <div className="mt-4 pt-3 border-t border-slate-100 flex items-center justify-between text-xs font-mono">
                  <span className="text-slate-400 text-[11px] flex items-center gap-1">
                    <Clock size={12} /> {strat.avgHoldTimeMinutes >= 60 ? `${Math.round(strat.avgHoldTimeMinutes / 60)}h avg hold` : `${strat.avgHoldTimeMinutes}m avg hold`}
                  </span>
                  <span className="text-emerald-600 font-bold text-[10px] flex items-center gap-1">
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                    TRANSMITTING
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ── SECTION 2: ACTIVE FOLLOWER ACCOUNTS ──────────────────────── */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Users size={16} className="text-blue-600" />
            <h2 className="font-bold text-base text-slate-900">Configured Follower Portfolios ({followers.length})</h2>
          </div>
          <span className="text-xs font-mono text-slate-500">Each account enforces independent client risk rules</span>
        </div>

        {loadingFollowers ? (
          <div className="text-center py-10 font-mono text-xs text-slate-400">Loading follower configurations…</div>
        ) : followers.length === 0 ? (
          <div className="p-8 rounded-xl bg-white border border-slate-200 text-center font-mono text-xs text-slate-400">
            No follower accounts active yet. Click "REGISTER FOLLOWER ACCOUNT" above to create one.
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {followers.map((f: any) => {
              const isActive = f.status === 'ACTIVE_COPYING';
              return (
                <div
                  key={f.id}
                  className="p-5 rounded-xl bg-white border border-slate-200/90 shadow-sm space-y-4"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="flex items-center gap-2 mb-1">
                        <span className={`text-[10px] font-mono px-2 py-0.5 rounded font-bold ${
                          isActive ? 'bg-emerald-50 text-emerald-700 border border-emerald-200' : 'bg-slate-100 text-slate-600'
                        }`}>
                          {isActive ? '● ACTIVE COPYING' : '○ PAUSED'}
                        </span>
                        <span className="text-[10px] font-mono text-slate-500 px-1.5 py-0.5 rounded bg-slate-100">
                          {f.accountType}
                        </span>
                      </div>
                      <h3 className="font-bold text-slate-900 text-base">{f.name}</h3>
                    </div>

                    <div className="flex items-center gap-1.5">
                      <button
                        onClick={() => toggleMutation.mutate(f.id)}
                        disabled={toggleMutation.isPending}
                        className={`p-1.5 rounded-lg border text-xs font-mono transition-colors ${
                          isActive
                            ? 'bg-amber-50 text-amber-700 border-amber-200 hover:bg-amber-100'
                            : 'bg-emerald-50 text-emerald-700 border-emerald-200 hover:bg-emerald-100'
                        }`}
                        title={isActive ? 'Pause Copy Trading' : 'Resume Copy Trading'}
                      >
                        {isActive ? <PauseCircle size={15} /> : <PlayCircle size={15} />}
                      </button>
                      <button
                        onClick={() => {
                          if (confirm(`Remove follower portfolio "${f.name}"?`)) {
                            deleteMutation.mutate(f.id);
                          }
                        }}
                        className="p-1.5 rounded-lg border border-slate-200 text-slate-400 hover:text-red-600 hover:bg-red-50 transition-colors"
                        title="Remove Account"
                      >
                        <Trash2 size={15} />
                      </button>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 p-3 rounded-lg bg-slate-50 border border-slate-100 font-mono text-xs">
                    <div>
                      <div className="text-[10px] text-slate-400">ALLOCATION</div>
                      <div className="font-bold text-slate-900">${f.allocatedCapitalUSD.toFixed(2)}</div>
                    </div>
                    <div>
                      <div className="text-[10px] text-slate-400">MAX / TRADE</div>
                      <div className="font-bold text-slate-900">{f.maxAllocationPct}% (${(f.allocatedCapitalUSD * f.maxAllocationPct / 100).toFixed(2)})</div>
                    </div>
                    <div>
                      <div className="text-[10px] text-slate-400">MAX SLIPPAGE</div>
                      <div className="font-bold text-blue-700">{f.slippageCeilingBps} bps</div>
                    </div>
                    <div>
                      <div className="text-[10px] text-slate-400">DAILY MAX LOSS</div>
                      <div className="font-bold text-red-600">${f.dailyMaxLossUSD.toFixed(2)}</div>
                    </div>
                  </div>

                  <div>
                    <div className="text-[10px] font-mono text-slate-400 uppercase mb-1.5">Subscribed Master Strategies</div>
                    <div className="flex flex-wrap gap-1.5">
                      {f.subscribedStrategyIds?.map((sId: string) => {
                        const sObj = strategies.find((st: any) => st.id === sId);
                        return (
                          <span
                            key={sId}
                            className="text-[10px] font-mono px-2 py-0.5 rounded bg-blue-50 text-blue-700 border border-blue-200 font-medium"
                          >
                            {sObj?.name || sId}
                          </span>
                        );
                      })}
                    </div>
                  </div>

                  <div className="pt-2 border-t border-slate-100 flex items-center justify-between text-xs font-mono">
                    <span className="text-slate-500">Total Mirrored Trades: <strong className="text-slate-900">{f.totalMirroredTrades}</strong></span>
                    <span className={`font-bold ${f.realizedPnlUSD >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>
                      P&L: {f.realizedPnlUSD >= 0 ? '+' : ''}${f.realizedPnlUSD.toFixed(2)}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* ── SECTION 3: MIRRORED EXECUTION AUDIT LOG ─────────────────── */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Activity size={16} className="text-blue-600" />
            <h2 className="font-bold text-base text-slate-900">Live Mirrored Execution Feed & Audit Trail</h2>
          </div>
          <span className="text-xs font-mono text-slate-500">Latency & Slippage Verified</span>
        </div>

        <div className="rounded-xl bg-white border border-slate-200/90 shadow-sm overflow-hidden">
          {loadingLogs ? (
            <div className="text-center py-10 font-mono text-xs text-slate-400">Loading audit records…</div>
          ) : auditLogs.length === 0 ? (
            <div className="text-center py-10 font-mono text-xs text-slate-400">No mirrored trades recorded yet.</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left font-mono text-xs">
                <thead>
                  <tr className="border-b border-slate-200 text-slate-500 bg-slate-50/50">
                    <th className="py-2.5 px-3 font-bold text-[10px] uppercase">Timestamp</th>
                    <th className="py-2.5 px-3 font-bold text-[10px] uppercase">Strategy</th>
                    <th className="py-2.5 px-3 font-bold text-[10px] uppercase">Follower</th>
                    <th className="py-2.5 px-3 font-bold text-[10px] uppercase">Symbol</th>
                    <th className="py-2.5 px-3 font-bold text-[10px] uppercase">Side</th>
                    <th className="py-2.5 px-3 font-bold text-[10px] uppercase">Master Px</th>
                    <th className="py-2.5 px-3 font-bold text-[10px] uppercase">Follower Px</th>
                    <th className="py-2.5 px-3 font-bold text-[10px] uppercase">Slippage</th>
                    <th className="py-2.5 px-3 font-bold text-[10px] uppercase">Latency</th>
                    <th className="py-2.5 px-3 font-bold text-[10px] uppercase">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {auditLogs.map((log: any) => {
                    const isFilled = log.status === 'FILLED';
                    return (
                      <tr key={log.id} className="hover:bg-slate-50/80 transition-colors">
                        <td className="py-2.5 px-3 text-slate-500 text-[11px]">
                          {new Date(log.timestamp).toLocaleTimeString()}
                        </td>
                        <td className="py-2.5 px-3 text-slate-700 font-medium max-w-[150px] truncate">
                          {log.strategyName}
                        </td>
                        <td className="py-2.5 px-3 text-slate-600 max-w-[140px] truncate">
                          {log.followerName}
                        </td>
                        <td className="py-2.5 px-3 font-bold text-slate-900">
                          {log.symbol}
                        </td>
                        <td className="py-2.5 px-3">
                          <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${
                            log.side === 'BUY' || log.side === 'YES'
                              ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                              : 'bg-red-50 text-red-700 border border-red-200'
                          }`}>
                            {log.side}
                          </span>
                        </td>
                        <td className="py-2.5 px-3 tabular-nums text-slate-700">${Number(log.masterPrice).toFixed(2)}</td>
                        <td className="py-2.5 px-3 tabular-nums text-slate-900 font-bold">${Number(log.followerPrice).toFixed(2)}</td>
                        <td className="py-2.5 px-3 tabular-nums text-blue-700 font-semibold">{log.slippageBps} bps</td>
                        <td className="py-2.5 px-3 tabular-nums text-slate-500">{log.executionLatencyMs} ms</td>
                        <td className="py-2.5 px-3">
                          <span className={`text-[10px] font-bold px-2 py-0.5 rounded ${
                            isFilled
                              ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                              : 'bg-red-50 text-red-700 border border-red-200'
                          }`}>
                            {log.status}
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      {/* ── MODAL: REGISTER NEW FOLLOWER ACCOUNT ────────────────────── */}
      {showAddModal && (
        <div className="fixed inset-0 z-50 bg-black/40 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-lg w-full p-6 shadow-xl border border-slate-200 space-y-4">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <div className="flex items-center gap-2">
                <Users size={18} className="text-blue-600" />
                <h3 className="font-bold text-base text-slate-900">Configure Follower Portfolio</h3>
              </div>
              <button
                onClick={() => setShowAddModal(false)}
                className="text-slate-400 hover:text-slate-600 font-mono text-sm"
              >
                ✕
              </button>
            </div>

            <div className="space-y-3 font-mono text-xs">
              <div>
                <label className="block text-slate-600 mb-1 font-semibold">Account Label</label>
                <input
                  type="text"
                  value={followerName}
                  onChange={e => setFollowerName(e.target.value)}
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-slate-900 focus:outline-none focus:border-blue-500"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-slate-600 mb-1 font-semibold">Allocated Capital ($)</label>
                  <input
                    type="number"
                    value={allocatedCapitalUSD}
                    onChange={e => setAllocatedCapitalUSD(Number(e.target.value))}
                    min={10}
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-slate-900 focus:outline-none focus:border-blue-500"
                  />
                  <span className="text-[10px] text-slate-400">Micro-account: $100</span>
                </div>
                <div>
                  <label className="block text-slate-600 mb-1 font-semibold">Max % per Trade</label>
                  <input
                    type="number"
                    value={maxAllocationPct}
                    onChange={e => setMaxAllocationPct(Number(e.target.value))}
                    min={1}
                    max={50}
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-slate-900 focus:outline-none focus:border-blue-500"
                  />
                  <span className="text-[10px] text-slate-400">e.g. 20% = $20 max order</span>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-slate-600 mb-1 font-semibold">Max Slippage (bps)</label>
                  <input
                    type="number"
                    value={slippageCeilingBps}
                    onChange={e => setSlippageCeilingBps(Number(e.target.value))}
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-slate-900 focus:outline-none focus:border-blue-500"
                  />
                  <span className="text-[10px] text-slate-400">15 bps = 0.15% limit</span>
                </div>
                <div>
                  <label className="block text-slate-600 mb-1 font-semibold">Daily Max Loss ($)</label>
                  <input
                    type="number"
                    value={dailyMaxLossUSD}
                    onChange={e => setDailyMaxLossUSD(Number(e.target.value))}
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-slate-900 focus:outline-none focus:border-blue-500"
                  />
                  <span className="text-[10px] text-slate-400">Circuit breaker threshold</span>
                </div>
              </div>

              <div>
                <label className="block text-slate-600 mb-1.5 font-semibold">Select Strategies to Follow</label>
                <div className="space-y-1.5">
                  {strategies.map((strat: any) => {
                    const isSelected = selectedStrategies.includes(strat.id);
                    return (
                      <div
                        key={strat.id}
                        onClick={() => toggleStrategySelection(strat.id)}
                        className={`p-2.5 rounded-lg border cursor-pointer transition flex items-center justify-between ${
                          isSelected
                            ? 'bg-blue-50 border-blue-300 text-blue-900'
                            : 'bg-slate-50 border-slate-200 text-slate-600 hover:bg-slate-100'
                        }`}
                      >
                        <div>
                          <div className="font-bold text-xs">{strat.name}</div>
                          <div className="text-[10px] text-slate-500">{strat.assetClass} · {strat.verifiedWinRate}% Win Rate</div>
                        </div>
                        <CheckCircle2 size={16} className={isSelected ? 'text-blue-600' : 'text-slate-300'} />
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>

            <div className="pt-3 border-t border-slate-100 flex items-center justify-end gap-3 font-mono text-xs">
              <button
                onClick={() => setShowAddModal(false)}
                className="px-4 py-2 rounded-lg bg-slate-100 text-slate-700 hover:bg-slate-200 transition"
              >
                Cancel
              </button>
              <button
                onClick={() => createMutation.mutate()}
                disabled={createMutation.isPending || !followerName || selectedStrategies.length === 0}
                className="px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-white font-bold transition disabled:opacity-50"
              >
                {createMutation.isPending ? 'Registering…' : 'Activate Follower Account'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
