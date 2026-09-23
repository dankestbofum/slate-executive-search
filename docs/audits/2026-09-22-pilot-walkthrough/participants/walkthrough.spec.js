'use strict';
// Local exploratory participant journey. Clerk's browser SDK, mail delivery,
// scanner, and physical phone are fixtures; the server routes and UI are real.
const fs = require('fs');
const path = require('path');
const { test, expect } = require('@playwright/test');
const { useBase, installClerk, joinWorkspace, authHeaders } = require('../../../../tests/browser/clerk');
useBase(process.env.SLATE_BROWSER_BASE);

const evidenceDir = path.join(__dirname, 'evidence');
fs.mkdirSync(evidenceDir, { recursive: true });
async function revision(page, id) {
  return String((await (await page.request.get('/api/searches/' + id)).json()).revision);
}
async function ok(response) { expect(response.ok(), await response.text()).toBe(true); return response.json(); }
async function capture(page, testInfo, label) {
  const prefix = testInfo.project.name + '-' + label;
  await page.screenshot({ path: path.join(evidenceDir, prefix + '.png'), fullPage: true });
  const measure = await page.evaluate(() => ({
    url: location.pathname + location.hash,
    heading: document.querySelector('h1')?.innerText || '',
    width: document.documentElement.clientWidth,
    overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    visibleButtons: [...document.querySelectorAll('button')].filter(b => b.getClientRects().length).length,
    scoreTargets: [...document.querySelectorAll('[data-score]')].map(b => ({
      width: Math.round(b.getBoundingClientRect().width),
      height: Math.round(b.getBoundingClientRect().height)
    }))
  }));
  fs.writeFileSync(path.join(evidenceDir, prefix + '.json'), JSON.stringify(measure, null, 2) + '\n');
  return measure;
}

test('committee finds assigned search, provides profile input, reviews and scores a candidate', async ({ browser }, testInfo) => {
  const managerContext = await browser.newContext();
  const reviewerContext = await browser.newContext();
  const candidateContext = await browser.newContext();
  const manager = await managerContext.newPage();
  const reviewer = await reviewerContext.newPage();
  const invitedCandidate = await candidateContext.newPage();
  const tag = testInfo.project.name + '-' + Date.now().toString(36);
  const email = 'participant-' + tag + '@example.test';
  try {
    await installClerk(manager, { email: 'abe@slate.local' });
    const search = await ok(await manager.request.post('/api/searches', {
      data: { client: 'Synthetic Participant County ' + tag, position: 'County Manager', package: 'executive', jurisdictionType: 'county' }
    }));
    await joinWorkspace(email);
    await ok(await manager.request.post('/api/me/onboarding', {
      headers: authHeaders(email, null), data: { name: 'Synthetic Reviewer', requestedRole: 'committee' }
    }));
    await ok(await manager.request.post('/api/searches/' + search.id + '/members', {
      headers: { 'if-match': await revision(manager, search.id) },
      data: { name: 'Synthetic Reviewer', email, searchRole: 'committee' }
    }));
    await ok(await manager.request.post('/api/searches/' + search.id + '/team/confirm', {
      headers: { 'if-match': await revision(manager, search.id) }, data: { confirmed: true }
    }));
    await ok(await manager.request.post('/api/searches/' + search.id + '/intake/status', {
      headers: { 'if-match': await revision(manager, search.id) }, data: { status: 'open', dueBy: '30 Dec 2026' }
    }));

    await installClerk(reviewer, { email });
    await reviewer.goto('/#/home');
    await expect(reviewer.getByRole('heading', { name: 'Your assignments' })).toBeVisible();
    await expect(reviewer.locator('.hometable')).toContainText(search.client);
    await capture(reviewer, testInfo, 'assigned-home');
    await reviewer.getByRole('button', { name: /Answer for Synthetic Participant County/ }).click();
    await expect(reviewer.getByRole('button', { name: 'Open your questionnaire' })).toBeVisible();
    await reviewer.getByRole('button', { name: 'Open your questionnaire' }).click();
    await expect(reviewer.locator('#main h1')).toContainText('Candidate profile input');
    await capture(reviewer, testInfo, 'step2-profile-input');

    const skill = reviewer.locator('#intake-sec-skill');
    await skill.getByRole('button', { name: 'Write my own' }).click();
    await skill.locator('.intake-row').last().locator('[data-f="label"]').fill('Public budgeting');
    await skill.locator('.intake-row').last().getByRole('button', { name: /Rate .* 5 of 5/ }).click();
    await reviewer.getByRole('button', { name: 'Save and finish later' }).click();
    await expect(reviewer.locator('#toast')).toContainText('Saved privately');
    await reviewer.reload();
    await expect(skill.locator('.intake-row').first().locator('[data-f="label"]')).toHaveValue('Public budgeting');
    await reviewer.getByRole('button', { name: 'Submit my answers' }).click();
    await expect(reviewer.locator('#toast')).toContainText('Your answers are in');
    await capture(reviewer, testInfo, 'step2-submitted');

    await ok(await manager.request.post('/api/searches/' + search.id + '/intake/status', {
      headers: { 'if-match': await revision(manager, search.id) }, data: { status: 'closed' }
    }));
    await ok(await manager.request.put('/api/searches/' + search.id + '/profile', {
      headers: { 'if-match': await revision(manager, search.id) },
      data: { criteria: [{ id: 'S1', kind: 'skill', label: 'Public budgeting', weight: 5, note: 'Synthetic audit criterion' }] }
    }));
    await ok(await manager.request.put('/api/searches/' + search.id + '/artifact/survey1', {
      headers: { 'if-match': await revision(manager, search.id) },
      data: { body: { intro: 'Synthetic questionnaire', questions: [{ n: 1, prompt: 'Describe your public budgeting work.', required: true, crit: ['S1'] }] } }
    }));
    const withCandidate = await ok(await manager.request.post('/api/searches/' + search.id + '/candidates', {
      headers: { 'if-match': await revision(manager, search.id) }, data: { name: 'Synthetic Candidate' }
    }));
    const person = withCandidate.candidates[0];
    // The committee is only shown applicants once the initial questionnaire
    // is answered. Complete that independent participant handoff first.
    await invitedCandidate.goto('/apply/' + person.invite);
    await invitedCandidate.getByLabel('Describe your public budgeting work.')
      .fill('Synthetic applicant budget response.');
    await invitedCandidate.getByRole('button', { name: 'Submit questionnaire' }).click();
    await expect(invitedCandidate.getByText('You can close this page.')).toBeVisible();
    await reviewer.goto('/#/s/' + search.id + '/overview');
    await expect(reviewer.locator('#main')).toContainText('Score the candidates');
    if (testInfo.project.name === 'mobile-chrome') await reviewer.getByRole('button', { name: 'Menu', exact: true }).click();
    await reviewer.locator('.rail__link--dest').filter({ hasText: 'Candidates' }).click();
    await capture(reviewer, testInfo, 'candidate-list-stale');
    await reviewer.reload();
    await expect(reviewer.locator('.candtable')).toContainText('Synthetic Candidate');
    await capture(reviewer, testInfo, 'candidate-list');
    await reviewer.locator('.candtable tbody tr', { hasText: 'Synthetic Candidate' })
      .getByRole('button', { name: 'Review', exact: true }).click();
    await expect(reviewer.locator('#main h1')).toContainText('Synthetic Candidate');
    await capture(reviewer, testInfo, 'candidate-review');
    await reviewer.locator('[data-score="S1"][data-val="4"]').click();
    await reviewer.locator('#cnote').fill('Synthetic committee assessment.');
    await reviewer.getByRole('button', { name: 'Save my scores', exact: true }).click();
    await expect(reviewer.locator('#toast')).toContainText(/on the file/i);
    await reviewer.reload();
    await expect(reviewer.locator('[data-score="S1"][data-val="4"]')).toHaveAttribute('aria-pressed', 'true');
    const stored = await (await reviewer.request.get('/api/searches/' + search.id)).json();
    expect(stored.scores).toBeTruthy();
    expect(Object.values(stored.scores || {}).some(byCandidate => byCandidate[person.id]?.S1 === 4)).toBe(true);
    await capture(reviewer, testInfo, 'score-saved');
    await reviewer.goto('/#/s/' + search.id + '/committee');
    await reviewer.getByRole('button', { name: 'Read the profile' }).click();
    await expect(reviewer.locator('#main h1')).toHaveText('Candidate profile');
    await expect(reviewer.locator('#main')).toContainText('Public budgeting');
    await capture(reviewer, testInfo, 'committee-profile-view');
    fs.writeFileSync(path.join(evidenceDir, testInfo.project.name + '-committee-record.json'), JSON.stringify({
      searchId: search.id, intakeSubmitted: stored.consensus?.submitted,
      scorePresent: Boolean(Object.values(stored.scores || {}).some(byCandidate => byCandidate[person.id]?.S1 === 4)),
      scoreReleased: stored.released
    }, null, 2) + '\n');
  } finally { await Promise.all([managerContext.close(), reviewerContext.close(), candidateContext.close()]); }
});

test('candidate saves and submits private questionnaire and public application', async ({ browser }, testInfo) => {
  const staffContext = await browser.newContext();
  const candidateContext = await browser.newContext();
  const staff = await staffContext.newPage();
  const candidate = await candidateContext.newPage();
  const tag = testInfo.project.name + '-' + Date.now().toString(36);
  try {
    await installClerk(staff);
    const search = await ok(await staff.request.post('/api/searches', {
      data: { client: 'Synthetic Applicant City ' + tag, position: 'City Manager', package: 'executive' }
    }));
    await ok(await staff.request.put('/api/searches/' + search.id + '/artifact/survey1', {
      headers: { 'if-match': await revision(staff, search.id) },
      data: { body: { intro: 'Synthetic private survey.', questions: [{ n: 1, prompt: 'Why this role?', required: true }] } }
    }));
    const withCandidate = await ok(await staff.request.post('/api/searches/' + search.id + '/candidates', {
      headers: { 'if-match': await revision(staff, search.id) }, data: { name: 'Synthetic Invited Candidate' }
    }));
    const person = withCandidate.candidates[0];
    await candidate.goto('/apply/' + person.invite);
    await expect(candidate.getByLabel('Why this role?')).toBeVisible();
    await capture(candidate, testInfo, 'private-questionnaire');
    await candidate.getByLabel('Why this role?').fill('Synthetic answer, saved before submit.');
    await candidate.getByRole('button', { name: 'Save draft' }).click();
    await expect(candidate.locator('#apply-draft-status')).toContainText('Draft saved');
    await candidate.reload();
    await expect(candidate.getByLabel('Why this role?')).toHaveValue('Synthetic answer, saved before submit.');
    await candidate.getByRole('button', { name: 'Submit questionnaire' }).click();
    await expect(candidate.getByText('You can close this page.')).toBeVisible();
    await capture(candidate, testInfo, 'private-receipt');

    const ready = {
      title: 'City Manager', employer: 'Synthetic Applicant City', location: 'Synthetic, AZ',
      compensation: '$180,000 to $210,000', summary: 'Synthetic posting.',
      responsibilities: 'Run the synthetic city.', qualifications: 'Executive experience.',
      applicationInstructions: 'Answer the question. No documents required.', privacyNotice: 'Synthetic privacy notice.',
      supportEmail: 'recruitment@example.gov', supportHours: 'Weekdays 8am-5pm Arizona time',
      deadline: { kind: 'open', firstReviewOn: '2026-12-01', timezone: 'America/Phoenix' },
      questions: [{ prompt: 'Why this city?', required: true }], materials: []
    };
    await ok(await staff.request.put('/api/searches/' + search.id + '/posting', {
      headers: { 'if-match': await revision(staff, search.id) }, data: ready
    }));
    const published = await ok(await staff.request.post('/api/searches/' + search.id + '/posting/publish', {
      headers: { 'if-match': await revision(staff, search.id) }
    }));
    const publicPath = new URL(published.publicUrl).pathname;
    await candidate.goto(publicPath);
    await expect(candidate.getByRole('link', { name: 'Apply for this position' })).toBeVisible();
    await capture(candidate, testInfo, 'public-posting');
    let code;
    candidate.on('response', async response => {
      if (response.url().includes('/api/applications/verify/start')) {
        const body = await response.json().catch(() => ({}));
        code = /(\d{6})/.exec(body.testMessage || '')?.[1] || code;
      }
    });
    await candidate.getByRole('link', { name: 'Apply for this position' }).click();
    await candidate.getByLabel('Email address').fill('synthetic-' + tag + '@example.test');
    await candidate.getByRole('button', { name: 'Send me a code' }).click();
    await expect(candidate.getByLabel('Six-digit code')).toBeVisible();
    expect(code).toBeTruthy();
    await candidate.getByLabel('Six-digit code').fill(code);
    await candidate.getByRole('button', { name: 'Verify and continue' }).click();
    await candidate.getByRole('button', { name: 'Start my application' }).click();
    await candidate.getByLabel('Full name').fill('Synthetic Applicant');
    await candidate.getByLabel('Why this city?').fill('Synthetic local government work.');
    await candidate.getByRole('button', { name: 'Save draft' }).click();
    await expect(candidate.getByText(/Draft saved/)).toBeVisible();
    await candidate.reload();
    await expect(candidate.getByLabel('Full name')).toHaveValue('Synthetic Applicant');
    await capture(candidate, testInfo, 'application-draft');
    await candidate.getByRole('button', { name: 'Review and submit' }).click();
    await expect(candidate.getByRole('heading', { name: 'Review your application' })).toBeVisible();
    await candidate.getByRole('button', { name: 'Submit application' }).click();
    await expect(candidate.getByRole('heading', { name: 'Application received' })).toBeVisible();
    await capture(candidate, testInfo, 'application-receipt');
    await candidate.reload();
    await expect(candidate.getByRole('heading', { name: 'Your application' })).toBeVisible();
  } finally { await Promise.all([staffContext.close(), candidateContext.close()]); }
});
