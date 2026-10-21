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
-- deploy-compat creates these tables without dependencies on a fresh database.
-- db push installs the same declared foreign keys; migrate deploy adds them here.
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'PredictionHolding_openingExecutionId_fkey') THEN
    ALTER TABLE "PredictionHolding" ADD CONSTRAINT "PredictionHolding_openingExecutionId_fkey"
      FOREIGN KEY ("openingExecutionId") REFERENCES "PredictionExecution"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'PredictionReduction_openingExecutionId_fkey') THEN
    ALTER TABLE "PredictionReduction" ADD CONSTRAINT "PredictionReduction_openingExecutionId_fkey"
      FOREIGN KEY ("openingExecutionId") REFERENCES "PredictionHolding"("openingExecutionId") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'PredictionReductionObservation_reductionId_fkey') THEN
    ALTER TABLE "PredictionReductionObservation" ADD CONSTRAINT "PredictionReductionObservation_reductionId_fkey"
      FOREIGN KEY ("reductionId") REFERENCES "PredictionReduction"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END $$;
