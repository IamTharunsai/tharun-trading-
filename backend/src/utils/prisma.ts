// ── DATABASE ─────────────────────────────────────────────────────────────────
// PostgreSQL through Prisma (Railway Postgres in production, docker-compose
// Postgres locally). DATABASE_URL is required.
//
// History: for three commits (Sep 25-28 2026) this file was a hand-written
// SQLite imitation of the Prisma API. It never reached production (those
// builds failed), silently ignored unknown filters (e.g. closedAt, orderBy
// totalValue), compared dates as strings, and had no tables for self-learning
// (agentLesson / agentPerformance / agentLearningState) or fundamentals. The
// real client is typed, so the compiler now catches field mismatches.
import bcrypt from 'bcryptjs';
import { PrismaClient } from '@prisma/client';
import { logger } from './logger';

export const prisma = new PrismaClient({
  log: process.env.PRISMA_LOG_QUERIES === 'true' ? ['query', 'warn', 'error'] : ['warn', 'error'],
});

let lastHealth = { healthy: false, error: null as string | null, checkedAt: 0 };

export async function checkDatabaseHealth() {
  try {
    await prisma.$queryRaw`SELECT 1`;
    lastHealth = { healthy: true, error: null, checkedAt: Date.now() };
  } catch (err: any) {
    lastHealth = { healthy: false, error: err?.message || String(err), checkedAt: Date.now() };
  }
  return { ...lastHealth, engine: 'PostgreSQL (Prisma)', timestamp: new Date().toISOString() };
}

/**
 * First-boot data: the singleton settings row and, if OWNER_EMAIL plus
 * OWNER_PASSWORD (or OWNER_PASSWORD_HASH) are set and no owner exists yet,
 * the owner account. Never overwrites an existing owner.
 */
export async function bootstrapDatabase(): Promise<void> {
  await prisma.settings.upsert({ where: { id: 'settings-1' }, create: { id: 'settings-1' }, update: {} });

  const owner = await prisma.user.findFirst({ where: { role: 'OWNER' } });
  if (owner) return;

  const email = process.env.OWNER_EMAIL?.trim().toLowerCase();
  const password = process.env.OWNER_PASSWORD;
  const hash = process.env.OWNER_PASSWORD_HASH;
  if (!email || (!password && !hash)) {
    logger.info('ℹ️ No owner account yet. Set OWNER_EMAIL + OWNER_PASSWORD, or call /api/auth/setup-owner with OWNER_SETUP_TOKEN.');
    return;
  }
  // An existing user with that email (e.g. from the pre-role schema) becomes the owner.
  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    await prisma.user.update({ where: { id: existing.id }, data: { role: 'OWNER' } });
    logger.info(`✅ Existing user ${email} marked as owner`);
    return;
  }
  await prisma.user.create({
    data: { email, passwordHash: hash || bcrypt.hashSync(password!, 10), role: 'OWNER' },
  });
  logger.info(`✅ Provisioned owner account for ${email} from environment`);
}

process.on('beforeExit', async () => {
  await prisma.$disconnect().catch(() => {});
});
