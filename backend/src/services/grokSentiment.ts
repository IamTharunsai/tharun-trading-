// ── GROK SENTIMENT SERVICE ────────────────────────────────────────────────────
// Uses xAI's Grok model (via OpenAI-compatible API) for real-time X/Twitter
// market sentiment. Grok has native access to X.com data, giving us live
// social sentiment without burning X API rate limits.
//
// Required env var: XAI_API_KEY
// Optional env vars:
//   GROK_MODEL          — model to use (default: grok-3-fast)
//   GROK_CACHE_TTL_SEC  — result cache TTL in seconds (default: 600 = 10 min)
//   GROK_MAX_TOKENS     — max response tokens (default: 512)
//   GROK_ENABLED        — "false" to disable (default: enabled when key is set)
//
// This service SUPPLEMENTS sentimentService.ts, never replaces it. When both
// are available the debate engine's Sentiment Analyst receives both scores.
// ─────────────────────────────────────────────────────────────────────────────

import axios from 'axios';
import { logger } from '../utils/logger';
import { redis } from '../utils/redis';

const GROK_API_BASE = 'https://api.x.ai/v1';

export interface GrokSentimentResult {
  asset: string;
  market: 'stocks' | 'crypto' | 'prediction';
  score: number;               // -1 (very bearish) .. +1 (very bullish)
  confidence: number;          // 0..1
  xTrendingNow: boolean;       // Grok detected the asset trending on X right now
  socialMomentum: 'strong_buy' | 'buy' | 'neutral' | 'sell' | 'strong_sell';
  keyThemes: string[];         // top 3 themes from X discussion
  bullishSignals: string[];    // specific bullish signals from social data
  bearishSignals: string[];    // specific bearish signals from social data
  retailSentiment: 'euphoric' | 'bullish' | 'neutral' | 'fearful' | 'panic';
  institutionalMentions: boolean; // saw any institutional/fund mentions
  model: string;               // model that generated this
  computedAt: string;
  raw?: string;                // raw model response for debugging
}

const EMPTY_GROK_RESULT = (asset: string, market: GrokSentimentResult['market']): GrokSentimentResult => ({
  asset, market, score: 0, confidence: 0, xTrendingNow: false,
  socialMomentum: 'neutral', keyThemes: [], bullishSignals: [], bearishSignals: [],
  retailSentiment: 'neutral', institutionalMentions: false,
  model: 'unavailable', computedAt: new Date().toISOString(),
});

export function isGrokEnabled(): boolean {
  const key = process.env.XAI_API_KEY;
  if (!key || key.trim() === '' || key.startsWith('xai-placeholder')) return false;
  const explicit = String(process.env.GROK_ENABLED ?? '').trim().toLowerCase();
  if (explicit === 'false') return false;
  return true;
}

// ── Cache helpers ─────────────────────────────────────────────────────────────

async function cacheGet<T>(key: string): Promise<T | null> {
  try {
    const raw = await redis.get(key);
    if (!raw) return null;
    const { exp, val } = JSON.parse(raw);
    return Date.now() < exp ? (val as T) : null;
  } catch { return null; }
}

async function cacheSet(key: string, val: unknown, ttlSec: number) {
  try {
    await redis.set(key, JSON.stringify({ exp: Date.now() + ttlSec * 1000, val }));
  } catch { /* cache best-effort */ }
}

// ── Prompt builder ────────────────────────────────────────────────────────────

function buildSentimentPrompt(asset: string, market: GrokSentimentResult['market']): string {
  const assetLabel =
    market === 'crypto' ? `cryptocurrency ${asset}` :
    market === 'prediction' ? `prediction market question: "${asset}"` :
    `stock ticker ${asset}`;

  return `You are a quantitative social sentiment analyst with real-time X (Twitter) data access.

Analyze the CURRENT social media sentiment on X.com for ${assetLabel}.

Focus on the LAST 6 HOURS of X posts. Look at:
1. Volume of mentions (is it trending?)
2. Tone of top/viral posts (bullish or bearish?)
3. Retail vs institutional discussion
4. Fear indicators (panic selling, FUD posts)
5. Greed indicators (FOMO posts, moon talk, euphoria)
6. Any breaking news being discussed

Respond with ONLY this JSON object, no markdown fences, no other text:
{
  "score": <-1.0 to 1.0 where -1=extremely bearish, 0=neutral, 1=extremely bullish>,
  "confidence": <0.0 to 1.0 based on volume of signal>,
  "xTrendingNow": <true if actively trending on X right now>,
  "socialMomentum": <"strong_buy"|"buy"|"neutral"|"sell"|"strong_sell">,
  "keyThemes": ["<theme1>", "<theme2>", "<theme3>"],
  "bullishSignals": ["<signal1>", "<signal2>"],
  "bearishSignals": ["<signal1>", "<signal2>"],
  "retailSentiment": <"euphoric"|"bullish"|"neutral"|"fearful"|"panic">,
  "institutionalMentions": <true|false>
}`;
}

// ── Score normalizer ──────────────────────────────────────────────────────────

function socialMomentumToScore(momentum: string): number {
  const map: Record<string, number> = {
    strong_buy: 0.8, buy: 0.4, neutral: 0, sell: -0.4, strong_sell: -0.8,
  };
  return map[momentum] ?? 0;
}

// ── Main fetch function ────────────────────────────────────────────────────────

export async function getGrokSentiment(
  asset: string,
  market: GrokSentimentResult['market'] = 'stocks',
): Promise<GrokSentimentResult> {
  if (!isGrokEnabled()) return EMPTY_GROK_RESULT(asset, market);

  const ttl = Number(process.env.GROK_CACHE_TTL_SEC ?? 600);
  const cacheKey = `grok:sentiment:v2:${market}:${asset}`;
  const cached = await cacheGet<GrokSentimentResult>(cacheKey);
  if (cached) return cached;

  const apiKey = process.env.XAI_API_KEY!;
  const model = process.env.GROK_MODEL ?? 'grok-3-fast';
  const maxTokens = Number(process.env.GROK_MAX_TOKENS ?? 512);

  try {
    const response = await axios.post(
      `${GROK_API_BASE}/chat/completions`,
      {
        model,
        messages: [
          {
            role: 'user',
            content: buildSentimentPrompt(asset, market),
          },
        ],
        max_tokens: maxTokens,
        temperature: 0.1,     // low temp = consistent structured output
      },
      {
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        timeout: 20_000,
      },
    );

    const rawText = response.data?.choices?.[0]?.message?.content ?? '';
    if (!rawText) throw new Error('Empty Grok response');

    // Extract JSON from response
    const stripped = rawText.replace(/```json\n?|```\n?/g, '').trim();
    const start = stripped.indexOf('{');
    const end = stripped.lastIndexOf('}');
    if (start === -1 || end === -1) throw new Error('No JSON in Grok response');

    const parsed = JSON.parse(stripped.slice(start, end + 1));

    // Validate and clamp
    const score = Math.max(-1, Math.min(1, Number(parsed.score) || 0));
    const confidence = Math.max(0, Math.min(1, Number(parsed.confidence) || 0));
    const momentumScore = socialMomentumToScore(String(parsed.socialMomentum ?? 'neutral'));
    // Blend stated score with momentum-derived score for robustness
    const blendedScore = 0.7 * score + 0.3 * momentumScore;

    const result: GrokSentimentResult = {
      asset: asset.toUpperCase(),
      market,
      score: +blendedScore.toFixed(4),
      confidence: +confidence.toFixed(3),
      xTrendingNow: Boolean(parsed.xTrendingNow),
      socialMomentum: (parsed.socialMomentum as GrokSentimentResult['socialMomentum']) ?? 'neutral',
      keyThemes: Array.isArray(parsed.keyThemes) ? parsed.keyThemes.slice(0, 3).map(String) : [],
      bullishSignals: Array.isArray(parsed.bullishSignals) ? parsed.bullishSignals.slice(0, 3).map(String) : [],
      bearishSignals: Array.isArray(parsed.bearishSignals) ? parsed.bearishSignals.slice(0, 3).map(String) : [],
      retailSentiment: (parsed.retailSentiment as GrokSentimentResult['retailSentiment']) ?? 'neutral',
      institutionalMentions: Boolean(parsed.institutionalMentions),
      model: response.data?.model ?? model,
      computedAt: new Date().toISOString(),
    };

    await cacheSet(cacheKey, result, ttl);

    logger.info(
      `[GROK-SENTIMENT] ${asset}: score=${result.score.toFixed(2)} momentum=${result.socialMomentum} ` +
      `trending=${result.xTrendingNow} retail=${result.retailSentiment} conf=${result.confidence.toFixed(2)}`,
    );

    return result;
  } catch (err: any) {
    logger.warn(`[GROK-SENTIMENT] Failed for ${asset}: ${err?.response?.status ?? ''} ${err?.message}`);
    return EMPTY_GROK_RESULT(asset, market);
  }
}

// ── Formatted summary for debate engine prompts ───────────────────────────────

export function formatGrokForDebate(g: GrokSentimentResult | null): string {
  if (!g || g.confidence === 0 || g.model === 'unavailable') return '';

  const trendBadge = g.xTrendingNow ? ' 🔥 TRENDING ON X' : '';
  const scorePct = (g.score * 100).toFixed(0);
  const lines: string[] = [
    `GROK/X LIVE SENTIMENT${trendBadge}: score ${scorePct > '0' ? '+' : ''}${scorePct} (${g.socialMomentum.replace('_', ' ')}, conf=${(g.confidence * 100).toFixed(0)}%)`,
    `Retail mood: ${g.retailSentiment}${g.institutionalMentions ? ' | Institutional mentions detected' : ''}`,
  ];
  if (g.keyThemes.length > 0) lines.push(`Key themes: ${g.keyThemes.join('; ')}`);
  if (g.bullishSignals.length > 0) lines.push(`Bull signals: ${g.bullishSignals.join(' | ')}`);
  if (g.bearishSignals.length > 0) lines.push(`Bear signals: ${g.bearishSignals.join(' | ')}`);
  lines.push('(Grok has native X.com data — treat as real-time social observation, not a price prediction)');
  return lines.join('\n');
}

// ── Combined sentiment context (Grok + existing SentimentResult) ──────────────

export interface CombinedSentimentContext {
  grok: GrokSentimentResult | null;
  blendedScore: number;         // weighted blend of both sources
  blendedConfidence: number;
  formattedForDebate: string;   // ready to append to agent prompts
}

export async function getCombinedSentiment(
  asset: string,
  market: GrokSentimentResult['market'],
  existingScore?: number,       // score from sentimentService.ts (if already fetched)
  existingConf?: number,
): Promise<CombinedSentimentContext> {
  const grok = await getGrokSentiment(asset, market).catch(() => null);
  const grokScore = grok?.score ?? 0;
  const grokConf = grok?.confidence ?? 0;
  const legacyScore = existingScore ?? 0;
  const legacyConf = existingConf ?? 0;

  // Weight by confidence — high-conf source dominates
  const totalConf = grokConf + legacyConf;
  const blendedScore = totalConf > 0
    ? (grokScore * grokConf + legacyScore * legacyConf) / totalConf
    : 0;
  const blendedConfidence = Math.min(1, (grokConf + legacyConf) / 2 + (grokConf > 0 && legacyConf > 0 ? 0.1 : 0));

  const grokText = formatGrokForDebate(grok);
  const formattedForDebate = grokText
    ? `${grokText}\n`
    : '';

  return { grok, blendedScore, blendedConfidence, formattedForDebate };
}
