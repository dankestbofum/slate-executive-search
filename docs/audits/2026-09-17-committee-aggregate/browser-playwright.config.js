'use strict';
const path = require('path');
const os = require('os');
const fs = require('fs');
const { defineConfig, devices } = require('@playwright/test');
const root = path.resolve(__dirname, '../../..');
const identity = require(path.join(root, 'tests/identity'));
if (!process.env.COMMITTEE_AUDIT_FIXTURE) {
  const fixture = identity.serverEnv();
  process.env.COMMITTEE_AUDIT_FIXTURE = JSON.stringify(fixture);
  process.env.COMMITTEE_AUDIT_DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'committee-browser-audit-'));
}
const fixture = JSON.parse(process.env.COMMITTEE_AUDIT_FIXTURE);
process.env.SLATE_TEST_CLERK_KEY = fixture.privateKey;
process.env.SLATE_BROWSER_BASE = 'http://127.0.0.1:4293';
module.exports = defineConfig({
  testDir: __dirname,
  testMatch: 'browser-walkthrough.spec.js',
  outputDir: path.join(__dirname, 'browser-results'),
  workers: 1, timeout: 90000, expect: { timeout: 10000 }, reporter: [['list']],
  use: { baseURL: process.env.SLATE_BROWSER_BASE, serviceWorkers: 'block', trace: 'retain-on-failure', screenshot: 'only-on-failure' },
  projects: [
    { name: 'desktop-chrome', use: { ...devices['Desktop Chrome'] } },
    { name: 'mobile-chrome', use: { ...devices['Pixel 7'] } }
  ],
  webServer: {
    command: 'node server/index.js', cwd: root,
    url: process.env.SLATE_BROWSER_BASE + '/api/health', reuseExistingServer: false,
    env: { NODE_ENV: 'test', ...fixture.server, PORT: '4293', HOST: '127.0.0.1', DATA_DIR: process.env.COMMITTEE_AUDIT_DATA, ANTHROPIC_API_KEY: '', SLATE_EXIT_WITH_PARENT: 'true' }
  }
});
