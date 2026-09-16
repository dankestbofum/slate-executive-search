'use strict';

// B07, B08 and B09, connected, in a browser.
//
// The existing specs cover these areas one screen at a time, and
// pilot-journey.spec.js carries a candidate through to score release. What
// neither established is the late stage as one continuous record: three
// semifinalists, two of them finalists, references certified against the people
// who actually consented, three different outcomes with a correction, closeout,
// reopening, and an export a records reviewer can compare with the file.
//
// The two-context shape is the point. `manager` holds the account; `consultant`
// is a second consultant in the same workspace who is on the roster and can do
// the firm's work. Every decision the accepted authority matrix reserves is
// checked twice — refused in the consultant's browser, taken in the manager's —
// because a screen that offers a control the server will refuse is exactly the
// handoff failure this rehearsal exists to find.
//
// Fixtures upstream of the late stage are prepared over the API. Every action
// under test is performed by clicking.

const { test, expect } = require('@playwright/test');
const { installClerk, authHeaders, sharedWorkspace, joinWorkspace } = require('./clerk');

async function revision(page, id) {
  return String((await (await page.request.get('/api/searches/' + id)).json()).revision);
}

async function ifMatch(page, id) {
  return { 'if-match': await revision(page, id) };
}

/** The Executive search, its profile, its questionnaire, and three candidates. */
async function prepare(page, client) {
  const search = await (await page.request.post('/api/searches', {
    data: { client, position: 'County Administrator', package: 'executive', jurisdictionType: 'county' }
  })).json();
  await page.request.put('/api/searches/' + search.id + '/profile', {
    headers: await ifMatch(page, search.id),
    data: { criteria: [{ id: 'S1', kind: 'skill', label: 'Public budgeting', weight: 5, note: 'Synthetic pilot criterion.' }] }
  });
  await page.request.put('/api/searches/' + search.id + '/artifact/survey1', {
    headers: await ifMatch(page, search.id),
    data: { body: { intro: 'Synthetic pilot.', questions: [{ n: 1, prompt: 'Describe your public budgeting work.', required: true, crit: ['S1'] }] } }
  });

  const people = {};
  for (const [key, name] of [['a', 'Ada Pilot-Hired'], ['b', 'Bo Pilot-Withdrew'], ['c', 'Cyd Pilot-NotSelected']]) {
    const body = await (await page.request.post('/api/searches/' + search.id + '/candidates', {
      headers: await ifMatch(page, search.id), data: { name }
    })).json();
    people[key] = body.candidates.find(c => c.name === name);
  }
  // All three reach semifinalist, which is ordinary screening. What happens
  // above that line is what these cases are about.
  for (const person of Object.values(people)) {
    await page.request.patch('/api/searches/' + search.id + '/candidates/' + person.id, {
      headers: await ifMatch(page, search.id), data: { stage: 'semifinalist' }
    });
  }
  return { search, people };
}

/**
 * Accept the confirmations these decisions ask for.
 *
 * Playwright dismisses dialogs by default, which would cancel every decision
 * this spec is here to take — and do it silently, so the assertion afterwards
 * would fail as though the control were missing. The confirmation itself is
 * covered where it is the subject: see recordkeeping.spec.js.
 */
function acceptConfirmations(page) {
  page.on('dialog', dialog => dialog.accept().catch(() => {}));
}

async function open(page, path) {
  // A hash change alone does not reload the document, so a second browser that
  // has been sitting on another view would paint from the search it loaded
  // before the other actor's decision. These cases are about what each person
  // sees after the other has acted, so every hop starts from the server.
  await page.goto(path);
  await page.reload();
  await expect(page.locator('#main h1')).toBeVisible({ timeout: 10000 });
}

/** The name has to be unique per project: the projects share one store. */
function unique(base, testInfo) {
  return base + ' ' + testInfo.project.name;
}

test.describe('the late stage, connected', () => {
  test('B07/B08: authority, consent, certification, three outcomes, closeout and reopening',
    async ({ browser }, testInfo) => {
    test.skip(testInfo.project.name !== 'desktop-chrome', 'the connected rehearsal runs once; device coverage is separate');
    test.slow();
    const managerContext = await browser.newContext();
    const consultantContext = await browser.newContext();
    const manager = await managerContext.newPage();
    const consultant = await consultantContext.newPage();
    await installClerk(manager, { email: 'abe@slate.local' });
    await installClerk(consultant, { email: 'team@slate.local' });
    acceptConfirmations(manager);
    acceptConfirmations(consultant);

    const { search, people } = await prepare(manager, unique('Late Stage County', testInfo));
    const orgId = await sharedWorkspace();
    // The second consultant joins the search, so everything below is about
    // authority rather than about access.
    await consultant.request.post('/api/searches/' + search.id + '/members/self', {
      headers: { ...authHeaders('team@slate.local', orgId), 'if-match': await revision(consultant, search.id) }, data: {}
    });

    /* --- B08: advancing to finalist is the manager's decision -------------- */

    await open(consultant, '/#/s/' + search.id + '/finalists');
    await expect(consultant.getByRole('button', { name: 'Advance to finalist' })).toHaveCount(0);

    await open(manager, '/#/s/' + search.id + '/finalists');
    const advance = manager.getByRole('button', { name: 'Advance to finalist' });
    await expect(advance).toHaveCount(3);
    // Ada and Cyd become finalists, so references exercise more than one person.
    await manager.locator('.spec', { hasText: 'Ada Pilot-Hired' }).getByRole('button', { name: 'Advance to finalist' }).click();
    await expect(manager.locator('.spec', { hasText: 'Ada Pilot-Hired' }).getByRole('button', { name: 'Advance to finalist' })).toHaveCount(0);
    await manager.locator('.spec', { hasText: 'Cyd Pilot-NotSelected' }).getByRole('button', { name: 'Advance to finalist' }).click();
    await expect(manager.locator('.spec', { hasText: 'Cyd Pilot-NotSelected' }).getByRole('button', { name: 'Advance to finalist' })).toHaveCount(0);

    /* --- B07: consent precedes reference work ----------------------------- */

    await open(consultant, '/#/s/' + search.id + '/references');
    // Nobody has consented, so no finalist can be chosen for a contact.
    await expect(consultant.locator('#staff-cid option:not([value=""]):not([disabled])')).toHaveCount(0);
    await expect(consultant.getByText('No consent yet')).toHaveCount(2);

    await consultant.locator('tr', { hasText: 'Ada Pilot-Hired' }).getByRole('button', { name: 'Record consent' }).click();
    await expect(consultant.locator('tr', { hasText: 'Ada Pilot-Hired' }).getByText('Consent on file')).toBeVisible();
    await consultant.locator('tr', { hasText: 'Cyd Pilot-NotSelected' }).getByRole('button', { name: 'Record consent' }).click();
    await expect(consultant.locator('tr', { hasText: 'Cyd Pilot-NotSelected' }).getByText('Consent on file')).toBeVisible();

    await consultant.locator('#staff-cid').selectOption({ label: 'Ada Pilot-Hired' });
    await consultant.locator('#staff-text').fill('Spoke with a former board chair. Notes filed in the restricted reference folder.');
    await consultant.getByRole('button', { name: 'Add to the log' }).click();
    await expect(consultant.getByText('former board chair')).toBeVisible();

    // Certifying it is not theirs to do, and the screen says who decides.
    await expect(consultant.getByRole('button', { name: 'Mark complete' })).toHaveCount(0);
    await expect(consultant.locator('#main')).toContainText(/runs this search|search manager/i);

    /* --- B07: incomplete finalist coverage cannot be certified ------------- */

    await open(manager, '/#/s/' + search.id + '/references');
    await manager.getByRole('button', { name: 'Mark complete' }).click();
    // Cyd is a finalist with consent but no contact on the log, so the record
    // does not support the statement being made about it.
    await expect(manager.locator('#toast')).toContainText(/every current finalist/i);

    await manager.locator('#staff-cid').selectOption({ label: 'Cyd Pilot-NotSelected' });
    await manager.locator('#staff-text').fill('Spoke with a former county manager. Notes filed in the restricted reference folder.');
    await manager.getByRole('button', { name: 'Add to the log' }).click();
    await manager.getByRole('button', { name: 'Mark complete' }).click();
    await expect(manager.getByText(/^Completed /)).toBeVisible();

    /* --- B07: changing the evidence withdraws the certification ------------ */

    await open(consultant, '/#/s/' + search.id + '/references');
    await consultant.locator('#staff-notes').fill('Second conversation for Cyd still outstanding.');
    await consultant.getByRole('button', { name: 'Save notes' }).click();
    await expect(consultant.locator('#toast')).toBeVisible();
    await consultant.reload();
    await expect(consultant.getByText(/^Completed /)).toHaveCount(0);

    const afterNotes = await (await manager.request.get('/api/searches/' + search.id)).json();
    expect(afterNotes.staff.references.doneAt, 'rewriting the notes left the certification standing').toBeNull();
    expect((afterNotes.activity || []).some(e => /reopened a completed step/.test(e.x || '')),
      'the withdrawal was not explained on the file').toBe(true);

    /* --- B07: the committee cannot read the firm's reference work ---------- */

    // Sourcing calls and reference conversations are about people who have not
    // told their own council they are looking. A committee member reads the
    // search; they do not read this.
    const committeeEmail = unique('pilot-committee', testInfo).replace(/[^a-z0-9]+/gi, '-').toLowerCase() + '@example.com';
    await joinWorkspace(committeeEmail);
    await manager.request.post('/api/searches/' + search.id + '/members', {
      headers: await ifMatch(manager, search.id),
      data: { name: 'Pat Late-Stage-Committee', email: committeeEmail, searchRole: 'committee' }
    });
    const committeeContext = await browser.newContext();
    const committee = await committeeContext.newPage();
    await installClerk(committee, { email: committeeEmail });
    await open(committee, '/#/s/' + search.id + '/overview');
    const committeeView = await (await committee.request.get('/api/searches/' + search.id)).json();
    expect(Object.keys(committeeView.staff || {}), 'a committee reader received the firm’s staff work').toHaveLength(0);
    expect(JSON.stringify(committeeView)).not.toContain('former board chair');
    expect(JSON.stringify(committeeView)).not.toContain(people.a.invite);
    await committeeContext.close();

    /* --- B08: three outcomes, and a correction that keeps the original ----- */

    const outcome = async (page, person, value, reason, evidence, correction) => {
      await open(page, '/#/s/' + search.id + '/person/' + person.id);
      await page.getByRole('tab', { name: 'Outcome' }).click();
      await page.locator('#outcomeform [name="outcome"]').selectOption(value);
      await page.locator('#outcomeform [name="reason"]').fill(reason);
      if (evidence) await page.locator('#outcomeform [name="evidence"]').fill(evidence);
      if (correction) await page.locator('#outcomeform [name="correction"]').check();
      await page.getByRole('button', { name: 'Record this outcome' }).click();
    };

    // The consultant is not offered the form at all, and is told who is.
    await open(consultant, '/#/s/' + search.id + '/person/' + people.b.id);
    await consultant.getByRole('tab', { name: 'Outcome' }).click();
    await expect(consultant.locator('#outcomeform')).toHaveCount(0);
    await expect(consultant.locator('#panel-person-outcome')).toContainText(/manager/i);

    await outcome(manager, people.b, 'not-selected', 'Recorded in error during the rehearsal.', 'S1 panel scores.');
    await expect(manager.locator('#toast')).toBeVisible();
    await outcome(manager, people.b, 'withdrawn', 'Correcting the entry above: Bo withdrew by telephone on 14 September.', '', true);
    await expect(manager.locator('#panel-person-outcome')).toContainText(/Recorded in error/);
    await expect(manager.locator('#panel-person-outcome')).toContainText(/withdrew by telephone/);

    await outcome(manager, people.a, 'selected', 'Appointed by the board on 15 September.', 'Strongest against S1; two references confirmed the budget turnaround.');
    await outcome(manager, people.c, 'not-selected', 'Board appointed another finalist.', 'Lower panel scores against S1.');

    const decided = await (await manager.request.get('/api/searches/' + search.id)).json();
    const bo = decided.candidates.find(c => c.id === people.b.id);
    expect(bo.dispositions, 'the correction replaced the original instead of superseding it').toHaveLength(2);
    expect(bo.dispositions[0].outcome).toBe('not-selected');
    expect(bo.dispositions[1].supersedes).toBeTruthy();
    expect(bo.invite, 'a withdrawn candidate kept a live questionnaire link').toBeFalsy();

    // Bo's old link is dead, and says so rather than opening a questionnaire.
    const stale = await browser.newContext();
    const strangerPage = await stale.newPage();
    await strangerPage.goto('/apply/' + people.b.invite);
    await expect(strangerPage.locator('body')).not.toContainText('Describe your public budgeting work.');
    await stale.close();

    /* --- B08: closeout, reopening, and links that stay revoked ------------- */

    await open(consultant, '/#/s/' + search.id + '/closeout');
    await expect(consultant.locator('#closeform')).toHaveCount(0);
    await expect(consultant.locator('#main')).toContainText(/runs this search|search manager/i);

    await open(manager, '/#/s/' + search.id + '/closeout');
    await manager.locator('#closeform [name="status"]').selectOption('closed');
    await manager.locator('#closeform [name="reason"]').fill('Appointment made; rehearsal closeout.');
    await manager.getByRole('button', { name: 'Close this search' }).click();
    await expect(manager.locator('#reopenform')).toBeVisible();

    // A frozen file refuses further work, through the screens as well as the API.
    const frozenWrite = await manager.request.post('/api/searches/' + search.id + '/candidates', {
      headers: await ifMatch(manager, search.id), data: { name: 'Too Late Fixture' }
    });
    expect(frozenWrite.status(), 'a closed search accepted a new candidate').toBe(409);

    await manager.locator('#reopenform [name="reason"]').fill('One reference conversation outstanding.');
    await manager.getByRole('button', { name: 'Reopen this search' }).click();
    await expect(manager.locator('#closeform')).toBeVisible();

    const reopened = await (await manager.request.get('/api/searches/' + search.id)).json();
    expect(reopened.lifecycle.status).toBe('active');
    expect((reopened.candidates || []).some(c => c.invite),
      'reopening put revoked candidate links back into circulation').toBe(false);

    await Promise.all([managerContext.close(), consultantContext.close()]);
  });

  test('B09: the export is downloadable from the browser and declares what it withholds',
    async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'desktop-chrome', 'the connected rehearsal runs once; device coverage is separate');
    test.slow();
    await installClerk(page, { email: 'abe@slate.local' });
    acceptConfirmations(page);
    const { search, people } = await prepare(page, unique('Export County', testInfo));

    // One answered questionnaire and one score, so the export has a record to
    // be compared against rather than an empty shape.
    const candidateContext = await page.context().browser().newContext();
    const candidatePage = await candidateContext.newPage();
    await candidatePage.goto('/apply/' + people.a.invite);
    await candidatePage.getByLabel('Describe your public budgeting work.')
      .fill('Rebuilt a structurally unbalanced general fund over three cycles.');
    await candidatePage.getByRole('button', { name: 'Submit questionnaire' }).click();
    await expect(candidatePage.getByText('You can close this page.')).toBeVisible({ timeout: 10000 });
    await candidateContext.close();

    await open(page, '/#/s/' + search.id + '/person/' + people.a.id);
    await page.locator('[data-score="S1"][data-val="4"]').click();
    await page.getByRole('button', { name: 'Save my scores' }).click();
    await expect(page.locator('#toast')).toContainText(/on the file/i);

    const download = async name => {
      await open(page, '/#/s/' + search.id + '/closeout');
      const [file] = await Promise.all([
        page.waitForEvent('download'),
        page.getByRole('button', { name }).click()
      ]);
      const stream = await file.createReadStream();
      let text = '';
      for await (const chunk of stream) text += chunk;
      return text;
    };

    /* --- sealed: the withholding is declared, not silent ------------------ */

    const sealed = await download('Download the report');
    expect(sealed).toContain('Rebuilt a structurally unbalanced general fund');
    expect(sealed).toContain('Describe your public budgeting work.');
    expect(sealed).toMatch(/sealed/i);
    // Nothing that would let the reader become a candidate, or read another firm.
    expect(sealed).not.toContain(people.a.invite);
    expect(sealed).not.toMatch(/CLERK_SECRET_KEY|ANTHROPIC_API_KEY|Bearer /);

    /* --- released: the same record, with the scores in it ------------------ */

    await open(page, '/#/s/' + search.id + '/screen');
    await page.getByRole('button', { name: 'Release scores' }).click();
    await expect(page.locator('#toast')).toContainText(/released/i);

    const released = await download('Download the data bundle');
    const bundle = JSON.parse(released);
    expect(bundle.evaluation.sealed, 'the export still declared the scores sealed after release').toBe(false);
    expect(JSON.stringify(bundle)).not.toContain(people.a.invite);
    expect(bundle.candidates.find(c => c.name === 'Ada Pilot-Hired')).toBeTruthy();

    /* --- after closeout: still exportable, and it says the search closed --- */

    await open(page, '/#/s/' + search.id + '/closeout');
    await page.locator('#closeform [name="status"]').selectOption('closed');
    await page.locator('#closeform [name="reason"]').fill('Rehearsal export check.');
    await page.getByRole('button', { name: 'Close this search' }).click();
    await expect(page.locator('#reopenform')).toBeVisible();

    const closed = await download('Download the report');
    expect(closed).toMatch(/closed/i);
    expect(closed).toContain('Rehearsal export check.');
  });
});
