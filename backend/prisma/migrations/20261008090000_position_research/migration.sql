CREATE TABLE "PositionResearch" (
  "id" TEXT NOT NULL,
  "cycleKey" TEXT NOT NULL,
  "positionId" TEXT NOT NULL,
  "accountId" TEXT NOT NULL,
  "brokerMode" TEXT NOT NULL,
  "asset" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'PENDING',
  "leaseToken" TEXT,
  "leaseUntil" TIMESTAMP(3),
  "nextReviewAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "lastAttemptAt" TIMESTAMP(3),
  "lastCompletedAt" TIMESTAMP(3),
  "decisionId" TEXT,
  "observation" TEXT,
  "error" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "PositionResearch_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "PositionResearch_cycleKey_key" ON "PositionResearch"("cycleKey");
CREATE INDEX "PositionResearch_accountId_brokerMode_nextReviewAt_idx" ON "PositionResearch"("accountId", "brokerMode", "nextReviewAt");
ALTER TABLE "PositionResearch" ENABLE ROW LEVEL SECURITY;
