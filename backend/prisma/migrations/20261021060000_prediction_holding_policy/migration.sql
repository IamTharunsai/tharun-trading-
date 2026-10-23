ALTER TABLE "PredictionReduction" ADD COLUMN IF NOT EXISTS "policyEvidence" JSONB;
ALTER TABLE "PredictionRecoveryState" ADD COLUMN IF NOT EXISTS "holdingCursorId" TEXT;
