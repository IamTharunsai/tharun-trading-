CREATE TABLE "CapitalActivityCoverageObservation" (
  "id" TEXT NOT NULL PRIMARY KEY, "accountId" TEXT NOT NULL, "brokerMode" TEXT NOT NULL,
  "accountCreatedAt" TIMESTAMP(3) NOT NULL, "since" TIMESTAMP(3) NOT NULL, "until" TIMESTAMP(3) NOT NULL,
  "observedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "digest" TEXT NOT NULL,
  "events" JSONB NOT NULL, "transportComplete" BOOLEAN NOT NULL
);
CREATE INDEX "CapitalActivityCoverage_account_mode_until_idx"
  ON "CapitalActivityCoverageObservation"("accountId", "brokerMode", "until");
ALTER TABLE "CapitalActivityCoverageObservation" ENABLE ROW LEVEL SECURITY;
