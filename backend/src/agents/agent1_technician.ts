import Anthropic from '@anthropic-ai/sdk';
import { AgentVote, MarketSnapshot } from './types';
import { logger } from '../utils/logger';
import { expertPrompts } from './expertPrompts';

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const SYSTEM_PROMPT = expertPrompts.agent1_technician;

export async function runAgent1Technician(snapshot: MarketSnapshot): Promise<AgentVote> {
  const start = Date.now();

  try {
    const userPrompt = `
Analyze ${snapshot.asset} for a potential trade RIGHT NOW.

CURRENT PRICE: $${snapshot.price}
24h Change: ${snapshot.priceChangePct24h.toFixed(2)}%
24h High: $${snapshot.high24h} | 24h Low: $${snapshot.low24h}
Volume 24h: ${snapshot.volume24h.toLocaleString()}

TECHNICAL INDICATORS:
- RSI(14): ${snapshot.indicators.rsi14.toFixed(2)} ${snapshot.indicators.rsi14 > 70 ? '⚠️ OVERBOUGHT' : snapshot.indicators.rsi14 < 30 ? '⚠️ OVERSOLD' : '(neutral)'}
- MACD Value: ${snapshot.indicators.macd.value.toFixed(4)} | Signal: ${snapshot.indicators.macd.signal.toFixed(4)} | Histogram: ${snapshot.indicators.macd.histogram.toFixed(4)}
- Bollinger Bands: Upper: $${snapshot.indicators.bollingerBands.upper.toFixed(2)} | Middle: $${snapshot.indicators.bollingerBands.middle.toFixed(2)} | Lower: $${snapshot.indicators.bollingerBands.lower.toFixed(2)}
- EMA 9: $${snapshot.indicators.ema9.toFixed(2)} | EMA 21: $${snapshot.indicators.ema21.toFixed(2)} | EMA 200: $${snapshot.indicators.ema200.toFixed(2)}
- SMA 50: $${snapshot.indicators.sma50.toFixed(2)} | SMA 200: $${snapshot.indicators.sma200.toFixed(2)}
- ATR(14): ${snapshot.indicators.atr14.toFixed(4)}
- Stochastic K: ${snapshot.indicators.stochasticK.toFixed(2)} | D: ${snapshot.indicators.stochasticD.toFixed(2)}
- OBV Trend: ${snapshot.indicators.obv > 0 ? 'POSITIVE (accumulation)' : 'NEGATIVE (distribution)'}
- Volume vs 20-day avg: ${((snapshot.volume24h / snapshot.indicators.volumeAvg20) * 100).toFixed(0)}%

LAST 5 CANDLES (1h):
${snapshot.candles.slice(-5).map((c, i) => 
  `  [${i+1}] O:${c.open.toFixed(2)} H:${c.high.toFixed(2)} L:${c.low.toFixed(2)} C:${c.close.toFixed(2)} Vol:${c.volume.toFixed(0)} ${c.close > c.open ? '🟢' : '🔴'}`
).join('\n')}

Give your technical analysis vote now.`;

    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 600,
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: userPrompt }]
    });

    const content = response.content[0];
    if (content.type !== 'text') throw new Error('Unexpected response type');

    const parsed = JSON.parse(content.text);

    return {
      agentId: 1,
      agentName: 'The Technician',
      vote: parsed.vote,
      confidence: Math.min(100, Math.max(0, parsed.confidence)),
      reasoning: parsed.reasoning,
      keyFactors: parsed.keyFactors || [],
      riskWarnings: parsed.riskWarnings || [],
      executionTime: Date.now() - start,
      timestamp: Date.now()
    };
  } catch (error) {
    logger.error('Agent 1 (Technician) failed', { error, asset: snapshot.asset });
    return {
      agentId: 1,
      agentName: 'The Technician',
      vote: 'HOLD',
      confidence: 0,
      reasoning: 'Agent failed to respond — defaulting to HOLD for safety',
      keyFactors: ['Agent timeout/error'],
      riskWarnings: ['Technical analysis unavailable'],
      executionTime: Date.now() - start,
      timestamp: Date.now()
    };
  }
}
