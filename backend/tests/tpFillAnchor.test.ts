// TP/SL must be anchored to the ACTUAL fill price. The debate engine
// computes protection levels from a pre-trade snapshot; before this fix,
// recordConfirmedExecution stored those snapshot levels verbatim next to an
// entryPrice set to the real fill, so a market that moved between snapshot
// and fill produced stored geometry like a take-profit below the price the
// position opened at (the audit's CTVA case). The levels are now recomputed
// from the fill with the signal's percentage distances preserved.
const mockTx: any = {
  executionIntent: {
    findUnique: jest.fn(),
    updateMany: jest.fn(async () => ({ count: 1 })),
    update: jest.fn(async () => ({})),
  },
  $executeRaw: jest.fn(async () => 1),
  position: { findUnique: jest.fn(), upsert: jest.fn() },
  trade: { create: jest.fn() },
  agentDecision: { update: jest.fn(async () => ({})) },
};
jest.mock('../src/utils/prisma', () => ({ prisma: {
  $transaction: async (cb: any) => cb(mockTx),
} }));
jest.mock('../src/utils/logger', () => ({ logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() } }));
jest.mock('../src/agents/orchestrator', () => ({ isKillSwitchActive: jest.fn(() => false) }));
jest.mock('../src/services/marketData', () => ({ getCurrentPrice: jest.fn(), buildMarketSnapshot: jest.fn() }));
jest.mock('../src/services/portfolio', () => ({ getPortfolioState: jest.fn() }));
import { reanchorProtectionToFill, recordConfirmedExecution } from '../src/trading/executionEngine';

// ── the pure reanchor ───────────────────────────────────────────────────────

test('long: a fill above the signal price recomputes both levels from the fill', () => {
  const out = reanchorProtectionToFill({ entryPrice: 100, stopLossPrice: 95, takeProfitPrice: 110 }, 108);
  expect(out.stopLossPrice).toBeCloseTo(102.6, 10);
  expect(out.takeProfitPrice).toBeCloseTo(118.8, 10);
});

test('long: a fill below the signal price recomputes both levels from the fill', () => {
  const out = reanchorProtectionToFill({ entryPrice: 100, stopLossPrice: 95, takeProfitPrice: 110 }, 90);
  expect(out.stopLossPrice).toBeCloseTo(85.5, 10);
  expect(out.takeProfitPrice).toBeCloseTo(99, 10);
});

test('short: distances mirror — stop above, target below the fill', () => {
  const out = reanchorProtectionToFill({ entryPrice: 100, stopLossPrice: 105, takeProfitPrice: 90 }, 92);
  expect(out.stopLossPrice).toBeCloseTo(96.6, 10);
  expect(out.takeProfitPrice).toBeCloseTo(82.8, 10);
});

test('a fill at the signal price leaves the levels unchanged', () => {
  const out = reanchorProtectionToFill({ entryPrice: 100, stopLossPrice: 95, takeProfitPrice: 110 }, 100);
  expect(out.stopLossPrice).toBeCloseTo(95, 10);
  expect(out.takeProfitPrice).toBeCloseTo(110, 10);
});

test('degenerate inputs pass the signal levels through instead of inventing new ones', () => {
  expect(reanchorProtectionToFill({ entryPrice: 0, stopLossPrice: 0, takeProfitPrice: 0 }, 50))
    .toEqual({ stopLossPrice: 0, takeProfitPrice: 0 });
  expect(reanchorProtectionToFill({ entryPrice: 100, stopLossPrice: 95, takeProfitPrice: 110 }, 0))
    .toEqual({ stopLossPrice: 95, takeProfitPrice: 110 });
});

// ── the wiring: recorded rows carry fill-anchored levels ────────────────────

const ctvaSignal: any = {
  asset: 'CTVA', market: 'stocks', direction: 'BUY', entryPrice: 12,
  stopLossPrice: 11.4, takeProfitPrice: 13.47, agentDecisionId: 'dec-1',
};

function primeTx(existingPosition: any = null) {
  const store: any = { position: existingPosition, trades: [] };
  mockTx.executionIntent.findUnique.mockResolvedValue({
    id: 'intent-1', accountId: 'acct-A', mode: 'paper', status: 'SUBMITTED', executionPlan: { lane: 'COUNCIL' },
  });
  mockTx.position.findUnique.mockResolvedValue(existingPosition);
  mockTx.position.upsert.mockImplementation(async ({ create, update }: any) => {
    if (store.position) { Object.assign(store.position, update); return store.position; }
    store.position = { id: 'pos-1', ...create };
    return store.position;
  });
  mockTx.trade.create.mockImplementation(async ({ data }: any) => {
    const t = { id: `trade-${store.trades.length + 1}`, ...data };
    store.trades.push(t);
    return t;
  });
  return store;
}

beforeEach(() => { jest.clearAllMocks(); });

test('recorded trade and position carry levels anchored to the fill, not the snapshot', async () => {
  const store = primeTx();
  await recordConfirmedExecution(ctvaSignal, 'intent-1', { orderId: 'ord-1', fees: 0 }, 14.31, 10, 'APPLICATION_MONITORED');
  const trade = store.trades[0];
  expect(trade.entryPrice).toBe(14.31);
  // Snapshot levels were SL 11.40 / TP 13.47 — the TP sat BELOW the 14.31
  // fill (the CTVA geometry). Anchored to the fill they cannot.
  expect(trade.stopLossPrice).toBeCloseTo(14.31 * 0.95, 8);
  expect(trade.takeProfitPrice).toBeCloseTo(14.31 * 1.1225, 8);
  expect(trade.takeProfitPrice).toBeGreaterThan(trade.entryPrice);
  expect(trade.stopLossPrice).toBeLessThan(trade.entryPrice);
  expect(store.position.stopLossPrice).toBeCloseTo(14.31 * 0.95, 8);
  expect(store.position.takeProfitPrice).toBeCloseTo(14.31 * 1.1225, 8);
});

test('a fill below the signal price keeps the same geometry around the lower fill', async () => {
  const store = primeTx();
  await recordConfirmedExecution(ctvaSignal, 'intent-1', { orderId: 'ord-2', fees: 0 }, 10.5, 10, 'APPLICATION_MONITORED');
  const trade = store.trades[0];
  expect(trade.stopLossPrice).toBeCloseTo(10.5 * 0.95, 8);
  expect(trade.takeProfitPrice).toBeCloseTo(10.5 * 1.1225, 8);
  expect(trade.takeProfitPrice).toBeGreaterThan(trade.entryPrice);
});

test('adding to an open position anchors its levels to the resulting average entry', async () => {
  const existing = {
    id: 'pos-0', status: 'OPEN', side: 'BUY', entryPrice: 12, quantity: 10, pendingEntryIntentId: 'other-intent',
  };
  const store = primeTx(existing);
  await recordConfirmedExecution(ctvaSignal, 'intent-1', { orderId: 'ord-3', fees: 0 }, 14.31, 10, 'APPLICATION_MONITORED');
  const aggregate = (12 * 10 + 14.31 * 10) / 20;
  expect(store.position.entryPrice).toBeCloseTo(aggregate, 10);
  expect(store.position.stopLossPrice).toBeCloseTo(aggregate * 0.95, 8);
  expect(store.position.takeProfitPrice).toBeCloseTo(aggregate * 1.1225, 8);
  // The new trade lot still anchors to its own fill.
  expect(store.trades[0].takeProfitPrice).toBeCloseTo(14.31 * 1.1225, 8);
});
