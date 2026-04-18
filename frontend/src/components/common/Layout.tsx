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

const COLORS = {
  bg:      '#FAF6F1',
  sidebar: '#FFF3E8',
  card:    '#FFF8F2',
  border:  '#E8D5C4',
  accent:  '#FF8C42',
  text:    '#2C1810',
  muted:   '#8B6F47',
  green:   '#2D8A4A',
  red:     '#DC2626',
};

export default function Layout() {
  const { killSwitchActive, setKillSwitch, logout } = useStore();
  const navigate = useNavigate();

  const handleKillSwitch = async () => {
    if (killSwitchActive) {
      await deactivateKillSwitch();
      setKillSwitch(false);
      toast.success('Trading resumed');
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
    <div style={{ display: 'flex', height: '100vh', background: COLORS.bg, overflow: 'hidden' }}>

      {/* ── Sidebar ────────────────────────────────────────────── */}
      <aside style={{
        width: 220,
        flexShrink: 0,
        display: 'flex',
        flexDirection: 'column',
        background: COLORS.sidebar,
        borderRight: `1px solid ${COLORS.border}`,
        overflowY: 'auto',
      }}>

        {/* Logo block */}
        <div style={{ padding: '20px 20px 16px', borderBottom: `1px solid ${COLORS.border}` }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
            <div style={{
              width: 32, height: 32, borderRadius: 8,
              background: COLORS.accent,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              flexShrink: 0,
            }}>
              <Zap size={18} color="#fff" />
            </div>
            <div>
              <div style={{ fontFamily: 'Syne', fontWeight: 800, fontSize: 13, color: COLORS.text, lineHeight: 1.2 }}>
                THARUN
              </div>
              <div style={{ fontFamily: 'Syne', fontWeight: 800, fontSize: 12, color: COLORS.accent, lineHeight: 1.2 }}>
                TRADING AGENT
              </div>
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span className="status-dot live" />
            <span style={{ fontFamily: 'Space Mono', fontSize: 10, color: COLORS.green, fontWeight: 700 }}>
              AI TRADING • LIVE
            </span>
          </div>
        </div>

        {/* Nav links */}
        <nav style={{ flex: 1, padding: '12px 10px', overflowY: 'auto' }}>
          {navItems.map(({ path, label, icon: Icon }) => (
            <NavLink key={path} to={path} end={path === '/'}
              style={({ isActive }) => ({
                display: 'flex',
                alignItems: 'center',
                gap: 10,
                padding: '9px 12px',
                borderRadius: 8,
                marginBottom: 2,
                textDecoration: 'none',
                fontSize: 13,
                fontFamily: 'Syne',
                fontWeight: isActive ? 700 : 500,
                color: isActive ? COLORS.accent : COLORS.muted,
                background: isActive ? `rgba(255,140,66,0.1)` : 'transparent',
                border: isActive ? `1px solid rgba(255,140,66,0.25)` : '1px solid transparent',
                transition: 'all 0.15s ease',
              })}
            >
              <Icon size={15} />
              {label}
            </NavLink>
          ))}
        </nav>

        {/* Kill switch + logout */}
        <div style={{ padding: 12, borderTop: `1px solid ${COLORS.border}`, display: 'flex', flexDirection: 'column', gap: 6 }}>
          <button onClick={handleKillSwitch} style={{
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
            padding: '10px 16px', borderRadius: 8,
            background: killSwitchActive ? 'rgba(45,138,74,0.08)' : 'rgba(220,38,38,0.08)',
            border: `1px solid ${killSwitchActive ? COLORS.green : COLORS.red}`,
            color: killSwitchActive ? COLORS.green : COLORS.red,
            fontFamily: 'Space Mono', fontWeight: 700, fontSize: 11, cursor: 'pointer',
          }}>
            <Power size={13} />
            {killSwitchActive ? 'RESUME TRADING' : 'KILL SWITCH'}
          </button>
          <button onClick={handleLogout} style={{
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
            padding: '8px 16px', borderRadius: 8, border: 'none', background: 'transparent',
            color: COLORS.muted, fontFamily: 'Syne', fontSize: 13, cursor: 'pointer',
          }}>
            <LogOut size={13} /> Logout
          </button>
        </div>
      </aside>

      {/* ── Main content ──────────────────────────────────────── */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', background: COLORS.bg }}>
        <LiveTicker />
        <main style={{ flex: 1, overflowY: 'auto', padding: 24, background: COLORS.bg, color: COLORS.text }}>
          <Outlet />
        </main>
      </div>
    </div>
  );
}
