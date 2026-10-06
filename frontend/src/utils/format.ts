// Shared, honest formatting helpers: missing data renders as "—", never as a fake 0.

export const num = (v: unknown): number | null => {
  if (v === null || v === undefined || v === '') return null;
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : null;
};

export const fmtUsd = (v: unknown, digits = 2): string => {
  const n = num(v);
  if (n === null) return '—';
  const sign = n < 0 ? '-' : '';
  return `${sign}$${Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits })}`;
};

export const fmtPct = (v: unknown, digits = 2, withSign = true): string => {
  const n = num(v);
  if (n === null) return '—';
  return `${withSign && n > 0 ? '+' : ''}${n.toFixed(digits)}%`;
};

export const fmtPrice = (v: unknown): string => {
  const n = num(v);
  if (n === null) return '—';
  const digits = Math.abs(n) >= 1 ? 2 : Math.abs(n) >= 0.01 ? 4 : 8;
  return `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: digits })}`;
};

/**
 * Portfolio NAV. The backend has returned the total under different keys over time
 * (totalValue / totalEquity / combinedTotal). If none is > 0 but cash is, derive it
 * from cash + invested rather than showing $0.00.
 */
export function portfolioNav(p: any): number | null {
  if (!p || typeof p !== 'object') return null;
  for (const k of ['totalValue', 'totalEquity', 'combinedTotal']) {
    const n = num(p[k]);
    if (n !== null && n > 0) return n;
  }
  const cash = num(p.cashBalance) ?? 0;
  const invested = Math.max(0, portfolioInvested(p) ?? 0);
  if (cash > 0 || invested > 0) return cash + invested;
  return null;
}

/** Invested capital, never negative. */
export function portfolioInvested(p: any): number | null {
  if (!p || typeof p !== 'object') return null;
  for (const k of ['invested', 'investedCollateral', 'investedCapital']) {
    const n = num(p[k]);
    if (n !== null) return Math.max(0, n);
  }
  return null;
}

/** Broker equity from getLiveAccounts() — null when not connected / unknown. */
export function brokerEquity(live: any): number | null {
  const a = live?.alpaca;
  if (!a || !a.connected) return null;
  const n = num(a.portfolioValue);
  return n !== null && n > 0 ? n : null;
}
