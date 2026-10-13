/**
 * Compatibility endpoint for the retired Money Greed executor.
 * Prediction research continues through the scheduled paper engine.
 * This module cannot start loops, contact a broker, or change a trade ledger.
 */
export const GREED_EXECUTION_UNAVAILABLE =
  'Legacy Greed execution is retired. Live prediction execution is not connected.';

export interface GreedAgentSnapshot {
  active: false;
  executionAvailable: false;
  executionMode: 'retired';
  executionReason: string;
  metricsAvailable: false;
}

/** Historical account state is unavailable here and requires reconciliation. */
export function getGreedAgentSnapshot(): GreedAgentSnapshot {
  return {
    active: false, executionAvailable: false, executionMode: 'retired',
    executionReason: GREED_EXECUTION_UNAVAILABLE, metricsAvailable: false,
  };
}

export async function activateGreedAgent(_greedMode = false): Promise<{
  ok: false; message: string; state: GreedAgentSnapshot;
}> {
  return { ok: false, message: GREED_EXECUTION_UNAVAILABLE, state: getGreedAgentSnapshot() };
}

export async function deactivateGreedAgent(): Promise<{ ok: true; state: GreedAgentSnapshot }> {
  return { ok: true, state: getGreedAgentSnapshot() };
}

export function getComplianceAuditLog() {
  return {
    available: false,
    executionAvailable: false,
    reason: 'Legacy execution is retired. Historical compliance evidence is unavailable here.',
  };
}