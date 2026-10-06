// Integration tests against a real Postgres (the production datastore).
// Run with: TEST_DATABASE_URL=postgresql://... npx jest postgres.integration
// Skipped automatically when TEST_DATABASE_URL is not set.
const url = process.env.TEST_DATABASE_URL;
const d = url ? describe : describe.skip;

d('Postgres data layer', () => {
  let prisma: any;
  beforeAll(async () => {
    process.env.DATABASE_URL = url;
    ({ prisma } = require('../src/utils/prisma'));
    await prisma.trade.deleteMany({ where: { asset: { startsWith: 'ZZTEST' } } });
    await prisma.position.deleteMany({ where: { asset: { startsWith: 'ZZTEST' } } });
  });
  afterAll(async () => { await prisma?.$disconnect(); });

  it('bootstraps settings and persists the kill switch', async () => {
    const { bootstrapDatabase } = require('../src/utils/prisma');
    await bootstrapDatabase();
    const orch = require('../src/agents/orchestrator');
    orch.activateKillSwitch();
    await new Promise(r => setTimeout(r, 200));
    expect(await orch.loadKillSwitchState()).toBe(true);
    orch.deactivateKillSwitch();
    await new Promise(r => setTimeout(r, 200));
    expect(await orch.loadKillSwitchState()).toBe(false);
  });

  it('accepts the new trade statuses and filters by closedAt', async () => {
    const t = await prisma.trade.create({ data: { asset: 'ZZTEST1', market: 'stocks', type: 'BUY', entryPrice: 10, quantity: 1, status: 'PENDING' } });
    await prisma.trade.update({ where: { id: t.id }, data: { status: 'OPEN', reconciliationStatus: 'UNCONFIRMED_LOCAL_SIMULATION' } });
    await prisma.trade.update({ where: { id: t.id }, data: { status: 'CLOSED', closedAt: new Date(Date.now() - 10 * 86400000) } });
    const recent = await prisma.trade.findMany({ where: { status: 'CLOSED', closedAt: { gte: new Date(Date.now() - 5 * 60000) } } });
    expect(recent.find((r: any) => r.id === t.id)).toBeUndefined();
  });

  it('re-opens a closed position with a new side/entry and protection status', async () => {
    await prisma.position.create({ data: { asset: 'ZZTEST2', market: 'stocks', side: 'BUY', quantity: 1, entryPrice: 10, currentPrice: 10, stopLossPrice: 9, takeProfitPrice: 12, status: 'CLOSED' } });
    await prisma.position.upsert({ where: { asset: 'ZZTEST2' }, create: { asset: 'ZZTEST2', market: 'stocks', quantity: 2, entryPrice: 50, currentPrice: 50, stopLossPrice: 45, takeProfitPrice: 60 }, update: { entryPrice: 50, quantity: 2, status: 'OPEN', protectionStatus: 'BROKER_HOSTED' } });
    const p = await prisma.position.findUnique({ where: { asset: 'ZZTEST2' } });
    expect(p.entryPrice).toBe(50);
    expect(p.protectionStatus).toBe('BROKER_HOSTED');
  });
});
