import { useState, useRef, useEffect } from 'react';
import api from '../services/api';
import { Send, Loader, MessageSquare, TrendingUp, Sparkles, Zap, Shield, HelpCircle } from 'lucide-react';
import { useStore } from '../store';
import SymbolPicker from '../components/common/SymbolPicker';
import { useSelectedSymbol } from '../hooks/useDefaultSymbol';

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
  const { symbol: asset, setSymbol: setAsset } = useSelectedSymbol('all');
  const prices = useStore(s => s.prices);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const currentPrice = asset ? prices[asset]?.price ?? null : null;
  const currentChange: number | null = asset && typeof prices[asset]?.change24h === 'number' ? prices[asset].change24h : null;

  useEffect(() => {
    setMessages([{
      role: 'assistant',
      content: `Instant Bloomberg (IB) channel open. I am ${selectedAgent.name}, ${selectedAgent.role}. ${asset ? `Asset focus is set to [${asset}${currentPrice != null ? ` @ $${currentPrice.toFixed(2)}` : ''}].` : 'No asset selected yet — pick one with the ticker picker.'} Ask me for real-time technical setups, liquidation clusters, or risk guardrails.`,
      timestamp: new Date().toLocaleTimeString(),
      agentId: selectedAgent.id
    }]);
  }, [selectedAgent.id, asset]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, loading]);

  const sendQuery = async (queryText: string) => {
    if (!queryText.trim() || loading) return;
    if (!asset) { setMessages(prev => [...prev, { role: 'assistant', content: 'Pick a symbol first.', timestamp: new Date().toLocaleTimeString(), agentId: selectedAgent.id }]); return; }

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
        content: response.data?.reply || '⚠️ The agent returned an empty response.',
        timestamp: new Date().toLocaleTimeString(),
        agentId: selectedAgent.id
      }]);
    } catch (err: any) {
      setMessages(prev => [...prev, {
        role: 'assistant',
        content: `⚠️ Request failed — no analysis was produced for ${asset || 'this query'}. ${err?.response?.data?.error || err?.message || 'The AI provider or backend did not respond.'}`,
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
    <div className="flex flex-col gap-4 h-[calc(100vh-140px)] max-w-7xl mx-auto text-slate-900">
      {/* Top Quick-Quote Bar */}
      <div className="flex items-center justify-between px-4 py-2.5 rounded-xl bg-white border border-slate-200/90 shadow-sm">
        <div className="flex items-center gap-3">
          <MessageSquare className="text-blue-600" size={18} />
          <span className="font-bold text-slate-900 text-sm">Instant Bloomberg (IB) Secure Messaging</span>
          <span className="text-xs font-mono text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded border border-emerald-200 font-bold">
            ENCRYPTED DIRECT WIRE
          </span>
        </div>

        <div className="flex items-center gap-4 text-xs font-mono">
          <span className="text-slate-500 font-semibold">ACTIVE TICKER:</span>
          <div className="flex items-center gap-2">
            <span className="text-slate-900 font-bold" data-testid="active-ticker">{asset || '—'}</span>
            <span className="text-blue-700 font-bold tabular-nums">{currentPrice != null ? `$${currentPrice.toFixed(2)}` : '—'}</span>
            <span className={`tabular-nums font-bold ${currentChange === null ? 'text-slate-400' : currentChange >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>
              {currentChange === null ? '—' : `${currentChange >= 0 ? '+' : ''}${currentChange.toFixed(2)}%`}
            </span>
          </div>
        </div>
      </div>

      <div className="flex-1 grid grid-cols-1 lg:grid-cols-4 gap-4 min-h-0">
        {/* Agent Directory */}
        <div className="lg:col-span-1 rounded-xl bg-white border border-slate-200/90 p-3 flex flex-col gap-3 overflow-hidden shadow-sm">
          <div className="text-[10px] font-mono font-bold tracking-wider text-slate-500 uppercase px-2 pt-1">
            DESK SPECIALISTS ({AGENTS.length})
          </div>

          <div className="flex-1 overflow-y-auto space-y-1 pr-1">
            {AGENTS.map(agent => {
              const isSelected = selectedAgent.id === agent.id;
              return (
                <button
                  key={agent.id}
                  data-testid={`agent-select-${agent.id}`}
                  onClick={() => setSelectedAgent(agent)}
                  className={`w-full text-left p-2.5 rounded-lg transition-all flex items-center gap-2.5 ${
                    isSelected
                      ? 'bg-blue-50 border border-blue-200 text-blue-900 shadow-xs'
                      : 'hover:bg-slate-50 border border-transparent text-slate-700 hover:text-slate-900'
                  }`}
                >
                  <span className="text-lg">{agent.icon}</span>
                  <div className="flex-1 min-w-0">
                    <div className="text-xs font-bold truncate flex items-center justify-between">
                      <span className={isSelected ? 'text-blue-700' : 'text-slate-900'}>{agent.name}</span>
                      <span className="text-[9px] font-mono text-slate-400">#{agent.id}</span>
                    </div>
                    <div className="text-[10px] text-slate-500 truncate">{agent.role}</div>
                  </div>
                </button>
              );
            })}
          </div>

          <div className="pt-2 border-t border-slate-100">
            <div className="text-[10px] font-mono font-bold tracking-wider text-slate-500 uppercase px-2 mb-2">
              TARGET TICKER
            </div>
            <div className="px-1">
              <SymbolPicker value={asset} onChange={(sym, meta) => setAsset(sym, meta)} data-testid="symbol-picker" className="w-full" />
            </div>
          </div>
        </div>

        {/* Chat Console */}
        <div className="lg:col-span-3 rounded-xl bg-white border border-slate-200/90 shadow-sm flex flex-col overflow-hidden">
          {/* Header */}
          <div className="p-3.5 border-b border-slate-100 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <span className="text-2xl">{selectedAgent.icon}</span>
              <div>
                <div className="text-sm font-bold text-slate-900 flex items-center gap-2">
                  <span>{selectedAgent.name}</span>
                  <span className="text-[10px] font-mono text-blue-700 font-semibold px-2 py-0.5 rounded bg-blue-50 border border-blue-200">
                    {selectedAgent.role}
                  </span>
                </div>
                <div className="text-xs font-mono text-slate-500">Context: {asset} · Multi-Agent Debate Engine</div>
              </div>
            </div>

            {/* Quick Action Chips */}
            <div className="hidden sm:flex items-center gap-2">
              <button
                data-testid="quick-alpha"
                onClick={() => sendQuery(`Give me your top technical thesis and high-frequency trade trigger for ${asset}.`)}
                disabled={loading}
                className="text-[11px] font-mono px-2.5 py-1 rounded bg-slate-50 hover:bg-slate-100 text-slate-700 border border-slate-200 transition-colors font-semibold"
              >
                ⚡ Rapid Alpha Signal
              </button>
              <button
                onClick={() => sendQuery(`What is the downside risk, optimal stop-loss, and Kelly fraction for ${asset}?`)}
                disabled={loading}
                className="text-[11px] font-mono px-2.5 py-1 rounded bg-slate-50 hover:bg-slate-100 text-slate-700 border border-slate-200 transition-colors font-semibold"
              >
                🛡️ Risk Guardrail Check
              </button>
            </div>
          </div>

          {/* Messages Stream */}
          <div className="flex-1 overflow-y-auto p-4 space-y-3 font-mono text-xs bg-slate-50/50">
            {messages.map((msg, i) => {
              const isUser = msg.role === 'user';
              return (
                <div
                  key={i}
                  className={`flex gap-3 ${isUser ? 'justify-end' : 'justify-start'}`}
                >
                  {!isUser && (
                    <div className="w-7 h-7 rounded-lg bg-white border border-slate-200 flex items-center justify-center flex-shrink-0 text-sm shadow-xs">
                      {selectedAgent.icon}
                    </div>
                  )}

                  <div
                    className={`max-w-[75%] p-3.5 rounded-xl border leading-relaxed whitespace-pre-wrap ${
                      isUser
                        ? 'bg-blue-600 border-blue-600 text-white rounded-tr-sm shadow-xs'
                        : 'bg-white border-slate-200 text-slate-900 rounded-tl-sm shadow-xs'
                    }`}
                  >
                    <div className={`flex items-center justify-between gap-4 mb-1 text-[10px] ${isUser ? 'text-blue-100' : 'text-slate-400'}`}>
                      <span className="font-bold">{isUser ? 'PORTFOLIO MANAGER (YOU)' : selectedAgent.name}</span>
                      <span>{msg.timestamp}</span>
                    </div>
                    <div className={isUser ? 'text-white' : 'text-slate-800'}>{msg.content}</div>
                  </div>
                </div>
              );
            })}

            {loading && (
              <div className="flex items-center gap-3 text-slate-500 text-xs">
                <div className="w-7 h-7 rounded-lg bg-white border border-slate-200 flex items-center justify-center text-sm shadow-xs">
                  {selectedAgent.icon}
                </div>
                <div className="flex items-center gap-2 p-3 rounded-lg bg-white border border-slate-200 shadow-xs">
                  <Loader size={14} className="animate-spin text-blue-600" />
                  <span className="text-slate-700">Synthesizing neural deliberation on {asset}...</span>
                </div>
              </div>
            )}
            <div ref={messagesEndRef} />
          </div>

          {/* Input Bar */}
          <form onSubmit={handleSubmit} className="p-3 border-t border-slate-200 bg-white flex items-center gap-2">
            <input
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder={`Message ${selectedAgent.name} on ${asset || '…'}${asset ? ` (e.g. "Assess volume shelf breakout for ${asset}")` : ''}...`}
              data-testid="chat-input"
              className="flex-1 bg-slate-50 border border-slate-300 rounded-lg px-3.5 py-2 text-xs font-mono text-slate-900 placeholder-slate-400 focus:outline-none focus:border-blue-500 transition-colors"
            />
            <button
              data-testid="chat-send"
              type="submit"
              disabled={loading || !input.trim()}
              className="px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-white font-mono text-xs font-bold transition-all shadow-xs disabled:opacity-40 flex items-center gap-1.5"
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
