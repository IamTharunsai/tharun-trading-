CREATE TABLE "PredictionRecoveryState" (
  "ownerId" TEXT PRIMARY KEY, "boundCredentialScopeKey" TEXT, "cursorId" TEXT,
  "leaseId" TEXT, "leaseUntil" TIMESTAMP(3), "lastStartedAt" TIMESTAMP(3),
  "lastFinishedAt" TIMESTAMP(3), "lastOutcome" TEXT,
  "lastProcessed" INTEGER NOT NULL DEFAULT 0, "lastUnresolved" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL
);
ALTER TABLE "PredictionRecoveryState" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "PredictionExecution" ADD COLUMN "executionReferences" JSONB,
  ADD COLUMN "activityEvidence" JSONB, ADD COLUMN "cancelAttemptedAt" TIMESTAMP(3);
