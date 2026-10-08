import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { getPortfolio, getTradeStats, getPositions, getLiveAccounts, getPolymarketUsAccount, runDebate, scanPredictionMarkets } from '../services/api';
import SymbolPicker from '../components/common/SymbolPicker';
import { useSelectedSymbol } from '../hooks/useDefaultSymbol';
import { useSystemStatus } from '../hooks/useSystemStatus';
import { brokerEquity, fmtPct, fmtUsd, num, portfolioNav } from '../utils/format';
import { useStore } from '../store';
import StatCard from '../components/common/StatCard';
import AgentCouncilPanel from '../components/agents/AgentCouncilPanel';
import RecentTrades from '../components/portfolio/RecentTrades';
import PortfolioChart from '../components/charts/PortfolioChart';
import ActivePositions from '../components/portfolio/ActivePositions';
import RiskMonitor from '../components/portfolio/RiskMonitor';
import TopMovers from '../components/dashboard/TopMovers';
import IntradayCard from '../components/dashboard/IntradayCard';
import AgentActivityTable from '../components/dashboard/AgentActivityTable';
// ── New market intelligence panels (OpenTerminal 5-panel suite + Polymarket) ──
import SectorHeatmap from '../components/panels/SectorHeatmap';
import CryptoBoard from '../components/panels/CryptoBoard';
import YieldCurve from '../components/panels/YieldCurve';
import OptionsChain from '../components/panels/OptionsChain';
import MarketScreener from '../components/panels/MarketScreener';
import PolymarketGreedAgent from '../components/panels/PolymarketGreedAgent';
// ── FinceptTerminal + missing OpenTerminal panels ──────────────────────────────
import EconomicCalendar from '../components/panels/EconomicCalendar';
import OrderBook from '../components/panels/OrderBook';
import NewsFeed from '../components/panels/NewsFeed';
import RiskMetrics from '../components/panels/RiskMetrics';
import { DollarSign, TrendingUp, TrendingDown, Activity, BarChart2, Zap, Play, Search, Globe, BookOpen, Newspaper, ShieldAlert } from 'lucide-react';
import { format } from 'date-fns';
import LastUpdated from '../components/common/LastUpdated';
import toast from 'react-hot-toast';

export default function DashboardPage() {
  const queryClient = useQueryClient();
  const { data: portfolio, isLoading: loadingPortfolio } = useQuery({ queryKey: ['portfolio'], queryFn: getPortfolio, refetchInterval: 5000 });
  const { data: stats } = useQuery({ queryKey: ['trade-stats'], queryFn: getTradeStats, refetchInterval: 30000 });
  const { data: positions } = useQuery({ queryKey: ['positions'], queryFn: getPositions, refetchInterval: 5000 });
  const { data: liveAccounts } = useQuery({ queryKey: ['live-accounts'], queryFn: getLiveAccounts, refetchInterval: 30000, retry: false });
  const { data: sysStatus } = useSystemStatus();
  const pmUsQuery = useQuery({ queryKey: ['polymarket-us-account'], queryFn: getPolymarketUsAccount, refetchInterval: 60000, retry: false });
  const pmUs = pmUsQuery.data;
  const pmUsConnected = !pmUsQuery.isError && pmUs?.connected === true;
  const pmUsCash = pmUsConnected && typeof pmUs.cash === 'number' && Number.isFinite(pmUs.cash) ? pmUs.cash : null;
  const pmUsPower = pmUsConnected && typeof pmUs.buyingPower === 'number' && Number.isFinite(pmUs.buyingPower) ? pmUs.buyingPower : null;
  const { killSwitchActive, currentAnalysis } = useStore();
  const { symbol: selectedAsset, market: selectedMarket, setSymbol: setSelectedAsset } = useSelectedSymbol('all');

  const nav = portfolioNav(portfolio);
  const cash = num(portfolio?.cashBalance);
  const brokerEq = brokerEquity(liveAccounts);
  const pnlDay = num(portfolio?.pnlDay ?? portfolio?.dailyPnl);
  const pnlDayPct = num(portfolio?.pnlDayPct ?? portfolio?.dailyPnlPct);
  const pnlDayPos = (pnlDay ?? 0) >= 0;
  const pmConnected = !!(portfolio?.polymarketConnected || liveAccounts?.polymarket?.connected);
  const pmValue = num(portfolio?.polymarketBalance ?? portfolio?.polymarketEquity ?? (liveAccounts?.polymarket?.connected ? liveAccounts.polymarket.portfolioValue : null));
  const positionsList: any[] = Array.isArray(positions) ? positions : [];
  const tradingMode = sysStatus?.tradingMode ? String(sysStatus.tradingMode).toUpperCase() : null;

  const debateMutation = useMutation({
    mutationFn: (asset: string) => runDebate(asset, selectedMarket),
    onSuccess: (data: any) => {
      toast.success(data?.message || `Council debate started for ${selectedAsset}. Watch the Debate Room for the result.`);
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
      const n = Array.isArray(data?.opportunities) ? data.opportunities.length : null;
      toast.success(n === null ? 'Polymarket scan complete.' : `Polymarket scan complete: ${n} open market${n === 1 ? '' : 's'} evaluated.`);
      queryClient.invalidateQueries({ queryKey: ['portfolio'] });
    },
    onError: (err: any) => {
      toast.error('Polymarket scan failed: ' + (err?.response?.data?.error || err?.message || 'unknown error'));
    }
  });

  return (
    <div className="flex flex-col gap-6 text-slate-900 max-w-7xl mx-auto">

      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-4 p-5 rounded-xl bg-white border border-slate-200/90 shadow-sm">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="font-bold text-2xl text-slate-900 tracking-tight">
              Autonomous Trading Cockpit
            </h1>
            <span className="font-mono text-[11px] px-2.5 py-0.5 rounded-full bg-blue-50 text-blue-700 border border-blue-200 font-bold">
              INSTITUTIONAL SUITE
            </span>
          </div>
          <p className="font-mono text-xs text-slate-500 mt-1 flex items-center gap-2">
            <span>{format(new Date(), 'EEEE, MMMM d yyyy')}</span>
            <span>·</span>
            <span className="text-slate-600 font-bold flex items-center gap-1">
              Agent committee · stocks, crypto & Polymarket
            </span>
          </p>
        </div>
        <LastUpdated />
        <div className="flex items-center gap-3 flex-wrap">
          {killSwitchActive || sysStatus?.killSwitch ? (
            <span className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-red-50 border border-red-200 font-mono text-xs text-red-700 font-bold">
              <span className="w-2 h-2 rounded-full bg-red-600 animate-pulse" /> KILL SWITCH ACTIVE
            </span>
          ) : (
            sysStatus?.scheduler ? (
              <span data-testid="autotrading-status" className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg border font-mono text-xs font-bold ${sysStatus.scheduler === 'online' ? 'bg-emerald-50 border-emerald-200 text-emerald-700' : 'bg-red-50 border-red-200 text-red-700'}`}>
                <span className={`w-2 h-2 rounded-full ${sysStatus.scheduler === 'online' ? 'bg-emerald-500' : 'bg-red-500'}`} />
                {sysStatus.scheduler === 'online' ? 'AUTO-TRADING SCHEDULER ONLINE' : 'SCHEDULER OFFLINE'}
              </span>
            ) : (
              <span data-testid="autotrading-status" className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-50 border border-slate-200 font-mono text-xs text-slate-500 font-bold">
                <span className="w-2 h-2 rounded-full bg-slate-300" /> STATUS UNKNOWN
              </span>
            )
          )}
          {currentAnalysis && (
            <span className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-blue-50 border border-blue-200 font-mono text-xs text-blue-700 font-bold">
              ANALYZING {currentAnalysis}
            </span>
          )}
          <span data-testid="trading-mode" className="px-3 py-1.5 rounded-lg bg-slate-100 border border-slate-200 font-mono text-xs text-slate-700 font-semibold">
            {tradingMode || import.meta.env.VITE_TRADING_MODE || 'UNKNOWN'} MODE
          </span>
        </div>
      </div>

      {/* ── 1000-Trade Day HFT & Arbitrage Trigger Bar ─────────────────────── */}
      <div className="p-4 rounded-xl bg-white border border-slate-200/90 shadow-sm flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-4 flex-wrap">
          <div className="flex items-center gap-2">
            <Zap className="text-blue-600" size={18} />
            <span className="font-mono text-xs font-bold text-slate-800">DAILY EXECUTION PACING:</span>
            <span className="font-mono text-xs text-blue-800 font-bold bg-blue-50 border border-blue-200 px-2 py-0.5 rounded">
              {num(portfolio?.tradesExecutedToday) ?? '—'} EXECUTED TODAY
            </span>
          </div>
          <div className="hidden md:flex items-center gap-3 text-xs font-mono text-slate-500">
            <span>Broker: <strong className={`font-bold ${liveAccounts?.alpaca?.connected || portfolio?.brokerConnected ? 'text-emerald-700' : 'text-slate-500'}`}>{liveAccounts?.alpaca?.connected || portfolio?.brokerConnected ? 'CONNECTED' : 'NOT CONNECTED'}</strong></span>
            <span>·</span>
            <span>Win Rate: <strong className="text-emerald-700 font-bold" data-testid="dashboard-winrate">{stats?.totalTrades && num(stats.winRate) !== null ? `${num(stats.winRate)!.toFixed(1)}%` : '—'}</strong></span>
            <span>·</span>
            <span>Open Positions: <strong className="text-blue-700 font-bold">{positionsList.length}</strong></span>
          </div>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          <SymbolPicker value={selectedAsset} onChange={(sym, meta) => setSelectedAsset(sym, meta)} data-testid="symbol-picker" />

          <button
            data-testid="debate-trigger"
            onClick={() => selectedAsset && debateMutation.mutate(selectedAsset)}
            disabled={debateMutation.isPending || killSwitchActive || !selectedAsset}
            className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-700 text-white font-mono text-xs font-bold transition-all shadow-xs disabled:opacity-50"
          >
            <Play size={13} />
            <span>{debateMutation.isPending ? 'STARTING COUNCIL...' : selectedAsset ? `TRIGGER COUNCIL ON ${selectedAsset}` : 'PICK A SYMBOL'}</span>
          </button>

          <button
            data-testid="scan-polymarket"
            onClick={() => scanMutation.mutate()}
            disabled={scanMutation.isPending}
            className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white font-mono text-xs font-bold transition-all shadow-xs disabled:opacity-50"
          >
            <Search size={13} />
            <span>{scanMutation.isPending ? 'SCANNING ARB...' : 'SCAN POLYMARKET ARB'}</span>
          </button>
        </div>
      </div>

      {/* Top Stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          testId="stat-nav"
          label="Portfolio NAV"
          value={loadingPortfolio ? '...' : fmtUsd(nav)}
          sub={`Cash: ${fmtUsd(cash)}${brokerEq !== null ? ` · Broker equity (Alpaca): ${fmtUsd(brokerEq)}` : ''}`}
          icon={<DollarSign size={16} />}
          accent mono
        />
        <StatCard
          testId="stat-pnl-day"
          label="Today's P&L"
          value={pnlDay === null ? '—' : `${pnlDayPos ? '+' : '-'}$${Math.abs(pnlDay).toFixed(2)}`}
          sub={pnlDayPct === null ? undefined : fmtPct(pnlDayPct)}
          icon={pnlDayPos ? <TrendingUp size={16} /> : <TrendingDown size={16} />}
          trend={pnlDay === null ? undefined : pnlDayPos ? 'up' : 'down'}
          mono
        />
        <StatCard
          testId="stat-polymarket"
          label="Polymarket International"
          value={pmConnected && pmValue !== null ? fmtUsd(pmValue) : '—'}
          sub={pmConnected ? 'Connected account value' : 'Not connected'}
          icon={<Activity size={16} />}
          mono
        />
        <StatCard
          testId="stat-polymarket-us"
          label="Polymarket US · Cash"
          value={pmUsCash === null ? '—' : fmtUsd(pmUsCash)}
          sub={pmUsQuery.isError ? 'Account request failed · check Settings' : pmUsQuery.isLoading ? 'Checking account…' : !pmUsConnected ? 'Not connected · check Settings' : pmUsCash === null ? 'USD balance unavailable' : `Buying power: ${fmtUsd(pmUsPower)}`}
          icon={<DollarSign size={16} />}
          mono
        />
        <StatCard
          testId="stat-open-positions"
          label="Open Positions"
          value={positionsList.length}
          sub={num(portfolio?.tradesExecutedToday) !== null ? `Trades Today: ${num(portfolio?.tradesExecutedToday)}` : undefined}
          icon={<BarChart2 size={16} />}
          mono
        />
      </div>

      {/* Intraday fast lane + Top Movers */}
      <IntradayCard />
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
        <ActivePositions positions={Array.isArray(positions) ? positions : []} />
      </div>

      {/* Per-asset agent reasoning, win rate, trade frequency, strategy adaptation */}
      <AgentActivityTable />

      {/* ── Market Intelligence Suite (OpenTerminal 5-panel + Polymarket Greed) */}
      <div>
        <h2 className="font-bold text-lg text-slate-800 mb-4 flex items-center gap-2">
          <BarChart2 size={20} className="text-blue-600" />
          Market Intelligence Suite
          <span className="font-mono text-[11px] px-2 py-0.5 rounded-full bg-blue-50 text-blue-700 border border-blue-200">
            LIVE
          </span>
        </h2>

        {/* Row 1: Sector Heatmap + Crypto Overview */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
          <SectorHeatmap />
          <CryptoBoard />
        </div>

        {/* Row 2: Yield Curve + Options Chain */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
          <YieldCurve />
          <OptionsChain symbol={selectedAsset || 'SPY'} />
        </div>

        {/* Row 3: Market Screener full-width */}
        <div className="mb-6">
          <MarketScreener />
        </div>

        {/* Row 4: Polymarket Money Greed Agent */}
        <div>
          <PolymarketGreedAgent />
        </div>
      </div>

      {/* ── Macro Intelligence Suite (FinceptTerminal + OpenTerminal panels) ─── */}
      <div>
        <h2 className="font-bold text-lg text-slate-800 mb-4 flex items-center gap-2">
          <Globe size={20} className="text-emerald-600" />
          Macro Intelligence Suite
          <span className="font-mono text-[11px] px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200">
            FINCEPT + OPENTERMINAL
          </span>
        </h2>

        {/* Row 1: Economic Calendar + Order Book */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
          <EconomicCalendar />
          <OrderBook />
        </div>

        {/* Row 2: News Feed + Risk Metrics */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <NewsFeed />
          <RiskMetrics />
        </div>
      </div>

      {/* Recent Trades */}
      <RecentTrades />
    </div>
  );
}
