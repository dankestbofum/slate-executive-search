'use strict';

// Browser coverage for the recruiting redesign in
// docs/design-audit/RECRUITING_REDESIGN_PLAN.md.
//
// Behaviour a consultant would notice, not the shape of the source: the
// pipeline counts are the way into the list, the counts do not move under
// them, a candidate's sections hold on to unsaved work, a destination with
// nothing behind it is not offered, and Home draws itself from the index
// rather than by opening every file.

const { test, expect } = require('@playwright/test');
const { installClerk } = require('./clerk');

// Every test here works as a signed-in consultant. The session is a real one
// as far as the server is concerned; only Clerk's own script is stubbed.
test.beforeEach(async ({ page }) => { await installClerk(page); });

async function workspace(page) {
  await page.goto('/');
  await page.waitForLoadState('networkidle');
  await expect(page.getByRole('button', { name: /open a new search/i }).first()).toBeVisible({ timeout: 10000 });
}

async function makeSearch(page, data) {
  return (await page.request.post('/api/searches', { data })).json();
}
async function revision(page, id) {
  return String((await (await page.request.get('/api/searches/' + id)).json()).revision);
}
async function addCandidate(page, id, data) {
  return (await page.request.post('/api/searches/' + id + '/candidates', {
    headers: { 'if-match': await revision(page, id) }, data
  })).json();
}
async function setStage(page, id, candidateId, stage) {
  return page.request.patch('/api/searches/' + id + '/candidates/' + candidateId, {
    headers: { 'if-match': await revision(page, id) }, data: { stage }
  });
}

test('a stage count on the overview opens the list showing exactly that stage', async ({ page }) => {
  await workspace(page);
  const search = await makeSearch(page, { client: 'Pipeline City', position: 'City Manager', package: 'executive' });
  for (const name of ['Ada Baker', 'Bo Chen', 'Cyd Dunne', 'Dev Ellis']) await addCandidate(page, search.id, { name });
  const loaded = await (await page.request.get('/api/searches/' + search.id)).json();
  await setStage(page, search.id, loaded.candidates[0].id, 'semifinalist');
  await setStage(page, search.id, loaded.candidates[1].id, 'semifinalist');
  await setStage(page, search.id, loaded.candidates[2].id, 'declined');

  await page.goto('/#/s/' + search.id);
  const semis = page.locator('.stagebar__i--semifinalist').first();
  await expect(semis).toBeVisible({ timeout: 10000 });
  await expect(semis.locator('.stagebar__n')).toHaveText('2');

  await semis.click();
  await page.waitForURL(/\/screen$/);
  // The number that was clicked is the number of rows that arrive.
  await expect(page.locator('.candtable tbody tr')).toHaveCount(2);
  await expect(page.locator('.listcount')).toContainText('Showing 2 of 4');
  await expect(page.locator('.stagebar__i--semifinalist')).toHaveAttribute('aria-pressed', 'true');
});

test('stage counts are taken before the stage is selected, so they do not move', async ({ page }) => {
  await workspace(page);
  const search = await makeSearch(page, { client: 'Steady City', position: 'City Manager', package: 'executive' });
  for (const name of ['Ada Baker', 'Bo Chen', 'Cyd Dunne']) await addCandidate(page, search.id, { name });
  const loaded = await (await page.request.get('/api/searches/' + search.id)).json();
  await setStage(page, search.id, loaded.candidates[0].id, 'finalist');

  await page.goto('/#/s/' + search.id + '/screen');
  await expect(page.locator('.candtable tbody tr')).toHaveCount(3, { timeout: 10000 });

  const applicants = page.locator('.stagebar__i--applicant .stagebar__n');
  const finalists = page.locator('.stagebar__i--finalist .stagebar__n');
  await expect(applicants).toHaveText('2');
  await expect(finalists).toHaveText('1');

  // Selecting a stage narrows the rows and leaves every count alone.
  await page.locator('.stagebar__i--finalist').click();
  await expect(page.locator('.candtable tbody tr')).toHaveCount(1);
  await expect(applicants).toHaveText('2');
  await expect(finalists).toHaveText('1');

  // The text filter is what the counts are calculated inside, so it does move them.
  await page.locator('#cand-filter').fill('Ada');
  await expect(applicants).toHaveText('0');
  await expect(finalists).toHaveText('1');
});

test('switching candidate sections keeps unsaved scores and an unsaved note', async ({ page }) => {
  await workspace(page);
  const search = await makeSearch(page, { client: 'Section City', position: 'City Manager', package: 'executive' });
  await page.request.put('/api/searches/' + search.id + '/profile', {
    headers: { 'if-match': await revision(page, search.id) },
    data: { criteria: [{ id: 'S1', kind: 'skill', label: 'Budget repair', weight: 3, note: '' }] }
  });
  const added = await addCandidate(page, search.id, { name: 'Pat Quinn' });
  const candidate = added.candidates[0];

  await page.goto('/#/s/' + search.id + '/person/' + candidate.id);
  await expect(page.locator('#cnote')).toBeVisible({ timeout: 10000 });
  await page.locator('[data-score="S1"][data-val="4"]').click();
  await page.locator('#cnote').fill('Strong on the budget question.');

  await page.getByRole('tab', { name: 'Details' }).click();
  await expect(page.getByRole('tab', { name: 'Details' })).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator('#panel-person-review')).toBeHidden();

  await page.getByRole('tab', { name: 'Review' }).click();
  // Nothing was re-rendered away: the rating and the half-written note are
  // exactly as they were left.
  await expect(page.locator('[data-score="S1"][data-val="4"]')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('#cnote')).toHaveValue('Strong on the budget question.');

  await page.getByRole('button', { name: 'Save my scores' }).click();
  await expect(page.locator('#toast')).toContainText(/on the file/i);
  const after = await (await page.request.get('/api/searches/' + search.id)).json();
  expect(Object.values(Object.values(after.scores || {})[0] || {})[0]).toMatchObject({ S1: 4 });
});

test('the candidate sections are reachable with the keyboard alone', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop-chrome', 'arrow-key tab behaviour is a keyboard concern');
  await workspace(page);
  const search = await makeSearch(page, { client: 'Keyed City', position: 'City Manager', package: 'executive' });
  const added = await addCandidate(page, search.id, { name: 'Pat Quinn' });

  await page.goto('/#/s/' + search.id + '/person/' + added.candidates[0].id);
  const review = page.getByRole('tab', { name: 'Review' });
  await expect(review).toBeVisible({ timeout: 10000 });
  await review.focus();
  await page.keyboard.press('ArrowRight');
  await expect(page.getByRole('tab', { name: 'Details' })).toBeFocused();
  await expect(page.locator('#panel-person-details')).toBeVisible();
  await page.keyboard.press('ArrowLeft');
  await expect(review).toBeFocused();
  await expect(page.locator('#panel-person-review')).toBeVisible();
});

test('a destination with nothing behind it is not offered, and its link lands on the search', async ({ page }) => {
  await workspace(page);
  const basic = await makeSearch(page, { client: 'Slim City', position: 'City Manager', package: 'basic' });

  await page.goto('/#/s/' + basic.id);
  await expect(page.locator('#main h1')).toBeVisible({ timeout: 10000 });
  // Basic runs no video interviews, no interview guide and no finalist week,
  // so Interviews is not drawn at all.
  await expect(page.locator('.rail__link--dest', { hasText: 'Interviews' })).toHaveCount(0);
  await expect(page.locator('.rail__link--dest', { hasText: 'Candidates' })).toHaveCount(1);

  await page.goto('/#/s/' + basic.id + '/interviews');
  await expect(page.locator('#main h1')).toBeVisible({ timeout: 10000 });
  await expect(page).toHaveURL(/#\/s\/[^/]+$/);
  await expect(page.locator('#toast')).toContainText(/nothing on this search/i);

  // An address this build cannot render is not painted under someone else's
  // URL either.
  await page.goto('/#/s/' + basic.id + '/not-a-screen');
  await expect(page.locator('#main h1')).toBeVisible({ timeout: 10000 });
  await expect(page).toHaveURL(/#\/s\/[^/]+$/);
});

test('the destinations reach every included step, and the checklist keeps the rest', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop-chrome', 'below the breakpoint the rail is a drawer, covered in reflow.spec');
  await workspace(page);
  const search = await makeSearch(page, { client: 'Whole City', position: 'City Manager', package: 'executive' });

  await page.goto('/#/s/' + search.id + '/process');
  await expect(page.locator('#main h1')).toContainText('Process checklist', { timeout: 10000 });
  // Every step on an Executive file is listed, none of them dropped by the
  // move out of the rail.
  await expect(page.locator('.step')).toHaveCount(19);

  for (const [label, hash] of [['Candidates', '/screen'], ['Interviews', '/interviews'],
    ['Committee', '/committee'], ['Documents', '/documents'], ['Activity', '/activity']]) {
    await page.goto('/#/s/' + search.id);
    await page.locator('.rail__link--dest', { hasText: label }).click();
    await expect(page).toHaveURL(new RegExp(hash.replace('/', '\\/') + '$'));
    await expect(page.locator('.rail__link--dest[aria-current="page"]')).toContainText(label);
  }
});

test('Home renders the portfolio from the index alone', async ({ page }, testInfo) => {
  await workspace(page);
  const tag = testInfo.project.name;
  const search = await makeSearch(page, { client: 'Counted City ' + tag, position: 'City Manager', package: 'executive' });
  for (const name of ['Ada Baker', 'Bo Chen']) await addCandidate(page, search.id, { name });

  const perSearch = [];
  page.on('request', r => {
    if (/^\/api\/searches\/[^/]+$/.test(new URL(r.url()).pathname)) perSearch.push(r.url());
  });

  await page.goto('/#/home');
  const row = page.locator('.hometable tbody tr').filter({ hasText: 'Counted City ' + tag });
  await expect(row).toHaveCount(1, { timeout: 10000 });
  await expect(row.locator('td').nth(1)).toContainText('2');
  // The count came from the index; Home does not open every file to draw itself.
  expect(perSearch, 'Home fetched whole searches to render the list').toHaveLength(0);

  // A local filter narrows the same list and offers a way back.
  await page.locator('#home-filter').fill('Counted City ' + tag);
  await expect(page.locator('.hometable tbody tr')).toHaveCount(1);
  await page.getByRole('button', { name: 'Clear filter' }).first().click();
  await expect(page.locator('#home-filter')).toHaveValue('');
});

test('a deadline is shown only where a stored date supports it', async ({ page }, testInfo) => {
  await workspace(page);
  const tag = testInfo.project.name;
  const dated = await makeSearch(page, { client: 'Deadline City ' + tag, position: 'City Manager', package: 'executive' });
  const undated = await makeSearch(page, { client: 'Silent City ' + tag, position: 'City Manager', package: 'executive' });
  await page.request.post('/api/searches/' + dated.id + '/team/confirm', {
    headers: { 'if-match': await revision(page, dated.id) }, data: { confirmed: true }
  });
  await page.request.post('/api/searches/' + dated.id + '/intake/status', {
    headers: { 'if-match': await revision(page, dated.id) }, data: { status: 'open', dueBy: '19 Sep 2026' }
  });

  await page.goto('/#/home');
  const datedRow = page.locator('.hometable tbody tr').filter({ hasText: 'Deadline City ' + tag });
  await expect(datedRow).toContainText('Committee intake due 19 Sep 2026', { timeout: 10000 });
  // The date is labelled by what it is. Nothing invents one where the record
  // has none, and nothing calls a date overdue.
  const undatedRow = page.locator('.hometable tbody tr').filter({ hasText: 'Silent City ' + tag });
  await expect(undatedRow).not.toContainText('due');
  await expect(page.locator('.hometable')).not.toContainText(/overdue/i);
});
