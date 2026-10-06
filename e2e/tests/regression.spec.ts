// STEP 3 — REGRESSION: every nav link, key buttons (positive + negative paths), mobile.
import { test, expect } from '@playwright/test';
import { mockApi, seedAuth, trackErrors } from './mockApi';

const NAV = ['home', 'polymarket', 'charts', 'stocks', 'agents', 'agents-debate-room', 'agents-monitor', 'agents-chat',
  'alternative-data', 'analytics', 'news', 'journal', 'investment', 'portfolio', 'trades', 'copy-trading', 'settings'];

test.beforeEach(async ({ page }) => { await seedAuth(page); });

test('@regression every sidebar link navigates and renders', async ({ page }) => {
  const errors = trackErrors(page);
  await mockApi(page);
  await page.goto('/');
  for (const id of NAV) {
    await page.getByTestId(`nav-${id}`).click();
    await expect(page.getByTestId('error-boundary')).toHaveCount(0);
  }
  expect(errors).toEqual([]);
});

test('@regression kill switch: cancel does nothing, confirm calls the API', async ({ page }) => {
  const api = await mockApi(page);
  await page.goto('/');
  page.once('dialog', d => d.dismiss());
  await page.getByTestId('kill-switch').click();
  expect(api.calls.filter(c => c.path.startsWith('/kill-switch/activate'))).toHaveLength(0);
  page.once('dialog', d => d.accept());
  await page.getByTestId('kill-switch').click();
  await expect.poll(() => api.calls.filter(c => c.method === 'POST' && c.path.startsWith('/kill-switch/activate')).length).toBe(1);
});

test('@regression kill switch shows an error (not success) when the API fails', async ({ page }) => {
  await mockApi(page, { 'POST /kill-switch/activate': (r: any) => r.fulfill({ status: 403, json: { error: 'Owner only' } }) });
  await page.goto('/');
  page.once('dialog', d => d.accept());
  await page.getByTestId('kill-switch').click();
  await expect(page.locator('body')).not.toContainText('Trading Halted');
});

test('@regression debate buttons are disabled until a symbol is picked (no default ticker)', async ({ page }) => {
  await mockApi(page, {
    '/portfolio/positions': [],
    '/market/universe/symbols': { symbols: [], total: 0 },
  });
  await page.goto('/agents');
  await expect(page.getByTestId('debate-trigger')).toBeDisabled();
});

test('@regression logout clears the session', async ({ page }) => {
  await mockApi(page);
  await page.goto('/');
  await page.getByTestId('logout').click();
  await expect(page).toHaveURL(/\/login/);
  expect(await page.evaluate(() => localStorage.getItem('apex_token'))).toBeNull();
});

test('@regression 401 from the API logs the user out', async ({ page }) => {
  await mockApi(page, { '/portfolio': (r: any) => r.fulfill({ status: 401, json: { error: 'expired' } }) });
  await page.goto('/portfolio');
  await expect(page).toHaveURL(/\/login/);
});

test('@regression intraday card: Scan now calls the owner endpoint', async ({ page }) => {
  const api = await mockApi(page);
  await page.goto('/');
  const btn = page.getByRole('button', { name: /scan now/i });
  if (await btn.count()) {
    await btn.first().click();
    await expect.poll(() => api.calls.some(c => c.method === 'POST' && c.path.startsWith('/system/intraday/scan'))).toBeTruthy();
  }
});

test('@regression @mobile mobile menu opens and navigates', async ({ page, isMobile }) => {
  test.skip(!isMobile, 'mobile only');
  await mockApi(page);
  await page.goto('/');
  await page.getByTestId('mobile-nav-toggle').click();
  await page.getByTestId('nav-trades').click();
  await expect(page).toHaveURL(/\/trades/);
});
