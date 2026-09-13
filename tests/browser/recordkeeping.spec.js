'use strict';

// Browser coverage for the three tickets that had no user interface.
//
// DEP-07, DEP-08 and DEP-09 shipped as API routes, which meant a consultant
// could not verify a county fact, record a document, log a contact, decide a
// candidate or close a search inside the application at all. These check the
// screens that now carry them, and they check the parts that matter to a
// record: that a correction keeps the decision it replaced, that closing a
// search actually stops work, and that reopening does not resurrect a link.

const { test, expect } = require('@playwright/test');
const { installClerk } = require('./clerk');

test.beforeEach(async ({ page }) => { await installClerk(page); });

async function revision(page, id) {
  return String((await (await page.request.get('/api/searches/' + id)).json()).revision);
}

// Build the file through the API so a test about closeout does not have to
// walk every screen that leads to it.
async function makeSearch(page, data) {
  return (await page.request.post('/api/searches', { data })).json();
}
async function addCandidate(page, id, data) {
  return (await page.request.post('/api/searches/' + id + '/candidates', {
    headers: { 'if-match': await revision(page, id) }, data
  })).json();
}
async function openCandidate(page, searchId, candidateId, tab) {
  await page.goto('/#/s/' + searchId + '/person/' + candidateId);
  await expect(page.locator('#main h1')).toBeVisible({ timeout: 10000 });
  if (tab) await page.getByRole('tab', { name: tab }).click();
}

// The name has to be unique per project: both projects share one store.
function unique(base, testInfo) {
  return base + ' ' + testInfo.project.name;
}

/* --- DEP-09: outcomes ----------------------------------------------------- */

test('an outcome is recorded on the candidate, and a correction keeps the decision it replaced',
  async ({ page }, testInfo) => {
  const search = await makeSearch(page, { client: unique('Outcome County', testInfo), position: 'County Administrator' });
  const before = await addCandidate(page, search.id, { name: 'Dana Reyes' });
  const candidate = before.candidates.find(c => c.name === 'Dana Reyes');
  expect(candidate.invite, 'a new candidate should start with a live link').toBeTruthy();

  await openCandidate(page, search.id, candidate.id, 'Outcome');
  await page.locator('#outcomeform [name="outcome"]').selectOption('not-selected');
  await page.locator('#outcomeform [name="reason"]').fill('Panel selected two stronger finalists.');

  // Not-selected is a hiring decision, so the server refuses it without the
  // job-related basis. The screen has to surface that refusal, not swallow it.
  page.once('dialog', d => d.accept());
  await page.getByRole('button', { name: 'Record this outcome' }).click();
  await expect(page.locator('#toast')).toContainText(/job-related evidence/i);

  await page.locator('#outcomeform [name="evidence"]').fill('Scores against S1 and S3; interview panel notes 12 Sep.');
  page.once('dialog', d => d.accept());
  await page.getByRole('button', { name: 'Record this outcome' }).click();
  await expect(page.locator('.pagehead')).toContainText('Not selected');

  // The link goes with the outcome: a URL that still opens a questionnaire
  // nobody will read is worse than no URL.
  const after = await (await page.request.get('/api/searches/' + search.id)).json();
  expect(after.candidates.find(c => c.id === candidate.id).invite).toBeFalsy();
  await expect(page.getByRole('button', { name: /advance to/i })).toHaveCount(0);

  // A correction is another entry. Both decisions stay readable.
  await page.getByRole('tab', { name: 'Outcome' }).click();
  await expect(page.locator('#outcomeform [name="correction"]')).toBeChecked();
  await page.locator('#outcomeform [name="outcome"]').selectOption('withdrawn');
  await page.locator('#outcomeform [name="reason"]').fill('Called to say she had accepted another post.');
  page.once('dialog', d => d.accept());
  await page.getByRole('button', { name: 'Record this outcome' }).click();

  await page.getByRole('tab', { name: 'Outcome' }).click();
  const history = page.locator('#panel-person-outcome').getByText('Decision history', { exact: false });
  await expect(history).toBeVisible();
  await expect(page.locator('#panel-person-outcome')).toContainText('Superseded');
  await expect(page.locator('#panel-person-outcome')).toContainText('Panel selected two stronger finalists.');
  await expect(page.locator('#panel-person-outcome')).toContainText('Reported by the candidate, recorded by staff');
});

/* --- DEP-08: documents and contact ---------------------------------------- */

test('a document reference refuses a non-https link, and reference material is marked restricted',
  async ({ page }, testInfo) => {
  const search = await makeSearch(page, { client: unique('Document County', testInfo), position: 'County Administrator' });
  const before = await addCandidate(page, search.id, { name: 'Sam Okafor' });
  const candidate = before.candidates.find(c => c.name === 'Sam Okafor');

  await openCandidate(page, search.id, candidate.id, 'Details');
  await page.getByRole('button', { name: 'Record a document' }).click();
  await page.locator('#docform [name="kind"]').selectOption('reference');
  await page.locator('#docform [name="label"]').fill('Reference call notes');
  await page.locator('#docform [name="url"]').fill('http://records.example.gov/sam');
  await page.getByRole('button', { name: 'Record this document' }).click();
  await expect(page.locator('#toast')).toContainText(/https link/i);

  await page.locator('#docform [name="url"]').fill('https://records.example.gov/sam');
  await page.getByRole('button', { name: 'Record this document' }).click();
  const panel = page.locator('#panel-person-details');
  await expect(panel).toContainText('Reference call notes');
  await expect(panel).toContainText('Restricted');

  // What is stored is a reference, not the document.
  const after = await (await page.request.get('/api/searches/' + search.id)).json();
  const doc = after.candidates.find(c => c.id === candidate.id).documents[0];
  expect(doc.url).toBe('https://records.example.gov/sam');
  expect(doc.restricted).toBe(true);
});

test('logged contact is labelled staff-recorded and a dated follow-up reaches the candidate list',
  async ({ page }, testInfo) => {
  const search = await makeSearch(page, { client: unique('Contact County', testInfo), position: 'County Administrator' });
  const before = await addCandidate(page, search.id, { name: 'Robin Vega' });
  const candidate = before.candidates.find(c => c.name === 'Robin Vega');

  await openCandidate(page, search.id, candidate.id, 'Details');
  // Nobody has been contacted, so the list should already be saying so.
  await page.goto('/#/s/' + search.id + '/screen');
  await expect(page.locator('.spec', { hasText: 'Follow-up' })).toContainText('No contact recorded yet');

  await openCandidate(page, search.id, candidate.id, 'Details');
  await page.getByRole('button', { name: 'Log contact' }).click();
  await page.locator('#commform [name="channel"]').selectOption('phone');
  await page.locator('#commform [name="purpose"]').selectOption('scheduling');
  await page.locator('#commform [name="summary"]').fill('Agreed to a panel slot on the 24th.');
  // A date already past is what makes this candidate overdue.
  await page.locator('#commform [name="followUpOn"]').evaluate(el => {
    el.min = '';
    el.value = '2020-01-02';
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await page.getByRole('button', { name: 'Record this contact' }).click();

  const panel = page.locator('#panel-person-details');
  await expect(panel).toContainText('Agreed to a panel slot on the 24th.');
  // The honest label. Slate has no mail server.
  await expect(panel).toContainText(/cannot confirm delivery/i);

  await page.goto('/#/s/' + search.id + '/screen');
  const followUp = page.locator('.spec', { hasText: 'Follow-up' });
  await expect(followUp).toContainText('Follow-up date has passed');
  await expect(followUp.getByRole('button', { name: 'Robin Vega' })).toBeVisible();
});

/* --- DEP-09: closeout ----------------------------------------------------- */

test('closing a search freezes it everywhere, revokes links, and reopening restores none of them',
  async ({ page }, testInfo) => {
  const search = await makeSearch(page, { client: unique('Closeout County', testInfo), position: 'County Administrator' });
  const before = await addCandidate(page, search.id, { name: 'Alex Chen' });
  const candidate = before.candidates.find(c => c.name === 'Alex Chen');
  expect(candidate.invite).toBeTruthy();

  await page.goto('/#/s/' + search.id + '/closeout');
  await expect(page.locator('#main h1')).toBeVisible({ timeout: 10000 });
  // Closing does not decide anyone, and the screen says so rather than
  // implying the file is complete.
  await expect(page.locator('.notice')).toContainText('no outcome recorded');

  await page.locator('#closeform [name="status"]').selectOption('cancelled');
  await page.locator('#closeform [name="reason"]').fill('The board suspended the recruitment.');
  page.once('dialog', d => d.accept());
  await page.getByRole('button', { name: 'Close this search' }).click();
  await expect(page.locator('#toast')).toContainText(/1 candidate link\(s\) revoked/i);

  const closed = await (await page.request.get('/api/searches/' + search.id)).json();
  expect(closed.candidates.find(c => c.id === candidate.id).invite).toBeFalsy();

  // The freeze is stated on whatever screen the user is on, not discovered
  // when a Save button quietly fails.
  await page.goto('/#/s/' + search.id + '/screen');
  await expect(page.locator('.notice--stop')).toContainText('This search is cancelled');
  await page.goto('/#/s/' + search.id);
  await expect(page.locator('.notice--stop')).toContainText('This search is cancelled');

  // And the server means it.
  const refused = await page.request.patch('/api/searches/' + search.id, {
    headers: { 'if-match': await revision(page, search.id) }, data: { position: 'Something else' }
  });
  expect(refused.status()).toBe(409);

  await page.goto('/#/s/' + search.id + '/closeout');
  await page.locator('#reopenform [name="reason"]').fill('The board reinstated the recruitment on 2 October.');
  page.once('dialog', d => d.accept());
  await page.getByRole('button', { name: 'Reopen this search' }).click();
  await expect(page.locator('#toast')).toContainText(/links were not restored/i);

  const reopened = await (await page.request.get('/api/searches/' + search.id)).json();
  expect(reopened.lifecycle.status).toBe('active');
  expect(reopened.lifecycle.reopenCount).toBe(1);
  // Reopening a search must never put an old bearer URL back into the world.
  expect(reopened.candidates.find(c => c.id === candidate.id).invite).toBeFalsy();
  await expect(page.locator('.notice--stop')).toHaveCount(0);
});

/* --- DEP-07: county fact verification ------------------------------------- */

test('a county fact without its source stays unconfirmed, and confirming the material ones clears the gate',
  async ({ page }, testInfo) => {
  const search = await makeSearch(page, {
    client: unique('Verify County', testInfo), position: 'County Administrator', jurisdictionType: 'county'
  });

  await page.goto('/#/s/' + search.id + '/verify');
  await expect(page.locator('#main h1')).toBeVisible({ timeout: 10000 });
  await expect(page.locator('.notice')).toContainText('Material facts outstanding');

  const blocks = page.locator('[data-fact]');
  const total = await blocks.count();
  expect(total, 'the verification screen should list the county fact fields').toBeGreaterThan(0);

  // A value with no source is an assertion, not a confirmed fact, and the
  // screen has to keep saying so.
  const first = blocks.first();
  const key = await first.getAttribute('data-fact');
  await first.locator('[name="' + key + '.value"]').fill('Appointed by the Board of Supervisors.');
  await page.getByRole('button', { name: 'Save these facts' }).click();
  await expect(page.locator('[data-fact="' + key + '"]')).toContainText('Not verified');

  // Fill every material fact properly and the publishing gate clears.
  const status = await (await page.request.get('/api/searches/' + search.id)).json();
  const material = status.factStatus.fields.filter(f => f.material);
  expect(material.length).toBeGreaterThan(0);
  for (const field of material) {
    const block = page.locator('[data-fact="' + field.key + '"]');
    await block.locator('[name="' + field.key + '.value"]').fill('Confirmed for ' + field.label + '.');
    await block.locator('[name="' + field.key + '.source"]').fill('County code § 2-14');
    await block.locator('[name="' + field.key + '.asOf"]').fill('2026-09-01');
    await block.locator('[name="' + field.key + '.confirmedBy"]').fill('Abe Macy');
  }
  await page.getByRole('button', { name: 'Save these facts' }).click();
  await expect(page.locator('.notice--ok')).toContainText('Every material fact is confirmed');

  // Who confirmed it and when is stamped by the server, not typed.
  const after = await (await page.request.get('/api/searches/' + search.id)).json();
  const record = after.verification[material[0].key];
  expect(record.confirmedBy).toBe('Abe Macy');
  expect(record.confirmedAt).toBeTruthy();
  expect(after.factStatus.readyToPublish).toBe(true);
});

/* --- the committee's side of the same file -------------------------------- */

test('a committee member is not offered outcomes, verification or closeout', async ({ page }, testInfo) => {
  const search = await makeSearch(page, { client: unique('Boundary County', testInfo), position: 'County Administrator' });
  await addCandidate(page, search.id, { name: 'Jo Park' });
  const member = 'committee-record-' + testInfo.project.name.replace(/[^a-z]/gi, '') + '@example.gov';
  await page.request.post('/api/searches/' + search.id + '/members', {
    headers: { 'if-match': await revision(page, search.id) },
    data: { name: 'Pat Lane', email: member, seat: 'committee' }
  });

  await installClerk(page, { email: member });
  // These are consultant screens. A committee member who follows a link to one
  // lands on the search rather than on an empty or half-usable page.
  for (const view of ['verify', 'closeout']) {
    await page.goto('/#/s/' + search.id + '/' + view);
    await expect(page.locator('#main h1')).toBeVisible({ timeout: 10000 });
    await expect(page).toHaveURL(new RegExp('#/s/' + search.id + '$'));
  }

  const candidates = await (await page.request.get('/api/searches/' + search.id)).json();
  await page.goto('/#/s/' + search.id + '/person/' + candidates.candidates[0].id);
  await expect(page.locator('#main h1')).toBeVisible({ timeout: 10000 });
  await expect(page.getByRole('tab', { name: 'Outcome' })).toHaveCount(0);
  await expect(page.locator('#docform')).toHaveCount(0);
  await expect(page.locator('#commform')).toHaveCount(0);
});
