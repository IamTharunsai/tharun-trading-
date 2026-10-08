-- Sentiment feed history (additive only; no existing table is touched).
CREATE TABLE IF NOT EXISTS "SentimentSnapshot" (
    "id" TEXT NOT NULL,
    "asset" TEXT NOT NULL,
    "market" TEXT,
    "score" DOUBLE PRECISION NOT NULL,
    "confidence" DOUBLE PRECISION NOT NULL,
    "mentionCount" INTEGER NOT NULL,
    "volumeZScore" DOUBLE PRECISION,
    "sourceCounts" JSONB NOT NULL,
    "newestItemAt" TIMESTAMP(3),
    "fearGreed" INTEGER,
    "scorer" TEXT NOT NULL,
    "headlines" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SentimentSnapshot_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "SentimentSnapshot_asset_createdAt_idx" ON "SentimentSnapshot"("asset", "createdAt");

-- Match the 2026-10-04 RLS migration: backend (service role) bypasses RLS.
ALTER TABLE "SentimentSnapshot" ENABLE ROW LEVEL SECURITY;
