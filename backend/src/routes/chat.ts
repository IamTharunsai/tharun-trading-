import Anthropic from '@anthropic-ai/sdk';
import { Router, Request, Response } from 'express';
import { requireAuth, AuthRequest } from '../middleware/auth';
import { prisma } from '../utils/prisma';
import { logger } from '../utils/logger';
import { buildMarketSnapshot } from '../services/marketData';
import { getPortfolioState } from '../services/portfolio';

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

export const chatRouter = Router();
chatRouter.use(requireAuth);

const AGENT_CHAT_PROMPTS: Record<number, string> = {
  1: `You are THE TECHNICIAN — master technical analyst with 25 years experience.`,
  2: `You are THE NEWSHOUND — elite news specialist who understands market-moving events.`,
  3: `You are THE SENTIMENT ANALYST — behavioral finance expert understanding crowd psychology.`,
  4: `You are THE FUNDAMENTAL ANALYST — CFA charterholder focused on intrinsic value.`,
  5: `You are THE RISK MANAGER — guardian of capital with absolute veto power.`,
  6: `You are THE TREND PROPHET — quantitative forecaster using AI pattern recognition.`,
  7: `You are THE VOLUME DETECTIVE — market microstructure expert understanding order flow.`,
  8: `You are THE WHALE WATCHER — tracking institutional money and smart money moves.`,
  9: `You are THE MACRO ECONOMIST — understanding global forces and policy impacts.`,
  10: `You are THE DEVIL'S ADVOCATE — professional skeptic finding flaws in every thesis.`
};

chatRouter.post('/:agentId', async (req: AuthRequest, res: Response) => {
  const agentId = parseInt(req.params.agentId);
  const { message, conversationHistory = [], asset } = req.body;

  if (!message || !agentId || agentId < 1 || agentId > 10) {
    return res.status(400).json({ error: 'Invalid agent ID or message' });
  }

  const systemPrompt = AGENT_CHAT_PROMPTS[agentId];
  if (!systemPrompt) return res.status(404).json({ error: 'Agent not found' });

  try {
    let contextAddition = '';
    if (asset) {
      try {
        const snapshot = await buildMarketSnapshot(asset, 'crypto');
        if (snapshot) {
          contextAddition = `\n\nCURRENT ${asset}:\nPrice: $${snapshot.price.toFixed(2)} | 24h: ${snapshot.priceChangePct24h.toFixed(2)}%\nRSI: ${snapshot.indicators.rsi14.toFixed(1)}`;
        }
      } catch (_) {}
    }

    try {
      const portfolio = await getPortfolioState();
      contextAddition += `\n\nPORTFOLIO:\nValue: $${portfolio.totalValue.toFixed(2)} | P&L: ${portfolio.pnlDayPct.toFixed(2)}%`;
    } catch (_) {}

    const messages: any[] = [
      ...conversationHistory.slice(-10).map((m: any) => ({
        role: m.role as 'user' | 'assistant',
        content: m.content
      })),
      { role: 'user', content: message }
    ];

    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 800,
      system: systemPrompt + contextAddition,
      messages
    });

    const reply = response.content[0].type === 'text' ? response.content[0].text : 'Unable to respond.';

    await prisma.systemLog.create({
      data: {
        level: 'INFO',
        service: `agent-chat-${agentId}`,
        message: `Chat`,
        metadata: { agentId, message, reply, asset, timestamp: new Date().toISOString() } as any
      }
    });

    return res.json({
      agentId,
      agentName: getAgentName(agentId),
      agentIcon: getAgentIcon(agentId),
      reply,
      timestamp: new Date().toISOString()
    });

  } catch (error: any) {
    logger.error('Agent chat failed', { error: error.message, agentId });
    return res.status(500).json({ error: 'Agent chat failed' });
  }
});

chatRouter.get('/:agentId/history', async (req: AuthRequest, res: Response) => {
  const agentId = parseInt(req.params.agentId);
  try {
    const history = await prisma.systemLog.findMany({
      where: { service: `agent-chat-${agentId}` },
      orderBy: { timestamp: 'desc' },
      take: 50
    });
    return res.json(history.map(h => ({ id: h.id, timestamp: h.timestamp, ...(h.metadata as any) })));
  } catch (error) {
    return res.status(500).json({ error: 'Failed to load history' });
  }
});

function getAgentName(id: number): string {
  const names: Record<number, string> = {
    1: 'The Technician', 2: 'The Newshound', 3: 'The Sentiment Analyst',
    4: 'The Fundamental Analyst', 5: 'The Risk Manager', 6: 'The Trend Prophet',
    7: 'The Volume Detective', 8: 'The Whale Watcher', 9: 'The Macro Economist',
    10: "The Devil's Advocate"
  };
  return names[id] || `Agent ${id}`;
}

function getAgentIcon(id: number): string {
  const icons: Record<number, string> = {
    1: '📊', 2: '📰', 3: '🧠', 4: '📈', 5: '🛡️',
    6: '🔮', 7: '🔍', 8: '🐋', 9: '🌍', 10: '😈'
  };
  return icons[id] || '🤖';
}

export default chatRouter;
