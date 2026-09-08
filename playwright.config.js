'use strict';

// Browser coverage (DEP-12).
//
// Everything else in this repository tests the server. These tests are the
// only ones that put a real browser in front of the application, which makes
// them the only place several controls are actually exercised: the
// Content-Security-Policy shipped in DEP-03 is enforced by a browser or by
// nothing, and the candidate questionnaire is used on a phone or not at all.
//
// The server runs against a throwaway data directory with no API key, so these
// never touch real records and never make a paid model call.

const os = require('os');
const path = require('path');
const fs = require('fs');
const { defineConfig, devices } = require('@playwright/test');

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'slate-browser-'));
const PORT = 4188;

module.exports = defineConfig({
  testDir: './tests/browser',
  // Deliberately serial. The store is a single JSON file with one writer, so
  // parallel specs would be testing a concurrency model the app does not have.
  workers: 1,
  fullyParallel: false,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : [['list']],
  timeout: 30000,
  expect: { timeout: 7000 },

  use: {
    baseURL: 'http://127.0.0.1:' + PORT,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure'
  },

  projects: [
    { name: 'desktop-chrome', use: { ...devices['Desktop Chrome'] } },
    // Emulation, not a real device. It catches layout and touch-target
    // problems; it does not establish real iOS or Android browser behaviour,
    // which still needs a phone in someone's hand.
    { name: 'mobile-chrome', use: { ...devices['Pixel 7'] } }
  ],

  webServer: {
    command: 'node server/index.js',
    url: 'http://127.0.0.1:' + PORT + '/api/health',
    reuseExistingServer: false,
    timeout: 30000,
    env: {
      NODE_ENV: 'test',
      PORT: String(PORT),
      HOST: '127.0.0.1',
      DATA_DIR: dataDir,
      ANTHROPIC_API_KEY: '',
      SLATE_PIN_TEAM: '1234',
      SLATE_PIN_ABE: '2468',
      SLATE_PIN_MIKE: '1357',
      SHOW_DEMO_LOGINS: 'true',
      SLATE_SUPPORT_EMAIL: 'recruitment@example.gov',
      SLATE_SUPPORT_HOURS: 'Weekdays 8am-5pm Arizona time'
    }
  }
});
