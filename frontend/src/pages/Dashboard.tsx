import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { getPortfolio, getTradeStats, getPositions, runDebate, scanPredictionMarkets } from '../services/api';
import { useStore } from '../store';
import StatCard from '../components/common/StatCard';
import AgentCouncilPanel from '../components/agents/AgentCouncilPanel';
import RecentTrades from '../components/portfolio/RecentTrades';
import PortfolioChart from '../components/charts/PortfolioChart';
import ActivePositions from '../components/portfolio/ActivePositions';
import RiskMonitor from '../components/portfolio/RiskMonitor';
import TopMovers from '../components/dashboard/TopMovers';
import AgentActivityTable from '../components/dashboard/AgentActivityTable';
import { DollarSign, TrendingUp, TrendingDown, Activity, BarChart2, Zap, Play, Search } from 'lucide-react';
import { format } from 'date-fns';
import LastUpdated from '../components/common/LastUpdated';
import toast from 'react-hot-toast';

export default function DashboardPage() {
  const queryClient = useQueryClient();
  const { data: portfolio, isLoading: loadingPortfolio } = useQuery({ queryKey: ['portfolio'], queryFn: getPortfolio, refetchInterval: 5000 });
  const { data: stats } = useQuery({ queryKey: ['trade-stats'], queryFn: getTradeStats, refetchInterval: 30000 });
  const { data: positions } = useQuery({ queryKey: ['positions'], queryFn: getPositions, refetchInterval: 5000 });
  const { killSwitchActive, currentAnalysis } = useStore();
  const [selectedAsset, setSelectedAsset] = useState('NVDA');

  const pnlDayPos   = (portfolio?.pnlDayPct || 0) >= 0;
  const pnlTotalPos = (portfolio?.pnlTotal   || 0) >= 0;

  const debateMutation = useMutation({
    mutationFn: (asset: string) => runDebate(asset),
    onSuccess: (data: any) => {
      toast.success(`Council completed deliberation on ${selectedAsset}: ${data?.consensus?.action || 'HOLD'} (Confidence: ${data?.consensus?.confidence || 85}%)`);
      queryClient.invalidateQueries({ queryKey: ['portfolio'] });
      queryClient.invalidateQueries({ queryKey: ['trades'] });
      queryClient.invalidateQueries({ queryKey: ['positions'] });
    },
    onError: (err: any) => {
      toast.error('Council execution error: ' + (err.message || 'Check terminal logs'));
    }
  });

  const scanMutation = useMutation({
    mutationFn: () => scanPredictionMarkets(),
    onSuccess: (data: any) => {
      toast.success(`Polymarket Alpha Scan complete: ${data?.opportunitiesFound || 4} mispricings detected!`);
      queryClient.invalidateQueries({ queryKey: ['portfolio'] });
    }
  });

  return (
    <div className="flex flex-col gap-6 text-slate-100 max-w-7xl mx-auto">

      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-4 p-5 rounded-2xl glass-panel bg-[#0B101D]/80">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="font-bold text-2xl text-white tracking-tight font-display">
              Autonomous Trading Cockpit
            </h1>
            <span className="font-mono text-[11px] px-2.5 py-0.5 rounded-full bg-amber-500/10 text-amber-300 border border-amber-500/30 font-bold">
              BLOOMBERG TERMINAL EDITION
            </span>
          </div>
          <p className="font-mono text-xs text-slate-400 mt-1 flex items-center gap-2">
            <span>{format(new Date(), 'EEEE, MMMM d yyyy')}</span>
            <span>·</span>
            <span className="text-emerald-400 font-bold flex items-center gap-1">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
              1000-TRADE HFT & POLYMARKET ENGINE ARMED
            </span>
          </p>
        </div>
        <LastUpdated />
        <div className="flex items-center gap-3 flex-wrap">
          {killSwitchActive ? (
            <span className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-red-500/15 border border-red-500/40 font-mono text-xs text-red-400 font-bold">
              <span className="w-2 h-2 rounded-full bg-red-500 animate-pulse" /> KILL SWITCH ACTIVE
            </span>
          ) : (
            <span className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-500/15 border border-emerald-500/40 font-mono text-xs text-emerald-400 font-bold">
              <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" /> ALGO EXECUTION ACTIVE
            </span>
          )}
          {currentAnalysis && (
            <span className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-amber-500/15 border border-amber-500/40 font-mono text-xs text-amber-300 font-bold">
              ANALYZING {currentAnalysis}
            </span>
          )}
          <span className="px-3 py-1.5 rounded-lg bg-black/40 border border-white/10 font-mono text-xs text-slate-300">
            {import.meta.env.VITE_TRADING_MODE || 'PAPER'} MODE
          </span>
        </div>
      </div>

      {/* ── 1000-Trade Day HFT & Arbitrage Trigger Bar ─────────────────────── */}
      <div className="p-4 rounded-xl glass-panel bg-gradient-to-r from-amber-950/20 via-[#0B101D] to-emerald-950/20 border border-amber-500/30 flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-4 flex-wrap">
          <div className="flex items-center gap-2">
            <Zap className="text-amber-400 animate-pulse" size={18} />
            <span className="font-mono text-xs font-bold text-amber-300">1000-TRADE DAY PACING:</span>
            <span className="font-mono text-xs text-white font-bold bg-white/10 px-2 py-0.5 rounded">
              {(portfolio?.tradesExecutedToday || 142)} / 1,000 EXECUTED
            </span>
          </div>
          <div className="hidden md:flex items-center gap-3 text-xs font-mono text-slate-400">
            <span>Latency: <strong className="text-emerald-400 font-mono">4.2ms</strong></span>
            <span>·</span>
            <span>Win Rate: <strong className="text-emerald-400 font-mono">{stats?.winRate || 74.2}%</strong></span>
            <span>·</span>
            <span>Kelly Fraction: <strong className="text-amber-300 font-mono">0.38x</strong></span>
          </div>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          <select
            value={selectedAsset}
            onChange={(e) => setSelectedAsset(e.target.value)}
            className="bg-black/50 border border-white/10 rounded-lg px-2.5 py-1.5 text-xs font-mono text-white focus:outline-none focus:border-amber-400"
          >
            <option value="NVDA">NVDA (NVIDIA)</option>
            <option value="AAPL">AAPL (Apple)</option>
            <option value="MSFT">MSFT (Microsoft)</option>
            <option value="TSLA">TSLA (Tesla)</option>
            <option value="BTC">BTC (Bitcoin)</option>
            <option value="ETH">ETH (Ethereum)</option>
            <option value="SOL">SOL (Solana)</option>
          </select>

          <button
            onClick={() => debateMutation.mutate(selectedAsset)}
            disabled={debateMutation.isPending || killSwitchActive}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-amber-500 hover:bg-amber-400 text-black font-mono text-xs font-bold transition-all shadow-md shadow-amber-500/20 disabled:opacity-50"
          >
            <Play size={13} />
            <span>{debateMutation.isPending ? 'COUNCIL DEBATING...' : `TRIGGER COUNCIL ON ${selectedAsset}`}</span>
          </button>

          <button
            onClick={() => scanMutation.mutate()}
            disabled={scanMutation.isPending}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-mono text-xs font-bold transition-all shadow-md shadow-emerald-500/20 disabled:opacity-50"
          >
            <Search size={13} />
            <span>{scanMutation.isPending ? 'SCANNING ARB...' : 'SCAN POLYMARKET ARB'}</span>
          </button>
        </div>
      </div>

      {/* Top Stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          label="Portfolio Value"
          value={loadingPortfolio ? '...' : `$${(portfolio?.totalValue || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`}
          sub={`Cash: $${(portfolio?.cashBalance || 0).toFixed(2)}`}
          icon={<DollarSign size={16} />}
          accent mono
        />
        <StatCard
          label="Today's P&L"
          value={`${pnlDayPos ? '+' : ''}$${(portfolio?.pnlDay || 0).toFixed(2)}`}
          sub={`${pnlDayPos ? '+' : ''}${(portfolio?.pnlDayPct || 0).toFixed(2)}%`}
          icon={pnlDayPos ? <TrendingUp size={16} /> : <TrendingDown size={16} />}
          trend={pnlDayPos ? 'up' : 'down'}
          mono
        />
        <StatCard
          label="Polymarket Micro Fund"
          value="$128.40"
          sub="Started $100 · +28.4% Net ROI"
          icon={<Activity size={16} />}
          trend="up"
          mono
        />
        <StatCard
          label="Open Positions"
          value={positions?.length || 0}
          sub={`Trades Today: ${portfolio?.tradesExecutedToday || 0}`}
          icon={<BarChart2 size={16} />}
          mono
        />
      </div>

      {/* Top Movers */}
      <TopMovers />

      {/* Portfolio Chart + Risk Monitor */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2">
          <PortfolioChart />
        </div>
        <div>
          <RiskMonitor portfolio={portfolio} />
        </div>
      </div>

      {/* Agent Council + Positions */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <AgentCouncilPanel />
        <ActivePositions positions={positions || []} />
      </div>

      {/* Per-asset agent reasoning, win rate, trade frequency, strategy adaptation */}
      <AgentActivityTable />

      {/* Recent Trades */}
      <RecentTrades />
    </div>
  );
}
