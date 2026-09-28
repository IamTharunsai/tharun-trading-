import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
// @ts-ignore
import { DatabaseSync } from 'node:sqlite';
import bcrypt from 'bcryptjs';
import { logger } from './logger';

// ── PERSISTENT SQLITE STORAGE ENGINE (Real zero-mock persistent database) ─────────
// Meets non-negotiable data rule: starts with ZERO fake trades, ZERO fake positions,
// ZERO fake snapshots, ZERO fake predictions. All data persists to disk in apex_trading.db.

// Canonical data directory: always resolves to <repo>/backend/data regardless of process.cwd()
const CANONICAL_DATA_DIR = path.resolve(__dirname, '..', '..', 'data');
if (!fs.existsSync(CANONICAL_DATA_DIR)) {
  fs.mkdirSync(CANONICAL_DATA_DIR, { recursive: true });
}

const DB_PATH = process.env.SQLITE_DB_PATH || path.join(CANONICAL_DATA_DIR, 'apex_trading.db');
let sqliteDb: any = null;
let dbHealthy = false;
let dbInitError: string | null = null;

try {
  sqliteDb = new DatabaseSync(DB_PATH);
  // Enable Write-Ahead Logging for concurrency & data durability
  sqliteDb.exec('PRAGMA journal_mode = WAL;');
  sqliteDb.exec('PRAGMA synchronous = NORMAL;');
  sqliteDb.exec('PRAGMA foreign_keys = ON;');
  dbHealthy = true;
} catch (err: any) {
  dbInitError = err.message || String(err);
  logger.error('CRITICAL: SQLite persistent database failed to initialize', { error: dbInitError, path: DB_PATH });
}

// ── SCHEMA MIGRATIONS ────────────────────────────────────────────────────────
export function runMigrations() {
  if (!sqliteDb) return;

  sqliteDb.exec(`
    CREATE TABLE IF NOT EXISTS _migrations (
      id TEXT PRIMARY KEY,
      applied_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      email TEXT UNIQUE NOT NULL,
      passwordHash TEXT NOT NULL,
      totpSecret TEXT,
      totpEnabled INTEGER DEFAULT 0,
      lastLogin DATETIME,
      sessionToken TEXT,
      ipWhitelist TEXT DEFAULT '[]',
      role TEXT DEFAULT 'OWNER',
      createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
      updatedAt DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS trades (
      id TEXT PRIMARY KEY,
      asset TEXT NOT NULL,
      market TEXT NOT NULL,
      type TEXT NOT NULL,
      entryPrice REAL NOT NULL,
      exitPrice REAL,
      quantity REAL NOT NULL,
      pnl REAL,
      pnlPct REAL,
      fees REAL DEFAULT 0,
      status TEXT DEFAULT 'OPEN',
      brokerOrderId TEXT,
      brokerConfirmed INTEGER DEFAULT 0,
      agentDecisionId TEXT,
      openedAt DATETIME DEFAULT CURRENT_TIMESTAMP,
      closedAt DATETIME,
      stopLossPrice REAL,
      takeProfitPrice REAL,
      exitReason TEXT,
      fillLatencyMs REAL,
      reconciliationStatus TEXT DEFAULT 'RECONCILED',
      createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
      updatedAt DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS positions (
      id TEXT PRIMARY KEY,
      asset TEXT UNIQUE NOT NULL,
      market TEXT NOT NULL,
      side TEXT DEFAULT 'BUY',
      quantity REAL NOT NULL,
      entryPrice REAL NOT NULL,
      currentPrice REAL NOT NULL,
      stopLossPrice REAL NOT NULL,
      takeProfitPrice REAL NOT NULL,
      unrealizedPnl REAL DEFAULT 0,
      unrealizedPnlPct REAL DEFAULT 0,
      protectionStatus TEXT DEFAULT 'APPLICATION_MONITORED',
      brokerPositionId TEXT,
      status TEXT DEFAULT 'OPEN',
      openedAt DATETIME DEFAULT CURRENT_TIMESTAMP,
      updatedAt DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS portfolio_snapshots (
      id TEXT PRIMARY KEY,
      totalValue REAL NOT NULL,
      cashBalance REAL NOT NULL,
      invested REAL NOT NULL,
      pnlDay REAL DEFAULT 0,
      pnlDayPct REAL DEFAULT 0,
      pnlTotal REAL DEFAULT 0,
      pnlTotalPct REAL DEFAULT 0,
      source TEXT DEFAULT 'VERIFIED_LEDGER',
      timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS agent_decisions (
      id TEXT PRIMARY KEY,
      asset TEXT NOT NULL,
      signal TEXT NOT NULL,
      finalVote TEXT NOT NULL,
      totalVotes INTEGER NOT NULL,
      goVotes INTEGER NOT NULL,
      noGoVotes INTEGER NOT NULL,
      avgConfidence REAL NOT NULL,
      executed INTEGER DEFAULT 0,
      executionReason TEXT,
      agentVotes TEXT DEFAULT '[]',
      marketSnapshot TEXT DEFAULT '{}',
      regime TEXT,
      horizon TEXT DEFAULT 'INTRADAY',
      inputDataFreshnessMs REAL,
      timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS daily_journals (
      id TEXT PRIMARY KEY,
      date TEXT UNIQUE NOT NULL,
      summary TEXT NOT NULL,
      totalTrades INTEGER DEFAULT 0,
      pnlDay REAL DEFAULT 0,
      pnlDayPct REAL DEFAULT 0,
      bestTrade TEXT,
      worstTrade TEXT,
      marketNotes TEXT,
      agentPerformance TEXT,
      createdAt DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS predictions (
      id TEXT PRIMARY KEY,
      asset TEXT NOT NULL,
      market TEXT DEFAULT 'polymarket',
      title TEXT,
      category TEXT,
      direction TEXT,
      confidence REAL NOT NULL,
      yesPrice REAL,
      noPrice REAL,
      targetPrice REAL,
      currentPrice REAL,
      timeHorizon TEXT,
      edge REAL,
      recommendedBet TEXT,
      expectedValue REAL,
      kellyFraction REAL,
      recommendedWager REAL,
      reasoning TEXT,
      keyRisks TEXT DEFAULT '[]',
      status TEXT DEFAULT 'ACTIVE',
      wasCorrect INTEGER,
      resolvedAt DATETIME,
      resolvedPrice REAL,
      createdAt DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS guardrail_logs (
      id TEXT PRIMARY KEY,
      rule TEXT NOT NULL,
      triggered INTEGER DEFAULT 0,
      details TEXT,
      createdAt DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS settings (
      id TEXT PRIMARY KEY,
      tradingMode TEXT DEFAULT 'paper',
      maxPositionSizePct REAL DEFAULT 15,
      maxRiskPerTradePct REAL DEFAULT 2,
      dailyLossLimitPct REAL DEFAULT 3,
      weeklyLossLimitPct REAL DEFAULT 6,
      stopLossStocksPct REAL DEFAULT 4,
      stopLossCryptoPct REAL DEFAULT 6,
      takeProfitPct REAL DEFAULT 10,
      minAgentConfidence REAL DEFAULT 70,
      minVotesToExecute INTEGER DEFAULT 8,
      cashReservePct REAL DEFAULT 20,
      killSwitchActive INTEGER DEFAULT 0,
      updatedAt DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS stock_memories (
      id TEXT PRIMARY KEY,
      symbol TEXT UNIQUE NOT NULL,
      totalDebates INTEGER DEFAULT 0,
      totalTrades INTEGER DEFAULT 0,
      wins INTEGER DEFAULT 0,
      losses INTEGER DEFAULT 0,
      winRate REAL DEFAULT 0,
      avgPnlPct REAL DEFAULT 0,
      bestSetup TEXT,
      worstSetup TEXT,
      avgHoldHours REAL DEFAULT 0,
      lastDebateVote TEXT,
      lastTradeOutcome TEXT,
      keyLessons TEXT DEFAULT '[]',
      avoidConditions TEXT DEFAULT '[]',
      favorConditions TEXT DEFAULT '[]',
      lastUpdated DATETIME DEFAULT CURRENT_TIMESTAMP,
      createdAt DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS debate_checkpoints (
      id TEXT PRIMARY KEY,
      asset TEXT UNIQUE NOT NULL,
      status TEXT NOT NULL,
      round1Results TEXT NOT NULL,
      round2Exchange TEXT,
      marketRegime TEXT NOT NULL,
      createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
      updatedAt DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS system_logs (
      id TEXT PRIMARY KEY,
      level TEXT NOT NULL,
      service TEXT NOT NULL,
      message TEXT NOT NULL,
      metadata TEXT,
      timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS provider_sync_records (
      id TEXT PRIMARY KEY,
      provider TEXT NOT NULL,
      feedType TEXT NOT NULL,
      totalSynchronized INTEGER DEFAULT 0,
      totalEligible INTEGER DEFAULT 0,
      totalSkipped INTEGER DEFAULT 0,
      totalStale INTEGER DEFAULT 0,
      totalFailed INTEGER DEFAULT 0,
      latencyMs REAL DEFAULT 0,
      status TEXT DEFAULT 'SUCCESS',
      lastSyncAt DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS broker_reconciliations (
      id TEXT PRIMARY KEY,
      broker TEXT NOT NULL,
      brokerOrderId TEXT NOT NULL,
      localTradeId TEXT,
      symbol TEXT NOT NULL,
      orderStatus TEXT NOT NULL,
      submittedQty REAL NOT NULL,
      filledQty REAL NOT NULL,
      avgPrice REAL,
      discrepancyDetected INTEGER DEFAULT 0,
      discrepancyDetails TEXT,
      timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS auth_audit_logs (
      id TEXT PRIMARY KEY,
      email TEXT NOT NULL,
      ipAddress TEXT,
      action TEXT NOT NULL,
      success INTEGER NOT NULL,
      reason TEXT,
      timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS revoked_tokens (
      token TEXT PRIMARY KEY,
      revokedAt DATETIME DEFAULT CURRENT_TIMESTAMP,
      expiresAt DATETIME
    );

    CREATE TABLE IF NOT EXISTS trade_lifecycle_audits (
      id TEXT PRIMARY KEY,
      correlationId TEXT NOT NULL,
      account TEXT,
      provider TEXT,
      environment TEXT,
      strategy TEXT,
      symbol TEXT,
      previousState TEXT,
      newState TEXT,
      providerTimestamp DATETIME,
      applicationTimestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
      sourceDataIds TEXT,
      reason TEXT,
      errors TEXT,
      retryCount INTEGER DEFAULT 0,
      modelVersion TEXT,
      configVersion TEXT,
      metadata TEXT
    );

    CREATE TABLE IF NOT EXISTS investment_theses (
      id TEXT PRIMARY KEY,
      symbol TEXT NOT NULL,
      version INTEGER DEFAULT 1,
      thesis TEXT NOT NULL,
      targetHorizonDays INTEGER,
      reviewConditions TEXT,
      invalidationConditions TEXT,
      valuationMultiple REAL,
      targetPrice REAL,
      status TEXT DEFAULT 'ACTIVE',
      createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
      updatedAt DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS event_intelligence (
      id TEXT PRIMARY KEY,
      provider TEXT NOT NULL,
      originalId TEXT,
      url TEXT,
      publishedAt DATETIME NOT NULL,
      receivedAt DATETIME DEFAULT CURRENT_TIMESTAMP,
      symbols TEXT,
      headline TEXT NOT NULL,
      normalizedText TEXT,
      duplicateGroup TEXT,
      language TEXT DEFAULT 'en',
      sentimentModel TEXT,
      modelVersion TEXT,
      sentimentScore REAL,
      relevanceScore REAL,
      noveltyScore REAL,
      eventClassification TEXT,
      confidence REAL,
      isScheduled INTEGER DEFAULT 0,
      expiration DATETIME,
      licensingStatus TEXT DEFAULT 'VERIFIED_PUBLIC',
      evidenceStatus TEXT DEFAULT 'VERIFIED'
    );

    CREATE TABLE IF NOT EXISTS news_items (
      id TEXT PRIMARY KEY,
      headline TEXT NOT NULL,
      source TEXT NOT NULL,
      url TEXT,
      sentimentScore REAL DEFAULT 0,
      sentimentLabel TEXT DEFAULT 'NEUTRAL',
      assetsMentioned TEXT DEFAULT '[]',
      summary TEXT,
      publishedAt DATETIME DEFAULT CURRENT_TIMESTAMP,
      createdAt DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS geopolitical_events (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      description TEXT NOT NULL,
      eventType TEXT DEFAULT 'geopolitical',
      severity INTEGER DEFAULT 5,
      countries TEXT DEFAULT '[]',
      affectedAssets TEXT DEFAULT '[]',
      geoRiskScore REAL DEFAULT 50,
      impactDuration TEXT DEFAULT 'unknown',
      marketImpact TEXT DEFAULT 'neutral',
      source TEXT NOT NULL,
      timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
      followUpRequired INTEGER DEFAULT 0,
      metadata TEXT,
      createdAt DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);

  // Secure Owner Account Provisioning (No hardcoded credentials committed in source code)
  // Provision owner if OWNER_EMAIL and OWNER_PASSWORD/OWNER_PASSWORD_HASH are defined in env,
  // or preserve any previously provisioned owner in persistent storage.
  const ownerUser = sqliteDb.prepare("SELECT id, email FROM users WHERE role = 'OWNER' LIMIT 1").get() as any;
  if (!ownerUser) {
    const envOwnerEmail = process.env.OWNER_EMAIL?.trim().toLowerCase();
    const envOwnerPassword = process.env.OWNER_PASSWORD;
    const envOwnerHash = process.env.OWNER_PASSWORD_HASH;

    if (envOwnerEmail && (envOwnerPassword || envOwnerHash)) {
      const passwordHash = envOwnerHash || bcrypt.hashSync(envOwnerPassword!, 10);
      sqliteDb.prepare(`
        INSERT INTO users (id, email, passwordHash, totpSecret, totpEnabled, role, createdAt, updatedAt)
        VALUES (?, ?, ?, NULL, 0, 'OWNER', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
      `).run('owner-user-1', envOwnerEmail, passwordHash);
      logger.info(`✅ Provisioned owner account for ${envOwnerEmail} from environment credentials`);
    } else {
      logger.info('ℹ️ No owner account currently provisioned. Awaiting initial setup via /api/auth/setup-owner or OWNER_EMAIL/OWNER_PASSWORD in env.');
    }
  }

  // Ensure default settings exist
  const existingSettings = sqliteDb.prepare('SELECT id FROM settings WHERE id = ?').get('settings-1');
  if (!existingSettings) {
    sqliteDb.prepare(`
      INSERT INTO settings (id, tradingMode, maxPositionSizePct, maxRiskPerTradePct, dailyLossLimitPct, weeklyLossLimitPct, stopLossStocksPct, stopLossCryptoPct, takeProfitPct, minAgentConfidence, minVotesToExecute, cashReservePct, killSwitchActive)
      VALUES ('settings-1', 'paper', 15, 2, 3, 6, 4, 6, 10, 70, 8, 20, 0)
    `).run();
  }

  logger.info(`✅ Persistent SQLite database initialized & verified at ${DB_PATH}`);
}

// Run migrations immediately on module load
try {
  runMigrations();
} catch (e: any) {
  logger.error('Failed to run database migrations', { error: e.message });
}

// ── PRISMA CONTRACT IMPLEMENTATION ──────────────────────────────────────────
function assertDb(): any {
  if (!sqliteDb || !dbHealthy) {
    throw new Error(`Database unavailable: ${dbInitError || 'Storage engine not connected'}`);
  }
  return sqliteDb;
}

export const prisma: any = {
  $connect: async () => {
    assertDb();
    return true;
  },
  $disconnect: async () => {},

  getDatabaseHealth: () => ({
    healthy: dbHealthy && !!sqliteDb,
    engine: 'SQLite (node:sqlite WAL)',
    dbPath: DB_PATH,
    error: dbInitError,
    timestamp: new Date().toISOString(),
  }),

  user: {
    findUnique: async ({ where }: { where: { id?: string; email?: string } }) => {
      const db = assertDb();
      if (where.id) {
        const row: any = db.prepare('SELECT * FROM users WHERE id = ?').get(where.id);
        if (!row) return null;
        return { ...row, totpEnabled: Boolean(row.totpEnabled), ipWhitelist: JSON.parse(row.ipWhitelist || '[]') };
      }
      if (where.email) {
        const row: any = db.prepare('SELECT * FROM users WHERE LOWER(email) = LOWER(?)').get(where.email);
        if (!row) return null;
        return { ...row, totpEnabled: Boolean(row.totpEnabled), ipWhitelist: JSON.parse(row.ipWhitelist || '[]') };
      }
      return null;
    },
    findFirst: async () => {
      const db = assertDb();
      const row: any = db.prepare('SELECT * FROM users ORDER BY createdAt ASC LIMIT 1').get();
      if (!row) return null;
      return { ...row, totpEnabled: Boolean(row.totpEnabled), ipWhitelist: JSON.parse(row.ipWhitelist || '[]') };
    },
    create: async ({ data }: any) => {
      const db = assertDb();
      const id = data.id || `user-${Date.now()}`;
      db.prepare(`
        INSERT INTO users (id, email, passwordHash, totpSecret, totpEnabled, role, ipWhitelist, createdAt, updatedAt)
        VALUES (?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
      `).run(
        id,
        data.email,
        data.passwordHash,
        data.totpSecret || null,
        data.totpEnabled ? 1 : 0,
        data.role || 'OWNER',
        JSON.stringify(data.ipWhitelist || [])
      );
      return prisma.user.findUnique({ where: { id } });
    },
    update: async ({ where, data }: any) => {
      const db = assertDb();
      const sets: string[] = [];
      const vals: any[] = [];
      if (data.passwordHash !== undefined) { sets.push('passwordHash = ?'); vals.push(data.passwordHash); }
      if (data.totpSecret !== undefined) { sets.push('totpSecret = ?'); vals.push(data.totpSecret); }
      if (data.totpEnabled !== undefined) { sets.push('totpEnabled = ?'); vals.push(data.totpEnabled ? 1 : 0); }
      if (data.lastLogin !== undefined) { sets.push('lastLogin = ?'); vals.push(new Date(data.lastLogin).toISOString()); }
      if (data.sessionToken !== undefined) { sets.push('sessionToken = ?'); vals.push(data.sessionToken); }
      if (data.ipWhitelist !== undefined) { sets.push('ipWhitelist = ?'); vals.push(JSON.stringify(data.ipWhitelist)); }
      sets.push('updatedAt = CURRENT_TIMESTAMP');
      
      const targetId = where.id || (await prisma.user.findUnique({ where }))?.id;
      if (targetId && sets.length > 0) {
        vals.push(targetId);
        db.prepare(`UPDATE users SET ${sets.join(', ')} WHERE id = ?`).run(...vals);
      }
      return prisma.user.findUnique({ where: { id: targetId } });
    },
    deleteMany: async () => {
      const db = assertDb();
      const res = db.prepare('DELETE FROM users').run();
      return { count: Number(res.changes) };
    }
  },

  trade: {
    findMany: async (args?: any) => {
      const db = assertDb();
      const conditions: string[] = [];
      const params: any[] = [];
      if (args?.where?.asset) { conditions.push('asset = ?'); params.push(args.where.asset); }
      if (args?.where?.status) { conditions.push('status = ?'); params.push(args.where.status); }
      if (args?.where?.market && args.where.market !== 'all') { conditions.push('market = ?'); params.push(args.where.market); }
      if (args?.where?.openedAt?.gte) { conditions.push('openedAt >= ?'); params.push(new Date(args.where.openedAt.gte).toISOString()); }

      let sql = 'SELECT * FROM trades';
      if (conditions.length > 0) sql += ` WHERE ${conditions.join(' AND ')}`;
      sql += ' ORDER BY openedAt DESC';
      if (args?.take) {
        sql += ' LIMIT ?';
        params.push(args.take);
        if (args?.skip) {
          sql += ' OFFSET ?';
          params.push(args.skip);
        }
      }
      const rows: any[] = db.prepare(sql).all(...params);
      return rows.map(r => ({ ...r, brokerConfirmed: Boolean(r.brokerConfirmed) }));
    },
    count: async (args?: any) => {
      const db = assertDb();
      const conditions: string[] = [];
      const params: any[] = [];
      if (args?.where?.asset) { conditions.push('asset = ?'); params.push(args.where.asset); }
      if (args?.where?.status) { conditions.push('status = ?'); params.push(args.where.status); }
      if (args?.where?.market && args.where.market !== 'all') { conditions.push('market = ?'); params.push(args.where.market); }
      if (args?.where?.openedAt?.gte) { conditions.push('openedAt >= ?'); params.push(new Date(args.where.openedAt.gte).toISOString()); }

      let sql = 'SELECT COUNT(*) as count FROM trades';
      if (conditions.length > 0) sql += ` WHERE ${conditions.join(' AND ')}`;
      const row: any = db.prepare(sql).get(...params);
      return row ? Number(row.count) : 0;
    },
    findUnique: async ({ where }: any) => {
      const db = assertDb();
      const row: any = db.prepare('SELECT * FROM trades WHERE id = ?').get(where.id);
      if (!row) return null;
      return { ...row, brokerConfirmed: Boolean(row.brokerConfirmed) };
    },
    findFirst: async ({ where }: any) => {
      const db = assertDb();
      const conditions: string[] = [];
      const params: any[] = [];
      if (where?.asset) { conditions.push('asset = ?'); params.push(where.asset); }
      if (where?.status) { conditions.push('status = ?'); params.push(where.status); }
      let sql = 'SELECT * FROM trades';
      if (conditions.length > 0) sql += ` WHERE ${conditions.join(' AND ')}`;
      sql += ' ORDER BY openedAt DESC LIMIT 1';
      const row: any = db.prepare(sql).get(...params);
      if (!row) return null;
      return { ...row, brokerConfirmed: Boolean(row.brokerConfirmed) };
    },
    create: async ({ data }: any) => {
      const db = assertDb();
      const id = data.id || `trade-${Date.now()}-${crypto.randomUUID().slice(0, 8)}`;
      db.prepare(`
        INSERT INTO trades (
          id, asset, market, type, entryPrice, exitPrice, quantity, pnl, pnlPct, fees,
          status, brokerOrderId, brokerConfirmed, agentDecisionId, stopLossPrice, takeProfitPrice,
          exitReason, openedAt, createdAt, updatedAt
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
      `).run(
        id,
        data.asset,
        data.market,
        data.type,
        data.entryPrice,
        data.exitPrice ?? null,
        data.quantity,
        data.pnl ?? null,
        data.pnlPct ?? null,
        data.fees ?? 0,
        data.status || 'OPEN',
        data.brokerOrderId || null,
        data.brokerConfirmed ? 1 : 0,
        data.agentDecisionId || null,
        data.stopLossPrice ?? null,
        data.takeProfitPrice ?? null,
        data.exitReason || null
      );
      return prisma.trade.findUnique({ where: { id } });
    },
    update: async ({ where, data }: any) => {
      const db = assertDb();
      const sets: string[] = [];
      const vals: any[] = [];
      if (data.status !== undefined) { sets.push('status = ?'); vals.push(data.status); }
      if (data.exitPrice !== undefined) { sets.push('exitPrice = ?'); vals.push(data.exitPrice); }
      if (data.pnl !== undefined) { sets.push('pnl = ?'); vals.push(data.pnl); }
      if (data.pnlPct !== undefined) { sets.push('pnlPct = ?'); vals.push(data.pnlPct); }
      if (data.brokerOrderId !== undefined) { sets.push('brokerOrderId = ?'); vals.push(data.brokerOrderId); }
      if (data.brokerConfirmed !== undefined) { sets.push('brokerConfirmed = ?'); vals.push(data.brokerConfirmed ? 1 : 0); }
      if (data.entryPrice !== undefined) { sets.push('entryPrice = ?'); vals.push(data.entryPrice); }
      if (data.quantity !== undefined) { sets.push('quantity = ?'); vals.push(data.quantity); }
      if (data.exitReason !== undefined) { sets.push('exitReason = ?'); vals.push(data.exitReason); }
      if (data.closedAt !== undefined) { sets.push('closedAt = ?'); vals.push(data.closedAt ? new Date(data.closedAt).toISOString() : null); }
      sets.push('updatedAt = CURRENT_TIMESTAMP');
      vals.push(where.id);
      db.prepare(`UPDATE trades SET ${sets.join(', ')} WHERE id = ?`).run(...vals);
      return prisma.trade.findUnique({ where: { id: where.id } });
    }
  },

  position: {
    findMany: async (args?: any) => {
      const db = assertDb();
      const conditions: string[] = [];
      const params: any[] = [];
      if (args?.where?.status) { conditions.push('status = ?'); params.push(args.where.status); }
      if (args?.where?.asset) { conditions.push('asset = ?'); params.push(args.where.asset); }
      let sql = 'SELECT * FROM positions';
      if (conditions.length > 0) sql += ` WHERE ${conditions.join(' AND ')}`;
      return db.prepare(sql).all(...params);
    },
    findFirst: async ({ where }: any) => {
      const db = assertDb();
      const conditions: string[] = [];
      const params: any[] = [];
      if (where?.status) { conditions.push('status = ?'); params.push(where.status); }
      if (where?.asset) { conditions.push('asset = ?'); params.push(where.asset); }
      let sql = 'SELECT * FROM positions';
      if (conditions.length > 0) sql += ` WHERE ${conditions.join(' AND ')}`;
      sql += ' LIMIT 1';
      return db.prepare(sql).get(...params) || null;
    },
    findUnique: async ({ where }: any) => {
      const db = assertDb();
      if (where.id) return db.prepare('SELECT * FROM positions WHERE id = ?').get(where.id) || null;
      if (where.asset) return db.prepare('SELECT * FROM positions WHERE asset = ?').get(where.asset) || null;
      return null;
    },
    create: async ({ data }: any) => {
      const db = assertDb();
      const id = data.id || `pos-${Date.now()}`;
      db.prepare(`
        INSERT INTO positions (
          id, asset, market, side, quantity, entryPrice, currentPrice,
          stopLossPrice, takeProfitPrice, unrealizedPnl, unrealizedPnlPct,
          protectionStatus, status, openedAt, updatedAt
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
      `).run(
        id,
        data.asset,
        data.market,
        data.side || 'BUY',
        data.quantity,
        data.entryPrice,
        data.currentPrice || data.entryPrice,
        data.stopLossPrice,
        data.takeProfitPrice,
        data.unrealizedPnl ?? 0,
        data.unrealizedPnlPct ?? 0,
        data.protectionStatus || 'APPLICATION_MONITORED',
        data.status || 'OPEN'
      );
      return prisma.position.findUnique({ where: { id } });
    },
    update: async ({ where, data }: any) => {
      const db = assertDb();
      const sets: string[] = [];
      const vals: any[] = [];
      if (data.currentPrice !== undefined) { sets.push('currentPrice = ?'); vals.push(data.currentPrice); }
      if (data.unrealizedPnl !== undefined) { sets.push('unrealizedPnl = ?'); vals.push(data.unrealizedPnl); }
      if (data.unrealizedPnlPct !== undefined) { sets.push('unrealizedPnlPct = ?'); vals.push(data.unrealizedPnlPct); }
      if (data.status !== undefined) { sets.push('status = ?'); vals.push(data.status); }
      if (data.quantity !== undefined) { sets.push('quantity = ?'); vals.push(data.quantity); }
      if (data.stopLossPrice !== undefined) { sets.push('stopLossPrice = ?'); vals.push(data.stopLossPrice); }
      if (data.takeProfitPrice !== undefined) { sets.push('takeProfitPrice = ?'); vals.push(data.takeProfitPrice); }
      sets.push('updatedAt = CURRENT_TIMESTAMP');
      
      const key = where.id ? 'id = ?' : 'asset = ?';
      vals.push(where.id || where.asset);
      db.prepare(`UPDATE positions SET ${sets.join(', ')} WHERE ${key}`).run(...vals);
      return prisma.position.findUnique({ where });
    },
    upsert: async ({ where, create, update }: any) => {
      const existing = await prisma.position.findUnique({ where });
      if (existing) {
        return prisma.position.update({ where, data: update });
      }
      return prisma.position.create({ data: create });
    },
    delete: async ({ where }: any) => {
      const db = assertDb();
      const key = where.id ? 'id = ?' : 'asset = ?';
      const val = where.id || where.asset;
      db.prepare(`DELETE FROM positions WHERE ${key}`).run(val);
      return { id: val };
    }
  },

  portfolioSnapshot: {
    findMany: async (args?: any) => {
      const db = assertDb();
      const conditions: string[] = [];
      const params: any[] = [];
      if (args?.where?.timestamp?.gte) {
        conditions.push('timestamp >= ?');
        params.push(new Date(args.where.timestamp.gte).toISOString());
      }
      let sql = 'SELECT * FROM portfolio_snapshots';
      if (conditions.length > 0) sql += ` WHERE ${conditions.join(' AND ')}`;
      sql += ' ORDER BY timestamp ASC';
      if (args?.take) {
        sql += ' LIMIT ?';
        params.push(args.take);
      }
      return db.prepare(sql).all(...params);
    },
    findFirst: async (args?: any) => {
      const db = assertDb();
      const conditions: string[] = [];
      const params: any[] = [];
      if (args?.where?.timestamp?.lt) {
        conditions.push('timestamp < ?');
        params.push(new Date(args.where.timestamp.lt).toISOString());
      }
      if (args?.where?.timestamp?.gte) {
        conditions.push('timestamp >= ?');
        params.push(new Date(args.where.timestamp.gte).toISOString());
      }
      let sql = 'SELECT * FROM portfolio_snapshots';
      if (conditions.length > 0) sql += ` WHERE ${conditions.join(' AND ')}`;
      if (args?.orderBy?.timestamp === 'desc') {
        sql += ' ORDER BY timestamp DESC';
      } else {
        sql += ' ORDER BY timestamp ASC';
      }
      sql += ' LIMIT 1';
      return db.prepare(sql).get(...params) || null;
    },
    create: async ({ data }: any) => {
      const db = assertDb();
      const id = data.id || `snap-${Date.now()}`;
      db.prepare(`
        INSERT INTO portfolio_snapshots (
          id, totalValue, cashBalance, invested, pnlDay, pnlDayPct,
          pnlTotal, pnlTotalPct, source, timestamp
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
      `).run(
        id,
        data.totalValue,
        data.cashBalance,
        data.invested,
        data.pnlDay ?? 0,
        data.pnlDayPct ?? 0,
        data.pnlTotal ?? 0,
        data.pnlTotalPct ?? 0,
        data.source || 'VERIFIED_LEDGER'
      );
      return { id, ...data };
    }
  },

  agentDecision: {
    findMany: async (args?: any) => {
      const db = assertDb();
      const conditions: string[] = [];
      const params: any[] = [];
      if (args?.where?.asset) { conditions.push('asset = ?'); params.push(args.where.asset); }
      let sql = 'SELECT * FROM agent_decisions';
      if (conditions.length > 0) sql += ` WHERE ${conditions.join(' AND ')}`;
      sql += ' ORDER BY timestamp DESC';
      if (args?.take) { sql += ' LIMIT ?'; params.push(args.take); }
      const rows: any[] = db.prepare(sql).all(...params);
      return rows.map(r => ({
        ...r,
        executed: Boolean(r.executed),
        agentVotes: JSON.parse(r.agentVotes || '[]'),
        marketSnapshot: JSON.parse(r.marketSnapshot || '{}')
      }));
    },
    groupBy: async () => {
      const db = assertDb();
      const rows: any[] = db.prepare(`
        SELECT asset, signal, COUNT(*) as count, MAX(timestamp) as maxTime, AVG(avgConfidence) as avgConf
        FROM agent_decisions
        GROUP BY asset, signal
      `).all();
      return rows.map(r => ({
        asset: r.asset,
        signal: r.signal,
        _count: { asset: r.count },
        _max: { timestamp: r.maxTime, avgConfidence: r.avgConf }
      }));
    },
    findFirst: async ({ where }: any) => {
      const db = assertDb();
      const conditions: string[] = [];
      const params: any[] = [];
      if (where?.asset) { conditions.push('asset = ?'); params.push(where.asset); }
      let sql = 'SELECT * FROM agent_decisions';
      if (conditions.length > 0) sql += ` WHERE ${conditions.join(' AND ')}`;
      sql += ' ORDER BY timestamp DESC LIMIT 1';
      const row: any = db.prepare(sql).get(...params);
      if (!row) return null;
      return {
        ...row,
        executed: Boolean(row.executed),
        agentVotes: JSON.parse(row.agentVotes || '[]'),
        marketSnapshot: JSON.parse(row.marketSnapshot || '{}')
      };
    },
    findUnique: async ({ where }: any) => {
      const db = assertDb();
      const row: any = db.prepare('SELECT * FROM agent_decisions WHERE id = ?').get(where.id);
      if (!row) return null;
      return {
        ...row,
        executed: Boolean(row.executed),
        agentVotes: JSON.parse(row.agentVotes || '[]'),
        marketSnapshot: JSON.parse(row.marketSnapshot || '{}')
      };
    },
    create: async ({ data }: any) => {
      const db = assertDb();
      const id = data.id || `dec-${Date.now()}`;
      db.prepare(`
        INSERT INTO agent_decisions (
          id, asset, signal, finalVote, totalVotes, goVotes, noGoVotes,
          avgConfidence, executed, executionReason, agentVotes, marketSnapshot,
          regime, horizon, timestamp
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
      `).run(
        id,
        data.asset,
        data.signal,
        data.finalVote,
        data.totalVotes,
        data.goVotes,
        data.noGoVotes,
        data.avgConfidence,
        data.executed ? 1 : 0,
        data.executionReason || null,
        JSON.stringify(data.agentVotes || []),
        JSON.stringify(data.marketSnapshot || {}),
        data.regime || null,
        data.horizon || 'INTRADAY'
      );
      return prisma.agentDecision.findUnique({ where: { id } });
    },
    update: async ({ where, data }: any) => {
      const db = assertDb();
      if (data.executed !== undefined) {
        db.prepare('UPDATE agent_decisions SET executed = ? WHERE id = ?').run(data.executed ? 1 : 0, where.id);
      }
      return prisma.agentDecision.findUnique({ where });
    }
  },

  dailyJournal: {
    findMany: async () => {
      const db = assertDb();
      const rows: any[] = db.prepare('SELECT * FROM daily_journals ORDER BY date DESC').all();
      return rows.map(r => ({
        ...r,
        bestTrade: r.bestTrade ? JSON.parse(r.bestTrade) : null,
        worstTrade: r.worstTrade ? JSON.parse(r.worstTrade) : null,
        agentPerformance: r.agentPerformance ? JSON.parse(r.agentPerformance) : null,
      }));
    },
    findFirst: async ({ where }: any) => {
      const db = assertDb();
      let sql = 'SELECT * FROM daily_journals';
      const params: any[] = [];
      if (where?.date) {
        sql += ' WHERE date = ?';
        params.push(where.date);
      }
      sql += ' ORDER BY date DESC LIMIT 1';
      const r: any = db.prepare(sql).get(...params);
      if (!r) return null;
      return {
        ...r,
        bestTrade: r.bestTrade ? JSON.parse(r.bestTrade) : null,
        worstTrade: r.worstTrade ? JSON.parse(r.worstTrade) : null,
        agentPerformance: r.agentPerformance ? JSON.parse(r.agentPerformance) : null,
      };
    },
    create: async ({ data }: any) => {
      const db = assertDb();
      const id = `j-${Date.now()}`;
      db.prepare(`
        INSERT INTO daily_journals (
          id, date, summary, totalTrades, pnlDay, pnlDayPct, bestTrade, worstTrade, marketNotes, agentPerformance
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        id,
        data.date,
        data.summary,
        data.totalTrades ?? 0,
        data.pnlDay ?? 0,
        data.pnlDayPct ?? 0,
        data.bestTrade ? JSON.stringify(data.bestTrade) : null,
        data.worstTrade ? JSON.stringify(data.worstTrade) : null,
        data.marketNotes || null,
        data.agentPerformance ? JSON.stringify(data.agentPerformance) : null
      );
      return prisma.dailyJournal.findFirst({ where: { date: data.date } });
    }
  },

  prediction: {
    findMany: async (args?: any) => {
      const db = assertDb();
      const conditions: string[] = [];
      const params: any[] = [];
      if (args?.where?.status) { conditions.push('status = ?'); params.push(args.where.status); }
      if (args?.where?.category) { conditions.push('category = ?'); params.push(args.where.category); }
      if (args?.where?.resolvedAt === null) { conditions.push('resolvedAt IS NULL'); }

      let sql = 'SELECT * FROM predictions';
      if (conditions.length > 0) sql += ` WHERE ${conditions.join(' AND ')}`;
      sql += ' ORDER BY createdAt DESC';
      if (args?.take) { sql += ' LIMIT ?'; params.push(args.take); }
      return db.prepare(sql).all(...params);
    },
    findUnique: async ({ where }: any) => {
      const db = assertDb();
      return db.prepare('SELECT * FROM predictions WHERE id = ?').get(where.id) || null;
    },
    create: async ({ data }: any) => {
      const db = assertDb();
      const id = data.id || `poly-${Date.now()}`;
      db.prepare(`
        INSERT INTO predictions (
          id, asset, market, title, category, direction, confidence, yesPrice, noPrice,
          targetPrice, currentPrice, timeHorizon, edge, recommendedBet, expectedValue,
          kellyFraction, recommendedWager, reasoning, status
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        id,
        data.asset,
        data.market || 'polymarket',
        data.title || null,
        data.category || null,
        data.direction || 'BUY',
        data.confidence || 0,
        data.yesPrice ?? null,
        data.noPrice ?? null,
        data.targetPrice ?? null,
        data.currentPrice ?? null,
        data.timeHorizon || null,
        data.edge ?? null,
        data.recommendedBet || 'SKIP',
        data.expectedValue ?? null,
        data.kellyFraction ?? null,
        data.recommendedWager ?? null,
        data.reasoning || null,
        data.status || 'ACTIVE'
      );
      return prisma.prediction.findUnique({ where: { id } });
    },
    update: async ({ where, data }: any) => {
      const db = assertDb();
      const sets: string[] = [];
      const vals: any[] = [];
      if (data.status !== undefined) { sets.push('status = ?'); vals.push(data.status); }
      if (data.resolvedAt !== undefined) { sets.push('resolvedAt = ?'); vals.push(data.resolvedAt ? new Date(data.resolvedAt).toISOString() : null); }
      if (data.resolvedPrice !== undefined) { sets.push('resolvedPrice = ?'); vals.push(data.resolvedPrice); }
      if (data.wasCorrect !== undefined) { sets.push('wasCorrect = ?'); vals.push(data.wasCorrect ? 1 : 0); }
      vals.push(where.id);
      db.prepare(`UPDATE predictions SET ${sets.join(', ')} WHERE id = ?`).run(...vals);
      return prisma.prediction.findUnique({ where });
    }
  },

  guardrailLog: {
    findMany: async () => {
      const db = assertDb();
      return db.prepare('SELECT * FROM guardrail_logs ORDER BY createdAt DESC').all();
    },
    create: async ({ data }: any) => {
      const db = assertDb();
      const id = `g-${Date.now()}`;
      db.prepare('INSERT INTO guardrail_logs (id, rule, triggered, details) VALUES (?, ?, ?, ?)').run(
        id, data.rule, data.triggered ? 1 : 0, data.details || null
      );
      return { id, ...data };
    }
  },

  settings: {
    findFirst: async () => {
      const db = assertDb();
      const row: any = db.prepare('SELECT * FROM settings WHERE id = ?').get('settings-1');
      if (!row) return null;
      return { ...row, killSwitchActive: Boolean(row.killSwitchActive) };
    },
    upsert: async ({ create, update }: any) => {
      const db = assertDb();
      const existing = await prisma.settings.findFirst();
      if (!existing) {
        const id = 'settings-1';
        db.prepare(`
          INSERT INTO settings (id, tradingMode, maxPositionSizePct, maxRiskPerTradePct, dailyLossLimitPct, weeklyLossLimitPct, stopLossStocksPct, stopLossCryptoPct, takeProfitPct, minAgentConfidence, minVotesToExecute, cashReservePct, killSwitchActive)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          id, create.tradingMode || 'paper', create.maxPositionSizePct || 15, create.maxRiskPerTradePct || 2,
          create.dailyLossLimitPct || 3, create.weeklyLossLimitPct || 6, create.stopLossStocksPct || 4,
          create.stopLossCryptoPct || 6, create.takeProfitPct || 10, create.minAgentConfidence || 70,
          create.minVotesToExecute || 8, create.cashReservePct || 20, create.killSwitchActive ? 1 : 0
        );
      } else {
        await prisma.settings.update({ data: update });
      }
      return prisma.settings.findFirst();
    },
    update: async ({ data }: any) => {
      const db = assertDb();
      const sets: string[] = [];
      const vals: any[] = [];
      if (data.tradingMode !== undefined) { sets.push('tradingMode = ?'); vals.push(data.tradingMode); }
      if (data.maxPositionSizePct !== undefined) { sets.push('maxPositionSizePct = ?'); vals.push(data.maxPositionSizePct); }
      if (data.maxRiskPerTradePct !== undefined) { sets.push('maxRiskPerTradePct = ?'); vals.push(data.maxRiskPerTradePct); }
      if (data.dailyLossLimitPct !== undefined) { sets.push('dailyLossLimitPct = ?'); vals.push(data.dailyLossLimitPct); }
      if (data.stopLossStocksPct !== undefined) { sets.push('stopLossStocksPct = ?'); vals.push(data.stopLossStocksPct); }
      if (data.stopLossCryptoPct !== undefined) { sets.push('stopLossCryptoPct = ?'); vals.push(data.stopLossCryptoPct); }
      if (data.takeProfitPct !== undefined) { sets.push('takeProfitPct = ?'); vals.push(data.takeProfitPct); }
      if (data.minAgentConfidence !== undefined) { sets.push('minAgentConfidence = ?'); vals.push(data.minAgentConfidence); }
      if (data.minVotesToExecute !== undefined) { sets.push('minVotesToExecute = ?'); vals.push(data.minVotesToExecute); }
      if (data.cashReservePct !== undefined) { sets.push('cashReservePct = ?'); vals.push(data.cashReservePct); }
      if (data.killSwitchActive !== undefined) { sets.push('killSwitchActive = ?'); vals.push(data.killSwitchActive ? 1 : 0); }
      sets.push('updatedAt = CURRENT_TIMESTAMP');
      db.prepare(`UPDATE settings SET ${sets.join(', ')} WHERE id = 'settings-1'`).run(...vals);
      return prisma.settings.findFirst();
    }
  },

  debateCheckpoint: {
    findUnique: async ({ where }: any) => {
      const db = assertDb();
      const row: any = db.prepare('SELECT * FROM debate_checkpoints WHERE asset = ?').get(where.asset);
      if (!row) return null;
      return {
        ...row,
        round1Results: JSON.parse(row.round1Results || '[]'),
        round2Exchange: row.round2Exchange ? JSON.parse(row.round2Exchange) : null,
      };
    },
    create: async ({ data }: any) => {
      const db = assertDb();
      const id = `chk-${Date.now()}`;
      db.prepare(`
        INSERT INTO debate_checkpoints (id, asset, status, round1Results, round2Exchange, marketRegime)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(
        id, data.asset, data.status, JSON.stringify(data.round1Results),
        data.round2Exchange ? JSON.stringify(data.round2Exchange) : null, data.marketRegime
      );
      return { id, ...data };
    },
    update: async ({ where, data }: any) => {
      const db = assertDb();
      db.prepare('UPDATE debate_checkpoints SET status = ?, updatedAt = CURRENT_TIMESTAMP WHERE asset = ?').run(
        data.status, where.asset
      );
      return prisma.debateCheckpoint.findUnique({ where });
    },
    delete: async ({ where }: any) => {
      const db = assertDb();
      db.prepare('DELETE FROM debate_checkpoints WHERE asset = ?').run(where.asset);
      return { asset: where.asset };
    }
  },

  stockMemory: {
    findUnique: async ({ where }: any) => {
      const db = assertDb();
      const row: any = db.prepare('SELECT * FROM stock_memories WHERE symbol = ?').get(where.symbol);
      if (!row) return null;
      return {
        ...row,
        keyLessons: JSON.parse(row.keyLessons || '[]'),
        avoidConditions: JSON.parse(row.avoidConditions || '[]'),
        favorConditions: JSON.parse(row.favorConditions || '[]')
      };
    },
    upsert: async ({ where, create, update }: any) => {
      const existing = await prisma.stockMemory.findUnique({ where });
      const db = assertDb();
      if (existing) {
        db.prepare(`
          UPDATE stock_memories SET
            totalDebates = ?, totalTrades = ?, wins = ?, losses = ?, winRate = ?, avgPnlPct = ?, lastUpdated = CURRENT_TIMESTAMP
          WHERE symbol = ?
        `).run(update.totalDebates, update.totalTrades, update.wins, update.losses, update.winRate, update.avgPnlPct, where.symbol);
      } else {
        const id = `sm-${Date.now()}`;
        db.prepare(`
          INSERT INTO stock_memories (id, symbol, totalDebates, totalTrades, wins, losses, winRate, avgPnlPct)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `).run(id, create.symbol, create.totalDebates, create.totalTrades, create.wins, create.losses, create.winRate, create.avgPnlPct);
      }
      return prisma.stockMemory.findUnique({ where });
    },
    findMany: async () => {
      const db = assertDb();
      const rows: any[] = db.prepare('SELECT * FROM stock_memories').all();
      return rows.map(r => ({
        ...r,
        keyLessons: JSON.parse(r.keyLessons || '[]'),
        avoidConditions: JSON.parse(r.avoidConditions || '[]'),
        favorConditions: JSON.parse(r.favorConditions || '[]')
      }));
    }
  },

  systemLog: {
    create: async ({ data }: any) => {
      const db = assertDb();
      const id = `log-${Date.now()}`;
      db.prepare('INSERT INTO system_logs (id, level, service, message, metadata) VALUES (?, ?, ?, ?, ?)').run(
        id, data.level, data.service, data.message, data.metadata ? JSON.stringify(data.metadata) : null
      );
      return { id, ...data };
    },
    findMany: async (args?: any) => {
      const db = assertDb();
      let sql = 'SELECT * FROM system_logs ORDER BY timestamp DESC';
      const params: any[] = [];
      if (args?.take) { sql += ' LIMIT ?'; params.push(args.take); }
      return db.prepare(sql).all(...params);
    }
  },

  providerSyncRecord: {
    create: async ({ data }: any) => {
      const db = assertDb();
      const id = `sync-${Date.now()}`;
      db.prepare(`
        INSERT INTO provider_sync_records (
          id, provider, feedType, totalSynchronized, totalEligible, totalSkipped, totalStale, totalFailed, latencyMs, status
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        id, data.provider, data.feedType, data.totalSynchronized || 0, data.totalEligible || 0,
        data.totalSkipped || 0, data.totalStale || 0, data.totalFailed || 0, data.latencyMs || 0, data.status || 'SUCCESS'
      );
      return { id, ...data };
    },
    findFirst: async ({ where, orderBy }: any) => {
      const db = assertDb();
      let sql = 'SELECT * FROM provider_sync_records';
      const params: any[] = [];
      if (where?.provider) { sql += ' WHERE provider = ?'; params.push(where.provider); }
      sql += ' ORDER BY lastSyncAt DESC LIMIT 1';
      return db.prepare(sql).get(...params) || null;
    }
  },

  authAuditLog: {
    create: async ({ data }: any) => {
      const db = assertDb();
      const id = `auth-log-${Date.now()}`;
      db.prepare('INSERT INTO auth_audit_logs (id, email, ipAddress, action, success, reason) VALUES (?, ?, ?, ?, ?, ?)').run(
        id, data.email, data.ipAddress || null, data.action, data.success ? 1 : 0, data.reason || null
      );
      return { id, ...data };
    }
  },

  revokedToken: {
    create: async ({ data }: { data: { token: string; expiresAt?: Date | string } }) => {
      const db = assertDb();
      db.prepare('INSERT OR REPLACE INTO revoked_tokens (token, revokedAt, expiresAt) VALUES (?, CURRENT_TIMESTAMP, ?)').run(
        data.token,
        data.expiresAt ? new Date(data.expiresAt).toISOString() : null
      );
      return true;
    },
    findUnique: async ({ where }: { where: { token: string } }) => {
      const db = assertDb();
      const row = db.prepare('SELECT * FROM revoked_tokens WHERE token = ?').get(where.token);
      return row || null;
    }
  },

  tradeLifecycleAudit: {
    create: async ({ data }: any) => {
      const db = assertDb();
      const id = data.id || `audit-${Date.now()}-${crypto.randomUUID().slice(0, 8)}`;
      db.prepare(`
        INSERT INTO trade_lifecycle_audits (
          id, correlationId, account, provider, environment, strategy, symbol,
          previousState, newState, providerTimestamp, applicationTimestamp,
          sourceDataIds, reason, errors, retryCount, modelVersion, configVersion, metadata
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        id,
        data.correlationId,
        data.account || 'DEFAULT',
        data.provider || 'ALPACA',
        data.environment || 'paper',
        data.strategy || 'INTRADAY',
        data.symbol,
        data.previousState || null,
        data.newState,
        data.providerTimestamp ? new Date(data.providerTimestamp).toISOString() : null,
        typeof data.sourceDataIds === 'object' ? JSON.stringify(data.sourceDataIds) : (data.sourceDataIds || '[]'),
        data.reason || null,
        typeof data.errors === 'object' ? JSON.stringify(data.errors) : (data.errors || null),
        data.retryCount || 0,
        data.modelVersion || '1.0.0',
        data.configVersion || '1.0.0',
        typeof data.metadata === 'object' ? JSON.stringify(data.metadata) : (data.metadata || null)
      );
      return { id, ...data };
    },
    findMany: async ({ where, orderBy, take }: any = {}) => {
      const db = assertDb();
      let query = 'SELECT * FROM trade_lifecycle_audits';
      const params: any[] = [];
      if (where?.correlationId) {
        query += ' WHERE correlationId = ?';
        params.push(where.correlationId);
      } else if (where?.symbol) {
        query += ' WHERE symbol = ?';
        params.push(where.symbol);
      }
      query += ' ORDER BY applicationTimestamp DESC';
      if (take) {
        query += ` LIMIT ${take}`;
      }
      return db.prepare(query).all(...params);
    }
  },

  investmentThesis: {
    create: async ({ data }: any) => {
      const db = assertDb();
      const id = data.id || `thesis-${Date.now()}-${crypto.randomUUID().slice(0, 8)}`;
      db.prepare(`
        INSERT INTO investment_theses (
          id, symbol, version, thesis, targetHorizonDays, reviewConditions, invalidationConditions, valuationMultiple, targetPrice, status
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        id,
        data.symbol,
        data.version || 1,
        data.thesis,
        data.targetHorizonDays || 90,
        typeof data.reviewConditions === 'object' ? JSON.stringify(data.reviewConditions) : (data.reviewConditions || '[]'),
        typeof data.invalidationConditions === 'object' ? JSON.stringify(data.invalidationConditions) : (data.invalidationConditions || '[]'),
        data.valuationMultiple || null,
        data.targetPrice || null,
        data.status || 'ACTIVE'
      );
      return { id, ...data };
    },
    findMany: async ({ where }: any = {}) => {
      const db = assertDb();
      let query = 'SELECT * FROM investment_theses';
      const params: any[] = [];
      if (where?.symbol) {
        query += ' WHERE symbol = ?';
        params.push(where.symbol);
      }
      query += ' ORDER BY version DESC';
      return db.prepare(query).all(...params);
    },
    findFirst: async ({ where, orderBy }: any = {}) => {
      const db = assertDb();
      let query = 'SELECT * FROM investment_theses';
      const params: any[] = [];
      if (where?.symbol) {
        query += ' WHERE symbol = ?';
        params.push(where.symbol);
      }
      query += ' ORDER BY version DESC LIMIT 1';
      return db.prepare(query).get(...params) || null;
    }
  },

  eventIntelligence: {
    create: async ({ data }: any) => {
      const db = assertDb();
      const id = data.id || `event-${Date.now()}-${crypto.randomUUID().slice(0, 8)}`;
      db.prepare(`
        INSERT INTO event_intelligence (
          id, provider, originalId, url, publishedAt, receivedAt, symbols, headline,
          normalizedText, duplicateGroup, language, sentimentModel, modelVersion,
          sentimentScore, relevanceScore, noveltyScore, eventClassification, confidence,
          isScheduled, expiration, licensingStatus, evidenceStatus
        ) VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        id,
        data.provider,
        data.originalId || null,
        data.url || null,
        data.publishedAt ? new Date(data.publishedAt).toISOString() : new Date().toISOString(),
        typeof data.symbols === 'object' ? JSON.stringify(data.symbols) : (data.symbols || '[]'),
        data.headline,
        data.normalizedText || null,
        data.duplicateGroup || null,
        data.language || 'en',
        data.sentimentModel || 'FINBERT_V1',
        data.modelVersion || '1.0.0',
        data.sentimentScore || 0,
        data.relevanceScore || 0,
        data.noveltyScore || 1.0,
        data.eventClassification || 'GENERAL_NEWS',
        data.confidence || 0.8,
        data.isScheduled ? 1 : 0,
        data.expiration ? new Date(data.expiration).toISOString() : null,
        data.licensingStatus || 'VERIFIED_PUBLIC',
        data.evidenceStatus || 'VERIFIED'
      );
      return { id, ...data };
    },
    findMany: async ({ where, take }: any = {}) => {
      const db = assertDb();
      let query = 'SELECT * FROM event_intelligence';
      const params: any[] = [];
      if (where?.provider) {
        query += ' WHERE provider = ?';
        params.push(where.provider);
      }
      query += ' ORDER BY publishedAt DESC';
      if (take) {
        query += ` LIMIT ${take}`;
      }
      return db.prepare(query).all(...params);
    }
  },

  newsItem: {
    create: async ({ data }: any) => {
      const db = assertDb();
      const id = data.id || `news-${Date.now()}-${crypto.randomUUID().slice(0, 8)}`;
      db.prepare(`
        INSERT INTO news_items (id, headline, source, url, sentimentScore, sentimentLabel, assetsMentioned, summary, publishedAt)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        id,
        data.headline,
        data.source,
        data.url || null,
        data.sentimentScore || 0,
        data.sentimentLabel || 'NEUTRAL',
        typeof data.assetsMentioned === 'object' ? JSON.stringify(data.assetsMentioned) : (data.assetsMentioned || '[]'),
        data.summary || null,
        data.publishedAt ? new Date(data.publishedAt).toISOString() : new Date().toISOString()
      );
      return { id, ...data };
    },
    findMany: async ({ where, take, orderBy }: any = {}) => {
      const db = assertDb();
      let query = 'SELECT * FROM news_items';
      const params: any[] = [];
      query += ' ORDER BY publishedAt DESC';
      if (take) {
        query += ` LIMIT ${take}`;
      }
      const rows = db.prepare(query).all(...params) as any[];
      return rows.map((r: any) => {
        let assetsMentioned: string[] = [];
        if (Array.isArray(r.assetsMentioned)) {
          assetsMentioned = r.assetsMentioned;
        } else if (typeof r.assetsMentioned === 'string') {
          try {
            const parsed = JSON.parse(r.assetsMentioned);
            assetsMentioned = Array.isArray(parsed) ? parsed : [];
          } catch {
            assetsMentioned = [];
          }
        }
        return {
          ...r,
          assetsMentioned
        };
      });
    }
  },

  geopoliticalEvent: {
    create: async ({ data }: any) => {
      const db = assertDb();
      const id = data.id || `geo-${Date.now()}-${crypto.randomUUID().slice(0, 8)}`;
      db.prepare(`
        INSERT INTO geopolitical_events (
          id, title, description, eventType, severity, countries, affectedAssets,
          geoRiskScore, impactDuration, marketImpact, source, timestamp, followUpRequired, metadata
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        id,
        data.title,
        data.description,
        data.eventType || 'geopolitical',
        data.severity || 5,
        typeof data.countries === 'object' ? JSON.stringify(data.countries) : (data.countries || '[]'),
        typeof data.affectedAssets === 'object' ? JSON.stringify(data.affectedAssets) : (data.affectedAssets || '[]'),
        data.geoRiskScore || 50,
        data.impactDuration || 'unknown',
        data.marketImpact || 'neutral',
        data.source,
        data.timestamp ? new Date(data.timestamp).toISOString() : new Date().toISOString(),
        data.followUpRequired ? 1 : 0,
        data.metadata ? JSON.stringify(data.metadata) : null
      );
      return { id, ...data };
    },
    findMany: async ({ where, take, orderBy }: any = {}) => {
      const db = assertDb();
      let query = 'SELECT * FROM geopolitical_events';
      const params: any[] = [];
      query += ' ORDER BY timestamp DESC';
      if (take) {
        query += ` LIMIT ${take}`;
      }
      const rows = db.prepare(query).all(...params) as any[];
      return rows.map((r: any) => {
        let countries: string[] = [];
        let affectedAssets: string[] = [];
        let metadata: any = null;
        try {
          countries = Array.isArray(r.countries) ? r.countries : JSON.parse(r.countries || '[]');
        } catch {
          countries = [];
        }
        try {
          affectedAssets = Array.isArray(r.affectedAssets) ? r.affectedAssets : JSON.parse(r.affectedAssets || '[]');
        } catch {
          affectedAssets = [];
        }
        try {
          metadata = r.metadata ? JSON.parse(r.metadata) : null;
        } catch {
          metadata = null;
        }
        return {
          ...r,
          countries,
          affectedAssets,
          metadata
        };
      });
    }
  }
};
