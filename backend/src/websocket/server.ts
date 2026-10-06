// ── WEBSOCKET SERVER ──────────────────────────────────────────────────────────
import { Server as HttpServer } from 'http';
import { Server as SocketServer } from 'socket.io';
import jwt from 'jsonwebtoken';
import { activateKillSwitch, deactivateKillSwitch } from '../agents/orchestrator';
import { appConfig } from '../utils/config';
import { isTokenRevoked } from '../middleware/auth';
import { logger } from '../utils/logger';

let io: SocketServer | null = null;

export function initWebSocket(server: HttpServer) {
  const wsOrigins = [
    'http://localhost:3000',
    'http://localhost:3001',
    'http://localhost:5173',
    ...(process.env.FRONTEND_URL ? [process.env.FRONTEND_URL] : []),
  ];
  io = new SocketServer(server, {
    cors: { origin: wsOrigins, methods: ['GET', 'POST'], credentials: true },
    pingTimeout: 60000, pingInterval: 25000
  });

  // SECURITY: every socket must present a valid, non-revoked JWT. Without this
  // anyone on the internet could stream trades/debates and switch the kill
  // switch OFF.
  io.use(async (socket, next) => {
    try {
      const raw = (socket.handshake.auth as any)?.token || String(socket.handshake.headers.authorization || '').replace(/^Bearer /, '');
      if (!raw) return next(new Error('unauthorized'));
      if (await isTokenRevoked(raw)) return next(new Error('unauthorized'));
      const decoded = jwt.verify(raw, appConfig.JWT_SECRET) as any;
      (socket.data as any).userId = decoded.userId;
      (socket.data as any).role = decoded.role;
      next();
    } catch {
      next(new Error('unauthorized'));
    }
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
      // Resuming trading is an owner-only action.
      if ((socket.data as any).role !== 'OWNER') {
        logger.warn('Rejected kill-switch deactivation from non-owner socket');
        return;
      }
      deactivateKillSwitch();
      io?.emit('kill:switch:deactivated', { timestamp: Date.now() });
    });
  });
}

export function getIO() { return io; }
