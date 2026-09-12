'use strict';

// DEP-10 acceptance evidence: records export and decision attribution.
//
// Two acceptance criteria drive this file: an authorised export reconciles to
// the search it came from and can be understood without the running app, and
// unauthorised roles cannot obtain it.

const assert = require('assert');
const exporter = require('../server/export');
const identity = require('./identity');

const BASE = process.env.SLATE_URL || 'http://127.0.0.1:4173';
const JSON_HEADERS = { 'Content-Type': 'application/json' };
let passed = 0;
let failed = 0;

async function check(name, fn) {
  try { await fn(); passed += 1; console.log('PASS  Export: ' + name); }
  catch (error) { failed += 1; console.error('FAIL  Export: ' + name + '\n      ' + error.message); }
}

const sign = identity.signer();

function api(path, { auth, method = 'GET', body, revision } = {}) {
  const headers = { ...JSON_HEADERS, ...auth };
  if (revision !== undefined) headers['if-match'] = String(revision);
  return fetch(BASE + path, { method, headers, body: body ? JSON.stringify(body) : undefined });
}

const revisionOf = async (id, auth) =>
  String((await (await api('/api/searches/' + id, { auth })).json()).revision);

(async () => {
  const abe = sign.headers('abe@slate.local');

  // A search with enough on it to be worth exporting.
  const search = await (await api('/api/searches', {
    auth: abe, method: 'POST',
    body: { client: 'Export County', position: 'County Administrator', jurisdictionType: 'county', state: 'AZ' }
  })).json();
  const id = search.id;

  const withCandidate = await (await api('/api/searches/' + id + '/candidates', {
    auth: abe, method: 'POST', revision: await revisionOf(id, abe),
    body: { name: 'Dana Ruiz', org: 'Example County', email: 'dana@example.gov', yrs: 12 }
  })).json();
  const inviteToken = withCandidate.candidates[0].invite;

  await api('/api/searches/' + id + '/members', {
    auth: abe, method: 'POST', revision: await revisionOf(id, abe),
    body: { name: 'Rose Committee', email: 'rose-export@example.com', seat: 'committee' }
  });
  const member = sign.headers('rose-export@example.com');

  const bundleOf = async (auth = abe) => {
    const res = await api('/api/searches/' + id + '/export', { auth });
    assert.strictEqual(res.status, 200, 'export returned ' + res.status);
    return res.json();
  };

  /* ---------------- Authorisation ---------------- */

  await check('an unauthenticated visitor cannot export', async () => {
    assert.strictEqual((await api('/api/searches/' + id + '/export')).status, 401);
  });

  await check('a committee member cannot export a search they sit on', async () => {
    const res = await api('/api/searches/' + id + '/export', { auth: member });
    assert.ok(res.status === 403 || res.status === 404, 'expected refusal, got ' + res.status);
  });

  await check('a consultant can export', async () => {
    const res = await api('/api/searches/' + id + '/export', { auth: abe });
    assert.strictEqual(res.status, 200);
    assert.match(res.headers.get('content-disposition') || '', /attachment/);
  });

  /* ---------------- Nothing that grants access travels with the record ---------------- */

  await check('the export carries no credential, session or invitation token', async () => {
    const text = JSON.stringify(await bundleOf());
    assert.doesNotMatch(text, /pinHash/, 'a credential hash was exported');
    assert.doesNotMatch(text, /"pin"/, 'a PIN field was exported');
    assert.doesNotMatch(text, /"sessions"/, 'sessions were exported');
    assert.doesNotMatch(text, /"invite"/, 'an invitation field was exported');
    assert.ok(inviteToken, 'the test needs a real token to search for');
    assert.ok(!text.includes(inviteToken),
      'the candidate bearer token appeared in the export; the bundle would open their questionnaire');
  });

  await check('scrubbing removes forbidden keys at any depth', () => {
    const scrubbed = exporter.scrub({
      keep: 'yes',
      pinHash: 'x',
      nested: { invite: 'tok', deeper: [{ pin: '1234', fine: 1 }] }
    });
    assert.strictEqual(scrubbed.keep, 'yes');
    assert.strictEqual('pinHash' in scrubbed, false);
    assert.strictEqual('invite' in scrubbed.nested, false);
    assert.strictEqual('pin' in scrubbed.nested.deeper[0], false);
    assert.strictEqual(scrubbed.nested.deeper[0].fine, 1);
  });

  await check('the export contains no other search', async () => {
    const other = await (await api('/api/searches', {
      auth: abe, method: 'POST', body: { client: 'Unrelated Export County', position: 'County Administrator' }
    })).json();
    const text = JSON.stringify(await bundleOf());
    assert.ok(!text.includes(other.id), 'an unrelated search id appeared in the export');
    assert.doesNotMatch(text, /Unrelated Export County/, 'an unrelated search leaked into the export');
  });

  /* ---------------- It is not a privacy bypass ---------------- */

  await check('sealed scoring is withheld and said to be withheld', async () => {
    const bundle = await bundleOf();
    assert.strictEqual(bundle.evaluation.sealed, true, 'scores were not sealed in this fixture');
    assert.strictEqual(bundle.evaluation.scores, undefined,
      'sealed scores were included; the export bypassed the seal');
    // Withheld, not omitted: a reader has to know evaluation exists.
    assert.match(bundle.evaluation.note, /sealed/i);
    assert.ok(bundle.completeness.missing.some(gap => /sealed/i.test(gap)),
      'the sealed scores were not declared as a gap');
  });

  await check('restricted reference material is labelled as narrower', async () => {
    const bundle = await bundleOf();
    for (const record of Object.values(bundle.staffWork)) {
      assert.strictEqual(record.access, 'restricted');
      assert.match(record.accessNote, /narrower/i);
    }
  });

  /* ---------------- It reconciles to the search ---------------- */

  await check('the export reconciles to the live search', async () => {
    const live = await (await api('/api/searches/' + id, { auth: abe })).json();
    const bundle = await bundleOf();

    assert.strictEqual(bundle.search.id, live.id);
    assert.strictEqual(bundle.search.client, live.client);
    assert.strictEqual(bundle.search.position, live.position);
    assert.strictEqual(bundle.search.jurisdictionType, live.jurisdictionType);
    assert.strictEqual(bundle.search.package, live.package);
    assert.strictEqual(bundle.candidates.length, (live.candidates || []).length);
    assert.strictEqual(bundle.committee.roster.length, (live.members || []).length);
    assert.strictEqual(bundle.profile.revision, live.profileRevision);
  });

  await check('candidate answers keep the questions they were asked', async () => {
    // Submit through the candidate's own link, so this is a real response.
    const page = await (await fetch(BASE + '/api/apply/' + inviteToken)).json();
    if (!page.survey1) return; // no questionnaire issued in this fixture

    const answers = {};
    for (const question of page.survey1.questions) answers['q' + question.n] = 'Answer to question ' + question.n;
    const submitted = await fetch(BASE + '/api/apply/' + inviteToken, {
      method: 'POST', headers: JSON_HEADERS,
      body: JSON.stringify({ which: 'survey1', version: page.versions.survey1, answers })
    });
    assert.strictEqual(submitted.status, 200, 'the candidate could not submit: ' + submitted.status);

    const bundle = await bundleOf();
    const candidate = bundle.candidates.find(c => c.name === 'Dana Ruiz');
    const response = candidate.responses.survey1;
    assert.ok(response, 'the submitted response is missing from the export');
    assert.ok(response.questions?.length, 'the answers were exported without their questions');
    assert.ok(response.submittedAt, 'no submission timestamp was preserved');
    const first = response.questions[0];
    assert.strictEqual(response.answers['q' + first.n], 'Answer to question ' + first.n);
  });

  /* ---------------- Attribution ---------------- */

  await check('material actions carry a stable actor id and a name', async () => {
    const bundle = await bundleOf();
    const entry = bundle.activity.find(a => /exported|opened/.test(a.what || ''));
    assert.ok(entry, 'no attributable activity was recorded');
    assert.ok(entry.actor.actorId, 'an action was recorded with no stable actor id');
    assert.ok(entry.actor.actorName, 'an action was recorded with no display name');
    assert.strictEqual(entry.actor.attribution, 'account');
  });

  await check('the shared firm account is never presented as an individual', () => {
    const users = [{ id: 'u0', name: 'Slate Team', role: 'consultant' }];
    const attributed = exporter.attribute({ by: 'u0' }, id => users.find(u => u.id === id));
    assert.strictEqual(attributed.attribution, 'shared-account');
    assert.match(attributed.note, /not an individual/i);
  });

  await check('entries without an actor id are labelled, not invented', () => {
    const attributed = exporter.attribute({ who: 'Someone' }, () => null);
    assert.strictEqual(attributed.actorId, null);
    assert.strictEqual(attributed.attribution, 'name-only');
    assert.match(attributed.note, /before stable actor ids/i);
  });

  await check('the record states it is not a tamper-evident audit log', async () => {
    const bundle = await bundleOf();
    assert.match(bundle.format.audit, /not a tamper-evident audit log/i);
  });

  /* ---------------- Readable without the app ---------------- */

  await check('the text report is self-contained and readable', async () => {
    const res = await api('/api/searches/' + id + '/export?format=text', { auth: abe });
    assert.strictEqual(res.status, 200);
    assert.match(res.headers.get('content-type') || '', /text\/plain/);
    const text = await res.text();

    for (const expected of ['SEARCH RECORD', 'Export County', 'County Administrator',
      'COMMITTEE', 'CANDIDATES', 'DECISION HISTORY', 'KNOWN GAPS IN THIS RECORD']) {
      assert.ok(text.includes(expected), 'the report is missing the ' + expected + ' section');
    }
    assert.ok(text.includes('Dana Ruiz'), 'the report omits a candidate');
    assert.ok(!text.includes(inviteToken), 'the readable report leaked a bearer token');
    assert.ok(text.length > 800, 'the report looks too thin to stand alone');
  });

  await check('external documents are declared rather than silently absent', async () => {
    const bundle = await bundleOf();
    assert.match(bundle.documents.external.note, /exported from that system/i);
    assert.ok(bundle.completeness.missing.some(gap => /external documents/i.test(gap)));
  });

  await check('exporting is itself recorded on the search', async () => {
    const before = (await bundleOf()).activity.filter(a => /exported/.test(a.what || '')).length;
    await bundleOf();
    const after = (await bundleOf()).activity.filter(a => /exported/.test(a.what || '')).length;
    assert.ok(after > before, 'taking a copy of the whole record left no trace');
  });

  console.log(passed + ' export checks passed' + (failed ? ', ' + failed + ' failed' : '') + '.');
  process.exitCode = failed ? 1 : 0;
})().catch(error => { console.error(error); process.exitCode = 1; });
