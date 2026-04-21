import { io, Socket } from 'socket.io-client';
import toast from 'react-hot-toast';
import { useStore } from '../store';

let socket: Socket | null = null;

export function connectSocket() {
  if (socket?.connected) return socket;

  socket = io(import.meta.env.VITE_API_URL || '/', {
    transports: ['websocket', 'polling'],
    reconnection: true,
    reconnectionDelay: 2000,
    reconnectionAttempts: 10,
  });

  const store = useStore.getState();

  socket.on('connect', () => {
    console.log('🔌 Socket connected');
  });

  socket.on('disconnect', () => {
    console.log('🔌 Socket disconnected');
  });

  // ── REAL-TIME PRICE UPDATES ──────────────────────────────────────────────────
  socket.on('price:update', (data: any) => {
    store.updatePrice(data);
  });

  // ── DEBATE ENGINE EVENTS (debateEngine.ts emits these) ───────────────────────
  socket.on('debate:start', (data: any) => {
    store.resetCouncil();
    store.setCurrentAnalysis(data.asset);
    // Mark all 13 agents as analyzing
    for (let i = 1; i <= 13; i++) {
      store.updateAgentStatus(i, 'analyzing', undefined, data.asset);
    }
  });

  socket.on('debate:agent-speaking', (data: any) => {
    store.updateAgentStatus(data.agentId, 'analyzing', undefined, data.asset || store.currentAnalysis || '');
  });

  socket.on('debate:agent-voted', (data: any) => {
    store.updateAgentStatus(data.agentId, 'voted', {
      agentId: data.agentId,
      agentName: data.agentName,
      vote: data.vote || data.finalVote,
      confidence: data.confidence,
      reasoning: data.openingArgument || data.argument || '',
    }, store.currentAnalysis || '');
  });

  socket.on('debate:final-vote', (data: any) => {
    store.updateAgentStatus(data.agentId, 'voted', {
      agentId: data.agentId,
      agentName: data.agentName,
      vote: data.finalVote,
      confidence: data.confidence,
      reasoning: data.finalReason || '',
    }, store.currentAnalysis || '');
  });

  socket.on('debate:complete', (data: any) => {
    store.setCurrentAnalysis(null);
    const t = data.transcript;
    if (t) {
      const buyCount  = t.round3?.filter((v: any) => v.finalVote === 'BUY').length  || 0;
      const sellCount = t.round3?.filter((v: any) => v.finalVote === 'SELL').length || 0;
      if (t.executionApproved) {
        toast.success(`🤖 COMMITTEE: ${t.finalDecision} ${t.asset} — executing trade!`, { duration: 6000 });
      } else {
        toast(`🏛️ ${t.asset}: ${t.finalDecision} (${buyCount}B/${sellCount}S) — ${t.blockReason || 'held'}`, { duration: 5000 });
      }
    }
  });

  // ── LEGACY ORCHESTRATOR EVENTS (kept for compatibility) ──────────────────────
  socket.on('council:start', (data: any) => {
    store.resetCouncil();
    store.setCurrentAnalysis(data.asset);
    for (let i = 1; i <= 13; i++) {
      store.updateAgentStatus(i, 'analyzing', undefined, data.asset);
    }
  });

  socket.on('agent:status', (data: any) => {
    store.updateAgentStatus(data.agentId, data.status, data.vote, data.asset);
  });

  socket.on('council:complete', (data: any) => {
    store.setCurrentAnalysis(null);
    const { result } = data;
    if (result?.shouldExecute) {
      toast.success(`🤖 Council VOTED ${result.finalDecision} for ${result.asset}`, { duration: 5000 });
    }
  });

  // ── TRADE EVENTS ─────────────────────────────────────────────────────────────
  socket.on('trade:executed', (data: any) => {
    store.addTrade(data.trade);
    const isPaper = data.mode === 'paper';
    const trade = data.trade;
    toast.success(
      `${isPaper ? '📄' : '💰'} ${trade.type} ${trade.asset} @ $${trade.entryPrice?.toFixed(2)}`,
      { duration: 6000 }
    );
  });

  socket.on('position:closed', (data: any) => {
    const pnlStr = data.pnl >= 0 ? `+$${data.pnl.toFixed(2)}` : `-$${Math.abs(data.pnl).toFixed(2)}`;
    const icon = data.reason === 'stop_loss' ? '🛑' : data.reason === 'take_profit' ? '🎯' : '✅';
    toast(`${icon} ${data.asset} closed: ${pnlStr} (${data.reason.replace('_', ' ')})`, {
      duration: 6000,
      style: { borderLeft: `3px solid ${data.pnl >= 0 ? '#2D8A4A' : '#DC2626'}` }
    });
  });

  // ── GUARDRAIL / KILL SWITCH ───────────────────────────────────────────────────
  socket.on('guardrail:triggered', (data: any) => {
    toast.error(`⚠️ GUARDRAIL: ${data.rule} triggered`, { duration: 8000 });
  });

  socket.on('kill:switch:activated', () => {
    store.setKillSwitch(true);
    toast.error('🔴 KILL SWITCH ACTIVATED — All trading halted', { duration: 0 });
  });

  socket.on('kill:switch:deactivated', () => {
    store.setKillSwitch(false);
    toast.success('🟢 Kill switch deactivated — Trading resumed', { duration: 5000 });
  });

  return socket;
}

export function getSocket() { return socket; }

export function disconnectSocket() {
  socket?.disconnect();
  socket = null;
}
