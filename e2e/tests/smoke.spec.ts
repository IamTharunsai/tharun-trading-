// STEP 1 — SMOKE: "does the engine start?" Every page must render with no crash.
import { test, expect } from '@playwright/test';
import { mockApi, seedAuth, trackErrors } from './mockApi';

const PAGES = [
  '/', '/polymarket', '/charts', '/stocks', '/agents', '/agents/debate-room', '/agents/monitor', '/agents/chat',
  '/alternative-data', '/analytics', '/news', '/journal', '/investment', '/portfolio', '/trades', '/copy-trading', '/settings',
];

test('@smoke login page renders and requires credentials', async ({ page }) => {
  await mockApi(page);
  await page.goto('/login');
  await expect(page.getByTestId('login-email')).toBeVisible();
  await expect(page.getByTestId('login-password')).toBeVisible();
  await expect(page.getByTestId('login-submit')).toBeVisible();
});

test('@smoke unauthenticated visit to a protected page redirects to /login', async ({ page }) => {
  await mockApi(page);
  await page.goto('/portfolio');
  await expect(page).toHaveURL(/\/login/);
});

for (const path of PAGES) {
  test(`@smoke ${path} renders without an error`, async ({ page }) => {
    const errors = trackErrors(page);
    await mockApi(page);
    await seedAuth(page);
    await page.goto(path);
    await expect(page.getByTestId('kill-switch')).toBeVisible();
    await page.waitForLoadState('networkidle').catch(() => {});
    await expect(page.getByTestId('error-boundary')).toHaveCount(0);
    expect(errors, `uncaught errors on ${path}`).toEqual([]);
  });
}

test('@smoke a page survives the whole API being down (500s)', async ({ page }) => {
  const errors = trackErrors(page);
  await seedAuth(page);
  await page.route(/\/api\//, r => r.fulfill({ status: 500, json: { error: 'down' } }));
  await page.route(/socket\.io/, r => r.abort());
  for (const path of ['/', '/polymarket', '/trades', '/portfolio', '/settings']) {
    await page.goto(path);
    await page.waitForTimeout(500);
    await expect(page.getByTestId('error-boundary')).toHaveCount(0);
  }
  expect(errors).toEqual([]);
});
