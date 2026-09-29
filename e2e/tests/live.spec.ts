// READ-ONLY checks against the deployed site (run with E2E_BASE_URL + E2E_LIVE=1).
// They never log in and never place orders.
import { test, expect } from '@playwright/test';

const API = process.env.E2E_API_URL || 'https://tharun-trading-production.up.railway.app';

test.describe('@live production', () => {
  test.skip(!process.env.E2E_LIVE, 'set E2E_LIVE=1 to run');
  test('@live backend health is OPERATIONAL', async ({ request }) => {
    const r = await request.get(`${API}/health`);
    expect(r.ok()).toBeTruthy();
    expect((await r.json()).status).toBe('OPERATIONAL');
  });
  test('@live protected API rejects anonymous callers', async ({ request }) => {
    for (const p of ['/api/portfolio', '/api/trades', '/api/system/status', '/api/market/universe/categories']) {
      expect((await request.get(`${API}${p}`)).status()).toBe(401);
    }
  });
  test('@live owner-only actions reject anonymous callers', async ({ request }) => {
    for (const p of ['/api/agents/force-trade', '/api/kill-switch/deactivate', '/api/system/intraday/scan']) {
      expect([401, 403]).toContain((await request.post(`${API}${p}`, { data: {} })).status());
    }
  });
  test('@live CORS does not reflect arbitrary origins', async ({ request }) => {
    const r = await request.get(`${API}/health`, { headers: { Origin: 'https://evil.example' } });
    expect(r.headers()['access-control-allow-origin']).not.toBe('https://evil.example');
  });
  test('@live frontend loads the login page', async ({ page }) => {
    await page.goto(process.env.E2E_BASE_URL || 'https://tharun-trading.vercel.app');
    await expect(page).toHaveURL(/login/);
  });
});
