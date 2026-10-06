// STEP 2 — SANITY: verify the specific fixes of this release.
import { test, expect } from '@playwright/test';
import { mockApi, seedAuth, trackErrors, fixtures } from './mockApi';

test.beforeEach(async ({ page }) => { await seedAuth(page); });

test('@sanity symbol picker is dynamic: categories → stocks, no hardcoded list', async ({ page }) => {
  const api = await mockApi(page);
  await page.goto('/agents');
  const picker = page.getByTestId('symbol-picker');
  await picker.getByTestId('symbol-picker-button').click();
  await expect(page.getByTestId('symbol-picker-panel')).toBeVisible();
  await expect(page.getByTestId('symbol-picker-category-sector_energy')).toBeVisible();
  await page.getByTestId('symbol-picker-category-sector_energy').click();
  await expect(page.getByTestId('symbol-picker-option-XOM')).toBeVisible();
  await page.getByTestId('symbol-picker-option-XOM').click();
  await expect(picker).toContainText('XOM');
  expect(api.calls.some(c => c.path.startsWith('/market/universe/categories'))).toBeTruthy();
  expect(api.calls.some(c => c.path.includes('category=sector_energy'))).toBeTruthy();
});

test('@sanity picker search queries the whole universe server-side', async ({ page }) => {
  const api = await mockApi(page);
  await page.goto('/charts');
  await page.getByTestId('symbol-picker-button').first().click();
  await page.getByTestId('symbol-picker-search').fill('cvx');
  await expect(page.getByTestId('symbol-picker-option-CVX')).toBeVisible();
  expect(api.calls.some(c => /search=cvx/i.test(c.path))).toBeTruthy();
});

test('@sanity debate button sends the picked symbol, not a hardcoded default', async ({ page }) => {
  const api = await mockApi(page);
  await page.goto('/agents');
  await page.getByTestId('symbol-picker-button').click();
  await page.getByTestId('symbol-picker-category-most_active').click();
  await page.getByTestId('symbol-picker-option-RIG').click();
  await page.getByTestId('debate-trigger').click();
  await expect.poll(() => api.calls.find(c => c.method === 'POST' && c.path.startsWith('/agents/trigger-debate'))?.body?.asset).toBe('RIG');
});

test('@sanity default symbol comes from the portfolio, never NVDA', async ({ page }) => {
  await mockApi(page);
  await page.goto('/agents');
  await expect(page.getByTestId('symbol-picker')).toContainText('AMZN');
});

test('@sanity trades ledger: rejected orders are never WIN; intraday + synced badges shown', async ({ page }) => {
  await mockApi(page);
  await page.goto('/trades');
  const rows = page.getByTestId('trade-row');
  await expect(rows.first()).toBeVisible();
  await expect(page.locator('[data-testid="trade-row"][data-outcome="REJECTED"]')).toHaveCount(1);
  await expect(page.locator('[data-testid="trade-row"][data-outcome="WIN"]')).toHaveCount(1);
  await expect(page.locator('[data-testid="trade-row"][data-outcome="LOSS"]')).toHaveCount(1);
  await expect(page.getByTestId('badge-intraday')).toHaveCount(1);
  await expect(page.getByTestId('badge-synced')).toHaveCount(1);
});

test('@sanity agent decisions with provider errors are flagged, not shown as HOLD stats', async ({ page }) => {
  await mockApi(page);
  await page.goto('/agents');
  await expect(page.getByTestId('decision-provider-error').first()).toBeVisible();
});

test('@sanity news is de-duplicated', async ({ page }) => {
  await mockApi(page);
  await page.goto('/news');
  await expect(page.getByText('Duplicate headline')).toHaveCount(1);
  await expect(page.getByText('Different story')).toHaveCount(1);
});

test('@sanity top bar shows real status (AI provider, mode) from /system/status', async ({ page }) => {
  await mockApi(page);
  await page.goto('/');
  await expect(page.locator('body')).toContainText(/NVIDIA/i);
  await expect(page.locator('body')).toContainText(/PAPER/i);
});

test('@sanity top bar degrades to STATUS UNKNOWN when status fails', async ({ page }) => {
  await mockApi(page, { '/system/status': (route: any) => route.fulfill({ status: 500, json: {} }) });
  await page.goto('/');
  await expect(page.locator('body')).toContainText(/STATUS UNKNOWN/i);
});

test('@sanity NAV is never $0 when the account has cash', async ({ page }) => {
  await mockApi(page, { '/portfolio': { ...fixtures.portfolio, totalValue: 0 } });
  await page.goto('/portfolio');
  await expect(page.locator('body')).not.toContainText('Total Portfolio NAV$0.00');
});

test('@sanity polymarket page loads with malformed prediction data', async ({ page }) => {
  const errors = trackErrors(page);
  await mockApi(page, { '/market/predictions': [{ id: 'x', question: null, expectedValue: null, marketPrice: undefined }, { id: 'y' }] });
  await page.goto('/polymarket');
  await page.waitForTimeout(800);
  await expect(page.getByTestId('error-boundary')).toHaveCount(0);
  expect(errors).toEqual([]);
});
