// Only enumerated internal reasons may enter production diagnostics. Never log
// provider messages, account identifiers, symbols, prompts or financial values.
const reasons = new Set([
  'BROKER_INVENTORY_AND_EXECUTION_LOTS_DISAGREE', 'POSITION_ACCOUNT_UNVERIFIED',
  'POSITION_SIDE_OR_QUANTITY_UNVERIFIED', 'EXIT_ORDER_UNAVAILABLE', 'EXIT_IDENTITY_UNAVAILABLE',
  'OPEN_ORDER_SCAN_BOUND_EXCEEDED', 'OPENING_ORDER_FILL_REQUIRES_ENTRY_RECONCILIATION',
  'REPLACEMENT_ACTIVITY_INTERVAL_UNAVAILABLE', 'REPLACEMENT_FILL_ACTIVITIES_PENDING',
  'REPLACEMENT_FILL_ACTIVITY_INVALID', 'RISK_HISTORY_UNAVAILABLE', 'RISK_VALUATION_STALE',
  'OPENING_EQUITY_UNAVAILABLE', 'NORMALIZED_PEAK_UNAVAILABLE', 'CAPITAL_COVERAGE_UNAVAILABLE',
  'CAPITAL_ACTIVITY_COVERAGE_UNAVAILABLE', 'CAPITAL_ACTIVITY_HISTORY_MISMATCH',
  'CAPITAL_EFFECTIVE_DATE_UNAVAILABLE', 'CAPITAL_EVIDENCE_UNAVAILABLE',
  'EXTERNAL_CAPITAL_AMOUNT_UNAVAILABLE', 'FUNDED_RISK_REFERENCE_UNAVAILABLE',
  'INVALID_CAPITAL_ACTIVITY', 'INVALID_CASHFLOW_ARRAYS', 'INVALID_EXTERNAL_CAPITAL_SIGN',
  'INVALID_RISK_EQUITY', 'INVALID_RISK_HISTORY', 'INVALID_RISK_TIMESTAMPS',
  'RISK_ACCOUNT_AUTHORITY_UNAVAILABLE', 'RISK_BACKFILL_BOUND_EXCEEDED', 'RISK_HISTORY_COVERAGE_GAP',
  'UNKNOWN_CAPITAL_EFFECT', 'UNKNOWN_JOURNAL_OR_SECURITY_CAPITAL_EFFECT', 'UNSUPPORTED_CAPITAL_CURRENCY',
]);
export function operatingReason(value: unknown): string {
  if (typeof value === 'string' && reasons.has(value)) return value;
  return 'OTHER_EVIDENCE_FAILURE';
}
export function operatingError(error: unknown): string {
  const e = error as { code?: unknown; message?: unknown; status?: unknown; response?: { status?: unknown } } | null;
  if (e?.code === 'ECONNABORTED' || e?.code === 'ETIMEDOUT' || e?.code === 'ERR_CANCELED') return 'TRANSPORT_TIMEOUT_OR_CANCEL';
  const status = e?.status ?? e?.response?.status;
  if (typeof status === 'number' && Number.isInteger(status) && status >= 400 && status < 600) return `HTTP_${Math.floor(status / 100)}XX`;
  return operatingReason(e?.message);
}
