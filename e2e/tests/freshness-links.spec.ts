import { test, expect } from '@playwright/test';
import type { Route } from '@playwright/test';
import { mockApi, seedAuth } from './mockApi';

test.beforeEach(async ({ page }) => { await seedAuth(page); });

test('@regression chart links accept dynamic symbols and encoded crypto pairs', async ({ page }) => {
  const api = await mockApi(page);
  await page.goto('/charts?symbol=NEWCO.WS.A&market=stocks');
  await expect(page.getByTestId('symbol-picker-button')).toContainText('NEWCO.WS.A');
  await expect.poll(() => api.calls.some(c => c.path.startsWith('/market/chart/NEWCO.WS.A?'))).toBe(true);
  await page.goto('/charts?symbol=NEWCOIN%2FUSDT&market=crypto');
  await expect(page.getByTestId('symbol-picker-button')).toContainText('NEWCOIN/USDT');
  await expect.poll(() => api.calls.some(c => decodeURIComponent(c.path).startsWith('/market/stock/NEWCOIN/USDT/candles?market=crypto'))).toBe(true);
});

test('@regression command palette instrument is honored instead of the account default', async ({ page }) => {
  const api = await mockApi(page);
  await page.goto('/portfolio');
  await page.keyboard.press('Control+k');
  await page.getByPlaceholder('Search pages, symbols, agents…').fill('AAPL');
  await page.getByRole('button', { name: /AAPL.*View chart/ }).click();
  await expect(page.getByTestId('symbol-picker-button')).toContainText('AAPL');
  await expect.poll(() => api.calls.some(c => c.path.startsWith('/market/chart/AAPL?'))).toBe(true);
  expect(api.calls.some(c => c.path.startsWith('/market/chart/AMZN?'))).toBe(false);
});

test('@regression chart picker preserves other link settings and browser history', async ({ page }) => {
  await mockApi(page);
  await page.goto('/charts?symbol=QQQ&market=stocks&context=held');
  await page.getByTestId('symbol-picker-button').click();
  await page.getByTestId('symbol-picker-option-SOFI').click();
  await expect(page).toHaveURL(/symbol=SOFI.*context=held/);
  await page.getByTestId('symbol-picker-button').click();
  await page.getByTestId('symbol-picker-option-NOK').click();
  await expect(page.getByTestId('symbol-picker-button')).toContainText('NOK');
  await page.goBack();
  await expect(page.getByTestId('symbol-picker-button')).toContainText('SOFI');
  await page.goForward();
  await expect(page.getByTestId('symbol-picker-button')).toContainText('NOK');
});

test('@regression invalid chart link does not silently request a different instrument', async ({ page }) => {
  const api = await mockApi(page);
  await page.goto('/charts?symbol=%3Cscript%3E');
  await expect(page.getByRole('alert')).toContainText('invalid instrument');
  await expect(page.getByTestId('chart-empty')).toContainText('Pick a symbol');
  await expect(page.getByTestId('data-freshness')).toContainText('Receipt time unknown');
  expect(api.calls.some(c => c.path.startsWith('/market/chart/'))).toBe(false);
});

test('@regression successful receipt is not labeled as a provider observation', async ({ page }) => {
  await mockApi(page);
  await page.goto('/journal');
  const status = page.getByTestId('data-freshness');
  await expect(status).toContainText('Journal response: Received');
  await expect(status).toContainText('Observation time unavailable');
  await expect(status).not.toContainText('Updated');
});

test('@regression failed refresh retains and labels the last successful receipt', async ({ page }) => {
  let fail = false;
  await mockApi(page, { '/journal': (route: Route) => fail
    ? route.fulfill({ status: 503, json: { error: 'Fixture outage' } })
    : route.fulfill({ json: [] }) });
  await page.clock.install();
  await page.goto('/journal');
  const status = page.getByTestId('data-freshness');
  await expect(status).toContainText('Received');
  fail = true;
  await page.clock.fastForward(60000);
  // Retries are real asynchronous responses; allow the query to settle before asserting.
  await expect(status).toHaveAttribute('data-state', 'error');
  await expect(status).toContainText('Refresh failed; cached response');
  await expect(status).not.toContainText('Received just now');
});

test('@regression overdue receipt remains visible while a refresh is pending', async ({ page }) => {
  let requests = 0;
  await mockApi(page, { '/journal': (route: Route) => ++requests === 1
    ? route.fulfill({ json: [] })
    : new Promise<void>(() => {}) });
  await page.clock.install();
  await page.goto('/journal');
  const status = page.getByTestId('data-freshness');
  await expect(status).toContainText('Received');
  await page.clock.fastForward(180000);
  await expect(status).toHaveAttribute('data-state', 'stale');
  await expect(status).toContainText('Response overdue');
});
