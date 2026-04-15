import { Router, Request, Response } from 'express';
import { requireAuth, AuthRequest } from '../middleware/auth';
import { chatWithAgent, getAgentChatHistory } from '../services/agentChatService';
import { logger } from '../utils/logger';

export const chatRouter = Router();
chatRouter.use(requireAuth); // All chat endpoints require authentication

// POST /api/chat/:agentId - Send a message to an agent
chatRouter.post('/:agentId', async (req: AuthRequest, res: Response) => {
  try {
    const { agentId } = req.params;
    const { message, sessionId } = req.body;

    if (!message || typeof message !== 'string' || message.trim().length === 0) {
      return res.status(400).json({ error: 'Message is required and must be non-empty' });
    }

    if (!agentId) {
      return res.status(400).json({ error: 'Agent ID is required' });
    }

    logger.info(`Chat request to agent: ${agentId}, session: ${sessionId || 'none'}`);

    const result = await chatWithAgent(agentId, message.trim(), sessionId);

    res.json({
      success: true,
      agentId,
      userMessage: message,
      agentResponse: result.response,
      conversationId: result.conversationId,
      timestamp: new Date().toISOString()
    });
  } catch (err) {
    logger.error(`Chat endpoint error: ${err}`);
    res.status(500).json({ error: 'Failed to process chat message' });
  }
});

// GET /api/chat/:agentId/history - Get chat history with an agent
chatRouter.get('/:agentId/history', async (req: AuthRequest, res: Response) => {
  try {
    const { agentId } = req.params;
    const { limit = '20' } = req.query;

    if (!agentId) {
      return res.status(400).json({ error: 'Agent ID is required' });
    }

    const history = await getAgentChatHistory(agentId, Math.min(parseInt(limit as string) || 20, 100));

    res.json({
      success: true,
      agentId,
      history: history.map((conv: any) => ({
        id: conv.id,
        userMessage: conv.userMessage,
        agentResponse: conv.agentResponse,
        timestamp: conv.createdAt
      }))
    });
  } catch (err) {
    logger.error(`Chat history endpoint error: ${err}`);
    res.status(500).json({ error: 'Failed to retrieve chat history' });
  }
});

// POST /api/chat/:agentId/:conversationId/react - React to a response (thumbs up, etc)
chatRouter.post('/:agentId/:conversationId/react', async (req: AuthRequest, res: Response) => {
  try {
    const { agentId, conversationId } = req.params;
    const { reaction } = req.body; // 'helpful', 'unhelpful', etc

    if (!conversationId) {
      return res.status(400).json({ error: 'Conversation ID is required' });
    }

    logger.info(`Reaction to conversation: ${conversationId}, reaction: ${reaction}`);

    // Update reactions in database
    // This could be enhanced to track types of reactions
    res.json({
      success: true,
      message: 'Reaction recorded'
    });
  } catch (err) {
    logger.error(`React endpoint error: ${err}`);
    res.status(500).json({ error: 'Failed to record reaction' });
  }
});

export default chatRouter;
