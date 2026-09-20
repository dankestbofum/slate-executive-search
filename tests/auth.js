'use strict';

// Account access and store migration, using an isolated store.
//
// The identity path itself (signed sessions, expiry, origin, missing keys) is
// covered by clerk-auth.js, and the boundary between firms by
// organizations.js. What this file adds is the account side: who a verified
// identity resolves to, what a disabled account can do, that a new account
// arrives with no authority anywhere, and that a store written before
// organizations upgrades to owning nothing rather than to owning everything.
const assert = require('assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { fork, execFileSync } = require('child_process');
const onboarding = require('../server/onboarding');
const identity = require('./identity');
const root = path.resolve(__dirname, '..');
// This suite runs its own server against its own store, so the workspace the
// shared harness stood up does not exist here. Clearing the default stops every
// signed session naming an organization that is not in this store.
delete process.env.SLATE_TEST_ORG_ID;
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
    // The onboarding stages, in isolation from any server. Each one is a
    // different reason the workspace is not open, and each needs its own screen.
    const storeFixture = { db:{ searches:[] }, memberOf:(s, id) => (s.members || []).includes(id) };
    const contextFor = (user, over = {}) => ({
      user, userId:user.id, orgId:null, organization:null, role:null,
      capabilities:{ staff:false, admin:false }, membershipLost:false, ...over
    });
    const nameless = { id:'new', email:'new@example.test', name:'new@example.test' };
    assert.equal(onboarding.status(storeFixture, contextFor(nameless)).stage, 'identity');
    const named = { id:'named', email:'named@example.test', name:'Dana Ruiz' };
    assert.equal(onboarding.status(storeFixture, contextFor(named)).stage, 'workspace');
    assert.equal(onboarding.status(storeFixture, contextFor(named, { membershipLost:true })).stage, 'membership-lost');
    const inOrg = over => contextFor(named, { orgId:'org_1', organization:{ id:'org_1', name:'Firm' }, ...over });
    assert.equal(onboarding.status(storeFixture, inOrg({ providerRole:'org:member' })).stage, 'role-pending',
      'an unmapped provider role opened the workspace');
    assert.equal(onboarding.status(storeFixture, inOrg({ role:'org:committee' })).stage, 'assignment-pending');
    assert.equal(onboarding.status(storeFixture, inOrg({ role:'org:consultant', capabilities:{ staff:true } })).stage, 'ready',
      'staff do not wait on a search assignment');
    storeFixture.db.searches.push({ organizationId:'org_1', members:['named'] });
    assert.equal(onboarding.status(storeFixture, inOrg({ role:'org:committee' })).stage, 'ready');
    assert.equal(onboarding.status(storeFixture, inOrg({ role:'org:committee' })).access, 'committee');
    // A place in another firm is not a place here.
    storeFixture.db.searches[0].organizationId = 'org_other';
    assert.equal(onboarding.status(storeFixture, inOrg({ role:'org:committee' })).stage, 'assignment-pending');
    storeFixture.db.searches.length = 0;
    let base = await start();
    assert.equal((await fetch(base + '/api/health')).status, 200);
    assert.equal((await fetch(base + '/api/me')).status, 401, 'the workspace opened without a session');

    // A verified email is the link between a Clerk identity and a Slate
    // account. The firm's seeded accounts resolve to themselves the first time
    // their holder signs in, rather than arriving as new sign-ups — but that
    // identity is all it is. None of them is in a workspace, so none of them
    // can open a record.
    for (const [email, id] of [['team@slate.local', 'u0'], ['abe@slate.local', 'u1'], ['mike@slate.local', 'u2']]) {
      const me = await as(base, email);
      assert.equal(me.status, 200, email + ' was refused: ' + me.status);
      const body = await me.json();
      assert.equal(body.user.id, id);
      assert.equal(body.onboarding.stage, 'workspace', email + ' arrived with a workspace it was never given');
      assert.equal(body.capabilities.staff, false);
      const searches = await as(base, email, '/api/searches');
      assert.equal(searches.status, 403, 'a seeded account read the book without a workspace');
      assert.equal((await searches.json()).code, 'NO_ACTIVE_ORGANIZATION');
    }
    // The same account, however the address is typed.
    assert.equal((await (await as(base, '  ABE@SLATE.LOCAL  ')).json()).user.id, 'u1');

    // Public signup starts without an assigned role or search access. The old
    // operator allowlist that used to mint a consultant here is gone: nothing
    // about an email address grants anything.
    const stranger = await as(base, 'stranger@example.test');
    assert.equal(stranger.status, 200);
    const signup = await stranger.json();
    assert.equal(signup.user.role, 'pending');
    assert.equal(signup.onboarding.required, true);
    assert.equal(signup.onboarding.stage, 'identity');
    assert.equal((await as(base, 'stranger@example.test', '/api/searches')).status, 403);

    const setup = body => fetch(base + '/api/me/onboarding', { method:'POST',
      headers:{ ...sign.headers('stranger@example.test'), 'content-type':'application/json' }, body:JSON.stringify(body) });
    assert.equal((await fetch(base + '/api/me/onboarding', { method:'POST' })).status, 401);
    for (const body of [{ name:'', requestedRole:'committee' }, { name:'Test', requestedRole:'admin' }, { name:'Test', requestedRole:'candidate' }]) {
      assert.equal((await setup(body)).status, 400);
    }
    const completed = await (await setup({ name:'New Consultant', requestedRole:'consultant', role:'consultant' })).json();
    assert.equal(completed.user.role, 'pending', 'A role preference must never grant consultant access');
    assert.equal(completed.onboarding.required, false);
    assert.equal(completed.onboarding.requestedRole, 'consultant');
    assert.equal(completed.onboarding.stage, 'workspace', 'saying you are a consultant is not joining a firm');
    assert.equal((await fetch(base + '/api/searches', { method:'POST', headers:{ ...sign.headers('stranger@example.test'), 'content-type':'application/json' }, body:JSON.stringify({ client:'Forbidden' }) })).status, 403);
    const nextLogin = await (await as(base, 'stranger@example.test')).json();
    assert.equal(nextLogin.user.name, 'New Consultant');
    assert.equal(nextLogin.onboarding.required, false);
    assert.equal(nextLogin.onboarding.access, 'pending');

    // Creating a workspace is what grants authority, and only over that
    // workspace. The searches an older store already held stay unowned.
    const workspace = await fetch(base + '/api/organizations', {
      method:'POST', headers:{ ...sign.headers('stranger@example.test'), 'content-type':'application/json' },
      body:JSON.stringify({ name:'Stranger & Partners' }) });
    assert.equal(workspace.status, 200);
    const { organization } = await workspace.json();
    const owner = sign.inOrg('stranger@example.test', organization.id, 'org:admin');
    const asOwner = await (await fetch(base + '/api/me', { headers:owner })).json();
    assert.equal(asOwner.role, 'org:admin');
    assert.equal(asOwner.capabilities.createSearch, true);
    assert.equal(asOwner.onboarding.stage, 'ready');
    assert.equal((await fetch(base + '/api/searches', { headers:owner })).status, 200);
    // And nobody else is carried into it.
    const abeThere = await fetch(base + '/api/searches', { headers:sign.inOrg('abe@slate.local', organization.id, 'org:admin') });
    assert.equal(abeThere.status, 403, 'a workspace claim from outside was honoured');

    const config = await (await fetch(base + '/api/config')).json();
    assert.equal(config.auth.provider, 'clerk');
    assert.equal(config.auth.configured, true);
    assert.equal(config.accounts, undefined, 'the public config listed accounts');
    await stop();

    // The account CLI still lists and disables; it no longer grants anything.
    const listing = execFileSync(process.execPath, [path.join(root, 'scripts/accounts.js'), 'list'], { env, windowsHide:true }).toString();
    assert.match(listing, /stranger@example\.test/);
    assert.match(listing, /Stranger & Partners:admin/, 'the account listing did not show the workspace role');
    const file = path.join(directory, 'slate.json');
    const store = JSON.parse(fs.readFileSync(file, 'utf8'));
    assert.ok(store.users.every(u => !('pin' in u) && !('pinHash' in u)));
    // A search written before organizations existed. It must come out of the
    // migration owned by nobody, not owned by whoever signs in first.
    store.searches.push({ id:'sr-legacy', no:'SR-LEGACY', client:'Legacy County', position:'Administrator',
      createdBy:'u1', createdAt:'2024-01-01T00:00:00.000Z', members:[{ userId:'u1', seat:'manager' }],
      // Intake in the old one-record-per-member shape: one answer that was
      // sent, and one that never was.
      intake: { status:'closed', dueBy:'', prompt:'', openedAt:'2024-01-02T00:00:00.000Z', closedAt:'2024-01-09T00:00:00.000Z',
        submissions: {
          u1: { submitted:true, items:[{ kind:'skill', label:'Budgeting', weight:4 }], mustHave:'Fiscal grip',
            dealBreaker:'', context:'', at:'2024-01-03T00:00:00.000Z', updatedAt:'2024-01-04T00:00:00.000Z' },
          u2: { submitted:false, items:[{ kind:'trait', label:'Patience', weight:2 }], mustHave:'',
            dealBreaker:'', context:'Not finished', at:'2024-01-05T00:00:00.000Z', updatedAt:'2024-01-05T00:00:00.000Z' }
        } },
      candidates:[], activity:[], criteria:[], artifacts:{}, staff:{}, scores:{}, notesBy:{}, reviews:{} });
    // Simulate a pre-upgrade store: credentials, a live session table, a
    // disabled account and an archived user.
    store.schemaVersion = 1;
    store.sessions = { legacy: { userId: 'u1', exp: Date.now() + 3600000 } };
    store.users.find(u => u.id === 'u1').pinHash = 'legacy-hash';
    store.users.find(u => u.id === 'u0').disabled = true;
    Object.assign(store.users.find(u => u.id === 'u2'), { disabled: true, pin: 'old-pin' });
    // An archived roster and a held place, both still spelled `seat`. They
    // migrate with the live ones or an archive restores a roster nobody reads.
    store.archivedSearches = [{ id: 'archived-auth', archivedUsers: [{ id: 'old-member', pinHash: 'old-hash' }],
      members: [{ userId: 'old-member', seat: 'committee' }] }];
    store.pendingAssignments = [{ id: 'pa-legacy', orgId: 'org-legacy', searchId: 'sr-legacy',
      email: 'held@example.test', name: 'Held Person', seat: 'committee' }];
    fs.writeFileSync(file, JSON.stringify(store));
    base = await start();
    const migrated = JSON.parse(fs.readFileSync(file, 'utf8'));
    assert.equal(migrated.searches.find(s => s.id === 'sr-legacy').organizationId, null,
      'a legacy search was handed an owner by the migration');
    // Unowned means unreadable, including by the administrator of the only
    // workspace in the store. Mapping it is a deliberate migration step.
    const ownerAgain = sign.inOrg('stranger@example.test', organization.id, 'org:admin');
    assert.equal((await fetch(base + '/api/searches/sr-legacy', { headers:ownerAgain })).status, 404);
    assert.deepEqual(await (await fetch(base + '/api/searches', { headers:ownerAgain })).json(), []);

    // The migration command maps it, and only then does it open. It runs
    // against the store directly, so the server has to be down: the JSON store
    // takes one writer, and the lock enforces it rather than documenting it.
    await stop();
    execFileSync(process.execPath, [path.join(root, 'scripts/organizations.js'), 'adopt',
      '--org', organization.id, '--name', 'Stranger & Partners'], { env, windowsHide:true });
    const stillUnowned = JSON.parse(fs.readFileSync(file, 'utf8'));
    assert.equal(stillUnowned.searches.find(s => s.id === 'sr-legacy').organizationId, null,
      'a dry run wrote to the store');
    execFileSync(process.execPath, [path.join(root, 'scripts/organizations.js'), 'adopt',
      '--org', organization.id, '--name', 'Stranger & Partners', '--apply'], { env, windowsHide:true });
    base = await start();
    assert.equal((await fetch(base + '/api/searches/sr-legacy', { headers:ownerAgain })).status, 200);

    const approved = await (await as(base, 'stranger@example.test')).json();
    assert.equal(approved.onboarding.required, false);

    // A disabled account is refused with its identity proven, which is a
    // different answer from never having signed in.
    assert.equal((await as(base, 'team@slate.local')).status, 403);
    assert.equal((await as(base, 'mike@slate.local')).status, 403);
    assert.equal((await as(base, 'abe@slate.local')).status, 200);
    // The cookie the old session table was read from is now just a cookie.
    assert.equal((await fetch(base + '/api/me', { headers: { cookie: 'slate_sid=legacy' } })).status, 401);
    await stop();

    const upgraded = JSON.parse(fs.readFileSync(file, 'utf8'));
    assert.equal(upgraded.schemaVersion, 7);
    // 6 -> 7 split a member's private draft from their committed answer. A
    // legacy record is read for what it actually was, and nothing invents a
    // submitted version the old schema had already overwritten.
    const legacyIntake = upgraded.searches.find(s => s.id === 'sr-legacy').intake;
    assert.equal(legacyIntake.submissions, undefined, 'the legacy submissions map survived the migration');
    assert.equal(legacyIntake.responses.u1.draft, null, 'a submitted answer was turned into a draft');
    assert.equal(legacyIntake.responses.u1.submitted.mustHave, 'Fiscal grip', 'a submitted answer lost its text');
    assert.equal(legacyIntake.responses.u1.submitted.at, '2024-01-03T00:00:00.000Z', 'a submitted answer lost its timestamp');
    assert.equal(legacyIntake.responses.u2.submitted, null, 'an unsent draft was published as a submission');
    assert.equal(legacyIntake.responses.u2.draft.context, 'Not finished', 'an unsent draft lost its text');
    assert.equal(legacyIntake.responses.u1.revision, 1, 'response revisions were not initialized');
    // 5 -> 6 added the research job table. It starts empty; a legacy store has
    // no research history to reconstruct.
    assert.ok(Array.isArray(upgraded.researchJobs), 'the research job table was not created');
    // 4 -> 5 renamed the field the roster is read through. A row left at the old
    // spelling reads as no role at all, so all three places it lives are checked.
    const legacyRoster = upgraded.searches.find(s => s.id === 'sr-legacy').members[0];
    assert.equal(legacyRoster.searchRole, 'manager', 'a live roster kept the old spelling');
    assert.ok(!('seat' in legacyRoster), 'the old field survived the migration');
    const archivedRoster = upgraded.archivedSearches.find(s => s.id === 'archived-auth').members[0];
    assert.equal(archivedRoster.searchRole, 'committee', 'an archived roster kept the old spelling');
    assert.ok(!('seat' in archivedRoster), 'the old field survived on an archived roster');
    const heldPlace = upgraded.pendingAssignments.find(p => p.id === 'pa-legacy');
    assert.equal(heldPlace.searchRole, 'committee', 'a held place kept the old spelling');
    assert.ok(!('seat' in heldPlace), 'the old field survived on a held place');
    assert.ok(Array.isArray(upgraded.organizations) && Array.isArray(upgraded.memberships)
      && Array.isArray(upgraded.pendingAssignments), 'the organization tables were not created');
    assert.equal(upgraded.sessions, undefined, 'the session table survived the migration');
    assert.ok(upgraded.users.every(u => !('pin' in u) && !('pinHash' in u)));
    assert.equal(upgraded.archivedSearches[0].archivedUsers[0].pinHash, undefined);
    assert.ok(fs.readdirSync(path.join(directory, 'backups')).some(n => n.startsWith('pre-migration-1-to-7-')));
    console.log('PASS  Account linking, disabled accounts, public sign-up, workspace creation, and migration to organization ownership');
  } finally { await stop(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
