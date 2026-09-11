'use strict';

// Account access and store migration, using an isolated store.
//
// The identity path itself (signed sessions, expiry, origin, missing keys) is
// covered by clerk-auth.js. What this file adds is the account side: who a
// verified identity resolves to, what a disabled account can do, and that a
// store written before Clerk upgrades cleanly and loses its old credentials.
const assert = require('assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { fork } = require('child_process');
const identity = require('./identity');
const root = path.resolve(__dirname, '..');
const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'slate-auth-'));
const fixture = identity.serverEnv();
const sign = identity.signer(fixture.privateKey);
const env = { ...process.env, NODE_ENV: 'test', DATA_DIR: directory,
  PORT: '0', HOST: '127.0.0.1', ANTHROPIC_API_KEY: '', TRUST_PROXY: '', ...fixture.server,
  SLATE_EMAIL_TEAM: 'team@slate.local', SLATE_EMAIL_ABE: 'abe@slate.local',
  SLATE_EMAIL_MIKE: 'mike@slate.local' };

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
const as = (base, email, route = '/api/me') => fetch(base + route, { headers: sign.headers(email) });

(async () => {
  try {
    let base = await start();
    assert.equal((await fetch(base + '/api/health')).status, 200);
    assert.equal((await fetch(base + '/api/me')).status, 401, 'the workspace opened without a session');

    // A verified email is the link between a Clerk identity and a Slate
    // account. The firm's seeded accounts keep their roles the first time
    // their holder signs in, rather than arriving as new sign-ups.
    for (const [email, id] of [['team@slate.local', 'u0'], ['abe@slate.local', 'u1'], ['mike@slate.local', 'u2']]) {
      const me = await as(base, email);
      assert.equal(me.status, 200, email + ' was refused: ' + me.status);
      const body = await me.json();
      assert.equal(body.user.id, id);
      assert.equal(body.user.role, 'consultant');
    }
    // The same account, however the address is typed.
    assert.equal((await (await as(base, '  ABE@SLATE.LOCAL  ')).json()).user.id, 'u1');

    // Somebody with no Slate account gets committee access and nothing on it,
    // which is what makes an invitation email enough to seat someone.
    const stranger = await as(base, 'stranger@example.test');
    assert.equal(stranger.status, 200);
    assert.equal((await stranger.json()).user.role, 'committee');
    assert.deepEqual(await (await as(base, 'stranger@example.test', '/api/searches')).json(), []);

    const config = await (await fetch(base + '/api/config')).json();
    assert.equal(config.auth.provider, 'clerk');
    assert.equal(config.auth.configured, true);
    assert.equal(config.accounts, undefined, 'the public config listed accounts');
    await stop();

    const file = path.join(directory, 'slate.json');
    const store = JSON.parse(fs.readFileSync(file, 'utf8'));
    assert.ok(store.users.every(u => !('pin' in u) && !('pinHash' in u)));
    // Simulate a pre-upgrade store: credentials, a live session table, a
    // disabled account and an archived user.
    store.schemaVersion = 1;
    store.sessions = { legacy: { userId: 'u1', exp: Date.now() + 3600000 } };
    store.users.find(u => u.id === 'u1').pinHash = 'legacy-hash';
    store.users.find(u => u.id === 'u0').disabled = true;
    Object.assign(store.users.find(u => u.id === 'u2'), { disabled: true, pin: 'old-pin' });
    store.archivedSearches = [{ id: 'archived-auth', archivedUsers: [{ id: 'old-member', pinHash: 'old-hash' }] }];
    fs.writeFileSync(file, JSON.stringify(store));
    base = await start();

    // A disabled account is refused with its identity proven, which is a
    // different answer from never having signed in.
    assert.equal((await as(base, 'team@slate.local')).status, 403);
    assert.equal((await as(base, 'mike@slate.local')).status, 403);
    assert.equal((await as(base, 'abe@slate.local')).status, 200);
    // The cookie the old session table was read from is now just a cookie.
    assert.equal((await fetch(base + '/api/me', { headers: { cookie: 'slate_sid=legacy' } })).status, 401);
    await stop();

    const upgraded = JSON.parse(fs.readFileSync(file, 'utf8'));
    assert.equal(upgraded.schemaVersion, 3);
    assert.equal(upgraded.sessions, undefined, 'the session table survived the migration');
    assert.ok(upgraded.users.every(u => !('pin' in u) && !('pinHash' in u)));
    assert.equal(upgraded.archivedSearches[0].archivedUsers[0].pinHash, undefined);
    assert.ok(fs.readdirSync(path.join(directory, 'backups')).some(n => n.startsWith('pre-migration-1-to-3-')));
    console.log('PASS  Account linking, disabled accounts, public sign-up, and store migration');
  } finally { await stop(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
