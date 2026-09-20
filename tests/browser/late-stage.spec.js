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
  for (const [key, body] of [
    ['survey2', { questions: [{ n: 1, prompt: 'What would your first ninety days look like?', required: true }] }],
    ['guide', { questions: [{ n: 1, stem: 'Describe a budget turnaround.' }] }]
  ]) {
    const saved = await page.request.put('/api/searches/' + search.id + '/artifact/' + key, {
      headers: await ifMatch(page, search.id), data: { body }
    });
    expect(saved.ok(), await saved.text()).toBe(true);
  }

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
    const initial = await (await page.request.get('/api/apply/' + person.invite)).json();
    const submitted = await page.request.post('/api/apply/' + person.invite, {
      data: { which: 'survey1', surveyVersion: initial.versions.survey1, answers: { q1: 'Synthetic initial answer for ' + person.name } }
    });
    expect(submitted.ok(), await submitted.text()).toBe(true);
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

async function download(page, id, name = 'Download the data bundle') {
  await open(page, '/#/s/' + id + '/closeout');
  const [file] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name }).click()]);
  const stream = await file.createReadStream();
  let text = '';
  for await (const chunk of stream) text += chunk;
  // The export reloads the search after recording the download.
  await expect(page.locator('#toast')).toContainText('Export downloaded');
  return text;
}

test.describe('the late stage, connected', () => {
  test('B07–B09: semifinalist responses through staff work, decisions, export and archive restoration',
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

    // Step 13: the staff opens the survey; candidates submit in their own sessions.
    await open(consultant, '/#/s/' + search.id + '/send2');
    await consultant.getByRole('button', { name: 'Open for all semifinalists' }).click();
    await expect(consultant.getByRole('button', { name: 'Open questionnaire', exact: true })).toHaveCount(0);
    for (const person of Object.values(people)) {
      const context = await browser.newContext();
      const candidate = await context.newPage();
      await candidate.goto('/apply/' + person.invite);
      await candidate.getByLabel('What would your first ninety days look like?').fill('First ninety days for ' + person.name);
      await candidate.getByRole('button', { name: 'Save draft' }).click();
      await expect(candidate.locator('#apply-draft-status')).toContainText('Draft saved');
      await candidate.reload();
      await expect(candidate.getByLabel('What would your first ninety days look like?')).toHaveValue('First ninety days for ' + person.name);
      await candidate.getByRole('button', { name: 'Submit questionnaire' }).click();
      await expect(candidate.getByText('You can close this page.')).toBeVisible();
      await context.close();
    }

    // Inventory and manual contact travel with this same record into B09.
    await open(consultant, '/#/s/' + search.id + '/person/' + people.a.id);
    await consultant.getByRole('tab', { name: 'Details' }).click();
    await consultant.getByRole('button', { name: 'Record a document' }).click();
    await consultant.locator('#docform [name="label"]').fill('Resume ADA-01');
    await consultant.locator('#docform [name="url"]').fill('https://records.example.gov/doc?token=SHARING_SECRET');
    await consultant.getByRole('button', { name: 'Record this document' }).click();
    await expect(consultant.locator('#toast')).toContainText('permanent document URL');
    await consultant.locator('#docform [name="url"]').fill('https://records.example.gov/doc/ADA-01');
    await consultant.getByRole('button', { name: 'Record this document' }).click();
    await expect(consultant.locator('#panel-person-details')).toContainText('Resume ADA-01');
    await consultant.getByRole('button', { name: 'Log contact' }).click();
    await consultant.locator('#commform [name="purpose"]').selectOption('scheduling');
    await consultant.locator('#commform [name="summary"]').fill('Synthetic interview arranged externally for 10am Arizona time.');
    await consultant.getByRole('button', { name: 'Record this contact' }).click();
    await expect(consultant.locator('#panel-person-details')).toContainText('Synthetic interview arranged externally');

    // B07 sourcing and Step 14: evidence and completion are browser actions.
    for (const key of ['sourcing', 'video']) {
      await open(consultant, '/#/s/' + search.id + '/' + key);
      await consultant.getByRole('button', { name: 'Mark complete' }).click();
      await expect(consultant.locator('#toast')).toContainText(/empty|log what was done/i);
      if (key === 'video') await consultant.locator('#staff-cid').selectOption({ label: people.a.name });
      await consultant.locator('#staff-text').fill('Synthetic ' + key + ' evidence');
      await consultant.getByRole('button', { name: 'Add to the log' }).click();
      await expect(consultant.getByText('Synthetic ' + key + ' evidence', { exact: true })).toBeVisible();
      await consultant.getByRole('button', { name: 'Mark complete' }).click();
      await expect(consultant.getByText(/^Completed /)).toBeVisible();
    }

    // Two independent reviewers; editing one sealed score creates private history.
    for (const [page, value, note] of [[manager, 4, 'Manager panel note'], [consultant, 2, 'Private original panel note'], [consultant, 5, 'Private revised panel note']]) {
      await open(page, '/#/s/' + search.id + '/person/' + people.a.id);
      await page.locator('[data-score="S1"][data-val="' + value + '"]').click();
      await page.locator('#cnote').fill(note);
      await page.getByRole('button', { name: 'Save my scores', exact: true }).click();
      await expect(page.locator('#toast')).toContainText(/on the file/i);
    }
    const sealed = JSON.parse(await download(manager, search.id));
    expect(sealed.evaluation.sealed).toBe(true);
    expect(JSON.stringify(sealed)).not.toMatch(/Private original panel note|Private revised panel note|Manager panel note/);
    expect(sealed.history.some(entry => entry.scoresWithheld)).toBe(true);
    await open(consultant, '/#/s/' + search.id + '/screen');
    await expect(consultant.getByRole('button', { name: 'Release scores' })).toHaveCount(0);
    await open(manager, '/#/s/' + search.id + '/screen');
    await manager.getByRole('button', { name: 'Release scores' }).click();
    await expect(manager.locator('#toast')).toContainText(/released/i);
    const released = JSON.parse(await download(manager, search.id));
    expect(Object.values(released.evaluation.scores).map(scores => scores[people.a.id].S1).sort()).toEqual([4, 5]);
    expect(JSON.stringify(released.history)).toContain('Private original panel note');


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

    // Steps 16, 18 and 19: manually prepare the artifacts without a provider call.
    await open(manager, '/#/s/' + search.id + '/schedule');
    await manager.locator('[data-path="note"]').fill('Same questions and Arizona time for both finalists.');
    await manager.locator('[data-path="guide.panel"]').fill('Synthetic panel assessment');
    await manager.getByRole('button', { name: 'Save edits' }).click();
    await expect(manager.locator('.docbar')).toContainText('Saved draft');
    await open(manager, '/#/s/' + search.id + '/contract');
    await manager.getByRole('button', { name: 'Add a section' }).click();
    await manager.locator('[data-path="sections.0.h"]').fill('Synthetic terms for counsel review');
    await manager.locator('[data-path="sections.0.body"]').fill('Unreviewed draft; mock counsel review and signatures occur outside Slate.');
    await manager.getByRole('button', { name: 'Save edits' }).click();
    await expect(manager.locator('.docbar')).toContainText('Saved draft');
    await open(manager, '/#/s/' + search.id + '/bar');
    await manager.locator('[data-artadd="bar:actions"]').click();
    await manager.locator('[data-path="actions.0.t"]').fill('Board chair owns first-year evaluation');
    await manager.locator('[data-path="actions.0.due"]').fill('2027-09-16');
    await manager.getByRole('button', { name: 'Save edits' }).click();
    await expect(manager.locator('.docbar')).toContainText('Saved draft');

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
    await open(manager, '/#/s/' + search.id + '/references');
    await manager.locator('#staff-notes').fill('Reference review complete; notes in the restricted repository.');
    await manager.getByRole('button', { name: 'Save notes' }).click();
    await expect(manager.locator('#toast')).toBeVisible();
    await manager.getByRole('button', { name: 'Mark complete' }).click();
    await expect(manager.getByText(/^Completed /)).toBeVisible();
    await manager.locator('.feed__i', { hasText: 'former county manager' }).getByRole('button', { name: 'Remove', exact: true }).click();
    await expect(manager.getByText(/^Completed /)).toHaveCount(0);
    await manager.getByRole('button', { name: 'Mark complete' }).click();
    await expect(manager.locator('#toast')).toContainText('every current finalist');
    await manager.locator('#staff-cid').selectOption({ label: people.c.name });
    await manager.locator('#staff-text').fill('Corrected reference contact for Cyd; external notes reviewed.');
    await manager.getByRole('button', { name: 'Add to the log' }).click();
    await expect(manager.getByText('Corrected reference contact for Cyd', { exact: false })).toBeVisible();
    await manager.getByRole('button', { name: 'Mark complete' }).click();
    await expect(manager.getByText(/^Completed /)).toBeVisible();
    await manager.locator('tr', { hasText: people.c.name }).getByRole('button', { name: 'Withdraw', exact: true }).click();
    await expect(manager.getByText(/^Completed /)).toHaveCount(0);
    await manager.locator('tr', { hasText: people.c.name }).getByRole('button', { name: 'Record consent' }).click();
    await expect(manager.locator('tr', { hasText: people.c.name })).toContainText('Consent on file');
    await manager.getByRole('button', { name: 'Mark complete' }).click();
    await expect(manager.getByText(/^Completed /)).toBeVisible();

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
    await expect(strangerPage.getByRole('heading', { name: 'This link is not valid' })).toBeVisible();
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

    const closed = JSON.parse(await download(manager, search.id));
    expect(closed.lifecycle.status).toBe('closed');
    expect(closed.candidates).toHaveLength(3);
    const ada = closed.candidates.find(c => c.id === people.a.id);
    expect(ada.documents[0].location).toBe('https://records.example.gov/doc/ADA-01');
    expect(ada.communications[0].summary).toContain('10am Arizona time');
    expect(JSON.stringify(closed)).not.toContain('SHARING_SECRET');
    for (const person of Object.values(people)) {
      const record = closed.candidates.find(c => c.id === person.id);
      expect(record.responses.survey2.questions[0].prompt).toBe('What would your first ninety days look like?');
      expect(record.responses.survey2.answers.q1).toBe('First ninety days for ' + person.name);
      expect(JSON.stringify(closed)).not.toContain(person.invite);
    }
    expect(closed.dispositions.find(c => c.candidateId === people.b.id).history).toHaveLength(2);
    expect(closed.staffWork.references.completedAt).toBeTruthy();
    expect(closed.artifacts.contract.body.sections[0].h).toContain('counsel review');
    expect(closed.artifacts.bar.body.actions[0].t).toContain('Board chair');
    expect(closed.artifacts.schedule.body.guide.panel).toBe('Synthetic panel assessment');
    expect(closed.staffWork.sourcing.log[0].text).toBe('Synthetic sourcing evidence');
    expect(closed.staffWork.video.log[0].text).toBe('Synthetic video evidence');
    const report = await download(manager, search.id, 'Download the report');
    expect(report).toContain('Appointment made; rehearsal closeout.');
    expect(report).toContain('First ninety days for ' + people.a.name);

    // Archive a CLOSED search through its ordinary UI, then restore it.
    await open(manager, '/#/');
    await manager.getByRole('button', { name: 'More', exact: true }).click();
    await manager.locator('[data-act="delete-search"][data-id="' + search.id + '"]').click();
    await expect(manager.locator('[data-open="' + search.id + '"]')).toHaveCount(0);
    await open(manager, '/#/archives');
    await manager.locator('[data-act="restore-search"][data-id="' + search.id + '"]').click();
    await expect(manager.locator('#toast')).toContainText('Search restored');
    await open(manager, '/#/s/' + search.id + '/closeout');
    await expect(manager.locator('#reopenform')).toBeVisible();
    const restored = await (await manager.request.get('/api/searches/' + search.id)).json();
    expect(restored.lifecycle.status).toBe('closed');
    expect(restored.candidates.every(c => !c.invite)).toBe(true);

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
    for (const person of Object.values(people)) {
      expect((await manager.request.get('/api/apply/' + person.invite)).status()).toBe(404);
    }
    await open(manager, '/#/s/' + search.id + '/screen');
    const adaRow = manager.locator('tr', { hasText: people.a.name });
    await adaRow.getByRole('button', { name: 'Invite', exact: true }).click();
    await expect(adaRow.getByRole('button', { name: 'Copy invite link', exact: true })).toHaveCount(0);
    await expect(adaRow.getByRole('link', { name: 'Open questionnaire' })).toHaveCount(0);
    await adaRow.getByRole('button', { name: 'Issue a new link' }).click();
    await expect(manager.locator('#toast')).toContainText('Copy the new link');
    const reissued = await (await manager.request.get('/api/searches/' + search.id)).json();
    const liveInvite = reissued.candidates.find(c => c.id === people.a.id).invite;
    expect(liveInvite).toBeTruthy();
    expect(liveInvite).not.toBe(people.a.invite);
    expect((await manager.request.get('/api/apply/' + liveInvite)).status()).toBe(200);
    expect(reissued.candidates.filter(c => c.id !== people.a.id).every(c => !c.invite)).toBe(true);

    await Promise.all([managerContext.close(), consultantContext.close()]);
  });

  test('manager handover and administrator reassignment follow the authority shown in the UI', async ({ browser }, testInfo) => {
    const contexts = await Promise.all([browser.newContext(), browser.newContext(), browser.newContext()]);
    try {
      const [manager, admin, consultant] = await Promise.all(contexts.map(context => context.newPage()));
      await installClerk(manager, { email: 'mike@slate.local' });
      await installClerk(admin, { email: 'abe@slate.local' });
      const email = 'handover-' + testInfo.project.name + '@example.com';
      await joinWorkspace(email, 'org:consultant');
      await installClerk(consultant, { email });
      const response = await manager.request.post('/api/searches', {
        data: { client: unique('Handover County', testInfo), position: 'Administrator' }
      });
      expect(response.ok()).toBe(true);
      const search = await response.json();
      for (const page of [admin, consultant]) {
        const joined = await page.request.post('/api/searches/' + search.id + '/members/self', {
          headers: await ifMatch(page, search.id), data: {}
        });
        expect(joined.ok(), await joined.text()).toBe(true);
      }
      const path = '/#/s/' + search.id + '/team';
      await open(consultant, path);
      await expect(consultant.locator('[data-act="make-manager"]')).toHaveCount(0);
      await open(admin, path);
      const me = (await (await admin.request.get('/api/me')).json()).user;
      const button = admin.locator('[data-act="make-manager"][data-uid="' + me.id + '"]');
      await expect(button).toHaveText('Reassign the account');
      admin.once('dialog', d => d.dismiss());
      await button.click();
      admin.once('dialog', d => d.accept('   '));
      await button.click();
      await expect(admin.locator('#toast')).toContainText('Enter a reason');
      let current = await (await admin.request.get('/api/searches/' + search.id)).json();
      expect(current.accountManager.userId).not.toBe(me.id);
      admin.once('dialog', d => d.accept('Manager unavailable during the synthetic rehearsal.'));
      await button.click();
      await expect(admin.locator('#toast')).toContainText('You run this search now');
      current = await (await admin.request.get('/api/searches/' + search.id)).json();
      expect(current.accountManager.userId).toBe(me.id);
      expect(JSON.stringify(current.activity)).toContain('Manager unavailable during the synthetic rehearsal.');
      await open(manager, path);
      await expect(manager.locator('[data-act="make-manager"]')).toHaveCount(0);
      const previous = current.roster.find(row => row.email === 'mike@slate.local');
      await admin.locator('[data-act="make-manager"][data-uid="' + previous.userId + '"]').click();
      await expect(admin.locator('#toast')).toContainText('Account handed over');
      await open(manager, path);
      await expect(manager.getByRole('button', { name: 'Hand over the account' }).first()).toBeVisible();
    } finally {
      await Promise.all(contexts.map(context => context.close()));
    }
  });
});
