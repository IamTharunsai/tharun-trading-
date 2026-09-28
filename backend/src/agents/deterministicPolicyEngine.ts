import crypto from 'crypto';
import { logger } from '../utils/logger';
import { appConfig } from '../utils/config';

export interface AgentEvaluationOutput {
  role: string;
  inputSnapshotId: string;
  dataProvenance: string;
  providerTimestamp: string;
  dataQuality: 'PRISTINE' | 'ADEQUATE' | 'DEGRADED';
  modelName: string;
  modelVersion: string;
  promptVersion?: string;
  vote: 'APPROVE' | 'REJECT' | 'ABSTAIN';
  confidence: number;            // 0 to 100
  calibrationEvidence: string;
  reasons: string[];
  counterarguments: string[];
  failureState: boolean;
  tokenCost: number;
  monetaryCost: number;
  runtimeMs: number;
}

export interface GovernancePolicyResult {
  approved: boolean;
  deterministicVetoTriggered: boolean;
  vetoReason?: string;
  aggregateConfidence: number;
  totalVotes: number;
  approvals: number;
  rejections: number;
  agentEvaluations: AgentEvaluationOutput[];
  evaluationTimestamp: string;
  totalTokenCost: number;
  totalMonetaryCost: number;
}

export class DeterministicPolicyEngine {
  /**
   * Final deterministic decision gatekeeper.
   * LLMs or AI agents can provide analytical reasoning, but DETERMINISTIC CODE
   * has absolute final authority and CANNOT be overridden by agent votes.
   */
  static evaluateGovernance(
    symbol: string,
    market: 'stocks' | 'crypto' | 'polymarket',
    agentEvaluations: AgentEvaluationOutput[],
    hardRiskConstraints: {
      killSwitchActive: boolean;
      dailyDrawdownPct: number;
      maxDrawdownLimitPct: number;
      spreadBps: number;
      maxSpreadBpsLimit: number;
      isTradableOnAlpaca: boolean;
      buyingPowerUSD: number;
      requiredOrderCostUSD: number;
    }
  ): GovernancePolicyResult {
    const timestamp = new Date().toISOString();
    let totalTokenCost = 0;
    let totalMonetaryCost = 0;
    let approvals = 0;
    let rejections = 0;
    let confidenceSum = 0;

    for (const agent of agentEvaluations) {
      totalTokenCost += agent.tokenCost || 0;
      totalMonetaryCost += agent.monetaryCost || 0;
      if (agent.vote === 'APPROVE') approvals++;
      else if (agent.vote === 'REJECT') rejections++;
      confidenceSum += agent.confidence;
    }

    const totalVotes = approvals + rejections;
    const aggregateConfidence = totalVotes > 0 ? parseFloat((confidenceSum / agentEvaluations.length).toFixed(1)) : 0;

    // ── DETERMINISTIC HARD RISK GATES (Non-bypassable by any LLM or Agent) ───

    // Rule 1: Emergency Kill Switch
    if (hardRiskConstraints.killSwitchActive) {
      return {
        approved: false,
        deterministicVetoTriggered: true,
        vetoReason: 'HARD VETO: System emergency kill-switch is active',
        aggregateConfidence,
        totalVotes,
        approvals,
        rejections,
        agentEvaluations,
        evaluationTimestamp: timestamp,
        totalTokenCost,
        totalMonetaryCost
      };
    }

    // Rule 2: Daily drawdown circuit breaker
    if (hardRiskConstraints.dailyDrawdownPct <= -Math.abs(hardRiskConstraints.maxDrawdownLimitPct)) {
      return {
        approved: false,
        deterministicVetoTriggered: true,
        vetoReason: `HARD VETO: Daily drawdown circuit breaker tripped (${hardRiskConstraints.dailyDrawdownPct.toFixed(2)}% <= -${hardRiskConstraints.maxDrawdownLimitPct}%)`,
        aggregateConfidence,
        totalVotes,
        approvals,
        rejections,
        agentEvaluations,
        evaluationTimestamp: timestamp,
        totalTokenCost,
        totalMonetaryCost
      };
    }

    // Rule 3: Execution tradability
    if (market === 'stocks' && !hardRiskConstraints.isTradableOnAlpaca) {
      return {
        approved: false,
        deterministicVetoTriggered: true,
        vetoReason: `HARD VETO: Symbol ${symbol} is not verified as execution-eligible on Alpaca`,
        aggregateConfidence,
        totalVotes,
        approvals,
        rejections,
        agentEvaluations,
        evaluationTimestamp: timestamp,
        totalTokenCost,
        totalMonetaryCost
      };
    }

    // Rule 4: Buying power check
    if (hardRiskConstraints.requiredOrderCostUSD > hardRiskConstraints.buyingPowerUSD) {
      return {
        approved: false,
        deterministicVetoTriggered: true,
        vetoReason: `HARD VETO: Insufficient buying power (requires $${hardRiskConstraints.requiredOrderCostUSD.toFixed(2)}, available $${hardRiskConstraints.buyingPowerUSD.toFixed(2)})`,
        aggregateConfidence,
        totalVotes,
        approvals,
        rejections,
        agentEvaluations,
        evaluationTimestamp: timestamp,
        totalTokenCost,
        totalMonetaryCost
      };
    }

    // Rule 5: Excessive market spread
    if (hardRiskConstraints.spreadBps > hardRiskConstraints.maxSpreadBpsLimit) {
      return {
        approved: false,
        deterministicVetoTriggered: true,
        vetoReason: `HARD VETO: Bid/Ask spread ${hardRiskConstraints.spreadBps} bps exceeds maximum limit of ${hardRiskConstraints.maxSpreadBpsLimit} bps`,
        aggregateConfidence,
        totalVotes,
        approvals,
        rejections,
        agentEvaluations,
        evaluationTimestamp: timestamp,
        totalTokenCost,
        totalMonetaryCost
      };
    }

    // Rule 6: Adversarial thesis veto check
    const riskVetoAgent = agentEvaluations.find(a => a.role === 'Risk Veto Agent');
    if (riskVetoAgent && riskVetoAgent.vote === 'REJECT') {
      return {
        approved: false,
        deterministicVetoTriggered: true,
        vetoReason: `AGENT VETO: Risk Veto Agent rejected proposal: ${riskVetoAgent.reasons.join(', ')}`,
        aggregateConfidence,
        totalVotes,
        approvals,
        rejections,
        agentEvaluations,
        evaluationTimestamp: timestamp,
        totalTokenCost,
        totalMonetaryCost
      };
    }

    // Consensus rule: At least 70% approval and minimum 65 confidence
    const consensusRatio = totalVotes > 0 ? approvals / totalVotes : 0;
    const approved = consensusRatio >= 0.70 && aggregateConfidence >= 65;

    return {
      approved,
      deterministicVetoTriggered: false,
      aggregateConfidence,
      totalVotes,
      approvals,
      rejections,
      agentEvaluations,
      evaluationTimestamp: timestamp,
      totalTokenCost,
      totalMonetaryCost
    };
  }
}
