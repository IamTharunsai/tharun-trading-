import { Outlet, NavLink, useNavigate, useLocation } from 'react-router-dom';
import { useState, useEffect } from 'react';
import { useStore } from '../../store';
import { activateKillSwitch, deactivateKillSwitch, getTrades, getPortfolio } from '../../services/api';
import toast from 'react-hot-toast';
import {
  LayoutDashboard, Briefcase, ArrowLeftRight, Bot, BarChart2,
  TrendingUp, BookOpen, Newspaper, Settings, LogOut,
  Power, Zap, Eye, MessageSquare, Users, Globe2,
  FileSpreadsheet, ShieldAlert, Cpu, Radio, Menu, X
} from 'lucide-react';
import LiveTicker from './LiveTicker';
import ErrorBoundary from './ErrorBoundary';
import { useSystemStatus } from '../../hooks/useSystemStatus';

const testIdForPath = (path: string) => `nav-${path === '/' ? 'home' : path.replace(/^\//, '').replace(/\//g, '-')}`;

function StatusPill({ tone, label, testId, title }: { tone: 'ok' | 'warn' | 'bad' | 'unknown' | 'info'; label: string; testId: string; title?: string }) {
  const cls = {
    ok: 'text-emerald-600', warn: 'text-amber-600', bad: 'text-red-600', unknown: 'text-slate-400', info: 'text-blue-600',
  }[tone];
  const dot = {
    ok: 'bg-emerald-500', warn: 'bg-amber-500', bad: 'bg-red-500', unknown: 'bg-slate-300', info: 'bg-blue-500',
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
      { path: '/', label: 'Overview Cockpit', icon: LayoutDashboard },
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
      { path: '/news', label: 'Bloomberg News Wire', icon: Newspaper },
      { path: '/journal', label: 'Trade Journal', icon: BookOpen },
      { path: '/investment', label: 'Investment Plan', icon: Cpu },
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

export default function Layout() {
  const { killSwitchActive, setKillSwitch, logout } = useStore();
  const navigate = useNavigate();
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [timeUtc, setTimeUtc] = useState('');
  const [timeEst, setTimeEst] = useState('');
  const location = useLocation();
  const statusQ = useSystemStatus();
  const status = statusQ.isError ? undefined : statusQ.data;
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
    const updateTimes = () => {
      const now = new Date();
      setTimeUtc(now.toUTCString().slice(17, 25) + ' UTC');
      setTimeEst(now.toLocaleTimeString('en-US', { timeZone: 'America/New_York', hour12: false }) + ' EST');
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
        toast.success('Trading resumed');
      } else {
        if (!confirm('ACTIVATE EMERGENCY KILL SWITCH? This halts all algorithmic order execution immediately.')) return;
        await activateKillSwitch();
        setKillSwitch(true);
        toast.error('EMERGENCY KILL SWITCH ACTIVATED — Trading Halted');
      }
    } catch (e: any) {
      toast.error('Kill switch request failed: ' + (e?.response?.data?.error || e?.message || 'unknown error'));
    }
  };

  const handleExportCsv = async () => {
    try {
      toast.loading('Generating Institutional BLPAPI Export...', { id: 'export' });
      const [portfolio, tradesData] = await Promise.all([
        getPortfolio().catch(() => ({})),
        getTrades(1, 100).catch(() => ({ trades: [] }))
      ]);

      const trades = tradesData.trades || [];
      let csvContent = 'data:text/csv;charset=utf-8,';
      csvContent += '--- INSTITUTIONAL BLOOMBERG BLPAPI EXPORT ---\n';
      csvContent += `Generated,${new Date().toISOString()}\n`;
      csvContent += `Total NAV,${portfolio.totalValue || 0}\n`;
      csvContent += `Cash Balance,${portfolio.cashBalance || 0}\n\n`;

      csvContent += '--- TRADES LEDGER ---\n';
      csvContent += 'Trade ID,Asset,Market,Type,Quantity,Entry Price,Exit Price,P&L,Status,Date\n';

      for (const t of trades) {
        csvContent += `"${t.id}","${t.asset}","${t.market}","${t.type}",${t.quantity || 0},${t.entryPrice || 0},${t.exitPrice || 0},${t.pnl || 0},"${t.status}","${t.openedAt || t.createdAt || ''}"\n`;
      }

      const encodedUri = encodeURI(csvContent);
      const link = document.createElement('a');
      link.setAttribute('href', encodedUri);
      link.setAttribute('download', `THARUN_TERMINAL_BLPAPI_${new Date().toISOString().slice(0, 10)}.csv`);
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);

      toast.success('Export completed! BLPAPI CSV downloaded.', { id: 'export' });
    } catch (err) {
      toast.error('Failed to generate export', { id: 'export' });
    }
  };

  const handleLogout = () => {
    logout();
    navigate('/login');
  };

  return (
    <div className="flex h-screen bg-slate-50 text-slate-900 overflow-hidden font-sans">
      {/* Mobile: dimmed backdrop behind the slide-in menu */}
      {mobileNavOpen && (
        <div className="fixed inset-0 z-30 bg-slate-900/30 md:hidden" onClick={() => setMobileNavOpen(false)} />
      )}
      {/* ── Sidebar (slide-in drawer under 768px, fixed column above) ── */}
      <aside
        className={`fixed inset-y-0 left-0 z-40 w-64 flex-shrink-0 flex flex-col bg-white border-r border-slate-200 overflow-y-auto shadow-xs transform transition-transform duration-200 md:static md:translate-x-0 ${mobileNavOpen ? 'translate-x-0' : '-translate-x-full'}`}
        onClick={(e) => { if ((e.target as HTMLElement).closest('a')) setMobileNavOpen(false); }}
      >
        {/* Brand header */}
        <div className="p-4 border-b border-slate-200">
          <div className="flex items-center gap-2.5 mb-2">
            <div className="w-8 h-8 rounded-lg bg-blue-600 flex items-center justify-center font-bold text-white shadow-sm">
              <Zap size={18} className="text-white" />
            </div>
            <div>
              <div className="font-bold text-sm tracking-wide text-slate-900 leading-tight">
                THARUN TERMINAL
              </div>
              <div className="font-mono text-[10px] text-blue-700 font-bold tracking-wider leading-tight">
                AUTONOMOUS HEDGE CORE
              </div>
            </div>
          </div>

          <div className="flex items-center justify-between pt-1 text-[11px] font-mono text-slate-500">
            {statusKnown ? (
              killSwitchActive ? (
                <StatusPill tone="bad" label="TRADING HALTED" testId="sidebar-system-status" />
              ) : (
                <StatusPill
                  tone={status!.scheduler === 'online' ? 'ok' : 'bad'}
                  label={`${String(status!.tradingMode || '').toUpperCase() || '—'} · ${status!.scheduler === 'online' ? 'RUNNING' : 'SCHEDULER OFF'}`}
                  testId="sidebar-system-status"
                />
              )
            ) : (
              <StatusPill tone="unknown" label={statusQ.isLoading ? 'CHECKING…' : 'STATUS UNKNOWN'} testId="sidebar-system-status" />
            )}
            <span className="text-slate-400">{timeEst.split(' ')[0]}</span>
          </div>
        </div>

        {/* Grouped Nav Items */}
        <nav className="flex-1 px-3 py-3 space-y-4 overflow-y-auto">
          {NAV_GROUPS.map((grp) => (
            <div key={grp.group} className="space-y-1">
              <div className="px-3 text-[10px] font-mono font-bold tracking-wider text-slate-400 uppercase">
                {grp.group}
              </div>
              {grp.items.map(({ path, label, icon: Icon }) => (
                <NavLink
                  key={path}
                  to={path}
                  data-testid={testIdForPath(path)}
                  end={path === '/'}
                  className={({ isActive }) => `
                    flex items-center gap-2.5 px-3 py-2 rounded-lg text-xs font-medium transition-all
                    ${isActive
                      ? 'bg-blue-50 text-blue-700 border border-blue-200/80 font-semibold shadow-xs'
                      : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100 border border-transparent'
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
        <div className="p-3 border-t border-slate-200 space-y-2 bg-slate-50/50">
          <button
            data-testid="export-csv"
            onClick={handleExportCsv}
            className="w-full flex items-center justify-center gap-2 py-2 px-3 rounded-lg bg-white hover:bg-slate-100 border border-slate-200 text-slate-700 font-mono text-xs font-medium transition-colors shadow-xs"
          >
            <FileSpreadsheet size={13} className="text-emerald-600" />
            <span>BLPAPI EXCEL EXPORT</span>
          </button>

          <button
            data-testid="kill-switch"
            onClick={handleKillSwitch}
            className={`w-full flex items-center justify-center gap-2 py-2 px-3 rounded-lg border font-mono text-xs font-bold transition-all shadow-xs ${
              killSwitchActive
                ? 'bg-emerald-50 text-emerald-700 border-emerald-300 animate-pulse'
                : 'bg-red-50 text-red-700 border-red-200 hover:bg-red-100'
            }`}
          >
            <Power size={13} />
            <span>{killSwitchActive ? 'RESUME TRADING' : 'KILL SWITCH'}</span>
          </button>

          <button
            data-testid="logout"
            onClick={handleLogout}
            className="w-full flex items-center justify-center gap-2 py-1.5 px-3 text-slate-500 hover:text-slate-800 text-xs font-mono transition-colors"
          >
            <LogOut size={13} /> Logout
          </button>
        </div>
      </aside>

      {/* ── Main Viewport ────────────────────────────────────────── */}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden bg-slate-50">
        {/* Top Ticker Bar & Terminal Controls */}
        <div className="bg-white border-b border-slate-200 flex items-center justify-between px-4 py-1.5 text-xs font-mono shadow-xs">
          <div className="flex items-center gap-4">
            <button
              data-testid="mobile-nav-toggle"
              className="md:hidden p-1 -ml-1 rounded text-slate-700 hover:bg-slate-100"
              aria-label={mobileNavOpen ? 'Close menu' : 'Open menu'}
              onClick={() => setMobileNavOpen(o => !o)}
            >
              {mobileNavOpen ? <X size={18} /> : <Menu size={18} />}
            </button>
            <span className="text-blue-700 font-bold hidden sm:inline">TERMINAL FEED:</span>
            <span className="text-slate-600">{timeEst}</span>
            <span className="text-slate-300 hidden sm:inline">|</span>
            <span className="text-slate-600 hidden sm:inline">{timeUtc}</span>
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
                  tone={status!.scheduler === 'online' ? 'ok' : 'bad'}
                  label={`SCHEDULER ${status!.scheduler === 'online' ? 'ONLINE' : 'OFFLINE'}`}
                  testId="status-scheduler"
                />
                <span className="text-slate-300">·</span>
                <StatusPill
                  tone={status!.tradingMode === 'live' ? 'warn' : 'info'}
                  label={`TRADING: ${String(status!.tradingMode || 'unknown').toUpperCase()}`}
                  testId="status-trading-mode"
                />
                {status!.alpaca && (
                  <>
                    <span className="text-slate-300">·</span>
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
                    <span className="text-slate-300">·</span>
                    <StatusPill
                      tone={status!.polymarket.mode === 'live' ? 'warn' : 'info'}
                      label={`POLYMARKET: ${String(status!.polymarket.mode || 'unknown').toUpperCase()}${status!.polymarket.usConnected ? ' · US ✓' : ''}`}
                      testId="status-polymarket"
                    />
                  </>
                )}
                {llmHealthy !== null && (
                  <>
                    <span className="text-slate-300">·</span>
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

        <main className="flex-1 overflow-y-auto p-3 sm:p-6 bg-slate-50">
          <ErrorBoundary resetKey={location.pathname}>
            <Outlet />
          </ErrorBoundary>
        </main>
      </div>
    </div>
  );
}

