// Disposable offline CI only. No exchange/provider transport is imported.
const assert = require('node:assert/strict');
const { PrismaClient } = require('@prisma/client');
if (process.env.DATABASE_URL !== 'postgresql://fixture:fixture@127.0.0.1:5432/fixture') throw Error('Disposable fixture database required');
const db = new PrismaClient();
async function run() {
  if (process.argv[2] === 'seed') {
    await db.user.create({ data: { id: 'legacy-recovery-owner', email: 'legacy@fixture.invalid', passwordHash: 'unused', role: 'OWNER' } });
    await db.polymarketPrediction.create({ data: { id: 'legacy-recovery-prediction', venue: 'polymarket_us', marketSlug: 'legacy-market',
      question: 'fixture only', marketMid: .5, rawFair: .6, fairProb: .6, evidenceWeight: 1, decision: 'YES', side: 'YES' } });
    // Select old columns only: generated client also knows the new nullable columns.
    await db.predictionExecution.create({ select: { id: true }, data: {
      id: 'legacy-recovery-claim', claimKey: 'legacy-recovery-claim', ownerId: 'legacy-recovery-owner',
      credentialScopeKey: 'old-grant', credentialIdentity: 'old-identity', predictionId: 'legacy-recovery-prediction',
      marketSlug: 'legacy-market', side: 'YES', quantity: 5, sideLimitPrice: .5, reservedUsd: 2.6,
      authorityGeneration: 3, planExpiresAt: new Date(0), riskPolicyHash: 'old-policy', qualificationId: 'old-qualification',
      planNetEdge: .1, status: 'SUBMITTING',
    } });
  } else if (process.argv[2] === 'verify') {
    const row = await db.predictionExecution.findUniqueOrThrow({ where: { id: 'legacy-recovery-claim' } });
    assert.equal(row.reservedUsd, 2.6); assert.equal(row.status, 'SUBMITTING');
    assert.equal(row.credentialScopeKey, 'old-grant'); assert.equal(row.authorityGeneration, 3);
    assert.equal(row.executionReferences, null); assert.equal(row.activityEvidence, null); assert.equal(row.cancelAttemptedAt, null);
    const security = await db.$queryRaw`SELECT relrowsecurity FROM pg_class WHERE relname = 'PredictionRecoveryState'`;
    assert.equal(security[0].relrowsecurity, true);
    for (const name of ['PredictionHolding', 'PredictionReduction', 'PredictionReductionObservation']) {
      const tables = await db.$queryRaw`SELECT relrowsecurity FROM pg_class WHERE relname = ${name}`;
      assert.equal(tables[0].relrowsecurity, true);
    }
    assert.equal(await db.predictionHolding.count(), 0);
    assert.equal(await db.predictionReduction.count(), 0);
  } else throw Error('Unknown rollout fixture stage');
  process.stdout.write('prediction recovery rollout ' + process.argv[2] + ' passed\n');
}
run().catch(error => { process.stderr.write(error.message + '\n'); process.exitCode = 1; }).finally(() => db.$disconnect());
