# Contributing to Bhishma

Thanks for your interest in contributing. Bhishma is an autonomous trading
platform, so contributions carry real financial risk — the bar is deliberately high.

## Ground rules

1. **Paper trade first.** Any strategy, signal, or execution change must be
   paper-traded for at least 2 weeks with logged results before it can become
   a default.
2. **Never weaken a guardrail.** Changes that loosen risk limits, the kill
   switch, or the Risk Manager's veto need an explicit, written rationale and
   owner approval.
3. **Typecheck clean.** `npx tsc --noEmit` must pass in `backend/` and
   `npm run build` must pass in `frontend/`. CI enforces both.
4. **Tests for behavior changes.** Add or update tests under `backend/tests/`
   or `e2e/` for anything that changes trading behavior.

## Workflow

```bash
# 1. Fork and branch
git checkout -b feature/your-change

# 2. Backend checks
cd backend
npx tsc --noEmit
npx jest --runInBand --runTestsByPath tests/<your-test>.test.ts

# 3. Frontend checks
cd ../frontend
npm run build

# 4. Open a PR against main with:
#    - What changed and why
#    - Paper-trading evidence (for strategy changes)
#    - Screenshots (for UI changes)
```

## What we're looking for

- New data sources and signals (with evidence quality notes)
- Strategy research with out-of-sample backtests
- UI/UX improvements to the command surface
- Documentation fixes — if the README lied to you, fix it

## What we won't merge

- Changes that bypass the agent council vote or guardrails
- Live-trading defaults — paper mode is the only default
- API keys, secrets, or personal data (these are rejected on sight)
