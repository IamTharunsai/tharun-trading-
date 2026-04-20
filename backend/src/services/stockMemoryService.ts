import { prisma } from '../utils/prisma';
import { logger } from '../utils/logger';

// ── UPDATE STOCK MEMORY AFTER TRADE CLOSES ───────────────────────────────────
export async function updateStockMemory(
  symbol: string,
  outcome: 'WIN' | 'LOSS' | 'BREAKEVEN',
  pnlPct: number,
  holdHours: number,
  setup: string,
  lesson: string,
  agentVote: string
): Promise<void> {
  try {
    const existing = await prisma.stockMemory.findUnique({ where: { symbol } });

    if (!existing) {
      await prisma.stockMemory.create({
        data: {
          symbol,
          totalTrades: 1,
          totalDebates: 1,
          wins: outcome === 'WIN' ? 1 : 0,
          losses: outcome === 'LOSS' ? 1 : 0,
          winRate: outcome === 'WIN' ? 100 : 0,
          avgPnlPct: pnlPct,
          avgHoldHours: holdHours,
          lastTradeOutcome: outcome,
          lastDebateVote: agentVote,
          keyLessons: [lesson],
          bestSetup: outcome === 'WIN' ? setup : undefined,
          worstSetup: outcome === 'LOSS' ? setup : undefined,
        }
      });
      return;
    }

    const newTotal = existing.totalTrades + 1;
    const newWins = existing.wins + (outcome === 'WIN' ? 1 : 0);
    const newLosses = existing.losses + (outcome === 'LOSS' ? 1 : 0);
    const newWinRate = (newWins / newTotal) * 100;
    const newAvgPnl = ((existing.avgPnlPct * existing.totalTrades) + pnlPct) / newTotal;
    const newAvgHold = ((existing.avgHoldHours * existing.totalTrades) + holdHours) / newTotal;

    const lessons = [...existing.keyLessons, lesson].slice(-10); // keep last 10

    await prisma.stockMemory.update({
      where: { symbol },
      data: {
        totalTrades: newTotal,
        totalDebates: existing.totalDebates + 1,
        wins: newWins,
        losses: newLosses,
        winRate: newWinRate,
        avgPnlPct: newAvgPnl,
        avgHoldHours: newAvgHold,
        lastTradeOutcome: outcome,
        lastDebateVote: agentVote,
        keyLessons: lessons,
        bestSetup: outcome === 'WIN' && pnlPct > (existing.avgPnlPct || 0) ? setup : existing.bestSetup,
        worstSetup: outcome === 'LOSS' && pnlPct < (existing.avgPnlPct || 0) ? setup : existing.worstSetup,
        lastUpdated: new Date(),
      }
    });

    logger.info(`🧠 Stock memory updated: ${symbol} | Win rate: ${newWinRate.toFixed(1)}% | Trades: ${newTotal}`);
  } catch (err) {
    logger.warn(`Stock memory update failed for ${symbol}`, { err });
  }
}

// ── GET STOCK MEMORY SUMMARY FOR AGENT PROMPT ────────────────────────────────
export async function getStockMemorySummary(symbol: string): Promise<string> {
  try {
    const mem = await prisma.stockMemory.findUnique({ where: { symbol } });
    if (!mem || mem.totalTrades === 0) return `No trading history for ${symbol} yet — first analysis.`;

    const lines = [
      `Past trades: ${mem.totalTrades} | Win rate: ${mem.winRate.toFixed(1)}% | Avg P&L: ${mem.avgPnlPct.toFixed(2)}%`,
      `Avg hold: ${mem.avgHoldHours.toFixed(1)} hours`,
    ];
    if (mem.lastTradeOutcome) lines.push(`Last trade: ${mem.lastTradeOutcome}`);
    if (mem.bestSetup) lines.push(`Best setup: ${mem.bestSetup}`);
    if (mem.worstSetup) lines.push(`Avoid: ${mem.worstSetup}`);
    if (mem.keyLessons.length > 0) lines.push(`Key lessons: ${mem.keyLessons.slice(-3).join('; ')}`);

    return lines.join(' | ');
  } catch {
    return `No trading history for ${symbol} yet.`;
  }
}

// ── INCREMENT DEBATE COUNT ────────────────────────────────────────────────────
export async function recordDebate(symbol: string, vote: string): Promise<void> {
  try {
    await prisma.stockMemory.upsert({
      where: { symbol },
      update: { totalDebates: { increment: 1 }, lastDebateVote: vote, lastUpdated: new Date() },
      create: { symbol, totalDebates: 1, lastDebateVote: vote }
    });
  } catch { /* silent */ }
}
