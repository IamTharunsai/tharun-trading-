import { useQuery } from '@tanstack/react-query';
import { getPortfolio, getTradeStats, getPositions, getApexStatus, getRuntimeHealth, getTrades } from '../services/api';
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
  const { data: apex } = useQuery({ queryKey: ['apex-status'], queryFn: getApexStatus, refetchInterval: 10000 });
  const { currentAnalysis } = useStore();
  const runtime = useQuery({ queryKey: ['runtime-health'], queryFn: getRuntimeHealth, refetchInterval: 5000, retry: false });
  const pending = useQuery({ queryKey: ['pending-entries'], queryFn: () => getTrades(1, 5, { status: 'PENDING' }), refetchInterval: 5000 });
  const killSwitchActive = runtime.data?.killSwitchActive;
  const runtimeKnown = Boolean(runtime.data) && !runtime.isError;

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
              <span className={runtimeKnown && runtime.data?.backgroundJobsEnabled ? 'status-dot live' : 'status-dot'} />
              {!runtimeKnown ? 'STATUS UNAVAILABLE' : runtime.data?.backgroundJobsEnabled ? 'PAPER SCHEDULER ENABLED' : 'PAPER SCHEDULER OFF'}
            </span>
          )}
          {currentAnalysis && (
            <span style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '6px 12px', borderRadius: 8, background: 'rgba(201,162,75,0.08)', border: '1px solid rgba(201,162,75,0.3)', fontFamily: 'Space Mono', fontSize: 11, color: '#C9A24B', fontWeight: 700 }}>
              <span className="status-dot analyzing" /> ANALYZING {currentAnalysis}
            </span>
          )}
          <span style={{ padding: '6px 12px', borderRadius: 8, background: '#FFFFFF', border: '1px solid #DCDFE6', fontFamily: 'Space Mono', fontSize: 11, color: '#5B6472' }}>
            {runtimeKnown ? runtime.data?.mode.toUpperCase() : 'UNKNOWN'} MODE
          </span>
        </div>
      </div>

      <section aria-label="Paper execution status" style={{ background: '#fff', border: '1px solid #DCDFE6', borderRadius: 12, padding: 18 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
          <strong>Paper execution desk</strong>
          <span>{pending.isError ? 'Pending orders unavailable' : pending.isLoading ? 'Checking orders…' : `${pending.data?.total ?? 0} entries awaiting confirmation`}</span>
        </div>
        <p style={{ color: '#5B6472', fontSize: 13, margin: '8px 0' }}>Paper trading only. Pending orders reserve capacity but are not confirmed positions. Scheduler status does not mean the market is open or an order is eligible.</p>
        {pending.data?.trades?.map((trade: any) => <div key={trade.id} style={{ borderTop: '1px solid #DCDFE6', paddingTop: 8, marginTop: 8, fontSize: 13 }}>
          <strong>{trade.asset}</strong> · {trade.type} · {trade.quantity} requested<br />
          <span style={{ color: '#5B6472' }}>{trade.exitReason || 'Waiting for broker confirmation'}</span>
        </div>)}
      </section>

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

      {/* APEX-3 capital + cost + EV stack */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          label="Capital Mode"
          value={apex?.survival?.capitalTier || portfolio?.survival?.capitalTier || '—'}
          sub={`Drawdown: ${apex?.survival?.drawdownMode || portfolio?.survival?.drawdownMode || '—'}`}
          mono
        />
        <StatCard
          label="API Spend Today"
          value={`$${(apex?.apiSpendToday ?? portfolio?.apiSpendToday ?? 0).toFixed(2)}`}
          sub={`Budget $${(apex?.apiBudgetToday ?? portfolio?.apiBudgetToday ?? 2).toFixed(2)}`}
          mono
        />
        <StatCard
          label="Win Rate"
          value={`${stats?.winRate || 0}%`}
          sub={`PF ${stats?.profitFactor ?? '—'} · Sharpe ${stats?.sharpe ?? '—'}`}
          mono
        />
        <StatCard
          label="Online ML Trades"
          value={apex?.mlTrades ?? 0}
          sub={apex?.survival?.strategy ? String(apex.survival.strategy).slice(0, 48) : 'SGD + agent weights'}
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
