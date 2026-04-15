import 'dotenv/config';
import express from 'express';
import http from 'http';
import cors from 'cors';
import helmet from 'helmet';
import compression from 'compression';
import rateLimit from 'express-rate-limit';
import { initWebSocket } from './websocket/server';
import { initScheduler } from './jobs/scheduler';
import { initMarketData } from './services/marketData';
import { logger } from './utils/logger';
import { prisma } from './utils/prisma';

// Routes
import authRoutes from './routes/auth';
import tradesRoutes from './routes/trades';
import portfolioRoutes from './routes/portfolio';
import agentsRoutes from './routes/agents';
import marketRoutes from './routes/market';
import journalRoutes from './routes/journal';
import settingsRoutes from './routes/settings';
import killSwitchRoutes from './routes/killSwitch';
import chatRoutes from './routes/chat';

const app = express();
const server = http.createServer(app);

// ── MIDDLEWARE ────────────────────────────────────────────────────────────────
app.use(helmet());
app.use(compression());
app.use(cors({
  origin: process.env.FRONTEND_URL || 'http://localhost:3000',
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'],
}));
app.use(express.json({ limit: '10mb' }));

// Global rate limiter
app.use(rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 500,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests, please try again later.' }
}));

// ── ROUTES ────────────────────────────────────────────────────────────────────
app.use('/api/auth', authRoutes);
app.use('/api/trades', tradesRoutes);
app.use('/api/portfolio', portfolioRoutes);
app.use('/api/agents', agentsRoutes);
app.use('/api/market', marketRoutes);
app.use('/api/journal', journalRoutes);
app.use('/api/settings', settingsRoutes);
app.use('/api/kill-switch', killSwitchRoutes);
app.use('/api/chat', chatRoutes);

// Health check
app.get('/health', (_, res) => {
  res.json({
    status: 'OPERATIONAL',
    mode: process.env.TRADING_MODE || 'paper',
    timestamp: new Date().toISOString(),
    uptime: process.uptime()
  });
});

// ── ERROR HANDLER ─────────────────────────────────────────────────────────────
app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  logger.error('Unhandled error', { error: err.message, stack: err.stack });
  res.status(500).json({ error: 'Internal server error' });
});

// ── BOOT ──────────────────────────────────────────────────────────────────────
const PORT = parseInt(process.env.PORT || '4000');

async function boot() {
  try {
    // Test DB connection
    await prisma.$connect();
    logger.info('✅ Database connected');

    // Init WebSocket
    initWebSocket(server);
    logger.info('✅ WebSocket server initialized');

    // Init market data feeds (optional)
    try {
      await initMarketData();
      logger.info('✅ Market data feeds connected');
    } catch (err) {
      logger.warn('⚠️ Market data feeds failed to connect', { error: err instanceof Error ? err.message : String(err) });
    }

    // Init job scheduler (optional)
    try {
      initScheduler();
      logger.info('✅ Job scheduler started');
    } catch (err) {
      logger.warn('⚠️ Job scheduler failed to start', { error: err instanceof Error ? err.message : String(err) });
    }

    server.listen(PORT, () => {
      logger.info(`🚀 APEX TRADER backend running on port ${PORT}`);
      logger.info(`📊 Trading mode: ${process.env.TRADING_MODE?.toUpperCase() || 'PAPER'}`);
    });
  } catch (error) {
    logger.error('❌ Boot failed', { error: error instanceof Error ? error.message : String(error) });
    process.exit(1);
  }
}

// Graceful shutdown
process.on('SIGTERM', async () => {
  logger.info('SIGTERM received — shutting down gracefully');
  await prisma.$disconnect();
  process.exit(0);
});

process.on('uncaughtException', (error) => {
  logger.error('Uncaught exception', { error: error.message });
  process.exit(1);
});

boot();
