jest.mock('../src/services/sentimentService', () => ({ getHeadlinesForQuery: jest.fn().mockResolvedValue([]) }));
jest.mock('../src/utils/prisma', () => ({ prisma: {} }));
jest.mock('../src/websocket/server', () => ({ getIO: () => null }));
jest.mock('../src/utils/logger', () => ({ logger: { info: jest.fn(), error: jest.fn(), warn: jest.fn() } }));
jest.mock('../src/utils/llmRouter', () => ({ routedMessagesCreate: jest.fn() }));
import { analyzePolymarketEvent } from '../src/services/polymarket';
import { routedMessagesCreate } from '../src/utils/llmRouter';
function mockAssessment(value: unknown) { (routedMessagesCreate as jest.Mock).mockImplementation(async (_params, _client, options) => { options.validateText(JSON.stringify(value)); return {}; }); }
const market: any = { question: 'Fixture event?', conditionId: 'fixture', yesPrice: 0.4, volume: 100, liquidity: 100, endDate: '2027-01-01' };
beforeEach(() => { jest.clearAllMocks(); jest.useFakeTimers(); delete process.env.GEMINI_API_KEY; });
afterEach(() => { jest.clearAllTimers(); jest.useRealTimers(); });
test('analysis computes edge instead of accepting model supplied edge', async () => {
  mockAssessment({ ourProbabilityYes: 0.7, confidence: 70, recommendedSide: 'YES', reasoning: 'Fixture', edge: 100, kellyFraction: 1 });
  expect((await analyzePolymarketEvent(market, 1000)).edge).toBeCloseTo(0.3);
});
test('contradictory side cannot receive a simulated allocation', async () => {
  mockAssessment({ ourProbabilityYes: 0.7, confidence: 70, recommendedSide: 'NO', reasoning: 'Fixture' });
  expect(await analyzePolymarketEvent(market, 1000)).toMatchObject({ recommendedSide: 'SKIP', betSizeUSD: 0, expectedProfitUSD: 0 });
});
test('small allocation is not rounded up to minimum wager', async () => {
  mockAssessment({ ourProbabilityYes: 0.7, confidence: 70, recommendedSide: 'YES', reasoning: 'Fixture' });
  expect(await analyzePolymarketEvent(market, 1)).toMatchObject({ recommendedSide: 'SKIP', betSizeUSD: 0 });
});
test('invalid source price is refused before a model call', async () => {
  await expect(analyzePolymarketEvent({ ...market, yesPrice: 0 }, 1000)).rejects.toThrow('Invalid prediction market inputs');
  expect(routedMessagesCreate).not.toHaveBeenCalled();
});
test('provider failure cannot invent keyword-based edge even when legacy heuristic flag is enabled', async () => {
  process.env.POLYMARKET_ALLOW_HEURISTIC_BETS = 'true';
  (routedMessagesCreate as jest.Mock).mockRejectedValue(new Error('fixture provider unavailable'));
  expect(await analyzePolymarketEvent({ ...market, question: 'Will the Fed cut rates?' }, 1000)).toMatchObject({ ourEstimatedProbability: null, confidence: 0, edge: 0, recommendedSide: 'SKIP', betSizeUSD: 0 });
});

test('the45s research timeout actually cancels routed work and retains unknown probability', async () => {
  (routedMessagesCreate as jest.Mock).mockImplementation((_params: unknown, _client: unknown, { signal }: { signal: AbortSignal }) => new Promise((_resolve, reject) => {
    signal.addEventListener('abort', () => reject(signal.reason), { once: true });
  }));
  const result = analyzePolymarketEvent(market, 1000);
  await jest.advanceTimersByTimeAsync(45000);
  expect((routedMessagesCreate as jest.Mock).mock.calls[0][2].signal.aborted).toBe(true);
  expect(await result).toMatchObject({ ourEstimatedProbability: null, recommendedSide: 'SKIP', betSizeUSD: 0 });
  expect(jest.getTimerCount()).toBe(0);
});
