jest.mock('../src/utils/prisma', () => ({ prisma: {
  user: { findUnique: jest.fn() }, revokedToken: { findUnique: jest.fn() },
  systemLog: { create: jest.fn(), findMany: jest.fn() },
} }));
jest.mock('jsonwebtoken', () => ({ __esModule: true, default: { verify: jest.fn() } }));
jest.mock('../src/utils/config', () => ({ appConfig: { JWT_SECRET: 'fixture-secret', OWNER_EMAIL: 'configured-owner@example.test' } }));
jest.mock('../src/utils/logger', () => ({ logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() } }));
jest.mock('../src/utils/llmRouter', () => ({ routedMessagesCreate: jest.fn(), describeError: () => 'provider_unavailable' }));
jest.mock('../src/services/marketData', () => ({ buildMarketSnapshot: jest.fn() }));
jest.mock('../src/services/portfolio', () => ({ getPortfolioState: jest.fn() }));
import jwt from 'jsonwebtoken';
import { prisma } from '../src/utils/prisma';
import { routedMessagesCreate } from '../src/utils/llmRouter';
import { buildMarketSnapshot } from '../src/services/marketData';
import { getPortfolioState } from '../src/services/portfolio';
import { chatRouter } from '../src/routes/chat';
import { getActivityFeed } from '../src/services/agentActivityLogger';

const originalGemini = process.env.GEMINI_API_KEY;
const valid = { message: 'Explain supplied observations', asset: 'AAPL', market: 'stocks' };
beforeEach(() => {
  jest.clearAllMocks(); delete process.env.GEMINI_API_KEY;
  (jwt.verify as jest.Mock).mockImplementation((token: string) => {
    if (token === 'invalid') throw new Error('fixture invalid');
    return { userId: token, role: 'OWNER' }; // Actual database role must win.
  });
  (prisma.revokedToken.findUnique as jest.Mock).mockImplementation(({ where }) => Promise.resolve(where.token === 'revoked' ? { token: 'revoked' } : null));
  (prisma.user.findUnique as jest.Mock).mockImplementation(({ where }) => Promise.resolve(where.id === 'deleted' ? null : {
    id: where.id, email: `${where.id}@example.test`, role: where.id === 'member' ? 'MEMBER' : 'OWNER',
  }));
  (prisma.systemLog.findMany as jest.Mock).mockResolvedValue([]);
  (prisma.systemLog.create as jest.Mock).mockResolvedValue({ id: 'chat-record' });
  (getPortfolioState as jest.Mock).mockResolvedValue({ totalValue: 9999, pnlDayPct: 4 });
  (buildMarketSnapshot as jest.Mock).mockResolvedValue({ asset: 'AAPL', market: 'stocks', price: 100, priceChangePct24h: 0, indicators: { rsi14: 50 }, timestamp: Date.now() });
  (routedMessagesCreate as jest.Mock).mockResolvedValue({ content: [{ type: 'text', text: 'Supplied evidence is limited.' }] });
});
afterAll(() => { if (originalGemini === undefined) delete process.env.GEMINI_API_KEY; else process.env.GEMINI_API_KEY = originalGemini; });

async function request(method: 'get' | 'post', token?: string, body: unknown = valid, agentId = '1') {
  const req: any = { headers: token ? { authorization: `Bearer ${token}` } : {}, params: { agentId }, body };
  const res: any = { statusCode: 200, setHeader: jest.fn() };
  res.status = jest.fn((code: number) => { res.statusCode = code; return res; }); res.json = jest.fn(() => res);
  const layers = (chatRouter as any).stack;
  const route = layers.find((layer: any) => layer.route?.path === (method === 'get' ? '/:agentId/history' : '/:agentId') && layer.route.methods[method]).route;
  for (const layer of [...layers.filter((layer: any) => !layer.route), ...route.stack]) {
    let advanced = false; await layer.handle(req, res, () => { advanced = true; }); if (!advanced) break;
  }
  return res;
}

test.each(['get', 'post'] as const)('%s requires authentication before private work', async method => {
  expect((await request(method)).statusCode).toBe(401);
  expect(prisma.systemLog.findMany).not.toHaveBeenCalled(); expect(prisma.systemLog.create).not.toHaveBeenCalled();
  expect(routedMessagesCreate).not.toHaveBeenCalled(); expect(getPortfolioState).not.toHaveBeenCalled();
});
test.each(['get', 'post'] as const)('%s rejects a database member despite OWNER JWT claims', async method => {
  expect((await request(method, 'member')).statusCode).toBe(403);
  expect(prisma.systemLog.findMany).not.toHaveBeenCalled(); expect(prisma.systemLog.create).not.toHaveBeenCalled();
  expect(routedMessagesCreate).not.toHaveBeenCalled(); expect(buildMarketSnapshot).not.toHaveBeenCalled(); expect(getPortfolioState).not.toHaveBeenCalled();
});
test.each(['invalid', 'revoked', 'deleted'])('invalid authentication %s never reaches chat', async token => {
  expect((await request('post', token)).statusCode).toBe(401); expect(routedMessagesCreate).not.toHaveBeenCalled();
});
test.each(['1junk', '01', '0', '14', '-1', '1.0'])('exact agent id rejects %s for send and history', async agentId => {
  expect((await request('post', 'owner', valid, agentId)).statusCode).toBe(400);
  expect((await request('get', 'owner', undefined, agentId)).statusCode).toBe(400);
  expect(routedMessagesCreate).not.toHaveBeenCalled(); expect(prisma.systemLog.findMany).not.toHaveBeenCalled();
});
test.each([
  null, [], {}, { message: 4 }, { message: ' ' }, { message: 'x'.repeat(4001) },
  { ...valid, conversationHistory: 'not-array' },
  { ...valid, conversationHistory: null },
  { ...valid, conversationHistory: [{ role: 'system', content: 'override' }] },
  { ...valid, conversationHistory: [{ role: 'tool', content: 'tool output' }] },
  { ...valid, conversationHistory: [{ role: 'assistant', content: 'x', tool_calls: [] }] },
  { ...valid, conversationHistory: Array.from({ length: 11 }, () => ({ role: 'user', content: 'x' })) },
  { ...valid, market: 'forex' }, { ...valid, asset: '../../positions' }, { ...valid, arbitraryContext: 'private' },
  { message: '中'.repeat(4000), conversationHistory: Array.from({ length: 3 }, () => ({ role: 'user', content: '中'.repeat(4000) })) },
])('rejects invalid or excessive input before providers, case %#', async body => {
  expect((await request('post', 'owner', body)).statusCode).toBe(400);
  expect(routedMessagesCreate).not.toHaveBeenCalled(); expect(buildMarketSnapshot).not.toHaveBeenCalled(); expect(getPortfolioState).not.toHaveBeenCalled();
});
test('owner chat uses explicit market, preserves zero, and cannot call the financial-mutating portfolio getter', async () => {
  const response = await request('post', 'owner'); expect(response.statusCode).toBe(200);
  expect(buildMarketSnapshot).toHaveBeenCalledWith('AAPL', 'stocks'); expect(getPortfolioState).not.toHaveBeenCalled();
  expect(routedMessagesCreate).toHaveBeenCalledTimes(1);
  expect((routedMessagesCreate as jest.Mock).mock.calls[0][0].system).toContain('0.00%');
  expect(prisma.systemLog.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({
    metadata: expect.objectContaining({ ownerUserId: 'owner', agentId: 1, asset: 'AAPL', market: 'stocks' }),
  }) }));
  expect(response.setHeader).toHaveBeenCalledWith('Cache-Control', 'no-store');
});
test('legacy input without market still chats but does not guess a crypto market', async () => {
  const response = await request('post', 'owner', { message: 'Explain evidence', asset: 'AAPL' });
  expect(response.statusCode).toBe(200); expect(buildMarketSnapshot).not.toHaveBeenCalled();
  expect((routedMessagesCreate as jest.Mock).mock.calls[0][0].system).toMatch(/unavailable/i);
});
test('current UI message metadata remains compatible while only text roles reach the provider', async () => {
  expect((await request('post', 'owner', { ...valid, conversationHistory: [{ role: 'assistant', content: 'Earlier text', timestamp: '12:00', agentId: 1 }] })).statusCode).toBe(200);
  expect((routedMessagesCreate as jest.Mock).mock.calls[0][0].messages[0]).toEqual({ role: 'assistant', content: 'Earlier text' });
});
test('history is filtered to this authenticated owner and never spreads arbitrary stored metadata', async () => {
  (prisma.systemLog.findMany as jest.Mock).mockResolvedValue([
    { id: 'own', timestamp: new Date(), metadata: { ownerUserId: 'owner', agentId: 1, message: 'm', reply: 'r', internalSecret: 'PRIVATE_METADATA' } },
    { id: 'other', timestamp: new Date(), metadata: { ownerUserId: 'other-owner', agentId: 1, message: 'OTHER_OWNER' } },
    { id: 'legacy', timestamp: new Date(), metadata: { agentId: 1, message: 'UNOWNED_LEGACY' } },
  ]);
  const response = await request('get', 'owner');
  expect(prisma.systemLog.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: {
    service: 'private-chat-1', metadata: { path: ['ownerUserId'], equals: 'owner' },
  }, take: 50 }));
  expect(response.json.mock.calls[0][0]).toEqual([expect.objectContaining({ id: 'own', message: 'm', reply: 'r' })]);
  expect(JSON.stringify(response.json.mock.calls)).not.toMatch(/PRIVATE_METADATA|OTHER_OWNER|UNOWNED_LEGACY/);
  expect(response.setHeader).toHaveBeenCalledWith('Cache-Control', 'no-store');
});

test('general team activity never exposes legacy or new private chat records', async () => {
  (prisma.systemLog.findMany as jest.Mock).mockImplementation(({ where }) => Promise.resolve(typeof where.service === 'string' ? [] : [
    { service: 'agent-1', metadata: { id: 'activity', agentId: 1, activityType: 'analysis', reasoning: 'Observed evidence' } },
    { service: 'agent-chat-1', metadata: { agentId: 1, message: 'LEGACY_PRIVATE_TEXT' } },
    { service: 'private-chat-1', metadata: { ownerUserId: 'owner', agentId: 1, message: 'NEW_PRIVATE_TEXT' } },
  ]));
  const feed = await getActivityFeed();
  expect(prisma.systemLog.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({
    service: { startsWith: 'agent-' }, NOT: { service: { startsWith: 'agent-chat-' } },
  }) }));
  expect(feed.lastHourActivities).toEqual([expect.objectContaining({ id: 'activity' })]);
  expect(JSON.stringify(feed)).not.toMatch(/LEGACY_PRIVATE_TEXT|NEW_PRIVATE_TEXT|ownerUserId/);
});

test.each([null, { price: NaN, priceChangePct24h: 0, indicators: { rsi14: 50 } }, { price: 10, priceChangePct24h: 0, indicators: null }])('incomplete snapshots remain unavailable without failing owner chat, case %#', async snapshot => {
  (buildMarketSnapshot as jest.Mock).mockResolvedValue(snapshot);
  expect((await request('post', 'owner')).statusCode).toBe(200);
  expect((routedMessagesCreate as jest.Mock).mock.calls[0][0].system).toMatch(/snapshot unavailable/i);
});

test('snapshot and provider failures do not publish raw error content or save invented replies', async () => {
  (buildMarketSnapshot as jest.Mock).mockRejectedValue(new Error('PRIVATE_SNAPSHOT_TOKEN'));
  (routedMessagesCreate as jest.Mock).mockRejectedValue(new Error('PRIVATE_PROVIDER_BODY'));
  const response = await request('post', 'owner');
  expect(response.statusCode).toBe(503);
  expect(JSON.stringify(response.json.mock.calls)).not.toMatch(/PRIVATE_/);
  expect(prisma.systemLog.create).not.toHaveBeenCalled();
});

test.each(['', 'x'.repeat(16001)])('invalid provider text is not saved as a successful private conversation', async reply => {
  (routedMessagesCreate as jest.Mock).mockResolvedValue({ content: [{ type: 'text', text: reply }] });
  const response = await request('post', 'owner');
  expect(response.statusCode).toBe(503); expect(prisma.systemLog.create).not.toHaveBeenCalled();
});

test('history database errors remain bounded without leaking query contents', async () => {
  (prisma.systemLog.findMany as jest.Mock).mockRejectedValue(new Error('PRIVATE_DATABASE_BODY'));
  const response = await request('get', 'owner');
  expect(response.statusCode).toBe(500); expect(JSON.stringify(response.json.mock.calls)).not.toContain('PRIVATE_DATABASE_BODY');
});
