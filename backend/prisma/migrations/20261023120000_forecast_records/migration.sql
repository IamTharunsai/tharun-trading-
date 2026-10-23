CREATE TABLE "ForecastRecord" (
 "id" TEXT NOT NULL PRIMARY KEY, "source" TEXT NOT NULL, "asset" TEXT NOT NULL,
 "market" TEXT NOT NULL, "direction" TEXT NOT NULL, "probabilityUp" DOUBLE PRECISION,
 "referencePrice" DOUBLE PRECISION NOT NULL, "predictedPrice" DOUBLE PRECISION,
 "expectedReturn" DOUBLE PRECISION, "horizonBars" INTEGER NOT NULL,
 "barDurationMs" DOUBLE PRECISION NOT NULL, "maturesAt" TIMESTAMP(3) NOT NULL,
 "decisionId" TEXT, "realizedPrice" DOUBLE PRECISION, "realizedReturn" DOUBLE PRECISION,
 "directionHit" BOOLEAN, "brier" DOUBLE PRECISION, "scoredAt" TIMESTAMP(3),
 "metadata" JSONB, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "ForecastRecord_asset_createdAt_idx" ON "ForecastRecord"("asset", "createdAt");
CREATE INDEX "ForecastRecord_source_createdAt_idx" ON "ForecastRecord"("source", "createdAt");
CREATE INDEX "ForecastRecord_maturesAt_scoredAt_idx" ON "ForecastRecord"("maturesAt", "scoredAt");
ALTER TABLE "ForecastRecord" ENABLE ROW LEVEL SECURITY;
