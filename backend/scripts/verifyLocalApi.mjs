import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';
const config = JSON.parse(await readFile(new URL('../.local-paper/connection.json', import.meta.url), 'utf8'));
assert.equal(config.host, '127.0.0.1');
assert.equal(config.port, 55432);
assert.equal(config.database, 'apex_paper_local');
const prisma = new PrismaClient({ datasources: { db: { url: `postgresql://${encodeURIComponent(config.user)}:${encodeURIComponent(config.password)}@127.0.0.1:55432/apex_paper_local` } } });
const base = 'http://127.0.0.1:4100';
const password = randomUUID();
let user;
let trade;
try {
  const health = await (await fetch(`${base}/health`)).json();
  assert.equal(health.mode, 'paper');
  assert.equal(health.backgroundJobsEnabled, false);
  assert.equal((await fetch(`${base}/api/trades`)).status, 401);
  user = await prisma.user.create({ data: { email: `smoke-${randomUUID()}@example.invalid`, passwordHash: await bcrypt.hash(password, 10) } });
  const login = await fetch(`${base}/api/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: user.email, password }) });
  assert.equal(login.status, 200);
  const { token } = await login.json();
  assert.ok(token);
  trade = await prisma.trade.create({ data: { asset: `SMOKE-${randomUUID()}`, market: 'stocks', type: 'BUY', entryPrice: 100, quantity: 1 } });
  const headers = { Authorization: `Bearer ${token}` };
  const pending = await (await fetch(`${base}/api/trades?status=PENDING&asset=${trade.asset}`, { headers })).json();
  assert.equal(pending.total, 1);
  assert.equal(pending.trades[0].status, 'PENDING');
  const open = await (await fetch(`${base}/api/trades?status=OPEN&asset=${trade.asset}`, { headers })).json();
  assert.equal(open.total, 0);
  console.log('PASS: running API health, paper mode, background jobs off, authentication, login, pending/filled separation');
} finally {
  if (trade) await prisma.trade.delete({ where: { id: trade.id } });
  if (user) await prisma.user.delete({ where: { id: user.id } });
  await prisma.$disconnect();
}
