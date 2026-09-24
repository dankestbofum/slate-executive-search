'use strict';

// Candidate recovery has to work in the page, not only at the API boundary.
// These cases cover the two failures most likely on a phone: leaving before a
// long answer is submitted, and losing the response after the server commits.

const { test, expect } = require('@playwright/test');
const { installClerk } = require('./clerk');

async function revision(page, id) {
  return String((await (await page.request.get('/api/searches/' + id)).json()).revision);
}

async function candidateQuestionnaire(page, label) {
  await installClerk(page);
  const search = await (await page.request.post('/api/searches', {
    data: { client: label, position: 'County Manager', package: 'executive', jurisdictionType: 'county' }
  })).json();
  const withCandidate = await (await page.request.post('/api/searches/' + search.id + '/candidates', {
    headers: { 'if-match': await revision(page, search.id) },
    data: { name: 'Synthetic Candidate', email: 'candidate@example.test' }
  })).json();
  const candidate = withCandidate.candidates[0];
  const survey = {
    intro: 'Synthetic pilot questionnaire.',
    questions: [
      { n: 1, prompt: 'Describe your budget experience.', required: true },
      { n: 2, prompt: 'Why are you interested?', required: false }
    ]
  };
  const published = await page.request.put('/api/searches/' + search.id + '/artifact/survey1', {
    headers: { 'if-match': await revision(page, search.id) }, data: { body: survey }
  });
  expect(published.ok(), await published.text()).toBe(true);
  return { search, candidate, token: candidate.invite };
}

test('a candidate saves a draft and gets the same answers after reload', async ({ page }, testInfo) => {
  const { token } = await candidateQuestionnaire(page, 'Draft Recovery ' + testInfo.project.name);
  await page.goto('/apply/' + token);

  const answer = page.getByLabel('Describe your budget experience.');
  await expect(answer).toBeVisible({ timeout: 10000 });
  await answer.fill('Managed a synthetic $40 million operating budget.');
  await page.getByRole('button', { name: 'Save draft' }).click();
  await expect(page.locator('#apply-draft-status')).toContainText('Draft saved');

  await page.reload();
  await expect(answer).toHaveValue('Managed a synthetic $40 million operating budget.');
  await expect(page.locator('#applycount')).toHaveText('1 of 2 answered');
  await expect(page.locator('#apply-draft-status')).toContainText('Draft saved');
});

test('a committed submission whose response is lost retries to the same receipt', async ({ page }, testInfo) => {
  const { search, candidate, token } = await candidateQuestionnaire(page, 'Lost Response ' + testInfo.project.name);
  await page.goto('/apply/' + token);
  await page.getByLabel('Describe your budget experience.').fill('The response body will be deliberately dropped.');

  let dropped = false;
  await page.route('**/api/apply/' + token, async route => {
    if (route.request().method() !== 'POST' || dropped) return route.fallback();
    dropped = true;
    // Let the real server commit, then make the browser believe the connection
    // disappeared before it received the acknowledgement.
    const committed = await route.fetch();
    await committed.dispose();
    await route.abort('connectionreset');
  });

  await page.getByRole('button', { name: 'Submit questionnaire' }).click();
  await expect(page.locator('#toast')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Submit questionnaire' })).toBeVisible();

  await page.getByRole('button', { name: 'Submit questionnaire' }).click();
  await expect(page.getByText('You can close this page.')).toBeVisible({ timeout: 10000 });
  const receipt = page.locator('.notice--ok').filter({ hasText: 'reference' });
  await expect(receipt).toContainText(/reference [A-F0-9]{12}/);

  const stored = await (await page.request.get('/api/searches/' + search.id)).json();
  const live = stored.candidates.find(row => row.id === candidate.id);
  expect(live.survey1.answers.q1).toBe('The response body will be deliberately dropped.');
  expect(stored.activity.filter(row => /submitted the survey1 questionnaire/.test(row.x || ''))).toHaveLength(1);
});
