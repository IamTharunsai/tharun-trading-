// ── WEBSOCKET SERVER ──────────────────────────────────────────────────────────
import { Server as HttpServer } from 'http';
import { Server as SocketServer } from 'socket.io';

let io: SocketServer | null = null;

export function initWebSocket(server: HttpServer) {
  io = new SocketServer(server, {
    cors: { origin: process.env.FRONTEND_URL || 'http://localhost:3000', methods: ['GET', 'POST'] },
    pingTimeout: 60000, pingInterval: 25000
  });

  io.on('connection', (socket) => {
    console.log(`📱 Dashboard connected: ${socket.id}`);
    socket.on('disconnect', () => console.log(`📴 Dashboard disconnected: ${socket.id}`));
    // Kill switch from frontend
    socket.on('kill:switch:activate', () => {
      const { activateKillSwitch } = require('./agents/orchestrator');
      activateKillSwitch();
      io?.emit('kill:switch:activated', { timestamp: Date.now() });
    });
    socket.on('kill:switch:deactivate', () => {
      const { deactivateKillSwitch } = require('./agents/orchestrator');
      deactivateKillSwitch();
      io?.emit('kill:switch:deactivated', { timestamp: Date.now() });
    });
  });
}

export function getIO() { return io; }
