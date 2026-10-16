import { defineConfig } from '@playwright/test'
export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: false,
  workers: 1,
  timeout: 90000,
  expect: { timeout: 15000 },
  use: {
    baseURL: 'http://127.0.0.1:5174',
    headless: true,
    channel: 'chromium',
    viewport: { width: 1440, height: 1000 },
    trace: 'off',
    screenshot: 'only-on-failure',
  },
  globalSetup: './tests/e2e/setup.ts',
  webServer: [
    { command: 'pnpm chain', port: 8546, reuseExistingServer: false, timeout: 30000 },
    {
      command: 'pnpm dev',
      url: 'http://127.0.0.1:5174',
      reuseExistingServer: false,
      timeout: 30000,
    },
  ],
})
