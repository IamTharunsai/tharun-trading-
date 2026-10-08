CREATE TABLE "StrategyQualification" (
 "id" TEXT NOT NULL PRIMARY KEY, "strategyKey" TEXT NOT NULL, "revision" TEXT NOT NULL,
 "dataHash" TEXT NOT NULL, "reportHash" TEXT NOT NULL, "trialCount" INTEGER NOT NULL,
 "noLeakage" BOOLEAN NOT NULL DEFAULT false, "dsrProbability" DOUBLE PRECISION NOT NULL,
 "walkForwardPassed" BOOLEAN NOT NULL DEFAULT false, "costsValidated" BOOLEAN NOT NULL DEFAULT false,
 "executionValidated" BOOLEAN NOT NULL DEFAULT false, "ledgerReconciled" BOOLEAN NOT NULL DEFAULT false,
 "healthPassed" BOOLEAN NOT NULL DEFAULT false, "expiresAt" TIMESTAMP(3) NOT NULL,
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "evidence" JSONB NOT NULL
);
CREATE INDEX "StrategyQualification_strategyKey_revision_createdAt_idx" ON "StrategyQualification"("strategyKey", "revision", "createdAt");
ALTER TABLE "StrategyQualification" ENABLE ROW LEVEL SECURITY;
