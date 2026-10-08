ALTER TABLE "DebateCheckpoint" ADD COLUMN "inputFingerprint" TEXT,
  ADD COLUMN "evidenceBundle" JSONB;

CREATE TABLE "ExecutionIntent" (
  "id" TEXT NOT NULL,
  "decisionId" TEXT NOT NULL,
  "clientOrderId" TEXT NOT NULL,
  "brokerOrderId" TEXT,
  "asset" TEXT NOT NULL,
  "market" TEXT NOT NULL,
  "mode" TEXT NOT NULL,
  "accountId" TEXT NOT NULL,
  "executionPlan" JSONB NOT NULL,
  "direction" TEXT NOT NULL,
  "quantity" DOUBLE PRECISION NOT NULL,
  "referencePrice" DOUBLE PRECISION NOT NULL,
  "protection" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'SUBMITTING',
  "fillPrice" DOUBLE PRECISION,
  "fillQuantity" DOUBLE PRECISION,
  "lastBrokerState" JSONB,
  "error" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ExecutionIntent_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ExecutionIntent_decisionId_fkey" FOREIGN KEY ("decisionId") REFERENCES "AgentDecision"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "ExecutionIntent_decisionId_key" ON "ExecutionIntent"("decisionId");
CREATE UNIQUE INDEX "ExecutionIntent_clientOrderId_key" ON "ExecutionIntent"("clientOrderId");
CREATE UNIQUE INDEX "ExecutionIntent_brokerOrderId_key" ON "ExecutionIntent"("brokerOrderId");
CREATE INDEX "ExecutionIntent_mode_accountId_status_idx" ON "ExecutionIntent"("mode", "accountId", "status");
ALTER TABLE "ExecutionIntent" ENABLE ROW LEVEL SECURITY;
