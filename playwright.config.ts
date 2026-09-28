import { existsSync } from 'node:fs';
import { defineConfig } from '@playwright/test';

const executablePath =
  process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ??
  (existsSync('/usr/bin/google-chrome') ? '/usr/bin/google-chrome' : undefined);

export default defineConfig({
  testDir: './tests',
  fullyParallel: true,
  workers: 2,
  use: {
    baseURL: 'http://127.0.0.1:4330',
    launchOptions: { executablePath },
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure'
  },
  projects: [
    { name: 'phone', use: { viewport: { width: 320, height: 812 } } },
    { name: 'tablet', use: { viewport: { width: 768, height: 1024 } } },
    { name: 'desktop', use: { viewport: { width: 1440, height: 900 } } }
  ],
  webServer: {
    command: 'npm run dev -- --host 127.0.0.1 --port 4330',
    url: 'http://127.0.0.1:4330',
    reuseExistingServer: !process.env.CI
  }
});
