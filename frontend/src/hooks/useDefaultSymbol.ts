import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { getPositions, getUniverseSymbols } from '../services/api';

export type SymbolMarket = 'stocks' | 'crypto';
export interface DefaultSymbol { symbol: string; market: SymbolMarket; name?: string }

/**
 * Chooses a default symbol for a page WITHOUT any hardcoded ticker:
 *   1. first open position
 *   2. first symbol of the server's 'most_active' universe category
 *   3. null → caller shows a "Pick a symbol" empty state
 */
export function useDefaultSymbol(market: SymbolMarket | 'all' = 'all') {
  const positionsQ = useQuery({
    queryKey: ['positions'],
    queryFn: getPositions,
    staleTime: 60_000,
    retry: false,
  });
  const positions: any[] = Array.isArray(positionsQ.data) ? positionsQ.data : Array.isArray((positionsQ.data as any)?.positions) ? (positionsQ.data as any).positions : [];
  const fromPosition = positions.find(p => {
    if (!p || typeof p.asset !== 'string' || !p.asset) return false;
    const m = p.market === 'crypto' ? 'crypto' : p.market === 'stocks' || p.market === 'stock' ? 'stocks' : null;
    if (!m) return false; // skip polymarket/forex positions — not chartable symbols
    return market === 'all' || m === market;
  });

  const needUniverse = !positionsQ.isLoading && !fromPosition;
  const category = market === 'crypto' ? 'crypto' : 'most_active';
  const universeQ = useQuery({
    queryKey: ['universe-symbols', category, '', 1],
    queryFn: () => getUniverseSymbols({ category, limit: 1 }),
    enabled: needUniverse,
    staleTime: 5 * 60_000,
    retry: false,
  });

  let result: DefaultSymbol | null = null;
  if (fromPosition) {
    result = { symbol: String(fromPosition.asset).toUpperCase(), market: fromPosition.market === 'crypto' ? 'crypto' : 'stocks' };
  } else {
    const first = universeQ.data?.symbols?.[0];
    if (first) result = { symbol: first.symbol, market: first.market === 'crypto' ? 'crypto' : 'stocks', name: first.name };
  }

  const isLoading = positionsQ.isLoading || (needUniverse && universeQ.isLoading);
  return { defaultSymbol: result, isLoading };
}


/**
 * Page-level selected symbol state that starts empty and adopts the default
 * (open position → most active) once it is known, unless the user already picked.
 */
export function useSelectedSymbol(market: SymbolMarket | 'all' = 'all') {
  const { defaultSymbol, isLoading } = useDefaultSymbol(market);
  const [symbol, setSymbolState] = useState('');
  const [symbolMarket, setSymbolMarket] = useState<SymbolMarket>('stocks');
  const [touched, setTouched] = useState(false);

  useEffect(() => {
    if (!touched && !symbol && defaultSymbol) {
      setSymbolState(defaultSymbol.symbol);
      setSymbolMarket(defaultSymbol.market);
    }
  }, [defaultSymbol, touched, symbol]);

  const setSymbol = (s: string, meta?: { market?: SymbolMarket }) => {
    setTouched(true);
    setSymbolState(s);
    if (meta?.market) setSymbolMarket(meta.market);
  };

  return { symbol, market: symbolMarket, setSymbol, isLoading: isLoading && !symbol };
}
