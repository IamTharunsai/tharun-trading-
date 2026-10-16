// CI-only disposable database fixture; no target service or broker imports.
const { PrismaClient } = require('@prisma/client');
if (process.env.DATABASE_URL !== 'postgresql://fixture:fixture@127.0.0.1:5432/fixture') throw Error('Disposable fixture required');
const db = new PrismaClient();
(async () => {
  if (process.argv[2] === 'seed') {
    await db.$executeRawUnsafe(`INSERT INTO "PortfolioSnapshot" (id, "totalValue", "cashBalance", invested, "pnlDay", "pnlDayPct", "pnlTotal", "pnlTotalPct", source, timestamp) VALUES ('cashflow-legacy',90000,90000,0,-10000,-10,-100,0,'LEGACY',NOW())`);
  } else {
    const row = await db.portfolioSnapshot.findUniqueOrThrow({ where: { id: 'cashflow-legacy' } });
    if (row.accountId !== null || row.brokerMode !== null || row.totalValue !== 90000 || row.pnlDay !== -10000 || row.pnlTotal !== -100 || row.riskDataComplete !== false || row.adjustedDailyPnl !== null) throw Error('Legacy observations changed');
    console.log('Legacy NAV, ownership and recorded loss preserved; risk remains explicitly unverified.');
  }
})().finally(() => db.$disconnect()).catch(error => { console.error(error.message); process.exitCode = 1; });
