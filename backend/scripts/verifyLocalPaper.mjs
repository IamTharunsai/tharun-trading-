// Uses only the isolated local database; submits no broker orders.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';
const config = JSON.parse(await readFile(new URL('../.local-paper/connection.json', import.meta.url), 'utf8'));
assert.equal(config.host, '127.0.0.1');
assert.equal(config.port, 55432);
assert.equal(config.database, 'apex_paper_local');
assert.equal(config.user, 'apex_local');
process.env.DATABASE_URL = `postgresql://${config.user}:${encodeURIComponent(config.password)}@127.0.0.1:55432/apex_paper_local`;
process.env.TRADING_MODE = 'paper';
const require = createRequire(import.meta.url);
const { prisma } = require('../dist/utils/prisma.js');
const { applyEntryObservation } = require('../dist/trading/paperOrderLifecycle.js');
const asset = `TEST-${randomUUID()}`;
const assetRollback = `${asset}-rollback`;
const tradeIds = [];
async function reserve(symbol) {
  const trade = await prisma.trade.create({ data: { asset: symbol, market: 'stocks', type: 'BUY', entryPrice: 100,
    quantity: 1, stopLossPrice: 95, takeProfitPrice: 110 } });
  tradeIds.push(trade.id);
  return trade;
}
try {
  const trade = await reserve(asset);
  const observation = { id: `test-${trade.id}`, status: 'filled', filled_qty: '1', filled_avg_price: '101', symbol: asset, side: 'buy' };
  const results = await Promise.all(Array.from({ length: 8 }, () => applyEntryObservation(trade, observation)));
  assert.equal(results.filter(Boolean).length, 1, 'Exactly one concurrent poll must claim the fill');
  assert.equal(await prisma.position.count({ where: { asset } }), 1);
  assert.equal((await prisma.trade.findUniqueOrThrow({ where: { id: trade.id } })).entryPrice, 101);
  await prisma.position.update({ where: { asset }, data: { status: 'CLOSED' } });
  assert.equal(await applyEntryObservation(trade, observation), false);
  assert.equal((await prisma.position.findUniqueOrThrow({ where: { asset } })).status, 'CLOSED');
  console.log('PASS: concurrent fill claim, exact fill price, no position resurrection');

  const conflicted = await reserve(assetRollback);
  await prisma.position.create({ data: { asset: assetRollback, market: 'stocks', quantity: 2, entryPrice: 90,
    currentPrice: 90, stopLossPrice: 85, takeProfitPrice: 100 } });
  await assert.rejects(applyEntryObservation(conflicted, { ...observation, symbol: assetRollback }), /Existing position/);
  assert.equal((await prisma.trade.findUniqueOrThrow({ where: { id: conflicted.id } })).brokerConfirmed, false);
  assert.equal((await prisma.position.findUniqueOrThrow({ where: { asset: assetRollback } })).quantity, 2);
  console.log('PASS: transaction rollback preserves pending trade and pre-existing position');

  let active = 0;
  let maximum = 0;
  await Promise.all(Array.from({ length: 6 }, () => prisma.$transaction(async tx => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(784321)`;
    active++;
    maximum = Math.max(maximum, active);
    await tx.$executeRaw`SELECT pg_sleep(0.03)`;
    active--;
  })));
  assert.equal(maximum, 1, 'Entry reservation lock must serialize concurrent transactions');
  console.log('PASS: PostgreSQL advisory lock serializes concurrent reservations');
} finally {
  await prisma.position.deleteMany({ where: { asset: { in: [asset, assetRollback] } } });
  await prisma.trade.deleteMany({ where: { id: { in: tradeIds } } });
  await prisma.$disconnect();
}
