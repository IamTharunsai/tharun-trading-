import { Outlet, NavLink, useNavigate } from 'react-router-dom';
import { useState, useEffect } from 'react';
import { useStore } from '../../store';
import { activateKillSwitch, deactivateKillSwitch, getTrades, getPortfolio } from '../../services/api';
import toast from 'react-hot-toast';
import {
  LayoutDashboard, Briefcase, ArrowLeftRight, Bot, BarChart2,
  TrendingUp, BookOpen, Newspaper, Settings, LogOut,
  Power, Zap, Eye, MessageSquare, Users, Globe2,
  FileSpreadsheet, ShieldAlert, Cpu, Radio
} from 'lucide-react';
import LiveTicker from './LiveTicker';

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
  const [timeUtc, setTimeUtc] = useState('');
  const [timeEst, setTimeEst] = useState('');

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
    <div className="flex h-screen bg-[#080C14] text-slate-100 overflow-hidden font-sans">
      {/* ── Sidebar ──────────────────────────────────────────────── */}
      <aside className="w-64 flex-shrink-0 flex flex-col bg-[#0B101D]/90 backdrop-blur-xl border-r border-white/[0.08] overflow-y-auto">
        {/* Brand header */}
        <div className="p-4 border-b border-white/[0.08]">
          <div className="flex items-center gap-2.5 mb-2">
            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-amber-500 to-emerald-600 flex items-center justify-center font-bold text-black shadow-md shadow-amber-500/10">
              <Zap size={18} className="text-black" />
            </div>
            <div>
              <div className="font-bold text-sm tracking-wide text-white leading-tight font-display">
                THARUN TERMINAL
              </div>
              <div className="font-mono text-[10px] text-amber-400 font-bold tracking-wider leading-tight">
                AUTONOMOUS HEDGE CORE
              </div>
            </div>
          </div>

          <div className="flex items-center justify-between pt-1 text-[11px] font-mono text-slate-400">
            <span className="flex items-center gap-1.5 text-emerald-400 font-bold">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
              SYSTEM ACTIVE
            </span>
            <span className="text-slate-500">{timeEst.split(' ')[0]}</span>
          </div>
        </div>

        {/* Grouped Nav Items */}
        <nav className="flex-1 px-3 py-3 space-y-4 overflow-y-auto">
          {NAV_GROUPS.map((grp) => (
            <div key={grp.group} className="space-y-1">
              <div className="px-3 text-[10px] font-mono font-bold tracking-wider text-slate-500 uppercase">
                {grp.group}
              </div>
              {grp.items.map(({ path, label, icon: Icon }) => (
                <NavLink
                  key={path}
                  to={path}
                  end={path === '/'}
                  className={({ isActive }) => `
                    flex items-center gap-2.5 px-3 py-2 rounded-lg text-xs font-medium transition-all
                    ${isActive
                      ? 'bg-amber-500/15 text-amber-300 border border-amber-500/30 font-semibold shadow-sm'
                      : 'text-slate-400 hover:text-white hover:bg-white/[0.03] border border-transparent'
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
        <div className="p-3 border-t border-white/[0.08] space-y-2">
          <button
            onClick={handleExportCsv}
            className="w-full flex items-center justify-center gap-2 py-2 px-3 rounded-lg bg-white/[0.04] hover:bg-white/[0.08] border border-white/[0.08] text-slate-300 font-mono text-xs transition-colors"
          >
            <FileSpreadsheet size={13} className="text-emerald-400" />
            <span>BLPAPI EXCEL EXPORT</span>
          </button>

          <button
            onClick={handleKillSwitch}
            className={`w-full flex items-center justify-center gap-2 py-2 px-3 rounded-lg border font-mono text-xs font-bold transition-all ${
              killSwitchActive
                ? 'bg-emerald-500/20 text-emerald-400 border-emerald-500 animate-pulse'
                : 'bg-red-500/10 text-red-400 border-red-500/40 hover:bg-red-500/20'
            }`}
          >
            <Power size={13} />
            <span>{killSwitchActive ? 'RESUME TRADING' : 'KILL SWITCH'}</span>
          </button>

          <button
            onClick={handleLogout}
            className="w-full flex items-center justify-center gap-2 py-1.5 px-3 text-slate-400 hover:text-white text-xs font-mono transition-colors"
          >
            <LogOut size={13} /> Logout
          </button>
        </div>
      </aside>

      {/* ── Main Viewport ────────────────────────────────────────── */}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden bg-[#080C14]">
        {/* Top Ticker Bar & Terminal Controls */}
        <div className="bg-[#0B101D] border-b border-white/[0.08] flex items-center justify-between px-4 py-1.5 text-xs font-mono">
          <div className="flex items-center gap-4">
            <span className="text-amber-400 font-bold">TERMINAL FEED:</span>
            <span className="text-slate-400">{timeEst}</span>
            <span className="text-slate-600">|</span>
            <span className="text-slate-400">{timeUtc}</span>
          </div>

          <div className="flex items-center gap-3">
            <span className="text-emerald-400 font-bold flex items-center gap-1">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
              1000-TRADE ENGINE: ONLINE
            </span>
            <span className="text-slate-600">·</span>
            <span className="text-amber-300">POLYMARKET ARBITRAGE: LIVE</span>
          </div>
        </div>

        <LiveTicker />

        <main className="flex-1 overflow-y-auto p-6 bg-[#080C14]">
          <Outlet />
        </main>
      </div>
    </div>
  );
}

