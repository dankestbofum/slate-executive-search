'use strict';

// One connected record across the public candidate path and two independent
// reviewers. Smaller view-specific specs remain useful, but this catches a
// broken handoff where each screen works only against its own isolated fixture.

const { test, expect } = require('@playwright/test');
const { installClerk, authHeaders, sharedWorkspace } = require('./clerk');

async function revision(page, id) {
  return String((await (await page.request.get('/api/searches/' + id)).json()).revision);
}

test('candidate receipt and two sealed reviewers stay connected through score release', async ({ browser }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop-chrome', 'the connected rehearsal runs once; device coverage is separate');

  const managerContext = await browser.newContext();
  const reviewerContext = await browser.newContext();
  const candidateContext = await browser.newContext();
  const manager = await managerContext.newPage();
  const reviewer = await reviewerContext.newPage();
  const candidatePage = await candidateContext.newPage();
  await installClerk(manager, { email: 'abe@slate.local' });
  await installClerk(reviewer, { email: 'mike@slate.local' });

  const search = await (await manager.request.post('/api/searches', {
    data: { client: 'Connected Pilot County', position: 'County Manager', package: 'executive', jurisdictionType: 'county' }
  })).json();
  await manager.request.put('/api/searches/' + search.id + '/profile', {
    headers: { 'if-match': await revision(manager, search.id) },
    data: { criteria: [{ id: 'S1', kind: 'skill', label: 'Public budgeting', weight: 5, note: 'Synthetic pilot criterion.' }] }
  });
  await manager.request.put('/api/searches/' + search.id + '/artifact/survey1', {
    headers: { 'if-match': await revision(manager, search.id) },
    data: { body: { intro: 'Synthetic pilot.', questions: [{ n: 1, prompt: 'Describe your public budgeting work.', required: true, crit: ['S1'] }] } }
  });
  const withCandidate = await (await manager.request.post('/api/searches/' + search.id + '/candidates', {
    headers: { 'if-match': await revision(manager, search.id) }, data: { name: 'Synthetic Pilot Candidate' }
  })).json();
  const person = withCandidate.candidates[0];

  await candidatePage.goto('/apply/' + person.invite);
  await candidatePage.getByLabel('Describe your public budgeting work.').fill('Led a public budget process with documented public hearings.');
  await candidatePage.getByRole('button', { name: 'Save draft' }).click();
  await expect(candidatePage.locator('#apply-draft-status')).toContainText('Draft saved');
  await candidatePage.reload();
  await expect(candidatePage.getByLabel('Describe your public budgeting work.')).toHaveValue(/Led a public budget process/);
  await candidatePage.getByRole('button', { name: 'Submit questionnaire' }).click();
  await expect(candidatePage.getByText('You can close this page.')).toBeVisible({ timeout: 10000 });

  const personUrl = '/#/s/' + search.id + '/person/' + person.id;
  await Promise.all([manager.goto(personUrl), reviewer.goto(personUrl)]);
  await manager.locator('[data-score="S1"][data-val="4"]').click();
  await manager.locator('#cnote').fill('Manager synthetic note.');
  await manager.getByRole('button', { name: 'Save my scores' }).click();
  await expect(manager.locator('#toast')).toContainText(/on the file/i);

  // Reviewer loaded before the first save. Reload before scoring so this part
  // tests sealed independent reviews rather than the separate stale-save case.
  await reviewer.reload();
  await reviewer.locator('[data-score="S1"][data-val="5"]').click();
  await reviewer.locator('#cnote').fill('Reviewer synthetic note.');
  await reviewer.getByRole('button', { name: 'Save my scores' }).click();
  await expect(reviewer.locator('#toast')).toContainText(/on the file/i);

  const orgId = await sharedWorkspace();
  const sealed = await (await manager.request.get('/api/searches/' + search.id, {
    headers: authHeaders('mike@slate.local', orgId)
  })).json();
  expect(Object.keys(sealed.scores)).toHaveLength(1);
  expect(Object.values(sealed.scores)[0][person.id].S1).toBe(5);

  const releasedResponse = await manager.request.patch('/api/searches/' + search.id, {
    headers: { ...authHeaders('abe@slate.local', orgId), 'if-match': await revision(manager, search.id) },
    data: { released: true }
  });
  expect(releasedResponse.ok(), await releasedResponse.text()).toBe(true);
  const released = await (await manager.request.get('/api/searches/' + search.id, {
    headers: authHeaders('mike@slate.local', orgId)
  })).json();
  expect(Object.keys(released.scores).length).toBeGreaterThanOrEqual(2);
  expect(released.candidates.find(row => row.id === person.id).survey1.answers.q1).toMatch(/public budget process/);

  await Promise.all([managerContext.close(), reviewerContext.close(), candidateContext.close()]);
});
