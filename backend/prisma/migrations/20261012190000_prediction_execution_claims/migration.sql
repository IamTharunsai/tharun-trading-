CREATE TABLE "PredictionAccountAuthority" (
  "scopeKey" TEXT NOT NULL PRIMARY KEY,
  "generation" INTEGER NOT NULL DEFAULT 0,
  "updatedAt" TIMESTAMP(3) NOT NULL
);

CREATE TABLE "PredictionExecution" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "claimKey" TEXT NOT NULL,
  "ownerId" TEXT NOT NULL,
  "credentialScopeKey" TEXT NOT NULL,
  "credentialIdentity" TEXT NOT NULL,
  "predictionId" TEXT NOT NULL,
  "marketSlug" TEXT NOT NULL,
  "side" TEXT NOT NULL,
  "quantity" DOUBLE PRECISION NOT NULL,
  "sideLimitPrice" DOUBLE PRECISION NOT NULL,
  "reservedUsd" DOUBLE PRECISION NOT NULL,
  "authorityGeneration" INTEGER NOT NULL,
  "planExpiresAt" TIMESTAMP(3) NOT NULL,
  "riskPolicyHash" TEXT NOT NULL,
  "qualificationId" TEXT NOT NULL,
  "planNetEdge" DOUBLE PRECISION NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'PREPARING',
  "brokerOrderId" TEXT,
  "appliedQuantity" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "appliedNotional" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "appliedFees" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "brokerState" JSONB,
  "error" TEXT,
  "tradeId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "PredictionExecution_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "PredictionExecution_predictionId_fkey" FOREIGN KEY ("predictionId") REFERENCES "PolymarketPrediction"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "PredictionExecution_tradeId_fkey" FOREIGN KEY ("tradeId") REFERENCES "Trade"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "PredictionExecution_claimKey_key" ON "PredictionExecution"("claimKey");
CREATE UNIQUE INDEX "PredictionExecution_brokerOrderId_key" ON "PredictionExecution"("brokerOrderId");
CREATE UNIQUE INDEX "PredictionExecution_tradeId_key" ON "PredictionExecution"("tradeId");
CREATE INDEX "PredictionExecution_ownerId_credentialScopeKey_status_idx" ON "PredictionExecution"("ownerId", "credentialScopeKey", "status");
CREATE INDEX "PredictionExecution_credentialScopeKey_marketSlug_idx" ON "PredictionExecution"("credentialScopeKey", "marketSlug");
ALTER TABLE "PredictionExecution" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "PredictionAccountAuthority" ENABLE ROW LEVEL SECURITY;
