jest.mock('axios', () => ({ get: jest.fn() }));
jest.mock('../src/utils/prisma', () => ({ prisma: {} }));
jest.mock('../src/utils/logger', () => ({ logger: { warn: jest.fn() } }));
import { DeepCompanyAnalysis, formatDeepAnalysisForAgents } from '../src/services/deepAnalysisService';

const cached = (overrides: Record<string, unknown> = {}) => ({
  symbol: 'FIXTURE', companyName: 'Fixture company', sector: 'Test sector',
  marketCap: 2500000000, revenueHistory: [{ year: '2025', value: 2000000000, growth: 5 }],
  operatingMarginHistory: [{ year: '2025', value: 12.5 }],
  freeCashFlow: 300000000, totalCash: 1000000000, debtToEquity: 0.4,
  debtLevel: 'LOW', earningsBeatRate: 75, overallFundamentalScore: 60,
  strongBuy: 1, buy: 2, hold: 3, sell: 0, analystConsensus: 'HOLD',
  insiderBuying: 100, insiderSelling: 0, insiderNetSentiment: 'BULLISH',
  bullCase: 'Known demand', bearCase: 'Delivery risk', keyRisks: ['Supply delays'], keyStrengths: [],
  ...overrides,
} as unknown as DeepCompanyAnalysis);

test('the observed nullable operating margin cannot crash council prompt construction', () => {
  const output = formatDeepAnalysisForAgents(cached({ operatingMarginHistory: [{ year: '2025', value: null }] }));
  expect(output).toContain('Op Margin: 2025: Unavailable');
  expect(output).toContain('Revenue: 2025: $2.0B');
  expect(output).not.toContain('2025: 0.0%');
});
test.each([null, undefined, NaN, Infinity, '12.5'])('unverified numeric value %p remains unavailable throughout prompt evidence', value => {
  const output = formatDeepAnalysisForAgents(cached({
    marketCap: value, operatingMarginHistory: [{ year: '2025', value }],
    revenueHistory: [{ year: '2025', value, growth: value }], freeCashFlow: value,
    debtToEquity: value, totalCash: value, earningsBeatRate: value,
    insiderBuying: value, insiderSelling: value, overallFundamentalScore: value,
  }));
  expect(output).toContain('MCap: Unavailable');
  expect(output).toContain('2025: Unavailable (growth unavailable)');
  expect(output).toContain('FCF: Unavailable');
  expect(output).toContain('Earnings Beat Rate: Unavailable');
  expect(output).toContain('Insiders: Unavailable');
  expect(output).not.toMatch(/NaN|Infinity|undefined|null|\$0\.0B/);
});
test('known zero and negative financial evidence is retained', () => {
  const output = formatDeepAnalysisForAgents(cached({
    operatingMarginHistory: [{ year: '2025', value: 0 }], freeCashFlow: 0,
    totalCash: 0, debtToEquity: 0, earningsBeatRate: 0,
    revenueHistory: [{ year: '2025', value: 0, growth: -5 }],
  }));
  expect(output).toContain('Op Margin: 2025: 0.0% | FCF: $0.0B');
  expect(output).toContain('Debt/Equity: 0.00 (LOW) | Cash: $0.0B');
  expect(output).toContain('Earnings Beat Rate: 0%');
  expect(output).toContain('growth -5.0%');
});
test('absent and corrupt cached history collections do not masquerade as valid evidence', () => {
  const output = formatDeepAnalysisForAgents(cached({
    revenueHistory: null, operatingMarginHistory: [null, 1, 'bad'], keyRisks: null, keyStrengths: null,
  }));
  expect(output).toContain('Revenue: Unavailable');
  expect(output).toContain('Op Margin: Unavailable');
});
