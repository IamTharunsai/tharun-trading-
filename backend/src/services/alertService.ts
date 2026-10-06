/**
 * Alert Service — Discord and Slack webhook notifications
 *
 * Sends structured trade alerts, failure notifications, and system events to
 * configured Discord and/or Slack channels via incoming webhooks.
 *
 * Configuration (env vars):
 *   DISCORD_WEBHOOK_URL  — Discord channel webhook URL
 *   SLACK_WEBHOOK_URL    — Slack channel webhook URL
 *   ALERT_MIN_SEVERITY   — "info" | "warn" | "error" (default: "warn")
 *
 * Usage:
 *   import { alert } from '../services/alertService';
 *   await alert.tradeFailed('AAPL', 'Broker rejected order: insufficient margin');
 *   await alert.tradeExecuted('BTC', 'BUY', 64200, 0.5, 5.0);
 *   await alert.drawdownWarning(4.8, 5.0);
 */

import { logger } from '../utils/logger';

// ── Types ─────────────────────────────────────────────────────────────────────

type Severity = 'info' | 'warn' | 'error';

interface AlertPayload {
  title: string;
  message: string;
  severity: Severity;
  fields?: Record<string, string | number>;
  timestamp?: Date;
}

// ── Colour / emoji maps ────────────────────────────────────────────────────────

const DISCORD_COLOURS: Record<Severity, number> = {
  info:  0x3498db,  // blue
  warn:  0xf39c12,  // orange
  error: 0xe74c3c,  // red
};

const SEVERITY_EMOJI: Record<Severity, string> = {
  info:  'ℹ️',
  warn:  '⚠️',
  error: '🚨',
};

// ── Internal delivery helpers ─────────────────────────────────────────────────

async function postDiscord(payload: AlertPayload): Promise<void> {
  const url = process.env.DISCORD_WEBHOOK_URL;
  if (!url) return;

  const embed: Record<string, unknown> = {
    title: `${SEVERITY_EMOJI[payload.severity]} ${payload.title}`,
    description: payload.message,
    color: DISCORD_COLOURS[payload.severity],
    timestamp: (payload.timestamp ?? new Date()).toISOString(),
    footer: { text: 'APEX Trading Bot' },
  };

  if (payload.fields && Object.keys(payload.fields).length > 0) {
    embed.fields = Object.entries(payload.fields).map(([name, value]) => ({
      name,
      value: String(value),
      inline: true,
    }));
  }

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ embeds: [embed] }),
    });
    if (!res.ok) {
      logger.warn(`[ALERT] Discord webhook returned ${res.status}: ${await res.text()}`);
    }
  } catch (err: any) {
    logger.warn(`[ALERT] Discord delivery failed: ${err?.message}`);
  }
}

async function postSlack(payload: AlertPayload): Promise<void> {
  const url = process.env.SLACK_WEBHOOK_URL;
  if (!url) return;

  const colourMap: Record<Severity, string> = { info: '#3498db', warn: '#f39c12', error: '#e74c3c' };

  const attachment: Record<string, unknown> = {
    color: colourMap[payload.severity],
    title: `${SEVERITY_EMOJI[payload.severity]} ${payload.title}`,
    text: payload.message,
    ts: Math.floor((payload.timestamp ?? new Date()).getTime() / 1000),
    footer: 'APEX Trading Bot',
  };

  if (payload.fields && Object.keys(payload.fields).length > 0) {
    attachment.fields = Object.entries(payload.fields).map(([title, value]) => ({
      title,
      value: String(value),
      short: true,
    }));
  }

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ attachments: [attachment] }),
    });
    if (!res.ok) {
      logger.warn(`[ALERT] Slack webhook returned ${res.status}: ${await res.text()}`);
    }
  } catch (err: any) {
    logger.warn(`[ALERT] Slack delivery failed: ${err?.message}`);
  }
}

// ── Severity gate ─────────────────────────────────────────────────────────────

const SEVERITY_ORDER: Severity[] = ['info', 'warn', 'error'];

function shouldSend(severity: Severity): boolean {
  const min = (process.env.ALERT_MIN_SEVERITY ?? 'warn') as Severity;
  return SEVERITY_ORDER.indexOf(severity) >= SEVERITY_ORDER.indexOf(min);
}

async function send(payload: AlertPayload): Promise<void> {
  if (!shouldSend(payload.severity)) return;
  // Fire both in parallel; individual failures are swallowed (non-blocking)
  await Promise.allSettled([postDiscord(payload), postSlack(payload)]);
}

// ── Public API ────────────────────────────────────────────────────────────────

export const alert = {
  /** Trade successfully executed */
  async tradeExecuted(asset: string, direction: 'BUY' | 'SELL', price: number, qty: number, sizePct: number): Promise<void> {
    const emoji = direction === 'BUY' ? '🟢' : '🔴';
    await send({
      severity: 'info',
      title: `${emoji} Trade Executed — ${direction} ${asset}`,
      message: `Order filled for ${asset}`,
      fields: {
        Direction: direction,
        Price: `$${price.toFixed(2)}`,
        Quantity: qty.toFixed(6),
        'Size (% portfolio)': `${sizePct.toFixed(1)}%`,
      },
    });
  },

  /** Trade approval failed (risk gate, broker rejection, etc.) */
  async tradeFailed(asset: string, reason: string, direction?: string): Promise<void> {
    await send({
      severity: 'warn',
      title: `⛔ Trade Failed — ${asset}`,
      message: reason,
      fields: direction ? { Direction: direction, Asset: asset } : { Asset: asset },
    });
  },

  /** Position closed by stop-loss or take-profit */
  async positionClosed(asset: string, reason: 'STOP_LOSS' | 'TAKE_PROFIT', pnl: number, pnlPct: number): Promise<void> {
    const emoji = pnl >= 0 ? '✅' : '💸';
    await send({
      severity: 'info',
      title: `${emoji} Position Closed — ${asset} (${reason})`,
      message: `${asset} position closed via ${reason}`,
      fields: {
        Reason: reason,
        'P&L': `${pnl >= 0 ? '+' : ''}$${pnl.toFixed(2)}`,
        'P&L %': `${pnlPct >= 0 ? '+' : ''}${pnlPct.toFixed(2)}%`,
      },
    });
  },

  /** Weekly drawdown approaching limit */
  async drawdownWarning(currentPct: number, limitPct: number): Promise<void> {
    await send({
      severity: 'warn',
      title: '⚠️ Weekly Drawdown Warning',
      message: `Portfolio drawdown is at ${currentPct.toFixed(2)}% — approaching the ${limitPct}% weekly limit.`,
      fields: {
        'Current DD': `${currentPct.toFixed(2)}%`,
        'Limit': `${limitPct}%`,
        'Remaining buffer': `${(limitPct - currentPct).toFixed(2)}%`,
      },
    });
  },

  /** Kill switch activated */
  async killSwitchActivated(reason: string): Promise<void> {
    await send({
      severity: 'error',
      title: '🛑 KILL SWITCH ACTIVATED',
      message: reason,
    });
  },

  /** Kill switch deactivated */
  async killSwitchDeactivated(): Promise<void> {
    await send({
      severity: 'warn',
      title: '✅ Kill Switch Deactivated',
      message: 'Trading has been re-enabled.',
    });
  },

  /** Generic system error */
  async systemError(component: string, message: string, err?: Error): Promise<void> {
    await send({
      severity: 'error',
      title: `🚨 System Error — ${component}`,
      message,
      fields: err ? { Error: err.message.slice(0, 200) } : undefined,
    });
  },

  /** General-purpose alert */
  async custom(severity: Severity, title: string, message: string, fields?: Record<string, string | number>): Promise<void> {
    await send({ severity, title, message, fields });
  },
};
