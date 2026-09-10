'use strict';

// The parts of the plan's verification matrix a browser can settle on its own:
// narrow reflow, tablet width, a lot of records, deep links to steps a package
// or a role does not include, and what a committee member is shown.
//
// It does not settle real device behaviour or screen-reader usability. Those
// need a phone in someone's hand and a person listening.

const { test, expect } = require('@playwright/test');

async function workspace(page) {
  await page.goto('/');
  await page.waitForLoadState('networkidle');
  await page.getByRole('button', { name: 'Start', exact: true }).first().click();
  await expect(page.getByRole('button', { name: /open a new search/i }).first()).toBeVisible({ timeout: 10000 });
}
async function makeSearch(page, data) {
  return (await page.request.post('/api/searches', { data })).json();
}
async function revision(page, id) {
  return String((await (await page.request.get('/api/searches/' + id)).json()).revision);
}

async function sidewaysOverflow(page) {
  return page.evaluate(() => {
    const doc = document.documentElement;
    const over = [];
    for (const el of document.querySelectorAll('#app *')) {
      const r = el.getBoundingClientRect();
      if (r.width && r.right > doc.clientWidth + 1) over.push(el.className || el.tagName);
    }
    return { page: doc.scrollWidth - doc.clientWidth, elements: [...new Set(over)].slice(0, 5) };
  });
}

test('populated screens reflow at 320px without sideways scrolling', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'mobile-chrome', 'one narrow pass is enough');
  await workspace(page);
  const search = await makeSearch(page, { client: 'Reflow City', position: 'City Manager', package: 'executive' });
  await page.request.put('/api/searches/' + search.id + '/profile', {
    headers: { 'if-match': await revision(page, search.id) },
    data: { criteria: Array.from({ length: 12 }, (_, i) => ({
      id: 'S' + (i + 1), kind: ['skill', 'trait', 'chall', 'opp'][i % 4],
      label: 'Criterion with a fairly long name number ' + (i + 1), weight: 3,
      note: 'Why this one matters to the governing body of this jurisdiction.'
    })) }
  });
  for (const name of ['Alexandra Featherstonehaugh-Wellington', 'Bo Li', 'Carmen Delgado-Ramirez']) {
    await page.request.post('/api/searches/' + search.id + '/candidates', {
      headers: { 'if-match': await revision(page, search.id) },
      data: { name, cur: 'Deputy City Manager for Administrative Services', org: 'City and County of Somewhere Rather Long' }
    });
  }

  await page.setViewportSize({ width: 320, height: 720 });
  for (const view of ['screen', 'profile', 'facts']) {
    await page.goto('/#/s/' + search.id + '/' + view);
    await expect(page.locator('#main h1')).toBeVisible({ timeout: 10000 });
    const overflow = await sidewaysOverflow(page);
    expect(overflow.page, view + ' scrolls sideways at 320px; widest: ' + overflow.elements.join(', ')).toBeLessThanOrEqual(1);
  }
});

test('twenty candidates stay readable and every row keeps its actions', async ({ page }) => {
  await workspace(page);
  const search = await makeSearch(page, { client: 'Crowded City', position: 'City Manager', package: 'executive' });
  for (let i = 0; i < 20; i += 1) {
    await page.request.post('/api/searches/' + search.id + '/candidates', {
      headers: { 'if-match': await revision(page, search.id) },
      data: { name: 'Candidate Number ' + String(i + 1).padStart(2, '0'), cur: 'Assistant City Manager', org: 'City of Elsewhere' }
    });
  }

  await page.goto('/#/s/' + search.id + '/screen');
  await expect(page.locator('.candtable tbody tr')).toHaveCount(20, { timeout: 10000 });
  await expect(page.getByRole('button', { name: 'Review' })).toHaveCount(20);

  const overflow = await sidewaysOverflow(page);
  expect(overflow.page, 'the candidate list scrolls the page sideways').toBeLessThanOrEqual(1);

  // Filtering is local, so twenty rows narrow to one without a round trip.
  await page.locator('#cand-filter').fill('Number 07');
  await expect(page.locator('.candtable tbody tr')).toHaveCount(1);
});

test('an empty search and a step outside the package both land somewhere useful', async ({ page }) => {
  await workspace(page);
  const basic = await makeSearch(page, { client: 'Basic City', position: 'City Manager', package: 'basic' });

  await page.goto('/#/s/' + basic.id + '/screen');
  await expect(page.locator('.emptystate')).toContainText('No candidates on the file yet', { timeout: 10000 });

  // A Basic search has no brochure. A link to it lands on the overview with
  // an explanation, not on a blank page.
  await page.goto('/#/s/' + basic.id + '/brochure');
  await expect(page.locator('#main h1')).toBeVisible({ timeout: 10000 });
  await expect(page).toHaveURL(/#\/s\/[^/]+$/);
  await expect(page.locator('#toast')).toContainText(/not part of the/i);

  // So does a link to a search that is not on the book.
  await page.goto('/#/s/sr-does-not-exist/team');
  await expect(page.locator('#main h1')).toContainText(/your searches/i, { timeout: 10000 });
  await expect(page).toHaveURL(/#\/home/);
});

test('a committee member is shown their own steps and nothing else', async ({ page, browser }) => {
  await workspace(page);
  const search = await makeSearch(page, { client: 'Seated City', position: 'City Manager', package: 'executive' });
  const email = 'committee-' + Date.now() + '@example.test';
  const seated = await page.request.post('/api/searches/' + search.id + '/members', {
    headers: { 'if-match': await revision(page, search.id) },
    data: { name: 'Casey Member', email, seat: 'committee' }
  });
  expect(seated.ok()).toBeTruthy();

  // Sign the seat in on its own context before the first page load, so the
  // deep link is the first navigation the app boots on.
  const context = await browser.newContext();
  const login = await context.request.post('/api/login', { data: { email } });
  expect(login.ok()).toBeTruthy();
  const member = await context.newPage();

  await member.goto('/#/s/' + search.id);
  await member.waitForLoadState('networkidle');
  await expect(member.locator('#main h1')).toBeVisible({ timeout: 10000 });

  // The rail carries the destinations they have work in, not the whole
  // workspace. Interviews and Documents are the firm's drafting surfaces, and
  // Search settings is an editing surface, so none of them are drawn at all.
  const menu = member.getByRole('button', { name: 'Menu', exact: true });
  if (await menu.isVisible().catch(() => false)) await menu.click();
  await expect(member.locator('.rail')).toBeVisible();
  await expect(member.locator('.rail__link', { hasText: 'Committee' })).toHaveCount(1);
  await expect(member.locator('.rail__link', { hasText: 'Interviews' })).toHaveCount(0);
  await expect(member.locator('.rail__link', { hasText: 'Documents' })).toHaveCount(0);
  await expect(member.locator('.rail__link', { hasText: 'Search settings' })).toHaveCount(0);

  // Their own questionnaire is still one move away, from the Committee hub.
  await member.locator('.rail__link', { hasText: 'Committee' }).click();
  await expect(member.locator('#main h1')).toContainText('Committee');
  await expect(member.getByRole('button', { name: /open the questionnaire|answer your questionnaire/i }).first()).toBeVisible();

  // And a link to a consultant's step lands on the overview, explained.
  await member.goto('/#/s/' + search.id + '/brochure');
  await expect(member.locator('#main h1')).toBeVisible({ timeout: 10000 });
  await expect(member).toHaveURL(/#\/s\/[^/]+$/);

  await context.close();
});

test('the workspace holds together at tablet width', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop-chrome', 'this resizes the viewport itself');
  await workspace(page);
  const search = await makeSearch(page, { client: 'Tablet City', position: 'City Manager', package: 'executive' });

  await page.setViewportSize({ width: 768, height: 1024 });
  await page.goto('/#/s/' + search.id + '/team');
  await expect(page.locator('#main h1')).toBeVisible({ timeout: 10000 });

  // Below the breakpoint the rail is a drawer, so the heading is near the top
  // rather than below a full-height menu.
  const top = await page.evaluate(() =>
    Math.round(document.querySelector('#main h1').getBoundingClientRect().top + window.scrollY));
  expect(top, 'the heading sits below a screenful of navigation at 768px').toBeLessThan(400);

  const overflow = await sidewaysOverflow(page);
  expect(overflow.page, 'the workspace scrolls sideways at 768px').toBeLessThanOrEqual(1);

  await page.setViewportSize({ width: 1280, height: 720 });
});
