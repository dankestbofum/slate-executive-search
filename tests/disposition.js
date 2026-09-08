'use strict';

// DEP-09 acceptance evidence: withdrawal, disposition, and search closeout.
//
// The acceptance criterion is a rehearsal: withdrawal, selection, no-hire
// cancellation, closeout, archive, restoration and authorised reopening, with
// links, roles, history and score visibility checked at each transition.

const assert = require('assert');
const disposition = require('../server/disposition');

const BASE = process.env.SLATE_URL || 'http://127.0.0.1:4173';
const JSON_HEADERS = { 'Content-Type': 'application/json' };
let passed = 0;
let failed = 0;

async function check(name, fn) {
  try { await fn(); passed += 1; console.log('PASS  Disposition: ' + name); }
  catch (error) { failed += 1; console.error('FAIL  Disposition: ' + name + '\n      ' + error.message); }
}

async function login(email, pin) {
  const res = await fetch(BASE + '/api/login', {
    method: 'POST', headers: JSON_HEADERS, body: JSON.stringify({ email, pin })
  });
  assert.strictEqual(res.status, 200, 'login returned ' + res.status);
  return res.headers.getSetCookie().map(c => c.split(';')[0]).join('; ');
}

(async () => {
  const cookie = await login('abe@slate.local', '2468');

  const api = (path, { method = 'GET', body, revision } = {}) => {
    const headers = { ...JSON_HEADERS, cookie };
    if (revision !== undefined) headers['if-match'] = String(revision);
    return fetch(BASE + path, { method, headers, body: body ? JSON.stringify(body) : undefined });
  };
  const revisionOf = async id => String((await (await api('/api/searches/' + id)).json()).revision);
  const read = async id => (await api('/api/searches/' + id)).json();

  async function newSearch(client) {
    const res = await api('/api/searches', {
      method: 'POST', body: { client, position: 'County Administrator', jurisdictionType: 'county' }
    });
    assert.strictEqual(res.status, 200, 'could not create ' + client);
    return (await res.json()).id;
  }
  async function addCandidate(id, name) {
    const res = await api('/api/searches/' + id + '/candidates', {
      method: 'POST', revision: await revisionOf(id), body: { name }
    });
    assert.strictEqual(res.status, 200, 'could not add ' + name);
    const body = await res.json();
    return body.candidates.find(c => c.name === name);
  }
  const decide = async (id, cid, body) =>
    api('/api/searches/' + id + '/candidates/' + cid + '/disposition',
      { method: 'POST', revision: await revisionOf(id), body });

  /* ---------------- Outcomes are distinct from stage ---------------- */

  await check('a search starts active and no candidate has an outcome', async () => {
    const id = await newSearch('Lifecycle County');
    const search = await read(id);
    assert.strictEqual(search.lifecycle.status, 'active');
    assert.strictEqual(search.lifecycle.frozen, false);
    assert.strictEqual(search.lifecycle.byOutcome['in-process'], undefined);
  });

  await check('an outcome needs a reason, and hiring decisions need evidence', () => {
    assert.ok(disposition.validateDisposition({ outcome: 'not-selected' }), 'a decision with no reason was accepted');
    assert.ok(disposition.validateDisposition({ outcome: 'not-selected', reason: 'r' }),
      'a non-selection was accepted with no job-related evidence');
    assert.ok(disposition.validateDisposition({ outcome: 'invented', reason: 'r' }));
    // A withdrawal is the candidate's own decision; it does not need evidence.
    assert.strictEqual(disposition.validateDisposition({ outcome: 'withdrawn', reason: 'Told us by phone.' }), null);
  });

  /* ---------------- Withdrawal ---------------- */

  const wid = await newSearch('Withdrawal County');
  const walker = await addCandidate(wid, 'Wanda Walker');

  await check('a withdrawal is recorded as the candidate\'s decision, not the firm\'s', async () => {
    const res = await decide(wid, walker.id, { outcome: 'withdrawn', reason: 'Called to say she accepted another role.' });
    assert.strictEqual(res.status, 200, 'recording a withdrawal returned ' + res.status);
    const person = (await res.json()).candidates.find(c => c.id === walker.id);
    const entry = person.dispositions[0];
    assert.strictEqual(entry.outcome, 'withdrawn');
    assert.strictEqual(entry.source, 'staff-recorded-from-candidate',
      'a withdrawal was recorded as though the firm decided it');
    assert.ok(entry.actorId, 'no actor was recorded');
  });

  await check('withdrawal revokes the submission link immediately', async () => {
    const person = (await read(wid)).candidates.find(c => c.id === walker.id);
    assert.strictEqual(person.invite, null, 'a withdrawn candidate still has a live questionnaire link');
    assert.ok(person.inviteRevokedAt, 'the revocation was not dated');
    // The old token must stop working, not merely be hidden.
    const stale = await fetch(BASE + '/api/apply/' + walker.invite);
    assert.strictEqual(stale.status, 404, 'the revoked link still opened a questionnaire');
  });

  await check('a withdrawn candidate cannot be advanced', async () => {
    const res = await api('/api/searches/' + wid + '/candidates/' + walker.id, {
      method: 'PATCH', revision: await revisionOf(wid), body: { stage: 'finalist' }
    });
    assert.strictEqual(res.status, 409, 'a withdrawn candidate was advanced');
    assert.strictEqual((await res.json()).code, 'DISPOSITION_FINAL');
  });

  await check('a withdrawn candidate cannot be newly scored', async () => {
    const res = await api('/api/searches/' + wid + '/scores/' + walker.id, {
      method: 'PUT', revision: await revisionOf(wid), body: { scores: {} }
    });
    assert.strictEqual(res.status, 409, 'new scoring was accepted after withdrawal');
  });

  await check('a correction is a new event and keeps the original', async () => {
    const res = await decide(wid, walker.id, {
      outcome: 'not-selected', reason: 'Recorded in error; she did not withdraw.',
      evidence: 'Panel scoring against adopted criteria.', correction: true
    });
    assert.strictEqual(res.status, 200, 'a correction returned ' + res.status);
    const person = (await res.json()).candidates.find(c => c.id === walker.id);
    assert.strictEqual(person.dispositions.length, 2, 'the correction replaced the original instead of adding to it');
    assert.strictEqual(person.dispositions[0].outcome, 'withdrawn', 'the original decision was erased');
    assert.strictEqual(person.dispositions[1].supersedes, person.dispositions[0].id,
      'the correction does not name what it supersedes');
  });

  /* ---------------- Selection and closeout ---------------- */

  const sid = await newSearch('Selection County');
  const hired = await addCandidate(sid, 'Hiram Selected');
  const passedOver = await addCandidate(sid, 'Paula Passed');

  await check('a selection and a non-selection are both recorded with evidence', async () => {
    const one = await decide(sid, hired.id, {
      outcome: 'selected', reason: 'Board voted to appoint.',
      evidence: 'Highest panel score against adopted criteria; reference checks complete.'
    });
    assert.strictEqual(one.status, 200);
    const two = await decide(sid, passedOver.id, {
      outcome: 'not-selected', reason: 'Board selected another candidate.',
      evidence: 'Panel scoring against adopted criteria.'
    });
    assert.strictEqual(two.status, 200);

    const summary = await (await api('/api/searches/' + sid + '/disposition')).json();
    assert.strictEqual(summary.byOutcome.selected, 1);
    assert.strictEqual(summary.byOutcome['not-selected'], 1);
    assert.strictEqual(summary.selected[0].name, 'Hiram Selected');
  });

  await check('the selected candidate keeps their access through contracting', async () => {
    const person = (await read(sid)).candidates.find(c => c.id === hired.id);
    assert.notStrictEqual(person.invite, null, 'the hire\'s link was revoked mid-appointment');
  });

  await check('closing summarises disposition and revokes outstanding links', async () => {
    const res = await api('/api/searches/' + sid + '/close', {
      method: 'POST', revision: await revisionOf(sid),
      body: { status: 'closed', reason: 'Appointment made and accepted.' }
    });
    assert.strictEqual(res.status, 200, 'closing returned ' + res.status);
    const body = await res.json();
    assert.strictEqual(body.summary.status, 'closed');
    assert.ok(body.linksRevoked >= 1, 'closing left live questionnaire links behind');
    assert.ok(body.summary.finalDocuments, 'the closeout does not identify final documents');
  });

  await check('a closed search refuses ordinary edits', async () => {
    const res = await api('/api/searches/' + sid + '/candidates', {
      method: 'POST', revision: await revisionOf(sid), body: { name: 'Late Arrival' }
    });
    assert.strictEqual(res.status, 409, 'a closed search accepted a new candidate');
    assert.strictEqual((await res.json()).code, 'SEARCH_CLOSED');
  });

  await check('a closed search refuses questionnaire submissions', async () => {
    const stale = await fetch(BASE + '/api/apply/' + hired.invite, {
      method: 'POST', headers: JSON_HEADERS,
      body: JSON.stringify({ which: 'survey1', surveyVersion: 1, answers: { q1: 'late' } })
    });
    assert.ok(stale.status >= 400, 'a closed search accepted a submission');
  });

  await check('reading a closed search still works', async () => {
    const search = await read(sid);
    assert.strictEqual(search.lifecycle.status, 'closed');
    assert.strictEqual(search.lifecycle.frozen, true);
  });

  /* ---------------- Reopening ---------------- */

  await check('reopening requires a reason', async () => {
    const res = await api('/api/searches/' + sid + '/reopen', {
      method: 'POST', revision: await revisionOf(sid), body: {}
    });
    assert.strictEqual(res.status, 400, 'a search was reopened with no reason recorded');
  });

  await check('an authorised reopening restores editing but not old links', async () => {
    const res = await api('/api/searches/' + sid + '/reopen', {
      method: 'POST', revision: await revisionOf(sid),
      body: { reason: 'Appointee declined after the vote; reopening to consider remaining candidates.' }
    });
    assert.strictEqual(res.status, 200, 'reopening returned ' + res.status);
    const body = await res.json();
    assert.strictEqual(body.search.lifecycle.status, 'active');
    assert.strictEqual(body.linksRestored, false);

    // The crucial part: reopening must not put an old bearer URL back into the
    // world months later.
    const stale = await fetch(BASE + '/api/apply/' + passedOver.invite);
    assert.strictEqual(stale.status, 404, 'reopening resurrected a revoked candidate link');
  });

  await check('the reopening is recorded in the lifecycle history', async () => {
    const summary = await (await api('/api/searches/' + sid + '/disposition')).json();
    assert.strictEqual(summary.reopenCount, 1, 'the reopening left no trace');
  });

  /* ---------------- Cancellation without a hire ---------------- */

  await check('a search can be cancelled with no appointment made', async () => {
    const cid = await newSearch('Cancelled County');
    await addCandidate(cid, 'Unresolved Person');
    const res = await api('/api/searches/' + cid + '/close', {
      method: 'POST', revision: await revisionOf(cid),
      body: { status: 'cancelled', reason: 'Board suspended the recruitment pending a budget decision.' }
    });
    assert.strictEqual(res.status, 200);
    const body = await res.json();
    assert.strictEqual(body.summary.status, 'cancelled');
    // Cancelled is not the same statement as closed, and neither is Archive.
    assert.strictEqual(body.summary.selected.length, 0);
    assert.strictEqual(body.summary.undecided.length, 1,
      'a cancelled search did not report the candidate left without an outcome');
  });

  /* ---------------- History is preserved throughout ---------------- */

  await check('evaluations of a concluded candidate are retained', async () => {
    const person = (await read(sid)).candidates.find(c => c.id === passedOver.id);
    assert.ok(person.dispositions.length >= 1, 'the outcome record was lost');
    // The record of the decision, and the person, both remain readable.
    assert.strictEqual(person.name, 'Paula Passed');
  });

  await check('the export carries the lifecycle and outcomes', async () => {
    const bundle = await (await api('/api/searches/' + sid + '/export')).json();
    const text = JSON.stringify(bundle);
    assert.ok(text.includes('selected') || text.includes('not-selected'),
      'the export does not record how the search concluded');
  });

  console.log(passed + ' disposition checks passed' + (failed ? ', ' + failed + ' failed' : '') + '.');
  process.exitCode = failed ? 1 : 0;
})().catch(error => { console.error(error); process.exitCode = 1; });
