-- Additive rollout: legacy NAV, entries, realized losses and ownership untouched.
CREATE TABLE "CapitalRiskState" (
 "scopeKey" TEXT NOT NULL PRIMARY KEY, "accountId" TEXT NOT NULL, "brokerMode" TEXT NOT NULL,
 "referenceAt" TIMESTAMP(3) NOT NULL, "coveredThrough" TIMESTAMP(3), "activityThrough" TIMESTAMP(3),
 "fullBackfillAt" TIMESTAMP(3), "backfillCursor" TIMESTAMP(3), "lastAttemptAt" TIMESTAMP(3), "revision" INTEGER NOT NULL DEFAULT 0,
 "status" TEXT NOT NULL DEFAULT 'UNVERIFIED', "error" TEXT
);
CREATE UNIQUE INDEX "CapitalRiskState_accountId_brokerMode_key" ON "CapitalRiskState"("accountId", "brokerMode");
CREATE TABLE "CapitalRiskPoint" (
 "id" TEXT NOT NULL PRIMARY KEY, "accountId" TEXT NOT NULL, "brokerMode" TEXT NOT NULL,
 "endAt" TIMESTAMP(3) NOT NULL, "equity" DECIMAL(30,12) NOT NULL, "externalCapital" DECIMAL(30,12) NOT NULL,
 "cashflows" JSONB NOT NULL, "complete" BOOLEAN NOT NULL, "revision" INTEGER NOT NULL, "observationId" TEXT NOT NULL
);
CREATE UNIQUE INDEX "CapitalRiskPoint_accountId_brokerMode_endAt_key" ON "CapitalRiskPoint"("accountId", "brokerMode", "endAt");
CREATE TABLE "CapitalRiskActivity" (
 "id" TEXT NOT NULL PRIMARY KEY, "accountId" TEXT NOT NULL, "brokerMode" TEXT NOT NULL,
 "brokerActivityId" TEXT NOT NULL, "activityType" TEXT NOT NULL, "classification" TEXT NOT NULL,
 "amount" DECIMAL(30,12), "dateOnly" BOOLEAN NOT NULL, "effectiveFrom" TIMESTAMP(3), "effectiveTo" TIMESTAMP(3),
 "evidence" JSONB NOT NULL, "observationId" TEXT NOT NULL
);
CREATE UNIQUE INDEX "CapitalRiskActivity_accountId_brokerMode_brokerActivityId_key" ON "CapitalRiskActivity"("accountId", "brokerMode", "brokerActivityId");
CREATE TABLE "CapitalRiskObservation" (
 "id" TEXT NOT NULL PRIMARY KEY, "accountId" TEXT NOT NULL, "brokerMode" TEXT NOT NULL, "revision" INTEGER NOT NULL,
 "observedAt" TIMESTAMP(3) NOT NULL, "activityAfter" TIMESTAMP(3) NOT NULL, "activityUntil" TIMESTAMP(3) NOT NULL,
 "history" JSONB NOT NULL, "activities" JSONB NOT NULL
);
CREATE UNIQUE INDEX "CapitalRiskObservation_accountId_brokerMode_revision_key" ON "CapitalRiskObservation"("accountId", "brokerMode", "revision");
ALTER TABLE "PortfolioSnapshot" ADD COLUMN "riskDataComplete" BOOLEAN NOT NULL DEFAULT false,
 ADD COLUMN "riskAsOf" TIMESTAMP(3), ADD COLUMN "riskReferenceAt" TIMESTAMP(3), ADD COLUMN "riskRevision" INTEGER,
 ADD COLUMN "adjustedDailyPnl" DECIMAL(30,12), ADD COLUMN "adjustedDailyPnlPct" DECIMAL(30,12);
