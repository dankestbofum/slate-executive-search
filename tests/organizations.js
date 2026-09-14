'use strict';

/**
 * Organization isolation.
 *
 * The question this file exists to answer is narrow and absolute: can anything
 * in firm B reach anything in firm A? Every other suite runs inside one
 * workspace and takes that boundary for granted, so this is the one that has to
 * prove it — across reads, writes, listings, counts, archives, exports, media,
 * and the administration routes — and has to prove that a forged organization
 * claim buys nothing, because the session token is the only place an active
 * organization can come from.
 */
const assert = require('assert/strict');
const identity = require('./identity');

const base = process.env.SLATE_URL;
const sign = identity.signer();
const JSON_HEADERS = { 'content-type': 'application/json' };

// The workspace tests/run.js stood up, and the accounts in it.
const A = process.env.SLATE_TEST_ORG_ID;
const ABE = 'abe@slate.local';
const MIKE = 'mike@slate.local';

let passed = 0, failed = 0;
function ok(what) { passed += 1; console.log('PASS  ' + what); }
function bad(what, detail) { failed += 1; console.error('FAIL  ' + what + (detail ? '\n      ' + detail : '')); }
async function check(what, fn) {
  try { await fn(); ok(what); }
  catch (error) { bad(what, error.message); }
}

const as = (email, orgId, role) => orgId === null
  ? sign.headers(email, { org_id: undefined, org_role: undefined })
  : sign.inOrg(email, orgId || A, role || 'org:consultant');

async function call(route, { email = ABE, org, role, method = 'GET', body, etag } = {}) {
  const res = await fetch(base + route, {
    method,
    headers: {
      ...as(email, org, role), ...JSON_HEADERS,
      ...(etag !== undefined ? { 'if-match': String(etag) } : {})
    },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  let data = null;
  try { data = await res.json(); } catch { /* some routes answer with bytes */ }
  return { status: res.status, body: data, res };
}

async function newSearch(fields, who = {}) {
  const out = await call('/api/searches', { method: 'POST', body: fields, ...who });
  assert.equal(out.status, 200, 'could not open ' + fields.client + ': ' + JSON.stringify(out.body));
  return out.body;
}

(async () => {
  assert.ok(base, 'Run this suite through tests/run.js.');
  assert.ok(A, 'The harness did not supply a workspace. Run this suite through tests/run.js.');

  /* --- a second firm, created the way a real one is ---------------------- */
  const ownerB = 'owner-b@other.example';
  const created = await call('/api/organizations', {
    email: ownerB, org: null, method: 'POST', body: { name: 'Second Firm Partners' }
  });
  assert.equal(created.status, 200, 'could not create the second workspace: ' + JSON.stringify(created.body));
  const B = created.body.organization.id;
  assert.notEqual(A, B);

  const inA = await newSearch({ client: 'Isolation City', position: 'City Manager' });
  const inB = await newSearch({ client: 'Second Firm County', position: 'County Administrator' },
    { email: ownerB, org: B, role: 'org:admin' });

  const fromB = { email: ownerB, org: B, role: 'org:admin' };

  /* --- reads ------------------------------------------------------------- */
  await check('B cannot read A’s search, and cannot tell it from one that does not exist', async () => {
    const found = await call('/api/searches/' + inA.id, fromB);
    const invented = await call('/api/searches/sr-does-not-exist', fromB);
    assert.equal(found.status, 404);
    assert.equal(invented.status, 404);
    assert.deepEqual(found.body, invented.body, 'the two answers differed, which is itself a disclosure');
  });

  await check('neither firm’s portfolio lists the other’s searches or counts', async () => {
    const a = await call('/api/searches');
    const b = await call('/api/searches', fromB);
    assert.ok(a.body.some(s => s.id === inA.id));
    assert.ok(!a.body.some(s => s.id === inB.id));
    assert.ok(b.body.some(s => s.id === inB.id));
    assert.ok(!b.body.some(s => s.id === inA.id), 'B’s portfolio contained A’s search');
    assert.equal(b.body.length, 1, 'B’s portfolio revealed how much work A has');
  });

  await check('the staff directory does not carry the other firm’s people', async () => {
    const b = await call('/api/me', fromB);
    const emails = b.body.users.map(u => u.email);
    assert.ok(emails.includes(ownerB));
    for (const leak of [ABE, MIKE]) assert.ok(!emails.includes(leak), leak + ' was listed to another firm');
  });

  /* --- writes ------------------------------------------------------------ */
  await check('every write path into another firm’s search is refused', async () => {
    const writes = [
      ['PATCH', '/api/searches/' + inA.id, { client: 'Renamed by B' }],
      ['PUT', '/api/searches/' + inA.id + '/profile', { criteria: [] }],
      ['POST', '/api/searches/' + inA.id + '/members', { name: 'B Person', email: 'b@other.example', searchRole: 'committee' }],
      ['POST', '/api/searches/' + inA.id + '/candidates', { name: 'B Candidate' }],
      ['POST', '/api/searches/' + inA.id + '/team/confirm', { confirmed: true }],
      ['DELETE', '/api/searches/' + inA.id, undefined],
      ['PUT', '/api/searches/' + inA.id + '/scores/x', { scores: {} }]
    ];
    for (const [method, route, body] of writes) {
      const out = await call(route, { ...fromB, method, body, etag: inA.revision });
      assert.equal(out.status, 404, method + ' ' + route + ' answered ' + out.status);
    }
    const after = await call('/api/searches/' + inA.id);
    assert.equal(after.body.client, 'Isolation City', 'A’s search was modified from B');
  });

  await check('a forged organization id in the request body changes no ownership', async () => {
    const forged = await newSearch({ client: 'Forged Owner', position: 'Clerk', organizationId: B }, fromB);
    assert.equal(forged.organizationId, B, 'ownership came from the body rather than the session');
    const stolen = await call('/api/searches/' + forged.id);
    assert.equal(stolen.status, 404, 'A could read a search created in B');
  });

  /* --- the session token is the only source of an active organization ---- */
  await check('a session claiming a workspace it has no membership in gets nothing', async () => {
    const forged = await call('/api/searches/' + inA.id, { email: ownerB, org: A, role: 'org:admin' });
    assert.equal(forged.status, 403, 'a forged organization claim was honoured');
    assert.equal(forged.body.code, 'NO_ACTIVE_ORGANIZATION');
    const list = await call('/api/searches', { email: ownerB, org: A, role: 'org:admin' });
    assert.equal(list.status, 403);
  });

  await check('founding a workspace is open outside production, and only there', async () => {
    const { configuration } = require('../server/auth');
    assert.equal(configuration({ NODE_ENV:'production' }).openWorkspaceCreation, false);
    const me = await call('/api/me', { email: 'founder-check@example.test', org: null });
    assert.equal(me.body.canCreateWorkspace, true, 'the suite could not have created the workspaces it just used');
  });

  await check('a session with no workspace at all reaches no records', async () => {
    const stranger = 'no-workspace@example.test';
    for (const route of ['/api/searches', '/api/archives', '/api/searches/' + inA.id]) {
      const out = await call(route, { email: stranger, org: null });
      assert.equal(out.status, 403, route + ' answered ' + out.status);
      assert.equal(out.body.code, 'NO_ACTIVE_ORGANIZATION');
    }
    const me = await call('/api/me', { email: stranger, org: null });
    assert.equal(me.status, 200, 'account setup has to stay reachable without a workspace');
    assert.equal(me.body.onboarding.stage, 'identity');
  });

  await check('an unmapped workspace role opens nothing', async () => {
    const outsider = 'plain-member@other.example';
    // Join B with Clerk's own org:member, which Slate deliberately does not map.
    await call('/api/organization/invitations', {
      ...fromB, method: 'POST', body: { email: outsider, role: 'org:committee' }
    });
    await call('/api/me', { email: outsider, org: B, role: 'org:committee' });
    const me = await call('/api/me', { email: outsider, org: B, role: 'org:committee' });
    assert.equal(me.body.onboarding.access, 'committee');
    assert.equal(me.body.capabilities.staff, false, 'a committee member was given staff capabilities');
    assert.equal(me.body.capabilities.manageMembers, false);
    const searches = await call('/api/searches', { email: outsider, org: B, role: 'org:committee' });
    assert.deepEqual(searches.body, [], 'a workspace member with no assignment saw the firm’s searches');
  });

  /* --- archives, exports, media ------------------------------------------ */
  await check('archives are scoped, and another firm’s archive cannot be listed or restored', async () => {
    const doomed = await newSearch({ client: 'Archive Test', position: 'Manager' });
    const archived = await call('/api/account/start-fresh', {
      method: 'POST', body: { ids: [inA.id, doomed.id, ...((await call('/api/searches')).body
        .filter(s => s.searchRole === 'manager' && ![inA.id, doomed.id].includes(s.id)).map(s => s.id)) ] }
    });
    assert.equal(archived.status, 200, JSON.stringify(archived.body));
    const listA = await call('/api/archives');
    const listB = await call('/api/archives', fromB);
    assert.ok(listA.body.some(s => s.id === doomed.id));
    assert.ok(!listB.body.some(s => s.id === doomed.id), 'B listed A’s archived search');
    const restore = await call('/api/archives/' + doomed.id + '/restore', { ...fromB, method: 'POST', body: {} });
    assert.equal(restore.status, 404, 'B restored A’s archived search');
    const back = await call('/api/archives/' + doomed.id + '/restore', { method: 'POST', body: {} });
    assert.equal(back.status, 200);
  });

  await check('an export is the same authority in another format, not a wider one', async () => {
    const mine = await call('/api/searches/' + inB.id + '/export', fromB);
    assert.equal(mine.status, 200);
    const theirs = await call('/api/searches/' + inB.id + '/export');
    assert.equal(theirs.status, 404, 'A exported B’s search');
  });

  await check('a brochure photo needs the page’s own session, not an ambient cookie', async () => {
    const res = await fetch(base + '/media/' + inB.id + '/cover.jpg');
    assert.equal(res.status, 401, 'an unauthenticated image request was not refused');
    const withSession = await fetch(base + '/media/' + inB.id + '/cover.jpg', { headers: as(ABE, A) });
    assert.equal(withSession.status, 404, 'A reached B’s media directory');
  });

  /* --- administration ---------------------------------------------------- */
  await check('only an administrator reaches the administration routes', async () => {
    const routes = [
      ['GET', '/api/organization/members', undefined],
      ['POST', '/api/organization/invitations', { email: 'x@other.example', role: 'org:admin' }],
      ['DELETE', '/api/organization/invitations/orginv_1', undefined],
      ['PATCH', '/api/organization/members/user_x', { role: 'org:admin' }],
      ['DELETE', '/api/organization/members/user_x', undefined]
    ];
    for (const [method, route, body] of routes) {
      const out = await call(route, { email: MIKE, method, body });
      assert.equal(out.status, 403, method + ' ' + route + ' answered ' + out.status + ' for a consultant');
    }
  });

  await check('an administrator of one firm administers only that firm', async () => {
    const members = await call('/api/organization/members', fromB);
    assert.equal(members.status, 200);
    const emails = members.body.members.map(m => m.email);
    assert.ok(emails.includes(ownerB));
    assert.ok(!emails.includes(ABE), 'B’s member list carried A’s staff');
  });

  await check('a workspace cannot be left without an administrator', async () => {
    const members = (await call('/api/organization/members', fromB)).body;
    const admin = members.members.find(m => m.role === 'org:admin' && !m.you);
    const self = members.members.find(m => m.you);
    assert.ok(self, 'the requesting administrator was not in their own member list');
    assert.equal(members.admins, 1, 'this check assumes a single administrator');
    assert.ok(!admin, 'unexpected second administrator');
    const demote = await call('/api/organization/members/' + self.clerkUserId, {
      ...fromB, method: 'PATCH', body: { role: 'org:consultant' }
    });
    assert.equal(demote.status, 409);
    const removeSelf = await call('/api/organization/members/' + self.clerkUserId, { ...fromB, method: 'DELETE' });
    assert.equal(removeSelf.status, 409);
  });

  /* --- held places, invitations, and what revoking each one ends ---------- */
  await check('a held place grants nothing until the person joins, and then grants exactly one search', async () => {
    const chair = 'held-place@city.example';
    const search = await newSearch({ client: 'Held Place County', position: 'Administrator' });
    const held = await call('/api/searches/' + search.id + '/members', {
      method: 'POST', body: { name: 'Chair Holder', email: chair, searchRole: 'committee' }, etag: search.revision
    });
    assert.equal(held.status, 200, JSON.stringify(held.body));
    assert.equal(held.body.added, false, 'somebody outside the workspace was added outright');
    assert.equal(held.body.pending.length, 1);
    assert.equal(held.body.pending[0].status, 'invitation-sent');

    // Before joining: no workspace, so nothing at all.
    const before = await call('/api/searches/' + search.id, { email: chair, org: null });
    assert.equal(before.status, 403);

    // Joining accepts the invitation and takes up the held place.
    const after = await call('/api/me', { email: chair, org: A, role: 'org:committee' });
    assert.equal(after.body.onboarding.access, 'committee');
    const theirs = await call('/api/searches', { email: chair, org: A, role: 'org:committee' });
    assert.equal(theirs.body.length, 1, 'a committee member saw more than their own search');
    assert.equal(theirs.body[0].id, search.id);
    assert.equal((await call('/api/searches/' + inA.id, { email: chair, org: A, role: 'org:committee' })).status, 404);

    // Idempotent: signing in again does not add them twice.
    await call('/api/me', { email: chair, org: A, role: 'org:committee' });
    const roster = (await call('/api/searches/' + search.id)).body.roster;
    assert.equal(roster.filter(m => m.email === chair).length, 1, 'the invitation added them twice');

    // A committee member reads the file; they do not edit it. Sent with the
    // current revision, so this is the authorization answer and not a
    // conflict answer arriving first.
    const current = (await call('/api/searches/' + search.id)).body.revision;
    const edit = await call('/api/searches/' + search.id, {
      email: chair, org: A, role: 'org:committee', method: 'PATCH', body: { client: 'Renamed' }, etag: current
    });
    assert.equal(edit.status, 403, 'a committee member edited the search file');
  });

  await check('removing somebody from the workspace ends their assignments and keeps their history', async () => {
    const member = 'departing@city.example';
    const search = await newSearch({ client: 'Departure City', position: 'Manager' });
    await call('/api/searches/' + search.id + '/members', {
      method: 'POST', body: { name: 'Departing Member', email: member, searchRole: 'committee' }, etag: search.revision
    });
    await call('/api/me', { email: member, org: A, role: 'org:committee' });
    assert.equal((await call('/api/searches', { email: member, org: A, role: 'org:committee' })).body.length, 1);

    const members = (await call('/api/organization/members')).body.members;
    const row = members.find(m => m.email === member);
    assert.ok(row, 'the new member was not listed');
    assert.equal(row.searches, 1);

    const removed = await call('/api/organization/members/' + row.clerkUserId, { method: 'DELETE' });
    assert.equal(removed.status, 200, JSON.stringify(removed.body));
    assert.equal(removed.body.releasedPlaces, 1);

    const nothing = await call('/api/searches', { email: member, org: A, role: 'org:committee' });
    assert.equal(nothing.status, 403, 'access survived removal from the workspace');
    assert.equal(nothing.body.code, 'NO_ACTIVE_ORGANIZATION');

    const activity = (await call('/api/searches/' + search.id)).body.activity;
    assert.ok(activity.some(a => /Departing Member/.test(a.x)), 'the record of what happened was erased with the access');
  });

  await check('a search manager cannot be removed from the workspace without a handover', async () => {
    const search = await newSearch({ client: 'Handover City', position: 'Manager' }, { email: MIKE });
    assert.ok(search.id);
    const members = (await call('/api/organization/members')).body.members;
    const mike = members.find(m => m.email === MIKE);
    assert.ok(mike, 'Mike was not in the member list');
    const refused = await call('/api/organization/members/' + mike.clerkUserId, { method: 'DELETE' });
    assert.equal(refused.status, 409, 'a search was about to be left with no manager');
    assert.match(refused.body.error, /Handover City/);
    // And he is still there, rather than half-removed.
    assert.ok((await call('/api/organization/members')).body.members.some(m => m.email === MIKE));
  });

  await check('an invitation names the role it carries and cannot be self-upgraded', async () => {
    const bad = await call('/api/organization/invitations', {
      method: 'POST', body: { email: 'invitee@city.example', role: 'org:member' }
    });
    assert.equal(bad.status, 400, 'an unmapped role was accepted for an invitation');
    const good = await call('/api/organization/invitations', {
      method: 'POST', body: { email: 'invitee@city.example', role: 'org:committee' }
    });
    assert.equal(good.status, 200);
    assert.equal(good.body.invitation.role, 'org:committee');
    // Accepting adopts the invitation's role; the token's claim is decoration.
    await call('/api/me', { email: 'invitee@city.example', org: A, role: 'org:admin' });
    const me = await call('/api/me', { email: 'invitee@city.example', org: A, role: 'org:admin' });
    assert.equal(me.body.role, 'org:committee', 'the token’s role claim was believed');
    assert.equal(me.body.capabilities.manageMembers, false);
  });

  await check('a person can be staff in one workspace and committee in another', async () => {
    // Abe already runs A. Invite him into B as a committee member.
    await call('/api/organization/invitations', { ...fromB, method: 'POST', body: { email: ABE, role: 'org:committee' } });
    await call('/api/me', { email: ABE, org: B, role: 'org:committee' });
    const inBNow = await call('/api/me', { email: ABE, org: B, role: 'org:committee' });
    assert.equal(inBNow.body.role, 'org:committee');
    assert.equal(inBNow.body.capabilities.staff, false);
    const inANow = await call('/api/me');
    assert.equal(inANow.body.capabilities.staff, true, 'the second membership changed the first');
    assert.equal((await call('/api/searches', { email: ABE, org: B, role: 'org:committee' })).body.length, 0,
      'a committee member in B saw B’s book of business');
  });

  // Against the real provider's error shape rather than the fixture: Clerk
  // answers an unregistered role with 404, which every other branch of invite()
  // would have turned into "try again shortly". An instance missing
  // org:consultant and org:committee is the likeliest way this deployment
  // breaks, and a retryable outage message hides it for as long as somebody
  // keeps retrying.
  await check('an unregistered Clerk role is a refusal, not an outage', async () => {
    const organizations = require('../server/organizations');
    const clerkError = (status, meta) => Object.assign(new Error('not found'), {
      status, errors: [{ code: 'resource_not_found', message: 'not found', meta }]
    });
    const directoryWith = error => organizations.createDirectory({}, {
      clerkClient: { organizations: { createOrganizationInvitation: async () => { throw error; } } }
    });
    const invite = error => () => directoryWith(error)
      .invite('org_x', { email: 'someone@city.example', role: 'org:consultant' });

    await assert.rejects(invite(clerkError(404, { paramName: 'role' })),
      e => e.code === 'DIRECTORY_REJECTED' && e.status === 400 && /no org:consultant role/.test(e.message),
      'a missing role read as a provider outage');

    // A 404 that is not about the role is still not an outage — the workspace is
    // gone — and it must not claim the instance is missing a role.
    await assert.rejects(invite(clerkError(404, {})),
      e => e.code === 'DIRECTORY_REJECTED' && e.status === 409,
      'a deleted workspace read as a provider outage');

    // A real outage must still be one, or the fix would have swallowed the case
    // the 503 exists for.
    await assert.rejects(invite(Object.assign(new Error('socket hang up'), { status: 503 })),
      e => e.code === 'DIRECTORY_UNAVAILABLE',
      'a provider outage stopped being retryable');
  });

  console.log('\n' + passed + ' organization checks passed' + (failed ? ', ' + failed + ' failed.' : '.'));
  if (failed) process.exitCode = 1;
})().catch(error => { console.error(error); process.exitCode = 1; });
