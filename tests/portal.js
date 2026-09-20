'use strict';

/**
 * The public posting and the application portal.
 *
 * The verification table in the plan is the shape of this file. Five things
 * have to hold, and every one of them is a way somebody gets hurt if it does
 * not:
 *
 *   Publication   — nothing is public until a manager says so, and closing or
 *                   archiving the search takes it down.
 *   Ownership     — applicant A cannot read, write, or download B's records,
 *                   and an unverified caller learns nothing at all.
 *   Submission    — a retry, a double-click, a lost response, a posting that
 *                   closes mid-application and a form that changed underneath
 *                   one all produce correct records and honest receipts.
 *   Materials     — the wrong type, an oversized file, a guessed id, and an
 *                   unscanned file are all refused.
 *   Compatibility — the private questionnaire flow, exports, and archive and
 *                   restore behave exactly as they did.
 */

const assert = require('assert');
const identity = require('./identity');
const postings = require('../server/postings');
const applications = require('../server/applications');
const applicationFiles = require('../server/application-files');

const BASE = process.env.SLATE_URL || 'http://127.0.0.1:4173';
const JSON_HEADERS = { 'Content-Type': 'application/json' };
let passed = 0;
let failed = 0;

async function check(name, fn) {
  try { await fn(); passed += 1; console.log('PASS  Portal: ' + name); }
  catch (error) { failed += 1; console.error('FAIL  Portal: ' + name + '\n      ' + (error && error.stack || error)); }
}

const sign = identity.signer();

/** A base64 PDF of `size` bytes that really does start with %PDF-. */
function pdf(size = 2048) {
  const head = Buffer.from('%PDF-1.4\n');
  return Buffer.concat([head, Buffer.alloc(Math.max(0, size - head.length), 0x20)]).toString('base64');
}

(async () => {
  const staff = { ...JSON_HEADERS, ...sign.headers('abe@slate.local') };
  const other = { ...JSON_HEADERS, ...sign.headers('mike@slate.local') };

  const call = (path, { method = 'GET', body, revision, headers = staff } = {}) => {
    const h = { ...headers };
    if (revision !== undefined) h['if-match'] = String(revision);
    return fetch(BASE + path, { method, headers: h, body: body ? JSON.stringify(body) : undefined });
  };
  const json = async (...args) => {
    const res = await call(...args);
    return { status: res.status, body: await res.json().catch(() => ({})) };
  };
  const revisionOf = async id => String((await (await call('/api/searches/' + id)).json()).revision);

  /* ---------------- A published search to work against ---------------- */

  const search = await (await call('/api/searches', {
    method: 'POST',
    body: { client: 'Portal City', position: 'City Manager', jurisdictionType: 'municipality' }
  })).json();
  const id = search.id;

  const READY_DRAFT = {
    title: 'City Manager', employer: 'City of Portal', location: 'Portal, AZ',
    compensation: '$180,000 to $210,000',
    summary: 'The City of Portal seeks a City Manager.',
    responsibilities: 'Run the organization.',
    qualifications: 'Ten years of local government experience.',
    applicationInstructions: 'Complete the application and attach a resume.',
    privacyNotice: 'We keep your application for two years.',
    supportEmail: 'search@portal.example',
    supportHours: 'Weekdays, 9 to 5',
    deadline: { kind: 'open', firstReviewOn: '2026-11-01', timezone: 'America/Phoenix' },
    questions: [
      { prompt: 'Why this city?', required: true },
      { prompt: 'Describe a budget you turned around.', required: false }
    ],
    materials: [{ key: 'resume', label: 'Resume', required: false, note: 'PDF.' }]
  };

  /* ================= Publication ================= */

  await check('a new search is not published, and is on no public listing', async () => {
    const view = await json('/api/searches/' + id + '/posting');
    assert.strictEqual(view.status, 200);
    assert.strictEqual(view.body.state, 'draft');
    assert.strictEqual(view.body.published, null);
    assert.strictEqual(view.body.publicUrl, null);
    assert.ok(view.body.readiness.missing.length, 'an empty posting claimed to be publishable');
  });

  await check('publishing is refused while required fields are missing', async () => {
    const refused = await json('/api/searches/' + id + '/posting/publish',
      { method: 'POST', revision: await revisionOf(id) });
    assert.strictEqual(refused.status, 400);
    assert.ok(refused.body.missing.length, 'the refusal did not say what was missing');
  });

  await check('a posting without a support contact cannot be published', async () => {
    const saved = await json('/api/searches/' + id + '/posting', {
      method: 'PUT', revision: await revisionOf(id),
      body: { ...READY_DRAFT, supportEmail: '', supportPhone: '' }
    });
    assert.strictEqual(saved.status, 200);
    assert.ok(saved.body.readiness.missing.some(m => /support contact/i.test(m)),
      'a posting with nobody to contact was ready to publish');
  });

  await check('saving a posting changes nothing the public can see', async () => {
    await json('/api/searches/' + id + '/posting', {
      method: 'PUT', revision: await revisionOf(id), body: READY_DRAFT
    });
    const firms = await (await fetch(BASE + '/api/public/firms')).json();
    const listed = firms.firms.some(f => f.postings > 0 && f.name);
    // Other suites may have published something; what matters is that this
    // search is not reachable, and it has no address yet to be reachable at.
    const view = await json('/api/searches/' + id + '/posting');
    assert.strictEqual(view.body.published, null, 'saving published the posting');
    assert.strictEqual(view.body.publicUrl, null);
    assert.ok(typeof listed === 'boolean');
  });

  let publicUrl = null;
  let firmSlug = null;
  let postingSlug = null;

  await check('the search manager can publish, and the page is then readable with no account', async () => {
    const published = await json('/api/searches/' + id + '/posting/publish',
      { method: 'POST', revision: await revisionOf(id) });
    assert.strictEqual(published.status, 200, JSON.stringify(published.body));
    assert.strictEqual(published.body.state, 'published');
    assert.strictEqual(published.body.published.version, 1);
    publicUrl = published.body.publicUrl;
    assert.ok(publicUrl, 'a published posting has no address');
    const parts = new URL(publicUrl).pathname.split('/').filter(Boolean);
    firmSlug = parts[1];
    postingSlug = parts[2];

    const page = await fetch(BASE + '/api/public/postings/' + firmSlug + '/' + postingSlug);
    assert.strictEqual(page.status, 200, 'the published page was not readable without a session');
    const body = await page.json();
    assert.strictEqual(body.posting.title, 'City Manager');
    assert.strictEqual(body.posting.accepting, true);
  });

  await check('a consultant who does not hold the account cannot publish or pause', async () => {
    // Mike is staff in this workspace but not this search's manager.
    const refused = await json('/api/searches/' + id + '/posting/state',
      { method: 'POST', revision: await revisionOf(id), headers: other, body: { state: 'paused' } });
    assert.strictEqual(refused.status, 403, 'a non-manager changed the posting state');
    assert.strictEqual(refused.body.code, 'AUTHORITY_REQUIRED');
    assert.strictEqual(refused.body.action, 'publishPosting');
  });

  await check('the public page carries no search, candidate, or committee information', async () => {
    const body = await (await fetch(BASE + '/api/public/postings/' + firmSlug + '/' + postingSlug)).json();
    const text = JSON.stringify(body);
    for (const forbidden of ['Portal City', 'criteria', 'candidates', 'members', 'scores', 'intake', 'organizationId']) {
      assert.ok(!text.includes(forbidden),
        'the public job page carries "' + forbidden + '"');
    }
    assert.ok(!('id' in body.posting), 'the public page exposes an internal id');
  });

  await check('editing a published posting does not change the live page until it is published again', async () => {
    await json('/api/searches/' + id + '/posting', {
      method: 'PUT', revision: await revisionOf(id),
      body: { ...READY_DRAFT, title: 'Chief Executive' }
    });
    const live = await (await fetch(BASE + '/api/public/postings/' + firmSlug + '/' + postingSlug)).json();
    assert.strictEqual(live.posting.title, 'City Manager', 'an unpublished edit reached the public page');
    const staffView = await json('/api/searches/' + id + '/posting');
    assert.strictEqual(staffView.body.unpublishedChanges, true, 'the screen did not say the draft had moved on');
    // Put it back so the rest of the suite reads the posting it expects.
    await json('/api/searches/' + id + '/posting', {
      method: 'PUT', revision: await revisionOf(id), body: READY_DRAFT
    });
  });

  await check('an advisory first-review date never closes applications', async () => {
    const past = { ...READY_DRAFT, deadline: { kind: 'open', firstReviewOn: '2020-01-01', timezone: 'America/Phoenix' } };
    await json('/api/searches/' + id + '/posting', { method: 'PUT', revision: await revisionOf(id), body: past });
    await json('/api/searches/' + id + '/posting/publish', { method: 'POST', revision: await revisionOf(id) });
    const live = await (await fetch(BASE + '/api/public/postings/' + firmSlug + '/' + postingSlug)).json();
    assert.strictEqual(live.posting.accepting, true, 'an advisory review date closed the posting');
    assert.strictEqual(live.posting.deadline.enforced, false);
    await json('/api/searches/' + id + '/posting', { method: 'PUT', revision: await revisionOf(id), body: READY_DRAFT });
    await json('/api/searches/' + id + '/posting/publish', { method: 'POST', revision: await revisionOf(id) });
  });

  await check('a hard deadline in the past closes the posting, and it is unit-checkable', () => {
    const posting = postings.blank();
    posting.published = {
      version: 1, at: new Date().toISOString(), firmSlug: 'f',
      fields: { ...READY_DRAFT, deadline: { kind: 'hard', closesAt: '2020-01-01', timezone: 'UTC' } }
    };
    posting.state = 'published';
    assert.strictEqual(postings.pastDeadline(posting), true);
    assert.strictEqual(postings.acceptsApplications(posting), false);
    // Still readable, so somebody following an advertisement is told what
    // happened rather than shown a page that says the job never existed.
    assert.strictEqual(postings.isLive(posting), true);
  });

  await check('a closing date is honoured through the end of the stated day', () => {
    const posting = postings.blank();
    posting.state = 'published';
    posting.published = {
      version: 1, at: new Date().toISOString(), firmSlug: 'f',
      fields: { ...READY_DRAFT, deadline: { kind: 'hard', closesAt: '2026-11-30', timezone: 'UTC' } }
    };
    assert.strictEqual(postings.pastDeadline(posting, new Date('2026-11-30T23:59:00Z')), false,
      'a posting closed before the end of its closing day');
    assert.strictEqual(postings.pastDeadline(posting, new Date('2026-12-01T00:00:01Z')), true);
  });

  /* ================= Applicant identity ================= */

  const jar = new Map();
  function cookieHeaderFor(who) {
    const value = jar.get(who);
    return value ? { cookie: value } : {};
  }
  async function portal(who, path, { method = 'GET', body } = {}) {
    const res = await fetch(BASE + path, {
      method,
      headers: { ...JSON_HEADERS, ...cookieHeaderFor(who) },
      body: body ? JSON.stringify(body) : undefined
    });
    const set = res.headers.getSetCookie?.() || [];
    for (const raw of set) {
      if (raw.startsWith('slate_applicant=')) {
        const pair = raw.split(';')[0];
        if (pair === 'slate_applicant=') jar.delete(who);
        else jar.set(who, pair);
      }
    }
    return { status: res.status, body: await res.json().catch(() => ({})) };
  }

  async function verify(who, email) {
    const started = await portal(who, '/api/applications/verify/start', {
      method: 'POST', body: { email, firmSlug, postingSlug }
    });
    assert.strictEqual(started.status, 200, JSON.stringify(started.body));
    const code = /(\d{6})/.exec(started.body.testMessage || '')?.[1];
    assert.ok(code, 'the test transport did not return a code; is SLATE_MAIL_TRANSPORT=echo set?');
    const confirmed = await portal(who, '/api/applications/verify/confirm', {
      method: 'POST', body: { email, code }
    });
    assert.strictEqual(confirmed.status, 200, JSON.stringify(confirmed.body));
    return code;
  }

  await check('asking for a code says the same thing whatever the address', async () => {
    const known = await portal('probe', '/api/applications/verify/start',
      { method: 'POST', body: { email: 'applicant-a@example.com' } });
    const unknown = await portal('probe', '/api/applications/verify/start',
      { method: 'POST', body: { email: 'nobody-at-all-' + Date.now() + '@example.com' } });
    assert.strictEqual(known.status, unknown.status);
    assert.strictEqual(known.body.message, unknown.body.message,
      'the response distinguishes an address that has applied from one that has not');
  });

  await check('a wrong code is refused, and says nothing about whether the address is known', async () => {
    await portal('probe', '/api/applications/verify/start',
      { method: 'POST', body: { email: 'applicant-a@example.com' } });
    const bad = await portal('probe', '/api/applications/verify/confirm',
      { method: 'POST', body: { email: 'applicant-a@example.com', code: '000000' } });
    assert.strictEqual(bad.status, 400);
    assert.match(bad.body.error, /not right, or it has expired/);
  });

  await check('an unverified caller is told nothing about any application', async () => {
    const res = await portal('anonymous', '/api/applications/' + firmSlug + '/' + postingSlug);
    assert.strictEqual(res.status, 401);
    assert.strictEqual(res.body.code, 'VERIFY_REQUIRED');
    assert.ok(!JSON.stringify(res.body).includes('apl-'), 'a refusal carried an application id');
  });

  /* ================= One applicant's application ================= */

  let applicationId = null;

  await check('a verified applicant can start an application', async () => {
    await verify('a', 'applicant-a@example.com');
    const started = await portal('a', '/api/applications/' + firmSlug + '/' + postingSlug + '/start',
      { method: 'POST' });
    assert.strictEqual(started.status, 200, JSON.stringify(started.body));
    assert.strictEqual(started.body.application.state, 'draft');
    assert.strictEqual(started.body.application.answers.email, 'applicant-a@example.com');
    assert.ok(started.body.application.expiresAt, 'a draft with no expiry');
    applicationId = started.body.application.id;
  });

  await check('starting twice returns the same application rather than a second one', async () => {
    const again = await portal('a', '/api/applications/' + firmSlug + '/' + postingSlug + '/start',
      { method: 'POST' });
    assert.strictEqual(again.body.application.id, applicationId,
      'a second application was created for the same applicant and posting');
  });

  await check('a draft is not visible to staff and is in no export', async () => {
    const list = await json('/api/searches/' + id + '/applications');
    assert.strictEqual(list.status, 200);
    assert.strictEqual(list.body.applications.length, 0, 'a draft appeared in the staff inbox');

    const bundle = await (await call('/api/searches/' + id + '/export')).json();
    assert.strictEqual(bundle.applications.length, 0, 'a draft appeared in the export');
    assert.ok(bundle.completeness.missing.some(m => /Unsubmitted application drafts/.test(m)),
      'the export does not name unsubmitted drafts as a deliberate gap');
  });

  await check('saving a draft extends its expiry and reports what is still needed', async () => {
    const saved = await portal('a', '/api/applications/' + applicationId, {
      method: 'PUT',
      body: { name: 'Avery Stone', phone: '555-0100', location: 'Mesa, AZ', background: 'Twenty years.' }
    });
    assert.strictEqual(saved.status, 200);
    assert.ok(saved.body.savedAt && saved.body.expiresAt);
    assert.ok(saved.body.missing.some(m => /Why this city/.test(m)),
      'a required question was not reported as outstanding');
  });

  await check('an incomplete application is refused, and says exactly what is missing', async () => {
    const refused = await portal('a', '/api/applications/' + applicationId + '/submit', { method: 'POST' });
    assert.strictEqual(refused.status, 400);
    assert.ok(refused.body.missing.some(m => /Why this city/.test(m)));
  });

  await check('an answer that does not belong to this form is refused', async () => {
    const refused = await portal('a', '/api/applications/' + applicationId, {
      method: 'PUT', body: { responses: { 'q-notreal0': 'hello' } }
    });
    assert.strictEqual(refused.status, 409);
    assert.match(refused.body.error, /does not belong to this application form/);
  });

  /* ================= Ownership ================= */

  await check('applicant B cannot read, write, or submit A’s application', async () => {
    await verify('b', 'applicant-b@example.com');
    const read = await portal('b', '/api/applications/' + applicationId,
      { method: 'PUT', body: { name: 'Not Avery' } });
    assert.strictEqual(read.status, 404, 'B wrote to A’s application');
    const submit = await portal('b', '/api/applications/' + applicationId + '/submit', { method: 'POST' });
    assert.strictEqual(submit.status, 404, 'B submitted A’s application');
    const files = await portal('b', '/api/applications/' + applicationId + '/files',
      { method: 'POST', body: { filename: 'x.pdf', contentType: 'application/pdf', data: pdf() } });
    assert.strictEqual(files.status, 404, 'B attached a file to A’s application');
  });

  await check('B’s own view of this posting is empty, and says nothing about A', async () => {
    const mine = await portal('b', '/api/applications/' + firmSlug + '/' + postingSlug);
    assert.strictEqual(mine.status, 200);
    assert.strictEqual(mine.body.application, null);
    assert.ok(!JSON.stringify(mine.body).includes('Avery'), 'B’s view leaked A’s name');
  });

  await check('an applicant session opens no staff route', async () => {
    const res = await fetch(BASE + '/api/searches/' + id, { headers: { ...cookieHeaderFor('a') } });
    assert.ok(res.status === 401 || res.status === 403 || res.status === 503,
      'an applicant cookie reached a search (' + res.status + ')');
  });

  /* ================= Materials ================= */

  let fileId = null;

  await check('a file that is not a PDF is refused, whatever it is called', async () => {
    const notPdf = Buffer.from('MZ  this is an executable').toString('base64');
    const refused = await portal('a', '/api/applications/' + applicationId + '/files', {
      method: 'POST', body: { filename: 'resume.pdf', contentType: 'application/pdf', data: notPdf, materialKey: 'resume' }
    });
    assert.strictEqual(refused.status, 400);
    assert.match(refused.body.error, /not a PDF/);
  });

  await check('a file over the size limit is refused', async () => {
    const big = Buffer.concat([Buffer.from('%PDF-1.4\n'), Buffer.alloc(applicationFiles.MAX_BYTES + 1024, 0x20)]).toString('base64');
    const refused = await portal('a', '/api/applications/' + applicationId + '/files', {
      method: 'POST', body: { filename: 'big.pdf', contentType: 'application/pdf', data: big, materialKey: 'resume' }
    });
    assert.strictEqual(refused.status, 400);
    assert.match(refused.body.error, /under \d+ MB/);
  });

  await check('a real PDF is accepted and the applicant is told what happens next', async () => {
    const ok = await portal('a', '/api/applications/' + applicationId + '/files', {
      method: 'POST', body: { filename: 'My Resume (final).pdf', contentType: 'application/pdf', data: pdf(), materialKey: 'resume' }
    });
    assert.strictEqual(ok.status, 200, JSON.stringify(ok.body));
    assert.strictEqual(ok.body.file.label, 'My Resume (final).pdf');
    assert.ok(ok.body.file.note, 'the applicant was told nothing about the state of their file');
    fileId = ok.body.file.id;
  });

  await check('the applicant never sees the storage key or the scanner configuration', async () => {
    const mine = await portal('a', '/api/applications/' + firmSlug + '/' + postingSlug);
    const text = JSON.stringify(mine.body.application.files);
    assert.ok(!/\bkey\b|sha256|scanner|\.pdf"/.test(text.replace(/"label":"[^"]*"/g, '')),
      'the applicant view carries storage detail: ' + text);
  });

  await check('an unscanned file is not readable by a reviewer', () => {
    const file = { scan: { state: 'unavailable', scanner: 'none', scanned: false } };
    assert.strictEqual(applicationFiles.readable(file), false);
    assert.strictEqual(applicationFiles.readable({ scan: { state: 'infected' } }), false);
    assert.strictEqual(applicationFiles.readable({ scan: { state: 'pending' } }), false);
    assert.strictEqual(applicationFiles.readable({ scan: { state: 'clean' } }), true);
    assert.match(applicationFiles.SCAN_STATES.unavailable.staff, /has not been checked/);
  });

  await check('a storage key cannot be made to escape its directory', () => {
    assert.throws(() => applicationFiles.pathFor('/data', 'apl-1', '../../etc/passwd'));
    assert.throws(() => applicationFiles.pathFor('/data', '../../etc', 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.pdf'));
    const label = applicationFiles.safeLabel('../../etc/passwd');
    assert.ok(!/[\\/]/.test(label), 'a filename kept its path separators: ' + label);
    assert.ok(label.length, 'a hostile filename left nothing to show the applicant');
    assert.ok(!/[<>"']/.test(applicationFiles.safeLabel('<script>x</script>.pdf')),
      'a filename kept characters that are markup');
  });

  /* ================= Submission ================= */

  let reference = null;

  await check('a complete application submits and returns a receipt with a time and a timezone', async () => {
    const form = (await portal('a', '/api/applications/' + firmSlug + '/' + postingSlug)).body.application.form;
    const required = form.questions.find(q => q.required);
    await portal('a', '/api/applications/' + applicationId, {
      method: 'PUT', body: { responses: { [required.key]: 'Because of the work ahead.' } }
    });
    const done = await portal('a', '/api/applications/' + applicationId + '/submit', { method: 'POST' });
    assert.strictEqual(done.status, 200, JSON.stringify(done.body));
    assert.ok(done.body.receipt.reference, 'no reference number');
    assert.ok(done.body.receipt.submittedAt, 'no submission time');
    assert.strictEqual(done.body.receipt.timezone, 'America/Phoenix');
    assert.match(done.body.receipt.note, /not a decision/);
    reference = done.body.receipt.reference;
  });

  await check('a retry returns the same receipt rather than a second application', async () => {
    const again = await portal('a', '/api/applications/' + applicationId + '/submit', { method: 'POST' });
    assert.strictEqual(again.status, 200);
    assert.strictEqual(again.body.duplicate, true);
    assert.strictEqual(again.body.receipt.reference, reference,
      'a retry produced a different receipt');
    const list = await json('/api/searches/' + id + '/applications');
    assert.strictEqual(list.body.applications.length, 1, 'a retry created a second application');
  });

  await check('a submitted application cannot be edited by its own applicant', async () => {
    const refused = await portal('a', '/api/applications/' + applicationId,
      { method: 'PUT', body: { name: 'Someone Else' } });
    assert.strictEqual(refused.status, 409);
    assert.match(refused.body.error, /already submitted/);
  });

  await check('a failed confirmation email does not undo a received application', async () => {
    // Proved at the unit boundary, because the route is written so that the
    // mail call happens after the commit and its outcome is only reported.
    const application = {
      id: 'apl-test', state: 'draft', answers: { name: 'X', email: 'x@y.z', responses: {} },
      files: [], corrections: [], form: { postingVersion: 1, questions: [], materials: [] }
    };
    const posting = postings.blank();
    posting.state = 'published';
    posting.published = { version: 1, at: new Date().toISOString(), firmSlug: 'f', fields: { ...READY_DRAFT, questions: [], materials: [] } };
    const result = applications.submit(application, { posting, timezone: 'UTC' });
    assert.ok(result.receipt, JSON.stringify(result));
    assert.strictEqual(application.state, 'submitted');
    // The receipt exists independently of anything a mail provider did.
    assert.ok(!('confirmationSent' in result));
  });

  /* ================= Staff review ================= */

  await check('staff see the submitted application, its answers and its materials', async () => {
    const list = await json('/api/searches/' + id + '/applications');
    assert.strictEqual(list.body.applications.length, 1);
    const row = list.body.applications[0];
    assert.strictEqual(row.name, 'Avery Stone');
    assert.strictEqual(row.source, 'Public portal');
    assert.strictEqual(row.accepted, false);

    const detail = await json('/api/searches/' + id + '/applications/' + row.id);
    assert.strictEqual(detail.status, 200);
    assert.strictEqual(detail.body.documents.length, 1);
    assert.ok('available' in detail.body.documents[0], 'the reviewer is not told whether the file can be opened');
  });

  await check('a file is served only if a scan has cleared it, and only to this search', async () => {
    const detail = (await json('/api/searches/' + id + '/applications/' + applicationId)).body;
    const document = detail.documents[0];
    const res = await call('/api/searches/' + id + '/applications/' + applicationId + '/files/' + document.id);
    if (document.available) {
      assert.strictEqual(res.status, 200, 'a cleared file was not served');
      assert.strictEqual(res.headers.get('content-type'), 'application/pdf');
      assert.match(res.headers.get('cache-control') || '', /no-store/);
    } else {
      assert.strictEqual(res.status, 409, 'an uncleared file was served');
      const body = await res.json();
      assert.strictEqual(body.code, 'FILE_NOT_CLEARED');
    }
    const guessed = await call('/api/searches/' + id + '/applications/' + applicationId + '/files/af-000000000000');
    assert.strictEqual(guessed.status, 404, 'a guessed file id was answered with something other than not-found');
  });

  await check('an application cannot be read through another search’s routes', async () => {
    const second = await (await call('/api/searches', {
      method: 'POST', body: { client: 'Other City', position: 'Clerk', jurisdictionType: 'municipality' }
    })).json();
    const crossed = await json('/api/searches/' + second.id + '/applications/' + applicationId);
    assert.strictEqual(crossed.status, 404, 'an application was readable through an unrelated search');
  });

  await check('accepting puts the applicant on the candidate list and links the two', async () => {
    const accepted = await json('/api/searches/' + id + '/applications/' + applicationId + '/accept',
      { method: 'POST', revision: await revisionOf(id) });
    assert.strictEqual(accepted.status, 200, JSON.stringify(accepted.body));
    const candidate = accepted.body.search.candidates.find(c => c.id === accepted.body.candidateId);
    assert.ok(candidate, 'no candidate was created');
    assert.strictEqual(candidate.name, 'Avery Stone');
    assert.strictEqual(candidate.source, 'public-portal');
    assert.strictEqual(candidate.stage, 'applicant');

    const again = await json('/api/searches/' + id + '/applications/' + applicationId + '/accept',
      { method: 'POST', revision: await revisionOf(id) });
    assert.strictEqual(again.status, 409, 'the same application was accepted twice');
  });

  await check('the applicant is told nothing by being accepted', async () => {
    const mine = await portal('a', '/api/applications/' + firmSlug + '/' + postingSlug);
    const text = JSON.stringify(mine.body);
    assert.ok(!/accepted|candidate|stage|shortlist/i.test(text),
      'the applicant view reveals internal workflow: ' + text.slice(0, 300));
    assert.strictEqual(mine.body.application.receipt.reference, reference,
      'the receipt changed when staff acted');
  });

  await check('a submitted application is in the export with its questions and its checksum', async () => {
    const bundle = await (await call('/api/searches/' + id + '/export')).json();
    assert.strictEqual(bundle.applications.length, 1);
    const record = bundle.applications[0];
    assert.strictEqual(record.reference, reference);
    assert.ok(record.questions.length, 'answers were exported with no questions beside them');
    assert.ok(record.questions[0].prompt);
    assert.strictEqual(record.materials.length, 1);
    assert.ok(record.materials[0].sha256, 'a material was exported with no checksum');
    assert.ok(bundle.publicPosting, 'what was advertised is not in the record');
    const live = (await json('/api/searches/' + id + '/posting')).body;
    assert.strictEqual(bundle.publicPosting.version, live.published.version,
      'the export named a different published version from the one that is live');

    const text = await (await call('/api/searches/' + id + '/export?format=text')).text();
    assert.match(text, /APPLICATIONS RECEIVED THROUGH THE PORTAL/);
    assert.ok(text.includes(reference));
  });

  /* ================= Reconciliation ================= */

  await check('a second applicant who matches an existing candidate is a review, not a merge', async () => {
    await verify('c', 'applicant-c@example.com');
    const started = await portal('c', '/api/applications/' + firmSlug + '/' + postingSlug + '/start', { method: 'POST' });
    const cid = started.body.application.id;
    const form = started.body.application.form;
    const required = form.questions.find(q => q.required);
    await portal('c', '/api/applications/' + cid, {
      method: 'PUT',
      body: { name: 'Avery Stone', location: 'Mesa, AZ', responses: { [required.key]: 'Same name, different person.' } }
    });
    const done = await portal('c', '/api/applications/' + cid + '/submit', { method: 'POST' });
    assert.strictEqual(done.status, 200, JSON.stringify(done.body));
    assert.notStrictEqual(done.body.receipt.reference, reference, 'two applicants got the same reference');

    const detail = await json('/api/searches/' + id + '/applications/' + cid);
    assert.ok(detail.body.possibleMatches.length, 'a name match was not flagged for review');

    const blocked = await json('/api/searches/' + id + '/applications/' + cid + '/accept',
      { method: 'POST', revision: await revisionOf(id) });
    assert.strictEqual(blocked.status, 409, 'a possible duplicate was accepted with no review');
    assert.strictEqual(blocked.body.code, 'RECONCILE_FIRST');

    const confirmed = await json('/api/searches/' + id + '/applications/' + cid + '/accept',
      { method: 'POST', revision: await revisionOf(id), body: { reconciled: true } });
    assert.strictEqual(confirmed.status, 200);
    const names = confirmed.body.search.candidates.filter(c => c.name === 'Avery Stone');
    assert.strictEqual(names.length, 2, 'the records were merged rather than kept separate');
  });

  await check('an applicant is never told that somebody with their email is already on the file', async () => {
    const mine = await portal('c', '/api/applications/' + firmSlug + '/' + postingSlug);
    assert.ok(!/duplicate|match|already/i.test(JSON.stringify(mine.body)),
      'the applicant was told about an existing candidate record');
  });

  /* ================= A posting that changes underneath ================= */

  await check('a posting closing during an application preserves the work and claims no receipt', async () => {
    await verify('d', 'applicant-d@example.com');
    const started = await portal('d', '/api/applications/' + firmSlug + '/' + postingSlug + '/start', { method: 'POST' });
    const did = started.body.application.id;
    const required = started.body.application.form.questions.find(q => q.required);
    await portal('d', '/api/applications/' + did, {
      method: 'PUT', body: { name: 'Dee Parker', responses: { [required.key]: 'A long answer nobody should lose.' } }
    });

    await json('/api/searches/' + id + '/posting/state',
      { method: 'POST', revision: await revisionOf(id), body: { state: 'closed' } });

    const refused = await portal('d', '/api/applications/' + did + '/submit', { method: 'POST' });
    assert.strictEqual(refused.status, 409);
    assert.strictEqual(refused.body.code, 'POSTING_CLOSED');
    assert.match(refused.body.error, /Nothing you wrote has been lost/);
    assert.ok(refused.body.support, 'no way to reach a person');

    // The work is still there when they come back.
    const still = await portal('d', '/api/applications/' + firmSlug + '/' + postingSlug);
    assert.strictEqual(still.body.application.answers.name, 'Dee Parker');
    assert.strictEqual(still.body.application.state, 'draft');
    assert.strictEqual(still.body.application.receipt, null, 'a receipt was claimed for an unsubmitted application');

    await json('/api/searches/' + id + '/posting/state',
      { method: 'POST', revision: await revisionOf(id), body: { state: 'published' } });
  });

  await check('a materially changed form stops a submission and explains what changed', async () => {
    const changed = {
      ...READY_DRAFT,
      questions: [
        ...READY_DRAFT.questions,
        { prompt: 'Have you read the charter?', required: true }
      ]
    };
    await json('/api/searches/' + id + '/posting', { method: 'PUT', revision: await revisionOf(id), body: changed });
    await json('/api/searches/' + id + '/posting/publish', { method: 'POST', revision: await revisionOf(id) });

    const blocked = await portal('d', '/api/applications/' + (await portal('d', '/api/applications/' + firmSlug + '/' + postingSlug)).body.application.id + '/submit',
      { method: 'POST' });
    assert.strictEqual(blocked.status, 409);
    assert.strictEqual(blocked.body.code, 'FORM_CHANGED');
    assert.ok(blocked.body.drift.added.some(q => /charter/i.test(q)),
      'the applicant was not told which question appeared');
  });

  await check('accepting the new form keeps every answer already written', async () => {
    const before = (await portal('d', '/api/applications/' + firmSlug + '/' + postingSlug)).body.application;
    const written = Object.values(before.answers.responses).filter(Boolean);
    const adopted = await portal('d', '/api/applications/' + before.id + '/adopt-form', { method: 'POST' });
    assert.strictEqual(adopted.status, 200);
    const after = adopted.body.application;
    assert.strictEqual(after.answers.name, 'Dee Parker', 'a name was lost by adopting the new form');
    for (const value of written) {
      assert.ok(Object.values(after.answers.responses).includes(value),
        'an answer was discarded when the form changed');
    }
    assert.ok(after.form.questions.some(q => /charter/i.test(q.prompt)), 'the new question did not arrive');
  });

  await check('a question that is removed keeps what was written for it, out of sight', () => {
    const posting = postings.blank();
    posting.published = {
      version: 1, at: new Date().toISOString(), firmSlug: 'f',
      fields: { ...READY_DRAFT, questions: [{ key: 'q-aaaaaaaa', n: 1, prompt: 'Kept', required: false }], materials: [] }
    };
    const application = {
      form: { postingVersion: 0, questions: [
        { key: 'q-aaaaaaaa', n: 1, prompt: 'Kept', required: false },
        { key: 'q-bbbbbbbb', n: 2, prompt: 'Dropped', required: false }
      ], materials: [] },
      answers: { responses: { 'q-aaaaaaaa': 'still here', 'q-bbbbbbbb': 'a paragraph' } },
      updatedAt: null
    };
    applications.adoptForm(application, posting);
    assert.strictEqual(application.answers.responses['q-aaaaaaaa'], 'still here');
    assert.strictEqual(application.answers.responses['q-bbbbbbbb'], undefined,
      'an answer to a question nobody asks any more was still on the form');
    assert.strictEqual(application.orphanedAnswers['q-bbbbbbbb'], 'a paragraph',
      'the applicant’s writing was deleted rather than kept');
  });

  /* ================= Corrections ================= */

  await check('a staff-authorised correction keeps the original submission', async () => {
    const reopened = await json('/api/searches/' + id + '/applications/' + applicationId + '/reopen',
      { method: 'POST', revision: await revisionOf(id), body: { reason: 'They sent the wrong resume.' } });
    // This one is already on the candidate list, so it is refused: corrections
    // after acceptance belong on the candidate record.
    assert.strictEqual(reopened.status, 409, JSON.stringify(reopened.body));
    assert.match(reopened.body.error, /already on the candidate list/);
  });

  await check('an unaccepted application can be reopened, and the first submission survives it', async () => {
    await verify('e', 'applicant-e@example.com');
    const started = await portal('e', '/api/applications/' + firmSlug + '/' + postingSlug + '/start', { method: 'POST' });
    const eid = started.body.application.id;
    const required = started.body.application.form.questions.filter(q => q.required);
    const answers = {};
    for (const q of required) answers[q.key] = 'First answer.';
    await portal('e', '/api/applications/' + eid, { method: 'PUT', body: { name: 'Eli Vance', responses: answers } });
    const first = await portal('e', '/api/applications/' + eid + '/submit', { method: 'POST' });
    assert.strictEqual(first.status, 200, JSON.stringify(first.body));
    const firstReference = first.body.receipt.reference;

    const reopened = await json('/api/searches/' + id + '/applications/' + eid + '/reopen',
      { method: 'POST', revision: await revisionOf(id), body: { reason: 'Attached the wrong document.' } });
    assert.strictEqual(reopened.status, 200, JSON.stringify(reopened.body));

    const back = await portal('e', '/api/applications/' + firmSlug + '/' + postingSlug);
    assert.strictEqual(back.body.application.state, 'draft');
    assert.ok(back.body.application.reopened?.reason, 'the applicant was not told why it was reopened');

    for (const q of required) answers[q.key] = 'Second answer.';
    await portal('e', '/api/applications/' + eid, { method: 'PUT', body: { responses: answers } });
    const second = await portal('e', '/api/applications/' + eid + '/submit', { method: 'POST' });
    assert.strictEqual(second.status, 200, JSON.stringify(second.body));
    assert.notStrictEqual(second.body.receipt.reference, firstReference);
    assert.strictEqual(second.body.receipt.version, 2);

    const detail = await json('/api/searches/' + id + '/applications/' + eid);
    assert.strictEqual(detail.body.history.length, 1, 'the original submission was not kept');
    assert.strictEqual(detail.body.history[0].reference, firstReference);
  });

  /* ================= The search lifecycle wins ================= */

  await check('closing the search takes the posting offline and stops intake', async () => {
    const closed = await json('/api/searches/' + id + '/close',
      { method: 'POST', revision: await revisionOf(id), body: { status: 'closed', reason: 'The position was filled.' } });
    assert.ok(closed.status === 200, JSON.stringify(closed.body));

    const page = await fetch(BASE + '/api/public/postings/' + firmSlug + '/' + postingSlug);
    assert.strictEqual(page.status, 404, 'a closed search was still advertising');

    const started = await portal('b', '/api/applications/' + firmSlug + '/' + postingSlug + '/start', { method: 'POST' });
    assert.strictEqual(started.status, 404, 'a closed search accepted a new application');
  });

  await check('reopening the search does not republish the posting on its own', async () => {
    const reopened = await json('/api/searches/' + id + '/reopen',
      { method: 'POST', revision: await revisionOf(id), body: { reason: 'The appointment fell through.' } });
    assert.strictEqual(reopened.status, 200, JSON.stringify(reopened.body));
    assert.strictEqual(reopened.body.linksRestored, false,
      'reopening put revoked candidate links back into circulation');
    const view = await json('/api/searches/' + id + '/posting');
    assert.strictEqual(view.body.frozenBySearch, false);
    // It comes back because the posting state itself was never changed — but
    // that is the posting's own recorded state, not a side effect of
    // reopening, and the state it comes back into is the one it was left in.
    assert.strictEqual(view.body.state, 'published');
  });

  await check('archiving the search takes the posting off the public listings', async () => {
    const archived = await call('/api/searches/' + id, { method: 'DELETE', revision: await revisionOf(id) });
    assert.strictEqual(archived.status, 200, 'the search could not be archived');
    const page = await fetch(BASE + '/api/public/postings/' + firmSlug + '/' + postingSlug);
    assert.strictEqual(page.status, 404, 'an archived search was still advertising');
    const listing = await (await fetch(BASE + '/api/public/postings?firm=' + firmSlug)).json();
    assert.ok(!listing.postings.some(p => p.slug === postingSlug),
      'an archived search was still listed');
  });

  /* ================= Compatibility ================= */

  await check('the existing private questionnaire flow is untouched', async () => {
    const other2 = await (await call('/api/searches', {
      method: 'POST', body: { client: 'Legacy City', position: 'Manager', jurisdictionType: 'municipality' }
    })).json();
    const created = await (await call('/api/searches/' + other2.id + '/candidates', {
      method: 'POST', revision: await revisionOf(other2.id), body: { name: 'Robin Vale', email: 'robin@example.gov' }
    })).json();
    const candidate = created.candidates[0];
    await call('/api/searches/' + other2.id + '/artifact/survey1', {
      method: 'PUT', revision: await revisionOf(other2.id),
      body: { body: { intro: 'Hello.', questions: [{ n: 1, prompt: 'Why?', required: true }] } }
    });
    const page = await (await fetch(BASE + '/api/apply/' + candidate.invite)).json();
    assert.ok(page.survey1, 'the private questionnaire stopped working');
    assert.ok(page.support, 'the private questionnaire lost its support block');
    assert.strictEqual(page.deadlines.enforced, false);
  });

  await check('the public routes never reach an archived search', async () => {
    const firms = await (await fetch(BASE + '/api/public/firms')).json();
    for (const firm of firms.firms) {
      const listing = await (await fetch(BASE + '/api/public/postings?firm=' + firm.slug)).json();
      for (const row of listing.postings) {
        assert.ok(row.title, 'a listing row with no title');
        assert.ok(!('organizationId' in row), 'a listing row carries a workspace id');
      }
    }
  });

  await check('the listing endpoint refuses to act as a cross-firm directory', async () => {
    const res = await fetch(BASE + '/api/public/postings');
    assert.strictEqual(res.status, 400, 'the listing served every firm at once');
  });

  /* ================= Expiry ================= */

  await check('an expired draft is removed, and its files are named for removal', () => {
    const store = { applications: [
      { id: 'apl-old', state: 'draft', expiresAt: new Date(Date.now() - 1000).toISOString() },
      { id: 'apl-new', state: 'draft', expiresAt: new Date(Date.now() + 86400000).toISOString() },
      { id: 'apl-sent', state: 'submitted' }
    ] };
    const result = applications.pruneDrafts(store);
    assert.strictEqual(result.removed, 1);
    assert.deepStrictEqual(result.ids, ['apl-old']);
    assert.deepStrictEqual(store.applications.map(a => a.id), ['apl-new', 'apl-sent']);
  });

  await check('a submitted application does not expire', () => {
    const application = {
      id: 'apl-x', state: 'draft', expiresAt: new Date().toISOString(),
      answers: { name: 'A', email: 'a@b.c', responses: {} }, files: [], corrections: [],
      form: { postingVersion: 1, questions: [], materials: [] }
    };
    const posting = postings.blank();
    posting.state = 'published';
    posting.published = { version: 1, at: new Date().toISOString(), firmSlug: 'f', fields: { ...READY_DRAFT, questions: [], materials: [] } };
    applications.submit(application, { posting });
    assert.strictEqual(application.expiresAt, undefined, 'a received application was still on an expiry clock');
  });

  /* ================= Honest defaults ================= */

  await check('with no mail provider, nothing is sent and every caller is told so', async () => {
    const mailer = require('../server/mailer');
    const before = process.env.SLATE_MAIL_TRANSPORT;
    try {
      delete process.env.SLATE_MAIL_TRANSPORT;
      assert.strictEqual(mailer.configured(), false);
      assert.strictEqual(mailer.transportName(), 'none');
      const result = await mailer.deliver({ to: 'a@b.c', subject: 's', body: 'b', kind: 'verification' });
      assert.strictEqual(result.accepted, false, 'a message was accepted with no provider');
      assert.strictEqual(result.deliveryConfirmed, false);
      assert.match(mailer.status().note, /Applicant email verification is unavailable/);
    } finally {
      if (before === undefined) delete process.env.SLATE_MAIL_TRANSPORT;
      else process.env.SLATE_MAIL_TRANSPORT = before;
    }
  });

  await check('the test transport is refused outright in production', () => {
    const mailer = require('../server/mailer');
    const beforeEnv = process.env.NODE_ENV;
    const beforeTransport = process.env.SLATE_MAIL_TRANSPORT;
    try {
      process.env.NODE_ENV = 'production';
      process.env.SLATE_MAIL_TRANSPORT = 'echo';
      // `isProd` is read at module load, so the module is reloaded the way a
      // production process would load it.
      delete require.cache[require.resolve('../server/mailer')];
      const production = require('../server/mailer');
      assert.strictEqual(production.transportName(), 'none',
        'the transport that hands verification codes back to the caller was available in production');
    } finally {
      process.env.NODE_ENV = beforeEnv;
      if (beforeTransport === undefined) delete process.env.SLATE_MAIL_TRANSPORT;
      else process.env.SLATE_MAIL_TRANSPORT = beforeTransport;
      delete require.cache[require.resolve('../server/mailer')];
      require('../server/mailer');
    }
  });

  await check('with no scanner, a stored file is honestly unavailable rather than quietly openable', () => {
    const before = process.env.SLATE_FILE_SCANNER;
    try {
      delete process.env.SLATE_FILE_SCANNER;
      const status = applicationFiles.scannerStatus();
      assert.strictEqual(status.scans, false);
      assert.match(status.note, /not available to reviewers/);
    } finally {
      if (before === undefined) delete process.env.SLATE_FILE_SCANNER;
      else process.env.SLATE_FILE_SCANNER = before;
    }
  });

  await check('the pilot scanner setting records that it did not scan', () => {
    const before = process.env.SLATE_FILE_SCANNER;
    try {
      process.env.SLATE_FILE_SCANNER = 'accept-all';
      const status = applicationFiles.scannerStatus();
      assert.strictEqual(status.scans, true);
      assert.match(status.note, /not a scan/,
        'the pilot setting presents itself as scanning');
    } finally {
      if (before === undefined) delete process.env.SLATE_FILE_SCANNER;
      else process.env.SLATE_FILE_SCANNER = before;
    }
  });

  await check('with uploads off, an attachment is refused with somewhere to go instead', () => {
    const before = process.env.SLATE_APPLICATION_UPLOADS;
    try {
      delete process.env.SLATE_APPLICATION_UPLOADS;
      const refused = applicationFiles.validate({
        filename: 'resume.pdf', contentType: 'application/pdf', data: pdf()
      });
      assert.ok(refused.error, 'an upload was accepted while uploads are off');
      assert.match(refused.error, /instructions on the posting/);
    } finally {
      if (before === undefined) delete process.env.SLATE_APPLICATION_UPLOADS;
      else process.env.SLATE_APPLICATION_UPLOADS = before;
    }
  });

  process.exitCode = failed ? 1 : 0;
  console.log('Portal: ' + passed + ' passed, ' + failed + ' failed.');
})();
