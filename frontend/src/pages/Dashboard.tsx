import { useQuery } from '@tanstack/react-query';
import { getPortfolio, getTradeStats, getPositions } from '../services/api';
import { useStore } from '../store';
import StatCard from '../components/common/StatCard';
import AgentCouncilPanel from '../components/agents/AgentCouncilPanel';
import RecentTrades from '../components/portfolio/RecentTrades';
import PortfolioChart from '../components/charts/PortfolioChart';
import ActivePositions from '../components/portfolio/ActivePositions';
import RiskMonitor from '../components/portfolio/RiskMonitor';
import TopMovers from '../components/dashboard/TopMovers';
import AgentActivityTable from '../components/dashboard/AgentActivityTable';
import { DollarSign, TrendingUp, TrendingDown, Activity, BarChart2 } from 'lucide-react';
import { format } from 'date-fns';
import LastUpdated from '../components/common/LastUpdated';

export default function DashboardPage() {
  const { data: portfolio, isLoading: loadingPortfolio } = useQuery({ queryKey: ['portfolio'], queryFn: getPortfolio, refetchInterval: 5000 });
  const { data: stats } = useQuery({ queryKey: ['trade-stats'], queryFn: getTradeStats, refetchInterval: 30000 });
  const { data: positions } = useQuery({ queryKey: ['positions'], queryFn: getPositions, refetchInterval: 5000 });
  const { killSwitchActive, currentAnalysis } = useStore();

  const pnlDayPos   = (portfolio?.pnlDayPct || 0) >= 0;
  const pnlTotalPos = (portfolio?.pnlTotal   || 0) >= 0;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20, color: '#14171F' }}>

      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
        <div>
          <h1 style={{ fontFamily: 'Manrope', fontWeight: 800, fontSize: 24, color: '#14171F', margin: 0 }}>
            Command Center
          </h1>
          <p style={{ fontFamily: 'Space Mono', fontSize: 11, color: '#5B6472', margin: '4px 0 0' }}>
            {format(new Date(), 'EEEE, MMMM d yyyy')}
          </p>
        </div>
        <LastUpdated />
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          {killSwitchActive ? (
            <span style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '6px 12px', borderRadius: 8, background: 'rgba(176,38,59,0.08)', border: '1px solid #B0263B', fontFamily: 'Space Mono', fontSize: 11, color: '#B0263B', fontWeight: 700 }}>
              <span className="status-dot error" /> KILL SWITCH ACTIVE
            </span>
          ) : (
            <span style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '6px 12px', borderRadius: 8, background: 'rgba(18,128,95,0.08)', border: '1px solid rgba(18,128,95,0.3)', fontFamily: 'Space Mono', fontSize: 11, color: '#12805F', fontWeight: 700 }}>
              <span className="status-dot live" /> TRADING ACTIVE
            </span>
          )}
          {currentAnalysis && (
            <span style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '6px 12px', borderRadius: 8, background: 'rgba(201,162,75,0.08)', border: '1px solid rgba(201,162,75,0.3)', fontFamily: 'Space Mono', fontSize: 11, color: '#C9A24B', fontWeight: 700 }}>
              <span className="status-dot analyzing" /> ANALYZING {currentAnalysis}
            </span>
          )}
          <span style={{ padding: '6px 12px', borderRadius: 8, background: '#FFFFFF', border: '1px solid #DCDFE6', fontFamily: 'Space Mono', fontSize: 11, color: '#5B6472' }}>
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
