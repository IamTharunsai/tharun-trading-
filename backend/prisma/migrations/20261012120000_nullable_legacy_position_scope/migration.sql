-- Align migration-managed databases with the compatibility rollout schema.
-- Existing legacy keys remain intact; no account attribution or data is changed.
ALTER TABLE "Position" ALTER COLUMN "scopeKey" DROP NOT NULL;
