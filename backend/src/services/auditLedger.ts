/**
 * INTEGRATION: Vibe-Trading → APEX
 * Hash-Chained Audit Ledger
 *
 * Vibe-Trading ref: https://github.com/HKUDS/Vibe-Trading
 * APEX file location: backend/src/services/auditLedger.ts
 *
 * Every trade, agent decision, and portfolio change gets cryptographically
 * chained so you can prove the sequence was never tampered with.
 *
 * This is critical for: regulatory compliance, backtesting integrity,
 * proving to yourself that the AI didn't change its story after the fact.
 */

import { createHash } from 'crypto';
import { prisma } from '../utils/prisma';

export interface LedgerEntry {
  id: string;
  timestamp: Date;
  eventType: 'TRADE_OPEN' | 'TRADE_CLOSE' | 'AGENT_DECISION' | 'PORTFOLIO_SNAPSHOT' | 'RISK_VETO' | 'SYSTEM_EVENT';
  data: Record<string, unknown>;
  dataHash: string;    // SHA-256 of data
  prevHash: string;    // Hash of previous entry
  chainHash: string;   // SHA-256(dataHash + prevHash)
  sequence: number;
}

/**
 * Compute the chain hash for a new entry
 */
function computeChainHash(dataHash: string, prevHash: string): string {
  return createHash('sha256')
    .update(dataHash + prevHash)
    .digest('hex');
}

/**
 * Compute a deterministic hash of the event data
 */
function computeDataHash(data: Record<string, unknown>): string {
  const canonical = JSON.stringify(data, Object.keys(data).sort());
  return createHash('sha256').update(canonical).digest('hex');
}

/**
 * Append a new entry to the audit ledger
 * Automatically chains to the last entry
 */
export async function appendLedger(
  eventType: LedgerEntry['eventType'],
  data: Record<string, unknown>,
): Promise<LedgerEntry> {
  // Get the last entry to continue the chain
  const lastEntry = await prisma.auditLedger.findFirst({
    orderBy: { sequence: 'desc' },
  });

  const sequence = (lastEntry?.sequence ?? 0) + 1;
  const prevHash = lastEntry?.chainHash ?? '0'.repeat(64); // genesis

  const dataHash = computeDataHash({ ...data, eventType, sequence, timestamp: new Date().toISOString() });
  const chainHash = computeChainHash(dataHash, prevHash);

  const entry = await prisma.auditLedger.create({
    data: {
      eventType,
      data: data as any,
      dataHash,
      prevHash,
      chainHash,
      sequence,
      timestamp: new Date(),
    },
  });

  return entry as LedgerEntry;
}

/**
 * Verify the entire chain integrity — detect any tampering
 * Returns the number of entries verified, or throws on corruption
 */
export async function verifyChain(): Promise<{ valid: boolean; count: number; firstCorruptedSequence?: number }> {
  const entries = await prisma.auditLedger.findMany({
    orderBy: { sequence: 'asc' },
  });

  if (entries.length === 0) return { valid: true, count: 0 };

  let prevHash = '0'.repeat(64);

  for (const entry of entries) {
    // Recompute data hash
    const { eventType, sequence, timestamp, data } = entry as any;
    const expectedDataHash = computeDataHash({
      ...data,
      eventType,
      sequence,
      timestamp: timestamp.toISOString()
    });

    if (expectedDataHash !== entry.dataHash) {
      console.error(`[LEDGER] ❌ Data hash mismatch at sequence ${entry.sequence}`);
      return { valid: false, count: entry.sequence - 1, firstCorruptedSequence: entry.sequence };
    }

    // Verify chain hash
    const expectedChainHash = computeChainHash(entry.dataHash, prevHash);
    if (expectedChainHash !== entry.chainHash) {
      console.error(`[LEDGER] ❌ Chain broken at sequence ${entry.sequence}`);
      return { valid: false, count: entry.sequence - 1, firstCorruptedSequence: entry.sequence };
    }

    if (entry.prevHash !== prevHash) {
      console.error(`[LEDGER] ❌ Previous hash mismatch at sequence ${entry.sequence}`);
      return { valid: false, count: entry.sequence - 1, firstCorruptedSequence: entry.sequence };
    }

    prevHash = entry.chainHash;
  }

  console.log(`[LEDGER] ✅ Chain verified: ${entries.length} entries, all intact`);
  return { valid: true, count: entries.length };
}

/**
 * Get audit trail for a specific trade
 */
export async function getTradeAuditTrail(tradeId: string): Promise<LedgerEntry[]> {
  const entries = await prisma.auditLedger.findMany({
    where: {
      data: { path: ['tradeId'], equals: tradeId },
    },
    orderBy: { sequence: 'asc' },
  });
  return entries as LedgerEntry[];
}

/**
 * Helper: Log a trade open event
 */
export async function logTradeOpen(trade: {
  id: string; asset: string; type: string; entryPrice: number; quantity: number;
  stopLossPrice: number; takeProfitPrice: number; agentDecisionId?: string;
}) {
  return appendLedger('TRADE_OPEN', {
    tradeId: trade.id,
    asset: trade.asset,
    direction: trade.type,
    entryPrice: trade.entryPrice,
    quantity: trade.quantity,
    positionValue: trade.entryPrice * trade.quantity,
    stopLoss: trade.stopLossPrice,
    takeProfit: trade.takeProfitPrice,
    agentDecisionId: trade.agentDecisionId,
    riskRewardRatio: Math.abs((trade.takeProfitPrice - trade.entryPrice) / (trade.entryPrice - trade.stopLossPrice)),
  });
}

/**
 * Helper: Log a trade close event
 */
export async function logTradeClose(trade: {
  id: string; asset: string; exitPrice: number; pnl: number; pnlPct: number;
  exitReason: string; holdHours: number;
}) {
  return appendLedger('TRADE_CLOSE', {
    tradeId: trade.id,
    asset: trade.asset,
    exitPrice: trade.exitPrice,
    pnl: trade.pnl,
    pnlPct: trade.pnlPct,
    exitReason: trade.exitReason,
    holdHours: trade.holdHours,
    profitable: trade.pnl > 0,
  });
}

/**
 * Helper: Log an agent decision event
 */
export async function logAgentDecision(decision: {
  id: string; asset: string; finalVote: string; goVotes: number; noGoVotes: number;
  avgConfidence: number; executed: boolean; executionReason?: string;
}) {
  return appendLedger('AGENT_DECISION', {
    decisionId: decision.id,
    asset: decision.asset,
    finalVote: decision.finalVote,
    consensus: `${decision.goVotes}/${decision.goVotes + decision.noGoVotes}`,
    avgConfidence: decision.avgConfidence,
    executed: decision.executed,
    executionReason: decision.executionReason,
  });
}

/*
 * PRISMA SCHEMA — add this to schema.prisma:
 *
 * model AuditLedger {
 *   id          String   @id @default(cuid())
 *   sequence    Int      @unique
 *   timestamp   DateTime @default(now())
 *   eventType   String
 *   data        Json
 *   dataHash    String
 *   prevHash    String
 *   chainHash   String   @unique
 *
 *   @@index([eventType])
 *   @@index([sequence])
 * }
 */
