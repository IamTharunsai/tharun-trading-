import { create } from 'zustand';

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

export const useStore = create<AppStore>((set) => ({
  token: localStorage.getItem('apex_token'),
  user: null,
  setAuth: (token, user) => {
    localStorage.setItem('apex_token', token);
    set({ token, user });
  },
  logout: () => {
    localStorage.removeItem('apex_token');
    set({ token: null, user: null });
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
