// Honest trade classification helpers shared by Trades, Analytics and dashboard widgets.

export type Outcome = 'WIN' | 'LOSS' | 'FLAT' | 'OPEN' | 'PENDING' | 'REJECTED';

/** Outcome from real fields only — a broker rejection is never a WIN. */
export function tradeOutcome(t: any): Outcome {
  const status = String(t?.status || '').toUpperCase();
  const reason = String(t?.exitReason || '').toLowerCase();
  if (['REJECTED', 'FAILED', 'CANCELLED', 'CANCELED'].includes(status) || /broker rejected|rejected|failed to (submit|place)/.test(reason)) return 'REJECTED';
  if (status === 'OPEN') return 'OPEN';
  if (status === 'CLOSED') {
    const pnl = Number(t?.pnl);
    if (!Number.isFinite(pnl) || pnl === 0) return 'FLAT';
    return pnl > 0 ? 'WIN' : 'LOSS';
  }
  return 'PENDING';
}

export const OUTCOME_CLS: Record<Outcome, string> = {
  WIN: 'bg-emerald-50 text-emerald-700 border border-emerald-200',
  LOSS: 'bg-red-50 text-red-700 border border-red-200',
  FLAT: 'bg-slate-100 text-slate-600 border border-slate-200',
  OPEN: 'bg-amber-50 text-amber-700 border border-amber-200',
  PENDING: 'bg-slate-100 text-slate-500 border border-slate-200',
  REJECTED: 'bg-slate-100 text-slate-500 border border-slate-300',
};

export const tradeMeta = (t: any): any => {
  if (!t?.metadata) return {};
  if (typeof t.metadata === 'string') { try { return JSON.parse(t.metadata) || {}; } catch { return {}; } }
  return typeof t.metadata === 'object' ? t.metadata : {};
};

/** Human label for the asset — Polymarket rows show the market question when we have it. */
export function tradeAssetLabel(t: any): string {
  const m = tradeMeta(t);
  const isPoly = String(t?.market || '').toLowerCase() === 'polymarket' || String(t?.asset || '').toUpperCase() === 'POLYMARKET';
  if (isPoly) {
    const q = m.question || m.title || m.marketTitle || m.marketQuestion || t?.agentDecision?.marketSnapshot?.question;
    if (q) return String(q);
    const r = String(t?.reasoning || t?.entryReason || '');
    const match = r.match(/["“](.{8,160}?)["”]/);
    if (match) return match[1];
  }
  return String(t?.asset || '—');
}

