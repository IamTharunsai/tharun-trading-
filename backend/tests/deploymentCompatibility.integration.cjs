// CI-only disposable PostgreSQL regression. Never point this at a live database.
const assert = require('node:assert/strict');
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const phase = process.argv[2];

async function run() {
  assert.match(process.env.DATABASE_URL || '', /^postgresql:\/\/postgres:postgres@localhost:5432\/deployment_fixture$/);
  if (phase === 'seed') {
    await prisma.$executeRawUnsafe(`INSERT INTO "Position" ("id", "asset", "market", "quantity", "entryPrice", "currentPrice", "stopLossPrice", "takeProfitPrice", "updatedAt")
      SELECT 'legacy-' || i, 'FIXTURE' || i, 'stock', i, 12.5, 11.5, 10, 15, TIMESTAMP '2026-10-01 00:00:00' FROM generate_series(1, 113) AS i`);
    return;
  }
  assert.equal(phase, 'verify');
  const rows = await prisma.position.findMany({ orderBy: { asset: 'asc' } });
  assert.equal(rows.length, 113, 'Deployment must preserve every historical position');
  for (const row of rows) {
    const i = Number(row.id.slice('legacy-'.length));
    assert.equal(row.asset, `FIXTURE${i}`);
    assert.equal(row.quantity, i);
    assert.equal(row.entryPrice, 12.5);
    assert.equal(row.currentPrice, 11.5);
    assert.equal(row.scopeKey, null);
    assert.equal(row.accountId, null);
    assert.equal(row.brokerMode, null);
    assert.equal(row.updatedAt.toISOString(), '2026-10-01T00:00:00.000Z');
  }
  const data = { asset: 'SCOPED', market: 'stock', quantity: 1, entryPrice: 12.5, currentPrice: 12.5, stopLossPrice: 10, takeProfitPrice: 15 };
  const key = 'fixture:paper:SCOPED';
  await prisma.position.create({ data: { ...data, scopeKey: key, accountId: 'fixture', brokerMode: 'paper' } });
  await assert.rejects(prisma.position.create({ data: { ...data, scopeKey: key, accountId: 'fixture', brokerMode: 'paper' } }), error => error.code === 'P2002');
  await prisma.position.create({ data: { ...data, scopeKey: 'fixture:live:SCOPED', accountId: 'fixture', brokerMode: 'live' } });
  console.log('113 historical rows preserved; verified scope uniqueness and account/mode separation enforced.');
}
run().catch(error => { console.error(error); process.exitCode = 1; }).finally(() => prisma.$disconnect());
