import { runBacktest, evaluateBacktestResults } from '../src/trading/backtestingEngine';

async function main() {
  const results = await runBacktest({
    startDate: '2025-10-15',
    endDate: '2026-04-15',
    initialCapital: 100000,
    symbols: ['AAPL', 'BTC/USDT', 'ETH/USDT'],
    riskPerTrade: 1,
    maxPositionSize: 10,
    brokerFeesPct: 0.1,
  });
  const evaluation = evaluateBacktestResults(results);
  console.log(JSON.stringify({ results, evaluation }, null, 2));
}

main().catch((err) => {
  console.error('Backtest run failed', err);
  process.exit(1);
});
