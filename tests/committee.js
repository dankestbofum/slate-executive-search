'use strict';

/**
 * Committee aggregate acceptance evidence (docs/audits/2026-09-17-committee-aggregate).
 *
 * The diagnostic's twelve findings, promoted to tests that assert the
 * *corrected* behaviour rather than reproducing the defect. The original audit
 * scripts stay in the docs folder as historical reproductions; several of them
 * deliberately assert the old behaviour and would fail here on purpose.
 *
 * Findings covered: CA-01 drafts stay private; CA-02 publication needs a closed
 * window; CA-03 adoption records dated evidence and rebuilding is reviewable;
 * CA-04 saving a draft does not retract a submission; CA-05 disagreement
 * survives adoption; CA-06 profile gaps are not committee-coverage gaps; CA-07
 * one identity for a criterion; CA-08 provenance survives renaming; CA-09 the
 * AI contract has a discussion list instead of an impossible instruction;
 * CA-10 the privacy explanation is consistent; CA-11 intake weight controls are
 * named; CA-12 independent members do not conflict with one another.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const identity = require('./identity');
const committee = require('../server/committee');

const BASE = process.env.SLATE_URL || 'http://127.0.0.1:4173';
const JSON_HEADERS = { 'Content-Type': 'application/json' };
let passed = 0;
let failed = 0;

async function check(name, fn) {
  try { await fn(); passed += 1; console.log('PASS  Committee: ' + name); }
  catch (error) { failed += 1; console.error('FAIL  Committee: ' + name + '\n      ' + (error.stack || error.message)); }
}

const sign = identity.signer();

async function api(path, { auth, method = 'GET', body, revision, responseRevision } = {}) {
  const headers = { ...JSON_HEADERS, ...auth };
  if (revision !== undefined) headers['if-match'] = String(revision);
  const payload = responseRevision === undefined ? body : { ...body, responseRevision };
  const res = await fetch(BASE + path, {
    method, headers, body: payload ? JSON.stringify(payload) : undefined
  });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { json = { raw: text }; }
  return { status: res.status, json };
}

const read = (id, auth) => api('/api/searches/' + id, { auth }).then(r => r.json);

async function revisionOf(id, auth) {
  return String((await read(id, auth)).revision);
}

/** A write that carries the current search revision, the way the browser does. */
async function write(path, { auth, method = 'POST', body, id }) {
  return api(path, { auth, method, body, revision: await revisionOf(id, auth) });
}

/** This member's own response revision, which personal intake writes carry. */
async function myRevision(id, auth, userId) {
  const search = await read(id, auth);
  return Number((search.intake?.responses || {})[userId]?.revision || 1);
}

/** Stand up a search with a manager and `names.length` committee members. */
async function standUp(client, names, qualities) {
  const abe = sign.headers('abe@slate.local');
  const made = await api('/api/searches', {
    auth: abe, method: 'POST', body: { client, position: 'City Manager', state: 'Nevada' }
  });
  assert.strictEqual(made.status, 200, 'could not open ' + client);
  const id = made.json.id;
  const people = {};
  for (const name of names) {
    const email = name + '-' + id.toLowerCase() + '@example.test';
    const added = await write('/api/searches/' + id + '/members', {
      auth: abe, id, body: { name: name + ' Member', email, searchRole: 'committee' }
    });
    assert.strictEqual(added.status, 200, 'adding ' + email + ' returned ' + added.status);
    if (!added.json.added) {
      await api('/api/organization/invitations', {
        auth: abe, method: 'POST', body: { email, role: 'org:committee' }
      });
      assert.strictEqual((await api('/api/me', { auth: sign.headers(email) })).status, 200);
    }
    const roster = (await read(id, abe)).roster || [];
    const row = roster.find(m => m.email === email.toLowerCase());
    assert.ok(row, 'member ' + email + ' never joined the roster');
    people[name] = { auth: sign.headers(email), userId: row.userId, email };
  }
  await write('/api/searches/' + id + '/team/confirm', { auth: abe, id, body: { confirmed: true } });
  if (qualities) {
    const prepared = await write('/api/searches/' + id + '/intake/qualities', {
      auth: abe, id, method: 'PUT', body: { qualities }
    });
    assert.strictEqual(prepared.status, 200);
  }
  const opened = await write('/api/searches/' + id + '/intake/status', {
    auth: abe, id, body: { status: 'open' }
  });
  assert.strictEqual(opened.status, 200, 'intake did not open: ' + JSON.stringify(opened.json));
  return { id, abe, people };
}

async function submit(id, who, items, extra = {}) {
  return api('/api/searches/' + id + '/intake', {
    auth: who.auth, method: 'PUT',
    body: { submitted: true, items, ...extra },
    responseRevision: await myRevision(id, who.auth, who.userId)
  });
}

async function saveDraft(id, who, items, extra = {}) {
  return api('/api/searches/' + id + '/intake', {
    auth: who.auth, method: 'PUT',
    body: { submitted: false, items, ...extra },
    responseRevision: await myRevision(id, who.auth, who.userId)
  });
}

const closeIntake = (id, abe, body = {}) =>
  write('/api/searches/' + id + '/intake/status', { auth: abe, id, body: { status: 'closed', ...body } });

const openIntake = (id, abe) =>
  write('/api/searches/' + id + '/intake/status', { auth: abe, id, body: { status: 'open' } });

async function adopt(id, abe, body = {}) {
  const preview = await write('/api/searches/' + id + '/intake/adopt', { auth: abe, id, body: { preview: true, ...body } });
  assert.strictEqual(preview.status, 200, 'preview failed: ' + JSON.stringify(preview.json));
  const applied = await write('/api/searches/' + id + '/intake/adopt', {
    auth: abe, id,
    body: { ...body, fingerprint: preview.json.fingerprint, profileRevision: preview.json.profileRevision }
  });
  assert.strictEqual(applied.status, 200, 'adoption failed: ' + JSON.stringify(applied.json));
  return { preview: preview.json, applied: applied.json };
}

const archive = (id, abe) => write('/api/searches/' + id, { auth: abe, id, method: 'DELETE' });

(async () => {
  await check('shared qualities require explicit ratings and aggregate independent submissions', async () => {
    const qualities = [{ kind:'skill', label:'Budgeting' }, { kind:'skill', label:'Communication' }];
    const { id, abe, people } = await standUp('Shared qualities', ['alice', 'bob'], qualities);
    try {
      const seen = await read(id, people.alice.auth);
      assert.deepStrictEqual(seen.intake.qualities, qualities);
      const forbidden = await write('/api/searches/' + id + '/intake/qualities', {
        auth: people.alice.auth, id, method:'PUT', body:{ qualities:[] }
      });
      assert.strictEqual(forbidden.status, 403);
      const frozen = await write('/api/searches/' + id + '/intake/qualities', {
        auth: abe, id, method:'PUT', body:{ qualities:[] }
      });
      assert.strictEqual(frozen.status, 409);
      await saveDraft(id, people.alice, [{ ...qualities[0], weight:5, note:'PRIVATE_SHARED_NOTE' }]);
      const draft = (await read(id, people.alice.auth)).intake.responses[people.alice.userId].draft;
      assert.strictEqual(draft.items.find(i => i.label === 'Communication').weight, null);
      assert.doesNotMatch(JSON.stringify(await read(id, abe)), /PRIVATE_SHARED_NOTE/);
      assert.strictEqual((await submit(id, people.alice, [{ ...qualities[0], weight:5 }])).status, 400);
      assert.strictEqual((await read(id, abe)).consensus.submitted, 0);
      assert.strictEqual((await submit(id, people.alice, qualities.map((q,i) => ({ ...q, weight:i ? 5 : 1 })))).status, 200);
      assert.strictEqual((await submit(id, people.bob, qualities.map((q,i) => ({ ...q, weight:i ? 3 : 1 })))).status, 200);
      const own = (await read(id, abe)).you;
      const ownerId = (await read(id, abe)).roster.find(r => r.searchRole === own.searchRole).userId;
      assert.strictEqual((await submit(id, {auth:abe, userId:ownerId}, qualities.map((q,i) => ({ ...q, weight:i ? 4 : 1 })))).status, 200);
      const agg = (await read(id, abe)).consensus;
      assert.strictEqual(agg.submitted, 3);
      assert.strictEqual(agg.byKind.skill[0].label, 'Communication');
      assert.strictEqual(agg.byKind.skill[0].avgWeight, 4);
      assert.strictEqual(agg.byKind.skill[0].mentions, 3);
      assert.strictEqual((await read(id, people.bob.auth)).consensus, null);
      assert.strictEqual((await closeIntake(id, abe)).status, 200);
      const { applied } = await adopt(id, abe);
      assert.ok(applied.search.criteria.some(c => c.label === 'Communication' && c.weight === 4));
      assert.strictEqual((await read(id, people.bob.auth)).consensus.submitted, 3);
    } finally { await archive(id, abe); }
  });

  /* --- CA-01, CA-10: a draft belongs to its author ---------------------- */

  await check('an unfinished draft never reaches another member, before or after closing', async () => {
    const { id, abe, people } = await standUp('Draft Privacy', ['alice', 'bob']);
    try {
      await saveDraft(id, people.alice, [{ kind: 'skill', label: 'Budgeting', weight: 4, note: 'ALICE_PRIVATE_NOTE' }],
        { context: 'ALICE_PRIVATE_CONTEXT' });
      await submit(id, people.bob, [{ kind: 'skill', label: 'Communication', weight: 5 }]);

      const whileOpen = JSON.stringify(await read(id, people.bob.auth));
      assert.doesNotMatch(whileOpen, /ALICE_PRIVATE/, 'a draft reached another member while the window was open');

      assert.strictEqual((await closeIntake(id, abe)).status, 200);
      const afterClose = JSON.stringify(await read(id, people.bob.auth));
      assert.doesNotMatch(afterClose, /ALICE_PRIVATE/, 'closing the window disclosed an unsubmitted draft (CA-01)');

      // The staff facilitating do not get it either. A draft is not "not yet
      // published"; it is not theirs.
      const staffView = JSON.stringify(await read(id, abe));
      assert.doesNotMatch(staffView, /ALICE_PRIVATE/, 'a draft reached the search team');

      // Its author still has it.
      const mine = await read(id, people.alice.auth);
      assert.strictEqual(mine.intake.responses[people.alice.userId].draft.context, 'ALICE_PRIVATE_CONTEXT',
        'the author lost their own draft');
      assert.strictEqual(mine.consensus.submitted, 1, 'a draft was counted in the tally');
    } finally { await archive(id, abe); }
  });

  await check('who has answered is visible while what they said is not', async () => {
    const { id, abe, people } = await standUp('Answered Ticks', ['alice', 'bob']);
    try {
      await submit(id, people.bob, [{ kind: 'skill', label: 'Communication', weight: 5, note: 'BOB_REASON' }]);
      const seen = await read(id, people.alice.auth);
      assert.strictEqual(seen.intake.answered[people.bob.userId], true, 'the roster tick lost its answer');
      assert.strictEqual(seen.intake.answered[people.alice.userId], false);
      assert.doesNotMatch(JSON.stringify(seen), /BOB_REASON/, 'another member read a submitted answer early');
    } finally { await archive(id, abe); }
  });

  /* --- CA-02: publication waits for the window to close ----------------- */

  await check('no profile write path publishes committee input early', async () => {
    const { id, abe, people } = await standUp('Publication Boundary', ['alice', 'bob']);
    try {
      await submit(id, people.bob, [{ kind: 'skill', label: 'Budgeting', weight: 5, note: 'BOB_PRIVATE_NOTE' }]);

      const early = await write('/api/searches/' + id + '/intake/adopt', { auth: abe, id, body: {} });
      assert.strictEqual(early.status, 409, 'adoption published committee input while the window was open (CA-02)');
      assert.strictEqual(early.json.code, 'INTAKE_OPEN');

      const manual = await write('/api/searches/' + id + '/profile', {
        auth: abe, id, method: 'PUT',
        body: { criteria: [{ id: 'S1', kind: 'skill', label: 'Budgeting', weight: 5, note: 'BOB_PRIVATE_NOTE' }] }
      });
      assert.strictEqual(manual.status, 409, 'a manual profile save published while the window was open');

      const ai = await write('/api/searches/' + id + '/generate', { auth: abe, id, body: { kind: 'profile' } });
      assert.strictEqual(ai.status, 409, 'an AI profile write was attempted while the window was open');
      assert.strictEqual(ai.json.code, 'INTAKE_OPEN');

      const memberView = await read(id, people.alice.auth);
      assert.deepStrictEqual(memberView.criteria, [], 'an unpublished profile was sent to a committee member');
      assert.ok(memberView.profileWithheld, 'the withheld profile was not declared as withheld');
      assert.doesNotMatch(JSON.stringify(memberView), /BOB_PRIVATE_NOTE/);
      // Hiding the page is not enough if the record ships a second copy of it.
      assert.strictEqual(memberView.adoptions, undefined, 'the raw adoption records rode along on the search');
      assert.strictEqual(memberView.publication?.criteria, undefined,
        'the publication snapshot carried the withheld profile');
    } finally { await archive(id, abe); }
  });

  await check('reopening keeps the published profile and makes new input private again', async () => {
    const { id, abe, people } = await standUp('Reopening', ['alice', 'bob']);
    try {
      await submit(id, people.alice, [{ kind: 'skill', label: 'Budgeting', weight: 4 }]);
      await submit(id, people.bob, [{ kind: 'skill', label: 'Budgeting', weight: 5 }]);
      await closeIntake(id, abe);
      const { applied } = await adopt(id, abe);
      assert.ok(applied.search.publication?.at, 'publication was not dated');
      const publishedRevision = applied.search.publication.profileRevision;
      assert.ok(publishedRevision, 'the published profile revision was not recorded');

      assert.strictEqual((await openIntake(id, abe)).status, 200);
      const reopened = await read(id, abe);
      assert.strictEqual(reopened.publication.profileRevision, publishedRevision,
        'reopening moved the dated publication snapshot');
      assert.ok(reopened.publication.reopenedAt, 'reopening was not recorded against the publication');

      await submit(id, people.alice, [{ kind: 'skill', label: 'Grant writing', weight: 5, note: 'NEW_ROUND_NOTE' }]);
      const bobSees = JSON.stringify(await read(id, people.bob.auth));
      assert.doesNotMatch(bobSees, /NEW_ROUND_NOTE/, 'new input was published while the reopened window was open');

      const rebuild = await write('/api/searches/' + id + '/intake/adopt', { auth: abe, id, body: {} });
      assert.strictEqual(rebuild.status, 409, 'the profile could be republished while the window was open again');
    } finally { await archive(id, abe); }
  });

  /* --- CA-04, CA-12: drafts, submissions and independent members -------- */

  await check('saving a draft after submitting leaves the submitted answer in the tally', async () => {
    const { id, abe, people } = await standUp('Draft After Submit', ['alice']);
    try {
      await submit(id, people.alice, [{ kind: 'skill', label: 'Budgeting', weight: 5 }]);
      const revised = await saveDraft(id, people.alice, [{ kind: 'skill', label: 'Grant writing', weight: 2 }]);
      assert.strictEqual(revised.status, 200);
      const seen = await read(id, abe);
      assert.strictEqual(seen.consensus.submitted, 1, 'saving a draft retracted the submission (CA-04)');
      assert.strictEqual(seen.consensus.byKind.skill[0].label, 'Budgeting',
        'the tally moved to the unsubmitted draft');
      const mine = (await read(id, people.alice.auth)).intake.responses[people.alice.userId];
      assert.strictEqual(mine.draft.items[0].label, 'Grant writing', 'the draft was not kept');
      assert.strictEqual(mine.submitted.items[0].label, 'Budgeting', 'the submitted answer was not kept');

      // Only "Update my answers" replaces the committed version.
      await submit(id, people.alice, [{ kind: 'skill', label: 'Grant writing', weight: 2 }]);
      const after = await read(id, abe);
      assert.strictEqual(after.consensus.byKind.skill[0].label, 'Grant writing');
    } finally { await archive(id, abe); }
  });

  await check('two members submit independently without conflicting', async () => {
    const { id, abe, people } = await standUp('Independent Answers', ['alice', 'bob']);
    try {
      // Both opened the form at the same revision. The first submission moves
      // the search revision; the second must still succeed (CA-12).
      const stale = await revisionOf(id, people.bob.auth);
      assert.strictEqual((await submit(id, people.alice, [{ kind: 'skill', label: 'Budgeting', weight: 4 }])).status, 200);
      const second = await api('/api/searches/' + id + '/intake', {
        auth: people.bob.auth, method: 'PUT', revision: stale,
        body: { submitted: true, items: [{ kind: 'skill', label: 'Communication', weight: 5 }], responseRevision: 1 }
      });
      assert.strictEqual(second.status, 200,
        'an independent member was refused because somebody else answered (CA-12): ' + JSON.stringify(second.json));
      assert.strictEqual((await read(id, abe)).consensus.submitted, 2);
    } finally { await archive(id, abe); }
  });

  await check('the same member cannot silently overwrite themselves from a second tab', async () => {
    const { id, abe, people } = await standUp('Two Tabs', ['alice']);
    try {
      const tabOne = await myRevision(id, people.alice.auth, people.alice.userId);
      await submit(id, people.alice, [{ kind: 'skill', label: 'Budgeting', weight: 4 }]);
      const late = await api('/api/searches/' + id + '/intake', {
        auth: people.alice.auth, method: 'PUT',
        body: { submitted: true, items: [{ kind: 'skill', label: 'Something else', weight: 1 }], responseRevision: tabOne }
      });
      assert.strictEqual(late.status, 409, 'a stale tab overwrote the newer answer');
      assert.strictEqual(late.json.code, 'STALE_RESPONSE');
      // The refusal hands back the version that won, so recovery is a choice
      // rather than retyping.
      assert.strictEqual(late.json.response.submitted.items[0].label, 'Budgeting');
      assert.strictEqual((await read(id, abe)).consensus.byKind.skill[0].label, 'Budgeting');
    } finally { await archive(id, abe); }
  });

  await check('a client that does not know about drafts is refused, not obeyed', async () => {
    const { id, abe, people } = await standUp('Old Client', ['alice']);
    try {
      const old = await api('/api/searches/' + id + '/intake', {
        auth: people.alice.auth, method: 'PUT',
        body: { submitted: true, items: [{ kind: 'skill', label: 'Budgeting', weight: 4 }] }
      });
      assert.strictEqual(old.status, 428);
      assert.strictEqual(old.json.code, 'RESPONSE_REVISION_REQUIRED');
      assert.match(old.json.error, /Reload/);
    } finally { await archive(id, abe); }
  });

  await check('closing the window during an edit refuses clearly and keeps the record', async () => {
    const { id, abe, people } = await standUp('Closed Mid Edit', ['alice']);
    try {
      await submit(id, people.alice, [{ kind: 'skill', label: 'Budgeting', weight: 4 }]);
      await closeIntake(id, abe);
      const late = await saveDraft(id, people.alice, [{ kind: 'skill', label: 'Too late', weight: 1 }]);
      assert.strictEqual(late.status, 400);
      assert.strictEqual(late.json.code, 'INTAKE_SHUT');
      const mine = (await read(id, people.alice.auth)).intake.responses[people.alice.userId];
      assert.strictEqual(mine.submitted.items[0].label, 'Budgeting', 'a refused save damaged the record');
    } finally { await archive(id, abe); }
  });

  await check('withdrawal is its own action, and a draft save is never one', async () => {
    const { id, abe, people } = await standUp('Withdrawal', ['alice', 'bob']);
    try {
      await submit(id, people.alice, [{ kind: 'skill', label: 'Budgeting', weight: 4 }]);
      await submit(id, people.bob, [{ kind: 'skill', label: 'Budgeting', weight: 5 }]);
      await saveDraft(id, people.alice, [{ kind: 'skill', label: 'Rethinking', weight: 2 }]);
      assert.strictEqual((await read(id, abe)).consensus.submitted, 2, 'a draft save acted as a withdrawal');

      const gone = await api('/api/searches/' + id + '/intake/withdraw', { auth: people.alice.auth, method: 'POST', body: {} });
      assert.strictEqual(gone.status, 200);
      assert.strictEqual((await read(id, abe)).consensus.submitted, 1, 'withdrawal did not leave the tally');
      const mine = (await read(id, people.alice.auth)).intake.responses[people.alice.userId];
      assert.ok(mine.draft, 'withdrawing destroyed the answer instead of returning it');
      assert.ok(mine.withdrawnAt, 'the withdrawal was not recorded');

      const feed = (await read(id, abe)).activity.map(a => a.x).join(' | ');
      assert.match(feed, /withdrew their committee input/);
      assert.doesNotMatch(feed, /Rethinking/, 'the activity feed recorded draft contents');
    } finally { await archive(id, abe); }
  });

  /* --- CA-03, CA-05, CA-07, CA-08: adoption evidence -------------------- */

  await check('adoption records dated evidence, every reason, and the disagreement', async () => {
    const { id, abe, people } = await standUp('Contested Evidence', ['alice', 'bob']);
    try {
      await submit(id, people.alice, [{ kind: 'trait', label: 'Decisiveness', weight: 5, note: 'Council needs a lead.' }]);
      await submit(id, people.bob, [{ kind: 'trait', label: 'Decisiveness', weight: 1, note: 'We need a listener.' }]);
      await closeIntake(id, abe);
      const { applied } = await adopt(id, abe);
      const record = applied.search.adoption;
      assert.ok(record.at && record.respondents === 2 && record.participants >= 2, JSON.stringify(record));
      const group = record.groups.find(g => g.label === 'Decisiveness');
      assert.ok(group, 'the adopted line has no source group');
      assert.strictEqual(group.contested, true, 'the disagreement was flattened (CA-05)');
      assert.strictEqual(group.minWeight, 1);
      assert.strictEqual(group.maxWeight, 5);
      assert.strictEqual(group.reasons.length, 2, 'only one member’s reason was kept (CA-05)');

      const crit = applied.search.criteria.find(c => c.label === 'Decisiveness');
      assert.ok(crit.source?.key, 'the criterion has no durable link to its source');
      assert.match(crit.note, /divided/, 'the adopted note does not say the committee disagreed');
      assert.doesNotMatch(crit.note, /Council needs a lead|We need a listener/,
        'one member’s reason became the committee’s rationale (CA-05)');
    } finally { await archive(id, abe); }
  });

  await check('renaming a criterion keeps its origin and its adopted evidence', async () => {
    const { id, abe, people } = await standUp('Renaming', ['alice', 'bob']);
    try {
      const named = [{ kind: 'skill', label: 'Financial management', weight: 5 }];
      await submit(id, people.alice, named);
      await submit(id, people.bob, named);
      await closeIntake(id, abe);
      const { applied } = await adopt(id, abe);
      const before = applied.search.criteria.find(c => c.label === 'Financial management');

      const renamed = applied.search.criteria.map(c =>
        c.id === before.id ? { ...c, label: 'Financial management.' } : c);
      const saved = await write('/api/searches/' + id + '/profile', {
        auth: abe, id, method: 'PUT', body: { criteria: renamed }
      });
      assert.strictEqual(saved.status, 200, JSON.stringify(saved.json));
      const after = saved.json.criteria.find(c => c.id === before.id);
      assert.strictEqual(after.label, 'Financial management.');
      assert.strictEqual(after.from, 'committee', 'renaming changed where the line came from (CA-08)');
      assert.strictEqual(after.source.key, before.source.key, 'renaming dropped the source identity (CA-08)');

      // A hand-written criterion that happens to match the wording does not
      // inherit anybody's support.
      const withImposter = [...saved.json.criteria,
        { id: 'S9', kind: 'skill', label: 'Financial management', weight: 3, from: 'committee', source: { key: before.source.key } }];
      const second = await write('/api/searches/' + id + '/profile', {
        auth: abe, id, method: 'PUT', body: { criteria: withImposter }
      });
      assert.strictEqual(second.status, 200, JSON.stringify(second.json));
      const imposter = second.json.criteria.find(c => c.id === 'S9');
      assert.strictEqual(imposter.source, undefined, 'a hand-written criterion was given committee provenance (CA-08)');
      assert.strictEqual(imposter.from, 'consultant');
    } finally { await archive(id, abe); }
  });

  await check('changed input marks the profile as resting on earlier answers, and changes nothing else', async () => {
    const { id, abe, people } = await standUp('Source Change', ['alice', 'bob']);
    try {
      const old = [{ kind: 'skill', label: 'Old priority', weight: 5 }];
      await submit(id, people.alice, old);
      await submit(id, people.bob, old);
      await closeIntake(id, abe);
      const { applied } = await adopt(id, abe);
      assert.strictEqual(applied.search.sourceChanged, false, 'a fresh adoption was already stale');
      const adoptedIds = applied.search.criteria.map(c => c.id).join(',');

      await openIntake(id, abe);
      // A private draft is not a change to the input the profile describes.
      await saveDraft(id, people.alice, [{ kind: 'skill', label: 'Just thinking', weight: 1 }]);
      assert.strictEqual((await read(id, abe)).sourceChanged, false,
        'a private draft keystroke marked the published profile stale');

      await submit(id, people.alice, [{ kind: 'skill', label: 'New priority', weight: 5 }]);
      await submit(id, people.bob, [{ kind: 'skill', label: 'New priority', weight: 5 }]);
      const changed = await read(id, abe);
      assert.strictEqual(changed.sourceChanged, true, 'changed submissions raised no source-change warning (CA-03)');
      assert.strictEqual(changed.criteria.map(c => c.id).join(','), adoptedIds,
        'the adopted profile was rewritten in response to new input');
      assert.ok(changed.criteria.some(c => c.label === 'Old priority'),
        'the adopted profile changed without anybody deciding to');
    } finally { await archive(id, abe); }
  });

  await check('rebuilding proposes removals instead of carrying stale support forward', async () => {
    const { id, abe, people } = await standUp('Rebuild Review', ['alice', 'bob']);
    try {
      const old = [{ kind: 'skill', label: 'Old priority', weight: 5 }];
      await submit(id, people.alice, old);
      await submit(id, people.bob, old);
      await closeIntake(id, abe);
      await adopt(id, abe);

      await openIntake(id, abe);
      const fresh = [{ kind: 'skill', label: 'New priority', weight: 4 }];
      await submit(id, people.alice, fresh);
      await submit(id, people.bob, fresh);
      await closeIntake(id, abe);

      const preview = await write('/api/searches/' + id + '/intake/adopt', { auth: abe, id, body: { preview: true } });
      assert.strictEqual(preview.status, 200);
      assert.ok(preview.json.changes.added.some(r => r.label === 'New priority'), 'the new priority was not proposed');
      assert.ok(preview.json.changes.removed.some(r => r.label === 'Old priority'),
        'a priority nobody names any more was carried forward silently (CA-03)');
      assert.ok(!preview.json.criteria.some(c => c.label === 'Old priority'),
        'the unsupported priority stayed on the proposed profile');

      // Keeping it is possible, and it is labelled as a decision resting on
      // earlier answers rather than as current support.
      const kept = await adopt(id, abe, {
        retain: preview.json.changes.removed.map(r => r.id),
        retainReasons: Object.fromEntries(preview.json.changes.removed.map(r => [r.id, 'The council still wants it.']))
      });
      const held = kept.applied.search.criteria.find(c => c.label === 'Old priority');
      assert.ok(held, 'an explicitly retained criterion was dropped');
      assert.strictEqual(held.source.support, 'historical', 'a retained criterion still claims current support (CA-03)');
      assert.strictEqual(held.source.retainReason, 'The council still wants it.');
      assert.ok(kept.applied.search.adoption.retained.length, 'the retention was not recorded');
    } finally { await archive(id, abe); }
  });

  await check('adopting the same selection twice changes no criterion and no scoring', async () => {
    const { id, abe, people } = await standUp('Repeat Adoption', ['alice']);
    try {
      await submit(id, people.alice, [
        { kind: 'skill', label: 'Budgeting', weight: 4 },
        { kind: 'trait', label: 'Approachable', weight: 3 }
      ]);
      await closeIntake(id, abe);
      const first = await adopt(id, abe);
      const before = first.applied.search;
      const shape = c => [c.id, c.kind, c.label, c.weight, c.note].join('|');

      const second = await adopt(id, abe);
      const after = second.applied.search;
      assert.deepStrictEqual(after.criteria.map(shape), before.criteria.map(shape),
        'adopting the same selection twice moved the criteria');
      assert.strictEqual(after.profileRevision, before.profileRevision,
        'an unchanged profile was given a new revision, which would reset scoring');
      // The adoption itself is still recorded, because it is a decision
      // somebody made on a date.
      assert.strictEqual(after.adoption.id, 'ADOPT-2');
    } finally { await archive(id, abe); }
  });

  await check('a stale preview cannot be applied', async () => {
    const { id, abe, people } = await standUp('Stale Preview', ['alice', 'bob']);
    try {
      await submit(id, people.alice, [{ kind: 'skill', label: 'Budgeting', weight: 4 }]);
      await closeIntake(id, abe);
      const preview = await write('/api/searches/' + id + '/intake/adopt', { auth: abe, id, body: { preview: true } });
      assert.strictEqual(preview.status, 200);

      await openIntake(id, abe);
      await submit(id, people.bob, [{ kind: 'skill', label: 'Something new', weight: 5 }]);
      await closeIntake(id, abe);

      const applied = await write('/api/searches/' + id + '/intake/adopt', {
        auth: abe, id,
        body: { fingerprint: preview.json.fingerprint, profileRevision: preview.json.profileRevision }
      });
      assert.strictEqual(applied.status, 409, 'a preview built from older input was applied anyway');
      assert.strictEqual(applied.json.code, 'STALE_SOURCE');
    } finally { await archive(id, abe); }
  });

  /* --- CA-06: two different questions about completeness ---------------- */

  await check('a complete merged profile reports no gaps, and coverage is reported separately', async () => {
    const { id, abe, people } = await standUp('Gaps', ['alice']);
    try {
      await submit(id, people.alice, [{ kind: 'skill', label: 'Budgeting', weight: 5 }]);
      await closeIntake(id, abe);
      // Three hand-written criteria in every category, which is a complete
      // profile before the committee's one skill is merged in.
      const kinds = ['skill', 'trait', 'chall', 'opp'];
      const prefix = { skill: 'S', trait: 'T', chall: 'C', opp: 'O' };
      const hand = kinds.flatMap(kind => [1, 2, 3].map(n => ({
        id: prefix[kind] + n, kind, label: 'Existing ' + kind + ' ' + n, weight: 3, note: '', from: 'consultant'
      })));
      const saved = await write('/api/searches/' + id + '/profile', { auth: abe, id, method: 'PUT', body: { criteria: hand } });
      assert.strictEqual(saved.status, 200, JSON.stringify(saved.json));

      const { applied } = await adopt(id, abe);
      const counts = Object.fromEntries(kinds.map(k => [k, applied.search.criteria.filter(c => c.kind === k).length]));
      assert.deepStrictEqual(counts, { skill: 4, trait: 3, chall: 3, opp: 3 }, JSON.stringify(applied.search.criteria));
      assert.deepStrictEqual(applied.gaps, [], 'a complete profile was reported as still short (CA-06)');
      assert.ok(applied.coverage.some(g => g.kind === 'opp'),
        'committee coverage was not reported at all, so the two questions were merged');
    } finally { await archive(id, abe); }
  });

  /* --- CA-07: one identity for a criterion ------------------------------ */

  await check('labels that normalize to nothing keep separate, unique criterion IDs', async () => {
    const { id, abe, people } = await standUp('Duplicate IDs', ['alice', 'bob']);
    try {
      // "Strong" and "Good" are both stripped to empty text by the filler-word
      // normalizer, so only the fallback keeps them apart.
      await submit(id, people.alice, [{ kind: 'skill', label: 'Strong', weight: 5 }]);
      await submit(id, people.bob, [{ kind: 'skill', label: 'Good', weight: 4 }]);
      await closeIntake(id, abe);
      const saved = await write('/api/searches/' + id + '/profile', {
        auth: abe, id, method: 'PUT',
        body: { criteria: [{ id: 'S1', kind: 'skill', label: 'Strong', weight: 3, from: 'consultant' }] }
      });
      assert.strictEqual(saved.status, 200, JSON.stringify(saved.json));
      const { applied } = await adopt(id, abe);
      const ids = applied.search.criteria.map(c => c.id);
      assert.strictEqual(new Set(ids).size, ids.length, 'adoption produced duplicate criterion IDs (CA-07): ' + ids.join(','));
      assert.ok(applied.search.criteria.some(c => c.label === 'Strong'));
      assert.ok(applied.search.criteria.some(c => c.label === 'Good'));
    } finally { await archive(id, abe); }
  });

  /* --- CA-03: empty intake and roster changes --------------------------- */

  await check('only the organization administrator can skip intake, preserving private drafts and unblocking the profile', async () => {
    const { id, abe, people } = await standUp('Optional questionnaire', ['alice']);
    const endpoint = '/api/searches/' + id + '/intake/participation';
    try {
      for (const auth of [people.alice.auth, sign.headers('mike@slate.local')]) {
        assert.strictEqual((await write(endpoint, {auth, id, method:'PUT', body:{enabled:false}})).status, 403);
      }
      assert.strictEqual((await write(endpoint, {auth:abe, id, method:'PUT', body:{enabled:'false'}})).status, 400);
      await saveDraft(id, people.alice, [{kind:'skill', label:'PRIVATE_OPTIONAL_DRAFT', weight:4}]);
      const skipped = await write(endpoint, {auth:abe, id, method:'PUT', body:{enabled:false}});
      assert.strictEqual(skipped.status, 200);
      assert.ok(skipped.json.intake.skipped.by);
      assert.strictEqual(skipped.json.intake.status, 'closed');
      assert.strictEqual(skipped.json.steps.find(s => s.key === 'intake').skipped, true);
      assert.strictEqual(skipped.json.steps.find(s => s.key === 'profile').blocked, false);
      assert.doesNotMatch(JSON.stringify(skipped.json), /PRIVATE_OPTIONAL_DRAFT/);
      assert.match(JSON.stringify((await read(id, people.alice.auth)).intake.responses), /PRIVATE_OPTIONAL_DRAFT/);
      assert.strictEqual((await openIntake(id, abe)).json.code, 'INTAKE_SKIPPED');
      assert.strictEqual((await submit(id, people.alice, [{kind:'skill', label:'Budgeting', weight:5}])).status, 400);
      const saved = await write('/api/searches/' + id + '/profile', { auth:abe, id, method:'PUT', body:{criteria:[
        {id:'S1',kind:'skill',label:'Budgeting',weight:5}, {id:'S2',kind:'skill',label:'Communication',weight:4}, {id:'S3',kind:'skill',label:'Staff leadership',weight:4}
      ]}});
      assert.strictEqual(saved.status, 200, JSON.stringify(saved.json));
      const enabled = await write(endpoint, {auth:abe, id, method:'PUT', body:{enabled:true}});
      assert.strictEqual(enabled.status, 200);
      assert.strictEqual(enabled.json.intake.skipped, null);
      assert.strictEqual(enabled.json.intake.status, 'draft');
      assert.strictEqual(enabled.json.intake.completedEmpty, null);
      assert.strictEqual((await openIntake(id, abe)).status, 200);
      assert.strictEqual((await submit(id, people.alice, [{kind:'skill', label:'Budgeting', weight:5}])).status, 200);
      assert.strictEqual((await write(endpoint, {auth:abe, id, method:'PUT', body:{enabled:false}})).json.code, 'INTAKE_HAS_SUBMISSIONS');
      assert.strictEqual((await read(id, abe)).consensus.submitted, 1);
    } finally { await archive(id, abe); }
  });

  await check('completing without committee input is a recorded decision', async () => {
    const { id, abe } = await standUp('Empty Intake', []);
    try {
      const refused = await closeIntake(id, abe);
      assert.strictEqual(refused.status, 409, 'an empty window closed with no decision recorded');
      assert.strictEqual(refused.json.code, 'EMPTY_INTAKE');
      const closed = await closeIntake(id, abe, { emptyReason: 'The council asked us to proceed on the prior profile.' });
      assert.strictEqual(closed.status, 200, JSON.stringify(closed.json));
      assert.match(closed.json.intake.completedEmpty.reason, /prior profile/);
      assert.match(closed.json.activity[0].x, /without input/);
    } finally { await archive(id, abe); }
  });

  await check('the organization administrator can choose optional intake on another manager\'s search', async () => {
    const abe = sign.headers('abe@slate.local'), mike = sign.headers('mike@slate.local');
    const made = await api('/api/searches', {auth:mike, method:'POST', body:{client:'Optional intake authority',position:'City Manager'}});
    assert.strictEqual(made.status, 200);
    const id = made.json.id;
    const endpoint = '/api/searches/' + id + '/intake/participation';
    try {
      assert.strictEqual((await write(endpoint, {auth:abe,id,method:'PUT',body:{enabled:false}})).json.code, 'ROSTER_UNCONFIRMED');
      await write('/api/searches/' + id + '/team/confirm', {auth:mike,id,body:{confirmed:true}});
      assert.strictEqual((await write(endpoint, {auth:mike,id,method:'PUT',body:{enabled:false}})).status, 403);
      const skipped = await write(endpoint, {auth:abe,id,method:'PUT',body:{enabled:false}});
      assert.strictEqual(skipped.status, 200);
      assert.strictEqual(skipped.json.you.canManage, false);
      assert.strictEqual(skipped.json.steps.find(s => s.key === 'profile').blocked, false);
      assert.strictEqual((await write(endpoint, {auth:mike,id,method:'PUT',body:{enabled:true}})).status, 403);
      assert.strictEqual((await write(endpoint, {auth:abe,id,method:'PUT',body:{enabled:true}})).status, 200);
    } finally { await archive(id, mike); }
  });

  await check('a roster change during the window has to be reconfirmed before closing', async () => {
    const { id, abe, people } = await standUp('Roster Change', ['alice']);
    try {
      await submit(id, people.alice, [{ kind: 'skill', label: 'Budgeting', weight: 4 }]);
      const email = 'late-' + id.toLowerCase() + '@example.test';
      const added = await write('/api/searches/' + id + '/members', {
        auth: abe, id, body: { name: 'Late Arrival', email, searchRole: 'committee' }
      });
      assert.strictEqual(added.status, 200);
      const mid = await read(id, abe);
      assert.strictEqual(mid.intake.status, 'open', 'adding somebody shut the window on the people already answering');
      assert.ok(mid.intake.rosterChangedAt, 'the roster change was not recorded against the window');
      assert.strictEqual(mid.team.confirmedAt, null, 'the roster confirmation survived a roster change');

      const refused = await closeIntake(id, abe);
      assert.strictEqual(refused.status, 409, 'the window closed on an unconfirmed roster');
      assert.strictEqual(refused.json.code, 'ROSTER_UNCONFIRMED');

      await write('/api/searches/' + id + '/team/confirm', { auth: abe, id, body: { confirmed: true } });
      assert.strictEqual((await closeIntake(id, abe)).status, 200);
    } finally { await archive(id, abe); }
  });

  /* --- unit: the module's own decisions --------------------------------- */

  await check('two profile lines for one priority are reported, not silently merged away', async () => {
    const agg = {
      submitted: 2, asked: 2,
      byKind: {
        skill: [{ key: committee.groupKey('skill', 'Financial management'), kind: 'skill', label: 'Financial management',
          mentions: 2, share: 1, avgWeight: 4, minWeight: 4, maxWeight: 4, spread: 0, contested: false,
          consensus: 'unanimous', voters: [], notes: [] }],
        trait: [], chall: [], opp: []
      }
    };
    const existing = [
      { id: 'S1', kind: 'skill', label: 'Financial management', weight: 3, from: 'consultant' },
      { id: 'S2', kind: 'skill', label: 'strong financial management skills', weight: 5, from: 'consultant' }
    ];
    const plan = committee.adoptionPreview(existing, agg, { adoptionId: 'ADOPT-1' });
    assert.strictEqual(plan.criteria.filter(c => c.kind === 'skill').length, 1);
    assert.ok(plan.changes.removed.some(r => r.id === 'S2'),
      'a duplicate line disappeared without being proposed for removal');
    const ids = plan.criteria.map(c => c.id);
    assert.strictEqual(new Set(ids).size, ids.length);
  });

  await check('one canonical key answers "is this the same priority" everywhere', async () => {
    assert.strictEqual(committee.groupKey('skill', 'Strong'), committee.groupKey('skill', 'strong'));
    assert.notStrictEqual(committee.groupKey('skill', 'Strong'), committee.groupKey('skill', 'Good'));
    assert.strictEqual(committee.groupKey('skill', 'Financial management'),
      committee.groupKey('skill', 'strong financial management skills'));
    // The same function a criterion's identity is read through.
    assert.strictEqual(committee.critKey({ kind: 'skill', label: 'Financial management.' }),
      committee.groupKey('skill', 'Financial management'));
    assert.strictEqual(committee.critKey({ kind: 'skill', label: 'Renamed entirely', source: { key: 'skill:budget' } }),
      'skill:budget');
  });

  await check('the fingerprint moves for committed answers and not for drafts', async () => {
    const base = {
      members: [{ userId: 'a', searchRole: 'committee' }, { userId: 'b', searchRole: 'committee' }],
      intake: { responses: {
        a: { revision: 1, draft: null, submitted: { items: [{ kind: 'skill', label: 'Budgeting', weight: 4 }] } },
        b: { revision: 1, draft: null, submitted: null }
      } }
    };
    const start = committee.sourceFingerprint(base);
    const drafted = JSON.parse(JSON.stringify(base));
    drafted.intake.responses.b.draft = { items: [{ kind: 'skill', label: 'Anything', weight: 5 }] };
    assert.strictEqual(committee.sourceFingerprint(drafted), start, 'a private draft moved the fingerprint');

    const reweighted = JSON.parse(JSON.stringify(base));
    reweighted.intake.responses.a.submitted.items[0].weight = 5;
    assert.notStrictEqual(committee.sourceFingerprint(reweighted), start, 'a changed weight did not move the fingerprint');

    const renotes = JSON.parse(JSON.stringify(base));
    renotes.intake.responses.a.submitted.items[0].note = 'Because of the deficit.';
    assert.notStrictEqual(committee.sourceFingerprint(renotes), start, 'a changed reason did not move the fingerprint');

    const narrated = JSON.parse(JSON.stringify(base));
    narrated.intake.responses.a.submitted.mustHave = 'Somebody who answers the phone.';
    assert.notStrictEqual(committee.sourceFingerprint(narrated), start, 'a changed narrative did not move the fingerprint');

    const roster = JSON.parse(JSON.stringify(base));
    roster.members.push({ userId: 'c', searchRole: 'committee' });
    assert.notStrictEqual(committee.sourceFingerprint(roster), start, 'a roster change did not move the fingerprint');
  });

  await check('nine contested skills produce five criteria and a reviewable discussion list', async () => {
    // The motivating fixture from the diagnostic (A09): more contested items
    // than the profile can hold.
    const members = ['a', 'b'].map(userId => ({ userId, searchRole: 'committee' }));
    const responses = {};
    for (const [userId, weight] of [['a', 5], ['b', 1]]) {
      responses[userId] = { revision: 1, draft: null, submitted: { items:
        Array.from({ length: 9 }, (_, n) => ({ kind: 'skill', label: 'Contested ' + (n + 1), weight, note: userId + ' reason ' + n }))
      } };
    }
    const agg = committee.aggregate({ members, intake: { responses } }, id => id.toUpperCase());
    assert.strictEqual(agg.contested.length, 9, 'the fixture is not the contested one');

    const plan = committee.adoptionPreview([], agg, { adoptionId: 'ADOPT-1' });
    assert.strictEqual(plan.criteria.filter(c => c.kind === 'skill').length, 5, 'the cap was exceeded');
    assert.strictEqual(plan.discussion.length, 4, 'contested items past the cap were dropped rather than discussed (CA-09)');
    assert.ok(plan.discussion.every(d => d.reasons.length === 2 && d.minWeight === 1 && d.maxWeight === 5),
      'a discussion item arrived without the detail needed to discuss it');
    assert.ok(plan.changes.excluded.length >= 4, 'the cap exclusions were not reported');

    // The same split reaches the model, so the prompt cannot ask for something
    // the schema forbids.
    const packed = committee.packForPrompt(agg);
    assert.strictEqual(packed.skills.length, 5);
    assert.strictEqual(packed.discussion.length, 4);
    assert.ok(packed.discussion.every(d => d.reasons.length && d.lowWeight === 1 && d.highWeight === 5),
      'the model was given a contested item with no supporting detail (CA-09)');
    assert.ok([...packed.skills, ...packed.discussion].every(d => d.key), 'the model was given no source key to cite');
  });

  await check('the prompt tells the model to leave discussion items off the profile', async () => {
    const source = fs.readFileSync(path.join(__dirname, '..', 'server', 'ai.js'), 'utf8');
    assert.match(source, /"discussion" holds contested items that did not fit/,
      'the prompt does not explain the discussion list');
    assert.match(source, /A category holds at most five criteria/,
      'the prompt does not state the cap it has to work within');
    assert.doesNotMatch(source, /An item listed under "contested" is one the committee disagrees about\. Keep it/,
      'the prompt still requires every contested item to be retained (CA-09)');
  });

  await check('a draft that started before the window reopened cannot be applied afterwards', async () => {
    // The route's guard, checked directly: it is asked once before any
    // provider work and again immediately before writing, so a result that
    // comes back into a reopened window is refused rather than published.
    const confirmed = {
      members: [{ userId: 'a', searchRole: 'committee' }],
      team: { confirmedAt: '2026-09-17T00:00:00.000Z' },
      intake: { status: 'closed', responses: {
        a: { revision: 1, draft: null, submitted: { items: [{ kind: 'skill', label: 'Budgeting', weight: 4 }] } }
      } }
    };
    assert.strictEqual(committee.publicationBlock(confirmed), null, 'a closed, confirmed window refused to publish');

    const reopened = JSON.parse(JSON.stringify(confirmed));
    reopened.intake.status = 'open';
    assert.strictEqual(committee.publicationBlock(reopened).code, 'INTAKE_OPEN',
      'a draft could land after the window reopened');

    const unconfirmed = JSON.parse(JSON.stringify(confirmed));
    unconfirmed.team = { confirmedAt: null };
    assert.strictEqual(committee.publicationBlock(unconfirmed).code, 'ROSTER_UNCONFIRMED');

    // And the second half of the recheck: the input the draft was built from.
    const started = committee.sourceFingerprint(confirmed);
    const moved = JSON.parse(JSON.stringify(confirmed));
    moved.intake.responses.a.submitted.items[0].label = 'Something else';
    assert.notStrictEqual(committee.sourceFingerprint(moved), started,
      'a draft could be applied against input that had changed under it');
  });

  await check('profile gaps and committee coverage are different functions', async () => {
    const agg = { submitted: 1, asked: 1, byKind: { skill: [{ key: 'skill:x', kind: 'skill', label: 'X' }], trait: [], chall: [], opp: [] } };
    assert.strictEqual(committee.coverageGaps(agg).length, 4, 'coverage is no longer measured against the committee');
    const complete = ['skill', 'trait', 'chall', 'opp'].flatMap(kind =>
      [1, 2, 3].map(n => ({ id: kind + n, kind, label: kind + n, weight: 3 })));
    assert.deepStrictEqual(committee.profileGaps(complete), [], 'a complete profile was reported as short (CA-06)');
  });

  /* --- CA-10, CA-11: the interface says one thing, and names its controls */

  await check('the interface describes the audience consistently and names its weight controls', async () => {
    const app = fs.readFileSync(path.join(__dirname, '..', 'public', 'app.js'), 'utf8');
    // CA-11: the intake weight buttons carry the item they control.
    assert.match(app, /aria-label="Rate \$\{esc\(what\)\} \$\{n\} of 5"/,
      'intake weight buttons still repeat 1-5 with no item context (CA-11)');
    assert.match(app, /ratingGroup\('How much '\+what\+' matters/,
      'the intake weight group has no accessible name');
    // CA-10: staff access while the window is open is stated, not contradicted.
    assert.match(app, /A member's saved draft is theirs alone/);
    assert.match(app, /the search team in this workspace/);
    assert.doesNotMatch(app, /Nobody on the committee sees your answers, or anyone else’s, until the account manager closes the window/,
      'the old explanation that contradicts staff access is still on the form (CA-10)');
    // The recovery control a member needs after a refused save.
    assert.match(app, /function intakeConflictPanel/);
    assert.match(app, /data-act="intake-keep-mine"/);
    // CA-04: the draft button says what it does now.
    assert.match(app, /Your submitted answers stay in the tally until you choose Update my answers/);
    assert.match(app, /data-act="withdraw-intake"/);
  });

  console.log(passed + ' committee checks passed' + (failed ? ', ' + failed + ' failed' : '') + '.');
  process.exitCode = failed ? 1 : 0;
})().catch(error => { console.error(error); process.exitCode = 1; });
