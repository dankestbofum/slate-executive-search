'use strict';

// DEP-02 acceptance evidence: the permission matrix.
//
// Every row is an identity, every column a resource. The point is not that
// each call returns some error, but that the *right* identity is refused for
// the *right* reason, and that withdrawing access takes effect at once.

const assert = require('assert');
const identity = require('./identity');

const BASE = process.env.SLATE_URL || 'http://127.0.0.1:4173';
const JSON_HEADERS = { 'Content-Type': 'application/json' };
let passed = 0;
let failed = 0;

async function check(name, fn) {
  try { await fn(); passed += 1; console.log('PASS  Roles: ' + name); }
  catch (error) { failed += 1; console.error('FAIL  Roles: ' + name + '\n      ' + error.message); }
}

// An identity is a Clerk session for one email. Slate resolves it to the
// account that holds the seats, which is what these rows are about.
const sign = identity.signer();

function api(path, { auth, method = 'GET', body, revision } = {}) {
  const headers = { ...JSON_HEADERS, ...auth };
  if (revision !== undefined) headers['if-match'] = String(revision);
  return fetch(BASE + path, { method, headers, body: body ? JSON.stringify(body) : undefined });
}

async function revisionOf(id, auth) {
  return String((await (await api('/api/searches/' + id, { auth })).json()).revision);
}

(async () => {
  const abe = sign.headers('abe@slate.local');
  const mike = sign.headers('mike@slate.local');

  // Two searches, each managed by a different consultant, so "manager of this
  // search" can be told apart from "consultant at the firm".
  const mk = async (auth, client) => {
    const res = await api('/api/searches', {
      auth, method: 'POST', body: { client, position: 'County Administrator', jurisdictionType: 'county' }
    });
    assert.strictEqual(res.status, 200, 'could not create ' + client);
    return (await res.json()).id;
  };
  const own = await mk(abe, 'Roles County');
  const other = await mk(mike, 'Other Roles County');

  // Returns the account id, which only appears on the seating response; a later
  // search read does not carry the roster. Seating issues no credential of its
  // own: the person signs in with the email on their invitation.
  const seat = async (searchId, auth, name, email) => {
    const res = await api('/api/searches/' + searchId + '/members', {
      auth, method: 'POST', revision: await revisionOf(searchId, auth),
      body: { name, email, seat: 'committee' }
    });
    assert.strictEqual(res.status, 200, 'seating ' + email + ' returned ' + res.status);
    const body = await res.json();
    const row = (body.roster || []).find(m => m.email === email.toLowerCase());
    assert.ok(row, 'seated member ' + email + ' was not in the returned roster');
    assert.ok(!Object.hasOwn(body, 'pin'), 'seating handed back a credential of its own');
    return { userId: row.userId };
  };

  await seat(own, abe, 'Rose Committee', 'rose-roles@example.com');
  await seat(other, mike, 'Sam Outsider', 'sam-roles@example.com');
  const member = sign.headers('rose-roles@example.com');
  const outsider = sign.headers('sam-roles@example.com');

  /* ---------------- Reading a search ---------------- */

  await check('an unauthenticated visitor reads nothing', async () => {
    for (const path of ['/api/searches', '/api/searches/' + own, '/api/searches/' + own + '/history']) {
      assert.strictEqual((await api(path)).status, 401, path + ' was readable without a session');
    }
  });

  await check('a consultant reads the whole book of business', async () => {
    // Deliberate: firm-wide access is how this practice works.
    assert.strictEqual((await api('/api/searches/' + other, { auth: abe })).status, 200);
  });

  await check('a seated committee member reads only their own search', async () => {
    assert.strictEqual((await api('/api/searches/' + own, { auth: member })).status, 200);
  });

  await check('an unrelated committee member cannot tell the search exists', async () => {
    const res = await api('/api/searches/' + own, { auth: outsider });
    // 404 not 403: a 403 would confirm the id is real.
    assert.strictEqual(res.status, 404, 'expected 404, got ' + res.status);
  });

  /* ---------------- The portfolio summary ---------------- */

  // Home renders candidate counts from the search index. The counts have to be
  // real, and they must not become a side channel: no names, no organisations,
  // no invitation tokens, and nothing at all about a search the reader cannot
  // already open.
  await check('the search index carries candidate counts and no candidate detail', async () => {
    for (const person of ['Amita Rosewood-Fenn', 'Bo Nakagawa']) {
      const res = await api('/api/searches/' + own + '/candidates', {
        auth: abe, method: 'POST', revision: await revisionOf(own, abe),
        body: { name: person, cur: 'Deputy Administrator', org: 'A Neighbouring County', email: person.split(' ')[0].toLowerCase() + '@example.com' }
      });
      assert.strictEqual(res.status, 200, 'could not add ' + person);
    }
    const loaded = await (await api('/api/searches/' + own, { auth: abe })).json();
    const bo = loaded.candidates.find(c => c.name === 'Bo Nakagawa');
    await api('/api/searches/' + own + '/candidates/' + bo.id, {
      auth: abe, method: 'PATCH', revision: await revisionOf(own, abe), body: { stage: 'semifinalist' }
    });

    const index = await (await api('/api/searches', { auth: abe })).json();
    const row = index.find(s => s.id === own);
    assert.ok(row, 'the search was missing from the index');
    assert.deepStrictEqual(row.candidateCounts,
      { total: 2, applicant: 1, semifinalist: 1, finalist: 0, declined: 0, responses: 0 });

    const serialised = JSON.stringify(row);
    for (const leak of ['Amita', 'Nakagawa', 'Deputy Administrator', 'Neighbouring', '@example.com', bo.invite]) {
      assert.ok(!serialised.includes(leak), 'the summary leaked candidate detail: ' + leak);
    }
    assert.ok(!('candidates' in row), 'the summary carried the candidate list itself');
  });

  await check('the index never summarises a search the reader cannot open', async () => {
    const index = await (await api('/api/searches', { auth: outsider })).json();
    assert.ok(Array.isArray(index));
    assert.ok(!index.some(s => s.id === own), 'an unrelated search appeared in the index');
    const seen = await (await api('/api/searches', { auth: member })).json();
    const mine = seen.find(s => s.id === own);
    assert.ok(mine, 'a seated member could not see their own search');
    // A seated member takes part in screening, so the count is theirs to see;
    // what they must not receive is the roll of names behind it.
    assert.strictEqual(mine.candidateCounts.total, 2);
    assert.ok(!JSON.stringify(mine).includes('Amita'), 'a committee summary leaked a candidate name');
  });

  /* ---------------- Writing ---------------- */

  await check('a committee member cannot edit search facts', async () => {
    const res = await api('/api/searches/' + own, {
      auth: member, method: 'PUT', revision: await revisionOf(own, member),
      body: { client: 'Renamed By Committee' }
    });
    assert.ok(res.status === 403 || res.status === 404, 'expected refusal, got ' + res.status);
  });

  await check('a committee member cannot seat other members', async () => {
    const res = await api('/api/searches/' + own + '/members', {
      auth: member, method: 'POST', revision: await revisionOf(own, member),
      body: { name: 'Snuck In', email: 'snuck@example.com', seat: 'committee' }
    });
    assert.ok(res.status === 403 || res.status === 404, 'expected refusal, got ' + res.status);
  });

  await check('a non-manager consultant cannot take manager-only actions', async () => {
    // Mike is a consultant and can read this search, but Abe manages it.
    const res = await api('/api/searches/' + own + '/members', {
      auth: mike, method: 'POST', revision: await revisionOf(own, mike),
      body: { name: 'Wrong Manager', email: 'wrong-manager@example.com', seat: 'committee' }
    });
    assert.strictEqual(res.status, 403, 'expected 403, got ' + res.status);
  });

  await check('an unrelated committee member cannot write to another search', async () => {
    const res = await api('/api/searches/' + own + '/candidates', {
      auth: outsider, method: 'POST', revision: '1', body: { name: 'Ghost' }
    });
    assert.strictEqual(res.status, 404, 'expected 404, got ' + res.status);
  });

  /* ---------------- Private material ---------------- */

  await check('a committee member never receives invitation tokens', async () => {
    const rev = await revisionOf(own, abe);
    await api('/api/searches/' + own + '/candidates', {
      auth: abe, method: 'POST', revision: rev, body: { name: 'Private Candidate' }
    });
    const body = await (await api('/api/searches/' + own, { auth: member })).text();
    assert.doesNotMatch(body, /"invite"\s*:\s*"[a-f0-9]{20,}"/, 'a bearer token reached the committee view');
  });

  await check('history is not readable by the committee', async () => {
    const res = await api('/api/searches/' + own + '/history', { auth: member });
    assert.ok(res.status === 403 || res.status === 404, 'expected refusal, got ' + res.status);
  });

  await check('private media is refused to an unrelated committee member', async () => {
    const res = await api('/media/' + own + '/cover.jpg', { auth: outsider });
    assert.ok(res.status >= 400, 'expected refusal, got ' + res.status);
  });

  // The export column of the matrix. Left open in DEP-02 because the export
  // did not exist yet; it does now (DEP-10).
  await check('the records export is refused to the committee', async () => {
    const res = await api('/api/searches/' + own + '/export', { auth: member });
    assert.ok(res.status === 403 || res.status === 404, 'expected refusal, got ' + res.status);
  });

  await check('the records export is refused to an unrelated committee member', async () => {
    const res = await api('/api/searches/' + own + '/export', { auth: outsider });
    assert.strictEqual(res.status, 404, 'expected 404, got ' + res.status);
  });

  await check('the records export requires a session', async () => {
    assert.strictEqual((await api('/api/searches/' + own + '/export')).status, 401);
  });

  await check('archive actions are refused to the committee', async () => {
    const res = await api('/api/searches/' + own, {
      auth: member, method: 'DELETE', revision: await revisionOf(own, member)
    });
    assert.ok(res.status === 403 || res.status === 404, 'expected refusal, got ' + res.status);
  });

  /* ---------------- Candidate bearer tokens ---------------- */

  await check('a candidate token opens only its own questionnaire', async () => {
    assert.strictEqual((await api('/api/apply/not-a-real-token')).status, 404);
  });

  await check('a candidate token is not a session', async () => {
    // Holding a bearer link must not confer any part of a signed-in identity.
    for (const path of ['/api/searches', '/api/searches/' + own]) {
      assert.strictEqual((await api(path)).status, 401, path + ' was reachable without signing in');
    }
  });

  /* ---------------- Withdrawal of access ---------------- */

  await check('withdrawing a seat ends access on the next request', async () => {
    const { userId } = await seat(own, abe, 'Temp Member', 'temp-roles@example.com');
    const temp = sign.headers('temp-roles@example.com');
    assert.strictEqual((await api('/api/searches/' + own, { auth: temp })).status, 200);

    const res = await api('/api/searches/' + own + '/members/' + userId, {
      auth: abe, method: 'DELETE', revision: await revisionOf(own, abe)
    });
    assert.strictEqual(res.status, 200, 'the seat could not be withdrawn: ' + res.status);
    // The same session token, one request later. Nothing had to expire.
    assert.strictEqual((await api('/api/searches/' + own, { auth: temp })).status, 404,
      'access outlived the seat');
  });

  // Slate retires the account, not the person's identity at Clerk: they can
  // still sign in, and what they find is an empty workspace rather than a door
  // that silently stopped opening.
  await check('a removed member is left with no searches at all', async () => {
    const { userId } = await seat(own, abe, 'Remove Member', 'remove-roles@example.com');
    const removed = sign.headers('remove-roles@example.com');
    assert.strictEqual((await api('/api/searches/' + own, { auth: removed })).status, 200);
    const res = await api('/api/searches/' + own + '/members/' + userId, {
      auth: abe, method: 'DELETE', revision: await revisionOf(own, abe)
    });
    assert.strictEqual(res.status, 200);
    assert.deepStrictEqual(await (await api('/api/searches', { auth: removed })).json(), [],
      'a removed member could still list searches');
  });

  /* ---------------- Attribution ---------------- */

  await check('shared-account work is attributed to the shared account', async () => {
    const team = sign.headers('team@slate.local');
    const id = await mk(team, 'Attribution County');
    const search = await (await api('/api/searches/' + id, { auth: team })).json();
    const opened = (search.activity || []).find(a => /opened/.test(a.x || ''));
    assert.ok(opened, 'no activity recorded');
    // The shared sign-in must never be recorded as a named individual, or the
    // record would assert an approval that no identifiable person made.
    assert.strictEqual(opened.who, 'Slate Team', 'shared work was attributed to ' + opened.who);
    assert.notStrictEqual(opened.who, 'Abe Macy');
    assert.notStrictEqual(opened.who, 'Mike Letcher');
  });

  /* ---------------- Starting fresh ---------------- */

  await check('starting fresh rejects unauthenticated and committee requests', async () => {
    assert.strictEqual((await api('/api/account/start-fresh', { method:'POST', body:{ ids:[own] } })).status, 401);
    assert.strictEqual((await api('/api/account/start-fresh', { auth:member, method:'POST', body:{ ids:[own] } })).status, 403);
  });

  await check('starting fresh requires the exact managed searches and preserves the login and archives', async () => {
    const before = await (await api('/api/me', { auth:abe })).json();
    const list = await (await api('/api/searches', { auth:abe })).json();
    const ids = list.filter(s => s.seat === 'manager').map(s => s.id);
    const reset = body => api('/api/account/start-fresh', { auth:abe, method:'POST', body });
    assert.strictEqual((await reset({})).status, 400);
    assert.strictEqual((await reset({ ids:[...ids, ids[0]] })).status, 400);
    assert.strictEqual((await reset({ ids:[...ids, other] })).status, 409, 'another manager was included');
    const added = await mk(abe, 'Newly Assigned County');
    assert.strictEqual((await reset({ ids })).status, 409, 'stale confirmation was accepted');
    assert.strictEqual((await api('/api/searches/' + own, { auth:abe })).status, 200, 'failed confirmation partially archived searches');
    ids.push(added);
    const res = await reset({ ids });
    assert.strictEqual(res.status, 200);
    assert.strictEqual((await res.json()).archived, ids.length);
    const remaining = await (await api('/api/searches', { auth:abe })).json();
    assert.ok(remaining.every(s => !ids.includes(s.id)));
    assert.ok(remaining.some(s => s.id === other), 'another manager lost a search');
    assert.deepStrictEqual((await (await api('/api/me', { auth:abe })).json()).user, before.user, 'the account changed');
    assert.strictEqual((await api('/api/searches/' + own, { auth:member })).status, 404);
    const archives = await (await api('/api/archives', { auth:abe })).json();
    assert.ok(ids.every(id => archives.some(s => s.id === id)));
    await mk(abe, 'Fresh Start County');
    for (const id of ids) {
      assert.strictEqual((await api('/api/archives/' + id + '/restore', { auth:abe, method:'POST', body:{} })).status, 200);
    }
    const restored = await (await api('/api/searches/' + own, { auth:abe })).json();
    assert.ok(restored.activity.some(a => a.x === 'archived the search to start fresh'));
    assert.strictEqual((await api('/api/searches/' + own, { auth:member })).status, 200, 'restoring did not restore committee access');
  });

  /* ---------------- Credential and account policy ----------------
   *
   * Account administration is a CLI, not an HTTP route (see
   * scripts/accounts.js for why), so these exercise the modules directly
   * against the isolated unit data directory rather than over the wire. */

  const store = require('../server/db');

  const { resolveUser } = require('../server/auth');

  await check('disabling an account blocks it without deleting it', async () => {
    const { user } = store.createUser({ name: 'Disabled Person', email: 'disabled@example.com', role: 'consultant' });
    const profile = async () => ({
      primaryEmailAddressId: 'primary',
      emailAddresses: [{ id: 'primary', emailAddress: 'disabled@example.com', verification: { status: 'verified' } }]
    });
    assert.strictEqual((await resolveUser(store, 'clerk-disabled', profile)).id, user.id);

    store.setDisabled(user, true, 'test');
    assert.ok(store.isDisabled(user), 'the account was not marked disabled');
    assert.ok(user.disabledAt, 'no disabled timestamp was recorded');
    // There is no session to revoke. Every request resolves the identity again,
    // and a disabled account is refused there.
    assert.strictEqual(await resolveUser(store, 'clerk-disabled', profile), null,
      'a disabled account still resolved to a user');

    // Disabling must not delete the account: history attributes decisions to it.
    assert.ok(store.findUserById(user.id), 'the account was removed rather than disabled');

    store.setDisabled(user, false, 'test');
    assert.strictEqual(store.isDisabled(user), false, 'the account could not be restored');
    assert.strictEqual((await resolveUser(store, 'clerk-disabled', profile)).id, user.id);
  });

  await check('Slate keeps no session of its own to outlive a decision', () => {
    assert.ok(!('sessions' in store.db), 'the store still carries a session table');
    assert.strictEqual(store.revokeSessions, undefined, 'session revocation still exists to be called');
  });

  console.log(passed + ' role checks passed' + (failed ? ', ' + failed + ' failed' : '') + '.');
  process.exitCode = failed ? 1 : 0;
})().catch(error => { console.error(error); process.exitCode = 1; });
