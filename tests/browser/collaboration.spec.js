'use strict';

/**
 * Two people working one search at the same time.
 *
 * Acceptance evidence for docs/audits/2026-09-22-pilot-walkthrough (P1, stale
 * committee views): a committee member's open tab showed "No candidates yet"
 * after the manager added a candidate and the candidate submitted, until the
 * browser was reloaded. Moving within the search now reads it again, keeps
 * what was on screen when that read fails, and says so.
 */

const { test, expect } = require('@playwright/test');
const { installClerk, joinWorkspace, authHeaders } = require('./clerk');

async function revision(page, id) {
  return String((await (await page.request.get('/api/searches/' + id)).json()).revision);
}

async function ok(response) {
  expect(response.ok(), await response.text()).toBe(true);
  return response.json();
}

/** A search with an adopted profile and one committee member signed in. */
async function scoringSearch(browser, testInfo) {
  const managerContext = await browser.newContext();
  const manager = await managerContext.newPage();
  await installClerk(manager, { email: 'abe@slate.local' });
  const tag = testInfo.project.name + '-' + Date.now().toString(36);
  const search = await ok(await manager.request.post('/api/searches', {
    data: { client: 'Collaboration City ' + tag, position: 'City Manager', package: 'executive' }
  }));
  const email = 'reviewer-' + tag + '@example.test';
  await joinWorkspace(email);
  await ok(await manager.request.post('/api/me/onboarding', {
    headers: authHeaders(email, null), data: { name: 'Open Tab Reviewer', requestedRole: 'committee' }
  }));
  const write = async (method, suffix, data) => ok(await manager.request[method]('/api/searches/' + search.id + suffix, {
    headers: { 'if-match': await revision(manager, search.id) }, data
  }));
  await write('post', '/members', { name: 'Open Tab Reviewer', email, searchRole: 'committee' });
  await write('post', '/team/confirm', { confirmed: true });
  await write('post', '/intake/status', { status: 'open', dueBy: '30 Sep 2026' });
  await write('post', '/intake/status', { status: 'closed', emptyReason: 'Synthetic test: profile set by the manager.' });
  await write('put', '/profile', {
    criteria: [{ id: 'S1', kind: 'skill', label: 'Public budgeting', weight: 5, note: 'Synthetic criterion' }]
  });
  await write('put', '/artifact/survey1', {
    body: { intro: 'Synthetic questionnaire', questions: [{ n: 1, prompt: 'Describe your public budgeting work.', required: true, crit: ['S1'] }] }
  });
  const reviewerContext = await browser.newContext();
  const reviewer = await reviewerContext.newPage();
  await installClerk(reviewer, { email });
  const close = () => Promise.all([managerContext.close(), reviewerContext.close()]);
  return { search, manager, reviewer, write, close };
}

/** The manager adds a candidate and the candidate submits, in their own tab. */
async function candidateSubmits(browser, write, name) {
  const withCandidate = await write('post', '/candidates', { name });
  const person = withCandidate.candidates.find(c => c.name === name);
  const context = await browser.newContext();
  try {
    const page = await context.newPage();
    await page.goto('/apply/' + person.invite);
    await page.getByLabel('Describe your public budgeting work.').fill('Synthetic budget response from ' + name + '.');
    await page.getByRole('button', { name: 'Submit questionnaire' }).click();
    await expect(page.getByText('You can close this page.')).toBeVisible();
  } finally { await context.close(); }
  return person;
}

async function openCandidates(page, testInfo) {
  if (testInfo.project.name === 'mobile-chrome') await page.getByRole('button', { name: 'Menu', exact: true }).click();
  await page.locator('.rail__link--dest').filter({ hasText: 'Candidates' }).click();
}

test('an open committee tab sees a candidate added and submitted elsewhere without reloading', async ({ browser }, testInfo) => {
  const { search, reviewer, write, close } = await scoringSearch(browser, testInfo);
  try {
    await reviewer.goto('/#/s/' + search.id + '/overview');
    await expect(reviewer.locator('#main')).toContainText('Collaboration City');
    // Everything below happens in other tabs while this one stays open.
    const person = await candidateSubmits(browser, write, 'Current Candidate');
    await openCandidates(reviewer, testInfo);
    await expect(reviewer.locator('.candtable')).toContainText('Current Candidate');
    await reviewer.locator('.candtable tbody tr', { hasText: 'Current Candidate' })
      .getByRole('button', { name: 'Review', exact: true }).click();
    await expect(reviewer.locator('#main h1')).toContainText('Current Candidate');
    if (testInfo.project.name === 'mobile-chrome') {
      // Scores are tapped repeatedly in a panel session: finger-sized targets.
      const box = await reviewer.locator('[data-score="S1"][data-val="4"]').boundingBox();
      expect(box.width).toBeGreaterThanOrEqual(44);
      expect(box.height).toBeGreaterThanOrEqual(44);
      expect(await reviewer.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    }
    await reviewer.locator('[data-score="S1"][data-val="4"]').click();
    await reviewer.getByRole('button', { name: 'Save my scores', exact: true }).click();
    await expect(reviewer.locator('#toast')).toContainText(/on the file/i);
    const stored = await (await reviewer.request.get('/api/searches/' + search.id)).json();
    expect(Object.values(stored.scores || {}).some(byCandidate => byCandidate[person.id]?.S1 === 4)).toBe(true);
    // Sealed until the manager releases scores.
    expect(stored.released).toBeFalsy();
  } finally { await close(); }
});

test('a failed refresh keeps the last list and offers a retry instead of an empty screen', async ({ browser }, testInfo) => {
  const { search, reviewer, write, close } = await scoringSearch(browser, testInfo);
  try {
    await candidateSubmits(browser, write, 'Known Candidate');
    await reviewer.goto('/#/s/' + search.id + '/overview');
    await expect(reviewer.locator('#main')).toContainText('Collaboration City');
    await candidateSubmits(browser, write, 'Later Candidate');
    const searchRead = new RegExp('/api/searches/' + search.id + '$');
    await reviewer.route(searchRead, route => route.fulfill({
      status: 503, contentType: 'application/json', body: JSON.stringify({ error: 'The server is busy.' })
    }));
    await openCandidates(reviewer, testInfo);
    await expect(reviewer.getByText('This search may be out of date')).toBeVisible();
    await expect(reviewer.locator('.candtable')).toContainText('Known Candidate');
    await expect(reviewer.locator('.candtable')).not.toContainText('Later Candidate');
    await reviewer.unroute(searchRead);
    await reviewer.getByRole('button', { name: 'Try again' }).click();
    await expect(reviewer.getByText('This search may be out of date')).toHaveCount(0);
    await expect(reviewer.locator('.candtable')).toContainText('Later Candidate');
  } finally { await close(); }
});

test('a slow refresh never paints over the screen the member moved on to', async ({ browser }, testInfo) => {
  const { search, reviewer, write, close } = await scoringSearch(browser, testInfo);
  try {
    await reviewer.goto('/#/s/' + search.id + '/overview');
    await expect(reviewer.locator('#main')).toContainText('Collaboration City');
    await candidateSubmits(browser, write, 'Slow Candidate');
    const searchRead = new RegExp('/api/searches/' + search.id + '$');
    let release;
    const held = new Promise(resolve => { release = resolve; });
    let first = true;
    await reviewer.route(searchRead, async route => {
      if (first) { first = false; await held; }
      await route.continue();
    });
    // The first move stalls; the second is answered and lands.
    await openCandidates(reviewer, testInfo);
    await reviewer.evaluate(id => { location.hash = '#/s/' + id + '/profile'; }, search.id);
    await expect(reviewer.locator('#main h1')).toHaveText('Adopted candidate profile');
    release();
    await reviewer.waitForTimeout(500);
    await expect(reviewer.locator('#main h1')).toHaveText('Adopted candidate profile');
    await reviewer.unroute(searchRead);
  } finally { await close(); }
});
