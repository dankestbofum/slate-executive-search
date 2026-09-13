'use strict';
// Real Clerk JWT verification using an ephemeral RSA key, no network or credentials.
const assert = require('assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { fork } = require('child_process');
const { configuration, resolveUser } = require('../server/auth');
const root = path.resolve(__dirname, '..');
// This suite runs its own server against its own store, so the workspace the
// shared harness stood up does not exist here. Clearing the default stops every
// signed session naming an organization that is not in this store.
delete process.env.SLATE_TEST_ORG_ID;
const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'slate-clerk-'));
const env = { ...process.env, NODE_ENV:'production', DATA_DIR:directory, PORT:'0', HOST:'127.0.0.1',
  ANTHROPIC_API_KEY:'', TRUST_PROXY:'', CLERK_PUBLISHABLE_KEY:'', CLERK_SECRET_KEY:'', CLERK_JWT_KEY:'',
  CLERK_AUTHORIZED_PARTIES:'http://localhost:4173', SLATE_CLERK_FIXTURE:'true' };
const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength:2048 });
let server;
async function start() {
  server = fork(path.join(root, 'server/index.js'), [], { cwd:root, env, stdio:['ignore','ignore','pipe','ipc'], windowsHide:true });
  let errors = '';
  server.stderr.on('data', data => { errors += data; });
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(Error('Startup timed out: ' + errors)), 20000);
    server.once('message', ({ port }) => { clearTimeout(timer); resolve('http://127.0.0.1:' + port); });
    server.once('error', error => { clearTimeout(timer); reject(error); });
    server.once('exit', code => { clearTimeout(timer); reject(Error('Startup exited ' + code + ': ' + errors)); });
  });
}
async function stop() {
  if (server && server.exitCode === null && server.signalCode === null) await new Promise(resolve => { server.once('exit', resolve); server.kill(); });
}
function token(overrides = {}) {
  const now = Math.floor(Date.now()/1000);
  const encode = value => Buffer.from(JSON.stringify(value)).toString('base64url');
  const body = encode({ alg:'RS256', typ:'JWT', kid:'fixture' }) + '.' + encode({
    iss:'https://fixture.clerk.accounts.dev', sub:'user_fixture', sid:'sess_fixture',
    azp:'http://localhost:4173', iat:now, nbf:now-10, exp:now+120, ...overrides });
  return body + '.' + crypto.sign('RSA-SHA256', Buffer.from(body), privateKey).toString('base64url');
}
function editStore(update) {
  const file = path.join(directory, 'slate.json');
  const store = JSON.parse(fs.readFileSync(file, 'utf8'));
  update(store); fs.writeFileSync(file, JSON.stringify(store));
}
async function identityChecks() {
  const store = { db:{ users:[{ id:'invited', email:'invited@example.test', role:'committee' }] },
    isDisabled:u => Boolean(u.disabled), persist() {},
    findUserByEmail(email) { return this.db.users.find(u => u.email === email); },
    createUser(input) { const user = { ...input, id:'new-' + this.db.users.length }; this.db.users.push(user); return { user }; } };
  const profile = (email, verified = true) => async () => ({ primaryEmailAddressId:'primary', emailAddresses:[{
    id:'primary', emailAddress:email, verification:{ status:verified ? 'verified' : 'unverified' } }] });
  assert.equal(await resolveUser(store, 'unverified', profile('invited@example.test', false)), null);
  const invited = await resolveUser(store, 'clerk_invited', profile('invited@example.test'));
  assert.equal(invited.id, 'invited'); assert.equal(invited.role, 'committee');
  assert.equal(await resolveUser(store, 'different', profile('invited@example.test')), null);
  invited.disabled = true;
  assert.equal(await resolveUser(store, 'clerk_invited', () => { throw Error('Must not fetch'); }), null);
  // Every new account arrives with no authority, whatever its address. The
  // operator allowlist that used to mint a consultant here is gone: a global
  // grant would sit above organization membership and defeat the point of it.
  assert.equal((await resolveUser(store, 'public', profile('new@example.test'))).role, 'pending');
  assert.equal((await resolveUser(store, 'owner', profile('owner@example.test'))).role, 'pending');
  assert.equal(resolveUser.length, 3, 'resolveUser still takes an allowlist argument');
  const concurrent = await Promise.all([1,2].map(() => resolveUser(store, 'concurrent', profile('concurrent@example.test'))));
  assert.equal(concurrent[0].id, concurrent[1].id);
  assert.equal(store.db.users.filter(u => u.clerkUserId === 'concurrent').length, 1);
  console.log('PASS  Clerk identity: verified email, role preservation, public signup with no authority, disabled users, concurrent linking');
}

/**
 * The access context, against a directory under our control.
 *
 * The rule this proves is the one the whole feature stands on: a role comes
 * from the provider on every request, never from the token. A session token can
 * claim anything it likes; without a membership the directory confirms, the
 * request gets nothing.
 */
async function accessChecks() {
  const { buildAccess } = require('../server/auth');
  const organizations = require('../server/organizations');
  const user = { id:'u1', email:'abe@example.test', name:'Abe' };
  const store = {
    db:{ organizations:[], memberships:[], pendingAssignments:[], searches:[] },
    persist() {}, memberOf: () => null, now: () => 'now', touch() {}, initials: () => 'AM'
  };
  const directory = roles => ({
    async membership(orgId) { return roles[orgId] ? { role: roles[orgId] } : null; },
    async organization(orgId) { return { id: orgId, name: 'Firm ' + orgId }; }
  });

  const none = await buildAccess(store, directory({}), user, 'clerk_u1', null);
  assert.equal(none.orgId, null);
  assert.equal(none.capabilities.staff, false);
  assert.equal(none.membershipLost, false, 'no active workspace was reported as a lost membership');

  const revoked = await buildAccess(store, directory({}), user, 'clerk_u1', 'org_gone');
  assert.equal(revoked.orgId, null, 'a token naming a workspace opened it with no membership behind it');
  assert.equal(revoked.membershipLost, true);

  const consultant = await buildAccess(store, directory({ org_a:'org:consultant' }), user, 'clerk_u1', 'org_a');
  assert.equal(consultant.role, 'org:consultant');
  assert.equal(consultant.capabilities.staff, true);
  assert.equal(consultant.capabilities.manageMembers, false);

  // Clerk's own default role is a membership with no Slate meaning.
  const plain = await buildAccess(store, directory({ org_a:'org:member' }), user, 'clerk_u1', 'org_a');
  assert.equal(plain.orgId, 'org_a');
  assert.equal(plain.role, null, 'org:member was read as a Slate role');
  assert.equal(plain.providerRole, 'org:member');
  assert.deepEqual(plain.capabilities, organizations.NO_CAPABILITIES);

  // An outage fails closed rather than falling back to the cache it just wrote.
  const outage = {
    async membership() { throw organizations.unavailable(new Error('down')); },
    async organization() { return null; }
  };
  await assert.rejects(() => buildAccess(store, outage, user, 'clerk_u1', 'org_a'), /verify your workspace membership/);
  console.log('PASS  Access context: the provider decides the role, an unmapped role decides nothing, an outage fails closed');
}
(async () => {
  try {
    assert.equal(configuration(env).fixtureDirectory, false, 'Production ignores the test identity fixture');
    await identityChecks();
    await accessChecks();
    let base = await start();
    assert.equal((await fetch(base + '/api/health')).status, 200);
    assert.equal((await fetch(base + '/api/me')).status, 503, 'Missing keys fail closed');
    for (const route of ['/api/start','/api/login','/api/logout']) assert.equal((await fetch(base + route, { method:'POST' })).status, 404, route);
    await stop();
    editStore(store => { store.users.find(u => u.id === 'u1').clerkUserId = 'user_fixture'; store.sessions = { legacy:{ userId:'u1', exp:Date.now()+60000 } }; });
    env.CLERK_PUBLISHABLE_KEY = 'pk_test_' + Buffer.from('fixture.clerk.accounts.dev$').toString('base64').replace(/=+$/, '');
    env.CLERK_SECRET_KEY = 'sk_test_offline_fixture';
    env.CLERK_JWT_KEY = publicKey.export({ type:'spki', format:'pem' });
    base = await start();
    const config = await (await fetch(base + '/api/config')).json();
    assert.equal(config.auth.provider, 'clerk'); assert.equal(config.auth.configured, true);
    assert.equal(config.accounts, undefined); assert.ok(!JSON.stringify(config).includes(env.CLERK_SECRET_KEY));
    for (const route of ['/api/me','/api/searches','/media/private/cover.jpg']) assert.equal((await fetch(base + route, { headers:{ cookie:'slate_sid=legacy' } })).status, 401, route);
    // A brochure photo is never served to an ambient cookie, whatever it holds:
    // Clerk's cookie carries whichever workspace was selected most recently in
    // any tab, which is not necessarily the one the page is showing.
    assert.equal((await fetch(base + '/media/any/cover.jpg')).status, 401);
    const headers = { authorization:'Bearer ' + token() };
    const me = await fetch(base + '/api/me', { headers });
    assert.equal(me.status, 200, await me.clone().text());
    const body = await me.json();
    assert.equal(body.user.id, 'u1');
    // Proven identity and no workspace: account setup opens, records do not.
    assert.equal(body.onboarding.stage, 'workspace');
    assert.equal((await fetch(base + '/api/searches', { headers })).status, 403);
    // A session Clerk is holding on an unanswered task is a person who has not
    // chosen a workspace yet, not a failure to sign in, and says which it is.
    const held = await fetch(base + '/api/me', { headers:{ authorization:'Bearer ' + token({ sts:'pending' }) } });
    assert.equal(held.status, 401);
    assert.equal((await held.json()).code, 'SESSION_TASK_PENDING');
    for (const invalid of [token({ exp:1 }), token({ azp:'https://attacker.example' }), token().slice(0,-15)+'invalid']) {
      assert.equal((await fetch(base + '/api/me', { headers:{ authorization:'Bearer ' + invalid } })).status, 401);
    }
    const csp = (await fetch(base)).headers.get('content-security-policy');
    assert.match(csp, /https:\/\/fixture.clerk.accounts.dev/);
    assert.doesNotMatch(csp.split(';').map(d => d.trim()).find(d => d.startsWith('script-src')), /unsafe-inline|unsafe-eval/);
    assert.doesNotMatch((await fetch(base + '/apply/invalid')).headers.get('content-security-policy'), /clerk|unsafe-inline/);
    await stop(); editStore(store => { store.users.find(u => u.id === 'u1').disabled = true; });
    base = await start(); assert.equal((await fetch(base + '/api/me', { headers })).status, 403);
    console.log('PASS  Clerk API: signed JWTs, expiry, signature, origin, pending session tasks, disabled users, missing keys, retired sign-in routes, CSP');
  } finally { await stop(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
