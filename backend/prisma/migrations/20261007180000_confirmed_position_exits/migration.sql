ALTER TABLE "Trade" ADD COLUMN "accountId" TEXT, ADD COLUMN "brokerMode" TEXT,
 ADD COLUMN "positionId" TEXT, ADD COLUMN "closedQuantity" DOUBLE PRECISION NOT NULL DEFAULT 0,
 ADD COLUMN "realizedPnl" DOUBLE PRECISION NOT NULL DEFAULT 0,
 ADD COLUMN "exitNotional" DOUBLE PRECISION NOT NULL DEFAULT 0,
 ADD COLUMN "unrealizedPnl" DOUBLE PRECISION NOT NULL DEFAULT 0,
 ADD COLUMN "unrealizedPnlPct" DOUBLE PRECISION NOT NULL DEFAULT 0;
ALTER TABLE "Position" ADD COLUMN "scopeKey" TEXT, ADD COLUMN "accountId" TEXT, ADD COLUMN "brokerMode" TEXT,
 ADD COLUMN "pendingEntryIntentId" TEXT, ADD COLUMN "brokerObservedQuantity" DOUBLE PRECISION;
UPDATE "Position" SET "scopeKey" = 'legacy:' || "id";
ALTER TABLE "Position" ALTER COLUMN "scopeKey" SET NOT NULL;
DROP INDEX "Position_asset_key";
CREATE UNIQUE INDEX "Position_scopeKey_key" ON "Position"("scopeKey");
ALTER TABLE "Trade" ADD CONSTRAINT "Trade_positionId_fkey" FOREIGN KEY ("positionId") REFERENCES "Position"("id") ON DELETE SET NULL ON UPDATE CASCADE;
CREATE TABLE "PositionExit" (
 "id" TEXT NOT NULL PRIMARY KEY, "cycleKey" TEXT NOT NULL, "positionId" TEXT NOT NULL,
 "accountId" TEXT NOT NULL, "brokerMode" TEXT NOT NULL, "symbol" TEXT NOT NULL,
 "side" TEXT NOT NULL, "quantity" DOUBLE PRECISION NOT NULL, "clientOrderId" TEXT NOT NULL,
 "brokerOrderId" TEXT, "reason" TEXT NOT NULL, "attempt" INTEGER NOT NULL DEFAULT 1,
 "evidenceKind" TEXT NOT NULL DEFAULT 'CLIENT_ORDER', "status" TEXT NOT NULL DEFAULT 'PREPARING',
 "appliedQuantity" DOUBLE PRECISION NOT NULL DEFAULT 0,
 "appliedNotional" DOUBLE PRECISION NOT NULL DEFAULT 0, "error" TEXT, "brokerEvidence" JSONB,
 "realizedPnl" DOUBLE PRECISION NOT NULL DEFAULT 0, "entryBasis" DOUBLE PRECISION NOT NULL DEFAULT 0,
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
 CONSTRAINT "PositionExit_positionId_fkey" FOREIGN KEY ("positionId") REFERENCES "Position"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "PositionExit_cycleKey_key" ON "PositionExit"("cycleKey");
CREATE UNIQUE INDEX "PositionExit_clientOrderId_key" ON "PositionExit"("clientOrderId");
CREATE INDEX "PositionExit_accountId_brokerMode_status_updatedAt_idx" ON "PositionExit"("accountId", "brokerMode", "status", "updatedAt");
ALTER TABLE "PositionExit" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "PortfolioSnapshot" ADD COLUMN "accountId" TEXT, ADD COLUMN "brokerMode" TEXT;
CREATE INDEX "PortfolioSnapshot_accountId_brokerMode_timestamp_idx" ON "PortfolioSnapshot"("accountId", "brokerMode", "timestamp");
