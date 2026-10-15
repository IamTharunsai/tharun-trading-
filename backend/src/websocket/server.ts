// ── WEBSOCKET SERVER ──────────────────────────────────────────────────────────
import { Server as HttpServer } from 'http';
import { Server as SocketServer, Socket } from 'socket.io';
import { maintainSocketOwner, OwnerSocketLease } from './ownerSocketSession';
import { logger } from '../utils/logger';

let io: SocketServer | null = null;

export function initWebSocket(server: HttpServer) {
  const wsOrigins = [
    'http://localhost:3000',
    'http://localhost:3001',
    'http://localhost:5173',
    ...String(process.env.FRONTEND_URL || '').split(',').map(origin => origin.trim()).filter(Boolean),
  ];
  io = new SocketServer(server, {
    cors: { origin: wsOrigins, methods: ['GET', 'POST'], credentials: true },
    pingTimeout: 60000, pingInterval: 25000
  });

  const instance = io;
  const leases = new Map<Socket, OwnerSocketLease>();
  // This personal platform broadcasts private research globally, so every recipient must be a current owner.
  io.use(async (socket, next) => {
    const candidate = socket.handshake.auth?.token;
    const header = socket.handshake.headers.authorization;
    const raw = typeof candidate === 'string' ? candidate
      : typeof header === 'string' && header.startsWith('Bearer ') ? header.slice(7) : '';
    if (!raw || raw.length > 8192) return next(new Error('unauthorized'));
    const lease = maintainSocketOwner(raw, () => socket.disconnect(true));
    leases.set(socket, lease);
    const dispose = () => {
      lease.dispose();
      leases.delete(socket);
      socket.off('disconnect', dispose);
      socket.conn.off('close', dispose);
    };
    // Middleware failures/aborted handshakes do not emit Socket.IO's disconnect event.
    socket.conn.once('close', dispose);
    socket.once('disconnect', dispose);
    try {
      const identity = await lease.ready;
      if (!lease.isActive() || socket.conn.readyState !== 'open') throw new Error('unauthorized');
      socket.data.userId = identity.userId;
      socket.data.expiresAt = identity.expiresAt;
      next();
    } catch {
      dispose();
      next(new Error('unauthorized'));
    }
  });

  io.on('connection', (socket) => {
    if (!leases.get(socket)?.isActive() || !Number.isFinite(socket.data.expiresAt) || socket.data.expiresAt <= Date.now()) return void socket.disconnect(true);
    logger.info('Owner dashboard socket connected');
    // Mutating controls use the existing REST authority path, never client socket commands.
  });
  server.once('close', () => {
    for (const [socket, lease] of leases) {
      lease.dispose();
      socket.disconnect(true);
    }
    leases.clear();
    if (io === instance) io = null;
  });
}

export function getIO() { return io; }
