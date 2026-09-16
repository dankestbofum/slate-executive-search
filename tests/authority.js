'use strict';

// The late-stage authority matrix (docs/late-stage-pilot-plan.md section 3).
//
// Every row of that table is a decision somebody has to be allowed to make and
// somebody else has to be refused. The rows here are the same rows, checked
// three ways each: the route refuses the wrong person, the record is unchanged
// after the refusal, and the answer the client is given on a read agrees with
// what the route did. The third one matters as much as the first — a screen
// that offers a button the server will refuse is how a rehearsal produces a
// defect report instead of a decision.
//
// Three identities, because "consultant" is not one thing:
//
//   mike  — holds the account on the search. The search manager.
//   team  — a consultant in the same workspace, on the roster, not the manager.
//   abe   — the workspace administrator, who does not run this search.
//
// Refusing `team` is the whole point. They can read everything, edit the file,
// and do the firm's work; what they cannot do is make the decisions the county
// will be shown a record of.

const assert = require('assert');
const identity = require('./identity');

const BASE = process.env.SLATE_URL || 'http://127.0.0.1:4173';
const JSON_HEADERS = { 'Content-Type': 'application/json' };
let passed = 0;
let failed = 0;

async function check(name, fn) {
  try { await fn(); passed += 1; console.log('PASS  Authority: ' + name); }
  catch (error) { failed += 1; console.error('FAIL  Authority: ' + name + '\n      ' + error.message); }
}

const sign = identity.signer();

async function api(path, { auth, method = 'GET', body, revision } = {}) {
  const headers = { ...JSON_HEADERS, ...auth };
  // Every write carries the current revision unless the caller pinned one, so
  // a refusal here is about authority rather than about a stale read.
  if (revision === undefined && method !== 'GET') {
    const current = await (await fetch(BASE + path.replace(/^(\/api\/searches\/[^/]+).*$/, '$1'), { headers: { ...JSON_HEADERS, ...auth } })).json().catch(() => null);
    if (current && current.revision !== undefined) headers['if-match'] = String(current.revision);
  } else if (revision !== undefined) {
    headers['if-match'] = String(revision);
  }
  return fetch(BASE + path, { method, headers, body: body ? JSON.stringify(body) : undefined });
}

/** The search as one identity currently sees it. */
async function read(id, auth) {
  const res = await api('/api/searches/' + id, { auth });
  assert.strictEqual(res.status, 200, 'could not read the search: ' + res.status);
  return res.json();
}

/** Assert a refusal that names the matrix, and that nothing moved. */
async function refused(res, action) {
  assert.strictEqual(res.status, 403, 'expected 403, got ' + res.status + ': ' + await res.clone().text());
  const body = await res.json();
  assert.strictEqual(body.code, 'AUTHORITY_REQUIRED', 'refusal did not name the matrix: ' + JSON.stringify(body));
  assert.strictEqual(body.action, action, 'refusal named ' + body.action + ', expected ' + action);
  assert.ok(body.error && body.error.length > 20, 'the refusal did not say who decides');
}

(async () => {
  const manager = sign.headers('mike@slate.local');
  const consultant = sign.headers('team@slate.local');
  const admin = sign.headers('abe@slate.local');

  // One Executive search, run by mike, with team on the roster as a consultant
  // so every refusal below is about authority and never about access.
  const opened = await api('/api/searches', {
    auth: manager, method: 'POST', revision: null,
    body: { client: 'Authority County', position: 'County Administrator', jurisdictionType: 'county', package: 'executive' }
  });
  assert.strictEqual(opened.status, 200, 'could not open the fixture search');
  const id = (await opened.json()).id;
  assert.strictEqual((await api('/api/searches/' + id + '/members/self', { auth: consultant, method: 'POST', body: {} })).status, 200,
    'the second consultant could not join the search');

  const addCandidate = async name => {
    const res = await api('/api/searches/' + id + '/candidates', { auth: manager, method: 'POST', body: { name } });
    assert.strictEqual(res.status, 200, 'could not add ' + name);
    return (await res.json()).candidates.find(c => c.name === name);
  };
  const stage = (cid, to, auth) =>
    api('/api/searches/' + id + '/candidates/' + cid, { auth, method: 'PATCH', body: { stage: to } });
  const candidateNow = async (cid, auth = manager) =>
    (await read(id, auth)).candidates.find(c => c.id === cid);

  const hired = await addCandidate('Alina Fixture-Hired');
  const withdrew = await addCandidate('Bo Fixture-Withdrew');

  /* ---------------- The matrix the client is handed ---------------- */

  await check('every read carries the same answers the routes enforce', async () => {
    const asManager = (await read(id, manager)).you.may;
    const asConsultant = (await read(id, consultant)).you.may;
    assert.ok(asManager && asConsultant, 'a read did not carry the authority answers');

    // Pinned deliberately. Changing one of these is changing the accepted
    // matrix, which is a decision in docs/late-stage-pilot-plan.md, not an
    // implementation detail — so it fails here until the table is revised too.
    for (const action of ['advanceFinalist', 'releaseScores', 'recordOutcome', 'certifyReferences',
      'closeSearch', 'reopenSearch', 'archiveSearch', 'restoreArchive', 'handoverManager']) {
      assert.strictEqual(asManager[action], true, 'the manager was not offered ' + action);
      assert.strictEqual(asConsultant[action], false, 'an ordinary consultant was offered ' + action);
    }
    for (const action of ['advanceStage', 'certifyStaffWork', 'restoreHistory', 'exportRecords']) {
      assert.strictEqual(asConsultant[action], true, 'a consultant was refused ordinary work: ' + action);
    }
  });

  await check('a committee member is offered no late-stage decision at all', async () => {
    const res = await api('/api/searches/' + id + '/members', {
      auth: manager, method: 'POST',
      body: { name: 'Pat Authority-Committee', email: 'pat-authority@example.com', searchRole: 'committee' }
    });
    assert.strictEqual(res.status, 200, 'could not add the committee member');
    const body = await res.json();
    if (!body.added) {
      const held = (body.pending || []).find(p => p.email === 'pat-authority@example.com');
      assert.ok(held, 'the committee place was neither taken nor held');
      if (!body.invitationSent) {
        assert.strictEqual((await api('/api/organization/invitations', {
          auth: admin, method: 'POST', revision: null, body: { email: 'pat-authority@example.com', role: 'org:committee' }
        })).status, 200, 'the administrator could not invite the committee member');
      }
      assert.strictEqual((await api('/api/me', { auth: sign.headers('pat-authority@example.com') })).status, 200);
    }
    const seen = await read(id, sign.headers('pat-authority@example.com'));
    assert.ok(seen.you.may, 'the committee member received no authority answers');
    for (const [action, allowed] of Object.entries(seen.you.may)) {
      assert.strictEqual(allowed, false, 'a committee member was offered ' + action);
    }
  });

  /* ---------------- Advancing, and the line at finalist ---------------- */

  await check('an ordinary consultant screens candidates through the early stages', async () => {
    assert.strictEqual((await stage(hired.id, 'semifinalist', consultant)).status, 200);
    assert.strictEqual((await stage(withdrew.id, 'semifinalist', consultant)).status, 200);
    assert.strictEqual((await candidateNow(hired.id)).stage, 'semifinalist');
  });

  await check('an ordinary consultant cannot advance anyone to finalist', async () => {
    await refused(await stage(hired.id, 'finalist', consultant), 'advanceFinalist');
    assert.strictEqual((await candidateNow(hired.id)).stage, 'semifinalist',
      'the refused advancement changed the record anyway');
  });

  await check('the manager advances finalists', async () => {
    assert.strictEqual((await stage(hired.id, 'finalist', manager)).status, 200);
    assert.strictEqual((await candidateNow(hired.id)).stage, 'finalist');
  });

  await check('reversing a finalist advancement needs the same authority', async () => {
    await refused(await stage(hired.id, 'semifinalist', consultant), 'advanceFinalist');
    assert.strictEqual((await candidateNow(hired.id)).stage, 'finalist');
  });

  /* ---------------- Releasing scores ---------------- */

  await check('an ordinary consultant cannot release or reseal scores', async () => {
    await refused(await api('/api/searches/' + id, { auth: consultant, method: 'PATCH', body: { released: true } }), 'releaseScores');
    assert.strictEqual((await read(id, manager)).released, false, 'the refused release happened anyway');
  });

  await check('the release field is guarded on the generic facts path, not only on its own button', async () => {
    // The client sends `{ released: true }` to the same route it sends a
    // corrected population to. Smuggling it in beside an ordinary fact must not
    // carry it past the check.
    const res = await api('/api/searches/' + id, {
      auth: consultant, method: 'PATCH', body: { population: '61,200', released: true }
    });
    await refused(res, 'releaseScores');
    const after = await read(id, manager);
    assert.strictEqual(after.released, false, 'scores were released through the facts path');
    assert.notStrictEqual(after.population, '61,200', 'a refused request wrote its other fields');
  });

  await check('the manager releases scores', async () => {
    assert.strictEqual((await api('/api/searches/' + id, { auth: manager, method: 'PATCH', body: { released: true } })).status, 200);
    assert.strictEqual((await read(id, manager)).released, true);
  });

  /* ---------------- Staff work, consent, and certification ---------------- */

  await check('a consultant certifies their own sourcing work', async () => {
    assert.strictEqual((await api('/api/searches/' + id + '/staff/sourcing/log', {
      auth: consultant, method: 'POST', body: { text: 'Called two sitting administrators along the corridor.' }
    })).status, 200);
    assert.strictEqual((await api('/api/searches/' + id + '/staff/sourcing/complete', {
      auth: consultant, method: 'POST', body: { done: true }
    })).status, 200);
    assert.ok((await read(id, consultant)).staff.sourcing.doneAt, 'sourcing was not certified');
  });

  await check('an ordinary consultant cannot certify reference completion', async () => {
    assert.strictEqual((await api('/api/searches/' + id + '/candidates/' + hired.id + '/consent', {
      auth: consultant, method: 'POST', body: { consent: true }
    })).status, 200, 'a consultant could not record consent, which is their work');
    assert.strictEqual((await api('/api/searches/' + id + '/staff/references/log', {
      auth: consultant, method: 'POST', body: { text: 'Spoke with a former mayor.', candidateId: hired.id }
    })).status, 200, 'a consultant could not log a reference contact, which is their work');

    await refused(await api('/api/searches/' + id + '/staff/references/complete', {
      auth: consultant, method: 'POST', body: { done: true }
    }), 'certifyReferences');
    assert.strictEqual((await read(id, manager)).staff.references.doneAt, null,
      'the refused certification was recorded anyway');
  });

  await check('the manager certifies reference completion', async () => {
    const res = await api('/api/searches/' + id + '/staff/references/complete', { auth: manager, method: 'POST', body: { done: true } });
    assert.strictEqual(res.status, 200, await res.text());
    assert.ok((await read(id, manager)).staff.references.doneAt, 'references were not certified');
  });

  /* ---------------- A certification describes evidence that can change ---- */

  await check('rewriting the working notes withdraws the certification', async () => {
    assert.strictEqual((await api('/api/searches/' + id + '/staff/references/', {
      auth: consultant, method: 'PUT', body: { notes: 'Second conversation still outstanding.' }
    })).status, 200);
    assert.strictEqual((await read(id, manager)).staff.references.doneAt, null,
      'the completion survived a rewrite of the notes it rested on');
  });

  await check('removing a log entry withdraws the certification', async () => {
    await api('/api/searches/' + id + '/staff/references/complete', { auth: manager, method: 'POST', body: { done: true } });
    const before = await read(id, manager);
    assert.ok(before.staff.references.doneAt, 'could not re-certify for this case');
    const entry = before.staff.references.log[0];
    assert.strictEqual((await api('/api/searches/' + id + '/staff/references/log/' + entry.id, {
      auth: consultant, method: 'DELETE'
    })).status, 200);
    assert.strictEqual((await read(id, manager)).staff.references.doneAt, null,
      'the completion survived the removal of the evidence under it');
  });

  await check('withdrawing a finalist’s consent withdraws the certification', async () => {
    await api('/api/searches/' + id + '/staff/references/log', {
      auth: consultant, method: 'POST', body: { text: 'Second reference reached; notes filed in the restricted folder.', candidateId: hired.id }
    });
    await api('/api/searches/' + id + '/staff/references/complete', { auth: manager, method: 'POST', body: { done: true } });
    assert.ok((await read(id, manager)).staff.references.doneAt, 'could not re-certify for this case');

    assert.strictEqual((await api('/api/searches/' + id + '/candidates/' + hired.id + '/consent', {
      auth: consultant, method: 'POST', body: { consent: false }
    })).status, 200);
    assert.strictEqual((await read(id, manager)).staff.references.doneAt, null,
      'a certification stood over a finalist who had withdrawn consent');
  });

  await check('adding a finalist withdraws a certification that never covered them', async () => {
    await api('/api/searches/' + id + '/candidates/' + hired.id + '/consent', { auth: consultant, method: 'POST', body: { consent: true } });
    await api('/api/searches/' + id + '/staff/references/log', {
      auth: consultant, method: 'POST', body: { text: 'Reference conversation repeated after consent was restored.', candidateId: hired.id }
    });
    await api('/api/searches/' + id + '/staff/references/complete', { auth: manager, method: 'POST', body: { done: true } });
    assert.ok((await read(id, manager)).staff.references.doneAt, 'could not re-certify for this case');

    assert.strictEqual((await stage(withdrew.id, 'finalist', manager)).status, 200);
    assert.strictEqual((await read(id, manager)).staff.references.doneAt, null,
      'a certification stood over a finalist it had never covered');
    // Put the roster back: this case is about the certification, not about Bo.
    assert.strictEqual((await stage(withdrew.id, 'semifinalist', manager)).status, 200);
  });

  /* ---------------- Outcomes ---------------- */

  await check('an ordinary consultant cannot record an outcome', async () => {
    await refused(await api('/api/searches/' + id + '/candidates/' + withdrew.id + '/disposition', {
      auth: consultant, method: 'POST', body: { outcome: 'withdrawn', reason: 'Told the consultant by telephone.' }
    }), 'recordOutcome');
    const bo = await candidateNow(withdrew.id);
    assert.ok(!bo.disposition, 'the refused outcome was recorded anyway');
    assert.ok(bo.invite, 'a refused outcome revoked the candidate’s link');
  });

  await check('the manager records outcomes, and a correction keeps the original', async () => {
    assert.strictEqual((await api('/api/searches/' + id + '/candidates/' + withdrew.id + '/disposition', {
      auth: manager, method: 'POST', body: { outcome: 'not-selected', reason: 'Recorded in error during the rehearsal.', evidence: 'S1 scores from the panel.' }
    })).status, 200);
    assert.strictEqual((await api('/api/searches/' + id + '/candidates/' + withdrew.id + '/disposition', {
      auth: manager, method: 'POST', body: { outcome: 'withdrawn', reason: 'Correcting the entry above: Bo withdrew by telephone.', correction: true }
    })).status, 200);
    const bo = await candidateNow(withdrew.id);
    assert.strictEqual(bo.dispositions.length, 2, 'the correction replaced the original instead of superseding it');
    assert.strictEqual(bo.dispositions[0].outcome, 'not-selected', 'the original decision did not survive');
    assert.ok(bo.dispositions[1].supersedes, 'the correction did not name what it replaced');
  });

  /* ---------------- Handover ---------------- */

  await check('an ordinary consultant cannot take the account', async () => {
    const me = (await read(id, consultant)).you.userId || (await (await api('/api/me', { auth: consultant })).json()).user.id;
    await refused(await api('/api/searches/' + id + '/members/' + me, {
      auth: consultant, method: 'PATCH', body: { searchRole: 'manager' }
    }), 'handoverManager');
    const after = await read(id, manager);
    assert.notStrictEqual(after.accountManager.userId, me, 'a consultant took the account after being refused');
  });

  /* ---------------- Closing, reopening, archiving ---------------- */

  await check('an ordinary consultant cannot close the search', async () => {
    await refused(await api('/api/searches/' + id + '/close', {
      auth: consultant, method: 'POST', body: { status: 'closed', reason: 'Rehearsal closeout.' }
    }), 'closeSearch');
    assert.strictEqual((await read(id, manager)).lifecycle.status, 'active', 'the refused close froze the file anyway');
  });

  await check('the manager closes the search and every outstanding link is revoked', async () => {
    const res = await api('/api/searches/' + id + '/close', {
      auth: manager, method: 'POST', body: { status: 'closed', reason: 'Appointment made; rehearsal closeout.' }
    });
    assert.strictEqual(res.status, 200, await res.text());
    const after = await read(id, manager);
    assert.strictEqual(after.lifecycle.status, 'closed');
    assert.ok(!(after.candidates || []).some(c => c.invite), 'a candidate link survived closeout');
  });

  await check('an ordinary consultant cannot reopen a closed search', async () => {
    await refused(await api('/api/searches/' + id + '/reopen', {
      auth: consultant, method: 'POST', body: { reason: 'Wanted to keep working.' }
    }), 'reopenSearch');
    assert.strictEqual((await read(id, manager)).lifecycle.status, 'closed');
  });

  await check('the manager reopens it, and old links stay dead', async () => {
    assert.strictEqual((await api('/api/searches/' + id + '/reopen', {
      auth: manager, method: 'POST', body: { reason: 'One reference conversation outstanding.' }
    })).status, 200);
    const after = await read(id, manager);
    assert.strictEqual(after.lifecycle.status, 'active');
    assert.ok(!(after.candidates || []).some(c => c.invite), 'reopening put revoked candidate links back into circulation');
  });

  await check('an ordinary consultant cannot archive the search, alone or in a batch', async () => {
    await refused(await api('/api/searches/' + id, { auth: consultant, method: 'DELETE' }), 'archiveSearch');
    const batch = await api('/api/searches/bulk-delete', { auth: consultant, method: 'POST', revision: null, body: { ids: [id] } });
    assert.strictEqual(batch.status, 403, 'a batch archived what a single request could not');
    assert.strictEqual((await api('/api/searches/' + id, { auth: manager })).status, 200,
      'the search was archived by a refused request');
  });

  await check('the archive index says who restores each search', async () => {
    assert.strictEqual((await api('/api/searches/' + id, { auth: manager, method: 'DELETE' })).status, 200);
    const listed = await (await api('/api/archives', { auth: consultant })).json();
    const row = listed.find(s => s.id === id);
    assert.ok(row, 'the archived search was not listed');
    assert.strictEqual(row.mayRestore, false, 'the index offered a restore that would be refused');
    assert.ok(row.managerName, 'the index did not say who to ask');
  });

  await check('an ordinary consultant cannot restore an archived search', async () => {
    await refused(await api('/api/archives/' + id + '/restore', { auth: consultant, method: 'POST', revision: null }), 'restoreArchive');
    assert.strictEqual((await api('/api/searches/' + id, { auth: manager })).status, 404,
      'the refused restore put the search back anyway');
  });

  await check('its manager restores it', async () => {
    const res = await api('/api/archives/' + id + '/restore', { auth: manager, method: 'POST', revision: null });
    assert.strictEqual(res.status, 200, await res.text());
    const back = await read(id, manager);
    assert.strictEqual(back.lifecycle.status, 'active');
    // Restoration is a filing decision, not a grant. Everything the matrix
    // reserved before the search was filed away is still reserved.
    assert.strictEqual((await read(id, consultant)).you.may.closeSearch, false,
      'restoration widened what an ordinary consultant may do');
  });

  console.log(passed + ' authority checks passed' + (failed ? ', ' + failed + ' failed' : '') + '.');
  process.exitCode = failed ? 1 : 0;
})().catch(error => { console.error(error); process.exitCode = 1; });
