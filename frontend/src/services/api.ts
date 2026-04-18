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

// ── JOURNAL ───────────────────────────────────────────────────────────────────
export const getJournals = () => api.get('/journal').then(r => r.data);
export const getJournal = (date: string) => api.get(`/journal/${date}`).then(r => r.data);

// ── SETTINGS ──────────────────────────────────────────────────────────────────
export const getSettings = () => api.get('/settings').then(r => r.data);

// ── KILL SWITCH ───────────────────────────────────────────────────────────────
export const activateKillSwitch = () => api.post('/kill-switch/activate').then(r => r.data);
export const deactivateKillSwitch = () => api.post('/kill-switch/deactivate').then(r => r.data);
export const getKillSwitchStatus = () => api.get('/kill-switch/status').then(r => r.data);

export default api;
