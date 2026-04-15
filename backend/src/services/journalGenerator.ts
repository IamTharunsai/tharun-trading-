import Anthropic from '@anthropic-ai/sdk';
import { prisma } from '../utils/prisma';
import { logger } from '../utils/logger';

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

export async function generateDailyJournal() {
  const today = new Date();
  const dateStr = today.toISOString().split('T')[0];
  today.setHours(0, 0, 0, 0);

  try {
    const [trades, decisions, snapshot] = await Promise.all([
      prisma.trade.findMany({ where: { openedAt: { gte: today } }, orderBy: { openedAt: 'desc' } }),
      prisma.agentDecision.findMany({ where: { timestamp: { gte: today } } }),
      prisma.portfolioSnapshot.findFirst({ orderBy: { timestamp: 'desc' } })
    ]);

    const closedTrades = trades.filter(t => t.status === 'CLOSED');
    const totalPnl = closedTrades.reduce((sum, t) => sum + (t.pnl || 0), 0);
    const bestTrade = closedTrades.sort((a, b) => (b.pnl || 0) - (a.pnl || 0))[0];
    const worstTrade = closedTrades.sort((a, b) => (a.pnl || 0) - (b.pnl || 0))[0];

    const prompt = `You are a professional trading journal writer for an autonomous AI trading system called APEX TRADER.

Write a comprehensive daily trading journal for ${dateStr}.

DATA:
- Total trades today: ${trades.length}
- Closed trades: ${closedTrades.length}
- Total P&L: $${totalPnl.toFixed(2)} (${snapshot ? ((totalPnl / snapshot.totalValue) * 100).toFixed(2) : '0'}%)
- Best trade: ${bestTrade ? `${bestTrade.asset} +$${bestTrade.pnl?.toFixed(2)}` : 'None'}
- Worst trade: ${worstTrade ? `${worstTrade.asset} $${worstTrade.pnl?.toFixed(2)}` : 'None'}
- Agent council decisions: ${decisions.length}
- Executed decisions: ${decisions.filter(d => d.executed).length}

Write a professional 2-3 paragraph journal entry covering:
1. Overall performance summary
2. Key trades and agent reasoning highlights
3. Market conditions and risk assessment
4. Lessons learned and tomorrow's outlook

Write in first person as if you are the AI trading system reporting to the owner.`;

    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 1000,
      messages: [{ role: 'user', content: prompt }]
    });

    const summary = response.content[0].type === 'text' ? response.content[0].text : 'Journal generation failed';

    await prisma.dailyJournal.upsert({
      where: { date: dateStr },
      create: {
        date: dateStr,
        summary,
        totalTrades: trades.length,
        pnlDay: totalPnl,
        pnlDayPct: snapshot ? (totalPnl / snapshot.totalValue) * 100 : 0,
        bestTrade: bestTrade ? JSON.parse(JSON.stringify({ asset: bestTrade.asset, pnl: bestTrade.pnl })) : undefined,
        worstTrade: worstTrade ? JSON.parse(JSON.stringify({ asset: worstTrade.asset, pnl: worstTrade.pnl })) : undefined,
      },
      update: { summary, totalTrades: trades.length, pnlDay: totalPnl }
    });

    logger.info(`📓 Daily journal generated for ${dateStr}`);
  } catch (error) {
    logger.error('Journal generation failed', { error });
  }
}
