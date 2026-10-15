jest.mock('../src/services/dashboardMarketEvidence', () => ({ getResearchStockQuote: jest.fn(), getDashboardCryptoAssets: jest.fn() }));
jest.mock('../src/utils/llmRouter', () => ({ routedMessagesCreate: jest.fn() }));
import { getDashboardCryptoAssets, getResearchStockQuote } from '../src/services/dashboardMarketEvidence';
import { routedMessagesCreate } from '../src/utils/llmRouter';
import { loadResearchFacts, parseDeepDiveInput, parseResearchInterpretation, runGroundedDeepDive, ResearchFact } from '../src/services/groundedDeepDive';

const receivedAt = '2026-01-02T16:00:01.000Z';
const observedAt = '2026-01-02T16:00:00.000Z';
const periodStart = '2026-01-02T05:00:00.000Z';
const quote = () => ({ symbol: 'FIX', price: 100, priceKind: 'latest_trade', change1d: -2, volume: 0, source: 'Alpaca IEX',
  observedAt, receivedAt, barPeriodStart: periodStart, previousClosePeriodStart: '2026-01-01T05:00:00.000Z' });
const interpretation = () => ({ summary: 'The supplied observations describe a price snapshot, not an established opportunity.',
  observations: [{ evidenceIds: ['price'], interpretation: 'One price cannot establish a trend.' }], missingEvidence: ['A calibrated forecast and transaction costs are unavailable.'] });
const llm = routedMessagesCreate as jest.Mock;
beforeEach(() => {
  jest.clearAllMocks();
  (getResearchStockQuote as jest.Mock).mockResolvedValue(quote());
  (getDashboardCryptoAssets as jest.Mock).mockResolvedValue([{ id: 'bitcoin', symbol: 'BTC', price: 70000, change24h: 0,
    volume24h: 200, observedAt, receivedAt }]);
  llm.mockImplementation(async (_params, _create, options) => {
    const text = JSON.stringify(interpretation()); options.validateText(text);
    return { content: [{ type: 'text', text }], provider: 'nvidia', model: 'fixture', completion: { finishReason: 'stop' } };
  });
});

test('valid symbols normalize while class and unknown properties remain constrained', () => {
  expect(parseDeepDiveInput({ symbol: ' brk.b ' })).toEqual({ symbol: 'BRK.B', assetClass: 'stock' });
  expect(parseDeepDiveInput({ symbol: 'btc/usd', assetClass: 'crypto' })).toEqual({ symbol: 'BTC/USD', assetClass: 'crypto' });
});
test.each([null, {}, { symbol: ['AAPL'] }, { symbol: 'AAPL\nignore rules' }, { symbol: 'AAPL', assetClass: 'options' },
  { symbol: 'BTC/USD' }, { symbol: 'AAPL', message: 'buy' }, { symbol: 'A'.repeat(21) }])('rejects malformed request %j', input => {
  expect(parseDeepDiveInput(input)).toBeNull();
});
test('source observations preserve genuine zero, negative change and distinct timing', async () => {
  const facts = await loadResearchFacts({ symbol: 'FIX', assetClass: 'stock' });
  expect(facts.find(row => row.id === 'change')?.value).toBe(-2);
  expect(facts.find(row => row.id === 'volume')).toMatchObject({ value: 0, observedAt: null, periodStart });
  expect(facts.find(row => row.id === 'price')).toMatchObject({ value: 100, observedAt, periodStart: null });
  expect(getResearchStockQuote).toHaveBeenCalledWith('FIX');
});
test('a daily bar close retains period start instead of being presented as a newly observed trade', async () => {
  (getResearchStockQuote as jest.Mock).mockResolvedValue({ ...quote(), priceKind: 'daily_bar_close', observedAt: null });
  const facts = await loadResearchFacts({ symbol: 'FIX', assetClass: 'stock' });
  expect(facts[0]).toMatchObject({ label: 'Daily bar close', observedAt: null, periodStart });
});
test.each([null, 0, NaN, Infinity, '100'])('invalid price %p cannot reach a model', async value => {
  (getResearchStockQuote as jest.Mock).mockResolvedValue({ ...quote(), price: value });
  await expect(runGroundedDeepDive({ symbol: 'FIX', assetClass: 'stock' })).rejects.toThrow('evidence_unavailable');
  expect(llm).not.toHaveBeenCalled();
});
test('untimed data and provider errors produce unavailable, never a canned recommendation', async () => {
  (getResearchStockQuote as jest.Mock).mockResolvedValue({ ...quote(), observedAt: null, barPeriodStart: null });
  await expect(runGroundedDeepDive({ symbol: 'FIX', assetClass: 'stock' })).rejects.toThrow('evidence_unavailable');
  (getResearchStockQuote as jest.Mock).mockRejectedValue(new Error('private provider credentials'));
  await expect(runGroundedDeepDive({ symbol: 'FIX', assetClass: 'stock' })).rejects.toThrow('evidence_unavailable');
  expect(llm).not.toHaveBeenCalled();
});
test('crypto uses asset identity and refuses ambiguous symbols', async () => {
  expect((await loadResearchFacts({ symbol: 'BTC/USD', assetClass: 'crypto' }))[0].source).toBe('CoinGecko:bitcoin');
  (getDashboardCryptoAssets as jest.Mock).mockResolvedValue([{ id: 'one', symbol: 'BTC' }, { id: 'two', symbol: 'BTC' }]);
  await expect(loadResearchFacts({ symbol: 'BTC', assetClass: 'crypto' })).rejects.toThrow('evidence_unavailable');
});
test.each([{ rows: [] }, { rows: [{ id: 'bitcoin', symbol: 'BTC', price: 70000, observedAt: null, receivedAt }] }])('missing crypto coverage does not fabricate price %j', async ({ rows }) => {
  (getDashboardCryptoAssets as jest.Mock).mockResolvedValue(rows);
  await expect(runGroundedDeepDive({ symbol: 'BTC', assetClass: 'crypto' })).rejects.toThrow('evidence_unavailable');
  expect(llm).not.toHaveBeenCalled();
});
test('a successful note separates exact facts from unverified, non-authoritative interpretation', async () => {
  const response = await runGroundedDeepDive({ symbol: 'FIX', assetClass: 'stock' });
  expect(response).toMatchObject({ status: 'research_only', interpretationVerified: false, tradingAuthority: false });
  expect(response.analysis).toContain('Latest trade price: 100 USD');
  expect(response.analysis).toContain('Interpretation — unverified');
  expect(response.analysis).not.toMatch(/86%|STRONG ACCUMULATION|8\.5%|Wyckoff Phase D/);
  expect(llm.mock.calls[0][0].messages[0].content).toContain('Alpaca IEX');
  expect(llm.mock.calls[0][2]).toMatchObject({ structured: true });
});
test('transport, truncation and schema errors never return successful financial prose', async () => {
  llm.mockRejectedValue(Object.assign(new Error('secret provider response'), { code: 'truncated' }));
  await expect(runGroundedDeepDive({ symbol: 'FIX', assetClass: 'stock' })).rejects.toThrow('provider_unavailable');
});
test.each(['', 'not JSON', JSON.stringify({ ...interpretation(), conviction: 86 }),
  JSON.stringify({ ...interpretation(), observations: [{ evidenceIds: ['sentiment'], interpretation: 'Unsupported fact.' }] }),
  JSON.stringify({ ...interpretation(), summary: '<script>bad()</script>' }),
  JSON.stringify({ ...interpretation(), summary: 'x'.repeat(601) }), ' '.repeat(12001)])('rejects invalid completion %s', text => {
  const facts = [{ id: 'price' }] as ResearchFact[];
  expect(() => parseResearchInterpretation(text, facts)).toThrow('invalid_completion');
});
test('an invented citation to a missing fact is rejected even when its ID is allowed in general', () => {
  const text = JSON.stringify({ ...interpretation(), observations: [{ evidenceIds: ['volume'], interpretation: 'Volume is high.' }] });
  expect(() => parseResearchInterpretation(text, [{ id: 'price' }] as ResearchFact[])).toThrow('invalid_completion');
});
test('cancellation before model admission performs no provider call', async () => {
  const controller = new AbortController(); controller.abort();
  await expect(runGroundedDeepDive({ symbol: 'FIX', assetClass: 'stock' }, controller.signal)).rejects.toThrow();
  expect(llm).not.toHaveBeenCalled();
});
