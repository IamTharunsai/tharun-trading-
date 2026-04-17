import React, { useState, useEffect, useRef } from 'react';
import { MessageCircle, Send, X, Loader } from 'lucide-react';
import axios from 'axios';

interface Message {
  role: 'user' | 'agent';
  content: string;
  timestamp: string;
}

interface AgentChatProps {
  agentId: string;
  agentName: string;
  onClose: () => void;
  token: string;
}

export default function AgentChat({ agentId, agentName, onClose, token }: AgentChatProps) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [inputValue, setInputValue] = useState('');
  const [loading, setLoading] = useState(false);
  const [loadingHistory, setLoadingHistory] = useState(true);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Load chat history on mount
  useEffect(() => {
    const loadHistory = async () => {
      try {
        const response = await axios.get(
          `/api/chat/${agentId}/history?limit=10`,
          { headers: { Authorization: `Bearer ${token}` } }
        );

        if (response.data.history) {
          const formattedMessages: Message[] = response.data.history.flatMap((conv: any) => [
            {
              role: 'user' as const,
              content: conv.userMessage,
              timestamp: new Date(conv.timestamp).toLocaleTimeString()
            },
            {
              role: 'agent' as const,
              content: conv.agentResponse,
              timestamp: new Date(conv.timestamp).toLocaleTimeString()
            }
          ]);
          setMessages(formattedMessages);
        }
      } catch (error) {
        console.error('Failed to load chat history:', error);
      } finally {
        setLoadingHistory(false);
      }
    };

    loadHistory();
  }, [agentId, token]);

  // Auto-scroll to newest message
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const handleSendMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!inputValue.trim() || loading) return;

    const userMessage = inputValue.trim();
    setInputValue('');
    setLoading(true);

    // Add user message to UI immediately
    setMessages(prev => [
      ...prev,
      {
        role: 'user',
        content: userMessage,
        timestamp: new Date().toLocaleTimeString()
      }
    ]);

    try {
      const response = await axios.post(
        `/api/chat/${agentId}`,
        { message: userMessage },
        { headers: { Authorization: `Bearer ${token}` } }
      );

      const reply = response.data.reply || response.data.agentResponse || '';
      if (reply) {
        setMessages(prev => [
          ...prev,
          {
            role: 'agent',
            content: reply,
            timestamp: new Date().toLocaleTimeString()
          }
        ]);
      }
    } catch (error) {
      console.error('Failed to send message:', error);
      setMessages(prev => [
        ...prev,
        {
          role: 'agent',
          content: 'Sorry, I encountered an error processing your message. Please try again.',
          timestamp: new Date().toLocaleTimeString()
        }
      ]);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed bottom-4 right-4 w-96 h-96 bg-apex-card border border-apex-border rounded-xl flex flex-col shadow-2xl z-50">
      {/* Header */}
      <div className="flex items-center justify-between p-4 border-b border-apex-border bg-apex-surface rounded-t-xl">
        <div className="flex items-center gap-2">
          <MessageCircle size={18} className="text-apex-accent" />
          <div>
            <div className="font-sans font-semibold text-apex-text">{agentName}</div>
            <div className="font-mono text-xs text-apex-muted">Always online • Ask anything</div>
          </div>
        </div>
        <button onClick={onClose} className="text-apex-muted hover:text-apex-red transition" aria-label="Close chat">
          <X size={18} />
        </button>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-4 space-y-3">
        {loadingHistory ? (
          <div className="flex items-center justify-center h-full">
            <Loader size={20} className="text-apex-accent animate-spin" />
          </div>
        ) : messages.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-center">
            <MessageCircle size={32} className="mb-2 text-apex-muted opacity-50" />
            <p className="font-mono text-sm text-apex-muted">No previous conversations yet.</p>
            <p className="font-mono text-xs text-apex-muted mt-1">Ask {agentName} a question!</p>
          </div>
        ) : (
          messages.map((msg, idx) => (
            <div key={idx} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
              <div className={`max-w-xs px-3 py-2 rounded-lg text-sm font-mono ${
                msg.role === 'user'
                  ? 'bg-apex-accent text-white'
                  : 'bg-apex-surface border border-apex-border text-apex-text'
              }`}>
                <p className="break-words">{msg.content}</p>
                <p className="text-xs mt-1 opacity-60">{msg.timestamp}</p>
              </div>
            </div>
          ))
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Input */}
      <form onSubmit={handleSendMessage} className="p-3 border-t border-apex-border">
        <div className="flex gap-2">
          <input
            type="text"
            value={inputValue}
            onChange={e => setInputValue(e.target.value)}
            placeholder="Ask something..."
            disabled={loading}
            className="flex-1 px-3 py-2 bg-apex-surface border border-apex-border rounded-lg font-mono text-sm text-apex-text placeholder-apex-muted focus:outline-none focus:border-apex-accent disabled:opacity-50"
          />
          <button
            type="submit"
            disabled={!inputValue.trim() || loading}
            className="px-3 py-2 bg-apex-accent text-white rounded-lg hover:bg-apex-accent/90 disabled:opacity-50 transition flex items-center gap-1"
          >
            {loading ? <Loader size={14} className="animate-spin" /> : <Send size={14} />}
          </button>
        </div>
      </form>
    </div>
  );
}
