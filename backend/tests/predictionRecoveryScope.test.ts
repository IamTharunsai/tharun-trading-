import { assertPredictionRecoveryScope, ensurePredictionRecoveryScope } from '../src/trading/predictionRecoveryScope';
let state: any; let previous: any[]; let other: any;
const db: any = { $executeRaw: jest.fn(), predictionRecoveryState: {
  findUnique: jest.fn(async () => state), create: jest.fn(async ({ data }: any) => state = { ...data }),
}, predictionExecution: { findMany: jest.fn(async () => previous), findFirst: jest.fn(async () => other) } };
beforeEach(() => { state = null; previous = []; other = null; jest.clearAllMocks(); });
test('first grant is locally pinned without claiming stable exchange identity', async () => {
  expect(await ensurePredictionRecoveryScope(db, 'owner', 'grant-a')).toMatchObject({ allowed: true, state: { boundCredentialScopeKey: 'grant-a' } });
  await expect(assertPredictionRecoveryScope(db, 'owner', 'grant-a')).resolves.toBeUndefined();
});
test('rotation cannot reset history even when there are no currently pending orders', async () => {
  previous = [{ credentialScopeKey: 'old-grant' }];
  await expect(assertPredictionRecoveryScope(db, 'owner', 'new-grant')).rejects.toThrow('ROTATION_REQUIRES_REVIEW');
  expect(state.boundCredentialScopeKey).toBe('old-grant');
});
test('multiple historical grants are not merged, and another grant reservation blocks entry', async () => {
  previous = [{ credentialScopeKey: 'grant-a' }, { credentialScopeKey: 'grant-b' }];
  expect(await ensurePredictionRecoveryScope(db, 'owner', 'grant-a')).toMatchObject({ allowed: false, reason: 'HISTORICAL_GRANTS_AMBIGUOUS' });
  state = { ownerId: 'owner', boundCredentialScopeKey: 'grant-a' }; other = { id: 'unresolved-other-grant' };
  await expect(assertPredictionRecoveryScope(db, 'owner', 'grant-a')).rejects.toThrow('OTHER_GRANT_REQUIRES_RECONCILIATION');
});
