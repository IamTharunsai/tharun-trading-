import { isCryptoSymbol } from '../constants/assets';
import type { SymbolMarket } from '../hooks/useDefaultSymbol';

/** Syntax validation, not an allowlist: discovery remains owned by the server. */
export function chartSelection(params: URLSearchParams): { symbol: string; market: SymbolMarket; error: string | null } | null {
  if (!params.has('symbol')) return null;
  const symbol = (params.get('symbol') || '').trim().toUpperCase();
  if (!/^[A-Z0-9^@.][A-Z0-9._:/=^@+-]*$/.test(symbol) || !/[A-Z0-9]/.test(symbol) || symbol.includes('..')) {
    return { symbol: '', market: 'stocks', error: 'The chart link has an invalid instrument. Pick a symbol to continue.' };
  }
  const explicitMarket = params.get('market');
  if (explicitMarket !== null && explicitMarket !== 'stocks' && explicitMarket !== 'crypto') {
    return { symbol: '', market: 'stocks', error: 'The chart link has an unsupported market. Pick a symbol to continue.' };
  }
  const pairedCrypto = /[-/](USD|USDT|USDC|BTC|ETH|EUR)$/.test(symbol);
  const market = explicitMarket ?? (isCryptoSymbol(symbol) || pairedCrypto ? 'crypto' : 'stocks');
  return { symbol, market: market as SymbolMarket, error: null };
}
