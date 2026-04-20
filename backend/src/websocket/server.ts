// ── WEBSOCKET SERVER ──────────────────────────────────────────────────────────
import { Server as HttpServer } from 'http';
import { Server as SocketServer } from 'socket.io';
import { activateKillSwitch, deactivateKillSwitch } from '../agents/orchestrator';

let io: SocketServer | null = null;

export function initWebSocket(server: HttpServer) {
  const wsOrigins = [
    'http://localhost:3000',
    'http://localhost:5173',
    ...(process.env.FRONTEND_URL ? [process.env.FRONTEND_URL] : []),
  ];
  io = new SocketServer(server, {
    cors: { origin: wsOrigins, methods: ['GET', 'POST'], credentials: true },
    pingTimeout: 60000, pingInterval: 25000
  });

  io.on('connection', (socket) => {
    console.log(`📱 Dashboard connected: ${socket.id}`);
    socket.on('disconnect', () => console.log(`📴 Dashboard disconnected: ${socket.id}`));
    // Kill switch from frontend
    socket.on('kill:switch:activate', () => {
      activateKillSwitch();
      io?.emit('kill:switch:activated', { timestamp: Date.now() });
    });
    socket.on('kill:switch:deactivate', () => {
      deactivateKillSwitch();
      io?.emit('kill:switch:deactivated', { timestamp: Date.now() });
    });
  });
}

export function getIO() { return io; }
