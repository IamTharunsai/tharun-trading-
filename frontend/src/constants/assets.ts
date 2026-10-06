// Classifier helper ONLY — mirrors backend CRYPTO_ASSETS (marketData.ts) so the UI can
// tell whether a symbol is crypto or a stock. Do NOT render this as a picker list;
// symbol selection goes through <SymbolPicker/>, which reads the server-side universe.
export const CRYPTO_LIST = [
  'BTC', 'ETH', 'SOL', 'BNB', 'ADA', 'AVAX', 'LINK', 'DOT', 'UNI', 'MATIC',
  'XRP', 'DOGE', 'SHIB', 'LTC', 'BCH', 'ATOM', 'FIL', 'NEAR', 'APT', 'ARB',
  'OP', 'INJ', 'SUI', 'SEI', 'TIA', 'PYTH', 'JTO', 'BONK', 'WIF', 'PEPE',
];

export const isCryptoSymbol = (symbol: string | null | undefined): boolean =>
  !!symbol && CRYPTO_LIST.includes(symbol.toUpperCase().replace(/[-/]?USDT?$/, ''));
