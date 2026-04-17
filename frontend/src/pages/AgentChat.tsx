import { useState, useRef, useEffect } from 'react';
import axios from 'axios';
import { Send, Loader } from 'lucide-react';
import { useStore } from '../store';

const AGENTS = [
  { id: 1,  name: 'Technician',  icon: '📊', color: '#FF8C42' },
  { id: 2,  name: 'Newshound',   icon: '📰', color: '#F5A623' },
  { id: 3,  name: 'Sentiment',   icon: '🧠', color: '#2D8A4A' },
  { id: 4,  name: 'Fundamental', icon: '📈', color: '#FF8C42' },
  { id: 5,  name: 'Risk Mgr',    icon: '🛡️', color: '#DC2626' },
  { id: 6,  name: 'Trend',       icon: '🔮', color: '#2D8A4A' },
  { id: 7,  name: 'Volume',      icon: '🔍', color: '#F5A623' },
  { id: 8,  name: 'Whale Watch', icon: '🐋', color: '#2D8A4A' },
  { id: 9,  name: 'Macro',       icon: '🌍', color: '#FF8C42' },
  { id: 10, name: 'Devil Adv',   icon: '😈', color: '#DC2626' },
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
  const [asset, setAsset] = useState('BTC');
  const token = useStore(s => s.token);

  useEffect(() => {
    setMessages([{
      role: 'assistant',
      content: `I'm ${selectedAgent.name}. What would you like to discuss?`,
      timestamp: new Date().toISOString(),
      agentId: selectedAgent.id
    }]);
  }, [selectedAgent.id]);

  const sendMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() || loading) return;

    const userMessage: Message = { role: 'user', content: input, timestamp: new Date().toISOString() };
    setMessages(prev => [...prev, userMessage]);
    setInput('');
    setLoading(true);

    try {
      const response = await axios.post(
        `/api/chat/${selectedAgent.id}`,
        { message: input, conversationHistory: messages.slice(-10), asset },
        { headers: { Authorization: `Bearer ${token}` } }
      );

      setMessages(prev => [...prev, {
        role: 'assistant',
        content: response.data.reply,
        timestamp: response.data.timestamp,
        agentId: selectedAgent.id
      }]);
    } catch (err) {
      setMessages(prev => [...prev, {
        role: 'assistant',
        content: 'Error. Please try again.',
        timestamp: new Date().toISOString(),
        agentId: selectedAgent.id
      }]);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '220px 1fr', gap: 16, height: 'calc(100vh - 100px)' }}>
      {/* Sidebar */}
      <div style={{ background: 'var(--apex-card)', borderRadius: 12, padding: 12, overflow: 'auto' }}>
        <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--apex-muted)', marginBottom: 12, textTransform: 'uppercase' }}>Agents</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {AGENTS.map(agent => (
            <button key={agent.id} onClick={() => setSelectedAgent(agent)}
              style={{
                padding: 10, borderRadius: 8, border: selectedAgent.id === agent.id ? `2px solid ${agent.color}` : '1px solid var(--apex-border)',
                background: selectedAgent.id === agent.id ? agent.color + '10' : 'var(--apex-surface)',
                color: 'var(--apex-text)', cursor: 'pointer', textAlign: 'left',
                display: 'flex', alignItems: 'center', gap: 8
              }}
            >
              <span style={{ fontSize: 16 }}>{agent.icon}</span>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 11, fontWeight: 700 }}>{agent.name}</div>
              </div>
            </button>
          ))}
        </div>
        <div style={{ marginTop: 16, paddingTop: 16, borderTop: '1px solid var(--apex-border)' }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--apex-muted)', marginBottom: 8, textTransform: 'uppercase' }}>Context</div>
          <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
            {['BTC', 'ETH', 'SOL'].map(a => (
              <button key={a} onClick={() => setAsset(a)}
                style={{
                  padding: '4px 10px', borderRadius: 6, fontSize: 11,
                  border: asset === a ? `1px solid ${selectedAgent.color}` : '1px solid var(--apex-border)',
                  background: asset === a ? selectedAgent.color + '15' : 'transparent',
                  color: 'var(--apex-text)', cursor: 'pointer'
                }}
              >{a}</button>
            ))}
          </div>
        </div>
      </div>

      {/* Chat */}
      <div style={{ background: 'var(--apex-card)', borderRadius: 12, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        {/* Header */}
        <div style={{ padding: 16, borderBottom: '1px solid var(--apex-border)', display: 'flex', alignItems: 'center', gap: 12 }}>
          <span style={{ fontSize: 24 }}>{selectedAgent.icon}</span>
          <div>
            <div style={{ fontSize: 14, fontWeight: 700, color: selectedAgent.color }}>{selectedAgent.name}</div>
            <div style={{ fontSize: 10, color: 'var(--apex-muted)' }}>Context: {asset}</div>
          </div>
        </div>

        {/* Messages */}
        <div style={{ flex: 1, overflowY: 'auto', padding: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
          {messages.map((msg, i) => (
            <div key={i} style={{ display: 'flex', flexDirection: msg.role === 'user' ? 'row-reverse' : 'row', gap: 10 }}>
              {msg.role === 'assistant' && <div style={{ fontSize: 18 }}>{selectedAgent.icon}</div>}
              <div style={{
                maxWidth: '70%', padding: '10px 14px', borderRadius: 8,
                background: msg.role === 'user' ? 'rgba(255,140,66,.15)' : 'var(--apex-surface)',
                border: `1px solid ${msg.role === 'user' ? 'rgba(255,140,66,.4)' : 'var(--apex-border)'}`
              }}>
                <div style={{ fontSize: 13, color: 'var(--apex-text)', lineHeight: 1.6 }}>{msg.content}</div>
              </div>
            </div>
          ))}
          {loading && <div style={{ display: 'flex', gap: 10 }}><span style={{ fontSize: 18 }}>{selectedAgent.icon}</span><Loader size={14} style={{ marginTop: 4, animation: 'spin 2s linear infinite' }} /></div>}
        </div>

        {/* Input */}
        <form onSubmit={sendMessage} style={{ padding: 16, borderTop: '1px solid var(--apex-border)', display: 'flex', gap: 8 }}>
          <input value={input} onChange={(e) => setInput(e.target.value)} placeholder="Ask an agent..."
            style={{
              flex: 1, padding: '10px 12px', borderRadius: 8, border: '1px solid var(--apex-border)',
              background: 'var(--apex-surface)', color: 'var(--apex-text)', fontSize: 13
            }}
          />
          <button type="submit" disabled={loading} style={{
            padding: '10px 16px', borderRadius: 8, background: selectedAgent.color,
            color: '#000', border: 'none', cursor: 'pointer', fontWeight: 700
          }}>
            <Send size={16} />
          </button>
        </form>
      </div>
    </div>
  );
}
