// ── INTRADAY FAST LANE ────────────────────────────────────────────────────────
// Goal: 100–150 small, high-quality paper day-trades per session without paying
// for a 30-call committee debate on each one.
//
//   every 2 min (market hours) ──► universe.intradayCandidates()  (live most-actives,
//        │                           gainers, losers — no hardcoded tickers)
//        ▼
//   ONE batched Alpaca call for 5-minute bars of all candidates
//        ▼
//   deterministic setup scorer (VWAP, EMA9/21, RSI14, RVOL, ATR, high-of-day)
//        ▼  top-scoring setups only
//   "fast council": ONE LLM call per candidate in which three lenses
//   (Technician · Risk Manager · Devil's Advocate) each vote → majority + risk veto
//        ▼
//   small bracket order (DAY) sized in dollars, stop = 1.5×ATR(5m), target = 2R
//        ▼
//   exits: broker bracket · app stop monitor · time stop · 15:50 ET flatten
//
// The full 14-agent committee (debateEngine) is still used for swing/long-term
// entries; this lane never touches it.
import axios from 'axios';
import { prisma } from '../utils/prisma';
import { logger } from '../utils/logger';
import { appConfig } from '../utils/config';
import { universe } from '../services/universeService';
import { routedMessagesCreate, parseJsonLoose, stripReasoning } from '../utils/llmRouter';
import { getTradingBroker, getActiveMode } from './brokerRouter';
import { confirmOrderFill } from './executionEngine';
import { closePosition } from './riskManager';
import { isKillSwitchActive } from '../agents/orchestrator';
import { getIO } from '../websocket/server';

// ── configuration (all overridable from Railway env) ──────────────────────────
export function intradayConfig() {
  const n = (k: string, d: number) => { const v = Number(process.env[k]); return Number.isFinite(v) && v > 0 ? v : d; };
  return {
    enabled: process.env.INTRADAY_ENABLED !== 'false',
    maxTradesPerDay: n('INTRADAY_MAX_TRADES_PER_DAY', 150),
    maxOpen: n('INTRADAY_MAX_OPEN', 15),
    notionalUsd: Math.min(Math.max(n('INTRADAY_NOTIONAL_USD', 250), 10), 5000),
    candidatesPerScan: n('INTRADAY_CANDIDATES_PER_SCAN', 30),
    entriesPerScan: n('INTRADAY_ENTRIES_PER_SCAN', 4),
    minScore: n('INTRADAY_MIN_SCORE', 60),
    maxHoldMin: n('INTRADAY_MAX_HOLD_MIN', 90),
    cooldownMin: n('INTRADAY_SYMBOL_COOLDOWN_MIN', 45),
    useLlm: process.env.INTRADAY_USE_LLM !== 'false',
    requireLlm: process.env.INTRADAY_REQUIRE_LLM === 'true',
    maxDailyLossUsd: n('INTRADAY_MAX_DAILY_LOSS_USD', 500),
  };
}

export interface Bar { t: string; o: number; h: number; l: number; c: number; v: number; vw?: number }

export interface SetupScore {
  symbol: string;
  score: number;
  setup: 'MOMENTUM_CONTINUATION' | 'VWAP_RECLAIM' | 'NONE';
  price: number;
  vwap: number;
  ema9: number;
  ema21: number;
  rsi14: number;
  rvol: number;
  atr: number;
  dayHigh: number;
  reasons: string[];
}

// ── indicators (pure, unit-tested) ────────────────────────────────────────────
export function ema(values: number[], period: number): number {
  if (values.length === 0) return NaN;
  const k = 2 / (period + 1);
  let e = values[0];
  for (let i = 1; i < values.length; i++) e = values[i] * k + e * (1 - k);
  return e;
}

export function rsi(values: number[], period = 14): number {
  if (values.length <= period) return NaN;
  let gain = 0, loss = 0;
  for (let i = 1; i <= period; i++) {
    const d = values[i] - values[i - 1];
    if (d >= 0) gain += d; else loss -= d;
  }
  let avgG = gain / period, avgL = loss / period;
  for (let i = period + 1; i < values.length; i++) {
    const d = values[i] - values[i - 1];
    avgG = (avgG * (period - 1) + Math.max(d, 0)) / period;
    avgL = (avgL * (period - 1) + Math.max(-d, 0)) / period;
  }
  if (avgL === 0) return 100;
  return 100 - 100 / (1 + avgG / avgL);
}

export function atr(bars: Bar[], period = 14): number {
  if (bars.length < 2) return NaN;
  const trs: number[] = [];
  for (let i = 1; i < bars.length; i++) {
    const b = bars[i], p = bars[i - 1];
    trs.push(Math.max(b.h - b.l, Math.abs(b.h - p.c), Math.abs(b.l - p.c)));
  }
  const slice = trs.slice(-period);
  return slice.reduce((a, b) => a + b, 0) / slice.length;
}

/** Session VWAP from today's bars (bars must be today's regular-session bars). */
export function sessionVwap(bars: Bar[]): number {
  let pv = 0, vol = 0;
  for (const b of bars) { const tp = (b.h + b.l + b.c) / 3; pv += tp * b.v; vol += b.v; }
  return vol > 0 ? pv / vol : NaN;
}

/**
 * Scores a long setup on 5-minute bars. `bars` = recent bars (can span previous
 * day for indicator warm-up); `todayBars` = bars since today's open.
 */
export function scoreSetup(symbol: string, bars: Bar[], todayBars: Bar[]): SetupScore {
  const closes = bars.map(b => b.c);
  const price = closes[closes.length - 1];
  const base: SetupScore = { symbol, score: 0, setup: 'NONE', price, vwap: NaN, ema9: NaN, ema21: NaN, rsi14: NaN, rvol: NaN, atr: NaN, dayHigh: NaN, reasons: [] };
  if (bars.length < 25 || todayBars.length < 3 || !(price > 0)) return { ...base, reasons: ['not enough bars yet'] };

  const vwap = sessionVwap(todayBars);
  const e9 = ema(closes, 9);
  const e21 = ema(closes, 21);
  const r = rsi(closes, 14);
  const a = atr(bars, 14);
  const dayHigh = Math.max(...todayBars.map(b => b.h));
  const recentVol = todayBars.slice(-3).reduce((s, b) => s + b.v, 0) / Math.min(3, todayBars.length);
  const avgVol = bars.slice(-40, -3).reduce((s, b) => s + b.v, 0) / Math.max(1, Math.min(37, bars.length - 3));
  const rvol = avgVol > 0 ? recentVol / avgVol : 1;
  const out: SetupScore = { ...base, vwap, ema9: e9, ema21: e21, rsi14: r, rvol, atr: a, dayHigh };

  const atrPct = a / price;
  if (!(atrPct > 0.0008)) return { ...out, reasons: ['too quiet (ATR < 0.08%)'] };
  if (atrPct > 0.03) return { ...out, reasons: [`too volatile (5m ATR ${(atrPct * 100).toFixed(1)}%)`] };

  const reasons: string[] = [];
  let score = 0;
  const aboveVwap = price > vwap;
  const trendUp = e9 > e21;
  const prev = todayBars[todayBars.length - 2];
  const reclaimed = prev && prev.c < vwap && price > vwap;
  const nearHigh = dayHigh > 0 && (dayHigh - price) / price < 0.01;

  if (aboveVwap) { score += 20; reasons.push('above VWAP'); }
  if (trendUp) { score += 15; reasons.push('EMA9 > EMA21'); }
  if (r >= 52 && r <= 72) { score += 15; reasons.push(`RSI ${r.toFixed(0)} in momentum zone`); }
  else if (r > 78) { score -= 25; reasons.push(`RSI ${r.toFixed(0)} overbought`); }
  if (rvol >= 1.5) { score += Math.min(25, 10 + (rvol - 1.5) * 10); reasons.push(`relative volume ${rvol.toFixed(1)}x`); }
  if (nearHigh) { score += 10; reasons.push('pressing high of day'); }
  if (reclaimed) { score += 15; reasons.push('reclaimed VWAP this bar'); }
  if (price > e9) { score += 5; }
  if ((price - vwap) / price > 0.03) { score -= 20; reasons.push('extended >3% above VWAP'); }

  const setup: SetupScore['setup'] = reclaimed && trendUp ? 'VWAP_RECLAIM' : (aboveVwap && trendUp && rvol >= 1.2 ? 'MOMENTUM_CONTINUATION' : 'NONE');
  return { ...out, score: Math.max(0, Math.min(100, Math.round(score))), setup, reasons };
}

// ── market data ───────────────────────────────────────────────────────────────
function alpacaHeaders() {
  return { 'APCA-API-KEY-ID': appConfig.ALPACA.paperApiKey || '', 'APCA-API-SECRET-KEY': appConfig.ALPACA.paperSecretKey || '' };
}

export async function marketClock(): Promise<{ isOpen: boolean; nextClose: string | null }> {
  try {
    const r = await axios.get(`${appConfig.ALPACA.paperBaseUrl}/v2/clock`, { headers: alpacaHeaders(), timeout: 8000 });
    return { isOpen: Boolean(r.data?.is_open), nextClose: r.data?.next_close || null };
  } catch {
    return { isOpen: false, nextClose: null };
  }
}

/** One request for 5-minute bars of many symbols. */
export async function fetchBars5m(symbols: string[]): Promise<Record<string, Bar[]>> {
  if (symbols.length === 0) return {};
  const start = new Date(Date.now() - 4 * 24 * 3600 * 1000).toISOString();
  const out: Record<string, Bar[]> = {};
  let pageToken: string | undefined;
  for (let page = 0; page < 10; page++) {
    const r = await axios.get('https://data.alpaca.markets/v2/stocks/bars', {
      params: { symbols: symbols.join(','), timeframe: '5Min', start, limit: 10000, feed: process.env.ALPACA_DATA_FEED || 'iex', adjustment: 'raw', ...(pageToken ? { page_token: pageToken } : {}) },
      headers: alpacaHeaders(), timeout: 20000,
    });
    for (const [sym, bars] of Object.entries<any[]>(r.data?.bars || {})) {
      (out[sym] ||= []).push(...bars.map(b => ({ t: b.t, o: b.o, h: b.h, l: b.l, c: b.c, v: b.v, vw: b.vw })));
    }
    pageToken = r.data?.next_page_token || undefined;
    if (!pageToken) break;
  }
  return out;
}

function etDateKey(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', { timeZone: 'America/New_York' });
}

// ── fast council (one LLM call, three lenses) ─────────────────────────────────
export interface FastVerdict { approve: boolean; confidence: number; votes: Array<{ agent: string; vote: 'BUY' | 'HOLD'; reason: string }>; error?: string }

export async function fastCouncil(s: SetupScore, context: { stop: number; target: number }): Promise<FastVerdict> {
  const prompt = `You are a 3-member intraday trading desk reviewing ONE long setup on 5-minute bars. Be skeptical; only approve clean setups.
Symbol ${s.symbol} | price $${s.price.toFixed(2)} | VWAP $${s.vwap.toFixed(2)} | EMA9 ${s.ema9.toFixed(2)} | EMA21 ${s.ema21.toFixed(2)} | RSI14 ${s.rsi14.toFixed(1)} | RVOL ${s.rvol.toFixed(2)}x | ATR(5m) $${s.atr.toFixed(3)} | high of day $${s.dayHigh.toFixed(2)}
Detected setup: ${s.setup} (score ${s.score}/100): ${s.reasons.join('; ')}
Plan: buy now, stop $${context.stop.toFixed(2)}, target $${context.target.toFixed(2)} (2R), max hold 90 minutes, flat by 15:50 ET.
Each member votes BUY or HOLD with a one-sentence reason:
- "Technician": is the price action and trend clean?
- "Risk Manager": is the stop sensible for the volatility, is it chasing? (has veto)
- "Devil's Advocate": strongest reason this fails.
Reply ONLY with JSON: {"votes":[{"agent":"Technician","vote":"BUY|HOLD","reason":"..."},{"agent":"Risk Manager","vote":"BUY|HOLD","reason":"..."},{"agent":"Devil's Advocate","vote":"BUY|HOLD","reason":"..."}],"confidence":0-100}`;
  try {
    const res = await routedMessagesCreate({ model: 'fast', max_tokens: 400, temperature: 0.2, messages: [{ role: 'user', content: prompt }] });
    const text = stripReasoning((res.content || []).find((c: any) => c.type === 'text')?.text || '');
    const parsed = parseJsonLoose<{ votes: FastVerdict['votes']; confidence: number }>(text);
    if (!parsed?.votes?.length) return { approve: false, confidence: 0, votes: [], error: 'unparseable LLM reply' };
    const votes = parsed.votes.map(v => ({ agent: String(v.agent), vote: (String(v.vote).toUpperCase() === 'BUY' ? 'BUY' : 'HOLD') as 'BUY' | 'HOLD', reason: String(v.reason || '').slice(0, 240) }));
    const buys = votes.filter(v => v.vote === 'BUY').length;
    const riskVeto = votes.some(v => /risk/i.test(v.agent) && v.vote !== 'BUY');
    const confidence = Math.max(0, Math.min(100, Number(parsed.confidence) || 0));
    return { approve: buys >= 2 && !riskVeto && confidence >= 55, confidence, votes };
  } catch (err: any) {
    return { approve: false, confidence: 0, votes: [], error: err?.message || 'LLM error' };
  }
}

// ── state ─────────────────────────────────────────────────────────────────────
const cooldown = new Map<string, number>();
let lastScan: { at: string; candidates: number; scored: number; passed: number; entered: string[]; note?: string } | null = null;
let scanning = false;

function startOfEtDay(): Date {
  const now = new Date();
  const et = new Date(now.toLocaleString('en-US', { timeZone: 'America/New_York' }));
  const offsetMs = now.getTime() - et.getTime();
  et.setHours(0, 0, 0, 0);
  return new Date(et.getTime() + offsetMs);
}

async function intradayTradesToday() {
  const trades = await prisma.trade.findMany({
    where: { openedAt: { gte: startOfEtDay() }, market: 'stocks' },
    select: { status: true, pnl: true, metadata: true },
  });
  const lane = trades.filter((t: any) => (t.metadata as any)?.lane === 'INTRADAY');
  return {
    count: lane.filter((t: any) => t.status === 'OPEN' || t.status === 'CLOSED').length,
    realizedPnl: lane.reduce((s: number, t: any) => s + (t.status === 'CLOSED' ? (t.pnl || 0) : 0), 0),
  };
}

export async function getIntradayStatus() {
  const cfg = intradayConfig();
  const today = await intradayTradesToday().catch(() => ({ count: 0, realizedPnl: 0 }));
  return { enabled: cfg.enabled, tradesToday: today.count, maxPerDay: cfg.maxTradesPerDay, realizedPnlToday: today.realizedPnl, notionalUsd: cfg.notionalUsd, lastScan };
}

// ── entry ─────────────────────────────────────────────────────────────────────
async function enter(s: SetupScore, verdict: FastVerdict | null, cfg: ReturnType<typeof intradayConfig>): Promise<boolean> {
  const broker: any = getTradingBroker();
  const stopDist = Math.min(Math.max(1.5 * s.atr, s.price * 0.004), s.price * 0.02);
  const stop = +(s.price - stopDist).toFixed(2);
  const target = +(s.price + 2 * stopDist).toFixed(2);
  const wholeQty = Math.floor(cfg.notionalUsd / s.price);
  const asset = universe.get(s.symbol);
  const qty = wholeQty >= 1 ? wholeQty : (asset?.fractionable ? Math.floor((cfg.notionalUsd / s.price) * 10000) / 10000 : 0);
  if (!(qty > 0)) { logger.info(`⚡ ${s.symbol}: $${s.price.toFixed(2)} too expensive for $${cfg.notionalUsd} and not fractionable`); return false; }

  const decision = await prisma.agentDecision.create({
    data: {
      asset: s.symbol, signal: 'BUY', finalVote: 'BUY', horizon: 'INTRADAY',
      totalVotes: verdict?.votes.length || 0,
      goVotes: verdict?.votes.filter(v => v.vote === 'BUY').length || 0,
      noGoVotes: verdict?.votes.filter(v => v.vote !== 'BUY').length || 0,
      avgConfidence: verdict?.confidence ?? s.score,
      agentVotes: (verdict?.votes || []) as any,
      marketSnapshot: { lane: 'INTRADAY', ...s } as any,
      regime: s.setup,
      executionReason: `Intraday ${s.setup} score ${s.score}`,
    },
  }).catch(() => null);

  const trade = await prisma.trade.create({
    data: {
      asset: s.symbol, market: 'stocks', type: 'BUY', entryPrice: s.price, quantity: qty, status: 'PENDING',
      stopLossPrice: stop, takeProfitPrice: target,
      ...(decision ? { agentDecisionId: decision.id } : {}),
      metadata: { lane: 'INTRADAY', setup: s.setup, score: s.score, reasons: s.reasons, llm: verdict ? { confidence: verdict.confidence, votes: verdict.votes } : null } as any,
    },
  });

  let fillPrice = s.price, fillQty = qty, brokerOrderId = `local-sim-${Date.now()}`, brokerConfirmed = false;
  let protection = 'APPLICATION_MONITORED';
  if (broker) {
    const payload: any = wholeQty >= 1
      ? { symbol: s.symbol, qty: wholeQty, side: 'buy', type: 'market', time_in_force: 'day', order_class: 'bracket', take_profit: { limit_price: target }, stop_loss: { stop_price: stop }, client_order_id: trade.id }
      : { symbol: s.symbol, qty, side: 'buy', type: 'market', time_in_force: 'day', client_order_id: trade.id };
    try {
      const t0 = Date.now();
      const placed = await broker.createOrder(payload);
      brokerOrderId = placed.id;
      const fill = await confirmOrderFill(broker, placed.id, 8, 750);
      fillPrice = fill.fillPrice; fillQty = fill.fillQty; brokerConfirmed = true;
      protection = wholeQty >= 1 ? 'BROKER_HOSTED' : 'APPLICATION_MONITORED';
      await prisma.trade.update({ where: { id: trade.id }, data: { fillLatencyMs: Date.now() - t0 } }).catch(() => {});
    } catch (err: any) {
      const msg = err?.response?.data?.message || err.message;
      await prisma.trade.update({ where: { id: trade.id }, data: { status: 'REJECTED', exitReason: `Broker rejected: ${msg}`, brokerOrderId } });
      logger.warn(`⚡ ${s.symbol}: order rejected — ${msg}`);
      return false;
    }
  } else if (getActiveMode() === 'live') {
    await prisma.trade.update({ where: { id: trade.id }, data: { status: 'FAILED', exitReason: 'Live mode without live broker' } });
    return false;
  }

  await prisma.trade.update({ where: { id: trade.id }, data: { status: 'OPEN', entryPrice: fillPrice, quantity: fillQty, brokerOrderId, brokerConfirmed, reconciliationStatus: brokerConfirmed ? 'BROKER_RECONCILED' : 'UNCONFIRMED_LOCAL_SIMULATION' } });
  await prisma.position.upsert({
    where: { asset: s.symbol },
    create: { asset: s.symbol, market: 'stocks', side: 'BUY', quantity: fillQty, entryPrice: fillPrice, currentPrice: fillPrice, stopLossPrice: stop, takeProfitPrice: target, protectionStatus: protection, status: 'OPEN' },
    update: { side: 'BUY', quantity: fillQty, entryPrice: fillPrice, currentPrice: fillPrice, stopLossPrice: stop, takeProfitPrice: target, protectionStatus: protection, status: 'OPEN', openedAt: new Date() },
  });
  if (decision) await prisma.agentDecision.update({ where: { id: decision.id }, data: { executed: true } }).catch(() => {});
  cooldown.set(s.symbol, Date.now());
  getIO()?.emit('trade:executed', { trade: { id: trade.id, asset: s.symbol, type: 'BUY', entryPrice: fillPrice, quantity: fillQty, status: 'OPEN', lane: 'INTRADAY' } });
  logger.info(`⚡ INTRADAY ENTRY ${s.symbol} ${fillQty} @ $${fillPrice.toFixed(2)} (stop $${stop}, target $${target}, ${s.setup} ${s.score}${verdict ? `, council ${verdict.confidence}%` : ''})`);
  return true;
}

/** One scan cycle. Returns what happened (also exposed via lastScan for the UI). */
export async function runIntradayScan(opts: { force?: boolean } = {}) {
  const cfg = intradayConfig();
  if (!cfg.enabled || isKillSwitchActive() || scanning) return lastScan;
  scanning = true;
  try {
    const clock = await marketClock();
    if (!clock.isOpen && !opts.force) { lastScan = { at: new Date().toISOString(), candidates: 0, scored: 0, passed: 0, entered: [], note: 'market closed' }; return lastScan; }
    const etNow = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/New_York' }));
    const minutes = etNow.getHours() * 60 + etNow.getMinutes();
    if (!opts.force && (minutes < 9 * 60 + 40 || minutes > 15 * 60 + 30)) { lastScan = { at: new Date().toISOString(), candidates: 0, scored: 0, passed: 0, entered: [], note: 'outside entry window (9:40–15:30 ET)' }; return lastScan; }

    const today = await intradayTradesToday();
    if (today.count >= cfg.maxTradesPerDay) { lastScan = { at: new Date().toISOString(), candidates: 0, scored: 0, passed: 0, entered: [], note: `daily cap ${cfg.maxTradesPerDay} reached` }; return lastScan; }
    if (today.realizedPnl <= -cfg.maxDailyLossUsd) { lastScan = { at: new Date().toISOString(), candidates: 0, scored: 0, passed: 0, entered: [], note: `intraday daily loss limit -$${cfg.maxDailyLossUsd} hit` }; return lastScan; }

    const open = await prisma.position.findMany({ where: { status: 'OPEN' }, select: { asset: true } });
    const openIntraday = await prisma.trade.count({ where: { status: 'OPEN', openedAt: { gte: startOfEtDay() }, metadata: { path: ['lane'], equals: 'INTRADAY' } } }).catch(() => 0);
    const slots = Math.min(cfg.entriesPerScan, cfg.maxOpen - openIntraday, cfg.maxTradesPerDay - today.count);
    if (slots <= 0) { lastScan = { at: new Date().toISOString(), candidates: 0, scored: 0, passed: 0, entered: [], note: `max open intraday positions (${cfg.maxOpen})` }; return lastScan; }

    const now = Date.now();
    const exclude = new Set<string>(open.map((p: any) => p.asset));
    for (const [sym, t] of cooldown) if (now - t < cfg.cooldownMin * 60_000) exclude.add(sym);
    const candidates = universe.intradayCandidates(cfg.candidatesPerScan, { exclude, maxPrice: Math.max(cfg.notionalUsd * 4, 50) });
    if (candidates.length === 0) { lastScan = { at: new Date().toISOString(), candidates: 0, scored: 0, passed: 0, entered: [], note: 'universe not synced yet' }; return lastScan; }

    const barsBySym = await fetchBars5m(candidates);
    const todayKey = etDateKey(new Date().toISOString());
    const scored = candidates.map(sym => {
      const bars = (barsBySym[sym] || []).slice(-120);
      const todayBars = bars.filter(b => etDateKey(b.t) === todayKey);
      return scoreSetup(sym, bars, todayBars);
    }).filter(s => s.setup !== 'NONE' && s.score >= cfg.minScore).sort((a, b) => b.score - a.score);

    const entered: string[] = [];
    for (const s of scored) {
      if (entered.length >= slots || isKillSwitchActive()) break;
      let verdict: FastVerdict | null = null;
      if (cfg.useLlm) {
        const stopDist = Math.min(Math.max(1.5 * s.atr, s.price * 0.004), s.price * 0.02);
        verdict = await fastCouncil(s, { stop: s.price - stopDist, target: s.price + 2 * stopDist });
        if (verdict.error && cfg.requireLlm) continue;
        if (!verdict.error && !verdict.approve) { cooldown.set(s.symbol, Date.now()); continue; }
        if (verdict.error) logger.warn(`⚡ ${s.symbol}: council unavailable (${verdict.error}) — proceeding on quant score ${s.score}`);
      }
      if (await enter(s, verdict && !verdict.error ? verdict : null, cfg).catch(err => { logger.error(`Intraday entry failed for ${s.symbol}`, { error: err?.message }); return false; })) entered.push(s.symbol);
    }
    lastScan = { at: new Date().toISOString(), candidates: candidates.length, scored: scored.length, passed: scored.length, entered };
    if (entered.length || scored.length) logger.info(`⚡ Intraday scan: ${candidates.length} candidates → ${scored.length} setups → entered [${entered.join(', ')}]`);
    return lastScan;
  } catch (err: any) {
    logger.error('Intraday scan failed', { error: err?.message });
    lastScan = { at: new Date().toISOString(), candidates: 0, scored: 0, passed: 0, entered: [], note: `error: ${err?.message}` };
    return lastScan;
  } finally {
    scanning = false;
  }
}

/** Time stop + end-of-day flatten for intraday-lane positions. */
export async function manageIntradayExits(opts: { flattenAll?: boolean } = {}) {
  const cfg = intradayConfig();
  const openTrades = await prisma.trade.findMany({ where: { status: 'OPEN', market: 'stocks' } });
  const lane = openTrades.filter((t: any) => (t.metadata as any)?.lane === 'INTRADAY');
  for (const t of lane) {
    const ageMin = (Date.now() - new Date(t.openedAt).getTime()) / 60_000;
    if (!opts.flattenAll && ageMin < cfg.maxHoldMin) continue;
    const pos = await prisma.position.findFirst({ where: { asset: t.asset, status: 'OPEN' } });
    if (!pos) continue;
    const reason = opts.flattenAll ? 'intraday_eod_flatten' : 'intraday_time_stop';
    await closePosition(pos, pos.currentPrice, reason).catch(err => logger.error(`Intraday exit failed ${t.asset}`, { error: err?.message }));
  }
}
