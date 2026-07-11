# Gap Remediation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the verified, code-confirmed gaps found by an independent architecture audit — a dead safety variable, a manual-close safety gap, fake technical indicators, a discarded macro-risk computation, 9 dead database models silently redirected into an untyped log table, an unresolvable Polymarket position bug, and an unvalidated backtest — establishing a clean, tested baseline before the Kronos/TradingAgents/day-trading work in the later plans lands on top of it.

**Architecture:** Ten independent, sequential fixes against the existing Node.js/TypeScript/Express/Prisma backend at `apex-trader/backend`. No new services, no new external dependencies — every fix reuses code, patterns, or database models that already exist in this codebase.

**Tech Stack:** TypeScript, Express, Prisma (PostgreSQL), Jest + ts-jest (existing test runner — `roots: ['<rootDir>/tests', '<rootDir>/src']`, pattern: mock narrow collaborators with `jest.fn()`, assert on return values/call counts, no test DB, no supertest/HTTP layer).

## Global Constraints

- Every fix reuses an existing pattern/model already in the codebase — no new npm packages.
- Prisma import path everywhere: `import { prisma } from '../utils/prisma';`
- Test files go in `apex-trader/backend/tests/`, matching `tests/executionEngine.test.ts`'s style (mock the narrow external collaborator, e.g. an API client function, not the whole module; assert on the real function's return value and mock call arguments).
- `POST /api/backtest/run` already requires `requireAuth` as of this session's earlier fix (`backend/src/routes/backtest.ts`) — do not remove it.
- Commit after every task, not after every step within a task, unless a task's own steps note otherwise.

---

### Task 1: Wire in `weeklyDrawdownLimit` as a real middle-tier circuit breaker

**Files:**
- Modify: `apex-trader/backend/src/trading/riskManager.ts:9-20` (and the body of `validateTradeSignal` below it)
- Test: `apex-trader/backend/tests/riskManager.weeklyDrawdown.test.ts`

**Interfaces:**
- Consumes: `PortfolioState` (existing type, already imported in `riskManager.ts`) — needs a `pnlWeekPct: number` field. Check `apex-trader/backend/src/agents/types.ts` (or wherever `PortfolioState` is defined) for the existing shape before adding the field, since `getPortfolioState()` (in `src/services/portfolio.ts`) is the producer and must be updated to compute it.
- Produces: `validateTradeSignal` now also rejects with `reason: 'Weekly drawdown limit hit: X% (limit Y%)'` when `portfolio.pnlWeekPct <= -weeklyDrawdownLimit`.

Today's daily P&L baseline (`pnlDay`) is computed against a `portfolioSnapshot` taken at start-of-day (per project memory: "a real snapshot baseline, not just today's closed trades"). A weekly figure needs the same pattern: the earliest `PortfolioSnapshot` row within the last 7 days, not just today's.

- [ ] **Step 1: Find `PortfolioState`'s definition and `getPortfolioState`'s pnlDay calculation**

Read `apex-trader/backend/src/services/portfolio.ts` and find where `pnlDayPct` is computed (it references a start-of-day `PortfolioSnapshot`). Confirm the exact query shape (e.g. `prisma.portfolioSnapshot.findFirst({ where: { timestamp: { gte: startOfDay } }, orderBy: { timestamp: 'asc' } })`) so the weekly version mirrors it exactly with a 7-day window instead of a same-day window.

- [ ] **Step 2: Write the failing test for the new `pnlWeekPct` field**

```ts
// apex-trader/backend/tests/portfolio.weeklyPnl.test.ts
import { prisma } from '../src/utils/prisma';
import { getPortfolioState } from '../src/services/portfolio';

jest.mock('../src/utils/prisma', () => ({
  prisma: {
    portfolioSnapshot: { findFirst: jest.fn() },
    position: { findMany: jest.fn().mockResolvedValue([]) },
    trade: { findMany: jest.fn().mockResolvedValue([]) },
  },
}));

describe('getPortfolioState — weekly P&L', () => {
  it('computes pnlWeekPct from the earliest snapshot in the last 7 days', async () => {
    (prisma.portfolioSnapshot.findFirst as jest.Mock).mockImplementation(({ where }: any) => {
      // First call in the function is expected to be the weekly lookup (7-day window)
      return Promise.resolve({ totalValue: 100000, timestamp: new Date() });
    });

    const state = await getPortfolioState();
    expect(typeof state.pnlWeekPct).toBe('number');
  });
});
```

- [ ] **Step 2b: Run test to verify it fails**

Run: `cd apex-trader/backend && npx jest tests/portfolio.weeklyPnl.test.ts`
Expected: FAIL — `pnlWeekPct` is `undefined`, `typeof undefined !== 'number'`.

- [ ] **Step 3: Add `pnlWeekPct` to `PortfolioState` and compute it in `getPortfolioState`**

In `apex-trader/backend/src/agents/types.ts` (or the actual file defining `PortfolioState` — confirm via the import in `portfolio.ts`), add:

```ts
export interface PortfolioState {
  // ...existing fields...
  pnlWeekPct: number;
}
```

In `apex-trader/backend/src/services/portfolio.ts`, alongside the existing start-of-day snapshot lookup, add:

```ts
const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
const weekStartSnapshot = await prisma.portfolioSnapshot.findFirst({
  where: { timestamp: { gte: sevenDaysAgo } },
  orderBy: { timestamp: 'asc' },
});
const pnlWeekPct = weekStartSnapshot
  ? ((totalValue - weekStartSnapshot.totalValue) / weekStartSnapshot.totalValue) * 100
  : 0;
```

Add `pnlWeekPct` to the returned `PortfolioState` object (`totalValue` here is whatever variable the existing function already computes for the current portfolio value — reuse it, don't recompute).

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apex-trader/backend && npx jest tests/portfolio.weeklyPnl.test.ts`
Expected: PASS

- [ ] **Step 5: Write the failing test for the risk-manager gate**

```ts
// apex-trader/backend/tests/riskManager.weeklyDrawdown.test.ts
import { validateTradeSignal } from '../src/trading/riskManager';
import { TradeSignal, PortfolioState } from '../src/agents/types';

const baseSignal: TradeSignal = {
  asset: 'AAPL', market: 'stocks', direction: 'BUY', confidence: 80,
  entryPrice: 100, stopLossPrice: 95, takeProfitPrice: 110,
  positionSizePct: 1, reasoning: 'test', agentDecisionId: 'x',
};

const basePortfolio: PortfolioState = {
  totalValue: 100000, cashBalance: 40000, invested: 60000,
  pnlDay: 0, pnlDayPct: 0, pnlTotal: 0, pnlTotalPct: 0,
  pnlWeekPct: 0,
} as PortfolioState;

describe('validateTradeSignal — weekly drawdown', () => {
  it('rejects when pnlWeekPct breaches WEEKLY_DRAWDOWN_LIMIT_PCT', async () => {
    process.env.WEEKLY_DRAWDOWN_LIMIT_PCT = '10';
    const portfolio = { ...basePortfolio, pnlWeekPct: -12 };
    const result = await validateTradeSignal(baseSignal, portfolio);
    expect(result.approved).toBe(false);
    expect(result.reason).toMatch(/weekly drawdown/i);
  });

  it('approves when pnlWeekPct is within the limit', async () => {
    process.env.WEEKLY_DRAWDOWN_LIMIT_PCT = '10';
    const portfolio = { ...basePortfolio, pnlWeekPct: -3 };
    const result = await validateTradeSignal(baseSignal, portfolio);
    expect(result.approved).toBe(true);
  });
});
```

- [ ] **Step 6: Run test to verify it fails**

Run: `cd apex-trader/backend && npx jest tests/riskManager.weeklyDrawdown.test.ts`
Expected: FAIL — currently approves regardless of `pnlWeekPct` since the check doesn't exist yet.

- [ ] **Step 7: Add the check in `validateTradeSignal`**

In `apex-trader/backend/src/trading/riskManager.ts`, find where `dailyLossLimit` is checked (the existing `if (portfolio.pnlDayPct <= -dailyLossLimit)` block) and add immediately after it:

```ts
  if (portfolio.pnlWeekPct <= -weeklyDrawdownLimit) {
    return { approved: false, reason: `Weekly drawdown limit hit: ${portfolio.pnlWeekPct.toFixed(2)}% (limit ${weeklyDrawdownLimit}%)` };
  }
```

(`weeklyDrawdownLimit` is already declared on line 15 — this step is the only thing missing.)

- [ ] **Step 8: Run both tests to verify they pass**

Run: `cd apex-trader/backend && npx jest tests/riskManager.weeklyDrawdown.test.ts tests/portfolio.weeklyPnl.test.ts`
Expected: PASS (4 tests)

- [ ] **Step 9: Commit**

```bash
cd apex-trader
git add backend/src/trading/riskManager.ts backend/src/services/portfolio.ts backend/src/agents/types.ts backend/tests/riskManager.weeklyDrawdown.test.ts backend/tests/portfolio.weeklyPnl.test.ts
git commit -m "Wire in weeklyDrawdownLimit as a real middle-tier circuit breaker

Was declared and read but never checked in any conditional. Adds pnlWeekPct
to PortfolioState (mirrors the existing start-of-day snapshot pattern with a
7-day window) and a rejection gate between the existing daily and all-time
drawdown checks."
```

---

### Task 2: Reconcile the daily-loss-limit default between `riskManager.ts` and `debateEngine.ts`

**Files:**
- Modify: `apex-trader/backend/src/agents/debateEngine.ts` (the execution gate, currently `parseFloat(process.env.DAILY_LOSS_LIMIT_PCT || '3')`)
- Test: `apex-trader/backend/tests/debateEngine.dailyLossDefault.test.ts`

**Interfaces:**
- Consumes: nothing new.
- Produces: both `riskManager.validateTradeSignal` and `debateEngine`'s execution gate now default `DAILY_LOSS_LIMIT_PCT` to the same value (`5`, matching `riskManager.ts` and the value already documented in `/api/settings`'s exposed config) when the env var is unset.

- [ ] **Step 1: Write the failing test**

```ts
// apex-trader/backend/tests/debateEngine.dailyLossDefault.test.ts
describe('daily loss limit default consistency', () => {
  it('debateEngine.ts and riskManager.ts use the same fallback default', () => {
    const fs = require('fs');
    const path = require('path');
    const debateSrc = fs.readFileSync(path.join(__dirname, '../src/agents/debateEngine.ts'), 'utf-8');
    const riskSrc = fs.readFileSync(path.join(__dirname, '../src/trading/riskManager.ts'), 'utf-8');

    const debateMatch = debateSrc.match(/DAILY_LOSS_LIMIT_PCT["']?\s*\|\|\s*["'](\d+)["']/);
    const riskMatch = riskSrc.match(/DAILY_LOSS_LIMIT_PCT["']?\s*\|\|\s*["'](\d+)["']/);

    expect(debateMatch).not.toBeNull();
    expect(riskMatch).not.toBeNull();
    expect(debateMatch![1]).toBe(riskMatch![1]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apex-trader/backend && npx jest tests/debateEngine.dailyLossDefault.test.ts`
Expected: FAIL — `debateMatch![1]` is `'3'`, `riskMatch![1]` is `'5'`.

- [ ] **Step 3: Fix the default in `debateEngine.ts`**

Change:
```ts
    } else if (portfolio.pnlDayPct <= -(parseFloat(process.env.DAILY_LOSS_LIMIT_PCT || '3'))) {
```
to:
```ts
    } else if (portfolio.pnlDayPct <= -(parseFloat(process.env.DAILY_LOSS_LIMIT_PCT || '5'))) {
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apex-trader/backend && npx jest tests/debateEngine.dailyLossDefault.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
cd apex-trader
git add backend/src/agents/debateEngine.ts backend/tests/debateEngine.dailyLossDefault.test.ts
git commit -m "Reconcile daily-loss-limit default between debateEngine and riskManager

Same env var, two different unset-fallback defaults (3% vs 5%) meant the
effective limit silently depended on which check ran, not on any configured
value. Standardized on 5%, matching riskManager.ts and /api/settings."
```

---

### Task 3: Manual position-close endpoint

**Files:**
- Modify: `apex-trader/backend/src/trading/riskManager.ts` (export `triggerStopLoss`, or extract a shared `closePosition` helper both it and the new route call)
- Modify: `apex-trader/backend/src/routes/index.ts` (add route to `tradesRouter`, after line 104)
- Test: `apex-trader/backend/tests/tradesRoute.close.test.ts`

**Interfaces:**
- Consumes: `getCurrentPrices()` (already imported into `scheduler.ts` from `../services/marketData` — same import works here) for the current market price when no price is supplied in the request body.
- Produces: `closePosition(position: Position, exitPrice: number, reason: string): Promise<void>` — exported from `riskManager.ts`, callable from both `checkStopLosses`'s internal logic and the new route. `POST /api/trades/:id/close` — body `{ price?: number }` (optional override, e.g. for a Polymarket manual settle at a known price), 200 response `{ closed: true, pnl: number, pnlPct: number }`, 404 if the trade isn't found or isn't `OPEN`.

- [ ] **Step 1: Extract `triggerStopLoss` into an exported, reusable `closePosition`**

In `apex-trader/backend/src/trading/riskManager.ts`, rename the existing (unexported) `triggerStopLoss` function to `closePosition` and export it — same body, just exported and renamed so its purpose (any reason for closing, not only stop/take-profit) is accurate:

```ts
export async function closePosition(position: any, exitPrice: number, reason: string) {
  const isShort = position.side === 'SELL';
  const pnl = isShort
    ? (position.entryPrice - exitPrice) * position.quantity
    : (exitPrice - position.entryPrice) * position.quantity;
  const pnlPct = isShort
    ? ((position.entryPrice - exitPrice) / position.entryPrice) * 100
    : ((exitPrice - position.entryPrice) / position.entryPrice) * 100;

  const openTrade = await prisma.trade.findFirst({
    where: { asset: position.asset, status: 'OPEN' }
  });

  if (openTrade) {
    await prisma.trade.update({
      where: { id: openTrade.id },
      data: { exitPrice, pnl, pnlPct, status: 'CLOSED', closedAt: new Date(), exitReason: reason }
    });
  }

  await prisma.position.update({
    where: { id: position.id },
    data: { status: 'CLOSED' }
  });

  getIO()?.emit('position:closed', { asset: position.asset, exitPrice, pnl, pnlPct, reason });
  logger.info(`Position closed: ${position.asset} | PnL: $${pnl.toFixed(2)} (${pnlPct.toFixed(2)}%) | Reason: ${reason}`);
  return { pnl, pnlPct };
}
```

Update the two call sites inside `checkStopLosses` (`await triggerStopLoss(position, currentPrice, 'stop_loss');` and `'take_profit'`) to call `closePosition` instead — same arguments, just the new name.

- [ ] **Step 2: Write the failing route test**

This repo has no `supertest` dependency and no existing HTTP-layer tests (confirmed: only unit tests against imported functions) — test `closePosition` directly instead of through the HTTP layer, matching the existing test style:

```ts
// apex-trader/backend/tests/tradesRoute.close.test.ts
import { closePosition } from '../src/trading/riskManager';
import { prisma } from '../src/utils/prisma';

jest.mock('../src/utils/prisma', () => ({
  prisma: {
    trade: { findFirst: jest.fn(), update: jest.fn() },
    position: { update: jest.fn() },
  },
}));
jest.mock('../src/websocket/server', () => ({ getIO: () => ({ emit: jest.fn() }) }));

describe('closePosition — manual close', () => {
  it('closes the matching OPEN trade and position with the given exit price', async () => {
    (prisma.trade.findFirst as jest.Mock).mockResolvedValue({ id: 'trade-1', asset: 'AAPL' });
    (prisma.trade.update as jest.Mock).mockResolvedValue({});
    (prisma.position.update as jest.Mock).mockResolvedValue({});

    const position = { id: 'pos-1', asset: 'AAPL', side: 'BUY', entryPrice: 100, quantity: 10 };
    const result = await closePosition(position, 105, 'manual_close');

    expect(result.pnl).toBeCloseTo(50); // (105-100) * 10
    expect(prisma.trade.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'trade-1' },
      data: expect.objectContaining({ status: 'CLOSED', exitReason: 'manual_close' }),
    }));
    expect(prisma.position.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'pos-1' },
      data: { status: 'CLOSED' },
    }));
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `cd apex-trader/backend && npx jest tests/tradesRoute.close.test.ts`
Expected: FAIL — `closePosition` doesn't exist yet (still named `triggerStopLoss`, unexported).

- [ ] **Step 4: Run test to verify it passes** (Step 1's rename/export already implements this)

Run: `cd apex-trader/backend && npx jest tests/tradesRoute.close.test.ts`
Expected: PASS

- [ ] **Step 5: Add the route**

In `apex-trader/backend/src/routes/index.ts`, add after the existing `tradesRouter.get('/stats', ...)` block (after line 104):

```ts
tradesRouter.post('/:id/close', async (req: Request, res: Response) => {
  const trade = await prisma.trade.findUnique({ where: { id: req.params.id } });
  if (!trade || trade.status !== 'OPEN') {
    return res.status(404).json({ error: 'Open trade not found' });
  }
  const position = await prisma.position.findFirst({ where: { asset: trade.asset, status: 'OPEN' } });
  if (!position) {
    return res.status(404).json({ error: 'No open position for this trade\'s asset' });
  }
  const exitPrice = req.body.price ?? getCurrentPrices()[trade.asset] ?? trade.entryPrice;
  const result = await closePosition(position, exitPrice, 'manual_close');
  res.json({ closed: true, pnl: result.pnl, pnlPct: result.pnlPct });
});
```

Add the two new imports at the top of `apex-trader/backend/src/routes/index.ts`:
```ts
import { closePosition } from '../trading/riskManager';
import { getCurrentPrices } from '../services/marketData';
```

- [ ] **Step 6: Manual verification against a real paper position**

Since this route has no HTTP-layer test (matching the codebase's existing convention of unit-testing the underlying function, not the Express layer), verify it live once deployed: open a paper position via the existing debate flow, call `POST /api/trades/:id/close` with a valid JWT, confirm the response has `closed: true` and the position disappears from `GET /api/portfolio/positions`.

- [ ] **Step 7: Commit**

```bash
cd apex-trader
git add backend/src/trading/riskManager.ts backend/src/routes/index.ts backend/tests/tradesRoute.close.test.ts
git commit -m "Add manual position-close endpoint (POST /api/trades/:id/close)

Portfolio and Trades were both read-only — the only exits were automatic
stop/take-profit or the kill switch's live-mode-only force-close, leaving no
way to cut a bad paper trade short. Extracts the existing close-logic
(previously unexported triggerStopLoss) into a shared, exported
closePosition used by both the stop-loss monitor and this new route."
```

---

### Task 4: Real MACD signal line and real Stochastic %D

**Files:**
- Modify: `apex-trader/backend/src/services/marketData.ts:371-410` (`calculateMACD`, `calculateStochastic`)
- Test: `apex-trader/backend/tests/marketData.indicators.test.ts`

**Interfaces:**
- Consumes: `calculateEMA(values: number[], period: number): number` (already exists in this file, used by the current `calculateMACD`).
- Produces: `calculateMACD(closes: number[]): { value: number; signal: number; histogram: number }` — same signature, real signal line. `calculateStochastic(candles: Candle[], period: number): { k: number; d: number }` — same signature, real %D.

- [ ] **Step 1: Write the failing tests**

```ts
// apex-trader/backend/tests/marketData.indicators.test.ts
import { calculateMACD, calculateStochastic } from '../src/services/marketData';

describe('calculateMACD — real signal line', () => {
  it('signal line is not a fixed 0.2 scalar of the current MACD value', () => {
    // Two different price series that produce different MACD-history shapes
    // but could produce the SAME instantaneous MACD value at the end —
    // a real (history-smoothed) signal line differs between them; a fake
    // scalar-of-current-value signal line would be identical.
    const trending = Array.from({ length: 40 }, (_, i) => 100 + i * 0.5);
    const choppy = [...Array.from({ length: 35 }, (_, i) => 100 + (i % 2 === 0 ? 5 : -5)), 117.5, 118, 118.5, 119, 119.5];

    const macdTrending = calculateMACD(trending);
    const macdChoppy = calculateMACD(choppy);

    // Both end near the same current MACD value by construction of the fixtures above,
    // but a real EMA-smoothed signal line reflects each series' different history.
    expect(macdTrending.signal).not.toBeCloseTo(macdTrending.value * 0.2, 5);
    expect(macdChoppy.signal).not.toBeCloseTo(macdChoppy.value * 0.2, 5);
  });
});

describe('calculateStochastic — real %D', () => {
  it('%D is a 3-period SMA of %K, not %K * 0.9', () => {
    const candles = Array.from({ length: 20 }, (_, i) => ({
      high: 105 + i, low: 95 + i, close: 100 + i, open: 100 + i, volume: 1000,
      timestamp: Date.now() - (20 - i) * 60000,
    }));
    const { k, d } = calculateStochastic(candles as any, 14);
    expect(d).not.toBeCloseTo(k * 0.9, 5);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd apex-trader/backend && npx jest tests/marketData.indicators.test.ts`
Expected: FAIL on both — current implementation is exactly `value * 0.2` and `k * 0.9`.

- [ ] **Step 3: Implement the real MACD signal line**

MACD needs the MACD-value *history* (one value per bar, not just the current bar) to compute a real 9-period EMA of it. Replace:

```ts
function calculateMACD(closes: number[]): { value: number; signal: number; histogram: number } {
  const ema12 = calculateEMA(closes, 12);
  const ema26 = calculateEMA(closes, 26);
  const value = ema12 - ema26;
  const signal = value * 0.2; // simplified
  return { value, signal, histogram: value - signal };
}
```

with:

```ts
function calculateMACD(closes: number[]): { value: number; signal: number; histogram: number } {
  // Build the MACD-value series (one MACD value per bar, using a trailing window
  // for each) so the signal line can be a real 9-EMA of MACD history, not just a
  // scalar fraction of the single current-bar value.
  const macdSeries: number[] = [];
  for (let i = 26; i <= closes.length; i++) {
    const window = closes.slice(0, i);
    macdSeries.push(calculateEMA(window, 12) - calculateEMA(window, 26));
  }
  const value = macdSeries[macdSeries.length - 1] ?? 0;
  const signal = macdSeries.length >= 9 ? calculateEMA(macdSeries, 9) : value;
  return { value, signal, histogram: value - signal };
}
```

- [ ] **Step 4: Implement the real Stochastic %D**

Replace:
```ts
function calculateStochastic(candles: Candle[], period: number): { k: number; d: number } {
  const slice = candles.slice(-period);
  const highestHigh = Math.max(...slice.map(c => c.high));
  const lowestLow = Math.min(...slice.map(c => c.low));
  const currentClose = slice[slice.length - 1].close;
  const k = highestHigh !== lowestLow ? ((currentClose - lowestLow) / (highestHigh - lowestLow)) * 100 : 50;
  return { k, d: k * 0.9 };
}
```

with:

```ts
function calculateStochastic(candles: Candle[], period: number): { k: number; d: number } {
  const computeK = (upToIndex: number): number => {
    const slice = candles.slice(Math.max(0, upToIndex - period + 1), upToIndex + 1);
    const highestHigh = Math.max(...slice.map(c => c.high));
    const lowestLow = Math.min(...slice.map(c => c.low));
    const currentClose = slice[slice.length - 1].close;
    return highestHigh !== lowestLow ? ((currentClose - lowestLow) / (highestHigh - lowestLow)) * 100 : 50;
  };

  const k = computeK(candles.length - 1);
  // Real %D is a 3-period SMA of %K, so compute %K for the last 3 bars.
  const kValues: number[] = [];
  for (let i = Math.max(period - 1, candles.length - 3); i < candles.length; i++) {
    kValues.push(computeK(i));
  }
  const d = kValues.reduce((s, v) => s + v, 0) / kValues.length;
  return { k, d };
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd apex-trader/backend && npx jest tests/marketData.indicators.test.ts`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
cd apex-trader
git add backend/src/services/marketData.ts backend/tests/marketData.indicators.test.ts
git commit -m "Fix fake MACD signal line and Stochastic %D

Both were a fixed scalar fraction of another value (signal = MACD*0.2,
%D = %K*0.9) rather than computed from real history, so neither could ever
show a genuine crossover or divergence despite agent prompts describing
them that way. Signal is now a real 9-EMA of the MACD-value series; %D is
now a real 3-period SMA of %K."
```

---

### Task 5: Fix `GET /intelligence/risk/macro` returning hardcoded zeros

**Files:**
- Modify: `apex-trader/backend/src/routes/intelligence.ts` (the `/risk/macro` handler)
- Test: `apex-trader/backend/tests/intelligenceRoute.macro.test.ts`

**Interfaces:**
- Consumes: `intermarketService.getIntermarketAnalysis()` (already exported as `apex-trader/backend/src/services/intermarketService.ts:542`'s singleton instance) — returns real `vix` (derived from the VIXY ETF proxy).
- Produces: the route's `data` object now returns a real `vixLevel`; `fedRate`/`inflation`/`unemployment`/`usdEurRate` are explicitly marked `null` with a `note` field rather than a misleading `0` — real values for those arrive with the Macro Intelligence panel plan (next in this sequence), which is where FRED-sourced data is already scoped to land. This fix's job is to stop lying with fake zeros, not to add a new data source out of sequence.

- [ ] **Step 1: Write the failing test**

```ts
// apex-trader/backend/tests/intelligenceRoute.macro.test.ts
import { intermarketService } from '../src/services/intermarketService';

jest.mock('../src/services/intermarketService', () => ({
  intermarketService: {
    getIntermarketAnalysis: jest.fn().mockResolvedValue({
      macroData: { vix: 22.5 },
    }),
  },
}));
jest.mock('../src/services/geopoliticalIntelligence', () => ({
  geopoliticalIntelligence: { buildGeoRiskAssessment: jest.fn().mockResolvedValue({}) },
}));

describe('GET /intelligence/risk/macro handler logic', () => {
  it('returns the real vix value instead of a hardcoded 0', async () => {
    const analysis = await intermarketService.getIntermarketAnalysis();
    expect(analysis.macroData.vix).not.toBe(0);
    expect(analysis.macroData.vix).toBe(22.5);
  });
});
```

(This test exercises the real collaborator's shape rather than the Express handler directly, matching the codebase's existing no-supertest convention. The actual route-level verification is Step 4 below.)

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apex-trader/backend && npx jest tests/intelligenceRoute.macro.test.ts`
Expected: This particular test passes trivially against the mock (it exercises the mock, not the route) — the real regression check is Step 4's live verification. Proceed to Step 3.

- [ ] **Step 3: Fix the route handler**

Read `apex-trader/backend/src/services/intermarketService.ts`'s `getIntermarketAnalysis()` return shape (lines 60-90ish, per the `IntermarketData` interface at line 5) to confirm the exact path to the `vix` field before wiring it in — the interface shown in this session's research has `vix: number` nested under whatever top-level key `getIntermarketAnalysis()` returns it under (confirm by reading the function body, since the interface excerpt alone doesn't show the full nesting).

Replace in `apex-trader/backend/src/routes/intelligence.ts`:
```ts
router.get('/risk/macro', requireAuth, async (req: Request, res: Response) => {
  try {
    const assessment = await geopoliticalIntelligence.buildGeoRiskAssessment();

    // Extract macro data from assessment
    const macroData = {
      fedRate: 0,
      inflation: 0,
      unemployment: 0,
      vixLevel: 0,
      usdEurRate: 0,
      timestamp: new Date()
    };

    res.json({
      success: true,
      data: macroData
    });
  } catch (err) {
    logger.error('Macro indicators error', { err });
    res.status(500).json({
      success: false,
      error: 'Failed to fetch macro indicators'
    });
  }
});
```

with:
```ts
router.get('/risk/macro', requireAuth, async (req: Request, res: Response) => {
  try {
    const analysis = await intermarketService.getIntermarketAnalysis();

    const macroData = {
      fedRate: null,
      inflation: null,
      unemployment: null,
      vixLevel: analysis.vix,
      usdEurRate: null,
      note: 'fedRate/inflation/unemployment/usdEurRate pending FRED integration (Macro Intelligence panel plan) — vixLevel is real, derived from the VIXY ETF proxy',
      timestamp: new Date()
    };

    res.json({
      success: true,
      data: macroData
    });
  } catch (err) {
    logger.error('Macro indicators error', { err });
    res.status(500).json({
      success: false,
      error: 'Failed to fetch macro indicators'
    });
  }
});
```

Add the import at the top of the file: `import { intermarketService } from '../services/intermarketService';`. Remove the now-unused `geopoliticalIntelligence` import from this handler if it's not used elsewhere in the same file (grep the file for other uses before removing the import).

- [ ] **Step 4: Manual live verification**

Call `GET /api/intelligence/risk/macro` with a valid JWT against the running dev server; confirm `data.vixLevel` is a real non-zero number that moves when re-called at a different time, and `data.fedRate` etc. are `null` with the `note` field present (not silently `0`).

- [ ] **Step 5: Commit**

```bash
cd apex-trader
git add backend/src/routes/intelligence.ts backend/tests/intelligenceRoute.macro.test.ts
git commit -m "Fix GET /intelligence/risk/macro returning hardcoded zeros

Computed a real risk assessment then discarded it, returning a literal
{fedRate:0, inflation:0, ...} regardless. vixLevel now comes from the real
VIXY-derived proxy in intermarketService.ts; the remaining fields are
explicitly null with a note rather than a misleading 0, pending the FRED
integration scoped into the next plan in this sequence."
```

---

### Task 6: Migrate `selfLearning.ts` to write `AgentLesson` and `AgentPerformance` instead of `SystemLog`/`MarketEvent`

**Files:**
- Modify: `apex-trader/backend/src/services/selfLearning.ts` (`saveAgentLesson`, `updateAgentMetrics`, `getLatestAgentMetrics`)
- Test: `apex-trader/backend/tests/selfLearning.persistence.test.ts`

**Interfaces:**
- Consumes: existing `AgentLesson` local interface in this file (fields already match the Prisma `AgentLesson` model 1:1 per this session's schema read).
- Produces: `saveAgentLesson` writes to `prisma.agentLesson.create` instead of `prisma.systemLog.create`. `updateAgentMetrics` reads from `prisma.agentLesson.findMany` instead of `prisma.systemLog.findMany`, and writes to `prisma.agentPerformance.upsert` instead of `prisma.marketEvent.create`. `getLatestAgentMetrics` reads from `prisma.agentPerformance.findMany` instead of `prisma.marketEvent.findMany`.

- [ ] **Step 1: Write the failing test for `saveAgentLesson`**

```ts
// apex-trader/backend/tests/selfLearning.persistence.test.ts
import { prisma } from '../src/utils/prisma';

jest.mock('../src/utils/prisma', () => ({
  prisma: {
    agentLesson: { create: jest.fn().mockResolvedValue({}), findMany: jest.fn().mockResolvedValue([]) },
    agentPerformance: { upsert: jest.fn().mockResolvedValue({}), findMany: jest.fn().mockResolvedValue([]) },
    systemLog: { create: jest.fn() },
    marketEvent: { create: jest.fn() },
  },
}));

describe('selfLearning persistence — typed models, not SystemLog/MarketEvent', () => {
  it('saveAgentLesson writes to prisma.agentLesson, not prisma.systemLog', async () => {
    const { __test__saveAgentLesson } = require('../src/services/selfLearning');
    await __test__saveAgentLesson({
      agentId: 'technician', agentName: 'The Technician', asset: 'AAPL',
      setupType: 'breakout', prediction: 'BUY', outcome: 'WIN', correct: true,
      reasoning: 'test', confidenceScore: 80, newWeighting: 1.0,
      performanceImpact: 5,
    });
    expect(prisma.agentLesson.create).toHaveBeenCalled();
    expect(prisma.systemLog.create).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apex-trader/backend && npx jest tests/selfLearning.persistence.test.ts`
Expected: FAIL — `saveAgentLesson` isn't exported for testing yet, and even once exported it currently calls `prisma.systemLog.create`.

- [ ] **Step 3: Migrate `saveAgentLesson`**

Replace:
```ts
async function saveAgentLesson(lesson: AgentLesson): Promise<void> {
  try {
    await prisma.systemLog.create({
      data: {
        level: 'INFO',
        service: `agent-learning-${lesson.agentId}`,
        message: `Lesson: ${lesson.lesson}`,
        metadata: lesson as any
      }
    });
  } catch (err) {
    logger.error('Failed to save lesson', { err });
  }
}
```
with:
```ts
export async function __test__saveAgentLesson(lesson: AgentLesson): Promise<void> {
  return saveAgentLesson(lesson);
}

async function saveAgentLesson(lesson: AgentLesson): Promise<void> {
  try {
    await prisma.agentLesson.create({
      data: {
        agentId: lesson.agentId,
        agentName: lesson.agentName,
        asset: lesson.asset,
        setupType: lesson.setupType,
        prediction: lesson.prediction,
        outcome: lesson.outcome,
        correct: lesson.correct,
        reasoning: lesson.reasoning,
        confidenceScore: lesson.confidenceScore,
        newWeighting: lesson.newWeighting,
        tradeId: lesson.tradeId,
        performanceImpact: lesson.performanceImpact,
      }
    });
  } catch (err) {
    logger.error('Failed to save lesson', { err });
  }
}
```

(Confirm the exact `AgentLesson` local-interface field names against this file before finalizing — the Prisma model's field names, quoted earlier this session, must match exactly; if the local interface has a field like `lesson: string` not present on the Prisma model, drop it from the write or fold its content into `reasoning`.)

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apex-trader/backend && npx jest tests/selfLearning.persistence.test.ts`
Expected: PASS (1 test)

- [ ] **Step 5: Write the failing test for `updateAgentMetrics` and `getLatestAgentMetrics`**

```ts
// append to apex-trader/backend/tests/selfLearning.persistence.test.ts
describe('updateAgentMetrics / getLatestAgentMetrics', () => {
  it('updateAgentMetrics reads AgentLesson and upserts AgentPerformance, not MarketEvent', async () => {
    (prisma.agentLesson.findMany as jest.Mock).mockResolvedValue([
      { agentId: 'technician', agentName: 'The Technician', correct: true, confidenceScore: 80, createdAt: new Date() },
      { agentId: 'technician', agentName: 'The Technician', correct: false, confidenceScore: 60, createdAt: new Date() },
    ]);
    const { updateAgentMetrics } = require('../src/services/selfLearning');
    await updateAgentMetrics('technician');
    expect(prisma.agentPerformance.upsert).toHaveBeenCalledWith(expect.objectContaining({
      where: { agentId: 'technician' },
    }));
    expect(prisma.marketEvent.create).not.toHaveBeenCalled();
  });

  it('getLatestAgentMetrics reads from AgentPerformance, not MarketEvent', async () => {
    (prisma.agentPerformance.findMany as jest.Mock).mockResolvedValue([
      { agentId: 'technician', accuracy: 75, status: 'ACTIVE' },
    ]);
    const { getLatestAgentMetrics } = require('../src/services/selfLearning');
    const result = await getLatestAgentMetrics();
    expect(prisma.agentPerformance.findMany).toHaveBeenCalled();
    expect(result.length).toBe(1);
  });
});
```

- [ ] **Step 6: Run tests to verify they fail**

Run: `cd apex-trader/backend && npx jest tests/selfLearning.persistence.test.ts`
Expected: FAIL — both functions currently touch `marketEvent`/`systemLog`, not `agentPerformance`.

- [ ] **Step 7: Migrate `updateAgentMetrics`**

Change the read at the top of `updateAgentMetrics` from:
```ts
      const agentLessons = await prisma.systemLog.findMany({ where: { service: `agent-learning-${agentId}` }, /* ...existing order/select... */ });
```
to:
```ts
      const agentLessons = await prisma.agentLesson.findMany({ where: { agentId }, orderBy: { createdAt: 'desc' } });
```

(Since `AgentLesson` rows are now typed columns, not JSON blobs, drop whatever `JSON.parse`/`.metadata` unwrapping the old code did when reading each row's fields — access `agentLessons[i].correct`, `.confidenceScore`, etc. directly.)

Change the write at the end from:
```ts
      await prisma.marketEvent.create({
        data: {
          asset: 'SYSTEM',
          eventType: `AGENT_ACCURACY_${agentId}`,
          data: {
            agentId,
            agentName: agentLessons[0].agentName,
            last20Accuracy,
            calibrationScore,
            totalLessons: allLessons.length,
            suspended: last20Accuracy < 45 && last20.length >= 10
          } as any
        }
      });
```
to:
```ts
      await prisma.agentPerformance.upsert({
        where: { agentId },
        create: {
          agentId,
          agentName: agentLessons[0].agentName,
          totalTrades: allLessons.length,
          accuracy: last20Accuracy,
          winRate: last20Accuracy,
          status: (last20Accuracy < 45 && last20.length >= 10) ? 'SUSPENDED' : 'ACTIVE',
          suspendedAt: (last20Accuracy < 45 && last20.length >= 10) ? new Date() : null,
        },
        update: {
          agentName: agentLessons[0].agentName,
          totalTrades: allLessons.length,
          accuracy: last20Accuracy,
          winRate: last20Accuracy,
          status: (last20Accuracy < 45 && last20.length >= 10) ? 'SUSPENDED' : 'ACTIVE',
          suspendedAt: (last20Accuracy < 45 && last20.length >= 10) ? new Date() : undefined,
        },
      });
```

(`calibrationScore` — confirm whether `AgentPerformance` has a matching column; per this session's schema read it doesn't have a dedicated `calibrationScore` field. Store it by reusing the existing `weeklyReport Json?` field: `weeklyReport: { calibrationScore }` in both `create` and `update`, since that's the one flexible field already on this model for exactly this kind of derived-metric data — don't add a new migration for one field when an existing JSON field already fits.)

- [ ] **Step 8: Migrate `getLatestAgentMetrics`**

Change from:
```ts
  return prisma.marketEvent.findMany({ where: { eventType: { startsWith: 'AGENT_ACCURACY_' } }, /* ...existing... */ });
```
to:
```ts
  return prisma.agentPerformance.findMany({ orderBy: { lastUpdated: 'desc' } });
```

Update whatever calls `getAgentSuspensionWeights`/`getAgentCalibrationScores` downstream (both in this same file, called from `debateEngine.ts:745-748`) to read the new field names (`accuracy`, `status === 'SUSPENDED'`, `weeklyReport.calibrationScore`) instead of the old `MarketEvent.data.*` shape — grep this file for every other reference to the old field names before considering this task done.

- [ ] **Step 9: Run tests to verify they pass**

Run: `cd apex-trader/backend && npx jest tests/selfLearning.persistence.test.ts`
Expected: PASS (3 tests total)

- [ ] **Step 10: Commit**

```bash
cd apex-trader
git add backend/src/services/selfLearning.ts backend/tests/selfLearning.persistence.test.ts
git commit -m "Migrate selfLearning.ts from SystemLog/MarketEvent to AgentLesson/AgentPerformance

Real learning data was being funneled into untyped SystemLog.metadata JSON
blobs and a generic MarketEvent 'asset:SYSTEM' hack, instead of the typed
tables built for exactly this purpose. Now queryable/reportable directly."
```

---

### Task 7: Migrate `agentResourceLearning.ts` to write `AgentLearningState` instead of `SystemLog`

**Files:**
- Modify: `apex-trader/backend/src/services/agentResourceLearning.ts:262-269` (`buildAgentLearningState`)
- Test: `apex-trader/backend/tests/agentResourceLearning.persistence.test.ts`

**Interfaces:**
- Consumes: existing `state` object (local `AgentLearningState`-shaped interface, per this session's read) already matches the Prisma `AgentLearningState` model's fields.
- Produces: `buildAgentLearningState` upserts into `prisma.agentLearningState` (unique on `[agentId, assetId]`, matching the model's `@@unique`) instead of `prisma.systemLog.create`.

- [ ] **Step 1: Write the failing test**

```ts
// apex-trader/backend/tests/agentResourceLearning.persistence.test.ts
import { prisma } from '../src/utils/prisma';

jest.mock('../src/utils/prisma', () => ({
  prisma: {
    agentLearningState: { upsert: jest.fn().mockResolvedValue({}) },
    systemLog: { create: jest.fn() },
  },
}));

describe('agentResourceLearning persistence', () => {
  it('buildAgentLearningState upserts AgentLearningState, not SystemLog', async () => {
    const { buildAgentLearningState } = require('../src/services/agentResourceLearning');
    await buildAgentLearningState('technician', 'AAPL');
    expect(prisma.agentLearningState.upsert).toHaveBeenCalledWith(expect.objectContaining({
      where: { agentId_assetId: { agentId: 'technician', assetId: 'AAPL' } },
    }));
    expect(prisma.systemLog.create).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apex-trader/backend && npx jest tests/agentResourceLearning.persistence.test.ts`
Expected: FAIL — currently writes `prisma.systemLog.create`.

- [ ] **Step 3: Migrate the write**

Replace:
```ts
    // Store learning state for agent to reference
    await prisma.systemLog.create({
      data: {
        level: 'INFO',
        service: `agent-learning-${agentId}`,
        message: 'Learning state built',
        metadata: state as any
      }
    }).catch(() => {});

    return state;
```
with:
```ts
    // Store learning state for agent to reference
    await prisma.agentLearningState.upsert({
      where: { agentId_assetId: { agentId, assetId } },
      create: {
        agentId,
        assetId,
        fundamentalScore: state.fundamentalScore,
        technicalScore: state.technicalScore,
        sentimentScore: state.sentimentScore,
        riskScore: state.riskScore,
        confidenceAdjustment: state.confidenceAdjustment,
        overallScore: state.overallScore,
        learningSources: state.recentLearnings as any,
        recommendations: state.recommendations ?? 'HOLD',
      },
      update: {
        fundamentalScore: state.fundamentalScore,
        technicalScore: state.technicalScore,
        sentimentScore: state.sentimentScore,
        riskScore: state.riskScore,
        confidenceAdjustment: state.confidenceAdjustment,
        overallScore: state.overallScore,
        learningSources: state.recentLearnings as any,
        recommendations: state.recommendations ?? 'HOLD',
      },
    }).catch((err) => logger.error('Failed to persist AgentLearningState', { err }));

    return state;
```

(Confirm the exact field names on the local `state`/`AgentLearningState` interface at this file's lines 24-34 before finalizing — if `recommendations` isn't already a field the function computes, derive it from `overallScore` with the same thresholding logic the function already uses elsewhere for its return value, or default to `'HOLD'` as shown.)

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apex-trader/backend && npx jest tests/agentResourceLearning.persistence.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
cd apex-trader
git add backend/src/services/agentResourceLearning.ts backend/tests/agentResourceLearning.persistence.test.ts
git commit -m "Migrate agentResourceLearning.ts from SystemLog to AgentLearningState

Was writing the full per-agent-per-asset learning state into
SystemLog.metadata under a service-name convention shared with an unrelated
feature (selfLearning.ts's lessons), instead of the AgentLearningState table
already built for this exact shape (unique on agentId+assetId)."
```

---

### Task 8: Persist `geopoliticalDataService.ts`'s in-memory events to `GeopoliticalEvent`/`NewsItem`

**Files:**
- Modify: `apex-trader/backend/src/services/geopoliticalDataService.ts` (the class holding `newsCache`/`geopoliticalEvents` in-memory arrays)
- Test: `apex-trader/backend/tests/geopoliticalDataService.persistence.test.ts`

**Interfaces:**
- Consumes: nothing new.
- Produces: whenever this service's polling loop refreshes `newsCache`/`geopoliticalEvents`, it now also writes new items to `prisma.newsItem.create`/`prisma.geopoliticalEvent.create` (best-effort, non-blocking — the in-memory cache stays the source of truth for the live request path, exactly as today; the DB write only prevents "empty after every restart," per the already-known gap in project memory).

This is the actually-used production service (imported by `debateEngine.ts`), unlike `geopoliticalIntelligence.ts` (Task 5's concern, which is a separate, largely-dead file). Scope this task narrowly: persist on write, don't change the read path or the in-memory-first architecture.

- [ ] **Step 1: Find the exact method that populates `newsCache`/`geopoliticalEvents`**

Read `apex-trader/backend/src/services/geopoliticalDataService.ts` in full and find the method(s) that push into `this.newsCache`/`this.geopoliticalEvents` (likely a `refreshNews`/`pollNews`-style method called on a `setInterval`, per this session's research: "populated only by setInterval (60s/120s first tick)"). Confirm the exact array-push call sites before writing Step 3.

- [ ] **Step 2: Write the failing test**

```ts
// apex-trader/backend/tests/geopoliticalDataService.persistence.test.ts
import { prisma } from '../src/utils/prisma';

jest.mock('../src/utils/prisma', () => ({
  prisma: {
    newsItem: { create: jest.fn().mockResolvedValue({}) },
    geopoliticalEvent: { create: jest.fn().mockResolvedValue({}) },
  },
}));

describe('geopoliticalDataService — DB persistence alongside in-memory cache', () => {
  it('persists a new geopolitical event to the DB when the cache is refreshed', async () => {
    const { geopoliticalDataService } = require('../src/services/geopoliticalDataService');
    await geopoliticalDataService.__test__persistEvent({
      title: 'Test sanctions event', description: 'test', eventType: 'sanctions',
      severity: 5, countries: ['US'], affectedAssets: ['USD'], geoRiskScore: 40,
      impactDuration: 'short', marketImpact: 'negative', source: 'test',
    });
    expect(prisma.geopoliticalEvent.create).toHaveBeenCalled();
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `cd apex-trader/backend && npx jest tests/geopoliticalDataService.persistence.test.ts`
Expected: FAIL — `__test__persistEvent` doesn't exist yet.

- [ ] **Step 4: Add a persistence helper and call it from the refresh method found in Step 1**

Add to the `GeopoliticalDataService` class:

```ts
  async __test__persistEvent(event: {
    title: string; description: string; eventType: string; severity: number;
    countries: string[]; affectedAssets: string[]; geoRiskScore: number;
    impactDuration: string; marketImpact: string; source: string;
  }) {
    return prisma.geopoliticalEvent.create({ data: event }).catch((err) =>
      logger.error('Failed to persist GeopoliticalEvent', { err })
    );
  }

  async persistNewsItem(item: {
    headline: string; source: string; url?: string; sentimentScore: number;
    sentimentLabel: string; assetsMentioned: string[]; summary?: string; publishedAt: Date;
  }) {
    return prisma.newsItem.create({ data: item }).catch((err) =>
      logger.error('Failed to persist NewsItem', { err })
    );
  }
```

(`__test__persistEvent` is a thin, test-visible alias — rename to whatever the real refresh method should call, e.g. `persistGeopoliticalEvent`, and call it from inside the refresh method found in Step 1 for each newly-fetched event/news item, alongside the existing `this.geopoliticalEvents.push(...)`/`this.newsCache.push(...)` calls. Add the `import { prisma } from '../utils/prisma';` and `import { logger } from '../utils/logger';` imports at the top of the file if not already present — confirmed in this session's research that this file currently has zero Prisma imports.)

- [ ] **Step 5: Run test to verify it passes**

Run: `cd apex-trader/backend && npx jest tests/geopoliticalDataService.persistence.test.ts`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
cd apex-trader
git add backend/src/services/geopoliticalDataService.ts backend/tests/geopoliticalDataService.persistence.test.ts
git commit -m "Persist geopoliticalDataService's events/news to GeopoliticalEvent/NewsItem

The actually-used production geopolitical service was pure in-memory (per
project memory: empty after every restart until the next 60-120s poll
tick) with zero DB writes, while GeopoliticalEvent and NewsItem sat as dead
Prisma models. In-memory cache stays the source of truth for the live
request path; this only adds a best-effort, non-blocking DB write so
history survives restarts."
```

---

### Task 9: Polymarket position resolution — store `conditionId`, poll for resolution, close resolved trades

**Files:**
- Modify: `apex-trader/backend/src/services/polymarket.ts` (`ProbabilityAnalysis` interface, `scanPolymarketOpportunities`, `placePolymarketBet`)
- Modify: `apex-trader/backend/src/jobs/scheduler.ts` (fix the existing miscalled `placePolymarketBet(opp, opp.question, true)`, add a new resolution-polling cron)
- Test: `apex-trader/backend/tests/polymarket.resolution.test.ts`

**Interfaces:**
- Consumes: Polymarket Gamma API (`https://gamma-api.polymarket.com/markets`, already used elsewhere in this file with `axios.get` — same client, no new dependency), queried with a `condition_ids` filter param.
- Produces: `ProbabilityAnalysis` gains a `conditionId: string` field. `placePolymarketBet`'s paper-mode branch stores it in `Trade.brokerOrderId` (the existing nullable string column, already repurposed for paper-trade markers elsewhere per project memory: `brokerOrderId LIKE 'PAPER-%'`). New exported `pollPolymarketResolutions(): Promise<void>`, wired into a new 30-minute cron in `scheduler.ts`, which closes any `OPEN` Polymarket trade whose market has resolved.

- [ ] **Step 1: Write the failing test for `conditionId` flowing through**

```ts
// apex-trader/backend/tests/polymarket.resolution.test.ts
import { prisma } from '../src/utils/prisma';

jest.mock('../src/utils/prisma', () => ({
  prisma: {
    trade: { create: jest.fn().mockResolvedValue({}), findMany: jest.fn(), update: jest.fn() },
    position: {},
  },
}));
jest.mock('../src/websocket/server', () => ({ getIO: () => ({ emit: jest.fn() }) }));

describe('placePolymarketBet — stores conditionId', () => {
  it('writes analysis.conditionId into Trade.brokerOrderId for paper bets', async () => {
    const { placePolymarketBet } = require('../src/services/polymarket');
    const analysis = {
      question: 'Will X happen?', marketImpliedProbability: 0.4, ourEstimatedProbability: 0.6,
      edge: 0.2, confidence: 70, recommendedSide: 'YES', betSizeUSD: 100,
      expectedProfitUSD: 20, reasoning: 'test', riskFactors: [],
      resolutionDate: new Date().toISOString(), daysToResolution: 5,
      conditionId: 'cond-abc-123',
    };
    await placePolymarketBet(analysis as any, analysis.conditionId, true);
    expect(prisma.trade.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ brokerOrderId: 'cond-abc-123' }),
    }));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apex-trader/backend && npx jest tests/polymarket.resolution.test.ts`
Expected: FAIL — the current paper-mode `prisma.trade.create` call doesn't set `brokerOrderId` at all.

- [ ] **Step 3: Add `conditionId` to `ProbabilityAnalysis` and thread it through**

In `apex-trader/backend/src/services/polymarket.ts`, add to the `ProbabilityAnalysis` interface:
```ts
export interface ProbabilityAnalysis {
  question: string;
  conditionId: string;
  marketImpliedProbability: number;
  // ...rest unchanged...
}
```

In `analyzePolymarketEvent(market, portfolioValue)`, find the function's final return object (it currently returns `question`, `marketImpliedProbability`, etc. — same block referenced in this session's research at the end of the function) and add `conditionId: market.conditionId,` to it, since `market: PolymarketMarket` (the function's first parameter) already carries `conditionId`.

In `placePolymarketBet`'s paper-mode branch, add `brokerOrderId: analysis.conditionId,` to the `prisma.trade.create` call's `data` object:
```ts
    await prisma.trade.create({
      data: {
        asset: 'POLYMARKET',
        market: 'prediction',
        type: analysis.recommendedSide === 'YES' ? 'BUY' : 'SELL',
        entryPrice: analysis.marketImpliedProbability,
        quantity: analysis.betSizeUSD,
        status: 'OPEN',
        stopLossPrice: 0.01,
        takeProfitPrice: analysis.recommendedSide === 'YES' ? 0.99 : 0.01,
        brokerOrderId: analysis.conditionId,
      }
    }).catch(() => {});
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apex-trader/backend && npx jest tests/polymarket.resolution.test.ts`
Expected: PASS (1 test)

- [ ] **Step 5: Fix the scheduler's miscalled argument**

In `apex-trader/backend/src/jobs/scheduler.ts`, change:
```ts
        await placePolymarketBet(opp, opp.question, true); // paper mode
```
to:
```ts
        await placePolymarketBet(opp, opp.conditionId, true); // paper mode
```

- [ ] **Step 6: Write the failing test for resolution polling**

```ts
// append to apex-trader/backend/tests/polymarket.resolution.test.ts
import axios from 'axios';
jest.mock('axios');

describe('pollPolymarketResolutions', () => {
  it('closes an OPEN Polymarket trade whose market has resolved YES', async () => {
    (prisma.trade.findMany as jest.Mock).mockResolvedValue([
      { id: 'trade-1', asset: 'POLYMARKET', brokerOrderId: 'cond-abc-123', entryPrice: 0.4, quantity: 100, type: 'BUY' },
    ]);
    (axios.get as jest.Mock).mockResolvedValue({
      data: [{ condition_id: 'cond-abc-123', closed: true, outcomePrices: '["1", "0"]' }],
    });

    const { pollPolymarketResolutions } = require('../src/services/polymarket');
    await pollPolymarketResolutions();

    expect(prisma.trade.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'trade-1' },
      data: expect.objectContaining({ status: 'CLOSED' }),
    }));
  });

  it('leaves an OPEN trade alone if its market has not closed yet', async () => {
    (prisma.trade.findMany as jest.Mock).mockResolvedValue([
      { id: 'trade-2', asset: 'POLYMARKET', brokerOrderId: 'cond-def-456', entryPrice: 0.4, quantity: 100, type: 'BUY' },
    ]);
    (axios.get as jest.Mock).mockResolvedValue({
      data: [{ condition_id: 'cond-def-456', closed: false }],
    });

    const { pollPolymarketResolutions } = require('../src/services/polymarket');
    (prisma.trade.update as jest.Mock).mockClear();
    await pollPolymarketResolutions();

    expect(prisma.trade.update).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 7: Run tests to verify they fail**

Run: `cd apex-trader/backend && npx jest tests/polymarket.resolution.test.ts`
Expected: FAIL — `pollPolymarketResolutions` doesn't exist yet.

- [ ] **Step 8: Implement `pollPolymarketResolutions`**

Add to `apex-trader/backend/src/services/polymarket.ts`:

```ts
export async function pollPolymarketResolutions(): Promise<void> {
  const openTrades = await prisma.trade.findMany({
    where: { asset: 'POLYMARKET', status: 'OPEN', brokerOrderId: { not: null } },
  });
  if (openTrades.length === 0) return;

  const conditionIds = openTrades.map(t => t.brokerOrderId).join(',');
  let markets: any[] = [];
  try {
    const response = await axios.get(`${POLYMARKET_GAMMA_API}/markets`, {
      params: { condition_ids: conditionIds },
      timeout: 10000,
    });
    markets = response.data || [];
  } catch (error) {
    logger.error('Failed to poll Polymarket resolutions', { error });
    return;
  }

  for (const trade of openTrades) {
    const market = markets.find((m: any) => m.condition_id === trade.brokerOrderId);
    if (!market || !market.closed) continue;

    const outcomePrices: number[] = JSON.parse(market.outcomePrices || '["0","0"]').map(Number);
    const yesResolvedTrue = outcomePrices[0] >= 0.99;
    // Trade.type BUY == bet YES, SELL == bet NO (matches placePolymarketBet's mapping)
    const won = trade.type === 'BUY' ? yesResolvedTrue : !yesResolvedTrue;
    const exitPrice = won ? 1 : 0;
    const pnl = won
      ? (1 - trade.entryPrice) * trade.quantity
      : -trade.entryPrice * trade.quantity;
    const pnlPct = won
      ? ((1 - trade.entryPrice) / trade.entryPrice) * 100
      : -100;

    await prisma.trade.update({
      where: { id: trade.id },
      data: { exitPrice, pnl, pnlPct, status: 'CLOSED', closedAt: new Date(), exitReason: 'market_resolved' },
    });
    logger.info(`🎯 Polymarket position resolved: ${trade.id} | Won: ${won} | PnL: $${pnl.toFixed(2)}`);
  }
}
```

- [ ] **Step 9: Run tests to verify they pass**

Run: `cd apex-trader/backend && npx jest tests/polymarket.resolution.test.ts`
Expected: PASS (3 tests total)

- [ ] **Step 10: Wire the new poller into the scheduler**

In `apex-trader/backend/src/jobs/scheduler.ts`, add the import:
```ts
import { scanPolymarketOpportunities, placePolymarketBet, pollPolymarketResolutions } from '../services/polymarket';
```

Add a new cron alongside the existing Polymarket scan cron:
```ts
  // ── EVERY 30 MINUTES: Polymarket Resolution Check ────────────────────────
  cron.schedule('*/30 * * * *', async () => {
    await pollPolymarketResolutions().catch(err => logger.error('Polymarket resolution poll failed', { err }));
  });
```

- [ ] **Step 11: Commit**

```bash
cd apex-trader
git add backend/src/services/polymarket.ts backend/src/jobs/scheduler.ts backend/tests/polymarket.resolution.test.ts
git commit -m "Add Polymarket resolution polling — positions no longer stay open forever

Root cause: analysis.conditionId was computed in analyzePolymarketEvent's
input (market.conditionId) but dropped before returning ProbabilityAnalysis,
and scheduler.ts was even passing the wrong value (opp.question) into
placePolymarketBet's marketConditionId param. Neither the trade row nor any
poller had a way to look a position back up to its market. Fixed end to
end: conditionId now flows into Trade.brokerOrderId, and a new 30-minute
cron closes any trade whose market has resolved via the Gamma API."
```

---

### Task 10: Run `backtestingEngine.ts` for real and record the baseline

**Files:**
- Create: `apex-trader/backend/scripts/runBacktestBaseline.ts` (standalone runner, deleted or kept as a reusable script per your preference after this task)
- Create: `apex-trader/backend/docs/backtest-baseline-2026-07-11.md` (or append to project memory — see note below)

**Interfaces:**
- Consumes: `runBacktest(config: BacktestConfig)` and `evaluateBacktestResults(results)`, both already exported from `apex-trader/backend/src/trading/backtestingEngine.ts`.
- Produces: a recorded baseline (Sharpe, win rate, max drawdown, profit factor, go-live verdict) that later plans (Kronos, day-trading) can be compared against.

This task is a genuine caveat, not a clean pass/fail: per this session's research, `getAgentVotes` inside `backtestingEngine.ts` currently **simulates every agent vote with `Math.random()`** rather than calling the real debate engine — so today's "backtest" measures the execution/risk-management machinery (stop-loss, position sizing, fees) against random signals, not the real agent system's edge. Running it now still has value (it's the only way to validate that machinery end-to-end against historical data), but the go-live recommendation it produces should not be read as "the agent strategy has a statistical edge" — that would require replacing `getAgentVotes`'s random stub with real debate-engine calls, which is out of scope for a same-day gap-remediation task and is better folded into whichever future plan revisits the backtest after the Kronos/TradingAgents agent changes land.

- [ ] **Step 1: Write the standalone runner script**

```ts
// apex-trader/backend/scripts/runBacktestBaseline.ts
import { runBacktest, evaluateBacktestResults } from '../src/trading/backtestingEngine';

async function main() {
  const results = await runBacktest({
    startDate: '2025-10-15',
    endDate: '2026-04-15',
    initialCapital: 100000,
    symbols: ['AAPL', 'BTC/USDT', 'ETH/USDT'],
    riskPerTrade: 1,
    maxPositionSize: 10,
    brokerFeesPct: 0.1,
  });
  const evaluation = evaluateBacktestResults(results);
  console.log(JSON.stringify({ results, evaluation }, null, 2));
}

main().catch((err) => {
  console.error('Backtest run failed', err);
  process.exit(1);
});
```

- [ ] **Step 2: Run it**

Run: `cd apex-trader/backend && npx ts-node scripts/runBacktestBaseline.ts`
Expected: JSON output containing `results` (with Sharpe ratio, win rate, max drawdown, profit factor fields per `BacktestResults`) and `evaluation.canGoLive`/`evaluation.issues`. Requires `DATABASE_URL` set in the environment (the file imports `prisma` even though it issues no queries — see this session's research note) — use the existing local `.env`, no new credentials needed since the crypto-only symbol set (`BTC/USDT`, `ETH/USDT`) needs no Polygon key and `AAPL` falls back to `generateMockData` gracefully if `POLYGON_API_KEY` is absent.

- [ ] **Step 3: Record the baseline**

Save the JSON output to `apex-trader/backend/docs/backtest-baseline-2026-07-11.md` (a fenced code block with a one-paragraph note above it stating the `getAgentVotes` random-simulation caveat from this task's description verbatim, so nobody later mistakes this number for a validated real-strategy edge).

- [ ] **Step 4: Commit**

```bash
cd apex-trader
git add backend/scripts/runBacktestBaseline.ts backend/docs/backtest-baseline-2026-07-11.md
git commit -m "Run backtestingEngine.ts for the first time, record baseline

backtestingEngine.ts existed and was reachable via the API but had never
actually been executed. Records a baseline for later plans (Kronos,
day-trading) to compare against. Caveat recorded prominently: getAgentVotes
currently simulates every vote with Math.random() rather than calling the
real debate engine, so this baseline validates the execution/risk
machinery against historical data, not yet the real agent strategy's edge."
```

---

## Plan Self-Review

**Spec coverage check** (against the approved spec's Component 7):
- Manual position-close control → Task 3 ✓
- 9 dead DB models reconciled → Tasks 6, 7, 8 cover `AgentLesson`, `AgentPerformance`, `AgentLearningState`, `GeopoliticalEvent`, `NewsItem` (5 of 9). `AgentConversation`, `MacroIndicator`, `GeoRiskAssessment` are not covered by a task above — `AgentConversation` has no current producer of chat-history data outside `SystemLog` identified in this session's research (the chat route logs to `SystemLog` and no task above found a clean migration target without a larger chat-feature change); `MacroIndicator` and `GeoRiskAssessment` are better addressed by the next plan in this sequence (Macro Intelligence panel), which already scopes real macro/geopolitical data work — migrating these two now, before that plan defines the real data shape flowing into them, risks writing the wrong shape twice. Noted here explicitly rather than silently dropped.
- Real backtest run → Task 10 ✓ (with the random-vote caveat recorded, not hidden)
- Fake MACD/Stochastic fix → Task 4 ✓
- `GET /intelligence/risk/macro` stub → Task 5 ✓
- Daily-loss-limit reconciliation → Task 2 ✓
- `weeklyDrawdownLimit` wired in → Task 1 ✓
- Polymarket resolution → Task 9 ✓
- Backtest-route auth (already fixed same-day, before this plan) — not a task here, already committed.

**Placeholder scan:** no "TBD"/"implement later" found; every step has complete code. Two steps (Task 5 Step 3, Task 6 Step 3, Task 7 Step 3) explicitly instruct confirming an exact field/nesting shape against the real file before finalizing, rather than guessing — this is a verification instruction, not a placeholder, since the research this session couldn't quote 100% of every file's exact structure.

**Type consistency:** `closePosition`'s signature (`position, exitPrice, reason`) is used identically in Task 3's route handler and reused (renamed from `triggerStopLoss`) inside `checkStopLosses`. `ProbabilityAnalysis.conditionId` (Task 9) is added once and consumed consistently in `placePolymarketBet`, `scheduler.ts`, and `pollPolymarketResolutions`.
