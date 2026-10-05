/**
 * INTEGRATION: OpenTerminal → APEX
 * Yield Curve Panel (Treasury rates 1M through 30Y)
 *
 * OpenTerminal ref: https://github.com/ErTasselli/OpenTerminal
 * APEX file location: frontend/src/components/panels/YieldCurve.tsx
 *
 * Shows:
 * - Current yield curve (1M, 3M, 6M, 1Y, 2Y, 5Y, 10Y, 20Y, 30Y)
 * - Historical overlays (1 month ago, 1 year ago)
 * - Inversion indicator (2Y-10Y spread)
 * - Recession probability signal
 */

import React, { useEffect, useState, useRef } from 'react';

const MATURITIES = [
  { maturity: '1M', months: 1 },
  { maturity: '3M', months: 3 },
  { maturity: '6M', months: 6 },
  { maturity: '1Y', months: 12 },
  { maturity: '2Y', months: 24 },
  { maturity: '5Y', months: 60 },
  { maturity: '10Y', months: 120 },
  { maturity: '20Y', months: 240 },
  { maturity: '30Y', months: 360 },
];

interface YieldPoint { maturity: string; months: number; rate: number; }
interface YieldCurveData {
  current: YieldPoint[];
  oneMonthAgo: YieldPoint[];
  oneYearAgo: YieldPoint[];
  spread2Y10Y: number;
  recessionProbability: number;
}

function drawCurve(
  ctx: CanvasRenderingContext2D,
  points: YieldPoint[],
  color: string,
  width: number,
  height: number,
  minRate: number,
  maxRate: number,
  opacity = 1,
) {
  if (points.length === 0) return;
  ctx.strokeStyle = color;
  ctx.globalAlpha = opacity;
  ctx.lineWidth = opacity === 1 ? 2 : 1;
  ctx.setLineDash(opacity === 1 ? [] : [4, 4]);
  ctx.beginPath();

  const pad = { left: 40, right: 10, top: 10, bottom: 24 };
  const plotW = width - pad.left - pad.right;
  const plotH = height - pad.top - pad.bottom;
  const range = maxRate - minRate || 0.01;

  points.forEach((p, i) => {
    const x = pad.left + (i / (points.length - 1)) * plotW;
    const y = pad.top + plotH - ((p.rate - minRate) / range) * plotH;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });
  ctx.stroke();

  // Draw dots for current curve
  if (opacity === 1) {
    points.forEach((p, i) => {
      const x = pad.left + (i / (points.length - 1)) * plotW;
      const y = pad.top + plotH - ((p.rate - minRate) / range) * plotH;
      ctx.globalAlpha = 1;
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(x, y, 3, 0, Math.PI * 2);
      ctx.fill();
    });
  }

  ctx.globalAlpha = 1;
  ctx.setLineDash([]);
}

export const YieldCurve: React.FC = () => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [data, setData] = useState<YieldCurveData | null>(null);
  const [loading, setLoading] = useState(true);
  const [showHistorical, setShowHistorical] = useState(true);

  useEffect(() => {
    fetchYieldData();
    const interval = setInterval(fetchYieldData, 10 * 60 * 1000); // 10 min
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    if (data && canvasRef.current) renderChart(data);
  }, [data, showHistorical]);

  async function fetchYieldData() {
    try {
      const res = await fetch('/api/market/treasury/yields');
      if (res.ok) setData(await res.json());
      else throw new Error('');
    } catch {
      // Mock realistic data (roughly current market rates Oct 2026)
      const mockCurrent = [4.85, 4.90, 4.95, 4.78, 4.50, 4.25, 4.35, 4.55, 4.60];
      const mockMonth = [4.90, 4.95, 5.00, 4.82, 4.58, 4.35, 4.42, 4.62, 4.65];
      const mockYear = [5.30, 5.45, 5.50, 5.40, 5.20, 4.95, 4.85, 4.90, 4.95];

      setData({
        current: MATURITIES.map((m, i) => ({ ...m, rate: mockCurrent[i] })),
        oneMonthAgo: MATURITIES.map((m, i) => ({ ...m, rate: mockMonth[i] })),
        oneYearAgo: MATURITIES.map((m, i) => ({ ...m, rate: mockYear[i] })),
        spread2Y10Y: 4.35 - 4.50, // negative = inverted
        recessionProbability: 42,
      });
    } finally {
      setLoading(false);
    }
  }

  function renderChart(d: YieldCurveData) {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const { width, height } = canvas;
    ctx.clearRect(0, 0, width, height);

    // Background
    ctx.fillStyle = '#0a0b0f';
    ctx.fillRect(0, 0, width, height);

    const allRates = [
      ...d.current.map(p => p.rate),
      ...(showHistorical ? [...d.oneMonthAgo.map(p => p.rate), ...d.oneYearAgo.map(p => p.rate)] : []),
    ];
    const minRate = Math.min(...allRates) - 0.1;
    const maxRate = Math.max(...allRates) + 0.1;

    const pad = { left: 40, right: 10, top: 10, bottom: 24 };
    const plotW = width - pad.left - pad.right;
    const plotH = height - pad.top - pad.bottom;
    const range = maxRate - minRate;

    // Grid lines
    ctx.strokeStyle = '#1f2937';
    ctx.lineWidth = 1;
    for (let r = Math.ceil(minRate * 2) / 2; r <= maxRate; r += 0.5) {
      const y = pad.top + plotH - ((r - minRate) / range) * plotH;
      ctx.beginPath();
      ctx.moveTo(pad.left, y);
      ctx.lineTo(width - pad.right, y);
      ctx.stroke();
      ctx.fillStyle = '#4b5563';
      ctx.font = '9px monospace';
      ctx.fillText(`${r.toFixed(1)}%`, 0, y + 3);
    }

    // X axis labels
    MATURITIES.forEach((m, i) => {
      const x = pad.left + (i / (MATURITIES.length - 1)) * plotW;
      ctx.fillStyle = '#4b5563';
      ctx.font = '9px monospace';
      ctx.textAlign = 'center';
      ctx.fillText(m.maturity, x, height - 6);
    });

    // Curves
    if (showHistorical) {
      drawCurve(ctx, d.oneYearAgo, '#6b7280', width, height, minRate, maxRate, 0.4);
      drawCurve(ctx, d.oneMonthAgo, '#818cf8', width, height, minRate, maxRate, 0.6);
    }
    drawCurve(ctx, d.current, '#22c55e', width, height, minRate, maxRate);
  }

  const isInverted = data ? data.spread2Y10Y < 0 : false;

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span style={{ fontSize: 12, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: '#6b7280' }}>
          US Treasury Yield Curve
        </span>
        <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
          {data && (
            <>
              <span style={{ fontSize: 11, color: isInverted ? '#ef4444' : '#22c55e', fontWeight: 600 }}>
                2Y-10Y: {data.spread2Y10Y > 0 ? '+' : ''}{(data.spread2Y10Y * 100).toFixed(0)}bps
                {isInverted ? ' ⚠ INVERTED' : ''}
              </span>
              <span style={{ fontSize: 11, color: '#f59e0b' }}>
                Recession: ~{data.recessionProbability}%
              </span>
            </>
          )}
          <button
            onClick={() => setShowHistorical(!showHistorical)}
            style={{ fontSize: 10, padding: '3px 8px', borderRadius: 4, border: 'none', cursor: 'pointer', background: showHistorical ? '#4f7cff' : '#1f2937', color: 'white' }}
          >
            History
          </button>
        </div>
      </div>

      <div style={{ flex: 1, position: 'relative' }}>
        {loading ? (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: '#6b7280' }}>Loading yield data…</div>
        ) : (
          <canvas
            ref={canvasRef}
            width={500}
            height={200}
            style={{ width: '100%', height: '100%' }}
          />
        )}
      </div>

      {!loading && showHistorical && (
        <div style={{ display: 'flex', gap: 16, fontSize: 10, color: '#6b7280' }}>
          <span style={{ color: '#22c55e' }}>— Today</span>
          <span style={{ color: '#818cf8', opacity: 0.7 }}>-- 1M Ago</span>
          <span style={{ color: '#6b7280', opacity: 0.5 }}>-- 1Y Ago</span>
        </div>
      )}
    </div>
  );
};

export default YieldCurve;
