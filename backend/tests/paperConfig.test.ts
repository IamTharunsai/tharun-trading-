import { assertPaperTrading } from '../src/trading/paperConfig';

const savedMode = process.env.TRADING_MODE;
const savedUrl = process.env.ALPACA_BASE_URL;
afterEach(() => {
  if (savedMode === undefined) delete process.env.TRADING_MODE; else process.env.TRADING_MODE = savedMode;
  if (savedUrl === undefined) delete process.env.ALPACA_BASE_URL; else process.env.ALPACA_BASE_URL = savedUrl;
});

it('defaults to paper when configuration is missing', () => {
  delete process.env.TRADING_MODE;
  delete process.env.ALPACA_BASE_URL;
  expect(assertPaperTrading).not.toThrow();
});

it.each(['live', 'papre'])('rejects mode %s', mode => {
  process.env.TRADING_MODE = mode;
  expect(assertPaperTrading).toThrow('paper trading only');
});

it('rejects a live broker URL even when the mode says paper', () => {
  process.env.TRADING_MODE = 'paper';
  process.env.ALPACA_BASE_URL = 'https://api.alpaca.markets';
  expect(assertPaperTrading).toThrow('paper endpoint');
});
