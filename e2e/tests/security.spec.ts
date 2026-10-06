// SECURITY (frontend side): no secrets in the bundle, tokens only via login, XSS-safe rendering.
import { test, expect } from '@playwright/test';
import { mockApi, seedAuth } from './mockApi';

test('@security the JS bundle contains no API keys or pre-signed tokens', async ({ page, request, baseURL }) => {
  await mockApi(page);
  await page.goto('/login');
  const scripts = await page.$$eval('script[src]', els => els.map(e => (e as HTMLScriptElement).src));
  for (const src of scripts) {
    const body = await (await request.get(src)).text();
    expect(body).not.toMatch(/nvapi-[A-Za-z0-9_-]{20,}/);
    expect(body).not.toMatch(/sk-ant-[A-Za-z0-9_-]{20,}/);
    expect(body.replace(/PKX{10,}/g, "")).not.toMatch(/PK[A-Z0-9]{16,}/); // Alpaca key ids (placeholder PKXXXX… allowed)
    expect(body).not.toMatch(/eyJhbGciOiJIUzI1NiIs[A-Za-z0-9._-]{40,}/); // hardcoded JWT
  }
  expect(baseURL).toBeTruthy();
});

test('@security news titles are rendered as text, not HTML', async ({ page }) => {
  await seedAuth(page);
  let alerted = false;
  page.on('dialog', d => { alerted = true; d.dismiss(); });
  await mockApi(page, { '/market/news': [{ id: 'x', title: '<img src=x onerror="alert(1)">evil', url: 'https://e.com', source: 'x', publishedAt: new Date().toISOString() }] });
  await page.goto('/news');
  await page.waitForTimeout(800);
  expect(alerted).toBe(false);
});
