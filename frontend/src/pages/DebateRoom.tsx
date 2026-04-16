import { useState, useEffect } from 'react';

const AGENTS = [
  { id: 1, name: 'Technician', icon: '📊' },
  { id: 2, name: 'Newshound', icon: '📰' },
  { id: 3, name: 'Sentiment', icon: '🧠' },
  { id: 4, name: 'Fundamental', icon: '📈' },
  { id: 5, name: 'Risk Mgr', icon: '🛡️', veto: true },
  { id: 6, name: 'Trend', icon: '🔮' },
  { id: 7, name: 'Volume', icon: '🔍' },
  { id: 8, name: 'Whale Watch', icon: '🐋' },
  { id: 9, name: 'Macro', icon: '🌍' },
  { id: 10, name: "Devil Adv", icon: '😈' },
];

export default function DebateRoomPage() {
  const [currentDebate, setCurrentDebate] = useState<any>(null);
  const [agentStates, setAgentStates] = useState<Record<number, any>>({});
  const [round, setRound] = useState(0);
  const [transcript, setTranscript] = useState<any[]>([]);
  const [finalDecision, setFinalDecision] = useState<any>(null);

  const isDebating = round > 0 && !finalDecision;
  const currentAsset = currentDebate?.asset || 'Waiting...';

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>

      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div>
          <h1 style={{ fontFamily: 'Syne', fontSize: 22, fontWeight: 800, color: 'var(--apex-text)', marginBottom: 4 }}>Investment Committee</h1>
          <p style={{ fontFamily: 'Space Mono', fontSize: 10, color: 'var(--apex-muted)' }}>3-round debate before every trade</p>
        </div>
        {isDebating && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 14px', borderRadius: 8, background: 'rgba(255,215,0,.1)', border: '1px solid rgba(255,215,0,.3)' }}>
            <div style={{ width: 8, height: 8, borderRadius: '50%', background: '#FFD700', animation: 'pulse 1s infinite' }} />
            <span style={{ fontFamily: 'Space Mono', fontSize: 10, color: '#FFD700', fontWeight: 700 }}>DEBATING — {currentAsset}</span>
          </div>
        )}
      </div>

      {/* Rounds Explanation */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10 }}>
        {[
          { round: 'Round 1', label: 'Opening Arguments', color: '#00D4FF' },
          { round: 'Round 2', label: 'Cross-Examination', color: '#FFD700' },
          { round: 'Round 3', label: 'Final Verdict', color: '#00FF88' },
        ].map(item => (
          <div key={item.round} style={{ background: 'var(--apex-card)', border: `1px solid ${item.color}40`, borderRadius: 10, padding: 14 }}>
            <div style={{ fontFamily: 'Space Mono', fontSize: 9, color: item.color, textTransform: 'uppercase', marginBottom: 4 }}>{item.round}</div>
            <div style={{ fontFamily: 'Syne', fontSize: 13, fontWeight: 700, color: 'var(--apex-text)' }}>{item.label}</div>
          </div>
        ))}
      </div>

      {/* 10 Agent Cards */}
      <div style={{ background: 'var(--apex-card)', border: '1px solid var(--apex-border)', borderRadius: 12, padding: 16 }}>
        <div style={{ fontFamily: 'Space Mono', fontSize: 11, fontWeight: 700, color: 'var(--apex-text)', marginBottom: 12 }}>AGENT COUNCIL</div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 8 }}>
          {AGENTS.map(agent => {
            const state = agentStates[agent.id];
            const borderColor = state?.finalVote === 'BUY' ? '#00FF88' :
              state?.finalVote === 'SELL' ? '#FF3B5C' :
              state?.status === 'analyzing' ? '#FFD700' : 'var(--apex-border)';
            return (
              <div key={agent.id} style={{ background: 'var(--apex-surface)', border: `1px solid ${borderColor}`, borderRadius: 8, padding: 10 }}>
                <div style={{ fontSize: 20, marginBottom: 4 }}>{agent.icon}</div>
                <div style={{ fontFamily: 'Syne', fontSize: 10, fontWeight: 700, color: 'var(--apex-text)', marginBottom: 2 }}>{agent.name}</div>
                {agent.veto && <div style={{ fontFamily: 'Space Mono', fontSize: 8, color: '#FF3B5C', marginBottom: 4 }}>⚡ VETO</div>}
                <div style={{ fontFamily: 'Space Mono', fontSize: 9, color: borderColor, fontWeight: 700 }}>
                  {state?.finalVote || state?.status || 'IDLE'}
                </div>
                {state?.confidence && (
                  <div style={{ marginTop: 4, height: 2, background: 'var(--apex-border)', borderRadius: 1, overflow: 'hidden' }}>
                    <div style={{ height: '100%', width: `${state.confidence}%`, background: borderColor }} />
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Transcript and Decision */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        {/* Transcript */}
        <div style={{ background: 'var(--apex-card)', border: '1px solid var(--apex-border)', borderRadius: 12, padding: 14 }}>
          <div style={{ fontFamily: 'Space Mono', fontSize: 11, fontWeight: 700, color: 'var(--apex-text)', marginBottom: 12 }}>TRANSCRIPT</div>
          <div style={{ maxHeight: 300, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 8 }}>
            {transcript.length === 0 ? (
              <div style={{ textAlign: 'center', padding: 40, fontFamily: 'Space Mono', fontSize: 10, color: 'var(--apex-muted)' }}>
                Debate appears here live.
              </div>
            ) : (
              transcript.map((item, i) => (
                <div key={i} style={{ padding: 8, background: 'var(--apex-surface)', borderRadius: 6, fontSize: 10 }}>
                  <div style={{ color: 'var(--apex-accent)', fontWeight: 700 }}>{item.agentName}</div>
                  <div style={{ color: 'var(--apex-text)', marginTop: 2 }}>{item.content?.slice(0, 100)}...</div>
                </div>
              ))
            )}
          </div>
        </div>

        {/* Final Decision */}
        <div style={{ background: 'var(--apex-card)', border: '1px solid var(--apex-border)', borderRadius: 12, padding: 14 }}>
          <div style={{ fontFamily: 'Space Mono', fontSize: 11, fontWeight: 700, color: 'var(--apex-text)', marginBottom: 12 }}>FINAL DECISION</div>
          {finalDecision ? (
            <div>
              <div style={{ fontSize: 28, fontWeight: 800, color: finalDecision === 'BUY' ? '#00FF88' : finalDecision === 'SELL' ? '#FF3B5C' : '#FFD700', marginBottom: 12 }}>
                {finalDecision}
              </div>
              <div style={{ fontSize: 12, color: 'var(--apex-text)', lineHeight: 1.6 }}>
                {finalDecision === 'BUY' && 'Trading signal: BUY. Position size calculated via Kelly Criterion.'}
                {finalDecision === 'SELL' && 'Trading signal: SELL. Position size calculated via Kelly Criterion.'}
                {finalDecision === 'HOLD' && 'No trade executed. Consensus was unclear or risks too high.'}
              </div>
            </div>
          ) : (
            <div style={{ textAlign: 'center', padding: 40, fontFamily: 'Space Mono', fontSize: 10, color: 'var(--apex-muted)' }}>
              Committee comes to decision here.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
