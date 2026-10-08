jest.mock('../src/utils/prisma', () => ({ prisma: {} }));
jest.mock('../src/utils/logger', () => ({ logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() } }));
import { evaluateBacktestResults } from '../src/trading/backtestingEngine';
it('does not authorize real money from attractive but unqualified simulation metrics', () => {
  const result = evaluateBacktestResults({ sharpeRatio: 99, winRate: 100, maxDrawdown: 0, profitFactor: 999 } as any);
  expect(result.canGoLive).toBe(false);
  expect(result.issues.join(' ')).toContain('UNQUALIFIED_SIMULATION');
});
