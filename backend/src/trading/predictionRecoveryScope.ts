/** This barrier preserves a local grant binding. It does not discover, invent
 * or certify exchange account identity, nor authorize a financial operation. */
export async function ensurePredictionRecoveryScope(tx: any, ownerId: string, scopeKey: string) {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${'prediction-owner:' + ownerId}))`;
  let state = await tx.predictionRecoveryState.findUnique({ where: { ownerId } });
  if (!state) {
    const previous = await tx.predictionExecution.findMany({ where: { ownerId },
      select: { credentialScopeKey: true }, distinct: ['credentialScopeKey'], take: 2 });
    const boundCredentialScopeKey = previous.length === 0 ? scopeKey
      : previous.length === 1 ? previous[0].credentialScopeKey : null;
    state = await tx.predictionRecoveryState.create({ data: { ownerId, boundCredentialScopeKey } });
  }
  const reason = state.boundCredentialScopeKey === null ? 'HISTORICAL_GRANTS_AMBIGUOUS'
    : state.boundCredentialScopeKey !== scopeKey ? 'GRANT_ROTATION_REQUIRES_REVIEW' : null;
  return { state, allowed: reason === null, reason };
}

export async function assertPredictionRecoveryScope(tx: any, ownerId: string, scopeKey: string) {
  const result = await ensurePredictionRecoveryScope(tx, ownerId, scopeKey);
  if (!result.allowed) throw new Error(result.reason!);
  // Preserve unresolved reservations from another grant even if the historical
  // binding was imported incorrectly. Never look only at the current hash.
  const other = await tx.predictionExecution.findFirst({ where: { ownerId,
    credentialScopeKey: { not: scopeKey }, status: { in: [
      'PREPARING', 'SUBMITTING', 'SUBMITTED', 'PARTIALLY_FILLED', 'RECONCILIATION_REQUIRED',
    ] } } });
  if (other) throw new Error('OTHER_GRANT_REQUIRES_RECONCILIATION');
  // Local reduction proceeds are not account-wide loss/settlement coverage.
  // Do not let a newly zero broker position erase the retained opening basis
  // or make a closed position look like a loss-free account for another entry.
  const reduction = await tx.predictionReduction.findFirst({ where: { ownerId, OR: [
    { status: { notIn: ['ABORTED', 'TERMINAL'] } },
    { appliedQuantity: { not: 0 } }, { appliedProceeds: { not: 0 } },
    { status: 'TERMINAL', OR: [{ appliedFees: null }, { appliedFees: { not: 0 } }, { terminalObserved: false }] },
  ] } });
  if (reduction) throw new Error('REDUCTION_LOSS_COVERAGE_REQUIRES_RECONCILIATION');
}
