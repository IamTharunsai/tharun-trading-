export interface DashboardEvidenceResponse {
  json(body: unknown): unknown;
  status(code: number): { json(body: unknown): unknown };
}

/** Express 4 does not forward rejected async handlers. Keep lazy imports inside this boundary. */
export async function respondWithDashboardEvidence(res: DashboardEvidenceResponse, load: () => Promise<unknown>, feed: 'market' | 'crypto' = 'market'): Promise<void> {
  try {
    res.json(await load());
  } catch {
    const source = feed === 'crypto' ? { source: 'CoinGecko' } : {};
    res.status(503).json({ error: feed === 'crypto' ? 'crypto_feed_unavailable' : 'market_feed_unavailable',
      ...source, observedAt: null, receivedAt: new Date().toISOString() });
  }
}
