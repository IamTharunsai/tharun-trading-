jest.mock('../src/utils/prisma', () => ({ prisma: {} }));
import {
  liveTradingConfirmed, alpacaLiveAllowed, getAlpacaMode, polymarketLiveAllowed,
  getPolymarketMaxOrderUsd, LIVE_CONFIRM_PHRASE,
} from '../src/trading/liveGate';

const LIVE_KEYS = { ALPACA_LIVE_API_KEY: 'AKLIVEKEY123456', ALPACA_LIVE_SECRET_KEY: 'livesecret1234567890' };

describe('liveGate — one rule for real money', () => {
  it('defaults to paper with an empty env', () => {
    expect(liveTradingConfirmed({}).allowed).toBe(false);
    expect(getAlpacaMode({})).toBe('paper');
  });

  it('TRADING_MODE=live alone is not enough (needs the confirmation phrase)', () => {
    expect(alpacaLiveAllowed({ TRADING_MODE: 'live', ...LIVE_KEYS }).allowed).toBe(false);
    expect(getAlpacaMode({ TRADING_MODE: 'live', LIVE_TRADING_CONFIRMED: 'yes', ...LIVE_KEYS })).toBe('paper');
  });

  it('the phrase without TRADING_MODE=live is not enough', () => {
    expect(getAlpacaMode({ TRADING_MODE: 'paper', LIVE_TRADING_CONFIRMED: LIVE_CONFIRM_PHRASE, ...LIVE_KEYS })).toBe('paper');
  });

  it('Alpaca live also needs real live keys', () => {
    expect(getAlpacaMode({ TRADING_MODE: 'live', LIVE_TRADING_CONFIRMED: LIVE_CONFIRM_PHRASE })).toBe('paper');
    expect(getAlpacaMode({ TRADING_MODE: 'live', LIVE_TRADING_CONFIRMED: LIVE_CONFIRM_PHRASE, ALPACA_LIVE_API_KEY: 'your_key_here', ALPACA_LIVE_SECRET_KEY: 'your_secret' })).toBe('paper');
  });

  it('all three present → live (tolerates inline comments / quotes)', () => {
    expect(getAlpacaMode({ TRADING_MODE: ' "live" # real', LIVE_TRADING_CONFIRMED: LIVE_CONFIRM_PHRASE, ...LIVE_KEYS })).toBe('live');
  });

  it('POLYMARKET_US_LIVE=true alone never enables Polymarket live', () => {
    expect(polymarketLiveAllowed({ POLYMARKET_US_LIVE: 'true' }, false).allowed).toBe(false);
    expect(polymarketLiveAllowed({ POLYMARKET_US_LIVE: 'true', TRADING_MODE: 'live' }, false).allowed).toBe(false);
  });

  it('Polymarket live needs mode + phrase + flag, and the kill switch off', () => {
    const env = { POLYMARKET_US_LIVE: 'true', TRADING_MODE: 'live', LIVE_TRADING_CONFIRMED: LIVE_CONFIRM_PHRASE };
    expect(polymarketLiveAllowed(env, false).allowed).toBe(true);
    expect(polymarketLiveAllowed(env, true).allowed).toBe(false);
    expect(polymarketLiveAllowed({ ...env, POLYMARKET_US_LIVE: 'false' }, false).allowed).toBe(false);
  });

  it('max order: POLYMARKET_US_MAX_ORDER_USD wins, POLYMARKET_MAX_BET_USD is an alias, default $5', () => {
    expect(getPolymarketMaxOrderUsd({})).toBe(5);
    expect(getPolymarketMaxOrderUsd({ POLYMARKET_MAX_BET_USD: '3' })).toBe(3);
    expect(getPolymarketMaxOrderUsd({ POLYMARKET_MAX_BET_USD: '3', POLYMARKET_US_MAX_ORDER_USD: '7' })).toBe(7);
    expect(() => getPolymarketMaxOrderUsd({ POLYMARKET_US_MAX_ORDER_USD: 'abc' })).toThrow('order limit');
  });
});

describe('createAlpacaBroker no longer bypasses the gate', () => {
  const saved = { ...process.env };
  afterEach(() => { process.env = { ...saved }; jest.resetModules(); });

  it('asking for a live client (paperMode=false) without the phrase returns a PAPER client', () => {
    process.env.TRADING_MODE = 'live';
    delete process.env.LIVE_TRADING_CONFIRMED;
    process.env.ALPACA_API_KEY = 'PKPAPERKEY123456';
    process.env.ALPACA_SECRET_KEY = 'papersecret1234567890';
    process.env.ALPACA_LIVE_API_KEY = LIVE_KEYS.ALPACA_LIVE_API_KEY;
    process.env.ALPACA_LIVE_SECRET_KEY = LIVE_KEYS.ALPACA_LIVE_SECRET_KEY;
    jest.isolateModules(() => {
      const { createAlpacaBroker } = require('../src/services/alpacaBroker');
      const b: any = createAlpacaBroker(false);
      expect(b).not.toBeNull();
      expect(b.baseUrl).toBe('https://paper-api.alpaca.markets');
      expect(b.apiKey).toBe('PKPAPERKEY123456');
    });
  });
});
