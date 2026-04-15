import React, { useEffect, useState } from 'react';
import { Pie, PieChart, Cell, Legend, Tooltip, ResponsiveContainer } from 'recharts';

interface CapitalAllocation {
  name: string;
  percentage: number;
  amount: number;
  expectedReturn: string;
  strategy: string;
  status: 'optimal' | 'underutilized' | 'overweight';
}

const COLORS = ['#3b82f6', '#ec4899', '#8b5cf6', '#f59e0b', '#10b981', '#6b7280'];

export default function InvestmentPage() {
  const [totalCapital] = useState(100000);
  const [allocations, setAllocations] = useState<CapitalAllocation[]>([
    {
      name: 'Crypto Momentum',
      percentage: 30,
      amount: 30000,
      expectedReturn: '8–15%',
      strategy: 'BTC, ETH, SOL swing trades based on technical signals',
      status: 'optimal'
    },
    {
      name: 'Stock Momentum',
      percentage: 20,
      amount: 20000,
      expectedReturn: '5–10%',
      strategy: 'NVDA, AAPL, TSLA based on earnings + technical',
      status: 'optimal'
    },
    {
      name: 'Prediction Markets',
      percentage: 15,
      amount: 15000,
      expectedReturn: '10–20%',
      strategy: 'Polymarket probability arbitrage on news events',
      status: 'underutilized'
    },
    {
      name: 'Options Premium',
      percentage: 15,
      amount: 15000,
      expectedReturn: '3–5%',
      strategy: 'Selling covered calls and puts — collect premium',
      status: 'optimal'
    },
    {
      name: 'Arbitrage',
      percentage: 10,
      amount: 10000,
      expectedReturn: '2–4%',
      strategy: 'Cross-exchange price differences',
      status: 'overweight'
    },
    {
      name: 'Cash Reserve',
      percentage: 10,
      amount: 10000,
      expectedReturn: '0%',
      strategy: 'Always kept in stable assets — never deployed',
      status: 'optimal'
    }
  ]);

  const chartData = allocations.map(a => ({
    name: a.name,
    value: a.percentage
  }));

  const expectedMonthlyReturn = (() => {
    const returns = [12.5, 7.5, 15, 4, 3, 0].map((r, i) => (allocations[i].amount * r) / 100);
    return returns.reduce((a, b) => a + b, 0);
  })();

  const expectedAnnualReturn = expectedMonthlyReturn * 12;

  return (
    <div className="min-h-screen bg-slate-900 text-white p-6">
      {/* Header */}
      <div className="mb-8">
        <h1 className="text-4xl font-bold mb-2">💰 Investment Plan</h1>
        <p className="text-slate-400">
          Strategic capital allocation across 6 distinct trading strategies
        </p>
      </div>

      {/* Key Metrics */}
      <div className="grid grid-cols-4 gap-4 mb-8">
        <div className="bg-slate-800 p-4 rounded-lg border border-slate-700">
          <div className="text-slate-400 text-sm">Total Capital</div>
          <div className="text-2xl font-bold text-blue-400">${totalCapital.toLocaleString()}</div>
        </div>
        <div className="bg-slate-800 p-4 rounded-lg border border-slate-700">
          <div className="text-slate-400 text-sm">Expected Monthly Return</div>
          <div className="text-2xl font-bold text-green-400">+${expectedMonthlyReturn.toFixed(0)}</div>
          <div className="text-xs text-slate-400">Avg {((expectedMonthlyReturn / totalCapital) * 100).toFixed(1)}%</div>
        </div>
        <div className="bg-slate-800 p-4 rounded-lg border border-slate-700">
          <div className="text-slate-400 text-sm">Expected Annual Return</div>
          <div className="text-2xl font-bold text-blue-400">+${expectedAnnualReturn.toFixed(0)}</div>
          <div className="text-xs text-slate-400">{((expectedAnnualReturn / totalCapital) * 100).toFixed(0)}% APY</div>
        </div>
        <div className="bg-slate-800 p-4 rounded-lg border border-slate-700">
          <div className="text-slate-400 text-sm">Deployed Capital</div>
          <div className="text-2xl font-bold text-orange-400">
            ${allocations
              .filter(a => a.name !== 'Cash Reserve')
              .reduce((s, a) => s + a.amount, 0)
              .toLocaleString()}
          </div>
          <div className="text-xs text-slate-400">90% of portfolio</div>
        </div>
      </div>

      {/* Pie Chart & Allocations */}
      <div className="grid grid-cols-3 gap-6 mb-8">
        {/* Chart */}
        <div className="col-span-1 bg-slate-800 p-6 rounded-lg border border-slate-700">
          <h2 className="font-semibold mb-4">Capital Allocation</h2>
          <ResponsiveContainer width="100%" height={300}>
            <PieChart>
              <Pie
                data={chartData}
                cx="50%"
                cy="50%"
                labelLine={false}
                outerRadius={80}
                fill="#8884d8"
                dataKey="value"
              >
                {allocations.map((entry, index) => (
                  <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                ))}
              </Pie>
              <Tooltip
                formatter={value => `${value}%`}
                contentStyle={{ backgroundColor: '#1e293b', border: 'none', borderRadius: '8px' }}
              />
              <Legend />
            </PieChart>
          </ResponsiveContainer>
        </div>

        {/* Legend with details */}
        <div className="col-span-2 bg-slate-800 p-6 rounded-lg border border-slate-700">
          <h2 className="font-semibold mb-4">Allocation Breakdown</h2>
          <div className="space-y-3 max-h-80 overflow-y-auto">
            {allocations.map((alloc, idx) => (
              <div
                key={idx}
                className="flex items-start gap-3 p-3 bg-slate-700 rounded border border-slate-600"
              >
                <div
                  className="w-4 h-4 rounded mt-1"
                  style={{ backgroundColor: COLORS[idx % COLORS.length] }}
                />
                <div className="flex-1">
                  <div className="font-semibold flex items-center gap-2">
                    {alloc.name}
                    <span className="text-xs font-normal text-slate-400">
                      ({alloc.percentage}% / ${alloc.amount.toLocaleString()})
                    </span>
                    {alloc.status === 'optimal' && <span className="text-green-400">✓ Optimal</span>}
                    {alloc.status === 'underutilized' && (
                      <span className="text-yellow-400">⚠️ Underutilized</span>
                    )}
                    {alloc.status === 'overweight' && <span className="text-orange-400">⬆️ Overweight</span>}
                  </div>
                  <div className="text-sm text-slate-400 mt-1">{alloc.strategy}</div>
                  <div className="text-xs text-slate-500 mt-1">
                    Expected return: <span className="text-slate-300">{alloc.expectedReturn}</span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Recommendations */}
      <div className="bg-slate-800 p-6 rounded-lg border border-slate-700 mb-8">
        <h2 className="font-semibold mb-4">Portfolio Optimization Recommendations</h2>
        <div className="space-y-3 text-sm">
          <div className="flex items-start gap-3 p-3 bg-slate-700 rounded">
            <span className="text-blue-400">→</span>
            <div>
              <strong>Increase Prediction Markets to 20%:</strong> Polymarket opportunities are
              offering exceptional risk/reward. Current volatility creates arbitrage opportunities.
            </div>
          </div>
          <div className="flex items-start gap-3 p-3 bg-slate-700 rounded">
            <span className="text-yellow-400">⚠️</span>
            <div>
              <strong>Review Arbitrage Strategy:</strong> Funding rates on Bybit are declining.
              Consider reallocating 5% to Crypto Momentum during this cycle.
            </div>
          </div>
          <div className="flex items-start gap-3 p-3 bg-slate-700 rounded">
            <span className="text-green-400">✓</span>
            <div>
              <strong>Cash Reserve is Well-Positioned:</strong> Maintaining 10% in USDC provides
              flexibility for flash crashes or new opportunities.
            </div>
          </div>
        </div>
      </div>

      {/* Asset Details Table */}
      <div className="bg-slate-800 p-6 rounded-lg border border-slate-700">
        <h2 className="font-semibold mb-4">Active Assets & Target Allocations</h2>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-600">
                <th className="text-left py-2 text-slate-400">Strategy Bucket</th>
                <th className="text-right py-2 text-slate-400">Allocation %</th>
                <th className="text-right py-2 text-slate-400">Amount</th>
                <th className="text-left py-2 text-slate-400">Target Assets</th>
                <th className="text-right py-2 text-slate-400">Current Positions</th>
              </tr>
            </thead>
            <tbody className="text-slate-300">
              <tr className="border-b border-slate-700 hover:bg-slate-700 transition">
                <td className="py-3">Crypto Momentum</td>
                <td className="text-right">30%</td>
                <td className="text-right font-semibold">$30,000</td>
                <td>BTC, ETH, SOL</td>
                <td className="text-right">2/3 deployed</td>
              </tr>
              <tr className="border-b border-slate-700 hover:bg-slate-700 transition">
                <td className="py-3">Stock Momentum</td>
                <td className="text-right">20%</td>
                <td className="text-right font-semibold">$20,000</td>
                <td>NVDA, AAPL, TSLA</td>
                <td className="text-right">1/3 deployed</td>
              </tr>
              <tr className="border-b border-slate-700 hover:bg-slate-700 transition">
                <td className="py-3">Prediction Markets</td>
                <td className="text-right">15%</td>
                <td className="text-right font-semibold">$15,000</td>
                <td>Polymarket USDC</td>
                <td className="text-right">0 deployed</td>
              </tr>
              <tr className="border-b border-slate-700 hover:bg-slate-700 transition">
                <td className="py-3">Options Premium</td>
                <td className="text-right">15%</td>
                <td className="text-right font-semibold">$15,000</td>
                <td>Calls, Puts (Alpaca)</td>
                <td className="text-right">0 deployed</td>
              </tr>
              <tr className="border-b border-slate-700 hover:bg-slate-700 transition">
                <td className="py-3">Arbitrage</td>
                <td className="text-right">10%</td>
                <td className="text-right font-semibold">$10,000</td>
                <td>Cross-exchange spreads</td>
                <td className="text-right">0 deployed</td>
              </tr>
              <tr className="hover:bg-slate-700 transition">
                <td className="py-3">Cash Reserve</td>
                <td className="text-right">10%</td>
                <td className="text-right font-semibold">$10,000</td>
                <td>USDC, USD</td>
                <td className="text-right">100% held</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      {/* Notes */}
      <div className="mt-8 p-4 bg-blue-800 bg-opacity-20 border border-blue-600 rounded-lg text-sm">
        <div className="font-semibold text-blue-300 mb-2">💡 How Capital Allocation Works</div>
        <p className="text-slate-300">
          The 6 capital buckets are designed to maximize risk-adjusted returns while maintaining
          diversification. Each bucket has a specific strategy, target assets, and expected return
          range. The Master Coordinator agent monitors allocations and recommends rebalancing when
          market conditions change. As the platform learns which strategies perform best, capital
          automatically allocates to higher-accuracy agents.
        </p>
      </div>
    </div>
  );
}
