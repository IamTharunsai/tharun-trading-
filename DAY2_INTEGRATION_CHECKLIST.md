# DAY 2 BUILD - INTEGRATION & TESTING CHECKLIST

## Phase 1: Environment & Dependencies ⚡
- [ ] Update `.env` with Supabase credentials (SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_KEY)
- [ ] Run `npm install` in backend (installs @supabase/supabase-js, @binance/connector)
- [ ] Run `npm install` in frontend
- [ ] Verify all imports resolve in IDE (no red squiggles on new files)
- [ ] Check `package-lock.json` includes new deps

## Phase 2: Database Migration 📊
- [ ] Stop backend server
- [ ] Run: `npx prisma migrate dev --name day2_upgrades`
- [ ] Verify migration creates 4 new tables:
  - `AgentConversation`
  - `AgentLesson`
  - `AgentPerformance`
  - `AgentAdjustment`
- [ ] Open Prisma Studio to verify tables: `npx prisma studio`

## Phase 3: Backend Services ✅
- [ ] Start backend: `npm run dev` from /backend
- [ ] Verify all services load without errors:
  - [ ] WebSocket server (should see "✅ WebSocket server initialized")
  - [ ] Market data feeds (optional, may warn)
  - [ ] Job scheduler (optional, may warn)
- [ ] Test health endpoint: `curl http://localhost:4000/health`
- [ ] Should return: `{ "status": "OPERATIONAL", ... }`

## Phase 4: Chat System Testing 🤖
- [ ] Test POST /api/chat/:agentId endpoint
  ```bash
  curl -X POST http://localhost:4000/api/chat/technician \
    -H "Authorization: Bearer YOUR_TOKEN" \
    -H "Content-Type: application/json" \
    -d '{"message":"What is RSI showing for BTC?"}'
  ```
- [ ] Check response includes agentResponse field
- [ ] Verify message saved to database: `SELECT * FROM "AgentConversation" LIMIT 5`
- [ ] Test GET /api/chat/:agentId/history endpoint
- [ ] Should return array of previous conversations

## Phase 5: Self-Learning Loop Testing 📈
- [ ] Create a test trade manually in database
- [ ] Set status to CLOSED with entry/exit prices
- [ ] Run `analyzeTradeOutcome(tradeId)` manually or via test script
- [ ] Check `AgentLesson` table for entries
  ```sql
  SELECT agentId, agentName, correct, reasoning FROM "AgentLesson" 
  ORDER BY "createdAt" DESC LIMIT 10;
  ```
- [ ] Verify each agent has a lesson
- [ ] Check `AgentPerformance` table updated with confidence scores
- [ ] Confirm agent confidence changed by ±15%

## Phase 6: Frontend & Routes 🎨
- [ ] Start frontend: `npm run dev` from /frontend
- [ ] Login successfully with test account
- [ ] Navigate to Investment Plan page (should see pie chart)
- [ ] Verify layout loads without errors
- [ ] Check all 6 capital buckets display correctly
- [ ] Verify calculations are correct:
  - Percentages sum to 100%
  - Dollar amounts add up
  - Expected returns displayed

## Phase 7: Agent Council (15 Agents) 🗳️
- [ ] Monitor orchestrator logs to verify all 15 agents running:
  ```
  Agent 1: Technician
  Agent 2: Newshound
  ...
  Agent 10: Devil's Advocate
  Agent 11: Elliott Wave Master
  Agent 12: Options Flow Agent
  Agent 13: Polymarket Specialist
  Agent 14: Arbitrageur
  Agent 15: Master Coordinator
  ```
- [ ] All should complete within 45-50 seconds total
- [ ] Check WebSocket emits: `council:start`, `agent:status`, `council:complete`
- [ ] Verify voting results in dashboard agent council view
- [ ] Confirm all votes saved to `AgentDecision` table

## Phase 8: Navigation & Components 🧭
- [ ] Sidebar shows all pages:
  - [ ] Dashboard
  - [ ] Portfolio
  - [ ] Trades
  - [ ] Agent Council
  - [ ] Charts
  - [ ] Analytics
  - [ ] Journal
  - [ ] News
  - [ ] **Investment Plan** (NEW)
  - [ ] History
  - [ ] Settings
- [ ] Click each link - all pages load
- [ ] Kill switch button visible and works
- [ ] Logout works

## Phase 9: Database Integration Tests 🗄️
Run these SQL queries to verify data flow:
```sql
-- Count conversations saved
SELECT COUNT(*) FROM "AgentConversation";

-- Check agent lessons
SELECT 
  "agentName", 
  COUNT(*) as lesson_count,
  AVG(CAST("correct" AS INT)) * 100 as accuracy_pct
FROM "AgentLesson"
GROUP BY "agentName"
ORDER BY lesson_count DESC;

-- Agent performance tracking
SELECT * FROM "AgentPerformance" ORDER BY accuracy DESC;

-- Recent decisions
SELECT "asset", "finalVote", "avgConfidence", "timestamp"
FROM "AgentDecision"
ORDER BY "timestamp" DESC
LIMIT 10;
```

## Phase 10: Error Handling & Edge Cases ⚠️
- [ ] Send empty message to chat - should return error
- [ ] Send very long message - should handle gracefully
- [ ] Close chat and reopen - history should load
- [ ] Load chat for agent with no history - should show empty state
- [ ] Trigger learning loop on trade with no agent votes - should handle
- [ ] Suspend agent then unsuspend - should work
- [ ] Multiple agents chatting simultaneously - should not conflict

## Phase 11: Performance Testing ⚡
- [ ] Agent council completes in < 50 seconds
- [ ] Chat response < 8 seconds
- [ ] History loads < 2 seconds
- [ ] Learning analysis completes < 5 minutes
- [ ] Dashboard responsive on navigation

## Phase 12: Broker API Readiness 🔌
- [ ] Create test Alpaca account (or use credentials)
- [ ] Generate Alpaca API keys - add to .env
- [ ] Create test Binance US account
- [ ] Generate Binance API keys - add to .env
- [ ] Test connectivity (manual test, not auto-trading yet)
- [ ] Set TRADING_MODE=paper until fully tested

## Pre-Launch Checklist ✨
- [ ] All 15 agents tested individually
- [ ] Chat system responsive
- [ ] Learning loop improving accuracy
- [ ] Investment allocations accurate
- [ ] No console errors
- [ ] Kill switch functional
- [ ] Risk Manager veto working
- [ ] Paper trading > 60% win rate
- [ ] 24-hour continuous operation without crashes
- [ ] All guardrails active

## Sign-Off 🎯
When all checks pass:
- [ ] Day 2 is production-ready
- [ ] Can move to broker API integration (Upgrade 1)
- [ ] Can begin paper trading with real market data
- [ ] Can monitor agent learning in real-time
- [ ] Ready for real capital deployment after 2 weeks profitability

---

**Quick Command Reference:**

```bash
# Backend
npm run dev          # Start backend
npx prisma studio   # View database
npx prisma migrate dev --name day2_upgrades  # Run migrations

# Frontend  
npm run dev          # Start frontend
npm run build        # Build for production

# Testing
curl http://localhost:4000/health  # Health check
curl http://localhost:4000/api/auth/me -H "Authorization: Bearer TOKEN"  # Auth test
```

**When stuck:**
1. Check backend logs - look for timestamps and error messages
2. Check browser console (F12) - look for red errors
3. Check database - verify tables exist and have data
4. Verify env vars - Supabase keys must be correct
5. Check token expiration - 2FA token valid for 30 seconds
6. Restart server - kill previous process if still running

---

**Tharun Agentic Trading - Day 2 Implementation Complete**
