'use strict';

// Production startup and email-only sign-in, using an isolated store.
const assert = require('assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { fork } = require('child_process');
const root = path.resolve(__dirname, '..');
const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'slate-auth-'));
const env = { ...process.env, NODE_ENV: 'production', DATA_DIR: directory,
  PORT: '0', HOST: '127.0.0.1', ANTHROPIC_API_KEY: '', TRUST_PROXY: '',
  SLATE_EMAIL_TEAM: 'team@slate.local', SLATE_EMAIL_ABE: 'abe@slate.local',
  SLATE_EMAIL_MIKE: 'mike@slate.local', SHOW_DEMO_LOGINS: 'true' };
for (const key of Object.keys(env)) if (key.startsWith('SLATE_PIN_')) delete env[key];

let server;
async function start() {
  server = fork(path.join(root, 'server/index.js'), [], {
    cwd: root, env, stdio: ['ignore', 'ignore', 'pipe', 'ipc'], windowsHide: true
  });
  let errors = '';
  server.stderr.on('data', data => { errors += data; });
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Startup timed out: ' + errors)), 15000);
    server.once('message', ({ port }) => { clearTimeout(timeout); resolve('http://127.0.0.1:' + port); });
    server.once('error', error => { clearTimeout(timeout); reject(error); });
    server.once('exit', code => { clearTimeout(timeout); reject(new Error('Startup exited ' + code + ': ' + errors)); });
  });
}
async function stop() {
  if (!server || server.exitCode !== null || server.signalCode !== null) return;
  await new Promise(resolve => { server.once('exit', resolve); server.kill(); });
}
const login = (base, body) => fetch(base + '/api/login', {
  method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body)
});

(async () => {
  try {
    let base = await start();
    assert.equal((await fetch(base + '/api/health')).status, 200);
    for (const email of ['team@slate.local', 'abe@slate.local', 'mike@slate.local']) {
      const response = await login(base, { email });
      assert.equal(response.status, 200, email);
      assert.match(response.headers.get('set-cookie'), /HttpOnly/i);
      assert.match(response.headers.get('set-cookie'), /Secure/i);
      assert.equal((await response.json()).user.email, email);
    }
    const normalized = await login(base, { email: '  ABE@SLATE.LOCAL  ' });
    assert.equal(normalized.status, 200);
    assert.equal((await normalized.json()).user.id, 'u1');
    for (const body of [{}, { email: '' }, { email: ['abe@slate.local'] }, { email: 'unknown@example.test' }]) {
      assert.equal((await login(base, body)).status, 401);
    }
    const config = await (await fetch(base + '/api/config')).json();
    assert.equal(config.demoLogins, false);
    assert.equal(config.accounts, undefined);
    await stop();

    const file = path.join(directory, 'slate.json');
    const store = JSON.parse(fs.readFileSync(file, 'utf8'));
    assert.ok(store.users.every(u => !('pin' in u) && !('pinHash' in u)));
    // Simulate a pre-upgrade store, including a disabled account and archived user.
    store.schemaVersion = 1;
    store.users.find(u => u.id === 'u1').pinHash = 'legacy-hash';
    Object.assign(store.users.find(u => u.id === 'u2'), { disabled: true, pin: 'old-pin' });
    store.archivedSearches = [{ id: 'archived-auth', archivedUsers: [{ id: 'old-member', pinHash: 'old-hash' }] }];
    fs.writeFileSync(file, JSON.stringify(store));
    base = await start();
    assert.equal((await login(base, { email: 'abe@slate.local' })).status, 200);
    assert.equal((await login(base, { email: 'mike@slate.local' })).status, 401);
    await stop();
    const upgraded = JSON.parse(fs.readFileSync(file, 'utf8'));
    assert.equal(upgraded.schemaVersion, 2);
    assert.ok(upgraded.users.every(u => !('pin' in u) && !('pinHash' in u)));
    assert.equal(upgraded.archivedSearches[0].archivedUsers[0].pinHash, undefined);
    assert.ok(fs.readdirSync(path.join(directory, 'backups')).some(n => n.startsWith('pre-migration-1-to-2-')));
    console.log('PASS  Auth: production boots without PINs; email sign-in, disabled accounts, and upgrade work');
  } finally { await stop(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
