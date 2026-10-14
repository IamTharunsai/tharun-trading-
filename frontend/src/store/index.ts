import { create } from 'zustand';
import { DebateSessions, reduceDebateEvent } from '../utils/debateSessions';

interface PriceUpdate {
  asset: string;
  price: number;
  change24h: number;
  volume24h: number;
  timestamp: number;
}

interface AgentVote {
  agentId: number;
  agentName: string;
  vote: 'BUY' | 'SELL' | 'HOLD';
  confidence: number;
  reasoning: string;
}

interface AgentCouncilState {
  [agentId: number]: {
    status: 'idle' | 'analyzing' | 'voted';
    vote?: AgentVote;
    asset?: string;
  };
}

interface AppStore {
  debateSessions: DebateSessions;
  receiveDebateEvent: (event: string, payload: unknown) => void;
  socketStatus: 'connecting' | 'connected' | 'disconnected' | 'error';
  setSocketStatus: (status: AppStore['socketStatus']) => void;
  // Auth
  token: string | null;
  user: any | null;
  setAuth: (token: string, user: any) => void;
  logout: () => void;

  // Real-time prices
  prices: Record<string, PriceUpdate>;
  updatePrice: (update: PriceUpdate) => void;

  // Portfolio
  portfolio: any | null;
  setPortfolio: (portfolio: any) => void;

  // Kill switch
  killSwitchActive: boolean;
  setKillSwitch: (active: boolean) => void;

  // Agent council
  agentCouncil: AgentCouncilState;
  updateAgentStatus: (agentId: number, status: any, vote?: AgentVote, asset?: string) => void;
  resetCouncil: () => void;

  // Recent trades
  recentTrades: any[];
  addTrade: (trade: any) => void;

  // Active analyses
  currentAnalysis: string | null;
  setCurrentAnalysis: (asset: string | null) => void;
}

// SECURITY: never ship a pre-signed token or a hard-coded owner in the bundle.
// A token is only ever obtained from /api/auth/login.
let storedToken: string | null = null;
try { storedToken = typeof window !== 'undefined' ? localStorage.getItem('apex_token') : null; } catch { storedToken = null; }

export const useStore = create<AppStore>((set) => ({
  debateSessions: {},
  socketStatus: 'disconnected',
  setSocketStatus: (socketStatus) => set({ socketStatus }),
  receiveDebateEvent: (event, payload) => set((state) => {
    if (!state.token) return state;
    const debateSessions = reduceDebateEvent(state.debateSessions, event, payload, Date.now());
    if (debateSessions === state.debateSessions) return state;
    const sessions = Object.values(debateSessions).sort((a, b) => b.receivedAt - a.receivedAt);
    const active = sessions.filter(session => session.status === 'running');
    const latest = active[0] ?? sessions[0];
    const agentCouncil = Object.fromEntries(Object.entries(latest?.agents ?? {}).map(([id, agent]) => [id, {
      status: agent.status, asset: latest?.asset,
      vote: agent.vote ? { agentId: Number(id), agentName: `Specialist ${id}`, vote: agent.vote, confidence: agent.confidence ?? 0, reasoning: agent.reasoning ?? '' } : undefined,
    }]));
    return { debateSessions, agentCouncil, currentAnalysis: active.length ? [...new Set(active.map(session => session.asset || 'Unknown asset'))].join(', ') : null };
  }),
  token: storedToken,
  user: null,
  setAuth: (token, user) => {
    localStorage.setItem('apex_token', token);
    set({ token, user, debateSessions: {}, agentCouncil: {}, currentAnalysis: null, portfolio: null, recentTrades: [] });
  },
  logout: () => {
    localStorage.removeItem('apex_token');
    set({ token: null, user: null, debateSessions: {}, agentCouncil: {}, currentAnalysis: null, portfolio: null, recentTrades: [] });
  },

  prices: {},
  updatePrice: (update) => set((s) => ({ prices: { ...s.prices, [update.asset]: update } })),

  portfolio: null,
  setPortfolio: (portfolio) => set({ portfolio }),

  killSwitchActive: false,
  setKillSwitch: (active) => set({ killSwitchActive: active }),

  agentCouncil: {},
  updateAgentStatus: (agentId, status, vote, asset) =>
    set((s) => ({ agentCouncil: { ...s.agentCouncil, [agentId]: { status, vote, asset } } })),
  resetCouncil: () => set({ agentCouncil: {} }),

  recentTrades: [],
  addTrade: (trade) => set((s) => ({ recentTrades: [trade, ...s.recentTrades].slice(0, 20) })),

  currentAnalysis: null,
  setCurrentAnalysis: (asset) => set({ currentAnalysis: asset }),
}));
