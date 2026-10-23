// Socket contract (src/websocket/socketEvents.ts): every event name the
// frontend listens for must have a real backend producer, with the payload
// shape the consumers read. Before this fix `trade:executed` and the
// kill-switch events were listened for but never emitted (dead trade toast,
// dead kill-switch UI flag), and the agent-activity monitor emitted five
// per-kind names (agent:gathering, …) that nothing listened to instead of
// the single `agent:status` the frontend consumes.
const mockSocketEmit = jest.fn();
jest.mock('../src/websocket/server', () => ({ getIO: () => ({ emit: mockSocketEmit }) }));

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
jest.mock('../src/utils/prisma', () => ({
  prisma: {
    $transaction: async (cb: any) => cb(mockTx),
    systemLog: { create: jest.fn(async () => ({})) },
    settings: { findFirst: jest.fn(async () => null), upsert: jest.fn(async () => ({})) },
  },
}));
jest.mock('../src/utils/logger', () => ({ logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() } }));
jest.mock('../src/services/marketData', () => ({ getCurrentPrice: jest.fn(), buildMarketSnapshot: jest.fn() }));
jest.mock('../src/services/portfolio', () => ({ getPortfolioState: jest.fn() }));

import { registerSocketEmitter } from '../src/websocket/socketEvents';
import { recordConfirmedExecution } from '../src/trading/executionEngine';
import { activateKillSwitch, deactivateKillSwitch } from '../src/agents/orchestrator';
import { agentActivityMonitor } from '../src/services/agentActivityMonitor';

const emitted: Array<[string, any]> = [];
beforeAll(() => {
  registerSocketEmitter((event, payload) => { emitted.push([event, payload]); });
});
afterAll(() => { registerSocketEmitter(null); });

const signal: any = {
  asset: 'CTVA', market: 'stocks', direction: 'BUY', entryPrice: 12,
  stopLossPrice: 11.4, takeProfitPrice: 13.47, agentDecisionId: 'dec-1',
};

function primeTx(intentStatus = 'SUBMITTED') {
  const store: any = { position: null, trades: [] };
  mockTx.executionIntent.findUnique.mockResolvedValue({
    id: 'intent-1', accountId: 'acct-A', mode: 'paper', status: intentStatus, executionPlan: { lane: 'COUNCIL' },
  });
  mockTx.executionIntent.updateMany.mockResolvedValue({ count: 1 });
  mockTx.position.findUnique.mockResolvedValue(null);
  mockTx.position.upsert.mockImplementation(async ({ create }: any) => {
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

beforeEach(() => { jest.clearAllMocks(); emitted.length = 0; });

// ── trade:executed ──────────────────────────────────────────────────────────

test('recordConfirmedExecution emits trade:executed with the normalized payload after recording', async () => {
  primeTx();
  await recordConfirmedExecution(signal, 'intent-1', { orderId: 'ord-1', fees: 0 }, 14.31, 10, 'APPLICATION_MONITORED');
  expect(emitted).toEqual([
    ['trade:executed', {
      trade: { id: 'trade-1', asset: 'CTVA', type: 'BUY', quantity: 10, entryPrice: 14.31 },
      mode: 'paper',
      accountId: 'acct-A',
    }],
  ]);
});

test('an already-RECORDED intent replay emits nothing (no duplicate trade toast)', async () => {
  primeTx('RECORDED');
  await recordConfirmedExecution(signal, 'intent-1', { orderId: 'ord-1', fees: 0 }, 14.31, 10, 'APPLICATION_MONITORED');
  expect(emitted).toEqual([]);
});

test('a lost recording claim emits nothing', async () => {
  primeTx();
  mockTx.executionIntent.updateMany.mockResolvedValue({ count: 0 });
  await recordConfirmedExecution(signal, 'intent-1', { orderId: 'ord-1', fees: 0 }, 14.31, 10, 'APPLICATION_MONITORED');
  expect(emitted).toEqual([]);
});

// ── kill switch ─────────────────────────────────────────────────────────────

test('activate/deactivate emit the kill-switch contract events the UI listens for', () => {
  activateKillSwitch();
  deactivateKillSwitch();
  expect(emitted.map(([event]) => event)).toEqual(['kill:switch:activated', 'kill:switch:deactivated']);
  expect(emitted[0][1]).toEqual({ active: true, timestamp: expect.any(Number) });
  expect(emitted[1][1]).toEqual({ active: false, timestamp: expect.any(Number) });
});

// ── agent:status unification ────────────────────────────────────────────────

test('agent activity monitor broadcasts every kind as agent:status (never the old per-kind names)', async () => {
  await agentActivityMonitor.logGathering(1, 'The Technician', 'Reuters', 'gathered headlines');
  await agentActivityMonitor.logLearning(1, 'The Technician', 'NEWS', ['insight'], 0.7);
  await agentActivityMonitor.logAnalyzing(1, 'The Technician', 'CTVA', 'looks strong', {}, 0.6);
  await agentActivityMonitor.logVote(1, 'The Technician', 'CTVA', 'BUY', 'momentum', 0.9, 1);
  await agentActivityMonitor.logTradeExecution(1, 'The Technician', 'CTVA', 'BUY', 10, 14.31, 'signal');

  const names = mockSocketEmit.mock.calls.map(([event]) => event);
  expect(names).toEqual(['agent:status', 'agent:status', 'agent:status', 'agent:status', 'agent:status']);
  const types = mockSocketEmit.mock.calls.map(([, payload]) => payload.activityType);
  expect(types).toEqual(['GATHERING', 'LEARNING', 'ANALYZING', 'VOTING', 'TRADING']);
  // The VOTING payload keeps the vote the consumers read.
  expect(mockSocketEmit.mock.calls[3][1]).toEqual(expect.objectContaining({ vote: 'BUY' }));
});
