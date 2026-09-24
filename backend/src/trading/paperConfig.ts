export const PAPER_ALPACA_URL = 'https://paper-api.alpaca.markets';

/** This deployment is explicitly paper-only, including when configuration is missing. */
export function assertPaperTrading(): void {
  const mode = process.env.TRADING_MODE?.trim().toLowerCase() || 'paper';
  if (mode !== 'paper') throw new Error('This deployment supports paper trading only');
  const configuredUrl = process.env.ALPACA_BASE_URL?.replace(/\/$/, '');
  if (configuredUrl && configuredUrl !== PAPER_ALPACA_URL) {
    throw new Error('ALPACA_BASE_URL must point to the Alpaca paper endpoint');
  }
}
