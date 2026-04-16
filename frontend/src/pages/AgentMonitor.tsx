import { useState, useEffect } from 'react';
import axios from 'axios';
import { useStore } from '../store';

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

const AGENTS = [
  { id: 1, name: 'Technician', icon: '📊', color: '#2D8A4A' },
  { id: 2, name: 'Newshound', icon: '📰', color: '#FF8C42' },
  { id: 3, name: 'Sentiment', icon: '🧠', color: '#2D8A4A' },
  { id: 4, name: 'Fundamental', icon: '📈', color: '#FF8C42' },
  { id: 5, name: 'Risk Mgr', icon: '🛡️', color: '#DC2626' },
  { id: 6, name: 'Trend', icon: '🔮', color: '#2D8A4A' },
  { id: 7, name: 'Volume', icon: '🔍', color: '#FF8C42' },
  { id: 8, name: 'Whale', icon: '🐋', color: '#2D8A4A' },
  { id: 9, name: 'Macro', icon: '🌍', color: '#FF8C42' },
  { id: 10, name: 'Devil Adv', icon: '😈', color: '#DC2626' },
];

const ACTIVITY_ICONS = {
  'GATHERING': '📚',
  'LEARNING': '🧠',
  'ANALYZING': '🔍',
  'VOTING': '🗳️',
  'TRADING': '💰'
};

export default function AgentMonitorPage() {
  const token = useStore(s => s.token);
  const [activities, setActivities] = useState<AgentActivity[]>([]);
  const [selectedAgent, setSelectedAgent] = useState<number | null>(null);
  const [filterType, setFilterType] = useState<string>('ALL');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const pollActivities = async () => {
      try {
        setLoading(true);
        const params: any = {};
        if (filterType !== 'ALL') params.type = filterType;
        if (selectedAgent) params.agentId = selectedAgent;

        const response = await axios.get('/api/monitor/activities', {
          params,
          headers: { Authorization: `Bearer ${token}` }
        });

        setActivities(response.data.activities || []);
      } catch (err) {
        console.error('Failed to fetch activities', err);
      } finally {
        setLoading(false);
      }
    };

    pollActivities();
    const interval = setInterval(pollActivities, 2000); // Poll every 2 seconds
    return () => clearInterval(interval);
  }, [token, selectedAgent, filterType]);

  const getActivityColor = (type: string) => {
    switch (type) {
      case 'GATHERING': return '#FFA500';
      case 'LEARNING': return '#2D8A4A';
      case 'ANALYZING': return '#FF8C42';
      case 'VOTING': return '#FFD700';
      case 'TRADING': return '#DC2626';
      default: return '#666';
    }
  };

  const getImpactStyle = (impact: string) => {
    switch (impact) {
      case 'HIGH':
        return { background: '#FFE5E5', borderLeft: '4px solid #DC2626', color: '#DC2626' };
      case 'MEDIUM':
        return { background: '#FFF8E5', borderLeft: '4px solid #FF8C42', color: '#FF8C42' };
      case 'LOW':
        return { background: '#E5F3E8', borderLeft: '4px solid #2D8A4A', color: '#2D8A4A' };
      default:
        return {};
    }
  };

  return (
    <div style={{ padding: '20px', background: 'var(--apex-bg)', minHeight: '100vh' }}>
      {/* Header */}
      <div style={{ marginBottom: '30px' }}>
        <h1 style={{ fontFamily: 'Syne', fontSize: 28, fontWeight: 800, color: 'var(--apex-text)', marginBottom: 8 }}>
          🔍 Agent Activity Monitor
        </h1>
        <p style={{ fontFamily: 'Space Mono', fontSize: 12, color: 'var(--apex-muted)' }}>
          Real-time tracking of what all 10 agents are doing: gathering data, learning, analyzing, voting, and trading
        </p>
      </div>

      {/* Filters */}
      <div style={{ display: 'flex', gap: 12, marginBottom: 20, flexWrap: 'wrap' }}>
        {/* Activity Type Filter */}
        <div>
          <label style={{ fontSize: 11, color: 'var(--apex-muted)', display: 'block', marginBottom: 6 }}>
            FILTER BY TYPE
          </label>
          <select
            value={filterType}
            onChange={e => setFilterType(e.target.value)}
            style={{
              padding: '8px 12px',
              border: '1px solid var(--apex-border)',
              background: 'var(--apex-surface)',
              color: 'var(--apex-text)',
              borderRadius: 6,
              fontFamily: 'Space Mono',
              cursor: 'pointer'
            }}
          >
            <option value="ALL">All Activities</option>
            <option value="GATHERING">📚 Gathering</option>
            <option value="LEARNING">🧠 Learning</option>
            <option value="ANALYZING">🔍 Analyzing</option>
            <option value="VOTING">🗳️ Voting</option>
            <option value="TRADING">💰 Trading</option>
          </select>
        </div>

        {/* Agent Filter */}
        <div>
          <label style={{ fontSize: 11, color: 'var(--apex-muted)', display: 'block', marginBottom: 6 }}>
            FILTER BY AGENT
          </label>
          <select
            value={selectedAgent || ''}
            onChange={e => setSelectedAgent(e.target.value ? parseInt(e.target.value) : null)}
            style={{
              padding: '8px 12px',
              border: '1px solid var(--apex-border)',
              background: 'var(--apex-surface)',
              color: 'var(--apex-text)',
              borderRadius: 6,
              fontFamily: 'Space Mono',
              cursor: 'pointer'
            }}
          >
            <option value="">All Agents</option>
            {AGENTS.map(a => (
              <option key={a.id} value={a.id}>{a.icon} {a.name}</option>
            ))}
          </select>
        </div>

        {/* Live Indicator */}
        <div style={{ display: 'flex', alignItems: 'flex-end', gap: 8 }}>
          <div
            style={{
              width: 12,
              height: 12,
              borderRadius: '50%',
              background: '#2D8A4A',
              animation: 'pulse 1s infinite',
              marginBottom: 2
            }}
          />
          <span style={{ fontSize: 11, color: '#2D8A4A', fontFamily: 'Space Mono', fontWeight: 700 }}>
            LIVE
          </span>
        </div>
      </div>

      {/* Activity Count */}
      <div style={{
        background: 'var(--apex-surface)',
        border: '1px solid var(--apex-border)',
        borderRadius: 12,
        padding: 16,
        marginBottom: 20
      }}>
        <span style={{ fontFamily: 'Space Mono', fontSize: 12, color: 'var(--apex-muted)' }}>
          Total Activities:
        </span>
        <span style={{ fontFamily: 'Syne', fontSize: 20, fontWeight: 700, color: 'var(--apex-orange)', marginLeft: 8 }}>
          {activities.length}
        </span>
      </div>

      {/* Activities Feed */}
      <div style={{
        background: 'var(--apex-surface)',
        border: '1px solid var(--apex-border)',
        borderRadius: 12,
        overflow: 'hidden'
      }}>
        <div style={{ padding: '16px', borderBottom: '1px solid var(--apex-border)', fontFamily: 'Space Mono', fontSize: 11, fontWeight: 700, color: 'var(--apex-muted)' }}>
          LIVE AGENT ACTIVITIES
        </div>

        {loading && activities.length === 0 ? (
          <div style={{ padding: 40, textAlign: 'center', color: 'var(--apex-muted)' }}>
            Loading activities...
          </div>
        ) : activities.length === 0 ? (
          <div style={{ padding: 40, textAlign: 'center', color: 'var(--apex-muted)' }}>
            No activities yet. Waiting for agents to work...
          </div>
        ) : (
          <div style={{ maxHeight: '600px', overflowY: 'auto' }}>
            {activities.map((activity, idx) => {
              const agent = AGENTS.find(a => a.id === activity.agentId);
              return (
                <div
                  key={`${activity.timestamp}-${idx}`}
                  style={{
                    padding: 12,
                    borderBottom: '1px solid var(--apex-border)',
                    ...getImpactStyle(activity.impact || '')
                  }}
                >
                  {/* Header Row */}
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'start', marginBottom: 8 }}>
                    <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                      <span style={{ fontSize: 16 }}>{agent?.icon}</span>
                      <div>
                        <div style={{ fontFamily: 'Syne', fontSize: 12, fontWeight: 700, color: 'var(--apex-text)' }}>
                          {agent?.name}
                        </div>
                        <div style={{ fontFamily: 'Space Mono', fontSize: 10, color: 'var(--apex-muted)', marginTop: 2 }}>
                          {activity.source}
                        </div>
                      </div>
                    </div>
                    <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                      <span style={{
                        background: getActivityColor(activity.activityType),
                        color: 'white',
                        padding: '4px 8px',
                        borderRadius: 4,
                        fontFamily: 'Space Mono',
                        fontSize: 9,
                        fontWeight: 700
                      }}>
                        {(ACTIVITY_ICONS as any)[activity.activityType]} {activity.activityType}
                      </span>
                      {activity.confidence && (
                        <span style={{
                          background: 'rgba(0, 0, 0, 0.1)',
                          color: 'var(--apex-text)',
                          padding: '4px 8px',
                          borderRadius: 4,
                          fontFamily: 'Space Mono',
                          fontSize: 9
                        }}>
                          {(activity.confidence * 100).toFixed(0)}%
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Content */}
                  <div style={{
                    fontFamily: 'Space Mono',
                    fontSize: 11,
                    color: 'var(--apex-text)',
                    lineHeight: 1.5,
                    marginBottom: 8
                  }}>
                    {activity.content}
                  </div>

                  {/* Time */}
                  <div style={{ fontFamily: 'Space Mono', fontSize: 9, color: 'var(--apex-muted)' }}>
                    {new Date(activity.timestamp).toLocaleTimeString()}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
