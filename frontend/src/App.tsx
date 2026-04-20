import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { useEffect } from 'react';
import { useStore } from './store';
import { connectSocket } from './services/socket';

// Pages
import LoginPage from './pages/Login';
import DashboardPage from './pages/Dashboard';
import PortfolioPage from './pages/Portfolio';
import TradesPage from './pages/Trades';
import AgentsPage from './pages/Agents';
import AgentChatPage from './pages/AgentChat';
import DebateRoomPage from './pages/DebateRoom';
import AgentMonitorPage from './pages/AgentMonitor';
import ChartsPage from './pages/Charts';
import AnalyticsPage from './pages/Analytics';
import JournalPage from './pages/Journal';
import NewsPage from './pages/News';
import NewsAndGeopoliticsPage from './pages/NewsAndGeopolitics';
import InvestmentPage from './pages/Investment';
import StockUniversePage from './pages/StockUniverse';
import SettingsPage from './pages/Settings';
import HistoryPage from './pages/History';
import Layout from './components/common/Layout';

function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const token = useStore(s => s.token);
  if (!token) return <Navigate to="/login" replace />;
  return <>{children}</>;
}

export default function App() {
  const token = useStore(s => s.token);

  useEffect(() => {
    if (token) {
      connectSocket();
    }
  }, [token]);

  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/" element={<ProtectedRoute><Layout /></ProtectedRoute>}>
          <Route index element={<DashboardPage />} />
          <Route path="portfolio" element={<PortfolioPage />} />
          <Route path="trades" element={<TradesPage />} />
          <Route path="agents" element={<AgentsPage />} />
          <Route path="agents/chat" element={<AgentChatPage />} />
          <Route path="agents/debate-room" element={<DebateRoomPage />} />
          <Route path="agents/monitor" element={<AgentMonitorPage />} />
          <Route path="charts" element={<ChartsPage />} />
          <Route path="analytics" element={<AnalyticsPage />} />
          <Route path="journal" element={<JournalPage />} />
          <Route path="news" element={<NewsPage />} />
          <Route path="news/geopolitics" element={<NewsAndGeopoliticsPage />} />
          <Route path="investment" element={<InvestmentPage />} />
          <Route path="settings" element={<SettingsPage />} />
          <Route path="history" element={<HistoryPage />} />
          <Route path="stocks" element={<StockUniversePage />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}
