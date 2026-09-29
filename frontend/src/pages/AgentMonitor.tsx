import { useState, useEffect, useRef } from 'react';
import axios from 'axios';
import { useStore } from '../store';
import { connectSocket } from '../services/socket';

interface AgentActivity {
  timestamp: number;
  agentId: number;
  agentName: string;
  activityType: 'GATHERING' | 'LEARNING' | 'ANALYZING' | 'VOTING' | 'TRADING';
  source?: string;
  content: string;
  confidence?: number;
  impact?: 'HIGH' | 'MEDIUM' | 'LOW';
}

const AGENTS: Record<number, { name: string; icon: string }> = {
  1:  { name: 'Technician',       icon: '📊' },
  2:  { name: 'Newshound',        icon: '📰' },
  3:  { name: 'Sentiment',        icon: '🧠' },
  4:  { name: 'Fundamental',      icon: '📈' },
  5:  { name: 'Risk Mgr',         icon: '🛡️' },
  6:  { name: 'Trend',            icon: '🔮' },
  7:  { name: 'Volume',           icon: '🔍' },
  8:  { name: 'Whale Watch',      icon: '🐋' },
  9:  { name: 'Macro',            icon: '🌍' },
  10: { name: "Devil's Adv",      icon: '😈' },
  11: { name: 'Elliott Wave',     icon: '🌊' },
  12: { name: 'Options Flow',     icon: '📉' },
  13: { name: 'Arbitrageur',      icon: '⚖️' },
  14: { name: 'Quant Forecaster', icon: '🎯' },
};

const TYPE_COLOR: Record<string, string> = {
  GATHERING: '#FFA500',
  LEARNING:  '#12805F',
  ANALYZING: '#C9A24B',
  VOTING:    '#4A90D9',
  TRADING:   '#B0263B',
};

const TYPE_ICON: Record<string, string> = {
  GATHERING: '📚',
  LEARNING:  '🧠',
  ANALYZING: '🔍',
  VOTING:    '🗳️',
  TRADING:   '💰',
};

/** A vote whose reason is just "Error" (failed LLM call) is not a real vote. */
function isErrorActivity(a: AgentActivity): boolean {
  if (a.activityType !== 'VOTING') return false;
  const c = String(a.content || '');
  return /(—|-)\s*Error\s*$/i.test(c) || /\b(provider error|llm (call )?failed|api error)\b/i.test(c) || (/^(FINAL: )?(Vote: )?(BUY|SELL|HOLD)\b/.test(c) && !a.confidence && /—\s*$/.test(c));
}

export default function AgentMonitorPage() {
  const token = useStore(s => s.token);
  const baseUrl = (import.meta.env.VITE_API_URL as string) || '';
  const [activities, setActivities] = useState<AgentActivity[]>([]);
  const [status, setStatus]   = useState<any>(null);
  const [filterType, setFilterType] = useState('ALL');
  const [filterAgent, setFilterAgent] = useState(0);
  const [live, setLive] = useState(true);
  const feedRef = useRef<HTMLDivElement>(null);

  // Load DB-backed recent votes on mount
  useEffect(() => {
    const fetchHistory = async () => {
      try {
        const [actRes, statusRes] = await Promise.all([
          axios.get(`${baseUrl}/api/monitor/recent-decisions`, { headers: { Authorization: `Bearer ${token}` } }),
          axios.get(`${baseUrl}/api/monitor/status`,           { headers: { Authorization: `Bearer ${token}` } }),
        ]);
        setActivities(Array.isArray(actRes.data?.activities) ? actRes.data.activities : []);
        setStatus(statusRes.data);
      } catch (err) {
        console.error('Failed to load activity history', err);
      }
    };
    fetchHistory();
    const interval = setInterval(fetchHistory, 15000);
    return () => clearInterval(interval);
  }, [token, baseUrl]);

  // Live WebSocket feed — appends new vote events in real time
  useEffect(() => {
    if (!live) return;
    const socket = connectSocket();
    const onVoting = (data: any) => {
      setActivities(prev => [{
        timestamp: data.timestamp || Date.now(),
        agentId: data.agentId,
        agentName: data.agentName,
        activityType: 'VOTING' as const,
        source: data.source,
        content: data.content,
        confidence: data.confidence,
        impact: data.impact,
      }, ...prev].slice(0, 200));
      if (feedRef.current) feedRef.current.scrollTop = 0;
    };
    const onAgentVoted = (data: any) => {
      setActivities(prev => [{
        timestamp: Date.now(),
        agentId: data.agentId,
        agentName: data.agentName || AGENTS[data.agentId]?.name || `Agent ${data.agentId}`,
        activityType: 'VOTING' as const,
        source: data.asset ? `${data.asset} — Round 1` : 'Debate',
        content: `${data.vote || data.finalVote} (${data.confidence ?? '—'}%) — ${(data.openingArgument || '').slice(0, 200)}`,
        confidence: data.confidence != null ? data.confidence / 100 : undefined,
        impact: ((data.confidence || 0) >= 75 ? 'HIGH' : 'MEDIUM') as 'HIGH' | 'MEDIUM' | 'LOW',
      }, ...prev].slice(0, 200));
    };
    const onFinalVote = (data: any) => {
      setActivities(prev => [{
        timestamp: Date.now(),
        agentId: data.agentId,
        agentName: data.agentName || AGENTS[data.agentId]?.name || `Agent ${data.agentId}`,
        activityType: 'VOTING' as const,
        source: 'Final Vote — Round 3',
        content: `FINAL: ${data.finalVote} (${data.confidence ?? '—'}%) — ${(data.finalReason || '').slice(0, 200)}`,
        confidence: data.confidence != null ? data.confidence / 100 : undefined,
        impact: ((data.confidence || 0) >= 75 ? 'HIGH' : 'MEDIUM') as 'HIGH' | 'MEDIUM' | 'LOW',
      }, ...prev].slice(0, 200));
    };
    const onTradeExecuted = (data: any) => {
      setActivities(prev => [{
        timestamp: Date.now(),
        agentId: 0,
        agentName: 'Execution Engine',
        activityType: 'TRADING' as const,
        source: 'Trade Executed',
        content: `${data.trade?.type ?? '—'} ${data.trade?.asset ?? '—'} @ ${typeof data.trade?.entryPrice === 'number' ? `$${data.trade.entryPrice.toFixed(2)}` : '—'} [${String(data.mode || '—').toUpperCase()}]`,
        impact: 'HIGH' as const,
      }, ...prev].slice(0, 200));
    };

    socket.on('agent:voting', onVoting);
    socket.on('debate:agent-voted', onAgentVoted);
    socket.on('debate:final-vote', onFinalVote);
    socket.on('trade:executed', onTradeExecuted);
    return () => {
      socket.off('agent:voting', onVoting);
      socket.off('debate:agent-voted', onAgentVoted);
      socket.off('debate:final-vote', onFinalVote);
      socket.off('trade:executed', onTradeExecuted);
    };
  }, [live]);

  const filtered = activities.filter(a => {
    if (filterType !== 'ALL' && a.activityType !== filterType) return false;
    if (filterAgent && a.agentId !== filterAgent) return false;
    return true;
  });

  const impactStyle = (impact?: string) => {
    if (impact === 'HIGH')   return { background: '#FFF0F0', borderLeft: '3px solid #B0263B' };
    if (impact === 'MEDIUM') return { background: '#FFFBF0', borderLeft: '3px solid #C9A24B' };
    return { borderLeft: '3px solid #DCDFE6' };
  };

  return (
    <div style={{ padding: 20, minHeight: '100vh' }}>

      {/* Header */}
      <div style={{ marginBottom: 20 }}>
        <h1 style={{ fontFamily: 'Inter', fontSize: 24, fontWeight: 800, color: 'var(--apex-text)', marginBottom: 6 }}>
          🔍 Agent Activity Monitor
        </h1>
        <p style={{ fontFamily: 'JetBrains Mono', fontSize: 11, color: 'var(--apex-muted)' }}>
          Real-time feed of all 14 agents — votes, analysis, trades
        </p>
      </div>

      {/* System Status */}
      {status && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 10, marginBottom: 20 }}>
          {[
            { label: 'Open Positions', value: status.openPositions },
            { label: 'Trades Today',   value: status.todayTrades },
            { label: 'Debates (2h)',   value: status.recentDebates },
            { label: 'Uptime',         value: Number.isFinite(Number(status.uptime)) ? `${Math.floor(Number(status.uptime) / 60)}m` : '—' },
          ].map(s => (
            <div key={s.label} style={{ background: 'var(--apex-surface)', border: '1px solid var(--apex-border)', borderRadius: 10, padding: 14 }}>
              <div style={{ fontFamily: 'JetBrains Mono', fontSize: 9, color: 'var(--apex-muted)', marginBottom: 4 }}>{s.label.toUpperCase()}</div>
              <div style={{ fontFamily: 'Inter', fontSize: 22, fontWeight: 700, color: 'var(--apex-accent)' }}>{s.value ?? '—'}</div>
            </div>
          ))}
        </div>
      )}

      {/* Filters */}
      <div style={{ display: 'flex', gap: 10, marginBottom: 16, flexWrap: 'wrap', alignItems: 'center' }}>
        <select data-testid="monitor-filter-type" value={filterType} onChange={e => setFilterType(e.target.value)}
          style={{ padding: '7px 10px', border: '1px solid var(--apex-border)', background: 'var(--apex-surface)', color: 'var(--apex-text)', borderRadius: 6, fontFamily: 'JetBrains Mono', fontSize: 10 }}>
          <option value="ALL">All Types</option>
          {['GATHERING','LEARNING','ANALYZING','VOTING','TRADING'].map(t => (
            <option key={t} value={t}>{TYPE_ICON[t]} {t}</option>
          ))}
        </select>

        <select data-testid="monitor-filter-agent" value={filterAgent} onChange={e => setFilterAgent(parseInt(e.target.value))}
          style={{ padding: '7px 10px', border: '1px solid var(--apex-border)', background: 'var(--apex-surface)', color: 'var(--apex-text)', borderRadius: 6, fontFamily: 'JetBrains Mono', fontSize: 10 }}>
          <option value={0}>All Agents</option>
          {Object.entries(AGENTS).map(([id, a]) => (
            <option key={id} value={id}>{a.icon} {a.name}</option>
          ))}
        </select>

        <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontFamily: 'JetBrains Mono', fontSize: 10, color: 'var(--apex-text)', cursor: 'pointer' }}>
          <input type="checkbox" checked={live} onChange={e => setLive(e.target.checked)} />
          Live WebSocket
          {live && <span style={{ width: 7, height: 7, borderRadius: '50%', background: '#12805F', display: 'inline-block', animation: 'pulse 1s infinite' }} />}
        </label>

        <span style={{ fontFamily: 'JetBrains Mono', fontSize: 10, color: 'var(--apex-muted)', marginLeft: 'auto' }}>
          {filtered.length} entries
        </span>
      </div>

      {/* Activity Feed */}
      <div ref={feedRef} style={{ background: 'var(--apex-surface)', border: '1px solid var(--apex-border)', borderRadius: 12, overflow: 'hidden', maxHeight: 600, overflowY: 'auto' }}>
        <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--apex-border)', fontFamily: 'JetBrains Mono', fontSize: 10, fontWeight: 700, color: 'var(--apex-muted)', position: 'sticky', top: 0, background: 'var(--apex-surface)' }}>
          LIVE AGENT ACTIVITIES
        </div>

        {filtered.length === 0 ? (
          <div style={{ padding: 40, textAlign: 'center' }}>
            <div style={{ fontSize: 32, marginBottom: 12 }}>🤖</div>
            <div style={{ fontFamily: 'JetBrains Mono', fontSize: 11, color: 'var(--apex-muted)' }}>
              No activities yet — go to Agent Council and click DEBATE to start
            </div>
          </div>
        ) : (
          filtered.map((activity, idx) => {
            const agent = AGENTS[activity.agentId];
            const errored = isErrorActivity(activity);
            return (
              <div key={`${activity.timestamp}-${idx}`} data-testid="monitor-activity" style={{
                padding: '10px 14px', borderBottom: '1px solid var(--apex-border)',
                ...impactStyle(activity.impact)
              }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 4 }}>
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                    <span style={{ fontSize: 15 }}>{agent?.icon || '🤖'}</span>
                    <div>
                      <span style={{ fontFamily: 'Inter', fontSize: 11, fontWeight: 700, color: 'var(--apex-text)' }}>
                        {agent?.name || activity.agentName}
                      </span>
                      {activity.source && (
                        <span style={{ fontFamily: 'JetBrains Mono', fontSize: 9, color: 'var(--apex-muted)', marginLeft: 6 }}>
                          {activity.source}
                        </span>
                      )}
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                    <span style={{
                      background: TYPE_COLOR[activity.activityType] || '#888',
                      color: '#fff', padding: '2px 7px', borderRadius: 4,
                      fontFamily: 'JetBrains Mono', fontSize: 8, fontWeight: 700
                    }}>
                      {TYPE_ICON[activity.activityType]} {activity.activityType}
                    </span>
                    {errored && (
                      <span data-testid="activity-provider-error" style={{ background: '#FEE2E2', color: '#B91C1C', border: '1px solid #FCA5A5', padding: '2px 7px', borderRadius: 4, fontFamily: 'JetBrains Mono', fontSize: 8, fontWeight: 700 }}>
                        AI provider error — no real vote
                      </span>
                    )}
                    {!errored && activity.confidence != null && (
                      <span style={{ fontFamily: 'JetBrains Mono', fontSize: 9, color: 'var(--apex-muted)' }}>
                        {(activity.confidence * 100).toFixed(0)}%
                      </span>
                    )}
                    <span style={{ fontFamily: 'JetBrains Mono', fontSize: 8, color: 'var(--apex-muted)' }}>
                      {Number.isFinite(new Date(activity.timestamp).getTime()) ? new Date(activity.timestamp).toLocaleTimeString() : '—'}
                    </span>
                  </div>
                </div>
                <div style={{ fontFamily: 'JetBrains Mono', fontSize: 10, color: errored ? '#B91C1C' : 'var(--apex-text)', lineHeight: 1.5 }}>
                  {errored ? 'The AI provider call failed for this agent; the recorded HOLD is a placeholder, not an opinion.' : activity.content}
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
