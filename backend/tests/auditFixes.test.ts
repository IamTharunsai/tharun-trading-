// Regression tests for the 2026-09-28 audit fixes.
jest.mock('../src/utils/prisma', () => ({ prisma: {} }));
jest.mock('../src/utils/logger', () => ({ logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() } }));
jest.mock('../src/services/marketData', () => ({ getCurrentPrice: jest.fn(), buildMarketSnapshot: jest.fn() }));
import { buildStockOrder } from '../src/trading/executionEngine';
import { preDebateGate } from '../src/trading/preDebateGate';
import { toOpenAiChat, tierForModel, providerFor } from '../src/utils/llmRouter';

const sig = (over: any = {}) => ({
  asset: 'NVDA', market: 'stocks', direction: 'BUY', confidence: 80,
  entryPrice: 200, stopLossPrice: 194, takeProfitPrice: 215, positionSizePct: 5,
  reasoning: '', agentDecisionId: '', ...over,
}) as any;

describe('buildStockOrder — small-account order construction', () => {
  it('never rounds a fractional quantity UP to 1 share (old Math.max(1, qty) bug)', () => {
    const o = buildStockOrder(sig(), 0.25)!;
    expect(o.payload.qty).toBe(0.25);
    expect(o.payload.order_class).toBeUndefined();          // no bracket on fractional
    expect(o.payload.time_in_force).toBe('day');             // fractional must be DAY
    expect(o.protection).toBe('APPLICATION_MONITORED');
  });

  it('uses a GTC bracket (broker-hosted stop+target) for whole shares', () => {
    const o = buildStockOrder(sig(), 3.7)!;
    expect(o.payload.qty).toBe(3);
    expect(o.payload.order_class).toBe('bracket');
    expect(o.payload.time_in_force).toBe('gtc');
    expect(o.payload.stop_loss.stop_price).toBe(194);
    expect(o.protection).toBe('BROKER_HOSTED');
  });

  it('refuses a fractional short', () => {
    expect(buildStockOrder(sig({ direction: 'SELL' }), 0.5)).toBeNull();
  });
});

describe('preDebateGate — no paid debate without a setup', () => {
  const base = { price: 100, volume24h: 1_000_000, indicators: { rsi14: 50, ema9: 100.5, ema21: 99, ema200: 90, volumeAvg20: 1_000_000, atr14: 2 } };
  it('passes a trend pullback', () => {
    expect(preDebateGate(base).pass).toBe(true);
  });
  it('rejects a downtrend', () => {
    expect(preDebateGate({ ...base, indicators: { ...base.indicators, ema200: 120 } }).pass).toBe(false);
  });
  it('rejects missing indicators instead of passing on NaN', () => {
    expect(preDebateGate({ ...base, indicators: { ...base.indicators, rsi14: NaN } }).pass).toBe(false);
  });
});

describe('llmRouter', () => {
  it('maps haiku to the fast tier and sonnet to smart', () => {
    expect(tierForModel('claude-haiku-4-5-20251001')).toBe('fast');
    expect(tierForModel('claude-sonnet-5')).toBe('smart');
  });
  it('defaults to anthropic and accepts ollama/nvidia', () => {
    delete process.env.LLM_PROVIDER_FAST;
    expect(providerFor('fast')).toBe('anthropic');
    process.env.LLM_PROVIDER_FAST = 'ollama';
    expect(providerFor('fast')).toBe('ollama');
    delete process.env.LLM_PROVIDER_FAST;
  });
  it('translates Anthropic system blocks + content arrays to OpenAI chat', () => {
    const r = toOpenAiChat({
      system: [{ type: 'text', text: 'SYS', cache_control: { type: 'ephemeral' } }],
      messages: [{ role: 'user', content: [{ type: 'text', text: 'A' }, { type: 'text', text: 'B' }] }],
      max_tokens: 10,
    }, 'qwen2.5:14b-instruct');
    expect(r.messages).toEqual([{ role: 'system', content: 'SYS' }, { role: 'user', content: 'A\nB' }]);
    expect(r.model).toBe('qwen2.5:14b-instruct');
  });
});

describe('preDebateGate — sentiment spike candidates', () => {
  const base = { price: 100, volume24h: 1_000_000, indicators: { rsi14: 62, ema9: 99, ema21: 100, ema200: 90, volumeAvg20: 1_000_000, atr14: 2 } };
  it('a positive news-volume spike in a long-term uptrend earns a committee review', () => {
    const r = preDebateGate({ ...base, sentiment: { score: 0.5, mentionCount: 12, volumeZScore: 3 } });
    expect(r.pass).toBe(true);
    expect(r.setup).toBe('SENTIMENT_SPIKE');
  });
  it('no spike, negative spike, thin evidence or a downtrend → still rejected', () => {
    expect(preDebateGate(base).pass).toBe(false);
    expect(preDebateGate({ ...base, sentiment: { score: -0.5, mentionCount: 12, volumeZScore: 3 } }).pass).toBe(false);
    expect(preDebateGate({ ...base, sentiment: { score: 0.5, mentionCount: 2, volumeZScore: 3 } }).pass).toBe(false);
    expect(preDebateGate({ ...base, indicators: { ...base.indicators, ema200: 120 }, sentiment: { score: 0.5, mentionCount: 12, volumeZScore: 3 } }).pass).toBe(false);
  });
});
