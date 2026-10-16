import { Router } from 'express';
import { requireOwner } from '../middleware/auth';
import { privateResponse } from '../middleware/privateResponse';
import { teamSessionRegistry } from '../services/teamSessions';

export const agentSessionsRouter = Router();
agentSessionsRouter.use(privateResponse, requireOwner);
agentSessionsRouter.get('/', (_req, res) => res.json(teamSessionRegistry.snapshot()));
