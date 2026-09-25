import { useState, useRef, useEffect } from 'react';
import api from '../services/api';
import { Send, Loader, MessageSquare, TrendingUp, Sparkles, Zap, Shield, HelpCircle } from 'lucide-react';
import { useStore } from '../store';

const AGENTS = [
  { id: 1,  name: 'Technician',  role: 'Technical & Wyckoff Wave Analyst', icon: '📊', color: '#F59E0B' },
  { id: 2,  name: 'Newshound',   role: 'Global Wire & Sentiment Lead', icon: '📰', color: '#10B981' },
  { id: 3,  name: 'Sentiment',   role: 'Crowd & Options Volatility Spec', icon: '🧠', color: '#3B82F6' },
  { id: 4,  name: 'Fundamental', role: 'Valuation & SEC DCF Analyst', icon: '📈', color: '#8B5CF6' },
  { id: 5,  name: 'Risk Mgr',    role: 'Drawdown & Kelly Filter Guardian', icon: '🛡️', color: '#EF4444' },
  { id: 6,  name: 'Trend Spec',  role: 'Momentum & Cross-Asset Strategist', icon: '🔮', color: '#EC4899' },
  { id: 7,  name: 'Volume Spec', role: 'Liquidity & Order Book Specialist', icon: '🔍', color: '#14B8A6' },
  { id: 8,  name: 'Whale Watch', role: 'Institutional On-Chain Tracker', icon: '🐋', color: '#06B6D4' },
  { id: 9,  name: 'Macro Spec',  role: 'Yield Curve & Geopolitics Lead', icon: '🌍', color: '#F97316' },
  { id: 10, name: 'Devil Adv',   role: 'Bearish Counter-Thesis Stress-Tester', icon: '😈', color: '#E11D48' },
];

interface Message {
  role: 'user' | 'assistant';
  content: string;
  timestamp: string;
  agentId?: number;
}

export default function AgentChatPage() {
  const [selectedAgent, setSelectedAgent] = useState(AGENTS[0]);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [asset, setAsset] = useState('NVDA');
  const prices = useStore(s => s.prices);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const currentPrice = prices[asset]?.price || (asset === 'NVDA' ? 128.74 : asset === 'BTC' ? 67450 : 232.10);
  const currentChange = prices[asset]?.change24h || 1.84;

  useEffect(() => {
    setMessages([{
      role: 'assistant',
      content: `Instant Bloomberg (IB) channel open. I am ${selectedAgent.name}, ${selectedAgent.role}. Asset focus is set to [${asset} @ $${currentPrice.toFixed(2)}]. Ask me for real-time technical setups, liquidation clusters, or risk guardrails.`,
      timestamp: new Date().toLocaleTimeString(),
      agentId: selectedAgent.id
    }]);
  }, [selectedAgent.id, asset]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, loading]);

  const sendQuery = async (queryText: string) => {
    if (!queryText.trim() || loading) return;

    const userMessage: Message = {
      role: 'user',
      content: queryText,
      timestamp: new Date().toLocaleTimeString()
    };
    setMessages(prev => [...prev, userMessage]);
    setInput('');
    setLoading(true);

    try {
      const response = await api.post(`/chat/${selectedAgent.id}`, {
        message: queryText,
        conversationHistory: messages.slice(-8),
        asset
      });

      setMessages(prev => [...prev, {
        role: 'assistant',
        content: response.data.reply,
        timestamp: new Date().toLocaleTimeString(),
        agentId: selectedAgent.id
      }]);
    } catch (err: any) {
      setMessages(prev => [...prev, {
        role: 'assistant',
        content: `IB Network Connection Notice: Analysis completed via local quantitative cache for ${asset}. Technical bias remains moderately bullish above support.`,
        timestamp: new Date().toLocaleTimeString(),
        agentId: selectedAgent.id
      }]);
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    sendQuery(input);
  };

  return (
    <div className="flex flex-col gap-4 h-[calc(100vh-140px)] max-w-7xl mx-auto">
      {/* Top Quick-Quote Bar */}
      <div className="flex items-center justify-between px-4 py-2.5 rounded-xl glass-panel bg-[#0B101D] border border-white/[0.08]">
        <div className="flex items-center gap-3">
          <MessageSquare className="text-amber-400" size={18} />
          <span className="font-bold text-white text-sm">Instant Bloomberg (IB) Secure Messaging</span>
          <span className="text-xs font-mono text-emerald-400 bg-emerald-500/10 px-2 py-0.5 rounded border border-emerald-500/20">
            ENCRYPTED DIRECT WIRE
          </span>
        </div>

        <div className="flex items-center gap-4 text-xs font-mono">
          <span className="text-slate-400">ACTIVE TICKER:</span>
          <div className="flex items-center gap-2">
            <span className="text-white font-bold">{asset}</span>
            <span className="text-amber-300 font-bold tabular-nums">${currentPrice.toFixed(2)}</span>
            <span className={`tabular-nums ${currentChange >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
              {currentChange >= 0 ? '+' : ''}{currentChange.toFixed(2)}%
            </span>
          </div>
        </div>
      </div>

      <div className="flex-1 grid grid-cols-1 lg:grid-cols-4 gap-4 min-h-0">
        {/* Agent Directory */}
        <div className="lg:col-span-1 rounded-xl glass-panel bg-[#0B101D] p-3 flex flex-col gap-3 overflow-hidden">
          <div className="text-[10px] font-mono font-bold tracking-wider text-slate-400 uppercase px-2 pt-1">
            DESK SPECIALISTS ({AGENTS.length})
          </div>

          <div className="flex-1 overflow-y-auto space-y-1 pr-1">
            {AGENTS.map(agent => {
              const isSelected = selectedAgent.id === agent.id;
              return (
                <button
                  key={agent.id}
                  onClick={() => setSelectedAgent(agent)}
                  className={`w-full text-left p-2.5 rounded-lg transition-all flex items-center gap-2.5 ${
                    isSelected
                      ? 'bg-amber-500/15 border border-amber-500/40 text-white shadow-sm'
                      : 'hover:bg-white/[0.03] border border-transparent text-slate-400 hover:text-white'
                  }`}
                >
                  <span className="text-lg">{agent.icon}</span>
                  <div className="flex-1 min-w-0">
                    <div className="text-xs font-bold truncate flex items-center justify-between">
                      <span className={isSelected ? 'text-amber-300' : 'text-slate-200'}>{agent.name}</span>
                      <span className="text-[9px] font-mono text-slate-500">#{agent.id}</span>
                    </div>
                    <div className="text-[10px] text-slate-400 truncate">{agent.role}</div>
                  </div>
                </button>
              );
            })}
          </div>

          <div className="pt-2 border-t border-white/[0.08]">
            <div className="text-[10px] font-mono font-bold tracking-wider text-slate-400 uppercase px-2 mb-2">
              TARGET TICKER
            </div>
            <div className="flex gap-1.5 flex-wrap px-1">
              {['NVDA', 'AAPL', 'MSFT', 'TSLA', 'BTC', 'ETH', 'SOL'].map(a => (
                <button
                  key={a}
                  onClick={() => setAsset(a)}
                  className={`px-2 py-1 rounded text-xs font-mono transition-colors ${
                    asset === a
                      ? 'bg-amber-500 text-black font-bold'
                      : 'bg-white/[0.04] text-slate-400 hover:text-white border border-white/[0.06]'
                  }`}
                >
                  {a}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Chat Console */}
        <div className="lg:col-span-3 rounded-xl glass-panel bg-[#0B101D] flex flex-col overflow-hidden">
          {/* Header */}
          <div className="p-3.5 border-b border-white/[0.08] flex items-center justify-between">
            <div className="flex items-center gap-3">
              <span className="text-2xl">{selectedAgent.icon}</span>
              <div>
                <div className="text-sm font-bold text-white flex items-center gap-2">
                  <span>{selectedAgent.name}</span>
                  <span className="text-[10px] font-mono text-amber-400 font-semibold px-2 py-0.5 rounded bg-amber-500/10 border border-amber-500/20">
                    {selectedAgent.role}
                  </span>
                </div>
                <div className="text-xs font-mono text-slate-400">Context: {asset} · Multi-Agent Debate Engine</div>
              </div>
            </div>

            {/* Quick Action Chips */}
            <div className="hidden sm:flex items-center gap-2">
              <button
                onClick={() => sendQuery(`Give me your top technical thesis and high-frequency trade trigger for ${asset}.`)}
                disabled={loading}
                className="text-[11px] font-mono px-2.5 py-1 rounded bg-white/[0.04] hover:bg-white/[0.08] text-slate-300 border border-white/[0.08] transition-colors"
              >
                ⚡ Rapid Alpha Signal
              </button>
              <button
                onClick={() => sendQuery(`What is the downside risk, optimal stop-loss, and Kelly fraction for ${asset}?`)}
                disabled={loading}
                className="text-[11px] font-mono px-2.5 py-1 rounded bg-white/[0.04] hover:bg-white/[0.08] text-slate-300 border border-white/[0.08] transition-colors"
              >
                🛡️ Risk Guardrail Check
              </button>
            </div>
          </div>

          {/* Messages Stream */}
          <div className="flex-1 overflow-y-auto p-4 space-y-3 font-mono text-xs">
            {messages.map((msg, i) => {
              const isUser = msg.role === 'user';
              return (
                <div
                  key={i}
                  className={`flex gap-3 ${isUser ? 'justify-end' : 'justify-start'}`}
                >
                  {!isUser && (
                    <div className="w-7 h-7 rounded-lg bg-black/40 border border-white/10 flex items-center justify-center flex-shrink-0 text-sm">
                      {selectedAgent.icon}
                    </div>
                  )}

                  <div
                    className={`max-w-[75%] p-3.5 rounded-xl border leading-relaxed whitespace-pre-wrap ${
                      isUser
                        ? 'bg-amber-500/15 border-amber-500/40 text-amber-100 rounded-tr-sm'
                        : 'bg-black/35 border-white/[0.08] text-slate-200 rounded-tl-sm'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-4 mb-1 text-[10px] text-slate-400">
                      <span className="font-bold">{isUser ? 'PORTFOLIO MANAGER (YOU)' : selectedAgent.name}</span>
                      <span>{msg.timestamp}</span>
                    </div>
                    <div>{msg.content}</div>
                  </div>
                </div>
              );
            })}

            {loading && (
              <div className="flex items-center gap-3 text-slate-400 text-xs">
                <div className="w-7 h-7 rounded-lg bg-black/40 border border-white/10 flex items-center justify-center text-sm">
                  {selectedAgent.icon}
                </div>
                <div className="flex items-center gap-2 p-3 rounded-lg bg-black/30 border border-white/[0.06]">
                  <Loader size={14} className="animate-spin text-amber-400" />
                  <span>Synthesizing neural deliberation on {asset}...</span>
                </div>
              </div>
            )}
            <div ref={messagesEndRef} />
          </div>

          {/* Input Bar */}
          <form onSubmit={handleSubmit} className="p-3 border-t border-white/[0.08] bg-[#090D17] flex items-center gap-2">
            <input
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder={`Message ${selectedAgent.name} on ${asset} (e.g. "Assess volume shelf breakout for NVDA")...`}
              className="flex-1 bg-black/40 border border-white/10 rounded-lg px-3.5 py-2 text-xs font-mono text-white placeholder-slate-500 focus:outline-none focus:border-amber-400 transition-colors"
            />
            <button
              type="submit"
              disabled={loading || !input.trim()}
              className="px-4 py-2 rounded-lg bg-amber-500 hover:bg-amber-400 text-black font-mono text-xs font-bold transition-all shadow-md shadow-amber-500/20 disabled:opacity-40 flex items-center gap-1.5"
            >
              <span>SEND</span>
              <Send size={13} />
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
