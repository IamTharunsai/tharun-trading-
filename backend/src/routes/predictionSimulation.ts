import { Request, Response } from 'express';
import { prisma } from '../utils/prisma';

export const listPredictionSimulations = async (req: Request, res: Response) => {
  const page = Number(req.query.page ?? 1);
  if (!Number.isSafeInteger(page) || page < 1 || page > 10000) return res.status(400).json({ error: 'Invalid simulation page' });
  try {
    const where = { asset: 'POLYMARKET', status: 'LOCAL_SIMULATION' as const };
    const [simulations, total] = await Promise.all([
      prisma.trade.findMany({ where, skip: (page - 1) * 50, take: 50, orderBy: [{ openedAt: 'desc' }, { id: 'desc' }], select: { id: true, market: true, type: true, entryPrice: true, quantity: true, status: true, metadata: true, openedAt: true } }),
      prisma.trade.count({ where }),
    ]);
    return res.json({ simulations, total, page, pages: Math.ceil(total / 50), executionMode: 'LOCAL_SIMULATION', brokerSubmitted: false });
  } catch { return res.status(503).json({ error: 'Simulation ledger unavailable' }); }
};

export const recordPredictionSimulation = async (req: Request, res: Response) => {
  try {
    const { predictionId, outcome = 'YES', amount = 10 } = req.body || {};
    if (typeof predictionId !== 'string' || !predictionId.trim() || (outcome !== 'YES' && outcome !== 'NO') || typeof amount !== 'number' || !Number.isFinite(amount) || amount <= 0) {
      return res.status(400).json({ error: 'Valid prediction, YES/NO outcome and positive finite amount are required' });
    }
    const pred = await prisma.prediction.findUnique({ where: { id: predictionId } });
    if (!pred) return res.status(404).json({ error: 'Prediction market not found' });

    const price = outcome === 'YES' ? pred.yesPrice : pred.noPrice;
    if (typeof price !== 'number' || !Number.isFinite(price) || price <= 0 || price >= 1) return res.status(400).json({ error: 'Prediction has no valid price for that outcome' });
    const shares = amount / price;
    if (!Number.isFinite(shares) || shares <= 0) return res.status(400).json({ error: 'Invalid simulated share quantity' });

    const trade = await prisma.trade.create({
      data: {
        id: `poly-wager-${Date.now()}`,
        asset: 'POLYMARKET',
        market: 'polymarket',
        type: outcome === 'YES' ? 'BUY' : 'SELL',
        entryPrice: price,
        quantity: shares,
        status: 'LOCAL_SIMULATION',
        stopLossPrice: 0,
        takeProfitPrice: 1, // share-based accounting marker (see polymarket.ts)
        metadata: {
          title: pred.title,
          predictionId: pred.id,
          expectedValue: pred.expectedValue,
          kellyFraction: pred.kellyFraction,
          wagerUsd: amount,
          outcome,
          executionMode: 'LOCAL_SIMULATION', venue: 'INTERNATIONAL_RESEARCH', brokerSubmitted: false
        }
      }
    });

    res.json({
      success: true,
      trade,
      executionMode: 'LOCAL_SIMULATION',
      brokerSubmitted: false,
      message: `Local simulation recorded: $${amount.toFixed(2)} on ${outcome}. No broker order was submitted.`
    });
  } catch {
    res.status(500).json({ error: 'Simulation could not be recorded' });
  }
};
