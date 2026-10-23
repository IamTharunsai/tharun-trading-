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

  // ── SOCKET CONTRACT ─────────────────────────────────────────────────────────
  // Mirror of backend/src/websocket/socketEvents.ts: every listener below
  // has a real backend producer. Listeners whose events were never emitted
  // (council:start, council:complete, position:closed, guardrail:triggered)
  // were removed — do not add a listener without a producer in that file.

  // ── REAL-TIME PRICE UPDATES ──────────────────────────────────────────────────
  socket.on('price:update', (data: any) => {
    store.updatePrice(data);
  });

  // Session IDs preserve simultaneous stock, crypto and position-review debates.
  // debate:complete is deliberately NOT in this loop — it has a single
  // dedicated registration below (it used to be registered twice).
  for (const event of ['debate:start', 'debate:round', 'debate:agent-speaking',
    'debate:agent-voted', 'debate:cross-examination', 'debate:final-vote',
    'debate:master-thinking', 'debate:error', 'debate:agent-error']) {
    socket.on(event, (data: unknown) => {
      if (observingToken && useStore.getState().token === observingToken) store.receiveDebateEvent(event, data);
      // Only a fatal debate error is user-visible; non-fatal ones are
      // routine single-stage fallbacks the committee recovers from.
      if (event === 'debate:error' && (data as any)?.fatal) {
        toast.error('Committee session failed — see the debate panel for details', { duration: 6000 });
      }
    });
  }
  socket.on('debate:complete', (data: any) => {
    if (observingToken && useStore.getState().token === observingToken) store.receiveDebateEvent('debate:complete', data);
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

  // ── AGENT ACTIVITY ───────────────────────────────────────────────────────────
  // The backend unifies every activity kind (gathering / learning /
  // analyzing / voting / trading) into this one event; activityType
  // discriminates. (The old council:start / council:complete listeners were
  // legacy orchestrator events nothing ever emitted — the debate family
  // above is the real council lifecycle and already drives the store.)
  socket.on('agent:status', (data: any) => {
    const status = data.activityType === 'VOTING' ? 'voted' : 'analyzing';
    const vote = data.activityType === 'VOTING' && data.vote
      ? { agentId: data.agentId, agentName: data.agentName, vote: data.vote, confidence: data.confidence ?? 0, reasoning: data.content ?? '' }
      : undefined;
    store.updateAgentStatus(data.agentId, status, vote, data.asset);
  });

  // ── TRADE EVENTS ─────────────────────────────────────────────────────────────
  // Emitted by the backend execution engine once a fill is recorded
  // (recordConfirmedExecution) with the normalized payload:
  // { trade: { id, asset, type, quantity, entryPrice }, mode, accountId }.
  socket.on('trade:executed', (data: any) => {
    store.addTrade(data.trade);
    const isPaper = data.mode === 'paper';
    const trade = data.trade;
    toast.success(
      `${isPaper ? '📄' : '💰'} ${trade.type} ${trade.asset} @ $${trade.entryPrice?.toFixed(2)}`,
      { duration: 6000 }
    );
  });

  // position:closed and guardrail:triggered listeners were removed: the
  // backend has no producer for either. Position exits finalize
  // asynchronously through broker-evidence reconciliation (partial fills),
  // so no single synchronous close event can report a trustworthy final
  // PnL — closed positions surface via the REST portfolio/trades views.
  // Risk rejections are synchronous and already surfaced as the
  // debate:complete blockReason toast above.

  // ── KILL SWITCH ──────────────────────────────────────────────────────────────
  // Emitted by the backend orchestrator on every switch state change
  // (REST activate/deactivate and the risk manager's automatic trip alike).
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
