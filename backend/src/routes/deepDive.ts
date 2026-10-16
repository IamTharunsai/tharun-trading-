import { Router, Response } from 'express';
import rateLimit from 'express-rate-limit';
import { AuthRequest, requireOwner } from '../middleware/auth';
import { privateResponse } from '../middleware/privateResponse';
import { DeepDiveUnavailable, parseDeepDiveInput, runGroundedDeepDive } from '../services/groundedDeepDive';

export const deepDiveRouter = Router();
deepDiveRouter.use(privateResponse, requireOwner);
// express-rate-limit v7: https://express-rate-limit.mintlify.app/reference/configuration#limit
// Process-local abuse cap, not a persistent account-wide provider spending ledger.
const limiter = rateLimit({ windowMs: 15 * 60_000, limit: 5, standardHeaders: true, legacyHeaders: false,
  keyGenerator: (req: AuthRequest) => req.userId!, message: { error: 'research_rate_limited' } });
let active = false;
deepDiveRouter.post('/', limiter, async (req: AuthRequest, res: Response) => {
  const input = parseDeepDiveInput(req.body);
  if (!input) return res.status(400).json({ error: 'invalid_research_input' });
  if (active) return res.status(429).json({ error: 'research_busy' });
  active = true;
  // One deadline includes market loading and the existing provider fallback chain.
  // Node >=20: https://nodejs.org/docs/latest-v20.x/api/globals.html#static-method-abortsignaltimeoutdelay
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 45_000);
  const disconnect = () => { if (!res.writableEnded) controller.abort(); };
  res.once('close', disconnect);
  try {
    const result = await runGroundedDeepDive(input, controller.signal);
    if (!controller.signal.aborted) return res.json(result);
    if (!res.destroyed) return res.status(503).json({ error: 'research_unavailable' });
  } catch (error) {
    if (!res.destroyed) return res.status(503).json({ error: error instanceof DeepDiveUnavailable ? error.code : 'research_unavailable' });
  } finally {
    clearTimeout(timeout); res.removeListener('close', disconnect); active = false;
  }
});
