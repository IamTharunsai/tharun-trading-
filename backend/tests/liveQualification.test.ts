import { validateLiveQualification } from '../src/trading/liveQualification';
const now = Date.now();
const revision = 'a'.repeat(40);
const evidence = () => ({ strategyKey: 'BHISHMA_COUNCIL', revision, dataHash: 'b'.repeat(64), reportHash: 'c'.repeat(64),
  trialCount: 80, noLeakage: true, dsrProbability: 0.97, walkForwardPassed: true, costsValidated: true,
  executionValidated: true, ledgerReconciled: true, healthPassed: true, expiresAt: new Date(now + 3600000) });
it('requires all current version-bound qualification fields', () => {
  expect(validateLiveQualification(evidence(), 'BHISHMA_COUNCIL', revision, 0.95, now).approved).toBe(true);
});
it.each(['noLeakage', 'walkForwardPassed', 'costsValidated', 'executionValidated', 'ledgerReconciled', 'healthPassed'])(
  'blocks a failed %s gate', gate => {
    expect(validateLiveQualification({ ...evidence(), [gate]: false }, 'BHISHMA_COUNCIL', revision, 0.95, now).approved).toBe(false);
  });
it('does not treat absent evidence, an old version, low significance or expired health as live authorization', () => {
  for (const value of [null, { ...evidence(), revision: 'd'.repeat(40) }, { ...evidence(), dsrProbability: 0.94 },
    { ...evidence(), expiresAt: new Date(now - 1) }, { ...evidence(), trialCount: 0 }, { ...evidence(), dsrProbability: NaN }]) {
    expect(validateLiveQualification(value, 'BHISHMA_COUNCIL', revision, 0.95, now).approved).toBe(false);
  }
});
