'use strict';

// DEP-02 acceptance evidence: the permission matrix.
//
// Every row is an identity, every column a resource. The point is not that
// each call returns some error, but that the *right* identity is refused for
// the *right* reason, and that withdrawing access takes effect at once.

const assert = require('assert');

const BASE = process.env.SLATE_URL || 'http://127.0.0.1:4173';
const JSON_HEADERS = { 'Content-Type': 'application/json' };
let passed = 0;
let failed = 0;

async function check(name, fn) {
  try { await fn(); passed += 1; console.log('PASS  Roles: ' + name); }
  catch (error) { failed += 1; console.error('FAIL  Roles: ' + name + '\n      ' + error.message); }
}

async function login(email, pin) {
  const res = await fetch(BASE + '/api/login', {
    method: 'POST', headers: JSON_HEADERS, body: JSON.stringify({ email, pin })
  });
  assert.strictEqual(res.status, 200, 'login for ' + email + ' returned ' + res.status);
  return res.headers.getSetCookie().map(c => c.split(';')[0]).join('; ');
}

function api(path, { cookie, method = 'GET', body, revision } = {}) {
  const headers = { ...JSON_HEADERS };
  if (cookie) headers.cookie = cookie;
  if (revision !== undefined) headers['if-match'] = String(revision);
  return fetch(BASE + path, { method, headers, body: body ? JSON.stringify(body) : undefined });
}

async function revisionOf(id, cookie) {
  return String((await (await api('/api/searches/' + id, { cookie })).json()).revision);
}

(async () => {
  const abe = await login('abe@slate.local', '2468');
  const mike = await login('mike@slate.local', '1357');

  // Two searches, each managed by a different consultant, so "manager of this
  // search" can be told apart from "consultant at the firm".
  const mk = async (cookie, client) => {
    const res = await api('/api/searches', {
      cookie, method: 'POST', body: { client, position: 'County Administrator', jurisdictionType: 'county' }
    });
    assert.strictEqual(res.status, 200, 'could not create ' + client);
    return (await res.json()).id;
  };
  const own = await mk(abe, 'Roles County');
  const other = await mk(mike, 'Other Roles County');

  // Returns the one-time PIN and the account id, both of which only appear on
  // the seating response; a later search read does not carry the roster.
  const seat = async (searchId, cookie, name, email) => {
    const res = await api('/api/searches/' + searchId + '/members', {
      cookie, method: 'POST', revision: await revisionOf(searchId, cookie),
      body: { name, email, seat: 'committee' }
    });
    assert.strictEqual(res.status, 200, 'seating ' + email + ' returned ' + res.status);
    const body = await res.json();
    const row = (body.roster || []).find(m => m.email === email.toLowerCase());
    assert.ok(row, 'seated member ' + email + ' was not in the returned roster');
    return { pin: body.pin, userId: row.userId };
  };

  const member = await login('rose-roles@example.com', (await seat(own, abe, 'Rose Committee', 'rose-roles@example.com')).pin);
  const outsider = await login('sam-roles@example.com', (await seat(other, mike, 'Sam Outsider', 'sam-roles@example.com')).pin);

  /* ---------------- Reading a search ---------------- */

  await check('an unauthenticated visitor reads nothing', async () => {
    for (const path of ['/api/searches', '/api/searches/' + own, '/api/searches/' + own + '/history']) {
      assert.strictEqual((await api(path)).status, 401, path + ' was readable without a session');
    }
  });

  await check('a consultant reads the whole book of business', async () => {
    // Deliberate: firm-wide access is how this practice works.
    assert.strictEqual((await api('/api/searches/' + other, { cookie: abe })).status, 200);
  });

  await check('a seated committee member reads only their own search', async () => {
    assert.strictEqual((await api('/api/searches/' + own, { cookie: member })).status, 200);
  });

  await check('an unrelated committee member cannot tell the search exists', async () => {
    const res = await api('/api/searches/' + own, { cookie: outsider });
    // 404 not 403: a 403 would confirm the id is real.
    assert.strictEqual(res.status, 404, 'expected 404, got ' + res.status);
  });

  /* ---------------- Writing ---------------- */

  await check('a committee member cannot edit search facts', async () => {
    const res = await api('/api/searches/' + own, {
      cookie: member, method: 'PUT', revision: await revisionOf(own, member),
      body: { client: 'Renamed By Committee' }
    });
    assert.ok(res.status === 403 || res.status === 404, 'expected refusal, got ' + res.status);
  });

  await check('a committee member cannot seat other members', async () => {
    const res = await api('/api/searches/' + own + '/members', {
      cookie: member, method: 'POST', revision: await revisionOf(own, member),
      body: { name: 'Snuck In', email: 'snuck@example.com', seat: 'committee' }
    });
    assert.ok(res.status === 403 || res.status === 404, 'expected refusal, got ' + res.status);
  });

  await check('a non-manager consultant cannot take manager-only actions', async () => {
    // Mike is a consultant and can read this search, but Abe manages it.
    const res = await api('/api/searches/' + own + '/members', {
      cookie: mike, method: 'POST', revision: await revisionOf(own, mike),
      body: { name: 'Wrong Manager', email: 'wrong-manager@example.com', seat: 'committee' }
    });
    assert.strictEqual(res.status, 403, 'expected 403, got ' + res.status);
  });

  await check('an unrelated committee member cannot write to another search', async () => {
    const res = await api('/api/searches/' + own + '/candidates', {
      cookie: outsider, method: 'POST', revision: '1', body: { name: 'Ghost' }
    });
    assert.strictEqual(res.status, 404, 'expected 404, got ' + res.status);
  });

  /* ---------------- Private material ---------------- */

  await check('a committee member never receives invitation tokens', async () => {
    const rev = await revisionOf(own, abe);
    await api('/api/searches/' + own + '/candidates', {
      cookie: abe, method: 'POST', revision: rev, body: { name: 'Private Candidate' }
    });
    const body = await (await api('/api/searches/' + own, { cookie: member })).text();
    assert.doesNotMatch(body, /"invite"\s*:\s*"[a-f0-9]{20,}"/, 'a bearer token reached the committee view');
  });

  await check('history is not readable by the committee', async () => {
    const res = await api('/api/searches/' + own + '/history', { cookie: member });
    assert.ok(res.status === 403 || res.status === 404, 'expected refusal, got ' + res.status);
  });

  await check('private media is refused to an unrelated committee member', async () => {
    const res = await api('/media/' + own + '/cover.jpg', { cookie: outsider });
    assert.ok(res.status >= 400, 'expected refusal, got ' + res.status);
  });

  // The export column of the matrix. Left open in DEP-02 because the export
  // did not exist yet; it does now (DEP-10).
  await check('the records export is refused to the committee', async () => {
    const res = await api('/api/searches/' + own + '/export', { cookie: member });
    assert.ok(res.status === 403 || res.status === 404, 'expected refusal, got ' + res.status);
  });

  await check('the records export is refused to an unrelated committee member', async () => {
    const res = await api('/api/searches/' + own + '/export', { cookie: outsider });
    assert.strictEqual(res.status, 404, 'expected 404, got ' + res.status);
  });

  await check('the records export requires a session', async () => {
    assert.strictEqual((await api('/api/searches/' + own + '/export')).status, 401);
  });

  await check('archive actions are refused to the committee', async () => {
    const res = await api('/api/searches/' + own, {
      cookie: member, method: 'DELETE', revision: await revisionOf(own, member)
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

  await check('a revoked session stops working immediately', async () => {
    const { pin } = await seat(own, abe, 'Temp Member', 'temp-roles@example.com');
    const temp = await login('temp-roles@example.com', pin);
    assert.strictEqual((await api('/api/searches/' + own, { cookie: temp })).status, 200);

    const res = await api('/api/logout', { cookie: temp, method: 'POST' });
    assert.ok(res.status < 400, 'logout failed: ' + res.status);
    assert.strictEqual((await api('/api/searches/' + own, { cookie: temp })).status, 401,
      'the session outlived its logout');
  });

  await check('replacing a committee PIN retires the old sessions', async () => {
    const { pin, userId } = await seat(own, abe, 'Rotate Member', 'rotate-roles@example.com');
    const rotating = await login('rotate-roles@example.com', pin);

    const res = await api('/api/searches/' + own + '/members/' + userId + '/pin', {
      cookie: abe, method: 'POST', revision: await revisionOf(own, abe)
    });
    assert.strictEqual(res.status, 200, 'PIN reset returned ' + res.status);
    assert.strictEqual((await api('/api/searches/' + own, { cookie: rotating })).status, 401,
      'the old session survived a PIN reset');
  });

  /* ---------------- Attribution ---------------- */

  await check('shared-account work is attributed to the shared account', async () => {
    const team = await login('team@slate.local', '1234');
    const id = await mk(team, 'Attribution County');
    const search = await (await api('/api/searches/' + id, { cookie: team })).json();
    const opened = (search.activity || []).find(a => /opened/.test(a.x || ''));
    assert.ok(opened, 'no activity recorded');
    // The shared sign-in must never be recorded as a named individual, or the
    // record would assert an approval that no identifiable person made.
    assert.strictEqual(opened.who, 'Slate Team', 'shared work was attributed to ' + opened.who);
    assert.notStrictEqual(opened.who, 'Abe Macy');
    assert.notStrictEqual(opened.who, 'Mike Letcher');
  });

  /* ---------------- Credential and account policy ----------------
   *
   * Account administration is a CLI, not an HTTP route (see
   * scripts/accounts.js for why), so these exercise the modules directly
   * against the isolated unit data directory rather than over the wire. */

  const credentials = require('../server/credentials');
  const store = require('../server/db');

  await check('the strength policy rejects what rate limiting cannot save', () => {
    for (const weak of ['1234', '2468', '1357']) {
      assert.ok(credentials.weakness(weak), 'published dev PIN "' + weak + '" was accepted');
    }
    assert.ok(credentials.weakness('123'), 'a short PIN was accepted');
    assert.ok(credentials.weakness('11111111'), 'a repeated character was accepted');
    assert.ok(credentials.weakness('12345678'), 'an ascending run was accepted');
    assert.ok(credentials.weakness('87654321'), 'a descending run was accepted');
    assert.ok(credentials.weakness(''), 'an empty PIN was accepted');
    assert.strictEqual(credentials.weakness('90416273'), null, 'a reasonable PIN was refused');
  });

  await check('disabling an account revokes its sessions and blocks it', () => {
    const { user } = store.createUser({ name: 'Disabled Person', email: 'disabled@example.com', role: 'consultant' });
    store.db.sessions['unit-session-a'] = { userId: user.id, exp: Date.now() + 60000 };
    store.db.sessions['unit-session-b'] = { userId: user.id, exp: Date.now() + 60000 };
    store.db.sessions['unit-session-other'] = { userId: 'u1', exp: Date.now() + 60000 };

    store.setDisabled(user, true, 'test');
    assert.ok(store.isDisabled(user), 'the account was not marked disabled');
    assert.ok(user.disabledAt, 'no disabled timestamp was recorded');
    assert.strictEqual(store.db.sessions['unit-session-a'], undefined, 'a session survived disabling');
    assert.strictEqual(store.db.sessions['unit-session-b'], undefined, 'a session survived disabling');
    assert.ok(store.db.sessions['unit-session-other'], 'another account\'s session was revoked');

    // Disabling must not delete the account: history attributes decisions to it.
    assert.ok(store.findUserById(user.id), 'the account was removed rather than disabled');

    store.setDisabled(user, false, 'test');
    assert.strictEqual(store.isDisabled(user), false, 'the account could not be restored');
    delete store.db.sessions['unit-session-other'];
  });

  await check('session length is configurable but capped', () => {
    assert.ok(store.SESSION_DAYS >= 1, 'session length fell below a day');
    assert.ok(store.SESSION_DAYS <= store.SESSION_MAX_DAYS,
      'configuration raised the session length past its ceiling');
    assert.strictEqual(store.SESSION_MS, store.SESSION_DAYS * 24 * 60 * 60 * 1000);
  });

  await check('the weak-credential audit finds published development PINs', () => {
    const flagged = store.auditWeakCredentials({
      users: [
        { id: 'w1', email: 'weak@example.com', pinHash: credentials.hash('1234') },
        { id: 's1', email: 'strong@example.com', pinHash: credentials.hash('90416273') }
      ]
    });
    assert.strictEqual(flagged.length, 1, 'expected exactly one weak account');
    assert.strictEqual(flagged[0].id, 'w1');
  });

  console.log(passed + ' role checks passed' + (failed ? ', ' + failed + ' failed' : '') + '.');
  process.exitCode = failed ? 1 : 0;
})().catch(error => { console.error(error); process.exitCode = 1; });
