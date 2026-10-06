-- ═══════════════════════════════════════════════════════════════════════════════
-- MIGRATION: Enable Row Level Security on all 33 tables
-- Generated: 2026-10-04
-- Purpose: Prevent direct client-side reads/writes to any table.
--          The backend (service-role key) bypasses RLS so normal operation
--          is unaffected. Direct Supabase client connections from browsers
--          are blocked unless an explicit policy grants access.
-- ═══════════════════════════════════════════════════════════════════════════════
--
-- !! IMPORTANT — Run this in your Supabase SQL editor or via CLI !!
-- !! DO NOT run autonomously — per project constraint, production DB !!
-- !! changes MUST be applied manually by the human operator.        !!
-- ═══════════════════════════════════════════════════════════════════════════════

-- ── Step 1: Enable RLS on every table ────────────────────────────────────────
ALTER TABLE "User"                 ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Trade"                ENABLE ROW LEVEL SECURITY;
ALTER TABLE "AgentDecision"        ENABLE ROW LEVEL SECURITY;
ALTER TABLE "DebateCheckpoint"     ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Position"             ENABLE ROW LEVEL SECURITY;
ALTER TABLE "PortfolioSnapshot"    ENABLE ROW LEVEL SECURITY;
ALTER TABLE "NewsItem"             ENABLE ROW LEVEL SECURITY;
ALTER TABLE "DailyJournal"         ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Prediction"           ENABLE ROW LEVEL SECURITY;
ALTER TABLE "MarketEvent"          ENABLE ROW LEVEL SECURITY;
ALTER TABLE "SystemLog"            ENABLE ROW LEVEL SECURITY;
ALTER TABLE "AgentConversation"    ENABLE ROW LEVEL SECURITY;
ALTER TABLE "AgentLesson"          ENABLE ROW LEVEL SECURITY;
ALTER TABLE "AgentPerformance"     ENABLE ROW LEVEL SECURITY;
ALTER TABLE "AgentAdjustment"      ENABLE ROW LEVEL SECURITY;
ALTER TABLE "LearningResource"     ENABLE ROW LEVEL SECURITY;
ALTER TABLE "GeopoliticalEvent"    ENABLE ROW LEVEL SECURITY;
ALTER TABLE "MacroIndicator"       ENABLE ROW LEVEL SECURITY;
ALTER TABLE "AgentLearningState"   ENABLE ROW LEVEL SECURITY;
ALTER TABLE "CompanyFundamentals"  ENABLE ROW LEVEL SECURITY;
ALTER TABLE "AnnualReport"         ENABLE ROW LEVEL SECURITY;
ALTER TABLE "StockMemory"          ENABLE ROW LEVEL SECURITY;
ALTER TABLE "GeoRiskAssessment"    ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Settings"             ENABLE ROW LEVEL SECURITY;
ALTER TABLE "GuardrailLog"         ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ProviderSyncRecord"   ENABLE ROW LEVEL SECURITY;
ALTER TABLE "BrokerReconciliation" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "AuthAuditLog"         ENABLE ROW LEVEL SECURITY;
ALTER TABLE "RevokedToken"         ENABLE ROW LEVEL SECURITY;
ALTER TABLE "TradeLifecycleAudit"  ENABLE ROW LEVEL SECURITY;
ALTER TABLE "InvestmentThesis"     ENABLE ROW LEVEL SECURITY;
ALTER TABLE "EventIntelligence"    ENABLE ROW LEVEL SECURITY;
ALTER TABLE "AuditLedger"          ENABLE ROW LEVEL SECURITY;

-- ── Step 2: Service-role bypass policies ─────────────────────────────────────
-- The APEX backend uses DATABASE_URL with the service-role key (bypasses RLS
-- automatically). These policies are a belt-and-suspenders safety net for any
-- future connection that uses the service_role via policy (not the bypass path).
--
-- All SELECT / INSERT / UPDATE policies use:
--   auth.role() = 'service_role'
-- which matches Supabase connections authenticated via the service key.
-- No policy is needed for DELETE on Trade (must be done manually per constraint).

-- ── User ─────────────────────────────────────────────────────────────────────
CREATE POLICY "service_role_all_User" ON "User"
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- ── Trade ────────────────────────────────────────────────────────────────────
-- NOTE: DELETE intentionally omitted — Trade records must never be deleted
--       autonomously. Only SELECT / INSERT / UPDATE allowed programmatically.
CREATE POLICY "service_role_select_Trade" ON "Trade"
  FOR SELECT TO service_role USING (true);
CREATE POLICY "service_role_insert_Trade" ON "Trade"
  FOR INSERT TO service_role WITH CHECK (true);
CREATE POLICY "service_role_update_Trade" ON "Trade"
  FOR UPDATE TO service_role USING (true) WITH CHECK (true);

-- ── AgentDecision ────────────────────────────────────────────────────────────
CREATE POLICY "service_role_all_AgentDecision" ON "AgentDecision"
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- ── DebateCheckpoint ─────────────────────────────────────────────────────────
CREATE POLICY "service_role_all_DebateCheckpoint" ON "DebateCheckpoint"
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- ── Position ─────────────────────────────────────────────────────────────────
CREATE POLICY "service_role_all_Position" ON "Position"
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- ── PortfolioSnapshot ────────────────────────────────────────────────────────
CREATE POLICY "service_role_all_PortfolioSnapshot" ON "PortfolioSnapshot"
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- ── NewsItem ─────────────────────────────────────────────────────────────────
CREATE POLICY "service_role_all_NewsItem" ON "NewsItem"
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- ── DailyJournal ─────────────────────────────────────────────────────────────
CREATE POLICY "service_role_all_DailyJournal" ON "DailyJournal"
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- ── Prediction ───────────────────────────────────────────────────────────────
CREATE POLICY "service_role_all_Prediction" ON "Prediction"
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- ── MarketEvent ──────────────────────────────────────────────────────────────
CREATE POLICY "service_role_all_MarketEvent" ON "MarketEvent"
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- ── SystemLog ────────────────────────────────────────────────────────────────
CREATE POLICY "service_role_all_SystemLog" ON "SystemLog"
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- ── AgentConversation ────────────────────────────────────────────────────────
CREATE POLICY "service_role_all_AgentConversation" ON "AgentConversation"
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- ── AgentLesson ──────────────────────────────────────────────────────────────
CREATE POLICY "service_role_all_AgentLesson" ON "AgentLesson"
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- ── AgentPerformance ─────────────────────────────────────────────────────────
CREATE POLICY "service_role_all_AgentPerformance" ON "AgentPerformance"
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- ── AgentAdjustment ──────────────────────────────────────────────────────────
CREATE POLICY "service_role_all_AgentAdjustment" ON "AgentAdjustment"
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- ── LearningResource ─────────────────────────────────────────────────────────
CREATE POLICY "service_role_all_LearningResource" ON "LearningResource"
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- ── GeopoliticalEvent ────────────────────────────────────────────────────────
CREATE POLICY "service_role_all_GeopoliticalEvent" ON "GeopoliticalEvent"
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- ── MacroIndicator ───────────────────────────────────────────────────────────
CREATE POLICY "service_role_all_MacroIndicator" ON "MacroIndicator"
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- ── AgentLearningState ───────────────────────────────────────────────────────
CREATE POLICY "service_role_all_AgentLearningState" ON "AgentLearningState"
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- ── CompanyFundamentals ──────────────────────────────────────────────────────
CREATE POLICY "service_role_all_CompanyFundamentals" ON "CompanyFundamentals"
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- ── AnnualReport ─────────────────────────────────────────────────────────────
CREATE POLICY "service_role_all_AnnualReport" ON "AnnualReport"
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- ── StockMemory ──────────────────────────────────────────────────────────────
CREATE POLICY "service_role_all_StockMemory" ON "StockMemory"
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- ── GeoRiskAssessment ────────────────────────────────────────────────────────
CREATE POLICY "service_role_all_GeoRiskAssessment" ON "GeoRiskAssessment"
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- ── Settings ─────────────────────────────────────────────────────────────────
CREATE POLICY "service_role_all_Settings" ON "Settings"
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- ── GuardrailLog ─────────────────────────────────────────────────────────────
CREATE POLICY "service_role_all_GuardrailLog" ON "GuardrailLog"
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- ── ProviderSyncRecord ───────────────────────────────────────────────────────
CREATE POLICY "service_role_all_ProviderSyncRecord" ON "ProviderSyncRecord"
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- ── BrokerReconciliation ─────────────────────────────────────────────────────
CREATE POLICY "service_role_all_BrokerReconciliation" ON "BrokerReconciliation"
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- ── AuthAuditLog ─────────────────────────────────────────────────────────────
CREATE POLICY "service_role_all_AuthAuditLog" ON "AuthAuditLog"
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- ── RevokedToken ─────────────────────────────────────────────────────────────
CREATE POLICY "service_role_all_RevokedToken" ON "RevokedToken"
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- ── TradeLifecycleAudit ──────────────────────────────────────────────────────
CREATE POLICY "service_role_all_TradeLifecycleAudit" ON "TradeLifecycleAudit"
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- ── InvestmentThesis ─────────────────────────────────────────────────────────
CREATE POLICY "service_role_all_InvestmentThesis" ON "InvestmentThesis"
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- ── EventIntelligence ────────────────────────────────────────────────────────
CREATE POLICY "service_role_all_EventIntelligence" ON "EventIntelligence"
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- ── AuditLedger ──────────────────────────────────────────────────────────────
CREATE POLICY "service_role_all_AuditLedger" ON "AuditLedger"
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- ═══════════════════════════════════════════════════════════════════════════════
-- HOW TO APPLY
-- ═══════════════════════════════════════════════════════════════════════════════
-- Option A (Supabase dashboard):
--   1. Open your project → SQL Editor
--   2. Paste this entire file and click Run
--
-- Option B (Supabase CLI):
--   supabase db push   (if using local dev)
--   or
--   psql "$DATABASE_URL" -f this_file.sql
--
-- VERIFICATION — run after applying:
--   SELECT tablename, rowsecurity
--   FROM pg_tables
--   WHERE schemaname = 'public'
--   ORDER BY tablename;
--
--   All rows should show rowsecurity = true.
--
-- ROLLBACK (if needed):
--   ALTER TABLE "<TableName>" DISABLE ROW LEVEL SECURITY;
--   DROP POLICY IF EXISTS "service_role_all_<TableName>" ON "<TableName>";
-- ═══════════════════════════════════════════════════════════════════════════════
