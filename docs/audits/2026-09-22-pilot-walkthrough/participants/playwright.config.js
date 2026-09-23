'use strict';
const path = require('path');
const os = require('os');
const fs = require('fs');
const { defineConfig, devices } = require('@playwright/test');
const root = path.resolve(__dirname, '../../../..');
const identity = require(path.join(root, 'tests/identity'));
if (!process.env.PARTICIPANT_AUDIT_FIXTURE) {
  process.env.PARTICIPANT_AUDIT_FIXTURE = JSON.stringify(identity.serverEnv());
  process.env.PARTICIPANT_AUDIT_DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'slate-participants-'));
}
const fixture = JSON.parse(process.env.PARTICIPANT_AUDIT_FIXTURE);
process.env.SLATE_TEST_CLERK_KEY = fixture.privateKey;
process.env.SLATE_BROWSER_BASE = 'http://127.0.0.1:4192';
module.exports = defineConfig({
  testDir: __dirname, testMatch: 'walkthrough.spec.js',
  outputDir: path.join(__dirname, 'results'),
  workers: 1, timeout: 120000, expect: { timeout: 10000 }, reporter: [['list']],
  use: { baseURL: process.env.SLATE_BROWSER_BASE, serviceWorkers: 'block', actionTimeout: 10000, trace: 'retain-on-failure', screenshot: 'only-on-failure' },
  projects: [
    { name: 'desktop-chrome', use: { ...devices['Desktop Chrome'] } },
    { name: 'mobile-chrome', use: { ...devices['Pixel 7'] } }
  ],
  webServer: {
    command: 'node server/index.js', cwd: root,
    url: process.env.SLATE_BROWSER_BASE + '/api/health', reuseExistingServer: false,
    gracefulShutdown: { signal: 'SIGTERM', timeout: 5000 },
    env: { NODE_ENV: 'test', SLATE_BILLING_MODE: 'off', ...fixture.server,
      PORT: '4192', HOST: '127.0.0.1', DATA_DIR: process.env.PARTICIPANT_AUDIT_DATA,
      ANTHROPIC_API_KEY: '', SLATE_EXIT_WITH_PARENT: 'true',
      SLATE_MAIL_TRANSPORT: 'echo', SLATE_APPLICATION_UPLOADS: 'on', SLATE_FILE_SCANNER: 'accept-all',
      SLATE_SUPPORT_EMAIL: 'recruitment@example.gov', SLATE_SUPPORT_HOURS: 'Weekdays 8am-5pm Arizona time' }
  }
});
