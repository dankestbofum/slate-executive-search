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
const identity = require('./tests/identity');

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'slate-browser-'));
const PORT = 4188;

// The suite signs its own Clerk sessions, which the server verifies for real.
// The runner and its workers each load this file in their own process, so the
// throwaway key pair is written once and read back rather than regenerated.
const keyFile = path.join(os.tmpdir(), 'slate-browser-clerk-v1.json');
if (!fs.existsSync(keyFile)) fs.writeFileSync(keyFile, JSON.stringify(identity.serverEnv()));
const fixture = JSON.parse(fs.readFileSync(keyFile, 'utf8'));
process.env.SLATE_TEST_CLERK_KEY = fixture.privateKey;
// Where tests/browser/clerk.js stands the fixture workspace up, which it does
// over HTTP rather than by writing the store: a workspace is now the
// precondition for every screen that is not account setup.
process.env.SLATE_BROWSER_BASE = 'http://127.0.0.1:' + PORT;

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
    // WebKit is the engine behind every browser on iOS, so it is the one that
    // decides whether a candidate on a phone can submit a questionnaire. It is
    // a real second engine, not a user-agent string: Chromium passing says
    // nothing about how WebKit parses the CSP, the date inputs or the layout.
    // It is still desktop WebKit on this machine, not Safari on a device.
    //
    // Service workers are blocked here, and the reason matters. Playwright does
    // not intercept requests a service worker makes in WebKit, so once Slate's
    // own worker was active a reload fetched Clerk's real SDK from Clerk's real
    // CDN — the suite left the machine, and the page then failed to initialise
    // against an instance that does not exist. Blocking the worker keeps this
    // project offline. The cost is that PWA and offline behaviour is covered in
    // Chromium only.
    { name: 'desktop-safari', use: { ...devices['Desktop Safari'], serviceWorkers: 'block' } },
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
    // Ask first, then force. Without this Playwright goes straight to a hard
    // kill of the process tree, which is where the runner's teardown was
    // timing out against a server still draining browser keep-alives.
    gracefulShutdown: { signal: 'SIGTERM', timeout: 5000 },
    env: {
      NODE_ENV: 'test',
      SLATE_BILLING_MODE: 'off',
      ...fixture.server,
      PORT: String(PORT),
      HOST: '127.0.0.1',
      DATA_DIR: dataDir,
      ANTHROPIC_API_KEY: '',
      SLATE_SUPPORT_EMAIL: 'recruitment@example.gov',
      SLATE_SUPPORT_HOURS: 'Weekdays 8am-5pm Arizona time',
      // The careers portal needs the capabilities it otherwise refuses to
      // pretend to have. `echo` returns the verification message to the caller
      // so a browser test can complete a verification without a mailbox;
      // server/mailer.js resolves it to "none" under NODE_ENV=production, so
      // it cannot be switched on by a deployment.
      SLATE_MAIL_TRANSPORT: 'echo',
      SLATE_APPLICATION_UPLOADS: 'on',
      SLATE_FILE_SCANNER: 'accept-all',
      // Playwright gives this process a stdin pipe. Closing it is what tells
      // the server to go when the runner is interrupted, instead of leaving a
      // listener behind that makes the next run fail on a used port.
      SLATE_EXIT_WITH_PARENT: 'true'
    }
  }
});
