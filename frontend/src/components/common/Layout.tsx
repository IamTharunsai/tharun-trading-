import { Outlet, NavLink, useNavigate } from 'react-router-dom';
import { useStore } from '../../store';
import { activateKillSwitch, deactivateKillSwitch } from '../../services/api';
import toast from 'react-hot-toast';
import {
  LayoutDashboard, Briefcase, ArrowLeftRight, Bot, BarChart2,
  TrendingUp, BookOpen, Newspaper, Settings, History, LogOut,
  Power, Zap, Eye, Globe, MessageSquare, Users
} from 'lucide-react';
import LiveTicker from './LiveTicker';

const navItems = [
  { path: '/', label: 'Dashboard', icon: LayoutDashboard },
  { path: '/portfolio', label: 'Portfolio', icon: Briefcase },
  { path: '/trades', label: 'Trades', icon: ArrowLeftRight },
  { path: '/agents', label: 'Agent Council', icon: Bot },
  { path: '/agents/debate-room', label: 'Debate Room', icon: Users },
  { path: '/agents/chat', label: 'Agent Chat', icon: MessageSquare },
  { path: '/agents/monitor', label: 'Agent Monitor', icon: Eye },
  { path: '/charts', label: 'Charts', icon: BarChart2 },
  { path: '/analytics', label: 'Analytics', icon: TrendingUp },
  { path: '/journal', label: 'Journal', icon: BookOpen },
  { path: '/news', label: 'News', icon: Newspaper },
  { path: '/news/geopolitics', label: 'News & Geo', icon: Globe },
  { path: '/investment', label: 'Investment Plan', icon: Briefcase },
  { path: '/history', label: 'History', icon: History },
  { path: '/settings', label: 'Settings', icon: Settings },
];

export default function Layout() {
  const { killSwitchActive, setKillSwitch, logout } = useStore();
  const navigate = useNavigate();

  const handleKillSwitch = async () => {
    if (killSwitchActive) {
      await deactivateKillSwitch();
      setKillSwitch(false);
      toast.success('🟢 Trading resumed');
    } else {
      if (!confirm('ACTIVATE KILL SWITCH? This will halt ALL trading immediately.')) return;
      await activateKillSwitch();
      setKillSwitch(true);
    }
  };

  const handleLogout = () => {
    logout();
    navigate('/login');
  };

  return (
    <div className="flex h-screen bg-apex-bg overflow-hidden scanline">
      {/* Sidebar */}
      <aside className="w-56 flex-shrink-0 flex flex-col border-r border-apex-border bg-apex-surface">
        {/* Logo */}
        <div className="px-5 py-5 border-b border-apex-border">
          <div className="flex items-center gap-2">
            <Zap size={18} className="text-apex-accent" />
            <div>
              <div className="font-sans font-bold text-sm text-apex-text tracking-wide leading-tight">THARUN</div>
              <div className="font-sans font-bold text-sm text-apex-accent tracking-wide leading-tight">TRADING AGENT</div>
            </div>
          </div>
          <div className="mt-1 flex items-center gap-1.5">
            <span className="status-dot live" />
            <span className="font-mono text-xs text-apex-green">AI TRADING • LIVE</span>
          </div>
        </div>

        {/* Nav */}
        <nav className="flex-1 py-4 px-3 space-y-0.5 overflow-y-auto">
          {navItems.map(({ path, label, icon: Icon }) => (
            <NavLink key={path} to={path} end={path === '/'}
              className={({ isActive }) =>
                `flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all duration-150 ${
                  isActive
                    ? 'bg-apex-accent/10 text-apex-accent border border-apex-accent/20'
                    : 'text-apex-muted hover:text-apex-text hover:bg-apex-border/40'
                }`
              }
            >
              <Icon size={16} />
              {label}
            </NavLink>
          ))}
        </nav>

        {/* Kill Switch + Logout */}
        <div className="p-3 border-t border-apex-border space-y-2">
          <button
            onClick={handleKillSwitch}
            className={`w-full flex items-center justify-center gap-2 py-2.5 px-4 rounded-lg font-mono font-bold text-sm transition-all ${
              killSwitchActive
                ? 'bg-apex-green/10 border border-apex-green text-apex-green hover:bg-apex-green/20'
                : 'bg-apex-red/10 border border-apex-red text-apex-red hover:bg-apex-red/20 animate-pulse-slow'
            }`}
          >
            <Power size={15} />
            {killSwitchActive ? 'RESUME TRADING' : 'KILL SWITCH'}
          </button>
          <button onClick={handleLogout}
            className="w-full flex items-center justify-center gap-2 py-2 px-4 rounded-lg text-sm text-apex-muted hover:text-apex-red transition-colors"
          >
            <LogOut size={14} /> Logout
          </button>
        </div>
      </aside>

      {/* Main */}
      <div className="flex-1 flex flex-col overflow-hidden">
        <LiveTicker />
        <main className="flex-1 overflow-y-auto p-6 bg-apex-bg">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
