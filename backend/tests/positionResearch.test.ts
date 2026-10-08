jest.mock('../src/utils/prisma', () => ({ prisma: { positionResearch: { upsert: jest.fn(), findMany: jest.fn(), updateMany: jest.fn() }, agentDecision: { findFirst: jest.fn() } } }));
jest.mock('../src/services/portfolio', () => ({ getPortfolioState: jest.fn() }));
jest.mock('../src/services/marketData', () => ({ buildMarketSnapshot: jest.fn() }));
jest.mock('../src/agents/debateEngine', () => ({ runInvestmentCommitteeDebate: jest.fn() }));
jest.mock('../src/trading/brokerRouter', () => ({ getActiveMode: jest.fn(() => 'paper') }));
jest.mock('../src/agents/orchestrator', () => ({ isKillSwitchActive: jest.fn(() => false) }));
jest.mock('../src/services/regimeDetector', () => ({ detectMarketRegime: jest.fn().mockResolvedValue({ regime: 'TRENDING_BULL' }) }));
const mockBroker = { listPositionsVerified: jest.fn() };
jest.mock('../src/trading/accountScope', () => ({ brokerSymbol: (asset: string) => asset,
  getVerifiedAccountScope: jest.fn(() => Promise.resolve({ broker: mockBroker, accountId: 'paper-account', mode: 'paper' })) }));
import { prisma } from '../src/utils/prisma';
import { getPortfolioState } from '../src/services/portfolio';
import { buildMarketSnapshot } from '../src/services/marketData';
import { runInvestmentCommitteeDebate } from '../src/agents/debateEngine';
import { isKillSwitchActive } from '../src/agents/orchestrator';
import { reviewOpenPositions, getPositionResearchStatus, getPositionResearchDecision, researchCycleKey } from '../src/services/positionResearch';
const position = { id: 'position-1', asset: 'AAPL', market: 'stocks', side: 'BUY', status: 'OPEN', quantity: 3,
  accountId: 'paper-account', brokerMode: 'paper', entryPrice: 100, stopLossPrice: 98, takeProfitPrice: 105,
  openedAt: new Date('2025-01-01T00:00:00Z') };
const portfolio = { accountId: 'paper-account', brokerMode: 'paper', positions: [position], totalValue: 1000 };
const cycleKey = researchCycleKey(position, 'paper-account', 'paper');
const row = { id: 'research-1', cycleKey, positionId: position.id };
beforeEach(() => {
  jest.clearAllMocks(); delete process.env.POSITION_REVIEW_INTERVAL_HOURS; delete process.env.MAX_SNAPSHOT_AGE_MS;
  (isKillSwitchActive as jest.Mock).mockReturnValue(false);
  (getPortfolioState as jest.Mock).mockResolvedValue(portfolio);
  mockBroker.listPositionsVerified.mockResolvedValue([{ symbol: 'AAPL', asset_class: 'us_equity', side: 'long', qty: '3', avg_entry_price: '100' }]);
  (prisma.positionResearch.upsert as jest.Mock).mockResolvedValue(row);
  (prisma.positionResearch.findMany as jest.Mock).mockResolvedValue([row]);
  (prisma.positionResearch.updateMany as jest.Mock).mockResolvedValue({ count: 1 });
  (buildMarketSnapshot as jest.Mock).mockResolvedValue({ asset: 'AAPL', market: 'stocks', price: 101,
    timestamp: Date.now(),
    indicators: { macd: { histogram: 1 }, bollingerBands: { upper: 105, lower: 95, middle: 100 } } });
  (runInvestmentCommitteeDebate as jest.Mock).mockResolvedValue({ purpose: 'POSITION_REVIEW', decisionId: 'review-decision',
    executionApproved: false, positionSizePct: 0, finalDecision: 'SELL', agentVotes: Array.from({ length: 14 }, (_, i) => ({ agentId: i + 1, executionEligible: true, vote: 'SELL' })) });
});
test('leases current-account holding research and persists disagreement without placing an order', async () => {
  const result = await reviewOpenPositions();
  expect(result[0]).toMatchObject({ status: 'COMPLETE', observation: 'THESIS_CONTRADICTED' });
  expect(runInvestmentCommitteeDebate).toHaveBeenCalledWith(expect.anything(), portfolio, 'TRENDING_BULL', expect.anything(), 'COUNCIL',
    expect.objectContaining({ positionId: position.id, quantity: 3, accountId: 'paper-account', brokerMode: 'paper' }),
    expect.objectContaining({ signal: expect.anything(), beforeCall: expect.any(Function) }));
  expect(prisma.positionResearch.updateMany).toHaveBeenLastCalledWith(expect.objectContaining({
    where: expect.objectContaining({ accountId: 'paper-account', leaseToken: expect.any(String), leaseUntil: expect.anything() }),
    data: expect.objectContaining({ status: 'COMPLETE', decisionId: 'review-decision', observation: 'THESIS_CONTRADICTED' }) }));
});
test('another replica’s failed lease claim never calls the paid council', async () => {
  (prisma.positionResearch.updateMany as jest.Mock).mockResolvedValueOnce({ count: 0 });
  expect((await reviewOpenPositions())[0].status).toBe('LEASE_NOT_ACQUIRED');
  expect(runInvestmentCommitteeDebate).not.toHaveBeenCalled();
});
test('persisted cadence and valid leases are part of selection and are not reset by startup', async () => {
  (prisma.positionResearch.findMany as jest.Mock).mockResolvedValueOnce([]);
  await reviewOpenPositions();
  expect(prisma.positionResearch.upsert).toHaveBeenCalledWith(expect.objectContaining({ update: {} }));
  expect(prisma.positionResearch.findMany).toHaveBeenCalledWith(expect.objectContaining({ take: 2,
    where: expect.objectContaining({ accountId: 'paper-account', brokerMode: 'paper', nextReviewAt: expect.anything(), OR: expect.any(Array) }) }));
  expect(runInvestmentCommitteeDebate).not.toHaveBeenCalled();
});
test('changed/closed holdings cannot be labeled as a completed current review', async () => {
  (getPortfolioState as jest.Mock).mockResolvedValueOnce(portfolio).mockResolvedValueOnce({ ...portfolio, positions: [] });
  expect((await reviewOpenPositions())[0]).toMatchObject({ status: 'FAILED', error: 'POSITION_CHANGED_DURING_REVIEW' });
});
test('failed sources or accidental execution approval do not produce monitoring success', async () => {
  (runInvestmentCommitteeDebate as jest.Mock).mockResolvedValueOnce({ purpose: 'POSITION_REVIEW', decisionId: 'x', executionApproved: true, positionSizePct: 1 });
  expect((await reviewOpenPositions())[0].error).toBe('REVIEW_AUTHORITY_INVALID');
  (runInvestmentCommitteeDebate as jest.Mock).mockResolvedValueOnce({ purpose: 'POSITION_REVIEW', decisionId: 'x', executionApproved: false, positionSizePct: 0, agentVotes: [] });
  expect((await reviewOpenPositions())[0].error).toBe('REVIEW_EVIDENCE_INCOMPLETE');
});
test('expired/changed ownership cannot overwrite a newer worker’s result', async () => {
  (prisma.positionResearch.updateMany as jest.Mock).mockResolvedValueOnce({ count: 1 }).mockResolvedValueOnce({ count: 0 });
  expect((await reviewOpenPositions())[0].status).toBe('LEASE_LOST');
});
test('broker changes or unavailable holding evidence prevent paid research and false completion', async () => {
  mockBroker.listPositionsVerified.mockResolvedValueOnce([]);
  expect((await reviewOpenPositions())[0].error).toBe('BROKER_HOLDING_REQUIRES_RECONCILIATION');
  expect(runInvestmentCommitteeDebate).not.toHaveBeenCalled();
  mockBroker.listPositionsVerified.mockResolvedValueOnce([{ symbol: 'AAPL', asset_class: 'us_equity', side: 'long', qty: '3', avg_entry_price: '100' }]).mockResolvedValueOnce([]);
  expect((await reviewOpenPositions())[0].error).toBe('BROKER_HOLDING_REQUIRES_RECONCILIATION');
});
test('kill mode and foreign-account positions do not start research', async () => {
  (isKillSwitchActive as jest.Mock).mockReturnValueOnce(true);
  expect(await reviewOpenPositions()).toEqual([]); expect(getPortfolioState).not.toHaveBeenCalled();
  (getPortfolioState as jest.Mock).mockResolvedValueOnce({ ...portfolio, positions: [{ ...position, accountId: 'other-account' }] });
  expect(await reviewOpenPositions()).toEqual([]); expect(runInvestmentCommitteeDebate).not.toHaveBeenCalled();
});
test('reopened holdings have distinct durable cycles and status reads remain scoped', async () => {
  expect(researchCycleKey({ ...position, openedAt: new Date('2025-01-02') }, 'paper-account', 'paper')).not.toBe(cycleKey);
  await getPositionResearchStatus();
  expect(prisma.positionResearch.findMany).toHaveBeenLastCalledWith(expect.objectContaining({
    where: { accountId: 'paper-account', brokerMode: 'paper', cycleKey: { in: [cycleKey] } } }));
});
test('overlapping scheduler passes do not start another paid research batch', async () => {
  let release!: (value: any) => void;
  (getPortfolioState as jest.Mock).mockImplementationOnce(() => new Promise(resolve => { release = resolve; }));
  const first = reviewOpenPositions();
  expect(await reviewOpenPositions()).toEqual([]);
  expect(getPortfolioState).toHaveBeenCalledTimes(1);
  release(portfolio);
  expect((await first)[0].status).toBe('COMPLETE');
});
test('stale evidence or changed protection never becomes a completed current review', async () => {
  (buildMarketSnapshot as jest.Mock).mockResolvedValueOnce({ asset: 'AAPL', market: 'stocks', price: 101, timestamp: Date.now() - 400000,
    indicators: { macd: { histogram: 1 }, bollingerBands: { upper: 105, lower: 95, middle: 100 } } });
  expect((await reviewOpenPositions())[0].error).toBe('REVIEW_SNAPSHOT_STALE');
  (getPortfolioState as jest.Mock).mockResolvedValueOnce(portfolio).mockResolvedValueOnce({ ...portfolio, positions: [{ ...position, stopLossPrice: 99 }] });
  expect((await reviewOpenPositions())[0].error).toBe('POSITION_CHANGED_DURING_REVIEW');
});
test('private review detail requires a current account/cycle reference before returning data', async () => {
  (prisma.positionResearch.findMany as jest.Mock).mockResolvedValueOnce([{ ...row, decisionId: 'private-decision' }]);
  (prisma.agentDecision.findFirst as jest.Mock).mockResolvedValueOnce({ marketSnapshot: { positionReview: {
    positionId: position.id, accountId: 'other-account', brokerMode: 'paper', openedAt: position.openedAt.toISOString(),
  } } });
  expect(await getPositionResearchDecision('private-decision')).toBeNull();
  expect(prisma.agentDecision.findFirst).toHaveBeenCalledWith({ where: { id: 'private-decision', horizon: 'POSITION_REVIEW' } });
});
test('lost lease cancels council work before another provider call can start', async () => {
  (prisma.positionResearch.updateMany as jest.Mock).mockResolvedValueOnce({ count: 1 }).mockResolvedValueOnce({ count: 0 });
  let signal: AbortSignal | undefined;
  (runInvestmentCommitteeDebate as jest.Mock).mockImplementationOnce(async (...args) => {
    signal = args[6].signal;
    await args[6].beforeCall();
    throw new Error('unreachable after lost lease');
  });
  expect((await reviewOpenPositions())[0].error).toBe('REVIEW_LEASE_LOST');
  expect(signal?.aborted).toBe(true);
});
test('HOLD or otherwise blocked research still fails if the snapshot aged during the council', async () => {
  const originalNow = Date.now(), clock = jest.spyOn(Date, 'now').mockReturnValue(originalNow);
  try {
    (buildMarketSnapshot as jest.Mock).mockResolvedValueOnce({ asset: 'AAPL', market: 'stocks', price: 101, timestamp: originalNow,
      indicators: { macd: { histogram: 1 }, bollingerBands: { upper: 105, lower: 95, middle: 100 } } });
    (runInvestmentCommitteeDebate as jest.Mock).mockImplementationOnce(async () => {
      clock.mockReturnValue(originalNow + 400000);
      return { purpose: 'POSITION_REVIEW', decisionId: 'x', executionApproved: false, positionSizePct: 0,
        finalDecision: 'HOLD', agentVotes: Array.from({ length: 14 }, (_, i) => ({ agentId: i + 1, executionEligible: true })) };
    });
    expect((await reviewOpenPositions())[0].error).toBe('REVIEW_SNAPSHOT_STALE');
  } finally { clock.mockRestore(); }
});
