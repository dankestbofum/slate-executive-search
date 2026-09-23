'use strict';

// Offline browser reproduction of the pending-session invitation state.
// Uses a fixture-signed Clerk JWT and a deliberately small browser SDK stub.
// It cannot verify Clerk's hosted UI or consume an invitation ticket.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { fork } = require('node:child_process');
const { chromium } = require('@playwright/test');
const identity = require('../../../../tests/identity');

const root = path.resolve(__dirname, '../../../..');
const fixture = identity.serverEnv();
const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'slate-pending-audit-'));
const port = 44721;
const base = `http://127.0.0.1:${port}`;
const email = 'pending-audit@example.test';
const token = identity.signer(fixture.privateKey).pending(email).authorization.slice(7);
let server;
let browser;

async function ready() {
  for (let i = 0; i < 60; i++) {
    try { if ((await fetch(base + '/api/health')).ok) return; } catch {}
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  throw new Error('Fixture server did not become ready');
}

(async () => {
  server = fork(path.join(root, 'server/index.js'), [], {
    cwd: root,
    env: { ...process.env, ...fixture.server, NODE_ENV: 'test', HOST: '127.0.0.1', PORT: String(port), DATA_DIR: directory,
      ANTHROPIC_API_KEY: '', SLATE_BILLING_MODE: 'off' },
    stdio: ['ignore', 'ignore', 'pipe', 'ipc'], windowsHide: true
  });
  await ready();
  const response = await fetch(base + '/api/me', { headers: { authorization: `Bearer ${token}` } });
  const body = await response.json();
  assert.equal(response.status, 401);
  assert.equal(body.code, 'SESSION_TASK_PENDING');

  browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ serviceWorkers: 'block' });
  await context.route('https://fixture.clerk.accounts.dev/npm/**', route => {
    const source = route.request().url().includes('/@clerk/ui@')
      ? 'window.__internal_ClerkUICtor = class ClerkUI {};'
      : `window.Clerk = {
          user: { id: 'user_pending_fixture' },
          session: { id: 'sess_pending_fixture', currentTask: { key: 'choose-organization' },
            getToken: async () => ${JSON.stringify(token)} },
          organization: null,
          load: async () => {}, addListener: () => {},
          mountSignIn: () => { window.__signInMounted = true; },
          mountSignUp: () => { window.__signUpMounted = true; }
        };`;
    return route.fulfill({ status: 200, contentType: 'application/javascript',
      headers: { 'access-control-allow-origin': '*' }, body: source });
  });
  const page = await context.newPage();
  await page.goto(base + '/join/sign-in?__clerk_status=sign_in&__clerk_ticket=fixture-ticket');
  await page.getByRole('heading', { name: 'Join your search team' }).waitFor();
  const observed = await page.evaluate(() => ({
    url: location.pathname + location.search,
    task: window.SlateAuth.pendingTask,
    signedIn: window.SlateAuth.signedIn,
    panelPresent: !!document.querySelector('[data-clerk-auth]'),
    panelChildren: document.querySelector('[data-clerk-auth]')?.children.length,
    signInMounted: !!window.__signInMounted,
    accountRecovery: !!document.querySelector('[data-act="logout"]')
  }));
  process.stdout.write(JSON.stringify({ api: { status: response.status, code: body.code }, browser: observed }, null, 2) + '\n');
  assert.equal(observed.task, 'choose-organization');
  assert.equal(observed.panelPresent, true);
  assert.equal(observed.panelChildren, 0);
  assert.equal(observed.signInMounted, false);
  // The signed-in header has a sign-out control, but it may sit in a collapsed
  // navigation menu. It does not resolve the pending task.
})().catch(error => { console.error(error); process.exitCode = 1; }).finally(async () => {
  if (browser) await browser.close();
  if (server) server.kill();
  fs.rmSync(directory, { recursive: true, force: true });
});
