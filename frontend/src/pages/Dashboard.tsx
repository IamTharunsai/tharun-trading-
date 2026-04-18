import { useQuery } from '@tanstack/react-query';
import { getPortfolio, getTradeStats, getPositions } from '../services/api';
import { useStore } from '../store';
import StatCard from '../components/common/StatCard';
import AgentCouncilPanel from '../components/agents/AgentCouncilPanel';
import RecentTrades from '../components/portfolio/RecentTrades';
import PortfolioChart from '../components/charts/PortfolioChart';
import ActivePositions from '../components/portfolio/ActivePositions';
import RiskMonitor from '../components/portfolio/RiskMonitor';
import { DollarSign, TrendingUp, TrendingDown, Activity, BarChart2 } from 'lucide-react';
import { format } from 'date-fns';

export default function DashboardPage() {
  const { data: portfolio, isLoading: loadingPortfolio } = useQuery({ queryKey: ['portfolio'], queryFn: getPortfolio, refetchInterval: 5000 });
  const { data: stats } = useQuery({ queryKey: ['trade-stats'], queryFn: getTradeStats, refetchInterval: 30000 });
  const { data: positions } = useQuery({ queryKey: ['positions'], queryFn: getPositions, refetchInterval: 5000 });
  const { killSwitchActive, currentAnalysis } = useStore();

  const pnlDayPos   = (portfolio?.pnlDayPct || 0) >= 0;
  const pnlTotalPos = (portfolio?.pnlTotal   || 0) >= 0;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20, color: '#2C1810' }}>

      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
        <div>
          <h1 style={{ fontFamily: 'Syne', fontWeight: 800, fontSize: 24, color: '#2C1810', margin: 0 }}>
            Command Center
          </h1>
          <p style={{ fontFamily: 'Space Mono', fontSize: 11, color: '#8B6F47', margin: '4px 0 0' }}>
            {format(new Date(), 'EEEE, MMMM d yyyy • HH:mm')}
          </p>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          {killSwitchActive ? (
            <span style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '6px 12px', borderRadius: 8, background: 'rgba(220,38,38,0.08)', border: '1px solid #DC2626', fontFamily: 'Space Mono', fontSize: 11, color: '#DC2626', fontWeight: 700 }}>
              <span className="status-dot error" /> KILL SWITCH ACTIVE
            </span>
          ) : (
            <span style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '6px 12px', borderRadius: 8, background: 'rgba(45,138,74,0.08)', border: '1px solid rgba(45,138,74,0.3)', fontFamily: 'Space Mono', fontSize: 11, color: '#2D8A4A', fontWeight: 700 }}>
              <span className="status-dot live" /> TRADING ACTIVE
            </span>
          )}
          {currentAnalysis && (
            <span style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '6px 12px', borderRadius: 8, background: 'rgba(245,166,35,0.08)', border: '1px solid rgba(245,166,35,0.3)', fontFamily: 'Space Mono', fontSize: 11, color: '#F5A623', fontWeight: 700 }}>
              <span className="status-dot analyzing" /> ANALYZING {currentAnalysis}
            </span>
          )}
          <span style={{ padding: '6px 12px', borderRadius: 8, background: '#FFFFFF', border: '1px solid #E8D5C4', fontFamily: 'Space Mono', fontSize: 11, color: '#8B6F47' }}>
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

      {/* Recent Trades */}
      <RecentTrades />
    </div>
  );
}
