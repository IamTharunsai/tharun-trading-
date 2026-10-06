// Helpers for agent-council decisions. The backend records a failed LLM call as a
// vote with finalReason 'Error' and confidence 0 — those are NOT real HOLD votes.

const reasonOf = (v: any): string =>
  String(v?.finalReason ?? v?.reasoning ?? v?.reason ?? v?.synthesis ?? '').trim();

export function isErrorVote(v: any): boolean {
  if (!v || typeof v !== 'object') return true;
  if (v.error || v.isError) return true;
  const r = reasonOf(v);
  if (/^error\b/i.test(r) || /provider error|llm (call )?failed|api error|rate limit|timed? ?out/i.test(r)) return true;
  const conf = Number(v.confidence);
  // A zero-confidence vote with no argument at all is a failed call, not an opinion.
  if ((!Number.isFinite(conf) || conf === 0) && !r && !String(v.openingArgument || '').trim()) return true;
  return false;
}

export interface DecisionVoteStats {
  buy: number; sell: number; hold: number;
  total: number; errors: number; valid: number;
  allErrors: boolean;
  avgConfidence: number | null; // from non-error votes only
}

export function decisionVoteStats(d: any): DecisionVoteStats {
  const votes: any[] = Array.isArray(d?.agentVotes) ? d.agentVotes : [];
  const good = votes.filter(v => !isErrorVote(v));
  const voteOf = (v: any) => String(v.finalVote || v.vote || '').toUpperCase();
  const confs = good.map(v => Number(v.confidence)).filter(n => Number.isFinite(n));
  return {
    buy: good.filter(v => voteOf(v) === 'BUY').length,
    sell: good.filter(v => voteOf(v) === 'SELL').length,
    hold: good.filter(v => voteOf(v) === 'HOLD').length,
    total: votes.length,
    errors: votes.length - good.length,
    valid: good.length,
    allErrors: votes.length > 0 && good.length === 0,
    avgConfidence: confs.length ? confs.reduce((a, b) => a + b, 0) / confs.length : null,
  };
}
