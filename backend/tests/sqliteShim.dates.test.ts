// The SQLite layer stores CURRENT_TIMESTAMP ('YYYY-MM-DD HH:MM:SS') but callers
// filter with ISO strings ('YYYY-MM-DDTHH:MM:SS.sssZ'). Plain string comparison
// treated today's rows as older than "today", so the daily-trade limit and
// start-of-day P&L never worked. These run against a real temp database.
import os from 'os';
import path from 'path';
import fs from 'fs';

const dbFile = path.join(os.tmpdir(), `shim-${Date.now()}.db`);
process.env.SQLITE_DB_PATH = dbFile;
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { prisma } = require('../src/utils/prisma');

afterAll(() => { for (const f of [dbFile, dbFile + '-wal', dbFile + '-shm']) { try { fs.unlinkSync(f); } catch {} } });

describe('SQLite shim date + ordering fixes', () => {
  it('counts trades opened today', async () => {
    await prisma.trade.create({ data: { asset: 'AAA', market: 'stocks', type: 'BUY', entryPrice: 1, quantity: 1 } });
    const start = new Date(Date.now() - 60 * 60 * 1000);
    expect(await prisma.trade.count({ where: { openedAt: { gte: start } } })).toBe(1);
  });

  it('filters closed trades by closedAt (post-trade learning no longer re-scans every trade)', async () => {
    const t = await prisma.trade.create({ data: { asset: 'BBB', market: 'stocks', type: 'BUY', entryPrice: 1, quantity: 1 } });
    await prisma.trade.update({ where: { id: t.id }, data: { status: 'CLOSED', closedAt: new Date(Date.now() - 10 * 86400000) } });
    const recent = await prisma.trade.findMany({ where: { status: 'CLOSED', closedAt: { gte: new Date(Date.now() - 5 * 60 * 1000) } } });
    expect(recent.find((r: any) => r.id === t.id)).toBeUndefined();
  });

  it('returns the true peak snapshot when ordering by totalValue', async () => {
    await prisma.portfolioSnapshot.create({ data: { id: 's1', totalValue: 100, cashBalance: 100, invested: 0 } });
    await prisma.portfolioSnapshot.create({ data: { id: 's2', totalValue: 140, cashBalance: 140, invested: 0 } });
    await prisma.portfolioSnapshot.create({ data: { id: 's3', totalValue: 120, cashBalance: 120, invested: 0 } });
    const peak = await prisma.portfolioSnapshot.findFirst({ orderBy: { totalValue: 'desc' } });
    expect(peak.totalValue).toBe(140);
  });

  it('re-opening a closed asset overwrites side and entry price', async () => {
    await prisma.position.create({ data: { asset: 'CCC', market: 'stocks', side: 'BUY', quantity: 1, entryPrice: 10, stopLossPrice: 9, takeProfitPrice: 12 } });
    await prisma.position.update({ where: { asset: 'CCC' }, data: { status: 'CLOSED' } });
    await prisma.position.upsert({ where: { asset: 'CCC' }, create: {}, update: { side: 'BUY', entryPrice: 50, quantity: 2, status: 'OPEN' } });
    const p = await prisma.position.findUnique({ where: { asset: 'CCC' } });
    expect(p.entryPrice).toBe(50);
    expect(await prisma.position.count({ where: { status: 'OPEN' } })).toBe(1);
  });
});
