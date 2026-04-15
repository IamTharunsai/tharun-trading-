import { AgentVote, MarketSnapshot, PortfolioState, VotingResult, VoteDirection } from './types';

const MIN_VOTES_TO_EXECUTE = parseInt(process.env.MIN_VOTES_TO_EXECUTE || '7');
const MIN_CONFIDENCE = parseInt(process.env.MIN_AGENT_CONFIDENCE || '65');
const RISK_MANAGER_ID = 5;
const DEVILS_ADVOCATE_ID = 10;

export function runVotingEngine(
  snapshot: MarketSnapshot,
  votes: AgentVote[],
  portfolioState: PortfolioState
): VotingResult {

  const buyVotes = votes.filter(v => v.vote === 'BUY');
  const sellVotes = votes.filter(v => v.vote === 'SELL');
  const holdVotes = votes.filter(v => v.vote === 'HOLD');

  const avgConfidence = votes.reduce((sum, v) => sum + v.confidence, 0) / votes.length;

  // Determine dominant direction
  let proposedDirection: VoteDirection;
  let directionVotes: AgentVote[];

  if (buyVotes.length > sellVotes.length && buyVotes.length > holdVotes.length) {
    proposedDirection = 'BUY';
    directionVotes = buyVotes;
  } else if (sellVotes.length > buyVotes.length && sellVotes.length > holdVotes.length) {
    proposedDirection = 'SELL';
    directionVotes = sellVotes;
  } else {
    proposedDirection = 'HOLD';
    directionVotes = holdVotes;
  }

  const goVotes = directionVotes.length;
  const noGoVotes = votes.length - goVotes;

  // ── GUARDRAIL CHECKS ──────────────────────────────────────────────────────

  // 1. Risk Manager veto (Agent 5)
  const riskManagerVote = votes.find(v => v.agentId === RISK_MANAGER_ID);
  if (riskManagerVote?.vote === 'HOLD') {
    return {
      asset: snapshot.asset, finalDecision: 'HOLD',
      goVotes, noGoVotes, avgConfidence, shouldExecute: false,
      blockReason: `Risk Manager VETO: ${riskManagerVote.reasoning}`,
      agentVotes: votes, timestamp: Date.now()
    };
  }

  // 2. Devil's Advocate high-confidence block
  const devilVote = votes.find(v => v.agentId === DEVILS_ADVOCATE_ID);
  if (devilVote && devilVote.vote === 'HOLD' && devilVote.confidence >= 85) {
    return {
      asset: snapshot.asset, finalDecision: 'HOLD',
      goVotes, noGoVotes, avgConfidence, shouldExecute: false,
      blockReason: `Devil's Advocate high-confidence block (${devilVote.confidence}%): ${devilVote.reasoning}`,
      agentVotes: votes, timestamp: Date.now()
    };
  }

  // 3. Not enough GO votes
  if (proposedDirection === 'HOLD' || goVotes < MIN_VOTES_TO_EXECUTE) {
    return {
      asset: snapshot.asset, finalDecision: 'HOLD',
      goVotes, noGoVotes, avgConfidence, shouldExecute: false,
      blockReason: `Insufficient votes: ${goVotes}/${MIN_VOTES_TO_EXECUTE} required`,
      agentVotes: votes, timestamp: Date.now()
    };
  }

  // 4. Minimum confidence check
  if (avgConfidence < MIN_CONFIDENCE) {
    return {
      asset: snapshot.asset, finalDecision: 'HOLD',
      goVotes, noGoVotes, avgConfidence, shouldExecute: false,
      blockReason: `Average confidence too low: ${avgConfidence.toFixed(1)}% < ${MIN_CONFIDENCE}% required`,
      agentVotes: votes, timestamp: Date.now()
    };
  }

  // 5. Portfolio guardrails
  const maxTradesPerDay = parseInt(process.env.MAX_TRADES_PER_DAY || '50');
  if (portfolioState.tradesExecutedToday >= maxTradesPerDay) {
    return {
      asset: snapshot.asset, finalDecision: 'HOLD',
      goVotes, noGoVotes, avgConfidence, shouldExecute: false,
      blockReason: `Daily trade limit reached: ${portfolioState.tradesExecutedToday}/${maxTradesPerDay}`,
      agentVotes: votes, timestamp: Date.now()
    };
  }

  const dailyLossLimit = parseFloat(process.env.DAILY_LOSS_LIMIT_PCT || '5');
  if (portfolioState.pnlDayPct <= -dailyLossLimit) {
    return {
      asset: snapshot.asset, finalDecision: 'HOLD',
      goVotes, noGoVotes, avgConfidence, shouldExecute: false,
      blockReason: `Daily loss limit hit: ${portfolioState.pnlDayPct.toFixed(2)}% (limit: -${dailyLossLimit}%)`,
      agentVotes: votes, timestamp: Date.now()
    };
  }

  const maxDrawdown = parseFloat(process.env.MAX_DRAWDOWN_ALL_TIME_PCT || '20');
  if (portfolioState.drawdownFromPeak >= maxDrawdown) {
    return {
      asset: snapshot.asset, finalDecision: 'HOLD',
      goVotes, noGoVotes, avgConfidence, shouldExecute: false,
      blockReason: `Max drawdown limit hit: ${portfolioState.drawdownFromPeak.toFixed(2)}% (limit: ${maxDrawdown}%)`,
      agentVotes: votes, timestamp: Date.now()
    };
  }

  // ── ALL CHECKS PASSED — EXECUTE ───────────────────────────────────────────
  return {
    asset: snapshot.asset,
    finalDecision: proposedDirection,
    goVotes, noGoVotes, avgConfidence,
    shouldExecute: true,
    agentVotes: votes,
    timestamp: Date.now()
  };
}
