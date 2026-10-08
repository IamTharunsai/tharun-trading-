-- Polymarket edge engine: prediction log (scorecard) + paper limit orders.
-- Additive only; no existing table is touched.
CREATE TABLE IF NOT EXISTS "PolymarketPrediction" (
    "id" TEXT NOT NULL,
    "venue" TEXT NOT NULL,
    "marketSlug" TEXT NOT NULL,
    "eventSlug" TEXT,
    "category" TEXT,
    "question" TEXT NOT NULL,
    "endDate" TIMESTAMP(3),
    "marketMid" DOUBLE PRECISION NOT NULL,
    "bestBid" DOUBLE PRECISION,
    "bestAsk" DOUBLE PRECISION,
    "llmProb" DOUBLE PRECISION,
    "llmConfidence" DOUBLE PRECISION,
    "headlineCount" INTEGER NOT NULL DEFAULT 0,
    "sentimentScore" DOUBLE PRECISION,
    "sentimentMentions" INTEGER NOT NULL DEFAULT 0,
    "momentum" DOUBLE PRECISION,
    "rawFair" DOUBLE PRECISION NOT NULL,
    "fairProb" DOUBLE PRECISION NOT NULL,
    "evidenceWeight" DOUBLE PRECISION NOT NULL,
    "decision" TEXT NOT NULL,
    "skipReason" TEXT,
    "side" TEXT,
    "netEdge" DOUBLE PRECISION,
    "execPrice" DOUBLE PRECISION,
    "feePerShare" DOUBLE PRECISION,
    "tradeId" TEXT,
    "outcome" DOUBLE PRECISION,
    "resolvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PolymarketPrediction_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "PolymarketPrediction_marketSlug_createdAt_idx" ON "PolymarketPrediction"("marketSlug", "createdAt");
CREATE INDEX IF NOT EXISTS "PolymarketPrediction_resolvedAt_idx" ON "PolymarketPrediction"("resolvedAt");
CREATE INDEX IF NOT EXISTS "PolymarketPrediction_createdAt_idx" ON "PolymarketPrediction"("createdAt");

CREATE TABLE IF NOT EXISTS "PolymarketPaperOrder" (
    "id" TEXT NOT NULL,
    "venue" TEXT NOT NULL,
    "marketSlug" TEXT NOT NULL,
    "eventSlug" TEXT,
    "category" TEXT,
    "question" TEXT,
    "side" TEXT NOT NULL,
    "limitPrice" DOUBLE PRECISION NOT NULL,
    "shares" DOUBLE PRECISION NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "predictionId" TEXT,
    "fairAtOrder" DOUBLE PRECISION,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "filledAt" TIMESTAMP(3),
    "fillPrice" DOUBLE PRECISION,
    "tradeId" TEXT,
    "cancelReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PolymarketPaperOrder_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "PolymarketPaperOrder_status_idx" ON "PolymarketPaperOrder"("status");
CREATE INDEX IF NOT EXISTS "PolymarketPaperOrder_marketSlug_idx" ON "PolymarketPaperOrder"("marketSlug");

-- Match the 2026-10-04 RLS migration: backend (service role) bypasses RLS.
ALTER TABLE "PolymarketPrediction" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "PolymarketPaperOrder" ENABLE ROW LEVEL SECURITY;
