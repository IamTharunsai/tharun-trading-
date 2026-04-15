import { useQuery } from '@tanstack/react-query';
import { getPortfolio, getTradeStats, getPositions } from '../services/api';
import { useStore } from '../store';
import StatCard from '../components/common/StatCard';
import AgentCouncilPanel from '../components/agents/AgentCouncilPanel';
import RecentTrades from '../components/portfolio/RecentTrades';
import PortfolioChart from '../components/charts/PortfolioChart';
import ActivePositions from '../components/portfolio/ActivePositions';
import RiskMonitor from '../components/portfolio/RiskMonitor';
import { DollarSign, TrendingUp, TrendingDown, Activity, BarChart2, Zap } from 'lucide-react';
import { format } from 'date-fns';

export default function DashboardPage() {
  const { data: portfolio, isLoading: loadingPortfolio } = useQuery({ queryKey: ['portfolio'], queryFn: getPortfolio, refetchInterval: 5000 });
  const { data: stats } = useQuery({ queryKey: ['trade-stats'], queryFn: getTradeStats, refetchInterval: 30000 });
  const { data: positions } = useQuery({ queryKey: ['positions'], queryFn: getPositions, refetchInterval: 5000 });
  const { killSwitchActive, currentAnalysis } = useStore();

  const pnlDayPos = (portfolio?.pnlDayPct || 0) >= 0;
  const pnlTotalPos = (portfolio?.pnlTotal || 0) >= 0;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-sans font-bold text-2xl text-apex-text">Command Center</h1>
          <p className="font-mono text-xs text-apex-muted mt-0.5">{format(new Date(), 'EEEE, MMMM d yyyy • HH:mm:ss')}</p>
        </div>
        <div className="flex items-center gap-3">
          {killSwitchActive ? (
            <span className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-apex-red/10 border border-apex-red font-mono text-xs text-apex-red">
              <span className="status-dot error" /> KILL SWITCH ACTIVE
            </span>
          ) : (
            <span className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-apex-green/10 border border-apex-green/30 font-mono text-xs text-apex-green">
              <span className="status-dot live" /> TRADING ACTIVE
            </span>
          )}
          {currentAnalysis && (
            <span className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-apex-yellow/10 border border-apex-yellow/30 font-mono text-xs text-apex-yellow">
              <span className="status-dot analyzing" /> ANALYZING {currentAnalysis}
            </span>
          )}
          <span className="px-3 py-1.5 rounded-lg bg-apex-surface border border-apex-border font-mono text-xs text-apex-muted uppercase">
            {import.meta.env.VITE_TRADING_MODE || 'PAPER'} MODE
          </span>
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
          label="Total P&L"
          value={`${pnlTotalPos ? '+' : ''}$${(portfolio?.pnlTotal || 0).toFixed(2)}`}
          sub={`Win Rate: ${stats?.winRate || 0}%`}
          icon={<Activity size={16} />}
          trend={pnlTotalPos ? 'up' : 'down'}
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

      {/* Main Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Portfolio Chart — 2 cols */}
        <div className="lg:col-span-2">
          <PortfolioChart />
        </div>
        {/* Risk Monitor */}
        <div>
          <RiskMonitor portfolio={portfolio} />
        </div>
      </div>

      {/* Agent Council + Positions */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <AgentCouncilPanel />
        <ActivePositions positions={positions || []} />
      </div>

      {/* Recent Trades */}
      <RecentTrades />
    </div>
  );
}
