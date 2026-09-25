import axios from 'axios';
import { useStore } from '../store';

const api = axios.create({ baseURL: `${import.meta.env.VITE_API_URL || ''}/api`, timeout: 15000 });

api.interceptors.request.use((config) => {
  const token = useStore.getState().token;
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

api.interceptors.response.use(
  (res) => res,
  (err) => {
    if (err.response?.status === 401) useStore.getState().logout();
    return Promise.reject(err);
  }
);

// ── AUTH ─────────────────────────────────────────────────────────────────────
export const login = (email: string, password: string, totpCode?: string) =>
  api.post('/auth/login', { email, password, totpCode }).then(r => r.data);

export const getMe = () => api.get('/auth/me').then(r => r.data);

// ── PORTFOLIO ─────────────────────────────────────────────────────────────────
export const getPortfolio = () => api.get('/portfolio').then(r => r.data);
export const getPositions = () => api.get('/portfolio/positions').then(r => r.data);
export const getSnapshots = (days = 30) => api.get(`/portfolio/snapshots?days=${days}`).then(r => r.data);

// ── TRADES ────────────────────────────────────────────────────────────────────
export const getTrades = (page = 1, limit = 50, filters?: any) =>
  api.get('/trades', { params: { page, limit, ...filters } }).then(r => r.data);
export const getTradeStats = () => api.get('/trades/stats').then(r => r.data);

// ── AGENTS ────────────────────────────────────────────────────────────────────
export const getAgentDecisions = (page = 1) =>
  api.get('/agents/decisions', { params: { page } }).then(r => r.data);
export const getDecision = (id: string) =>
  api.get(`/agents/decisions/${id}`).then(r => r.data);

// ── MARKET ────────────────────────────────────────────────────────────────────
export const getPrices = () => api.get('/market/prices').then(r => r.data);
export const getNews = () => api.get('/market/news').then(r => r.data);
export const getPredictions = () => api.get('/market/predictions').then(r => r.data);
export const scanPredictions = () => api.post('/market/predictions/scan').then(r => r.data);
export const wagerPrediction = (predictionId: string, outcome: 'YES' | 'NO', amount: number) =>
  api.post('/market/predictions/wager', { predictionId, outcome, amount }).then(r => r.data);
export const runAiDeepDive = (symbol: string, assetClass = 'stock') =>
  api.post('/market/ai-deep-dive', { symbol, assetClass }).then(r => r.data);
export const triggerDebate = (asset: string, market = 'stocks') =>
  api.post('/agents/trigger-debate', { asset, market }).then(r => r.data);
export const runDebate = triggerDebate;
export const scanPredictionMarkets = scanPredictions;
export const runAndTrade = (asset: string, market = 'stocks') =>
  api.post('/agents/run-and-trade', { asset, market }).then(r => r.data);
export const forceTrade = (asset: string, market = 'stocks', direction = 'BUY') =>
  api.post('/agents/force-trade', { asset, market, direction }).then(r => r.data);
export const runBacktestApi = (config: any) =>
  api.post('/backtest/run', config).then(r => r.data);
export const sendAgentChat = (agentId: number, message: string, asset?: string, conversationHistory: any[] = []) =>
  api.post(`/chat/${agentId}`, { message, asset, conversationHistory }).then(r => r.data);
export const getAgentChatHistory = (agentId: number) =>
  api.get(`/chat/${agentId}/history`).then(r => r.data);
export const getStocksUniverse = () => api.get('/market/stocks-universe').then(r => r.data);
export const getAllStocks = () => api.get('/market/all-stocks').then(r => r.data);
export const getIpoCalendar = () => api.get('/market/ipo-calendar').then(r => r.data);
export const getStockDetail = (symbol: string, market = 'stocks') =>
  api.get(`/market/stock/${symbol}`, { params: { market } }).then(r => r.data);
export const getStockCandles = (symbol: string, market = 'stocks') =>
  api.get(`/market/stock/${symbol}/candles`, { params: { market } }).then(r => r.data);
export const getRegimes = (assets: string[]) =>
  api.get('/market/regimes', { params: { assets: assets.join(',') } }).then(r => r.data);

// ── JOURNAL ───────────────────────────────────────────────────────────────────
export const getJournals = () => api.get('/journal').then(r => r.data);
export const getJournal = (date: string) => api.get(`/journal/${date}`).then(r => r.data);

// ── SETTINGS & LIVE ACCOUNTS ──────────────────────────────────────────────────
export const getSettings = () => api.get('/settings').then(r => r.data);
export const getLiveAccounts = () => api.get('/portfolio/live-accounts').then(r => r.data);
export const connectAlpaca = (data: { apiKey: string; secretKey: string; paperMode?: boolean }) =>
  api.post('/settings/connect-alpaca', data).then(r => r.data);
export const connectPolymarket = (data: { address: string; privateKey?: string }) =>
  api.post('/settings/connect-polymarket', data).then(r => r.data);
export const disconnectAccount = (type: 'alpaca' | 'polymarket') =>
  api.post('/settings/disconnect', { type }).then(r => r.data);

// ── LIVE CHART & UNIVERSE ────────────────────────────────────────────────────
export const getLiveChart = (symbol: string, timeframe = '1D', range = '6mo') =>
  api.get(`/market/chart/${symbol}`, { params: { timeframe, range } }).then(r => r.data);
export const getFullStockUniverse = () =>
  api.get('/market/stock-universe').then(r => r.data);

// ── INSTITUTIONAL INTELLIGENCE ───────────────────────────────────────────────
export const getChartIntelligence = (symbol: string, market = 'stocks') =>
  api.get(`/intelligence/chart-ai/${symbol}`, { params: { market } }).then(r => r.data?.data);

export const getAlternativeData = (symbol?: string) =>
  api.get(`/intelligence/alternative-data${symbol ? `/${symbol}` : ''}`).then(r => r.data?.data);

export const getEarningsIvCrush = () =>
  api.get('/intelligence/earnings-iv-crush').then(r => r.data?.data);

export const getAiArsenal = () =>
  api.get('/intelligence/ai-arsenal').then(r => r.data?.data);

// ── KILL SWITCH ───────────────────────────────────────────────────────────────
export const activateKillSwitch = () => api.post('/kill-switch/activate').then(r => r.data);
export const deactivateKillSwitch = () => api.post('/kill-switch/deactivate').then(r => r.data);
export const getKillSwitchStatus = () => api.get('/kill-switch/status').then(r => r.data);

export default api;
