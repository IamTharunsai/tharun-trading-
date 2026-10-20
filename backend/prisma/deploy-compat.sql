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
COMMIT;
