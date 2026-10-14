import { io, Socket } from 'socket.io-client';
import toast from 'react-hot-toast';
import { useStore } from '../store';

let socket: Socket | null = null;
let recoveryNeeded = false;

export function connectSocket() {
  if (socket) {
    if (recoveryNeeded || !socket.active) {
      recoveryNeeded = false;
      useStore.getState().setSocketStatus('connecting');
      socket.connect();
    }
    return socket;
  }

  socket = io(import.meta.env.VITE_API_URL || '/', {
    transports: ['websocket', 'polling'],
    reconnection: true,
    reconnectionDelay: 2000,
    reconnectionAttempts: 10,
    // Server rejects unauthenticated sockets.
    auth: (cb: (data: object) => void) => cb({ token: useStore.getState().token }),
  });

  const store = useStore.getState();
  const observingToken = store.token;
  store.setSocketStatus('connecting');

  socket.on('connect', () => {
    recoveryNeeded = false;
    store.setSocketStatus('connected');
  });

  socket.on('disconnect', () => {
    store.setSocketStatus('disconnected');
  });

  socket.on('connect_error', () => {
    if (socket && !socket.active) recoveryNeeded = true;
    store.setSocketStatus('error');
  });
  socket.io.on('reconnect_failed', () => {
    recoveryNeeded = true;
    store.setSocketStatus('error');
  });

  // ── REAL-TIME PRICE UPDATES ──────────────────────────────────────────────────
  socket.on('price:update', (data: any) => {
    store.updatePrice(data);
  });

  // Session IDs preserve simultaneous stock, crypto and position-review debates.
  for (const event of ['debate:start', 'debate:round', 'debate:agent-speaking',
    'debate:agent-voted', 'debate:cross-examination', 'debate:final-vote',
    'debate:master-thinking', 'debate:complete']) {
    socket.on(event, (data: unknown) => {
      if (observingToken && useStore.getState().token === observingToken) store.receiveDebateEvent(event, data);
    });
  }
  socket.on('debate:complete', (data: any) => {
    const transcript = data?.transcript;
    if (!transcript) return;
    const asset = typeof transcript.asset === 'string' ? transcript.asset : 'Unknown asset';
    const decision = typeof transcript.finalDecision === 'string' ? transcript.finalDecision : 'Unknown';
    if (transcript.executionApproved === true) {
      toast(`${asset}: ${decision} approved by committee. Broker execution is not confirmed.`, { duration: 6000 });
    } else {
      toast(`${asset}: ${decision} — ${transcript.blockReason || 'No execution approval'}`, { duration: 5000 });
    }
  });
  // ── LEGACY ORCHESTRATOR EVENTS (kept for compatibility) ──────────────────────
  socket.on('council:start', (data: any) => {
    store.resetCouncil();
    store.setCurrentAnalysis(data.asset);
    for (let i = 1; i <= 14; i++) {
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
    const pnlColor = data.pnl >= 0 ? '#12805F' : '#B0263B';
    toast(`${icon} ${data.asset} closed: ${pnlStr} (${data.reason.replace('_', ' ')})`, {
      duration: 6000,
      style: { border: `1px solid ${pnlColor}`, background: `${pnlColor}0F` }
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
  socket?.removeAllListeners();
  socket = null;
  recoveryNeeded = false;
  useStore.getState().setSocketStatus('disconnected');
}
