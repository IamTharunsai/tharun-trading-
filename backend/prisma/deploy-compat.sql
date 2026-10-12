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
COMMIT;
