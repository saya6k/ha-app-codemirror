import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  workers: 1,
  use: {
    baseURL: 'http://127.0.0.1:18099',
    browserName: 'chromium',
    channel: process.env.PLAYWRIGHT_CHANNEL || 'chromium',
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
  },
  webServer: {
    command: '../../.venv/bin/python ../tests/serve_browser.py',
    url: 'http://127.0.0.1:18099/health',
    reuseExistingServer: false,
  },
});
