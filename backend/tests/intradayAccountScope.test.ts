jest.mock('axios', () => ({ __esModule: true, default: { get: jest.fn() } }));
jest.mock('../src/utils/prisma', () => ({ prisma: { trade: { findMany: jest.fn(), count: jest.fn() }, position: { findMany: jest.fn() } } }));
jest.mock('../src/utils/logger', () => ({ logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() } }));
jest.mock('../src/services/universeService', () => ({ universe: { intradayCandidates: jest.fn().mockReturnValue([]) } }));
jest.mock('../src/utils/llmRouter', () => ({}));
jest.mock('../src/trading/riskManager', () => ({ closePosition: jest.fn() }));
jest.mock('../src/agents/orchestrator', () => ({ isKillSwitchActive: () => false }));
jest.mock('../src/trading/accountScope', () => ({ getVerifiedAccountScope: jest.fn() }));
import axios from 'axios';
import { prisma } from '../src/utils/prisma';
import { universe } from '../src/services/universeService';
import { getVerifiedAccountScope } from '../src/trading/accountScope';
import { getIntradayStatus, runIntradayScan } from '../src/trading/intradayEngine';

const original = { ...process.env };
const scope = { accountId: 'current-account', mode: 'paper', broker: {} };
const foreignLoss = { status: 'CLOSED', pnl: -10000, metadata: { lane: 'INTRADAY' } };
beforeEach(() => {
  jest.clearAllMocks(); process.env.INTRADAY_ENABLED = 'true';
  (getVerifiedAccountScope as jest.Mock).mockResolvedValue(scope);
  (axios.get as jest.Mock).mockResolvedValue({ data: { is_open: true } });
  (prisma.trade.findMany as jest.Mock).mockImplementation(async ({ where }) =>
    where.accountId === scope.accountId && where.brokerMode === scope.mode ? [] : [foreignLoss]);
  (prisma.position.findMany as jest.Mock).mockImplementation(async ({ where }) =>
    where.accountId === scope.accountId && where.brokerMode === scope.mode ? [{ asset: 'CURRENT_HELD' }] : [{ asset: 'FOREIGN_HELD' }]);
  (prisma.trade.count as jest.Mock).mockImplementation(async ({ where }) =>
    where.accountId === scope.accountId && where.brokerMode === scope.mode ? 0 : 150);
});
afterAll(() => { process.env = original; });

test('foreign account/mode losses, open caps and holdings cannot suppress current-account discovery', async () => {
  const result = await runIntradayScan({ force: true });
  expect(result?.note).toBe('universe not synced yet');
  expect(universe.intradayCandidates).toHaveBeenCalledWith(expect.any(Number), expect.objectContaining({ exclude: new Set(['CURRENT_HELD']) }));
  expect(prisma.trade.count).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ accountId: scope.accountId, brokerMode: scope.mode }) }));
  expect(await getIntradayStatus()).toMatchObject({ tradesToday: 0, realizedPnlToday: 0 });
});

test('current-account loss still stops discovery', async () => {
  (prisma.trade.findMany as jest.Mock).mockResolvedValue([foreignLoss]);
  expect((await runIntradayScan({ force: true }))?.note).toMatch(/daily loss limit/);
  expect(universe.intradayCandidates).not.toHaveBeenCalled();
});

test('failed current open-count evidence cannot become zero free slots', async () => {
  (prisma.trade.count as jest.Mock).mockRejectedValue(new Error('COUNT_UNAVAILABLE'));
  expect((await runIntradayScan({ force: true }))?.note).toMatch(/COUNT_UNAVAILABLE/);
  expect(universe.intradayCandidates).not.toHaveBeenCalled();
});

test('unverified account or failed history stays unavailable in status', async () => {
  (getVerifiedAccountScope as jest.Mock).mockRejectedValueOnce(new Error('ACCOUNT_AUTHORITY_UNAVAILABLE'));
  await expect(getIntradayStatus()).rejects.toThrow('ACCOUNT_AUTHORITY_UNAVAILABLE');
  expect(prisma.trade.findMany).not.toHaveBeenCalled();
  (prisma.trade.findMany as jest.Mock).mockRejectedValueOnce(new Error('HISTORY_UNAVAILABLE'));
  await expect(getIntradayStatus()).rejects.toThrow('HISTORY_UNAVAILABLE');
});
