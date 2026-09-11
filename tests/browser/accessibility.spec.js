'use strict';

// Automated accessibility checks against WCAG 2.1 AA.
//
// Two honest limits on what this proves:
//
//  - Automated scanning finds roughly a third of real accessibility problems.
//    Nothing here establishes that the app is usable with a screen reader; a
//    person has to try that, and DEP-12 asks for manual findings to be
//    recorded separately.
//  - The county's applicable standard and deadlines are an open decision
//    (docs/pilot-decisions.md). WCAG 2.1 AA is the working target, not a
//    confirmed obligation.
//
// The candidate questionnaire is the priority path: it is used by members of
// the public who did not choose this software and cannot ask for a workaround.

const { test, expect } = require('@playwright/test');
const AxeBuilder = require('@axe-core/playwright').default;
const { installClerk } = require('./clerk');

const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'];

function describeViolations(violations) {
  return violations.map(v =>
    v.id + ' [' + v.impact + '] ' + v.help
    + '\n      ' + v.nodes.slice(0, 3).map(n => n.target.join(' ')).join('\n      ')
  ).join('\n    ');
}

async function scan(page) {
  const results = await new AxeBuilder({ page }).withTags(TAGS).analyze();
  return results.violations;
}

// Theme controls live in the rail, which is a drawer below the breakpoint.
//
// Buttons animate their background over 120ms, so a scan started immediately
// after the switch measures a colour that is on its way from one palette to
// the other and reports contrast that never actually settles on screen.
async function setTheme(page, theme) {
  const menu = page.getByRole('button', { name: 'Menu', exact: true });
  const inDrawer = await menu.isVisible().catch(() => false);
  if (inDrawer) await menu.click();
  await page.locator('button[data-theme="' + theme + '"]').click();
  if (inDrawer) await page.keyboard.press('Escape');
  await page.waitForTimeout(300);
}

test('the landing page has no WCAG 2.1 AA violations', async ({ page }) => {
  await installClerk(page, { signedIn: false });
  await page.goto('/');
  await page.waitForLoadState('networkidle');
  const violations = await scan(page);
  expect(violations, '\n    ' + describeViolations(violations)).toEqual([]);
});

test('the signed-in workspace has no WCAG 2.1 AA violations', async ({ page }) => {
  await installClerk(page);
  await page.goto('/');
  await page.waitForLoadState('networkidle');
  await expect(page.getByRole('button', { name: /open a new search/i }).first()).toBeVisible();

  const violations = await scan(page);
  expect(violations, '\n    ' + describeViolations(violations)).toEqual([]);
});

test('the candidate questionnaire has no WCAG 2.1 AA violations', async ({ page }) => {
  await installClerk(page);

  const created = await (await page.request.post('/api/searches', {
    data: { client: 'Accessible County', position: 'County Administrator', jurisdictionType: 'county' }
  })).json();
  const revision = async () => String((await (await page.request.get('/api/searches/' + created.id)).json()).revision);

  await page.request.put('/api/searches/' + created.id + '/artifact/survey1', {
    headers: { 'if-match': await revision() },
    data: { body: { intro: 'Tell us about your experience.', questions: [
      { n: 1, prompt: 'Describe your county budget experience.', required: true },
      { n: 2, prompt: 'What would your first ninety days look like?', required: false }
    ] } }
  });
  const withCandidate = await (await page.request.post('/api/searches/' + created.id + '/candidates', {
    headers: { 'if-match': await revision() }, data: { name: 'Accessible Candidate' }
  })).json();

  await page.goto('/apply/' + withCandidate.candidates[0].invite);
  await page.waitForLoadState('networkidle');

  const violations = await scan(page);
  expect(violations, '\n    ' + describeViolations(violations)).toEqual([]);
});

test('the page still works at 200% zoom without horizontal scrolling', async ({ page }) => {
  await page.setViewportSize({ width: 640, height: 720 });
  await page.goto('/');
  await page.waitForLoadState('networkidle');

  const overflows = await page.evaluate(() =>
    document.documentElement.scrollWidth > document.documentElement.clientWidth + 1);
  expect(overflows, 'the page scrolls sideways at a narrow width, which breaks reflow at 200% zoom').toBe(false);
});

test('the document declares a language and names the screen in one heading', async ({ page }) => {
  await installClerk(page);
  await page.goto('/');
  await page.waitForLoadState('networkidle');

  const lang = await page.evaluate(() => document.documentElement.lang);
  expect(lang, 'the document has no lang attribute, so a screen reader cannot pick a voice').toBeTruthy();

  await expect(page.getByRole('button', { name: /open a new search/i }).first()).toBeVisible({ timeout: 10000 });

  // One h1, and it says where you are. Counting headings alone passed even
  // when every screen was called the same thing.
  await expect(page.locator('h1')).toHaveCount(1);
  await expect(page.locator('h1')).toContainText(/your searches/i);
  await expect(page).toHaveTitle(/home/i);

  await page.getByRole('button', { name: /open a new search/i }).first().click();
  await expect(page.locator('h1')).toHaveCount(1);
  await expect(page.locator('h1')).toContainText(/who is hiring/i);
  await expect(page).toHaveTitle(/new search/i);
});

test('printing a document drops the editing chrome and keeps the document', async ({ page }) => {
  // A rule detector passed whether or not the rules did anything. This checks
  // that under print the packet is what remains on the page.
  await installClerk(page);
  await page.goto('/');
  await page.waitForLoadState('networkidle');
  await expect(page.getByRole('button', { name: /open a new search/i }).first()).toBeVisible({ timeout: 10000 });

  const search = await (await page.request.post('/api/searches', {
    data: { client: 'Printed City', position: 'City Manager', package: 'executive' }
  })).json();
  const revision = String((await (await page.request.get('/api/searches/' + search.id)).json()).revision);
  await page.request.put('/api/searches/' + search.id + '/artifact/plan', {
    headers: { 'if-match': revision },
    data: { body: { rows: [{ outlet: 'ICMA', audience: 'Members', format: 'Listing', when: 'Week 1', cost: '$400', who: 'Slate', status: 'Planned' }] } }
  });

  await page.goto('/#/s/' + search.id + '/plan');
  await expect(page.locator('.editor')).toBeVisible({ timeout: 10000 });

  await page.emulateMedia({ media: 'print' });
  await page.evaluate(() => { document.documentElement.dataset.print = 'brochure'; });

  const hidden = sel => page.evaluate(s => {
    const el = document.querySelector(s);
    return !el || getComputedStyle(el).display === 'none';
  }, sel);

  expect(await hidden('.editor'), 'the editing fields print with the document').toBe(true);
  expect(await hidden('.actionbar'), 'the save bar prints with the document').toBe(true);
  expect(await hidden('.docbar'), 'the Edit/Preview control prints with the document').toBe(true);
  expect(await hidden('#main h1'), 'the document heading is missing from the printed page').toBe(false);

  await page.emulateMedia({ media: 'screen' });
});

test('a populated workspace screen has no WCAG 2.1 AA violations, in either theme', async ({ page }) => {
  await installClerk(page);
  await page.goto('/');
  await page.waitForLoadState('networkidle');
  await expect(page.getByRole('button', { name: /open a new search/i }).first()).toBeVisible({ timeout: 10000 });

  const search = await (await page.request.post('/api/searches', {
    data: { client: 'Scanned City', position: 'City Manager', package: 'executive' }
  })).json();
  const revision = async () => String((await (await page.request.get('/api/searches/' + search.id)).json()).revision);
  await page.request.put('/api/searches/' + search.id + '/profile', {
    headers: { 'if-match': await revision() },
    data: { criteria: [
      { id: 'S1', kind: 'skill', label: 'Financial management', weight: 5, note: 'Closing a structural deficit.' },
      { id: 'S2', kind: 'skill', label: 'Council relations', weight: 4, note: '' },
      { id: 'S3', kind: 'skill', label: 'Staff leadership', weight: 3, note: '' }
    ] }
  });
  for (const name of ['Ada Baker', 'Bo Chen']) {
    await page.request.post('/api/searches/' + search.id + '/candidates', {
      headers: { 'if-match': await revision() }, data: { name, cur: 'Deputy City Manager', org: 'City of Elsewhere' }
    });
  }

  // The screens the audit found problems on were populated ones. The scan
  // covers the list, the scoring surface and the profile, and repeats after a
  // theme change, which is when the invalid ARIA appeared.
  for (const view of ['screen', 'profile', 'new']) {
    const path = view === 'new' ? '/#/new' : '/#/s/' + search.id + '/' + view;
    await page.goto(path);
    await expect(page.locator('#main h1')).toBeVisible({ timeout: 10000 });

    for (const theme of ['light', 'dark']) {
      await setTheme(page, theme);
      const violations = await scan(page);
      expect(violations, view + ' in ' + theme + ':\n    ' + describeViolations(violations)).toEqual([]);
    }
  }
});
