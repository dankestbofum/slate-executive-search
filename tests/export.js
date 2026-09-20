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

  // A questionnaire on the file before anybody is invited, so the candidate's
  // link opens a real one. Without it the response case below had nothing to
  // submit against and returned early — a P0 assertion that never ran, which is
  // how an export shipping answers with no questions stayed hidden.
  await api('/api/searches/' + id + '/artifact/survey1', {
    auth: abe, method: 'PUT', revision: await revisionOf(id, abe),
    body: { body: { intro: 'Export fixture.', questions: [
      { n: 1, prompt: 'Describe your public budgeting work.', required: true },
      { n: 2, prompt: 'Describe a difficult council relationship.', required: false }
    ] } }
  });

  const withCandidate = await (await api('/api/searches/' + id + '/candidates', {
    auth: abe, method: 'POST', revision: await revisionOf(id, abe),
    body: { name: 'Dana Ruiz', org: 'Example County', email: 'dana@example.gov', yrs: 12 }
  })).json();
  const inviteToken = withCandidate.candidates[0].invite;

  await api('/api/searches/' + id + '/members', {
    auth: abe, method: 'POST', revision: await revisionOf(id, abe),
    body: { name: 'Rose Committee', email: 'rose-export@example.com', searchRole: 'committee' }
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

  await check('edited scores, resealing and older sealed revisions cannot leak through export history', async () => {
    const created = await api('/api/searches', { auth: abe, method: 'POST',
      body: { client: 'Private score export', position: 'Administrator' } });
    const sid = (await created.json()).id;
    const p = '/api/searches/' + sid;
    const write = async (suffix, method, body, auth = abe) => {
      const res = await api(p + suffix, { auth, method, body, revision: await revisionOf(sid, auth) });
      assert.strictEqual(res.status, 200, await res.clone().text());
      return res.json();
    };
    await write('/profile', 'PUT', { criteria: [{ id: 'S1', kind: 'skill', label: 'Budget', weight: 5 }] });
    const c = (await write('/candidates', 'POST', { name: 'Private score fixture' })).candidates[0];
    const reviewer = sign.headers('mike@slate.local');
    await write('/scores/' + c.id, 'PUT', { scores: { S1: 2 }, note: 'SEALED_ORIGINAL_NOTE' }, reviewer);
    await write('/scores/' + c.id, 'PUT', { scores: { S1: 4 }, note: 'SEALED_CURRENT_NOTE' }, reviewer);
    const exportNow = async () => (await api(p + '/export', { auth: abe })).json();
    const sealed = await exportNow();
    assert.ok(sealed.history.some(h => h.scoresWithheld));
    assert.doesNotMatch(JSON.stringify(sealed), /SEALED_ORIGINAL_NOTE|SEALED_CURRENT_NOTE/);
    await write('', 'PATCH', { released: true });
    const released = await exportNow();
    assert.ok(Object.values(released.evaluation.scores).some(scores => scores[c.id]?.S1 === 4));
    assert.match(JSON.stringify(released.history), /SEALED_ORIGINAL_NOTE/);
    await write('', 'PATCH', { released: false });
    assert.doesNotMatch(JSON.stringify(await exportNow()), /SEALED_ORIGINAL_NOTE|SEALED_CURRENT_NOTE/);
    await write('/profile', 'PUT', { criteria: [{ id: 'S2', kind: 'skill', label: 'Leadership', weight: 5 }] });
    await write('', 'PATCH', { released: true });
    assert.doesNotMatch(JSON.stringify(await exportNow()), /SEALED_ORIGINAL_NOTE|SEALED_CURRENT_NOTE/);
  });

  await check('credential-bearing inventory URLs are refused and legacy URLs withheld in both export formats', async () => {
    const candidateId = (await bundleOf()).candidates[0].id;
    for (const url of ['https://records.example.gov/doc?token=PRIVATE_SHARE',
      'https://records.example.gov/doc#PRIVATE_SHARE', 'https://user:PRIVATE_SHARE@records.example.gov/doc',
      'https://records.example.gov/share/PRIVATE_SHARE', 'https://1drv.ms/PRIVATE_SHARE']) {
      const res = await api('/api/searches/' + id + '/candidates/' + candidateId + '/documents', {
        auth: abe, method: 'POST', revision: await revisionOf(id, abe),
        body: { kind: 'resume', label: 'Credential regression', url }
      });
      assert.strictEqual(res.status, 400, 'unsafe URL accepted');
    }
    const live = await (await api('/api/searches/' + id, { auth: abe })).json();
    live.candidates[0].documents = [{ kind: 'resume', label: 'Legacy identifier', url: 'https://records.example.gov/doc?token=PRIVATE_SHARE' }];
    const bundle = exporter.build(live, { viewer: {}, users: [] });
    assert.doesNotMatch(JSON.stringify(bundle), /PRIVATE_SHARE/);
    assert.doesNotMatch(exporter.report(bundle), /PRIVATE_SHARE/);
    assert.match(bundle.candidates[0].documents[0].location, /withheld/);
    assert.ok(bundle.completeness.missing.some(gap => /legacy document URLs/.test(gap)));
  });

  await check('open intake remains private in exports', async () => {
    const live = await (await api('/api/searches/' + id, { auth: abe })).json();
    live.members = [{ userId: 'mine', searchRole: 'committee' }, { userId: 'other', searchRole: 'committee' }];
    live.intake = { status: 'open', responses: {
      mine: { revision: 1, draft: null, submitted: { items: [], context: 'MY_INPUT' } },
      other: { revision: 1, draft: null, submitted: { items: [], context: 'PRIVATE_OTHER_INPUT' } }
    } };
    const bundle = exporter.build(live, { viewer: { id: 'mine' }, users: [] });
    assert.match(JSON.stringify(bundle), /MY_INPUT/);
    assert.doesNotMatch(JSON.stringify(bundle), /PRIVATE_OTHER_INPUT/);
  });

  // CA-01. Closing the window publishes what people submitted. It does not
  // publish what somebody saved and never sent, to a reader or to an export.
  await check('an unsubmitted draft is excluded from every export', async () => {
    const live = await (await api('/api/searches/' + id, { auth: abe })).json();
    live.members = [{ userId: 'mine', searchRole: 'committee' }, { userId: 'other', searchRole: 'committee' }];
    live.intake = { status: 'closed', responses: {
      mine: { revision: 1, draft: null, submitted: { items: [], context: 'MY_INPUT' } },
      other: { revision: 2, draft: { items: [], context: 'UNSENT_DRAFT_TEXT' }, submitted: null }
    } };
    for (const viewer of [{ id: 'mine' }, { id: 'staffer', staff: true }, {}]) {
      const bundle = exporter.build(live, { viewer, users: [] });
      assert.doesNotMatch(JSON.stringify(bundle), /UNSENT_DRAFT_TEXT/,
        'an unsubmitted draft reached an export for viewer ' + (viewer.id || 'anonymous'));
      assert.strictEqual(bundle.committee.intake.draftsWithheld, true);
      assert.ok(bundle.completeness.missing.some(gap => /drafts/i.test(gap)),
        'the withheld drafts were not declared as a gap');
    }
  });

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
    assert.ok(page.survey1, 'the fixture issued no questionnaire, so this case would prove nothing');

    const answers = {};
    for (const question of page.survey1.questions) answers['q' + question.n] = 'Answer to question ' + question.n;
    const submitted = await fetch(BASE + '/api/apply/' + inviteToken, {
      method: 'POST', headers: JSON_HEADERS,
      // The route reads `surveyVersion`. This said `version`, so every run of
      // this case was refused with a reload prompt — and the early return above
      // meant nobody saw it.
      body: JSON.stringify({ which: 'survey1', surveyVersion: page.versions.survey1, answers })
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

  // The record holds an inventory of material kept elsewhere and a log of the
  // contact staff made. The export described both as future work and shipped
  // neither, which made a complete-looking bundle an incomplete record.
  await check('the inventory and the contact log are in the record, in both formats', async () => {
    const candidate = (await bundleOf()).candidates.find(c => c.name === 'Dana Ruiz');
    assert.strictEqual((await api('/api/searches/' + id + '/candidates/' + candidate.id + '/documents', {
      auth: abe, method: 'POST', revision: await revisionOf(id, abe),
      body: { kind: 'resume', label: 'Ruiz resume v2', url: 'https://records.example.gov/doc/RUIZ-2', receivedAt: '2026-09-10' }
    })).status, 200, 'could not record a document reference');
    assert.strictEqual((await api('/api/searches/' + id + '/candidates/' + candidate.id + '/communications', {
      auth: abe, method: 'POST', revision: await revisionOf(id, abe),
      body: { channel: 'email', purpose: 'invitation', summary: 'Sent the semifinalist questionnaire link.', at: '2026-09-11T16:00:00.000Z' }
    })).status, 200, 'could not log a contact');

    const bundle = await bundleOf();
    const dana = bundle.candidates.find(c => c.name === 'Dana Ruiz');
    assert.strictEqual(dana.documents.length, 1, 'the inventory did not reach the export');
    assert.strictEqual(dana.documents[0].location, 'https://records.example.gov/doc/RUIZ-2');
    assert.strictEqual(dana.communications.length, 1, 'the contact log did not reach the export');
    assert.match(dana.communications[0].evidenceNote, /cannot confirm delivery/i,
      'a staff-recorded contact was exported without saying what it is');
    assert.ok(bundle.documents.external.references.some(r => r.label === 'Ruiz resume v2'),
      'the gathered external inventory is missing the document');
    assert.ok(!bundle.completeness.missing.some(gap => /DEP-0[89]/.test(gap)),
      'the record still names shipped work as a gap');

    const text = await (await api('/api/searches/' + id + '/export?format=text', { auth: abe })).text();
    assert.ok(text.includes('RUIZ-2'), 'the readable report omits where the document is held');
    assert.ok(text.includes('Sent the semifinalist questionnaire link.'), 'the readable report omits the contact log');
    assert.ok(text.includes('EXTERNAL INVENTORY') || text.includes('External inventory'),
      'the readable report has no inventory a custodian can reconcile against');
  });

  // Outcomes and the lifecycle were in the bundle and nowhere in the readable
  // report, which is the copy a records officer is handed.
  await check('the readable report carries the decisions, not only the applications', async () => {
    const candidate = (await bundleOf()).candidates.find(c => c.name === 'Dana Ruiz');
    assert.strictEqual((await api('/api/searches/' + id + '/candidates/' + candidate.id + '/disposition', {
      auth: abe, method: 'POST', revision: await revisionOf(id, abe),
      body: { outcome: 'not-selected', reason: 'The board appointed another finalist.', evidence: 'Panel scores against the adopted profile.' }
    })).status, 200, 'could not record an outcome');

    const text = await (await api('/api/searches/' + id + '/export?format=text', { auth: abe })).text();
    assert.ok(text.includes('OUTCOMES'), 'the report has no outcomes section');
    assert.ok(text.includes('NOT-SELECTED'), 'the report omits the decision');
    assert.ok(text.includes('The board appointed another finalist.'), 'the report omits the reason');
    assert.ok(text.includes('Panel scores against the adopted profile.'), 'the report omits the job-related basis');
    assert.ok(text.includes('LIFECYCLE'), 'the report never says how the search stands');
  });

  // A reopened questionnaire's original stays in the search history. A reader
  // comparing the file against a candidate would otherwise see only the latest
  // answers, and read a correction as an original.
  await check('a replaced response is exported beside the one that replaced it', async () => {
    const candidate = (await bundleOf()).candidates.find(c => c.name === 'Dana Ruiz');
    const reopened = await api('/api/searches/' + id + '/candidates/' + candidate.id + '/reopen', {
      auth: abe, method: 'POST', revision: await revisionOf(id, abe),
      body: { which: 'survey1', reason: 'Candidate asked to correct question 1.' }
    });
    assert.strictEqual(reopened.status, 200, 'could not reopen the questionnaire: ' + await reopened.text());

    const dana = (await bundleOf()).candidates.find(c => c.name === 'Dana Ruiz');
    assert.strictEqual(dana.supersededResponses.length, 1, 'the replaced response is not on the candidate');
    const prior = dana.supersededResponses[0];
    assert.strictEqual(prior.questionnaire, 'survey1');
    assert.ok(prior.questions?.length, 'the replaced response lost the questions it answered');
    assert.match(prior.reason, /correct question 1/);

    const text = await (await api('/api/searches/' + id + '/export?format=text', { auth: abe })).text();
    assert.ok(text.includes('SUPERSEDED'), 'the readable report presents only the latest answers');
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
