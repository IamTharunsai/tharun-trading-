-- Compatibility preparation for deployments using db push (not migrate deploy).
-- Keep historical positions unassigned until the broker verifies account identity.
-- Never reset data or fabricate ownership to satisfy the new scoped position key.
BEGIN;
DO $$
BEGIN
  IF to_regclass('"Position"') IS NOT NULL THEN
    ALTER TABLE "Position" ADD COLUMN IF NOT EXISTS "scopeKey" TEXT;
    -- PostgreSQL permits multiple NULL values. Duplicate verified keys still fail.
    CREATE UNIQUE INDEX IF NOT EXISTS "Position_scopeKey_key" ON "Position"("scopeKey");
  END IF;
END $$;
-- Runs BEFORE db push, including a fresh database. No dependency on User here:
-- owner identity is verified in the application; the pin survives owner edits.
CREATE TABLE IF NOT EXISTS "PredictionRecoveryState" (
  "ownerId" TEXT PRIMARY KEY, "boundCredentialScopeKey" TEXT, "cursorId" TEXT,
  "leaseId" TEXT, "leaseUntil" TIMESTAMP(3), "lastStartedAt" TIMESTAMP(3),
  "lastFinishedAt" TIMESTAMP(3), "lastOutcome" TEXT,
  "lastProcessed" INTEGER NOT NULL DEFAULT 0, "lastUnresolved" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL
);
ALTER TABLE "PredictionRecoveryState" ENABLE ROW LEVEL SECURITY;
CREATE TABLE IF NOT EXISTS "PredictionHolding" (
  "openingExecutionId" TEXT PRIMARY KEY, "ownerId" TEXT NOT NULL, "credentialScopeKey" TEXT NOT NULL,
  "marketSlug" TEXT NOT NULL, "side" TEXT NOT NULL, "openingQuantity" DOUBLE PRECISION NOT NULL,
  "openingNotional" DOUBLE PRECISION NOT NULL, "openingFees" DOUBLE PRECISION NOT NULL,
  "openingQualificationId" TEXT NOT NULL, "remainingQuantity" DOUBLE PRECISION NOT NULL,
  "remainingBasis" DOUBLE PRECISION NOT NULL, "realizedPnl" DOUBLE PRECISION,
  "accountingStatus" TEXT NOT NULL DEFAULT 'LINKED_ORDER_ONLY',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL
);
CREATE TABLE IF NOT EXISTS "PredictionReduction" (
  "id" TEXT PRIMARY KEY, "claimKey" TEXT NOT NULL, "openingExecutionId" TEXT NOT NULL,
  "ownerId" TEXT NOT NULL, "credentialScopeKey" TEXT NOT NULL, "credentialIdentity" TEXT NOT NULL,
  "marketSlug" TEXT NOT NULL, "side" TEXT NOT NULL, "quantity" DOUBLE PRECISION NOT NULL,
  "sideMinPrice" DOUBLE PRECISION NOT NULL, "authorityGeneration" INTEGER NOT NULL,
  "planExpiresAt" TIMESTAMP(3) NOT NULL, "status" TEXT NOT NULL DEFAULT 'PREPARING', "brokerOrderId" TEXT,
  "appliedQuantity" DOUBLE PRECISION NOT NULL DEFAULT 0, "appliedProceeds" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "appliedFees" DOUBLE PRECISION, "terminalObserved" BOOLEAN NOT NULL DEFAULT false, "error" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL
);
CREATE TABLE IF NOT EXISTS "PredictionReductionObservation" (
  "id" TEXT PRIMARY KEY, "reductionId" TEXT NOT NULL, "evidence" JSONB NOT NULL,
  "observedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS "PredictionReduction_claimKey_key" ON "PredictionReduction"("claimKey");
CREATE UNIQUE INDEX IF NOT EXISTS "PredictionReduction_brokerOrderId_key" ON "PredictionReduction"("brokerOrderId");
CREATE INDEX IF NOT EXISTS "PredictionHolding_ownerId_credentialScopeKey_idx" ON "PredictionHolding"("ownerId", "credentialScopeKey");
CREATE INDEX IF NOT EXISTS "PredictionReduction_ownerId_credentialScopeKey_status_idx" ON "PredictionReduction"("ownerId", "credentialScopeKey", "status");
CREATE INDEX IF NOT EXISTS "PredictionReductionObservation_reductionId_observedAt_idx" ON "PredictionReductionObservation"("reductionId", "observedAt");
ALTER TABLE "PredictionHolding" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "PredictionReduction" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "PredictionReductionObservation" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "PredictionReduction" ADD COLUMN IF NOT EXISTS "policyEvidence" JSONB;
ALTER TABLE "PredictionRecoveryState" ADD COLUMN IF NOT EXISTS "holdingCursorId" TEXT;

CREATE TABLE IF NOT EXISTS "CapitalActivityCoverageObservation" (
  "id" TEXT NOT NULL PRIMARY KEY, "accountId" TEXT NOT NULL, "brokerMode" TEXT NOT NULL,
  "accountCreatedAt" TIMESTAMP(3) NOT NULL, "since" TIMESTAMP(3) NOT NULL, "until" TIMESTAMP(3) NOT NULL,
  "observedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "digest" TEXT NOT NULL,
  "events" JSONB NOT NULL, "transportComplete" BOOLEAN NOT NULL
);
CREATE INDEX IF NOT EXISTS "CapitalActivityCoverage_account_mode_until_idx"
  ON "CapitalActivityCoverageObservation"("accountId", "brokerMode", "until");
ALTER TABLE "CapitalActivityCoverageObservation" ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS "ForecastRecord" (
  "id" TEXT NOT NULL PRIMARY KEY, "source" TEXT NOT NULL, "asset" TEXT NOT NULL,
  "market" TEXT NOT NULL, "direction" TEXT NOT NULL, "probabilityUp" DOUBLE PRECISION,
  "referencePrice" DOUBLE PRECISION NOT NULL, "predictedPrice" DOUBLE PRECISION,
  "expectedReturn" DOUBLE PRECISION, "horizonBars" INTEGER NOT NULL,
  "barDurationMs" DOUBLE PRECISION NOT NULL, "maturesAt" TIMESTAMP(3) NOT NULL,
  "decisionId" TEXT, "realizedPrice" DOUBLE PRECISION, "realizedReturn" DOUBLE PRECISION,
  "directionHit" BOOLEAN, "brier" DOUBLE PRECISION, "scoredAt" TIMESTAMP(3),
  "metadata" JSONB, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS "ForecastRecord_asset_createdAt_idx" ON "ForecastRecord"("asset", "createdAt");
CREATE INDEX IF NOT EXISTS "ForecastRecord_source_createdAt_idx" ON "ForecastRecord"("source", "createdAt");
CREATE INDEX IF NOT EXISTS "ForecastRecord_maturesAt_scoredAt_idx" ON "ForecastRecord"("maturesAt", "scoredAt");
ALTER TABLE "ForecastRecord" ENABLE ROW LEVEL SECURITY;

COMMIT;
