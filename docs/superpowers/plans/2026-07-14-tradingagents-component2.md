# TradingAgents Logic Port (Component 2) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Port the concretely-valuable pieces of tauricresearch/tradingagents (Apache-2.0, cloned locally at `C:\Users\mrtha\Desktop\platform-repos\tradingagents`) into our own debate engine: an anti-hallucination grounding technique for the Technician agent, regime-matched past-debate lessons, and crash-recovery checkpointing with automatic resume — plus two small bugs found while researching this component.

**Architecture:** All changes land in `apex-trader/backend/src/agents/debateEngine.ts` (the existing 14-agent, 3-round debate engine) and `apex-trader/backend/src/services/stockMemoryService.ts` (existing per-symbol memory). A new `DebateCheckpoint` Prisma model persists round1/round2 outputs as they complete; `AgentDecision` gains a `regime` column. No new services, no new npm packages, no LangGraph-equivalent framework — the source repo's orchestration is Python/LangGraph-specific plumbing with no TS analogue and is not being ported.

**Tech Stack:** TypeScript, Express, Prisma (PostgreSQL), Jest + ts-jest (existing convention: mock narrow collaborators, assert on return values/call args, no test DB, no supertest).

## Global Constraints

- Prisma import path: `import { prisma } from '../utils/prisma';`
- Test files go in `apex-trader/backend/tests/`, matching existing style (see `tests/executionEngine.test.ts`, `tests/debateEngine.kronosAgent.test.ts`): mock the narrow external collaborator (prisma, not the whole module tree), assert on real function return values and mock call arguments.
- `runInvestmentCommitteeDebate` is NOT independently unit-tested today (only `AGENT_ROSTER` and `buildMarketContext` are, via `tests/debateEngine.kronosAgent.test.ts`) — it makes 14+ live Anthropic calls per round and mocking all of them for a full-flow test would be disproportionate. New logic in this plan is extracted into small, standalone, testable helper functions instead; the helpers get real unit tests, the wiring into the big function gets a manual live-verification step, matching this codebase's own established convention (see gap-remediation plan's Task 3 Step 6).
- Commit after every task, not after every step within a task.
- Regime strings are exactly one of: `TRENDING_BULL`, `TRENDING_BEAR`, `CHOPPY_RANGE`, `HIGH_VOLATILITY`, `COMPRESSION`, `RECOVERY`, `DISTRIBUTION` (confirmed in `src/services/regimeDetector.ts`).
- `numReplicas: 1` on the backend Railway service (confirmed in `backend/railway.json`) — only one instance ever runs, so checkpoint resume only needs to handle single-instance restarts, not concurrent-instance races. The existing in-memory `debateLocks` Set in `scheduler.ts` already prevents two debates on the same asset running concurrently within one instance.

## Explicitly not ported, and why (not silently dropped)

- **Bull/Bear Researcher adversarial dynamic** (`tradingagents/agents/researchers/bull_researcher.py`, `bear_researcher.py`): their structure is a fixed 2-agent (always Bull vs. always Bear), 2-turn debate. Ours is a 14-agent, 3-round debate with a dynamic dominant-view-vs-strongest-dissenter cross-examination (`debateEngine.ts:660-701`) — already structurally more sophisticated. Nothing to adopt here.
- **Research Manager's "commit to a stance, don't default to Hold" instruction**: we already have an equivalent, arguably stronger version — `COMPACT_KNOWLEDGE`'s `DECISIVENESS` clause (`debateEngine.ts:28`), added in an earlier session. Already covered.
- **Sentiment analyst's cross-source (StockTwits/Reddit/News) divergence heuristics** (`tradingagents/agents/analysts/sentiment_analyst.py:138-172`): genuinely sophisticated prompt engineering, but it depends on having 2+ *distinct* real data sources to compare. Our Sentiment Analyst agent currently receives one source (Finnhub news via `buildNewsSummary`, sentiment-tagged POSITIVE/NEGATIVE/NEUTRAL) — no StockTwits/Reddit equivalent exists in this codebase. Porting the divergence-detection prompt language without real second-source data would be prompt theater, not a real capability. Out of scope until a second sentiment data source is built (a separate, larger task, not part of this component).
- **News analyst's FRED macro series / Polymarket-implied-probability grounding** (`tradingagents/agents/analysts/news_analyst.py`, `dataflows/fred.py`, `dataflows/polymarket.py`): real FRED integration is explicitly Component 5's job (Macro Intelligence panel, not yet built — our Macro Economist currently uses ETF-proxy data, not real FRED series). Porting FRED here would duplicate/conflict with Component 5's scope. Our Polymarket integration already exists independently (gap-remediation Task 9) and already feeds its own dedicated debate path, not the News analyst.
- **Fundamentals analyst** (`tradingagents/agents/analysts/fundamentals_analyst.py`): plain tool-wiring, no prompt sophistication beyond what our own `deepAnalysisService.ts`/Fundamental Analyst agent already does. Nothing to port.
- **LangGraph orchestration itself** (`graph/setup.py`, `graph/propagation.py`, `llm_clients/*`): Python/LangGraph-specific plumbing (tool-calling loops, graph node wiring, multi-provider LLM client abstraction). No TypeScript analogue exists in our codebase and building one is out of scope — we already have our own working orchestration (`runAgentsSequentially`, `callWithRetry`).

---

### Task 1: Add `DebateCheckpoint` model and `AgentDecision.regime` column

**Files:**
- Modify: `apex-trader/backend/prisma/schema.prisma`
- Test: none (schema-only; verified by the Prisma generate step and by Task 2/3's tests, which mock these exact fields)

**Interfaces:**
- Consumes: nothing new.
- Produces: `prisma.debateCheckpoint` model with fields `id`, `asset` (unique), `status`, `round1Results` (Json), `round2Exchange` (Json, nullable), `marketRegime`, `createdAt`, `updatedAt`. `AgentDecision` gains `regime String?`.

- [ ] **Step 1: Add the models to schema.prisma**

Find the `model AgentDecision` block in `apex-trader/backend/prisma/schema.prisma` (currently):
```prisma
model AgentDecision {
  id              String   @id @default(cuid())
  asset           String
  signal          String
  finalVote       String
  totalVotes      Int
  goVotes         Int
  noGoVotes       Int
  avgConfidence   Float
  executed        Boolean  @default(false)
  executionReason String?
  agentVotes      Json
  marketSnapshot  Json
  timestamp       DateTime @default(now())
  trades          Trade[]

  @@index([asset])
  @@index([timestamp])
}
```

Replace with (adds `regime` only, everything else unchanged):
```prisma
model AgentDecision {
  id              String   @id @default(cuid())
  asset           String
  signal          String
  finalVote       String
  totalVotes      Int
  goVotes         Int
  noGoVotes       Int
  avgConfidence   Float
  executed        Boolean  @default(false)
  executionReason String?
  agentVotes      Json
  marketSnapshot  Json
  regime          String?
  timestamp       DateTime @default(now())
  trades          Trade[]

  @@index([asset])
  @@index([timestamp])
  @@index([asset, regime])
}
```

Add a new model directly after it in the same file:
```prisma
// Persists round1/round2 debate outputs as they complete, so a crash or
// redeploy mid-debate (e.g. Railway landing a deploy mid-run) can resume
// from the last completed round instead of re-running (and re-billing)
// earlier rounds. One row per asset (a second debate on the same asset
// can't start while one is in flight — see debateLocks in scheduler.ts),
// deleted once the debate finishes successfully.
model DebateCheckpoint {
  id             String   @id @default(cuid())
  asset          String   @unique
  status         String   // 'ROUND1_DONE' | 'ROUND2_DONE'
  round1Results  Json
  round2Exchange Json?
  marketRegime   String
  createdAt      DateTime @default(now())
  updatedAt      DateTime @updatedAt
}
```

- [ ] **Step 2: Regenerate the Prisma client**

Run: `cd apex-trader/backend && npx prisma generate`
Expected: `✔ Generated Prisma Client` with no errors.

- [ ] **Step 3: Typecheck**

Run: `cd apex-trader/backend && npx tsc --noEmit`
Expected: no errors (nothing references the new fields yet, so this just confirms the schema itself is valid).

- [ ] **Step 4: Commit**

```bash
cd apex-trader
git add backend/prisma/schema.prisma
git commit -m "Add DebateCheckpoint model and AgentDecision.regime column

Foundation for crash-recovery checkpointing (persist/resume mid-debate)
and regime-matched past-debate lessons (currently AgentDecision has no
way to filter past debates by the regime they happened in)."
```

---

### Task 2: Checkpoint persistence helpers (write + clear + load)

**Files:**
- Modify: `apex-trader/backend/src/agents/debateEngine.ts` (add to the `// ── HELPERS ──` section, after `buildMarketContext`/`__test__buildMarketContext`, around line 981)
- Test: `apex-trader/backend/tests/debateEngine.checkpoint.test.ts`

**Interfaces:**
- Consumes: `prisma.debateCheckpoint` (Task 1).
- Produces:
  - `saveDebateCheckpoint(asset: string, status: 'ROUND1_DONE' | 'ROUND2_DONE', round1Results: any[], round2Exchange: CrossExam | null, marketRegime: string): Promise<void>` — upserts, never throws (catches and logs).
  - `loadDebateCheckpoint(asset: string): Promise<{ status: string; round1Results: any[]; round2Exchange: CrossExam | null } | null>` — returns `null` if no checkpoint exists OR if the checkpoint is older than 30 minutes (stale; deletes it first). Never throws.
  - `clearDebateCheckpoint(asset: string): Promise<void>` — deletes, never throws.

- [ ] **Step 1: Write the failing tests**

```ts
// apex-trader/backend/tests/debateEngine.checkpoint.test.ts
import { prisma } from '../src/utils/prisma';

jest.mock('../src/utils/prisma', () => ({
  prisma: {
    debateCheckpoint: {
      upsert: jest.fn().mockResolvedValue({}),
      findUnique: jest.fn(),
      delete: jest.fn().mockResolvedValue({}),
      deleteMany: jest.fn().mockResolvedValue({}),
    },
  },
}));

describe('debate checkpoint helpers', () => {
  beforeEach(() => jest.clearAllMocks());

  it('saveDebateCheckpoint upserts by asset with the given status and results', async () => {
    const { saveDebateCheckpoint } = require('../src/agents/debateEngine');
    const round1Results = [{ agentId: 1, vote: 'BUY' }];
    await saveDebateCheckpoint('AAPL', 'ROUND1_DONE', round1Results, null, 'TRENDING_BULL');
    expect(prisma.debateCheckpoint.upsert).toHaveBeenCalledWith(expect.objectContaining({
      where: { asset: 'AAPL' },
      create: expect.objectContaining({ asset: 'AAPL', status: 'ROUND1_DONE', round1Results, round2Exchange: null, marketRegime: 'TRENDING_BULL' }),
      update: expect.objectContaining({ status: 'ROUND1_DONE', round1Results, round2Exchange: null, marketRegime: 'TRENDING_BULL' }),
    }));
  });

  it('saveDebateCheckpoint never throws even if the DB call fails', async () => {
    (prisma.debateCheckpoint.upsert as jest.Mock).mockRejectedValueOnce(new Error('db down'));
    const { saveDebateCheckpoint } = require('../src/agents/debateEngine');
    await expect(saveDebateCheckpoint('AAPL', 'ROUND1_DONE', [], null, 'TRENDING_BULL')).resolves.toBeUndefined();
  });

  it('loadDebateCheckpoint returns null when none exists', async () => {
    (prisma.debateCheckpoint.findUnique as jest.Mock).mockResolvedValue(null);
    const { loadDebateCheckpoint } = require('../src/agents/debateEngine');
    const result = await loadDebateCheckpoint('AAPL');
    expect(result).toBeNull();
  });

  it('loadDebateCheckpoint returns the checkpoint when fresh', async () => {
    (prisma.debateCheckpoint.findUnique as jest.Mock).mockResolvedValue({
      asset: 'AAPL', status: 'ROUND1_DONE', round1Results: [{ agentId: 1 }], round2Exchange: null,
      marketRegime: 'TRENDING_BULL', updatedAt: new Date(),
    });
    const { loadDebateCheckpoint } = require('../src/agents/debateEngine');
    const result = await loadDebateCheckpoint('AAPL');
    expect(result).toEqual(expect.objectContaining({ status: 'ROUND1_DONE', round1Results: [{ agentId: 1 }] }));
  });

  it('loadDebateCheckpoint discards and returns null for a checkpoint older than 30 minutes', async () => {
    const staleDate = new Date(Date.now() - 31 * 60 * 1000);
    (prisma.debateCheckpoint.findUnique as jest.Mock).mockResolvedValue({
      asset: 'AAPL', status: 'ROUND1_DONE', round1Results: [], round2Exchange: null,
      marketRegime: 'TRENDING_BULL', updatedAt: staleDate,
    });
    const { loadDebateCheckpoint } = require('../src/agents/debateEngine');
    const result = await loadDebateCheckpoint('AAPL');
    expect(result).toBeNull();
    expect(prisma.debateCheckpoint.delete).toHaveBeenCalledWith({ where: { asset: 'AAPL' } });
  });

  it('clearDebateCheckpoint deletes by asset', async () => {
    const { clearDebateCheckpoint } = require('../src/agents/debateEngine');
    await clearDebateCheckpoint('AAPL');
    expect(prisma.debateCheckpoint.deleteMany).toHaveBeenCalledWith({ where: { asset: 'AAPL' } });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd apex-trader/backend && npx jest tests/debateEngine.checkpoint.test.ts --forceExit`
Expected: FAIL — none of the three functions exist yet (or aren't exported).

- [ ] **Step 3: Implement the three helpers**

In `apex-trader/backend/src/agents/debateEngine.ts`, add directly after `export const __test__buildMarketContext = buildMarketContext;` (around line 981):

```ts
export async function saveDebateCheckpoint(
  asset: string,
  status: 'ROUND1_DONE' | 'ROUND2_DONE',
  round1Results: any[],
  round2Exchange: CrossExam | null,
  marketRegime: string
): Promise<void> {
  try {
    await prisma.debateCheckpoint.upsert({
      where: { asset },
      create: { asset, status, round1Results, round2Exchange: round2Exchange as any, marketRegime },
      update: { status, round1Results, round2Exchange: round2Exchange as any, marketRegime },
    });
  } catch (err) {
    logger.error('Failed to save debate checkpoint', { asset, err });
  }
}

const CHECKPOINT_STALE_MS = 30 * 60 * 1000;

export async function loadDebateCheckpoint(
  asset: string
): Promise<{ status: string; round1Results: any[]; round2Exchange: CrossExam | null } | null> {
  try {
    const checkpoint = await prisma.debateCheckpoint.findUnique({ where: { asset } });
    if (!checkpoint) return null;
    if (Date.now() - checkpoint.updatedAt.getTime() > CHECKPOINT_STALE_MS) {
      await prisma.debateCheckpoint.delete({ where: { asset } }).catch(() => {});
      return null;
    }
    return {
      status: checkpoint.status,
      round1Results: checkpoint.round1Results as any[],
      round2Exchange: checkpoint.round2Exchange as CrossExam | null,
    };
  } catch (err) {
    logger.warn('Failed to load debate checkpoint', { asset, err });
    return null;
  }
}

export async function clearDebateCheckpoint(asset: string): Promise<void> {
  try {
    await prisma.debateCheckpoint.deleteMany({ where: { asset } });
  } catch (err) {
    logger.warn('Failed to clear debate checkpoint', { asset, err });
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd apex-trader/backend && npx jest tests/debateEngine.checkpoint.test.ts --forceExit`
Expected: PASS (6 tests)

- [ ] **Step 5: Typecheck**

Run: `cd apex-trader/backend && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
cd apex-trader
git add backend/src/agents/debateEngine.ts backend/tests/debateEngine.checkpoint.test.ts
git commit -m "Add debate checkpoint persistence helpers (save/load/clear)

Standalone, independently-tested functions -- not wired into
runInvestmentCommitteeDebate yet (next task). 30-minute staleness cutoff
on load: a checkpoint older than that reflects market conditions too
stale to resume into, so it's discarded rather than resumed."
```

---

### Task 3: Wire checkpointing into the debate flow (write on completion, resume on restart)

**Files:**
- Modify: `apex-trader/backend/src/agents/debateEngine.ts` (`runInvestmentCommitteeDebate`, lines 465-926)
- Test: manual live verification (Step 5) — this task wires already-tested helpers (Task 2) into the 14-agent live-LLM debate flow, which per this plan's Global Constraints is not unit-tested directly.

**Interfaces:**
- Consumes: `saveDebateCheckpoint`, `loadDebateCheckpoint`, `clearDebateCheckpoint` (Task 2).
- Produces: no signature change to `runInvestmentCommitteeDebate` — same inputs/outputs, but now checkpoint-aware internally.

- [ ] **Step 1: Load the checkpoint at the top of the function**

In `apex-trader/backend/src/agents/debateEngine.ts`, find this line (currently around line 472-474):
```ts
  const io = getIO();
  const debateId = `debate_${Date.now()}`;
  const asset = snapshot.asset;
```

Add directly after it:
```ts
  const io = getIO();
  const debateId = `debate_${Date.now()}`;
  const asset = snapshot.asset;
  const checkpoint = await loadDebateCheckpoint(asset);
  if (checkpoint) {
    logger.info(`♻️  Resuming debate for ${asset} from checkpoint (${checkpoint.status})`);
  }
```

- [ ] **Step 2: Make Round 1 skippable when a checkpoint already has it**

Find the current Round 1 block (starts around line 551 with `logger.info('📢 ROUND 1: OPENING ARGUMENTS');`, ends around line 655 with the Devil's Advocate `catch` block). The current code is:

```ts
  logger.info('📢 ROUND 1: OPENING ARGUMENTS');
  io?.emit('debate:round', { round: 1, debateId, asset });

  const newsSummary = await buildNewsSummary(asset);
  const round1Prompt = buildMarketContext(snapshot, portfolio, marketRegime, fundamentalsSummary, stockMemory, newsSummary, macroSummary, optionsSummary, forecastSummary);
  const round1Results: any[] = [];

  // Devil's Advocate (id 10) intentionally excluded here — it gets a separate
  // contextual call below that sees every other agent's round-1 argument, so
  // including it in this generic loop too was a duplicate paid API call that
  // also produced two conflicting round1 entries for the same agent.
  const round1Roster = AGENT_ROSTER.filter(a => a.id !== 10);
  const round1AgentResults = await runAgentsSequentially(round1Roster, async (agent) => {
    /* ...unchanged, ~55 lines... */
  }, 4000); // 4 second gap between agents
  transcript.round1 = round1AgentResults.map(r => ({ agentId: r.agentId, agentName: r.agentName, vote: r.vote, argument: r.openingArgument }));
  round1Results.push(...round1AgentResults);

  const devilAgent = AGENT_ROSTER[9];
  await new Promise(r => setTimeout(r, 4000)); // gap after last agent
  io?.emit('debate:agent-speaking', { agentId: 10, agentName: devilAgent.name, round: 1, debateId });
  try {
    /* ...unchanged devil's advocate call... */
  } catch (err) {
    /* ...unchanged fallback... */
  }
```

Wrap the whole block (everything from `logger.info('📢 ROUND 1...')` through the Devil's Advocate `catch` block's closing `}`) in an `if (!checkpoint) { ... }`, and declare `round1Results` before it so both branches can assign it. The `newsSummary`/`round1Prompt` const declarations move inside the `if` too, since round 3's `debateSummary` doesn't use them directly (it uses `round1Results`, already-formatted strings) — confirm this by checking `buildDebateSummary`'s signature below before finalizing; it takes `round1Results` and `round2Exchange`, not the raw prompt.

```ts
  let round1Results: any[];
  if (checkpoint) {
    round1Results = checkpoint.round1Results;
    transcript.round1 = round1Results.map(r => ({ agentId: r.agentId, agentName: r.agentName, vote: r.vote, argument: r.openingArgument }));
  } else {
    logger.info('📢 ROUND 1: OPENING ARGUMENTS');
    io?.emit('debate:round', { round: 1, debateId, asset });

    const newsSummary = await buildNewsSummary(asset);
    const round1Prompt = buildMarketContext(snapshot, portfolio, marketRegime, fundamentalsSummary, stockMemory, newsSummary, macroSummary, optionsSummary, forecastSummary);
    round1Results = [];

    // Devil's Advocate (id 10) intentionally excluded here — it gets a separate
    // contextual call below that sees every other agent's round-1 argument, so
    // including it in this generic loop too was a duplicate paid API call that
    // also produced two conflicting round1 entries for the same agent.
    const round1Roster = AGENT_ROSTER.filter(a => a.id !== 10);
    const round1AgentResults = await runAgentsSequentially(round1Roster, async (agent) => {
      /* ...unchanged, ~55 lines, keep exactly as-is... */
    }, 4000); // 4 second gap between agents
    transcript.round1 = round1AgentResults.map(r => ({ agentId: r.agentId, agentName: r.agentName, vote: r.vote, argument: r.openingArgument }));
    round1Results.push(...round1AgentResults);

    const devilAgent = AGENT_ROSTER[9];
    await new Promise(r => setTimeout(r, 4000)); // gap after last agent
    io?.emit('debate:agent-speaking', { agentId: 10, agentName: devilAgent.name, round: 1, debateId });
    try {
      /* ...unchanged devil's advocate call, keep exactly as-is... */
    } catch (err) {
      /* ...unchanged fallback, keep exactly as-is... */
    }

    await saveDebateCheckpoint(asset, 'ROUND1_DONE', round1Results, null, marketRegime);
  }
```

Do not retype the ~55-line agent loop body or the devil's-advocate try/catch body — cut-paste them unchanged into their new position inside the `else` branch. Only the wrapping `if/else`, the `let` vs `const` change for `round1Results`, and the final `saveDebateCheckpoint` call are new.

- [ ] **Step 3: Make Round 2 skippable when a checkpoint already has it**

Find the current Round 2 block (starts around line 657 with `logger.info('\n⚔️  ROUND 2: CROSS-EXAMINATION');`, ends around line 701). Current code:

```ts
  logger.info('\n⚔️  ROUND 2: CROSS-EXAMINATION');
  io?.emit('debate:round', { round: 2, debateId, asset });

  const dominantView = getDominantView(round1Results);

  let round2Exchange: CrossExam | null = null;
  const dissenters = round1Results.filter(r => r.vote !== dominantView.direction && r.agentId !== dominantView.leadAgent?.agentId);
  const challenger = dissenters.sort((a, b) => b.confidence - a.confidence)[0];

  if (challenger && dominantView.leadAgent) {
    try {
      /* ...unchanged challenge/rebuttal calls... */
    } catch (err) {
      logger.error('Round 2 cross-examination failed', { err: (err as Error)?.message || err });
    }
  }
```

Replace with:
```ts
  let round2Exchange: CrossExam | null;
  if (checkpoint && checkpoint.status === 'ROUND2_DONE') {
    round2Exchange = checkpoint.round2Exchange;
    if (round2Exchange) transcript.round2.push(round2Exchange);
  } else {
    logger.info('\n⚔️  ROUND 2: CROSS-EXAMINATION');
    io?.emit('debate:round', { round: 2, debateId, asset });

    const dominantView = getDominantView(round1Results);

    round2Exchange = null;
    const dissenters = round1Results.filter(r => r.vote !== dominantView.direction && r.agentId !== dominantView.leadAgent?.agentId);
    const challenger = dissenters.sort((a, b) => b.confidence - a.confidence)[0];

    if (challenger && dominantView.leadAgent) {
      try {
        /* ...unchanged challenge/rebuttal calls, keep exactly as-is, assigning into round2Exchange exactly as before... */
      } catch (err) {
        logger.error('Round 2 cross-examination failed', { err: (err as Error)?.message || err });
      }
    }

    await saveDebateCheckpoint(asset, 'ROUND2_DONE', round1Results, round2Exchange, marketRegime);
  }
```

Note `dominantView`, `dissenters`, and `challenger` move inside the `else` since they're only needed to compute a fresh `round2Exchange` — nothing after this block references them directly (Round 3 uses `round1Results` and `round2Exchange`, confirm via `buildDebateSummary`'s call signature at the line starting `const debateSummary = buildDebateSummary(round1Results, round2Exchange);` directly below this block, unchanged).

- [ ] **Step 4: Clear the checkpoint after the debate completes successfully**

Find the final DB write (this is also modified by Task 4 — apply both tasks' changes to the same block; if Task 4 is done first, keep its changes and only add the checkpoint-clear line here):

```ts
  try {
    await prisma.agentDecision.create({
      data: {
        asset,
        signal: transcript.finalDecision,
        finalVote: transcript.finalDecision,
        totalVotes: 10,
        goVotes: Math.max(buyCount, sellCount),
        noGoVotes: holdCount,
        avgConfidence: transcript.finalConfidence,
        executed: false,
        executionReason: blockReason,
        agentVotes: transcript.agentArguments as any,
        marketSnapshot: { asset, price: snapshot.price } as any,
      }
    });
  } catch (dbErr) {
    logger.error('Failed to save debate', { dbErr });
  }

  return transcript;
```

Add `await clearDebateCheckpoint(asset);` immediately after the `try/catch` block, before `return transcript;`:
```ts
  try {
    await prisma.agentDecision.create({
      /* ...unchanged (or as modified by Task 4)... */
    });
  } catch (dbErr) {
    logger.error('Failed to save debate', { dbErr });
  }

  await clearDebateCheckpoint(asset);

  return transcript;
```

- [ ] **Step 5: Manual live verification**

Deploy this change. Since simulating a real mid-debate crash is impractical to script, verify the write side live (resume is covered by the fact that the read path is the exact same `loadDebateCheckpoint` unit-tested in Task 2 — trust the unit test for correctness of the read, verify live that writes actually happen at the right times):

1. Trigger a real debate via `POST /api/agents/run-and-trade` (see project history for the JWT-minting approach used to call this without a browser session).
2. While it's running, query `DebateCheckpoint` for that asset (via a throwaway script using `DATABASE_PUBLIC_URL`, deleted immediately after — per this project's established pattern for verifying against the real DB) partway through Round 1: confirm no row yet (Round 1 not done). Partway through Round 2: confirm a row exists with `status: 'ROUND1_DONE'` and `round1Results` populated. After the debate completes: confirm the row is gone (cleared).
3. Confirm the debate's logged final decision and the created `AgentDecision` row look correct (unaffected by this change — this task doesn't change what gets decided, only what gets checkpointed along the way).

- [ ] **Step 6: Commit**

```bash
cd apex-trader
git add backend/src/agents/debateEngine.ts
git commit -m "Wire crash-recovery checkpointing into the debate flow

Round 1 and Round 2 are now skippable if a fresh (<30min) checkpoint
already has their results -- a crash or redeploy mid-debate resumes from
the last completed round instead of re-running (and re-billing) earlier
LLM calls. Final trade parameters (stop-loss, take-profit, position size)
still always use the caller's current snapshot/portfolio regardless of
resume, since trading off a stale pre-crash price would be actively
worse, not safer -- only the qualitative agent arguments (already
flattened to strings in round1Results/round2Exchange) are replayed."
```

---

### Task 4: Fix hardcoded `totalVotes: 10` and truncated `marketSnapshot`, add `regime`

**Files:**
- Modify: `apex-trader/backend/src/agents/debateEngine.ts` (the final `prisma.agentDecision.create` call, same block Task 3 Step 4 touches)
- Test: `apex-trader/backend/tests/debateEngine.decisionWrite.test.ts`

**Interfaces:**
- Consumes: nothing new.
- Produces: the `AgentDecision` row now records the real number of voting agents (not a stale hardcoded 10 — the roster has grown to 14 since that number was written), the real market snapshot (not just `{asset, price}`), and the regime the debate happened in.

- [ ] **Step 1: Write the failing test**

This write call sits inside `runInvestmentCommitteeDebate`, which per this plan's Global Constraints isn't fully unit-tested. Test the computed values directly by extracting the write's `data` object construction into a small, testable pure function.

```ts
// apex-trader/backend/tests/debateEngine.decisionWrite.test.ts
describe('buildAgentDecisionData', () => {
  it('uses the real number of voting agents, not a hardcoded 10', () => {
    const { __test__buildAgentDecisionData } = require('../src/agents/debateEngine');
    const finalVotes = Array.from({ length: 14 }, (_, i) => ({ agentId: i + 1, finalVote: 'BUY', confidence: 70 }));
    const data = __test__buildAgentDecisionData({
      asset: 'AAPL', finalDecision: 'BUY', finalConfidence: 72, blockReason: null,
      agentArguments: finalVotes, snapshot: { asset: 'AAPL', price: 150, priceChangePct24h: 1.2, indicators: { rsi14: 55 } },
      marketRegime: 'TRENDING_BULL', buyCount: 10, sellCount: 2, holdCount: 2,
    });
    expect(data.totalVotes).toBe(14);
  });

  it('includes the real market snapshot, not just {asset, price}', () => {
    const { __test__buildAgentDecisionData } = require('../src/agents/debateEngine');
    const data = __test__buildAgentDecisionData({
      asset: 'AAPL', finalDecision: 'BUY', finalConfidence: 72, blockReason: null,
      agentArguments: [], snapshot: { asset: 'AAPL', price: 150, priceChangePct24h: 1.2, indicators: { rsi14: 55 } },
      marketRegime: 'TRENDING_BULL', buyCount: 0, sellCount: 0, holdCount: 0,
    });
    expect(data.marketSnapshot).toEqual(expect.objectContaining({ asset: 'AAPL', price: 150, priceChangePct24h: 1.2, indicators: { rsi14: 55 } }));
  });

  it('records the regime the debate happened in', () => {
    const { __test__buildAgentDecisionData } = require('../src/agents/debateEngine');
    const data = __test__buildAgentDecisionData({
      asset: 'AAPL', finalDecision: 'BUY', finalConfidence: 72, blockReason: null,
      agentArguments: [], snapshot: { asset: 'AAPL', price: 150, priceChangePct24h: 1.2, indicators: { rsi14: 55 } },
      marketRegime: 'TRENDING_BULL', buyCount: 0, sellCount: 0, holdCount: 0,
    });
    expect(data.regime).toBe('TRENDING_BULL');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apex-trader/backend && npx jest tests/debateEngine.decisionWrite.test.ts --forceExit`
Expected: FAIL — `__test__buildAgentDecisionData` is not exported yet.

- [ ] **Step 3: Extract and fix the data-building logic**

In `apex-trader/backend/src/agents/debateEngine.ts`, replace the final write block:

```ts
  try {
    await prisma.agentDecision.create({
      data: {
        asset,
        signal: transcript.finalDecision,
        finalVote: transcript.finalDecision,
        totalVotes: 10,
        goVotes: Math.max(buyCount, sellCount),
        noGoVotes: holdCount,
        avgConfidence: transcript.finalConfidence,
        executed: false,
        executionReason: blockReason,
        agentVotes: transcript.agentArguments as any,
        marketSnapshot: { asset, price: snapshot.price } as any,
      }
    });
  } catch (dbErr) {
    logger.error('Failed to save debate', { dbErr });
  }
```

with:
```ts
  try {
    await prisma.agentDecision.create({
      data: __test__buildAgentDecisionData({
        asset, finalDecision: transcript.finalDecision, finalConfidence: transcript.finalConfidence,
        blockReason, agentArguments: transcript.agentArguments, snapshot, marketRegime,
        buyCount, sellCount, holdCount,
      }) as any,
    });
  } catch (dbErr) {
    logger.error('Failed to save debate', { dbErr });
  }
```

Add the extracted function to the `// ── HELPERS ──` section (after the checkpoint helpers added in Task 2):
```ts
export function __test__buildAgentDecisionData(args: {
  asset: string;
  finalDecision: string;
  finalConfidence: number;
  blockReason?: string | null;
  agentArguments: any[];
  snapshot: any;
  marketRegime: string;
  buyCount: number;
  sellCount: number;
  holdCount: number;
}) {
  const { asset, finalDecision, finalConfidence, blockReason, agentArguments, snapshot, marketRegime, buyCount, sellCount, holdCount } = args;
  return {
    asset,
    signal: finalDecision,
    finalVote: finalDecision,
    totalVotes: agentArguments.length,
    goVotes: Math.max(buyCount, sellCount),
    noGoVotes: holdCount,
    avgConfidence: finalConfidence,
    executed: false,
    executionReason: blockReason,
    agentVotes: agentArguments,
    marketSnapshot: snapshot,
    regime: marketRegime,
  };
}
```

(`totalVotes: agentArguments.length` — `transcript.agentArguments` is `round3Results`, i.e. every agent's final vote, so its length is the real voting-agent count regardless of roster size changes in the future, unlike the old hardcoded `10`.)

(`marketSnapshot: snapshot` — stores the full `MarketSnapshot` object, replacing the old `{asset, price}` truncation. This is a `Json` column so the full object serializes fine; if `snapshot.candles` makes this row large, that's an acceptable tradeoff for having real historical data available for future analysis — confirm there's no explicit size constraint on this column before finalizing by checking `schema.prisma`'s `marketSnapshot` field, which per Task 1's untouched definition is a plain `Json` with no length limit.)

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apex-trader/backend && npx jest tests/debateEngine.decisionWrite.test.ts --forceExit`
Expected: PASS (3 tests)

- [ ] **Step 5: Run the full backend suite and typecheck**

Run: `cd apex-trader/backend && npx tsc --noEmit && npx jest --forceExit`
Expected: tsc clean; all suites pass (no regressions — this only changes what's written to `AgentDecision`, not the debate logic itself).

- [ ] **Step 6: Commit**

```bash
cd apex-trader
git add backend/src/agents/debateEngine.ts backend/tests/debateEngine.decisionWrite.test.ts
git commit -m "Fix hardcoded totalVotes:10 and truncated marketSnapshot in AgentDecision writes

totalVotes was a stale hardcoded 10 from before the roster grew to 14
agents (Quant Forecaster). marketSnapshot discarded everything except
asset+price, throwing away the indicators/candles that were already
computed and available. Also records the regime the debate happened in,
needed by the next task (regime-matched past-debate lessons)."
```

---

### Task 5: Port anti-hallucination grounding into the Technician agent

**Files:**
- Modify: `apex-trader/backend/src/agents/debateEngine.ts` (Technician's `systemPrompt`, lines 163-182)
- Test: `apex-trader/backend/tests/debateEngine.technicianGrounding.test.ts`

**Interfaces:**
- Consumes: nothing new.
- Produces: no signature change — this is a prompt-text-only change.

**Source material** (from `tradingagents/agents/analysts/market_analyst.py`, confirmed via research this session): the Market Analyst agent is explicitly instructed to treat a verified data snapshot as source of truth and never claim historical validation, exact percentage moves, or support/resistance bounces unless directly backed by tool output with concrete dates/prices — an explicit anti-hallucination guardrail. We don't have a `get_verified_market_snapshot` tool-call step to port literally (our agents receive one pre-built context string, not a tool-calling loop), but the underlying discipline — don't claim unsupported historical/precise claims — is directly portable as prompt language.

- [ ] **Step 1: Write the failing test**

```ts
// apex-trader/backend/tests/debateEngine.technicianGrounding.test.ts
describe('Technician agent — anti-hallucination grounding', () => {
  it('systemPrompt instructs against unsupported historical/precise claims', () => {
    const { AGENT_ROSTER } = require('../src/agents/debateEngine');
    const technician = AGENT_ROSTER.find((a: any) => a.id === 1);
    expect(technician.systemPrompt).toMatch(/do not claim|never claim/i);
    expect(technician.systemPrompt).toMatch(/unless.*(directly supported|backed by|confirmed by)/i);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apex-trader/backend && npx jest tests/debateEngine.technicianGrounding.test.ts --forceExit`
Expected: FAIL — the current Technician prompt has no such language.

- [ ] **Step 3: Add the grounding paragraph**

In `apex-trader/backend/src/agents/debateEngine.ts`, find the end of the Technician's `systemPrompt` (currently):
```ts
DECISION FRAMEWORK: Only vote BUY when 3+ indicators align AND volume confirms. HOLD when signals are mixed or conflicting. SELL when bearish pattern + volume + trend confirmation align.

When responding, always reference SPECIFIC indicator levels and EXACT price levels. Never be vague.`
  },
```

Replace with (adds one paragraph before the closing backtick, nothing else changes):
```ts
DECISION FRAMEWORK: Only vote BUY when 3+ indicators align AND volume confirms. HOLD when signals are mixed or conflicting. SELL when bearish pattern + volume + trend confirmation align.

GROUNDING: Treat the indicator values and price levels given to you in this prompt as the source of truth — do not claim historical validation, support/resistance bounces, or exact percentage moves unless directly supported by the numbers actually provided to you. If you don't have a specific data point, say so rather than inventing a plausible-sounding one.

When responding, always reference SPECIFIC indicator levels and EXACT price levels. Never be vague.`
  },
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apex-trader/backend && npx jest tests/debateEngine.technicianGrounding.test.ts --forceExit`
Expected: PASS

- [ ] **Step 5: Run the full backend suite and typecheck**

Run: `cd apex-trader/backend && npx tsc --noEmit && npx jest --forceExit`
Expected: tsc clean; all suites pass.

- [ ] **Step 6: Commit**

```bash
cd apex-trader
git add backend/src/agents/debateEngine.ts backend/tests/debateEngine.technicianGrounding.test.ts
git commit -m "Port anti-hallucination grounding into the Technician agent

tauricresearch/tradingagents' Market Analyst explicitly instructs the LLM
to treat a verified data snapshot as source of truth and never claim
historical validation or exact moves unless directly tool-backed. We
don't have an equivalent verify-then-cite tool-calling step (our agents
get one pre-built context string), but the underlying discipline is
directly portable as prompt language."
```

---

### Task 6: Regime-matched past-debate lessons

**Files:**
- Modify: `apex-trader/backend/src/services/stockMemoryService.ts` (add a new function)
- Modify: `apex-trader/backend/src/agents/debateEngine.ts` (wire into `buildMarketContext`'s call site and the function itself)
- Test: `apex-trader/backend/tests/stockMemoryService.regimeLessons.test.ts`, `apex-trader/backend/tests/debateEngine.regimeLessons.test.ts`

**Interfaces:**
- Consumes: `prisma.agentDecision` (now has `regime`, per Task 4).
- Produces: `getRegimeMatchedLessons(asset: string, regime: string): Promise<string>` in `stockMemoryService.ts` — returns a short note about past debates on this asset in this same regime, or an empty string if there are none. `buildMarketContext` gains a 10th parameter `regimeLessons = ''`, rendered as a new context section when non-empty.

- [ ] **Step 1: Write the failing test for `getRegimeMatchedLessons`**

```ts
// apex-trader/backend/tests/stockMemoryService.regimeLessons.test.ts
import { prisma } from '../src/utils/prisma';

jest.mock('../src/utils/prisma', () => ({
  prisma: {
    agentDecision: { findMany: jest.fn() },
  },
}));

describe('getRegimeMatchedLessons', () => {
  it('returns an empty string when no past debates match this asset+regime', async () => {
    (prisma.agentDecision.findMany as jest.Mock).mockResolvedValue([]);
    const { getRegimeMatchedLessons } = require('../src/services/stockMemoryService');
    const result = await getRegimeMatchedLessons('AAPL', 'TRENDING_BULL');
    expect(result).toBe('');
  });

  it('queries only same-asset, same-regime, completed debates, most recent first', async () => {
    (prisma.agentDecision.findMany as jest.Mock).mockResolvedValue([]);
    const { getRegimeMatchedLessons } = require('../src/services/stockMemoryService');
    await getRegimeMatchedLessons('AAPL', 'TRENDING_BULL');
    expect(prisma.agentDecision.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ asset: 'AAPL', regime: 'TRENDING_BULL' }),
      orderBy: { timestamp: 'desc' },
      take: 3,
    }));
  });

  it('formats a short note citing the past decision, confidence, and whether it executed', async () => {
    (prisma.agentDecision.findMany as jest.Mock).mockResolvedValue([
      { finalVote: 'BUY', avgConfidence: 72, executed: true, timestamp: new Date('2026-07-01') },
      { finalVote: 'SELL', avgConfidence: 65, executed: false, timestamp: new Date('2026-06-20') },
    ]);
    const { getRegimeMatchedLessons } = require('../src/services/stockMemoryService');
    const result = await getRegimeMatchedLessons('AAPL', 'TRENDING_BULL');
    expect(result).toContain('TRENDING_BULL');
    expect(result).toContain('BUY');
    expect(result).toContain('72');
    expect(result).toContain('SELL');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apex-trader/backend && npx jest tests/stockMemoryService.regimeLessons.test.ts --forceExit`
Expected: FAIL — `getRegimeMatchedLessons` doesn't exist yet.

- [ ] **Step 3: Implement `getRegimeMatchedLessons`**

Add to `apex-trader/backend/src/services/stockMemoryService.ts` (after `recordDebate`):

```ts
// ── REGIME-MATCHED PAST-DEBATE LESSONS ────────────────────────────────────────
// getStockMemorySummary above is a flat, symbol-only rolling aggregate (ignores
// what market regime each past trade happened in). This is narrower and more
// specific: "the last few times we debated this exact symbol in this exact
// regime, here's what the committee decided" -- ported from tradingagents'
// memory-injection pattern (see project history), scoped to symbol+regime per
// this component's design spec rather than a global rolling summary.
export async function getRegimeMatchedLessons(symbol: string, regime: string): Promise<string> {
  try {
    const pastDecisions = await prisma.agentDecision.findMany({
      where: { asset: symbol, regime },
      orderBy: { timestamp: 'desc' },
      take: 3,
    });
    if (pastDecisions.length === 0) return '';

    const lines = pastDecisions.map(d => {
      const date = d.timestamp.toISOString().split('T')[0];
      return `${date}: ${d.finalVote} (${d.avgConfidence.toFixed(0)}% confidence)${d.executed ? ', executed' : ', not executed'}`;
    });
    return `Past debates on ${symbol} in ${regime} regime:\n${lines.join('\n')}`;
  } catch (err) {
    logger.warn(`Regime-matched lessons lookup failed for ${symbol}`, { err });
    return '';
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apex-trader/backend && npx jest tests/stockMemoryService.regimeLessons.test.ts --forceExit`
Expected: PASS (3 tests)

- [ ] **Step 5: Write the failing test for `buildMarketContext`'s new section**

```ts
// apex-trader/backend/tests/debateEngine.regimeLessons.test.ts
describe('buildMarketContext — regime-matched lessons section', () => {
  it('includes a REGIME HISTORY section when regimeLessons is provided', () => {
    const { __test__buildMarketContext } = require('../src/agents/debateEngine');
    const snapshot = {
      asset: 'AAPL', price: 150, priceChangePct24h: 1.2, volume24h: 1000000,
      indicators: {
        rsi14: 55, macd: { histogram: 0.1 }, stochasticK: 60, stochasticD: 58,
        bollingerBands: { upper: 155, middle: 150, lower: 145 },
        ema9: 151, ema21: 149, ema200: 140, sma50: 148, sma200: 142,
        vwap: 150, atr14: 2, week52High: 160, week52Low: 120, distanceFrom52wHigh: 6,
        fibonacci: { r236: 152, r382: 150, r500: 148, r618: 146 },
        isAboveSma200: true, isSma50AboveSma200: true, volumeRatio: 1.1, obv: 1,
      },
    };
    const portfolio = { totalValue: 100000, cashBalance: 40000, pnlDayPct: 0 };
    const context = __test__buildMarketContext(
      snapshot, portfolio, 'TRENDING_BULL', '', '', '', '', '', '',
      'Past debates on AAPL in TRENDING_BULL regime:\n2026-07-01: BUY (72% confidence), executed'
    );
    expect(context).toContain('REGIME HISTORY');
    expect(context).toContain('2026-07-01: BUY');
  });

  it('omits the section entirely when regimeLessons is empty', () => {
    const { __test__buildMarketContext } = require('../src/agents/debateEngine');
    const snapshot = {
      asset: 'AAPL', price: 150, priceChangePct24h: 1.2, volume24h: 1000000,
      indicators: {
        rsi14: 55, macd: { histogram: 0.1 }, stochasticK: 60, stochasticD: 58,
        bollingerBands: { upper: 155, middle: 150, lower: 145 },
        ema9: 151, ema21: 149, ema200: 140, sma50: 148, sma200: 142,
        vwap: 150, atr14: 2, week52High: 160, week52Low: 120, distanceFrom52wHigh: 6,
        fibonacci: { r236: 152, r382: 150, r500: 148, r618: 146 },
        isAboveSma200: true, isSma50AboveSma200: true, volumeRatio: 1.1, obv: 1,
      },
    };
    const portfolio = { totalValue: 100000, cashBalance: 40000, pnlDayPct: 0 };
    const context = __test__buildMarketContext(snapshot, portfolio, 'TRENDING_BULL', '', '', '', '', '', '', '');
    expect(context).not.toContain('REGIME HISTORY');
  });
});
```

- [ ] **Step 6: Run tests to verify they fail**

Run: `cd apex-trader/backend && npx jest tests/debateEngine.regimeLessons.test.ts --forceExit`
Expected: FAIL — `buildMarketContext` doesn't accept a 10th parameter yet, and has no REGIME HISTORY section.

- [ ] **Step 7: Add the parameter and section to `buildMarketContext`**

In `apex-trader/backend/src/agents/debateEngine.ts`, change the signature (currently):
```ts
export function buildMarketContext(
  snapshot: MarketSnapshot,
  portfolio: PortfolioState,
  regime: string,
  fundamentals = '',
  stockMemory = '',
  newsSummary = '',
  macroSummary = '',
  optionsSummary = '',
  forecastSummary = ''
): string {
```
to:
```ts
export function buildMarketContext(
  snapshot: MarketSnapshot,
  portfolio: PortfolioState,
  regime: string,
  fundamentals = '',
  stockMemory = '',
  newsSummary = '',
  macroSummary = '',
  optionsSummary = '',
  forecastSummary = '',
  regimeLessons = ''
): string {
```

Add the new section immediately after the existing `forecastSummary` block:
```ts
  if (forecastSummary) {
    lines.push(`── QUANT FORECAST (Kronos ML model) ──`, forecastSummary);
  }
  if (regimeLessons) {
    lines.push(`── REGIME HISTORY (same symbol, same market regime) ──`, regimeLessons);
  }
  return lines.join('\n');
```

- [ ] **Step 8: Run tests to verify they pass**

Run: `cd apex-trader/backend && npx jest tests/debateEngine.regimeLessons.test.ts --forceExit`
Expected: PASS (2 tests)

- [ ] **Step 9: Wire the live fetch into `runInvestmentCommitteeDebate`**

Add the import at the top of `apex-trader/backend/src/agents/debateEngine.ts`:
```ts
import { getStockMemorySummary, recordDebate, getRegimeMatchedLessons } from '../services/stockMemoryService';
```
(Confirm the exact existing import line for `getStockMemorySummary`/`recordDebate` before editing — add `getRegimeMatchedLessons` to that same line rather than creating a duplicate import statement.)

In the `Promise.all` block (Task 3 already touches this area — apply both tasks' changes if working through them in order), add a 6th parallel fetch:
```ts
  const [deepAnalysis, stockMemory, intermarket, optionsFlow, kronosForecast, regimeLessons] = await Promise.all([
    snapshot.market === 'stocks' ? fetchDeepAnalysis(asset).catch(() => null) : Promise.resolve(null),
    getStockMemorySummary(asset),
    intermarketService.getIntermarketAnalysis().catch(() => null),
    snapshot.market === 'stocks' ? optionsFlowService.analyzeOptionsFlow(asset, snapshot.price).catch(() => null) : Promise.resolve(null),
    getForecast(asset, snapshot.candles, 5).catch(() => null),
    getRegimeMatchedLessons(asset, marketRegime).catch(() => ''),
  ]);
```

Update the `buildMarketContext` call site (inside the Round 1 `else` branch, per Task 3's restructuring — if Task 3 hasn't been applied yet, this is still the same single call site at the original location) to pass it:
```ts
    const round1Prompt = buildMarketContext(snapshot, portfolio, marketRegime, fundamentalsSummary, stockMemory, newsSummary, macroSummary, optionsSummary, forecastSummary, regimeLessons);
```

- [ ] **Step 10: Run the full backend suite and typecheck**

Run: `cd apex-trader/backend && npx tsc --noEmit && npx jest --forceExit`
Expected: tsc clean; all suites pass.

- [ ] **Step 11: Manual live verification**

Trigger two real debates on the same symbol close enough together to land in the same regime (or wait for a natural recurrence). Confirm the second debate's logged prompt (temporarily log `round1Prompt` once, per this project's established prompt-verification convention) contains a `── REGIME HISTORY ──` section citing the first debate's outcome.

- [ ] **Step 12: Commit**

```bash
cd apex-trader
git add backend/src/services/stockMemoryService.ts backend/src/agents/debateEngine.ts backend/tests/stockMemoryService.regimeLessons.test.ts backend/tests/debateEngine.regimeLessons.test.ts
git commit -m "Add regime-matched past-debate lessons

getStockMemorySummary is a flat, symbol-only rolling aggregate that
ignores what regime each past trade happened in. getRegimeMatchedLessons
is narrower: the last 3 debates on this exact symbol in this exact
regime, injected as their own context section -- ported from
tradingagents' memory-injection pattern (single lesson-injection point,
not threaded through every agent), scoped to symbol+regime per this
component's design spec rather than a global rolling summary."
```

---

## Plan Self-Review

**Spec coverage check** (against Component 2's design spec bullets):
- Compare analyst prompts, port genuinely stronger techniques → Task 5 ✓ (Technician grounding). Sentiment cross-source heuristics explicitly declined (no underlying data — see "Explicitly not ported" section, not silently dropped).
- Bull/Bear Researcher dynamic, adopt any debate dynamic we're missing → explicitly found nothing to adopt (see "Explicitly not ported" section) — our structure is already more sophisticated.
- Crash-recovery checkpointing → Tasks 1-3 ✓ (schema, write helpers, wiring + resume).
- Regime+symbol-matched lessons → Tasks 4, 6 ✓ (regime column + query + prompt injection).

**Placeholder scan:** no "TBD"/"implement later" found. Task 3's Steps 2-3 use `/* ...unchanged... */` markers for large existing code blocks that are being wrapped, not modified — these are explicit "cut-paste this exact existing code, don't retype it" instructions with the surrounding new code fully written out, not placeholders for missing logic (per the plan's own conventions, this mirrors how "Similar to Task N" is disallowed but "here is the existing code, unchanged" during a wrap-in-if/else refactor is a different, legitimate case — the exact code to preserve is already fully visible earlier in the same file this plan is modifying).

**Type consistency:** `saveDebateCheckpoint`/`loadDebateCheckpoint`/`clearDebateCheckpoint` (Task 2) signatures match their usage in Task 3 exactly. `__test__buildAgentDecisionData` (Task 4) is consumed only within Task 3/4's own file. `getRegimeMatchedLessons` (Task 6) return type (`Promise<string>`) matches `buildMarketContext`'s new `regimeLessons` parameter type (`string`). `CrossExam` type (used in checkpoint's `round2Exchange` field) is the existing type already used elsewhere in `debateEngine.ts` for the same purpose — not redefined.
