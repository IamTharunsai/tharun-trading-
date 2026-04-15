import { runAgent1Technician } from './agent1_technician';
import {
  runAgent2Newshound, runAgent3Sentiment, runAgent4Fundamental,
  runAgent5RiskManager, runAgent6TrendProphet, runAgent7VolumeDetective,
  runAgent8WhaleWatcher, runAgent9MacroEconomist, runAgent10DevilsAdvocate
} from './agents2to10';
import {
  runAgentElliotWaveMaster, runAgentOptionsFlow, runAgentPolymarketSpecialist,
  runAgentArbitrageur, runAgentMasterCoordinator
} from './agents11to15';
import { runVotingEngine } from './votingEngine';
import { AgentVote, MarketSnapshot, PortfolioState, VotingResult } from './types';
import { prisma } from '../utils/prisma';
import { logger } from '../utils/logger';
import { getIO } from '../websocket/server';

// Global kill switch state
let KILL_SWITCH_ACTIVE = false;

export function activateKillSwitch() {
  KILL_SWITCH_ACTIVE = true;
  logger.warn('🔴 KILL SWITCH ACTIVATED — All trading halted');
}

export function deactivateKillSwitch() {
  KILL_SWITCH_ACTIVE = false;
  logger.info('🟢 Kill switch deactivated — Trading resumed');
}

export function isKillSwitchActive() {
  return KILL_SWITCH_ACTIVE;
}

export async function runAgentCouncil(
  snapshot: MarketSnapshot,
  portfolioState: PortfolioState
): Promise<VotingResult | null> {

  if (KILL_SWITCH_ACTIVE) {
    logger.warn(`Council skipped for ${snapshot.asset} — kill switch active`);
    return null;
  }

  const councilStart = Date.now();
  logger.info(`🤖 Agent Council starting for ${snapshot.asset} @ $${snapshot.price}`);

  // Emit council start to dashboard
  const io = getIO();
  io?.emit('council:start', { asset: snapshot.asset, timestamp: Date.now() });

  try {
    // ── PHASE 1: Run agents 1-9 in parallel (30s timeout each) ─────────────
    const AGENT_TIMEOUT = 30000;

    const withTimeout = <T>(promise: Promise<T>, agentId: number, agentName: string): Promise<T> =>
      Promise.race([
        promise,
        new Promise<T>((_, reject) => setTimeout(() => reject(new Error(`Agent ${agentId} timeout`)), AGENT_TIMEOUT))
      ]).catch((err) => {
        logger.warn(`Agent ${agentId} (${agentName}) timed out or failed`, { error: err.message });
        return {
          agentId, agentName, vote: 'HOLD' as const, confidence: 0,
          reasoning: 'Agent timed out — defaulting to HOLD',
          keyFactors: ['Timeout'], riskWarnings: ['Analysis unavailable'],
          executionTime: AGENT_TIMEOUT, timestamp: Date.now()
        } as T;
      });

    // Emit agent status updates
    const emitAgentStatus = (agentId: number, status: 'analyzing' | 'voted', vote?: AgentVote) => {
      io?.emit('agent:status', { agentId, status, vote, asset: snapshot.asset });
    };

    // Run agents 1-10 in parallel
    // ── PHASE 1: Run agents 1-9 first ────────────────────────────────────────
    const phase1Results = (await Promise.all([
      withTimeout(runAgent1Technician(snapshot), 1, 'The Technician').then(v => { emitAgentStatus(1, 'voted', v as AgentVote); return v; }),
      withTimeout(runAgent2Newshound(snapshot), 2, 'The Newshound').then(v => { emitAgentStatus(2, 'voted', v as AgentVote); return v; }),
      withTimeout(runAgent3Sentiment(snapshot), 3, 'The Sentiment Analyst').then(v => { emitAgentStatus(3, 'voted', v as AgentVote); return v; }),
      withTimeout(runAgent4Fundamental(snapshot), 4, 'The Fundamental Analyst').then(v => { emitAgentStatus(4, 'voted', v as AgentVote); return v; }),
      withTimeout(runAgent5RiskManager(snapshot, portfolioState), 5, 'The Risk Manager').then(v => { emitAgentStatus(5, 'voted', v as AgentVote); return v; }),
      withTimeout(runAgent6TrendProphet(snapshot), 6, 'The Trend Prophet').then(v => { emitAgentStatus(6, 'voted', v as AgentVote); return v; }),
      withTimeout(runAgent7VolumeDetective(snapshot), 7, 'The Volume Detective').then(v => { emitAgentStatus(7, 'voted', v as AgentVote); return v; }),
      withTimeout(runAgent8WhaleWatcher(snapshot), 8, 'The Whale Watcher').then(v => { emitAgentStatus(8, 'voted', v as AgentVote); return v; }),
      withTimeout(runAgent9MacroEconomist(snapshot), 9, 'The Macro Economist').then(v => { emitAgentStatus(9, 'voted', v as AgentVote); return v; }),
    ])) as AgentVote[];

    // ── PHASE 1.5: Run agent 10 (Devil's Advocate) with phase 1 votes ───────
    const devilsAdvocateVote = await withTimeout(
      runAgent10DevilsAdvocate(snapshot, phase1Results), 
      10, 
      "The Devil's Advocate"
    ).then(v => { emitAgentStatus(10, 'voted', v as AgentVote); return v; }) as AgentVote;
    
    const allPhase1Votes = [...phase1Results, devilsAdvocateVote];

    // ── PHASE 2: Run agents 11-15 (new agents) ───────────────────────────
    const agent11 = await withTimeout(
      runAgentElliotWaveMaster(snapshot),
      11, 'The Elliott Wave Master'
    ) as AgentVote;
    emitAgentStatus(11, 'voted', agent11);

    const agent12 = await withTimeout(
      runAgentOptionsFlow(snapshot),
      12, 'The Options Flow Agent'
    ) as AgentVote;
    emitAgentStatus(12, 'voted', agent12);

    const agent13 = await withTimeout(
      runAgentPolymarketSpecialist(snapshot),
      13, 'The Polymarket Specialist'
    ) as AgentVote;
    emitAgentStatus(13, 'voted', agent13);

    const agent14 = await withTimeout(
      runAgentArbitrageur(snapshot),
      14, 'The Arbitrageur'
    ) as AgentVote;
    emitAgentStatus(14, 'voted', agent14);

    // Collect all votes for Master Coordinator
    const allVotesBeforeCoordinator = [...allPhase1Votes, agent11, agent12, agent13, agent14];

    const agent15 = await withTimeout(
      runAgentMasterCoordinator(snapshot, allVotesBeforeCoordinator),
      15, 'The Master Coordinator'
    ) as AgentVote;
    emitAgentStatus(15, 'voted', agent15);

    const allVotes = allVotesBeforeCoordinator.concat([agent15]);

    // ── PHASE 3: Voting Engine decides ────────────────────────────────────
    const result = runVotingEngine(snapshot, allVotes, portfolioState);
    const councilTime = Date.now() - councilStart;

    logger.info(`📊 Council complete for ${snapshot.asset} in ${councilTime}ms (15 agents)`, {
      decision: result.finalDecision,
      goVotes: result.goVotes,
      noGoVotes: result.noGoVotes,
      avgConfidence: result.avgConfidence.toFixed(1),
      execute: result.shouldExecute
    });

    // ── PHASE 4: Save decision to DB ──────────────────────────────────────
    try {
      await prisma.agentDecision.create({
        data: {
          asset: snapshot.asset,
          signal: result.finalDecision,
          finalVote: result.finalDecision,
          totalVotes: allVotes.length,
          goVotes: result.goVotes,
          noGoVotes: result.noGoVotes,
          avgConfidence: result.avgConfidence,
          executed: false,
          executionReason: result.blockReason || null,
          agentVotes: JSON.stringify(allVotes),
          marketSnapshot: JSON.stringify(snapshot),
        }
      });
    } catch (dbError) {
      logger.warn(`Failed to save agent decision to DB: ${String(dbError)}`);
    }

    // Emit council result to dashboard
    io?.emit('council:complete', { asset: snapshot.asset, result, councilTime });

    return result;

  } catch (error) {
    logger.error('Agent council catastrophic failure', { error, asset: snapshot.asset });
    io?.emit('council:error', { asset: snapshot.asset, error: String(error) });
    return null;
  }
}
