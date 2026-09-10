'use strict';

// Browser coverage for the interface work in docs/design-audit.
//
// These check behaviour a person would notice, not the shape of the source:
// where the heading lands on a phone, whether a search someone just created is
// on Home, whether Back recovers the list they were looking at, and whether a
// consultant can write a questionnaire without AI or raw JSON.

const { test, expect } = require('@playwright/test');

async function workspace(page) {
  await page.goto('/');
  await page.waitForLoadState('networkidle');
  await page.getByRole('button', { name: 'Start', exact: true }).first().click();
  await expect(page.getByRole('button', { name: /open a new search/i }).first()).toBeVisible({ timeout: 10000 });
}

// Set a search up through the API on the page's own session, so a test about
// one screen does not have to walk every screen that leads to it.
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

test('a search created in this session is on Home straight away', async ({ page }, testInfo) => {
  await workspace(page);
  // The two projects share one store, so the name has to be unique per run.
  const client = 'Freshly Made City ' + testInfo.project.name;
  await page.getByRole('button', { name: /open a new search/i }).first().click();
  await page.locator('#newsearch [name="client"]').fill(client);
  await page.locator('#newsearch [name="position"]').fill('City Manager');
  await page.getByRole('button', { name: /create search/i }).click();
  await page.waitForURL(/#\/s\/[^/]+\/team/, { timeout: 10000 });

  // Home without a reload. The audit's D03 was that this list was not
  // refetched, so the search someone had just opened was missing from it.
  await page.locator('#crumbs button', { hasText: 'Home' }).click();
  await page.waitForURL(/#\/home/);
  await expect(page.locator('.hometable tbody tr').filter({ hasText: client })).toHaveCount(1);
});

test('the heading and the first action are reachable without scrolling past navigation', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'mobile-chrome', 'this is about the small-screen shell');
  await workspace(page);
  const search = await makeSearch(page, { client: 'Narrow City', position: 'City Manager', package: 'executive' });

  await page.goto('/#/s/' + search.id + '/screen');
  await expect(page.locator('#main h1')).toBeVisible({ timeout: 10000 });

  const top = await page.evaluate(() =>
    Math.round(document.querySelector('#main h1').getBoundingClientRect().top + window.scrollY));
  expect(top, 'the page heading is pushed below the first screen by navigation').toBeLessThan(400);

  const sideways = await page.evaluate(() =>
    document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(sideways, 'the workspace scrolls sideways on a phone').toBeLessThanOrEqual(1);
});

test('the navigation drawer closes with Escape and gives focus back', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'mobile-chrome', 'the drawer only exists below the breakpoint');
  await workspace(page);

  const menu = page.getByRole('button', { name: 'Menu', exact: true });
  await expect(menu).toBeVisible();
  await expect(page.locator('.rail')).toBeHidden();

  await menu.click();
  await expect(page.locator('.rail')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('.rail')).toBeHidden();
  await expect(menu).toBeFocused();
});

test('switching theme never writes aria-pressed onto the document element', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop-chrome', 'one pass over the theme controls is enough');
  await workspace(page);

  for (const theme of ['dark', 'light', 'auto', 'dark']) {
    await page.locator('button[data-theme="' + theme + '"]').click();
    const strayAttribute = await page.evaluate(() => document.documentElement.getAttribute('aria-pressed'));
    expect(strayAttribute, 'aria-pressed is not valid on <html> and outlived the theme change').toBeNull();
    const pressed = await page.locator('button[data-theme][aria-pressed="true"]').count();
    expect(pressed, 'exactly one theme control should read as selected').toBe(1);
  }
});

test('a step opened by link survives a reload and browser Back returns to it', async ({ page }) => {
  await workspace(page);
  const search = await makeSearch(page, { client: 'Linkable County', position: 'County Administrator', jurisdictionType: 'county' });

  await page.goto('/#/s/' + search.id + '/profile');
  await expect(page.locator('#main h1')).toContainText('Candidate profile', { timeout: 10000 });

  await page.reload();
  await page.waitForLoadState('networkidle');
  await expect(page.locator('#main h1')).toContainText('Candidate profile', { timeout: 10000 });
  expect(page.url()).toContain('/profile');

  await page.locator('#crumbs button', { hasText: 'Linkable County' }).click();
  await page.waitForURL(/#\/s\/[^/]+$/);
  await page.goBack();
  await expect(page.locator('#main h1')).toContainText('Candidate profile');
});

test('Back from a candidate returns to the filtered list', async ({ page }) => {
  await workspace(page);
  const search = await makeSearch(page, { client: 'Return City', position: 'City Manager', package: 'executive' });
  for (const name of ['Ada Baker', 'Bo Chen', 'Cyd Dunne']) await addCandidate(page, search.id, { name });

  await page.goto('/#/s/' + search.id + '/screen');
  await expect(page.locator('.candtable tbody tr')).toHaveCount(3, { timeout: 10000 });

  await page.locator('#cand-filter').fill('Bo');
  await expect(page.locator('.candtable tbody tr')).toHaveCount(1);

  await page.locator('.candtable tbody tr').first().getByRole('button', { name: 'Review' }).click();
  await page.waitForURL(/\/person\//);
  await expect(page.locator('#main h1')).toContainText('Bo Chen');

  await page.locator('.backlink').click();
  await page.waitForURL(/\/screen$/);
  // The list context is what they left it as, not a reset list.
  await expect(page.locator('#cand-filter')).toHaveValue('Bo');
  await expect(page.locator('.candtable tbody tr')).toHaveCount(1);
});

test('cancelling Back with unsaved edits keeps the screen and every value', async ({ page }) => {
  await workspace(page);
  const search = await makeSearch(page, { client: 'Careful City', position: 'City Manager', package: 'executive' });

  await page.goto('/#/s/' + search.id);
  await expect(page.locator('#main h1')).toBeVisible({ timeout: 10000 });
  await page.goto('/#/s/' + search.id + '/facts');
  await expect(page.locator('#facts')).toBeVisible({ timeout: 10000 });

  await page.locator('#facts [name="population"]').fill('44,000 and counting');
  const url = page.url();

  page.once('dialog', d => d.dismiss());
  await page.locator('.backlink').click();
  await page.waitForTimeout(400);

  expect(page.url()).toBe(url);
  await expect(page.locator('#facts [name="population"]')).toHaveValue('44,000 and counting');
});

test('the screening list offers invitation actions instead of a raw link column', async ({ page }) => {
  await workspace(page);
  const search = await makeSearch(page, { client: 'Invite City', position: 'City Manager', package: 'executive' });
  const withCandidate = await addCandidate(page, search.id, { name: 'Pat Quinn' });
  const invite = withCandidate.candidates[0].invite;

  await page.goto('/#/s/' + search.id + '/screen');
  await expect(page.locator('.candtable tbody tr')).toHaveCount(1, { timeout: 10000 });

  // Handing out a link is an occasional action, so it lives in a labelled menu
  // on the row rather than beside Review. The row itself still never carries
  // the raw URL as data.
  const rowText = await page.locator('.candtable tbody').innerText();
  expect(rowText, 'the raw invitation URL is back in the table').not.toContain('/apply/' + invite);

  await page.locator('.candacts').getByRole('button', { name: 'Invite', exact: true }).first().click();
  await expect(page.getByRole('button', { name: 'Copy invite link' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Open questionnaire' })).toHaveAttribute('href', '/apply/' + invite);
});

test('a consultant can write a questionnaire without AI or raw JSON', async ({ page }) => {
  await workspace(page);
  const search = await makeSearch(page, { client: 'Handwritten City', position: 'City Manager', package: 'executive' });

  await page.goto('/#/s/' + search.id + '/survey1');
  await expect(page.locator('#main h1')).toBeVisible({ timeout: 10000 });
  // No API key is configured for these runs, so drafting must not be the only
  // way to create a questionnaire.
  await expect(page.getByRole('button', { name: /draft with claude/i }).first()).toBeDisabled();

  await page.getByRole('button', { name: 'Add a question' }).first().click();
  await page.locator('[data-path="questions.0.prompt"]').fill('Describe a budget you turned around.');
  await page.locator('[data-path="questions.0.required"]').check();
  await page.getByRole('button', { name: 'Add a question' }).first().click();
  await page.locator('[data-path="questions.1.prompt"]').fill('What would your first ninety days look like?');

  // Preview shows the unsaved edits, and Edit still has them afterwards.
  await page.getByRole('button', { name: 'Preview', exact: true }).click();
  await expect(page.locator('#main')).toContainText('budget you turned around');
  await page.getByRole('button', { name: 'Edit', exact: true }).click();
  await expect(page.locator('[data-path="questions.0.prompt"]')).toHaveValue('Describe a budget you turned around.');
  await expect(page.locator('[data-path="questions.0.required"]')).toBeChecked();

  await page.getByRole('button', { name: 'Save edits' }).click();
  await expect(page.locator('.docbar')).toContainText('Saved draft', { timeout: 10000 });

  const saved = await (await page.request.get('/api/searches/' + search.id)).json();
  expect(saved.artifacts.survey1.questions.map(q => q.prompt)).toEqual([
    'Describe a budget you turned around.',
    'What would your first ninety days look like?'
  ]);
  expect(saved.artifacts.survey1.questions[0].required).toBe(true);
});

test('unsaved scores cannot vanish into a stage change', async ({ page }) => {
  await workspace(page);
  const search = await makeSearch(page, { client: 'Scored City', position: 'City Manager', package: 'executive' });
  await page.request.put('/api/searches/' + search.id + '/profile', {
    headers: { 'if-match': await revision(page, search.id) },
    data: { criteria: [
      { id: 'S1', kind: 'skill', label: 'Financial management', weight: 5, note: '' },
      { id: 'S2', kind: 'skill', label: 'Council relations', weight: 4, note: '' },
      { id: 'S3', kind: 'skill', label: 'Staff leadership', weight: 3, note: '' }
    ] }
  });
  const withCandidate = await addCandidate(page, search.id, { name: 'Robin Vale' });

  await page.goto('/#/s/' + search.id + '/person/' + withCandidate.candidates[0].id);
  await expect(page.locator('#main h1')).toContainText('Robin Vale', { timeout: 10000 });

  await page.locator('[data-score="S1"][data-val="4"]').click();
  await expect(page.locator('.actionbar__state')).toContainText('Unsaved');

  page.once('dialog', d => d.accept());
  await page.getByRole('button', { name: /advance to semifinalist/i }).click();
  await expect(page.locator('#main h1')).toContainText('Robin Vale', { timeout: 10000 });

  // The rating survived the stage change rather than being discarded with it.
  const after = await (await page.request.get('/api/searches/' + search.id)).json();
  const mine = Object.values(after.scores || {})[0] || {};
  expect(Object.values(mine)[0]).toMatchObject({ S1: 4 });
});

test('hover text is available on focus and dismissed with Escape', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop-chrome', 'hover and focus behaviour is a pointer concern');
  await workspace(page);
  const search = await makeSearch(page, { client: 'Explained City', position: 'City Manager', package: 'executive' });
  await addCandidate(page, search.id, { name: 'Sam Ellis' });

  await page.goto('/#/s/' + search.id + '/screen');
  await page.locator('.candacts').getByRole('button', { name: 'Invite', exact: true }).first().click();
  const copy = page.getByRole('button', { name: 'Copy invite link' }).first();
  await expect(copy).toBeVisible({ timeout: 10000 });

  await copy.focus();
  const described = await copy.getAttribute('aria-describedby');
  expect(described, 'the control has no description to announce').toBeTruthy();
  const tip = page.locator('#' + described);
  await expect(tip).toBeVisible();
  await expect(tip).toContainText('questionnaire link');

  // The control keeps its own name; the description does not replace it.
  await expect(copy).toHaveAccessibleName('Copy invite link');

  // Escape dismisses the description without activating the control.
  await page.keyboard.press('Escape');
  await expect(tip).toBeHidden();
  expect(page.url()).toContain('/screen');

  // The description stays inside the viewport.
  await copy.hover();
  await expect(tip).toBeVisible();
  const inside = await tip.evaluate(el => {
    const r = el.getBoundingClientRect();
    return r.left >= 0 && r.right <= window.innerWidth;
  });
  expect(inside, 'the description runs off the edge of the viewport').toBe(true);
});

test('the candidate questionnaire states how many questions there are', async ({ page }) => {
  await workspace(page);
  const search = await makeSearch(page, { client: 'Counted County', position: 'County Administrator', jurisdictionType: 'county' });
  await page.request.put('/api/searches/' + search.id + '/artifact/survey1', {
    headers: { 'if-match': await revision(page, search.id) },
    data: { body: { intro: 'Tell us about your work.', questions: [
      { n: 1, prompt: 'Describe a budget you turned around.', required: true },
      { n: 2, prompt: 'What would your first ninety days look like?', required: false }
    ] } }
  });
  const withCandidate = await addCandidate(page, search.id, { name: 'Alex Reed' });

  await page.goto('/apply/' + withCandidate.candidates[0].invite);
  await page.waitForLoadState('networkidle');

  await expect(page.locator('.applymeta')).toContainText('2 questions', { timeout: 10000 });
  await expect(page.locator('#applycount')).toHaveText('0 of 2 answered');

  // Help is reachable from the introduction, not only from the bottom.
  await page.getByRole('button', { name: /need help or an accommodation/i }).click();
  await expect(page.locator('#apply-help')).toBeFocused();

  await page.locator('textarea').first().fill('I closed a structural deficit over two budgets.');
  await expect(page.locator('#applycount')).toHaveText('1 of 2 answered');
});
