import { io, Socket } from 'socket.io-client';
import toast from 'react-hot-toast';
import { useStore } from '../store';

let socket: Socket | null = null;

export function connectSocket() {
  if (socket?.connected) return socket;

  socket = io('/', {
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

  // Real-time price updates
  socket.on('price:update', (data: any) => {
    store.updatePrice(data);
  });

  // Agent council events
  socket.on('council:start', (data: any) => {
    store.resetCouncil();
    store.setCurrentAnalysis(data.asset);
    // Set all agents to analyzing
    for (let i = 1; i <= 10; i++) {
      store.updateAgentStatus(i, 'analyzing', undefined, data.asset);
    }
  });

  socket.on('agent:status', (data: any) => {
    store.updateAgentStatus(data.agentId, data.status, data.vote, data.asset);
  });

  socket.on('council:complete', (data: any) => {
    store.setCurrentAnalysis(null);
    const { result } = data;
    if (result.shouldExecute) {
      toast.success(`🤖 Council VOTED ${result.finalDecision} for ${result.asset} (${result.goVotes}/10 agents)`, { duration: 5000 });
    }
  });

  // Trade events
  socket.on('trade:executed', (data: any) => {
    store.addTrade(data.trade);
    const isPaper = data.mode === 'paper';
    const trade = data.trade;
    toast.success(
      `${isPaper ? '📄' : '💰'} ${trade.type} ${trade.asset} @ $${trade.entryPrice?.toFixed(2)}`,
      { duration: 6000 }
    );
  });

  // Position closed
  socket.on('position:closed', (data: any) => {
    const pnlStr = data.pnl >= 0 ? `+$${data.pnl.toFixed(2)}` : `-$${Math.abs(data.pnl).toFixed(2)}`;
    const icon = data.reason === 'stop_loss' ? '🛑' : data.reason === 'take_profit' ? '🎯' : '✅';
    toast(`${icon} ${data.asset} closed: ${pnlStr} (${data.reason.replace('_', ' ')})`, {
      duration: 6000,
      style: { borderLeft: `3px solid ${data.pnl >= 0 ? '#2D8A4A' : '#DC2626'}` }
    });
  });

  // Guardrail events
  socket.on('guardrail:triggered', (data: any) => {
    toast.error(`⚠️ GUARDRAIL: ${data.rule} triggered`, { duration: 8000 });
  });

  // Kill switch
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
