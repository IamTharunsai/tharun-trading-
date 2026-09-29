// Tests for the 2026-09-29 platform upgrade:
//  - LLM router failover (Anthropic out of credits → NVIDIA) — the root cause of "every trade is HOLD"
//  - dynamic universe (no hardcoded tickers) and its categories
//  - intraday fast-lane indicators and setup scorer
//  - FRED macro line formatting
jest.mock('axios');
import axios from 'axios';
import { routedMessagesCreate, attemptChain, stripReasoning, parseJsonLoose, providerFor } from '../src/utils/llmRouter';
import { universe, UniverseSymbol, slug } from '../src/services/universeService';
import { ema, rsi, atr, sessionVwap, scoreSetup, Bar } from '../src/trading/intradayEngine';
import { macroLine } from '../src/services/fredService';
import { buildMacroData } from '../src/routes/intelligence';

const mockedPost = (axios as any).post as jest.Mock;

const ENV = { ...process.env };
afterEach(() => { process.env = { ...ENV }; mockedPost.mockReset(); });

describe('LLM router — provider failover', () => {
  it('falls back to NVIDIA when Anthropic says the credit balance is too low', async () => {
    process.env.ANTHROPIC_API_KEY = 'sk-ant-real-looking';
    process.env.NVIDIA_API_KEY = 'nvapi-real-looking';
    process.env.LLM_PROVIDER_FAST = 'anthropic';
    const anthropicCreate = jest.fn().mockRejectedValue(Object.assign(new Error('400 Your credit balance is too low to access the Anthropic API.'), { status: 400 }));
    mockedPost.mockResolvedValue({ data: { choices: [{ message: { content: '{"vote":"BUY"}' } }], usage: { prompt_tokens: 10, completion_tokens: 5 } } });

    const res = await routedMessagesCreate({ model: 'claude-haiku-4-5', max_tokens: 50, messages: [{ role: 'user', content: 'hi' }] }, anthropicCreate);
    expect(anthropicCreate).toHaveBeenCalledTimes(1);
    expect(res.provider).toBe('nvidia');
    expect(res.content[0].text).toBe('{"vote":"BUY"}');
    expect(mockedPost.mock.calls[0][0]).toContain('integrate.api.nvidia.com');
  });

  it('tries the NVIDIA fallback model when the primary NVIDIA model is overloaded (503)', async () => {
    process.env.NVIDIA_API_KEY = 'nvapi-real-looking';
    process.env.LLM_PROVIDER_FAST = 'nvidia';
    process.env.LLM_MODEL_FAST = 'nvidia/nemotron-3-super-120b-a12b';
    process.env.LLM_FALLBACK_MODEL = 'openai/gpt-oss-20b';
    delete process.env.ANTHROPIC_API_KEY;
    mockedPost
      .mockRejectedValueOnce(Object.assign(new Error('503'), { response: { status: 503, data: { error: 'overloaded' } } }))
      .mockResolvedValueOnce({ data: { choices: [{ message: { content: 'ok' } }] } });
    const res = await routedMessagesCreate({ model: 'claude-haiku-4-5', max_tokens: 10, messages: [{ role: 'user', content: 'x' }] });
    expect(res.model).toBe('openai/gpt-oss-20b');
    expect(mockedPost).toHaveBeenCalledTimes(2);
  });

  it('does not fail over on a 400 caused by our own bad request', async () => {
    process.env.NVIDIA_API_KEY = 'nvapi-real-looking';
    process.env.LLM_PROVIDER_FAST = 'nvidia';
    mockedPost.mockRejectedValue(Object.assign(new Error('400'), { response: { status: 400, data: { error: 'bad param' } } }));
    await expect(routedMessagesCreate({ model: 'haiku', max_tokens: 10, messages: [] })).rejects.toThrow(/All LLM providers failed/);
    expect(mockedPost).toHaveBeenCalledTimes(1);
  });

  it('builds a chain primary → nvidia fallback → anthropic', () => {
    process.env.NVIDIA_API_KEY = 'nvapi-x';
    process.env.ANTHROPIC_API_KEY = 'sk-ant-x';
    process.env.LLM_PROVIDER_SMART = 'nvidia';
    const chain = attemptChain({ model: 'claude-sonnet-5' });
    expect(chain[0].provider).toBe('nvidia');
    expect(chain[chain.length - 1].provider).toBe('anthropic');
  });

  it('defaults to NVIDIA when only an NVIDIA key exists', () => {
    delete process.env.LLM_PROVIDER_FAST;
    delete process.env.ANTHROPIC_API_KEY;
    process.env.NVIDIA_API_KEY = 'nvapi-x';
    expect(providerFor('fast')).toBe('nvidia');
  });

  it('strips <think> reasoning and parses JSON from chatty replies', () => {
    expect(stripReasoning('<think>hmm</think>\n{"a":1}')).toBe('{"a":1}');
    expect(parseJsonLoose('Sure! ```json\n{"vote":"HOLD","confidence":40}\n``` done')).toEqual({ vote: 'HOLD', confidence: 40 });
    expect(parseJsonLoose('no json here')).toBeNull();
  });
});

const row = (over: Partial<UniverseSymbol>): UniverseSymbol => ({
  symbol: 'X', name: 'X Inc', sector: 'Technology', industry: null, marketCap: 5e9, price: 20, changePct: 1, volume: 2_000_000,
  market: 'stocks', tradable: true, fractionable: true, isEtf: false, ...over,
});

describe('Universe service — dynamic, categorised, no hardcoded lists', () => {
  beforeAll(() => {
    universe.load([
      row({ symbol: 'AAA', sector: 'Technology', marketCap: 300e9, volume: 9e6, changePct: 4 }),
      row({ symbol: 'BBB', sector: 'Healthcare', marketCap: 12e9, volume: 5e6, changePct: -3 }),
      row({ symbol: 'CCC', sector: 'Energy', marketCap: 3e9, volume: 1.5e6, changePct: 2 }),
      row({ symbol: 'DDD', sector: 'Energy', marketCap: 500e6, volume: 800_000, changePct: 0.5 }),
      row({ symbol: 'EEE', sector: null, isEtf: true, name: 'Some ETF' }),
      row({ symbol: 'ZZZ', tradable: false, volume: 50e6 }),
    ]);
    universe.setCrypto(['BTC', 'ETH'], () => ({ BTC: 84000 }));
    (universe as any).rebuildMoversFromSnapshot();
  });

  it('exposes sector, cap, ETF, crypto and dynamic categories with counts', () => {
    const cats = universe.categories({ portfolio: ['AAA'] });
    const ids = cats.map(c => c.id);
    expect(ids).toEqual(expect.arrayContaining(['portfolio', 'most_active', 'top_gainers', 'top_losers', `sector_${slug('Energy')}`, 'cap_mega', 'etf', 'crypto']));
    expect(cats.find(c => c.id === `sector_${slug('Energy')}`)!.count).toBe(2);
  });

  it('lists the symbols of a sector, largest first', () => {
    const { symbols, total } = universe.symbols({ category: `sector_${slug('Energy')}` });
    expect(total).toBe(2);
    expect(symbols.map(s => s.symbol)).toEqual(['CCC', 'DDD']);
  });

  it('search ranks exact ticker, then prefix, then name', () => {
    const { symbols } = universe.symbols({ search: 'AAA' });
    expect(symbols[0].symbol).toBe('AAA');
  });

  it('most-active excludes non-tradable symbols', () => {
    const { symbols } = universe.symbols({ category: 'most_active' });
    expect(symbols.map(s => s.symbol)).not.toContain('ZZZ');
    expect(symbols[0].symbol).toBe('AAA');
  });

  it('intraday candidates are liquid, tradable, non-ETF and respect exclusions', () => {
    const c = universe.intradayCandidates(10, { exclude: new Set(['BBB']) });
    expect(c).toContain('AAA');
    expect(c).not.toContain('BBB');
    expect(c).not.toContain('EEE');
    expect(c).not.toContain('ZZZ');
    expect(c).not.toContain('DDD'); // below 1M volume
  });

  it('swing candidates are sector-balanced and >= $2B', () => {
    const c = universe.swingCandidates(10);
    expect(c).toEqual(expect.arrayContaining(['AAA', 'BBB', 'CCC']));
    expect(c).not.toContain('DDD');
  });

  it('crypto category comes from the live crypto feed', () => {
    const { symbols } = universe.symbols({ category: 'crypto' });
    expect(symbols.find(s => s.symbol === 'BTC')!.price).toBe(84000);
  });
});

function mkBars(n: number, start: number, step: number, vol = 1000, lastVol = vol): Bar[] {
  // Zig-zag drift (two up, one down) so RSI sits in a realistic range instead of pinning at 0/100.
  return Array.from({ length: n }, (_, i) => {
    const c = start + step * i + (i % 3 === 2 ? -step * 3 : 0);
    return { t: new Date(Date.UTC(2026, 8, 29, 13, 30 + i * 5)).toISOString(), o: c - step / 2, h: c + Math.abs(step), l: c - Math.abs(step), c, v: i >= n - 3 ? lastVol : vol };
  });
}

describe('Intraday fast lane — indicators and setup scorer', () => {
  it('ema / rsi / atr / vwap behave', () => {
    expect(ema([1, 1, 1, 1], 3)).toBeCloseTo(1);
    expect(rsi(Array.from({ length: 20 }, (_, i) => i + 1))).toBe(100);
    expect(rsi(Array.from({ length: 20 }, (_, i) => 20 - i))).toBeLessThan(1);
    const bars = mkBars(20, 100, 0.1);
    expect(atr(bars)).toBeGreaterThan(0);
    expect(sessionVwap(bars)).toBeGreaterThan(100);
  });

  it('scores a steady uptrend with a volume surge as a momentum setup', () => {
    const bars = mkBars(60, 100, 0.08, 1000, 4000);
    const s = scoreSetup('UP', bars, bars.slice(-20));
    expect(s.setup).toBe('MOMENTUM_CONTINUATION');
    expect(s.score).toBeGreaterThanOrEqual(60);
    expect(s.rvol).toBeGreaterThan(1.5);
  });

  it('rejects a downtrend', () => {
    const bars = mkBars(60, 100, -0.08);
    const s = scoreSetup('DOWN', bars, bars.slice(-20));
    expect(s.setup).toBe('NONE');
    expect(s.score).toBeLessThan(60);
  });

  it('refuses to score with too little data', () => {
    const bars = mkBars(10, 100, 0.1);
    expect(scoreSetup('NEW', bars, bars).reasons[0]).toMatch(/not enough bars/);
  });
});

describe('FRED macro', () => {
  const snap = { fedFundsRate: 4.33, treasury10Y: 4.1, treasury2Y: 3.9, yieldCurve10Y2Y: 0.2, cpiYoY: 2.9, unemploymentRate: 4.2, asOf: '2026-09-28', source: 'FRED' as const };
  it('formats a one-line summary for agents', () => {
    expect(macroLine(snap)).toContain('Fed funds 4.33%');
    expect(macroLine({ ...snap, source: 'UNAVAILABLE' })).toBe('');
  });
  it('fills the macro panel from FRED when available', () => {
    const m = buildMacroData({ assets: { vix: 18 } } as any, snap);
    expect(m.fedRate).toBe(4.33);
    expect(m.inflation).toBe(2.9);
    expect(m.vixLevel).toBe(18);
  });
});
