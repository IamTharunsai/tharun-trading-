import { defineConfig, devices } from '@playwright/test';
import fs from 'fs';

// Runs the built frontend (`npm run build` at repo root → dist/) with every
// /api call mocked (tests/mockApi.ts), so tests are deterministic and never
// touch the real broker. Set E2E_BASE_URL to point at a deployed site instead
// (only the @live read-only checks are meant for that).
const localChrome = '/opt/pw-browsers/chromium';
const executablePath = process.env.PW_CHROMIUM || (fs.existsSync(localChrome) ? localChrome : undefined);

export default defineConfig({
  testDir: './tests',
  timeout: 45_000,
  expect: { timeout: 10_000 },
  fullyParallel: true,
  retries: process.env.CI ? 1 : 0,
  reporter: [['list'], ['html', { open: 'never', outputFolder: 'report' }]],
  use: {
    baseURL: process.env.E2E_BASE_URL || 'http://127.0.0.1:4173',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    launchOptions: executablePath ? { executablePath } : {},
  },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } } },
    { name: 'mobile', use: { ...devices['Pixel 7'] }, grep: /@mobile|@smoke/ },
  ],
  webServer: process.env.E2E_BASE_URL ? undefined : {
    command: 'cd .. && npx vite preview --port 4173 --host 127.0.0.1',
    url: 'http://127.0.0.1:4173',
    reuseExistingServer: true,
    timeout: 60_000,
  },
});
