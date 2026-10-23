import { Outlet, NavLink, useNavigate, useLocation } from 'react-router-dom';
import { useState, useEffect } from 'react';
import { useStore } from '../../store';
import { activateKillSwitch, deactivateKillSwitch, getTrades, getPortfolio, logoutCurrentSession } from '../../services/api';
import { logoutNoticeApplies } from '../../services/sessionLogout';
import toast from 'react-hot-toast';
import {
  LayoutDashboard, Briefcase, ArrowLeftRight, Bot, BarChart2,
  TrendingUp, BookOpen, Newspaper, Settings, LogOut,
  Power, Zap, Eye, MessageSquare, Users, Globe2,
  FileSpreadsheet, ShieldAlert, Cpu, Radio, Menu, X,
  Activity, Layers, Search, Brain, LineChart, Bitcoin, Filter, FlaskConical,
  User, CalendarDays, Tv
} from 'lucide-react';
import LiveTicker from './LiveTicker';
import ErrorBoundary from './ErrorBoundary';
import CommandPalette from './CommandPalette';
import { useSystemStatus } from '../../hooks/useSystemStatus';
import { csvRow } from '../../utils/csv';

const testIdForPath = (path: string) => `nav-${path === '/' ? 'home' : path.replace(/^\//, '').replace(/\//g, '-')}`;

function StatusPill({ tone, label, testId, title }: { tone: 'ok' | 'warn' | 'bad' | 'unknown' | 'info'; label: string; testId: string; title?: string }) {
  const cls = {
    ok: 'text-bh-up', warn: 'text-bh-warn', bad: 'text-bh-down', unknown: 'text-bh-bone-600', info: 'text-bh-info',
  }[tone];
  const dot = {
    ok: 'bg-bh-up bh-live-dot', warn: 'bg-bh-warn', bad: 'bg-bh-down', unknown: 'bg-bh-bone-600', info: 'bg-bh-info',
  }[tone];
  return (
    <span className={`${cls} font-bold flex items-center gap-1.5 whitespace-nowrap`} data-testid={testId} title={title}>
      <span className={`w-2 h-2 rounded-full ${dot}`} />
      {label}
    </span>
  );
}

const NAV_GROUPS = [
  {
    group: 'TERMINAL COCKPIT',
    items: [
      { path: '/', label: 'Rainlight Commons', icon: LayoutDashboard },
      { path: '/city', label: 'City & offices', icon: Globe2 },
      { path: '/dashboard', label: 'Trading dashboard', icon: Activity },
      { path: '/polymarket', label: 'Polymarket Alpha', icon: Zap },
      { path: '/charts', label: 'Live Charts Lab', icon: BarChart2 },
      { path: '/stocks', label: 'Stock Universe', icon: Globe2 },
    ]
  },
  {
    group: 'AUTONOMOUS BRAIN',
    items: [
      { path: '/agents', label: 'Agent Council', icon: Bot },
      { path: '/agents/debate-room', label: 'Live Debate Room', icon: Users },
      { path: '/agents/monitor', label: 'Agent Monitor', icon: Eye },
      { path: '/agents/chat', label: 'Instant Bloomberg (IB)', icon: MessageSquare },
    ]
  },
  {
    group: 'QUANT & RESEARCH',
    items: [
      { path: '/alternative-data', label: 'Alternative Data Radar', icon: Radio },
      { path: '/analytics', label: 'BQuant Analytics', icon: TrendingUp },
      { path: '/tearsheet', label: 'Performance Tearsheet', icon: Activity },
      { path: '/options', label: 'Options Chain', icon: Layers },
      { path: '/macro', label: 'Macro Dashboard', icon: Globe2 },
      { path: '/crypto-strategy', label: 'Crypto Strategy Lab', icon: Bitcoin },
      { path: '/forecaster', label: 'Price Forecaster (ML)', icon: LineChart },
      { path: '/multi-agent', label: 'Multi-Agent Research', icon: Brain },
      { path: '/quote', label: 'Quote Panel', icon: Search },
      { path: '/screener', label: 'Market Screener', icon: Filter },
      { path: '/backtest', label: 'Backtest Hub', icon: FlaskConical },
      { path: '/news', label: 'Bloomberg News Wire', icon: Newspaper },
      { path: '/journal', label: 'Trade Journal', icon: BookOpen },
      { path: '/investment', label: 'Investment Plan', icon: Cpu },
      { path: '/insider', label: 'Insider Transactions', icon: User },
      { path: '/recap', label: 'Daily Market Recap', icon: CalendarDays },
      { path: '/live-tv', label: 'Live Financial TV', icon: Tv },
    ]
  },
  {
    group: 'EXECUTION & RISK',
    items: [
      { path: '/portfolio', label: 'Portfolio & Risk', icon: Briefcase },
      { path: '/trades', label: 'Trades Ledger', icon: ArrowLeftRight },
      { path: '/copy-trading', label: 'Copy Trading', icon: Users },
      { path: '/settings', label: 'Terminal Settings', icon: Settings },
    ]
  }
];

import { schedulerPresentation } from '../../utils/schedulerPresentation';

export default function Layout() {
  const { killSwitchActive, setKillSwitch } = useStore();
  const navigate = useNavigate();
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [cmdOpen, setCmdOpen] = useState(false);
  const [timeUtc, setTimeUtc] = useState('');
  const [timeEst, setTimeEst] = useState('');
  const location = useLocation();
  // Overview Cockpit is the first Bhishma-migrated page body; other page
  // bodies keep the legacy light surface until their own migration wave.
  const isCockpit = location.pathname === '/dashboard';
  const statusQ = useSystemStatus();
  const status = statusQ.isError ? undefined : statusQ.data;
  const schedulerView = schedulerPresentation(status?.schedulerRuntime);
  const statusKnown = !!status && typeof status === 'object' && !!status.scheduler;
  const llmFast = status?.llm?.fast;
  const llmSmart = status?.llm?.smart;
  const llmHealthy = llmFast || llmSmart ? !!(llmFast?.healthy || llmSmart?.healthy) : null;
  const llmProvider = (llmFast?.provider || llmSmart?.provider || '').toUpperCase();

  // Keep the kill-switch button in sync with the server's real state.
  useEffect(() => {
    if (typeof status?.killSwitch === 'boolean' && status.killSwitch !== killSwitchActive) setKillSwitch(status.killSwitch);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status?.killSwitch]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        setCmdOpen(o => !o);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  useEffect(() => {
    const updateTimes = () => {
      const now = new Date();
      setTimeUtc(now.toUTCString().slice(17, 25) + ' UTC');
      setTimeEst(now.toLocaleTimeString('en-US', { timeZone: 'America/New_York', hour12: false, timeZoneName: 'short' }));
    };
    updateTimes();
    const interval = setInterval(updateTimes, 1000);
    return () => clearInterval(interval);
  }, []);

  const handleKillSwitch = async () => {
    try {
      if (killSwitchActive) {
        await deactivateKillSwitch();
        setKillSwitch(false);
        toast.success('Emergency stop released. New orders still require risk approval.');
      } else {
        if (!confirm('Activate emergency stop? This halts new algorithmic orders and requests liquidation of the current account’s open positions. Exit orders can remain pending or fail. Confirm only if you intend to close those positions.')) return;
        const result = await activateKillSwitch();
        setKillSwitch(true);
        const pending = Array.isArray(result.pending) ? result.pending.length : null;
        const errors = Array.isArray(result.errors) ? result.errors.length : null;
        if (pending === null || errors === null) {
          toast('Emergency stop active. Liquidation status is unknown; inspect the account and exit orders.', { duration: 10000 });
        } else if (pending || errors) {
          toast.error(`Emergency stop active. ${pending} exits pending; ${errors} errors. Account liquidation is not confirmed.`, { duration: 10000 });
        } else {
          toast('Emergency stop active. Check the trade ledger for confirmed closures.', { duration: 8000 });
        }
      }
    } catch (e: any) {
      toast.error('Kill switch request failed: ' + (e?.response?.data?.error || e?.message || 'unknown error'));
    }
  };

  const handleExportCsv = async () => {
    try {
      toast.loading('Preparing Bhishma account export…', { id: 'export' });
      const [portfolio, tradesData] = await Promise.all([getPortfolio(), getTrades(1, 100)]);
      if (!portfolio || !Array.isArray(tradesData?.trades)) throw new Error('Account export response unavailable');
      const trades = tradesData.trades;
      let csvContent = csvRow(['Bhishma account export']);
      csvContent += csvRow(['Generated UTC', new Date().toISOString()]);
      csvContent += csvRow(['Coverage', `First ${trades.length} returned trade rows; this is not a full historical ledger export`]);
      csvContent += csvRow(['Account equity', portfolio.totalEquity]);
      csvContent += csvRow(['Cash balance', portfolio.cashBalance]);
      csvContent += csvRow(['Broker mode', portfolio.brokerMode]);
      csvContent += csvRow(['Data source', portfolio.dataSource]);
      csvContent += csvRow(['Trade ID', 'Asset', 'Market', 'Type', 'Quantity', 'Entry price', 'Exit price', 'P&L', 'Status', 'Date']);
      for (const trade of trades) {
        csvContent += csvRow([trade.id, trade.asset, trade.market, trade.type, trade.quantity,
          trade.entryPrice, trade.exitPrice, trade.pnl, trade.status, trade.openedAt ?? trade.createdAt]);
      }
      const url = URL.createObjectURL(new Blob([csvContent], { type: 'text/csv;charset=utf-8' }));
      const link = document.createElement('a');
      link.href = url;
      link.download = `BHISHMA_ACCOUNT_${new Date().toISOString().slice(0, 10)}.csv`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      toast.success(`Account export downloaded: ${trades.length} returned trade rows.`, { id: 'export' });
    } catch {
      toast.error('Account export failed. No financial values were substituted; retry when the account service is available.', { id: 'export' });
    }
  };
  const handleLogout = () => {
    const pending = logoutCurrentSession();
    navigate('/login');
    void pending.then(result => {
      if (result.revocation === 'unconfirmed' && logoutNoticeApplies(useStore, result)) {
        toast.error('Signed out on this device. Server revocation could not be confirmed.', { duration: 10000 });
      }
    });
  };

  return (
    <div className="bh-scope flex h-screen bg-bh-ink-900 overflow-hidden font-plex">
      <CommandPalette open={cmdOpen} onClose={() => setCmdOpen(false)} />
      {/* Mobile: dimmed backdrop behind the slide-in menu */}
      {mobileNavOpen && (
        <div className="fixed inset-0 z-30 bg-black/60 md:hidden" onClick={() => setMobileNavOpen(false)} />
      )}
      {/* ── Sidebar (slide-in drawer under 768px, fixed column above) ── */}
      <aside
        className={`fixed inset-y-0 left-0 z-40 w-64 flex-shrink-0 flex flex-col bg-bh-ink-850 border-r border-bh-border overflow-y-auto transform transition-transform duration-200 md:static md:translate-x-0 ${mobileNavOpen ? 'translate-x-0' : '-translate-x-full'}`}
        onClick={(e) => { if ((e.target as HTMLElement).closest('a')) setMobileNavOpen(false); }}
      >
        {/* Brand header */}
        <div className="p-4 border-b border-bh-border bh-chakra-lines">
          <div className="flex items-center gap-2.5 mb-2">
            <div className="w-8 h-8 rounded-bh bg-bh-gold-dim border border-bh-border-strong flex items-center justify-center font-bold shadow-bh-gold-glow">
              <Zap size={18} className="text-bh-gold-bright" />
            </div>
            <div>
              <div className="bh-wordmark font-alike text-xl leading-tight">
                BHISHMA
              </div>
              <div className="font-mono text-[10px] text-bh-gold font-bold tracking-wider leading-tight">
                TERMINAL · AUTONOMOUS HEDGE CORE
              </div>
            </div>
          </div>

          <div className="flex items-center justify-between pt-1 text-[11px] font-mono text-bh-bone-500">
            {statusKnown ? (
              killSwitchActive ? (
                <StatusPill tone="bad" label="TRADING HALTED" testId="sidebar-system-status" />
              ) : (
                <StatusPill
                  tone={schedulerView.tone}
                  label={`${String(status!.tradingMode || '').toUpperCase() || '—'} · ${schedulerView.tone === 'ok' ? 'HEARTBEAT' : schedulerView.tone === 'unknown' ? 'UNVERIFIED' : 'CHECK JOBS'}`}
                  title={schedulerView.detail}
                  testId="sidebar-system-status"
                />
              )
            ) : (
              <StatusPill tone="unknown" label={statusQ.isLoading ? 'CHECKING…' : 'STATUS UNKNOWN'} testId="sidebar-system-status" />
            )}
            <span className="text-bh-bone-600">{timeEst.split(' ')[0]}</span>
          </div>
        </div>

        {/* Grouped Nav Items */}
        <nav className="flex-1 px-3 py-3 space-y-4 overflow-y-auto">
          {NAV_GROUPS.map((grp) => (
            <div key={grp.group} className="space-y-1">
              <div className="px-3 text-[10px] font-mono font-bold tracking-wider text-bh-bone-600 uppercase">
                {grp.group}
              </div>
              {grp.items.map(({ path, label, icon: Icon }) => (
                <NavLink
                  key={path}
                  to={path}
                  data-testid={testIdForPath(path)}
                  end={path === '/'}
                  className={({ isActive }) => `
                    flex items-center gap-2.5 px-3 py-2 rounded-bh text-xs font-medium transition-all
                    ${isActive
                      ? 'bg-bh-gold/10 text-bh-gold-bright border border-bh-gold/30 font-semibold'
                      : 'text-bh-bone-500 hover:text-bh-bone-100 hover:bg-bh-ink-750 border border-transparent'
                    }
                  `}
                >
                  <Icon size={14} className="flex-shrink-0" />
                  <span className="truncate">{label}</span>
                </NavLink>
              ))}
            </div>
          ))}
        </nav>

        {/* Bottom controls */}
        <div className="p-3 border-t border-bh-border space-y-2 bg-bh-ink-900/60">
          <button
            data-testid="export-csv"
            onClick={handleExportCsv}
            className="w-full flex items-center justify-center gap-2 py-2 px-3 rounded-bh bg-bh-ink-800 hover:bg-bh-ink-750 border border-bh-border text-bh-bone-300 font-mono text-xs font-medium transition-colors"
          >
            <FileSpreadsheet size={13} className="text-bh-up" />
            <span>EXPORT ACCOUNT CSV</span>
          </button>

          <button
            data-testid="kill-switch"
            onClick={handleKillSwitch}
            className={`w-full flex items-center justify-center gap-2 py-2 px-3 rounded-bh border font-mono text-xs font-bold transition-all ${
              killSwitchActive
                ? 'bg-bh-up/10 text-bh-up border-bh-up/40 animate-pulse'
                : 'bg-bh-ember/10 text-bh-ember-bright border-bh-ember/40 hover:bg-bh-ember/20'
            }`}
          >
            <Power size={13} />
            <span>{killSwitchActive ? 'RESUME TRADING' : 'KILL SWITCH'}</span>
          </button>

          <button
            data-testid="logout"
            onClick={handleLogout}
            className="w-full flex items-center justify-center gap-2 py-1.5 px-3 text-bh-bone-500 hover:text-bh-bone-100 text-xs font-mono transition-colors"
          >
            <LogOut size={13} /> Logout
          </button>
        </div>
      </aside>

      {/* ── Main Viewport ────────────────────────────────────────── */}
      <div className={`flex-1 flex flex-col min-w-0 overflow-hidden ${isCockpit ? 'bg-bh-ink-900' : 'bg-slate-50'}`}>
        {/* Top Ticker Bar & Terminal Controls */}
        <div className="bh-shimmer bg-bh-ink-850 border-b border-bh-border flex items-center justify-between px-4 py-1.5 text-xs font-mono">
          <div className="flex items-center gap-4">
            <button
              data-testid="mobile-nav-toggle"
              className="md:hidden p-1 -ml-1 rounded text-bh-bone-300 hover:bg-bh-ink-750"
              aria-label={mobileNavOpen ? 'Close menu' : 'Open menu'}
              onClick={() => setMobileNavOpen(o => !o)}
            >
              {mobileNavOpen ? <X size={18} /> : <Menu size={18} />}
            </button>
            <button
            onClick={() => setCmdOpen(true)}
            className="hidden md:flex items-center gap-2 px-2.5 py-1 rounded-bh border border-bh-border bg-bh-ink-800 hover:bg-bh-ink-750 text-bh-bone-500 hover:text-bh-bone-100 text-xs font-mono transition-colors"
          >
            <Search size={11} />
            <span>Search…</span>
            <span className="flex items-center gap-0.5 text-[9px] text-bh-bone-600 bg-bh-ink-700 border border-bh-border px-1 py-0.5 rounded">⌘K</span>
          </button>
          <span className="text-bh-gold font-bold hidden sm:inline">TERMINAL FEED:</span>
            <span className="text-bh-bone-500">{timeEst}</span>
            <span className="text-bh-border-strong hidden sm:inline">|</span>
            <span className="text-bh-bone-500 hidden sm:inline">{timeUtc}</span>
          </div>

          <div className="hidden md:flex items-center gap-3" data-testid="system-status">
            {!statusKnown ? (
              <StatusPill
                tone="unknown"
                label={statusQ.isLoading ? 'CHECKING STATUS…' : 'STATUS UNKNOWN'}
                testId="status-unknown"
                title={statusQ.isError ? 'GET /api/system/status failed' : undefined}
              />
            ) : (
              <>
                <StatusPill
                  tone={schedulerView.tone}
                  label={schedulerView.label}
                  title={schedulerView.detail}
                  testId="status-scheduler"
                />
                <span className="text-bh-border-strong">·</span>
                <StatusPill
                  tone={status!.tradingMode === 'live' ? 'warn' : 'info'}
                  label={`TRADING: ${String(status!.tradingMode || 'unknown').toUpperCase()}`}
                  testId="status-trading-mode"
                />
                {status!.alpaca && (
                  <>
                    <span className="text-bh-border-strong">·</span>
                    <StatusPill
                      tone={status!.alpaca.connected ? 'ok' : 'bad'}
                      label={`ALPACA ${status!.alpaca.connected ? '✓' : '✗'}`}
                      testId="status-alpaca"
                      title={status!.alpaca.connected ? `Alpaca ${status!.alpaca.mode}` : 'Alpaca not connected'}
                    />
                  </>
                )}
                {status!.polymarket && (
                  <>
                    <span className="text-bh-border-strong">·</span>
                    <StatusPill
                      tone={status!.polymarket.mode === 'live' ? 'warn' : 'info'}
                      label={`POLYMARKET: ${String(status!.polymarket.mode || 'unknown').toUpperCase()}${status!.polymarket.usConnected ? ' · US verified' : status!.polymarket.usConfigured ? ' · US unverified' : ' · US not configured'}`}
                      testId="status-polymarket"
                    />
                  </>
                )}
                {llmHealthy !== null && (
                  <>
                    <span className="text-bh-border-strong">·</span>
                    <StatusPill
                      tone={llmHealthy ? 'ok' : 'bad'}
                      label={`AI: ${llmProvider || 'UNKNOWN'} ${llmHealthy ? '✓' : '✗'}`}
                      testId="status-llm"
                      title={[
                        llmFast ? `fast: ${llmFast.provider}/${llmFast.model} ${llmFast.healthy ? 'healthy' : 'unhealthy'}${llmFast.lastError ? ` (${llmFast.lastError})` : ''}` : '',
                        llmSmart ? `smart: ${llmSmart.provider}/${llmSmart.model} ${llmSmart.healthy ? 'healthy' : 'unhealthy'}` : '',
                        typeof status!.llm?.spendTodayUsd === 'number' ? `spend today $${status!.llm.spendTodayUsd.toFixed(2)} / $${Number(status!.llm.budgetUsd || 0).toFixed(2)}` : '',
                      ].filter(Boolean).join('\n')}
                    />
                  </>
                )}
              </>
            )}
          </div>
        </div>

        <LiveTicker />

        <main className={`flex-1 overflow-y-auto p-3 sm:p-6 ${isCockpit ? 'bg-bh-ink-900 bh-chakra-lines' : 'bg-slate-50'}`}>
          <ErrorBoundary resetKey={location.pathname}>
            {/* Presentational wrapper only: page-enter transition on the cockpit. */}
            <div key={location.pathname} className={isCockpit ? 'bh-page-enter' : undefined}>
              <Outlet />
            </div>
          </ErrorBoundary>
        </main>
      </div>
    </div>
  );
}

