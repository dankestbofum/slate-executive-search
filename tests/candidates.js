'use strict';

// DEP-08 acceptance evidence: candidate intake, communications, and
// submission recovery.
//
// The case that matters most: a submission that committed while the candidate
// never saw the response. Before this ticket that returned 409, which reads as
// failure and pushes someone into sending a second, conflicting set of answers.

const assert = require('assert');
const candidates = require('../server/candidates');

const BASE = process.env.SLATE_URL || 'http://127.0.0.1:4173';
const JSON_HEADERS = { 'Content-Type': 'application/json' };
let passed = 0;
let failed = 0;

async function check(name, fn) {
  try { await fn(); passed += 1; console.log('PASS  Candidates: ' + name); }
  catch (error) { failed += 1; console.error('FAIL  Candidates: ' + name + '\n      ' + error.message); }
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
  const staff = { ...JSON_HEADERS, cookie };

  const api = (path, { method = 'GET', body, revision } = {}) => {
    const headers = { ...staff };
    if (revision !== undefined) headers['if-match'] = String(revision);
    return fetch(BASE + path, { method, headers, body: body ? JSON.stringify(body) : undefined });
  };
  const revisionOf = async id => String((await (await api('/api/searches/' + id)).json()).revision);

  const search = await (await api('/api/searches', {
    method: 'POST', body: { client: 'Intake County', position: 'County Administrator', jurisdictionType: 'county' }
  })).json();
  const id = search.id;

  const created = await (await api('/api/searches/' + id + '/candidates', {
    method: 'POST', revision: await revisionOf(id), body: { name: 'Dana Ruiz', email: 'dana@example.gov' }
  })).json();
  const candidate = created.candidates[0];
  const token = candidate.invite;

  const survey = {
    intro: 'Tell us about your experience.',
    questions: [
      { n: 1, prompt: 'Describe your county budget experience.', required: true },
      { n: 2, prompt: 'Why this county?', required: false }
    ]
  };
  const published = await api('/api/searches/' + id + '/artifact/survey1', {
    method: 'PUT', revision: await revisionOf(id), body: { body: survey }
  });
  assert.strictEqual(published.status, 200, 'could not publish a questionnaire: ' + published.status);

  const page = () => fetch(BASE + '/api/apply/' + token).then(r => r.json());
  const submit = body => fetch(BASE + '/api/apply/' + token, {
    method: 'POST', headers: JSON_HEADERS, body: JSON.stringify(body)
  });

  /* ---------------- What the candidate is told ---------------- */

  await check('the candidate page states deadline semantics and a timezone', async () => {
    const view = await page();
    assert.ok(view.deadlines, 'no deadline information at all');
    assert.strictEqual(view.deadlines.enforced, false,
      'the page does not say whether the date is enforced');
    assert.ok(view.deadlines.timezone, 'a date was shown with no timezone');
  });

  await check('the page carries support, correction and privacy-notice fields', async () => {
    const view = await page();
    assert.ok(view.support, 'no support contact field');
    assert.match(view.correctionNote, /reopen/i, 'the candidate is not told how to correct an answer');
    // Unconfigured here. The field being present is what lets the page say the
    // notice is missing rather than silently omitting it.
    assert.strictEqual(view.privacyNoticeConfigured, false);
    assert.ok('instructions' in view, 'no search-specific instructions field');
  });

  /* ---------------- Drafts survive a lost connection ---------------- */

  await check('a draft can be saved and comes back on reload', async () => {
    const view = await page();
    assert.ok(view.survey1, 'the questionnaire fixture is missing; this check would prove nothing');
    const first = view.survey1.questions[0];

    const saved = await fetch(BASE + '/api/apply/' + token + '/draft', {
      method: 'POST', headers: JSON_HEADERS,
      body: JSON.stringify({ which: 'survey1', answers: { ['q' + first.n]: 'A long answer typed on a phone.' } })
    });
    assert.strictEqual(saved.status, 200, 'draft save returned ' + saved.status);

    const reloaded = await page();
    assert.ok(reloaded.drafts.survey1, 'the draft did not survive a reload');
    assert.strictEqual(reloaded.drafts.survey1.answers['q' + first.n], 'A long answer typed on a phone.');
    assert.ok(reloaded.drafts.survey1.expiresAt, 'the draft has no expiry');
  });

  await check('drafts expire rather than living forever', () => {
    const person = { id: 'C1' };
    candidates.saveDraft(person, 'survey1', { q1: 'text' });
    assert.ok(candidates.readDraft(person, 'survey1'), 'a fresh draft was not readable');

    person.drafts.survey1.expiresAt = new Date(Date.now() - 1000).toISOString();
    assert.strictEqual(candidates.readDraft(person, 'survey1'), null, 'an expired draft was still served');
  });

  await check('a draft cannot touch a submitted response', () => {
    const person = { id: 'C1', survey1: { at: '2026-09-01T00:00:00.000Z', answers: { q1: 'submitted' } } };
    const result = candidates.saveDraft(person, 'survey1', { q1: 'sneaky rewrite' });
    assert.ok(result.error, 'a draft was accepted against a submitted questionnaire');
    assert.strictEqual(person.survey1.answers.q1, 'submitted', 'the submitted answer was modified');
  });

  await check('draft input is bounded and validated', () => {
    const person = { id: 'C1' };
    assert.ok(candidates.saveDraft(person, 'survey1', { notAQuestion: 'x' }).error);
    assert.ok(candidates.saveDraft(person, 'survey1', { q1: 'x'.repeat(20001) }).error);
    assert.ok(candidates.saveDraft(person, 'survey1', 'not an object').error);
  });

  /* ---------------- The recovery case ---------------- */

  let receipt = null;

  await check('a submission returns a receipt', async () => {
    const view = await page();
    assert.ok(view.survey1, 'the questionnaire fixture is missing; this check would prove nothing');
    const answers = {};
    for (const question of view.survey1.questions) answers['q' + question.n] = 'Answer ' + question.n;

    const res = await submit({ which: 'survey1', surveyVersion: view.versions.survey1, answers });
    assert.strictEqual(res.status, 200, 'submission returned ' + res.status);
    const body = await res.json();
    assert.ok(body.receipt, 'no receipt was issued');
    assert.ok(body.receipt.id, 'the receipt has no reference');
    assert.ok(body.receipt.submittedAt, 'the receipt has no timestamp');
    receipt = body.receipt;
  });

  await check('a lost response does not cost the candidate their submission', async () => {
    // The exact case: it committed, they never saw the reply, they submit the
    // same answers again.
    const view = await page();
    assert.ok(view.survey1, 'the questionnaire fixture is missing; this check would prove nothing');
    const answers = {};
    for (const question of view.survey1.questions) answers['q' + question.n] = 'Answer ' + question.n;

    const retry = await submit({ which: 'survey1', surveyVersion: view.versions.survey1, answers });
    assert.strictEqual(retry.status, 200,
      'a retry of an identical submission returned ' + retry.status + '; that reads as failure and invites a duplicate');
    const body = await retry.json();
    assert.strictEqual(body.duplicate, true, 'the retry was not recognised as one');
    assert.strictEqual(body.receipt.id, receipt.id, 'the retry issued a different receipt');
    assert.match(body.message, /already received|safe/i);
  });

  await check('reloading after submitting shows the receipt, not an empty form', async () => {
    const view = await page();
    assert.strictEqual(view.submitted1, true);
    assert.ok(view.receipts.survey1, 'a submitted questionnaire showed no receipt on reload');
    assert.strictEqual(view.receipts.survey1.id, receipt.id);
  });

  await check('different answers after submitting are refused, and the original kept', async () => {
    const view = await page();
    assert.ok(view.survey1, 'the questionnaire fixture is missing; this check would prove nothing');
    const answers = {};
    for (const question of view.survey1.questions) answers['q' + question.n] = 'Completely different answer';

    const res = await submit({ which: 'survey1', surveyVersion: view.versions.survey1, answers });
    assert.strictEqual(res.status, 409, 'conflicting answers were accepted, overwriting the record');
    const body = await res.json();
    assert.match(body.error, /correction/i, 'the candidate was not told how to proceed');
    assert.ok(body.receipt, 'the conflict response did not confirm their earlier submission stands');
  });

  await check('submitting clears the draft it replaced', async () => {
    const view = await page();
    assert.strictEqual(view.drafts.survey1, null, 'a spent draft was still being served');
  });

  await check('the submitted record keeps the questions it answered', async () => {
    const live = await (await api('/api/searches/' + id)).json();
    const person = live.candidates.find(c => c.id === candidate.id);
    assert.ok(person.survey1.questions?.length || person.survey1.survey?.questions?.length,
      'the response was stored without the questions it answers');
  });

  /* ---------------- Documents ---------------- */

  await check('a document reference is recorded with its repository link', async () => {
    const res = await api('/api/searches/' + id + '/candidates/' + candidate.id + '/documents', {
      method: 'POST', revision: await revisionOf(id),
      body: { kind: 'resume', label: 'Resume (PDF)', url: 'https://docs.example.gov/candidates/dana', note: 'Received by email' }
    });
    assert.strictEqual(res.status, 200, 'recording a document returned ' + res.status);
    const body = await res.json();
    const person = body.candidates.find(c => c.id === candidate.id);
    assert.strictEqual(person.documents.length, 1);
    assert.strictEqual(person.documents[0].kind, 'resume');
    assert.ok(person.documents[0].receivedAt, 'no receipt date was recorded');
  });

  await check('non-https document links are refused', () => {
    for (const url of ['http://docs.example.gov/x', 'file:///etc/passwd', 'javascript:alert(1)', 'data:text/html,x']) {
      const invalid = candidates.validateDocument({ kind: 'resume', label: 'R', url });
      assert.ok(invalid, url + ' was accepted as a document link');
    }
    assert.strictEqual(candidates.validateDocument({ kind: 'resume', label: 'R', url: 'https://ok.example.gov/x' }), null);
  });

  await check('reference and background material is marked restricted', () => {
    const person = { id: 'C1' };
    const reference = candidates.addDocument(person, { kind: 'reference', label: 'Reference notes' }, { id: 'u1', name: 'Abe' });
    const resume = candidates.addDocument(person, { kind: 'resume', label: 'Resume' }, { id: 'u1', name: 'Abe' });
    assert.strictEqual(reference.restricted, true, 'reference material was not marked restricted');
    assert.strictEqual(resume.restricted, false);
  });

  /* ---------------- Communications ---------------- */

  await check('contact is logged as staff-recorded, not as delivered', async () => {
    const res = await api('/api/searches/' + id + '/candidates/' + candidate.id + '/communications', {
      method: 'POST', revision: await revisionOf(id),
      body: { channel: 'email', purpose: 'invitation', summary: 'Sent the questionnaire link.', followUpOn: '2020-01-01' }
    });
    assert.strictEqual(res.status, 200, 'logging contact returned ' + res.status);
    const body = await res.json();
    const entry = body.candidates.find(c => c.id === candidate.id).communications[0];
    assert.strictEqual(entry.evidence, 'staff-recorded');
    assert.match(entry.evidenceNote, /cannot confirm delivery/i,
      'the log implies Slate verified delivery, which it cannot');
    assert.ok(entry.actorId, 'the log does not record who made contact');
  });

  await check('a communication needs a channel, purpose and summary', () => {
    assert.ok(candidates.validateCommunication({ purpose: 'invitation', summary: 'x' }));
    assert.ok(candidates.validateCommunication({ channel: 'email', summary: 'x' }));
    assert.ok(candidates.validateCommunication({ channel: 'email', purpose: 'invitation' }));
    assert.ok(candidates.validateCommunication({ channel: 'email', purpose: 'invitation', summary: 'x', followUpOn: 'soon' }));
    assert.strictEqual(candidates.validateCommunication({ channel: 'email', purpose: 'invitation', summary: 'x' }), null);
  });

  await check('staff can see who still needs follow-up', async () => {
    const res = await api('/api/searches/' + id + '/follow-ups');
    assert.strictEqual(res.status, 200);
    const body = await res.json();
    assert.ok(body.due.some(row => row.id === candidate.id),
      'a candidate with a follow-up date in the past was not listed as due');
  });

  await check('an uncontacted candidate is listed as such', () => {
    const result = candidates.followUps({
      candidates: [{ id: 'C9', name: 'Never Contacted', stage: 'applicant' }]
    });
    assert.strictEqual(result.uncontacted.length, 1);
    assert.strictEqual(result.uncontacted[0].name, 'Never Contacted');
  });

  await check('follow-ups are refused to the committee', async () => {
    const seated = await (await api('/api/searches/' + id + '/members', {
      method: 'POST', revision: await revisionOf(id),
      body: { name: 'Rose Intake', email: 'rose-intake@example.com', seat: 'committee' }
    })).json();
    const memberCookie = await login('rose-intake@example.com', seated.pin);
    const res = await fetch(BASE + '/api/searches/' + id + '/follow-ups', { headers: { cookie: memberCookie } });
    assert.ok(res.status === 403 || res.status === 404, 'the committee could read the contact log: ' + res.status);
  });

  console.log(passed + ' candidate checks passed' + (failed ? ', ' + failed + ' failed' : '') + '.');
  process.exitCode = failed ? 1 : 0;
})().catch(error => { console.error(error); process.exitCode = 1; });
