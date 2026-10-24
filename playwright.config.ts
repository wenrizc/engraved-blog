import { existsSync, mkdtempSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { defineConfig } from '@playwright/test';

const executablePath =
  process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ??
  (existsSync('/usr/bin/google-chrome') ? '/usr/bin/google-chrome' : undefined);

process.env.TEST_SITE_ROOT ??= mkdtempSync(path.join(os.tmpdir(), 'wenri-site-test-'));

export default defineConfig({
  testDir: './tests',
  testIgnore: 'admin.spec.ts',
  fullyParallel: true,
  // Integration tests share one disposable copy of the site's content.
  workers: 1,
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
    command: 'node tests/site-server.mjs',
    url: 'http://127.0.0.1:4330',
    reuseExistingServer: false
  }
});
