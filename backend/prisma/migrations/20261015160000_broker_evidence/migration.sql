-- Additive only: legacy execution fills, basis and account scope are preserved.
ALTER TABLE "Trade" ADD COLUMN "feeQuantity" DOUBLE PRECISION NOT NULL DEFAULT 0;
ALTER TABLE "Trade" ADD COLUMN "actualFeeCash" DOUBLE PRECISION NOT NULL DEFAULT 0;
ALTER TABLE "Position" ADD COLUMN "brokerObservedEntryPrice" DOUBLE PRECISION;
ALTER TABLE "Position" ADD COLUMN "brokerObservedAt" TIMESTAMP(3);
ALTER TABLE "Position" ADD COLUMN "accountingStatus" TEXT NOT NULL DEFAULT 'UNVERIFIED';
ALTER TABLE "Position" ADD COLUMN "accountingError" TEXT;
ALTER TABLE "Position" ADD COLUMN "evidenceVersion" INTEGER NOT NULL DEFAULT 0;
CREATE TABLE "BrokerOrderEvidence" (
  "id" TEXT NOT NULL PRIMARY KEY, "accountId" TEXT NOT NULL, "brokerMode" TEXT NOT NULL,
  "brokerOrderId" TEXT NOT NULL, "positionId" TEXT NOT NULL, "positionCycleAt" TIMESTAMP(3) NOT NULL,
  "parentOrderId" TEXT, "symbol" TEXT NOT NULL, "side" TEXT NOT NULL, "source" TEXT NOT NULL,
  "status" TEXT NOT NULL, "allocationComplete" BOOLEAN NOT NULL DEFAULT true,
  "appliedQuantity" DECIMAL(30,12) NOT NULL DEFAULT 0,
  "appliedNotional" DECIMAL(30,12) NOT NULL DEFAULT 0, "brokerUpdatedAt" TIMESTAMP(3),
  "evidence" JSONB NOT NULL, "observedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX "BrokerOrderEvidence_accountId_brokerMode_brokerOrderId_key" ON "BrokerOrderEvidence"("accountId", "brokerMode", "brokerOrderId");
CREATE INDEX "BrokerOrderEvidence_positionId_positionCycleAt_idx" ON "BrokerOrderEvidence"("positionId", "positionCycleAt");
CREATE TABLE "BrokerActivity" (
  "id" TEXT NOT NULL PRIMARY KEY, "accountId" TEXT NOT NULL, "brokerMode" TEXT NOT NULL,
  "brokerActivityId" TEXT NOT NULL, "activityType" TEXT NOT NULL, "brokerOrderId" TEXT,
  "symbol" TEXT, "currency" TEXT, "quantity" DECIMAL(30,12), "cashAmount" DECIMAL(30,12),
  "effectiveAt" TIMESTAMP(3), "dateOnly" BOOLEAN NOT NULL DEFAULT false,
  "attributionStatus" TEXT NOT NULL DEFAULT 'UNATTRIBUTED', "evidence" JSONB NOT NULL,
  "observedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "appliedAt" TIMESTAMP(3)
);
CREATE UNIQUE INDEX "BrokerActivity_accountId_brokerMode_brokerActivityId_key" ON "BrokerActivity"("accountId", "brokerMode", "brokerActivityId");
CREATE INDEX "BrokerActivity_accountId_brokerMode_attributionStatus_idx" ON "BrokerActivity"("accountId", "brokerMode", "attributionStatus");
CREATE TABLE "BrokerFillAllocation" (
  "id" TEXT NOT NULL PRIMARY KEY, "orderEvidenceId" TEXT NOT NULL, "tradeId" TEXT NOT NULL,
  "quantity" DECIMAL(30,12) NOT NULL DEFAULT 0, "notional" DECIMAL(30,12) NOT NULL DEFAULT 0
);
CREATE UNIQUE INDEX "BrokerFillAllocation_orderEvidenceId_tradeId_key" ON "BrokerFillAllocation"("orderEvidenceId", "tradeId");
