const assert = require('node:assert/strict');
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
async function run() {
  assert.equal(process.env.DATABASE_URL, 'postgresql://fixture:fixture@127.0.0.1:5432/fixture');
  if (process.argv[2] === 'seed') {
    await prisma.$executeRawUnsafe(`INSERT INTO "Position" ("id", "asset", "market", "quantity", "entryPrice", "currentPrice", "stopLossPrice", "takeProfitPrice", "updatedAt") VALUES ('legacy-evidence-position','LEGACY','stocks',10,100,90,80,120,TIMESTAMP '2026-10-01 00:00:00')`);
    await prisma.$executeRawUnsafe(`INSERT INTO "Trade" ("id", "asset", "market", "type", "entryPrice", "quantity", "closedQuantity", "realizedPnl", "exitNotional", "positionId", "updatedAt") VALUES ('legacy-evidence-trade','LEGACY','stocks','BUY',100,10,4,-40,360,'legacy-evidence-position',TIMESTAMP '2026-10-01 00:00:00')`);
    return;
  }
  assert.equal(process.argv[2], 'verify');
  const position = await prisma.position.findUniqueOrThrow({ where: { id: 'legacy-evidence-position' } });
  const trade = await prisma.trade.findUniqueOrThrow({ where: { id: 'legacy-evidence-trade' } });
  assert.equal(position.quantity, 10); assert.equal(position.entryPrice, 100);
  assert.equal(position.accountId, null); assert.equal(position.scopeKey, null);
  assert.equal(position.accountingStatus, 'UNVERIFIED'); assert.equal(position.brokerObservedQuantity, null);
  assert.equal(position.updatedAt.toISOString(), '2026-10-01T00:00:00.000Z');
  assert.equal(trade.quantity, 10); assert.equal(trade.closedQuantity, 4); assert.equal(trade.realizedPnl, -40);
  assert.equal(trade.entryPrice, 100); assert.equal(trade.feeQuantity, 0); assert.equal(trade.actualFeeCash, 0);
  assert.equal(await prisma.brokerOrderEvidence.count(), 0); assert.equal(await prisma.brokerActivity.count(), 0);
  console.log('Legacy execution basis and partial realized loss preserved; new accounting remains explicitly unverified.');
}
run().catch(error => { console.error(error.message); process.exitCode = 1; }).finally(() => prisma.$disconnect());
