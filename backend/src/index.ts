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
import { geopoliticalDataService } from './services/geopoliticalDataService';
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
import agentMonitorRoutes from './routes/agentMonitor';
import backtestRoutes from './routes/backtest';
import intelligenceRoutes from './routes/intelligence';

const app = express();
const server = http.createServer(app);

// ── MIDDLEWARE ────────────────────────────────────────────────────────────────
// Disable frameguard and strict CSP for AI Studio iframe embedding
app.use(helmet({ contentSecurityPolicy: false, frameguard: false }));
app.use(compression() as any);

app.use(cors({
  origin: true,
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
app.use('/api/monitor', agentMonitorRoutes);
app.use('/api/backtest', backtestRoutes);
app.use('/api/intelligence', intelligenceRoutes);

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
export async function boot(port: number = 3000) {
  // Start HTTP & WebSocket server immediately so port 3000 is open without blocking
  if (!server.listening) {
    server.listen(port, '0.0.0.0', () => {
      logger.info(`🚀 THARUN TRADING BOT backend running on http://0.0.0.0:${port}`);
      logger.info(`📊 Trading mode: ${process.env.TRADING_MODE?.toUpperCase() || 'PAPER'}`);
    });
  }

  try {
    // Test DB connection
    await prisma.$connect();
    logger.info('✅ Database connected');

    // Init WebSocket
    initWebSocket(server);
    logger.info('✅ WebSocket server initialized');

    // Init market data feeds (optional, non-blocking)
    initMarketData().then(() => {
      logger.info('✅ Market data feeds connected');
    }).catch((err) => {
      logger.warn('⚠️ Market data feeds failed to connect', { error: err instanceof Error ? err.message : String(err) });
    });

    // Init job scheduler (optional, non-blocking)
    try {
      initScheduler();
      logger.info('✅ Job scheduler started');
    } catch (err) {
      logger.warn('⚠️ Job scheduler failed to start', { error: err instanceof Error ? err.message : String(err) });
    }

    // Init geopolitical data service (non-blocking)
    geopoliticalDataService.initialize().then(() => {
      logger.info('📡 Geopolitical & news data service initialized');
    }).catch((err) => {
      logger.warn('⚠️ Geopolitical service failed', { error: err instanceof Error ? err.message : String(err) });
    });
  } catch (error) {
    logger.error('❌ Boot error handled', { error: error instanceof Error ? error.message : String(error) });
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
});

process.on('unhandledRejection', (reason: any) => {
  logger.error('Unhandled promise rejection', { reason: reason?.message || String(reason) });
  // Don't exit — log and continue so the whole server doesn't crash on one bad API call
});

export { app, server };
