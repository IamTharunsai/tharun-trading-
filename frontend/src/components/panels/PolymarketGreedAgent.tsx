/**
 * APEX — Polymarket Money Greed Agent Panel
 * ════════════════════════════════════════════
 * Toggle button UI for the self-surviving Polymarket trading agent.
 *
 * Features:
 * - ON/OFF toggle with greed mode selector
 * - Live P&L, win rate, exposure display
 * - Real-time open positions feed via WebSocket
 * - Daily stop-loss status indicator
 * - Trade counter (can reach 50k+ on high-activity days)
 */

import React, { useState, useEffect, useRef } from 'react';

interface GreedSnapshot {
  active: boolean;
  greedMode: boolean;
  startedAt: number | null;
  bankroll: number;
  totalExposure: number;
  exposurePct: number;
  dailyPnL: number;
  dailyPnLPct: number;
  totalProfit: number;
  tradesPlaced: number;
  tradesWon: number;
  tradesLost: number;
  winRate: number;
  currentPositions: number;
  scansCompleted: number;
  lastScanAt: number;
  bestEdgeFound: number;
  pausedUntil: number | null;
  isPaused: boolean;
  openPositions: Array<{
    question: string;
    side: 'YES' | 'NO';
    entryPrice: number;
    currentPrice: number;
    unrealizedPnL: number;
    costBasis: number;
    edgeAtEntry: number;
  }>;
}

const fmt = (n: number, d = 2) => n.toFixed(d);
const fmtPct = (n: number) => `${(n * 100).toFixed(1)}%`;
const fmtPnL = (n: number) => `${n >= 0 ? '+' : ''}$${fmt(n)}`;
const fmtK = (n: number) => n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n);

const PULSE_STYLE: React.CSSProperties = {
  display: 'inline-block',
  width: 8,
  height: 8,
  borderRadius: '50%',
  marginRight: 6,
};

export const PolymarketGreedAgent: React.FC = () => {
  const [snapshot, setSnapshot] = useState<GreedSnapshot | null>(null);
  const [loading, setLoading] = useState(false);
  const [greedMode, setGreedMode] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pulseFrame, setPulseFrame] = useState(0);
  const wsRef = useRef<WebSocket | null>(null);

  // Connect to WebSocket for live updates
  useEffect(() => {
    fetchSnapshot();

    const wsUrl = window.location.protocol === 'https:'
      ? `wss://${window.location.host}`
      : `ws://${window.location.host}`;

    try {
      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;

      ws.onmessage = (e) => {
        try {
          const msg = JSON.parse(e.data);
          if (msg.type === 'greed_agent_update' || msg.event === 'greed_agent_update') {
            setSnapshot(msg.data ?? msg);
          }
        } catch {}
      };

      ws.onerror = () => {}; // Silent — server may not have WebSocket yet
    } catch {}

    // Pulse animation
    const pulseTimer = setInterval(() => setPulseFrame(f => (f + 1) % 60), 100);

    return () => {
      wsRef.current?.close();
      clearInterval(pulseTimer);
    };
  }, []);

  async function fetchSnapshot() {
    try {
      const res = await fetch('/api/polymarket/greed/status');
      if (res.ok) setSnapshot(await res.json());
    } catch {}
  }

  async function toggleAgent() {
    if (!snapshot) return;
    setLoading(true);
    setError(null);
    try {
      if (snapshot.active) {
        const res = await fetch('/api/polymarket/greed', {
          method: 'DELETE',
          headers: { 'Content-Type': 'application/json' },
        });
        if (res.ok) setSnapshot(await res.json());
      } else {
        const res = await fetch('/api/polymarket/greed', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ active: true, greedMode }),
        });
        if (res.ok) {
          const data = await res.json();
          setSnapshot(data.state ?? data);
        }
      }
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  async function updateGreedMode(enabled: boolean) {
    setGreedMode(enabled);
    if (!snapshot?.active) return;
    try {
      await fetch('/api/polymarket/greed', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ active: true, greedMode: enabled }),
      });
    } catch {}
  }

  const isActive = snapshot?.active ?? false;
  const isGreed = snapshot?.greedMode ?? greedMode;
  const isPaused = snapshot?.isPaused ?? false;

  // Pulse color: green (active) → amber (paused) → gray (off)
  const pulseOpacity = 0.4 + 0.6 * Math.abs(Math.sin(pulseFrame * 0.2));
  const pulseColor = isPaused ? '#f59e0b' : isActive ? (isGreed ? '#ef4444' : '#22c55e') : '#6b7280';

  const dailyPnL = snapshot?.dailyPnL ?? 0;
  const totalProfit = snapshot?.totalProfit ?? 0;

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', gap: 10, fontSize: 12, userSelect: 'none' }}>

      {/* ── HEADER ── */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div style={{ display: 'flex', alignItems: 'center' }}>
          <span style={{
            ...PULSE_STYLE,
            background: pulseColor,
            opacity: isActive ? pulseOpacity : 0.4,
            boxShadow: isActive ? `0 0 6px ${pulseColor}` : 'none',
          }} />
          <span style={{ fontSize: 12, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: '#6b7280' }}>
            Polymarket Greed Agent
          </span>
        </div>
        <div style={{ fontSize: 10, color: isActive ? (isGreed ? '#ef4444' : '#22c55e') : '#6b7280', fontWeight: 700 }}>
          {isPaused ? '⏸ PAUSED' : isActive ? (isGreed ? '🔥 FULL GREED' : '⚡ ACTIVE') : '⏹ OFF'}
        </div>
      </div>

      {/* ── TOGGLE CONTROLS ── */}
      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        {/* Main ON/OFF toggle */}
        <button
          onClick={toggleAgent}
          disabled={loading}
          style={{
            flex: 1,
            padding: '10px 0',
            borderRadius: 8,
            border: 'none',
            cursor: loading ? 'wait' : 'pointer',
            fontWeight: 800,
            fontSize: 13,
            letterSpacing: '0.04em',
            transition: 'all 0.2s',
            background: isActive
              ? (isGreed ? 'linear-gradient(135deg, #dc2626, #991b1b)' : 'linear-gradient(135deg, #059669, #047857)')
              : 'linear-gradient(135deg, #1f2937, #374151)',
            color: isActive ? '#fff' : '#9ca3af',
            boxShadow: isActive && isGreed ? '0 0 16px rgba(239,68,68,0.4)' : isActive ? '0 0 10px rgba(34,197,94,0.3)' : 'none',
          }}
        >
          {loading ? '...' : isActive ? '■ STOP AGENT' : '▶ START AGENT'}
        </button>

        {/* Greed mode toggle */}
        <button
          onClick={() => updateGreedMode(!isGreed)}
          title="Full greed: min 1% edge, 800ms scan. Normal: 3% edge, 10s scan."
          style={{
            padding: '10px 12px',
            borderRadius: 8,
            border: `1px solid ${isGreed ? '#ef4444' : '#374151'}`,
            cursor: 'pointer',
            background: isGreed ? '#450a0a' : '#111827',
            color: isGreed ? '#f87171' : '#6b7280',
            fontSize: 16,
            transition: 'all 0.2s',
          }}
        >
          🔥
        </button>
      </div>

      {/* Mode description */}
      <div style={{
        padding: '6px 8px',
        borderRadius: 6,
        background: '#0f1117',
        fontSize: 10,
        color: '#6b7280',
        lineHeight: 1.4,
      }}>
        {isGreed
          ? '🔥 FULL GREED — Scans every 800ms · Min 1% edge · Up to 50 live positions · Max 40k–100k+ trades on event nights'
          : '⚡ NORMAL — Scans every 10s · Min 3% edge · Kelly-sized positions · Conservative autopilot'}
      </div>

      {/* ── STATS GRID ── */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
        {[
          { label: 'Bankroll', value: `$${fmt(snapshot?.bankroll ?? 0)}`, color: '#e5e7eb' },
          { label: 'Exposure', value: fmtPct(snapshot?.exposurePct ?? 0), color: (snapshot?.exposurePct ?? 0) > 0.5 ? '#f59e0b' : '#e5e7eb' },
          { label: 'Daily P&L', value: fmtPnL(dailyPnL), color: dailyPnL >= 0 ? '#22c55e' : '#ef4444' },
          { label: 'Total Profit', value: fmtPnL(totalProfit), color: totalProfit >= 0 ? '#22c55e' : '#ef4444' },
          { label: 'Trades', value: fmtK(snapshot?.tradesPlaced ?? 0), color: '#e5e7eb' },
          { label: 'Win Rate', value: fmtPct(snapshot?.winRate ?? 0), color: (snapshot?.winRate ?? 0) > 0.5 ? '#22c55e' : '#f59e0b' },
          { label: 'Open Positions', value: String(snapshot?.currentPositions ?? 0), color: '#818cf8' },
          { label: 'Best Edge', value: fmtPct(snapshot?.bestEdgeFound ?? 0), color: '#f59e0b' },
        ].map(({ label, value, color }) => (
          <div key={label} style={{ padding: '6px 8px', background: '#0f1117', borderRadius: 6 }}>
            <div style={{ fontSize: 9, color: '#6b7280', marginBottom: 2, textTransform: 'uppercase', letterSpacing: '0.05em' }}>{label}</div>
            <div style={{ fontSize: 13, fontWeight: 700, color, fontVariantNumeric: 'tabular-nums' }}>{value}</div>
          </div>
        ))}
      </div>

      {/* ── SCANS & ACTIVITY ── */}
      {isActive && (
        <div style={{ display: 'flex', gap: 10, fontSize: 10, color: '#4b5563' }}>
          <span>Scans: <strong style={{ color: '#9ca3af' }}>{fmtK(snapshot?.scansCompleted ?? 0)}</strong></span>
          <span>Last scan: <strong style={{ color: '#9ca3af' }}>
            {snapshot?.lastScanAt ? `${((Date.now() - snapshot.lastScanAt) / 1000).toFixed(1)}s ago` : '—'}
          </strong></span>
          <span>W/L: <strong style={{ color: '#22c55e' }}>{snapshot?.tradesWon ?? 0}</strong>/<strong style={{ color: '#ef4444' }}>{snapshot?.tradesLost ?? 0}</strong></span>
        </div>
      )}

      {/* ── PAUSED BANNER ── */}
      {isPaused && snapshot?.pausedUntil && (
        <div style={{
          padding: '8px 10px', borderRadius: 6,
          background: '#451a03', border: '1px solid #f59e0b',
          color: '#fcd34d', fontSize: 11,
        }}>
          ⚠️ Daily stop-loss triggered — resuming at {new Date(snapshot.pausedUntil).toLocaleTimeString()}
        </div>
      )}

      {/* ── OPEN POSITIONS FEED ── */}
      {(snapshot?.openPositions?.length ?? 0) > 0 && (
        <div style={{ flex: 1, overflowY: 'auto' }}>
          <div style={{ fontSize: 10, color: '#6b7280', marginBottom: 4, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
            Live Positions ({snapshot!.currentPositions})
          </div>
          {snapshot!.openPositions.map((p, i) => (
            <div key={i} style={{
              padding: '5px 8px',
              marginBottom: 4,
              borderRadius: 6,
              background: '#0f1117',
              borderLeft: `3px solid ${p.unrealizedPnL >= 0 ? '#22c55e' : '#ef4444'}`,
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 2 }}>
                <span style={{
                  fontSize: 9, fontWeight: 700, padding: '1px 5px', borderRadius: 3,
                  background: p.side === 'YES' ? '#14532d' : '#450a0a',
                  color: p.side === 'YES' ? '#4ade80' : '#f87171',
                }}>{p.side}</span>
                <span style={{ color: p.unrealizedPnL >= 0 ? '#22c55e' : '#ef4444', fontSize: 10, fontWeight: 700 }}>
                  {fmtPnL(p.unrealizedPnL)}
                </span>
              </div>
              <div style={{ fontSize: 10, color: '#9ca3af', lineHeight: 1.3 }}>{p.question}</div>
              <div style={{ fontSize: 9, color: '#4b5563', marginTop: 2 }}>
                Entry: {fmtPct(p.entryPrice)} → {fmtPct(p.currentPrice)} · Edge: {fmtPct(p.edgeAtEntry)} · Cost: ${fmt(p.costBasis)}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Error */}
      {error && (
        <div style={{ color: '#ef4444', fontSize: 10, padding: '4px 6px', background: '#1c0605', borderRadius: 4 }}>
          {error}
        </div>
      )}

      {/* Footer */}
      <div style={{ fontSize: 9, color: '#374151', textAlign: 'center' }}>
        Self-surviving · Kelly-sized · Auto stop-loss · {isGreed ? '800ms' : '10s'} scan
      </div>
    </div>
  );
};

export default PolymarketGreedAgent;
