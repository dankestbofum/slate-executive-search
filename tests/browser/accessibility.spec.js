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
//  - Clerk's account button is excluded: see `scan` below. Nothing here says
//    anything about the accessibility of the sign-in components Clerk renders.
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

// The account button is Clerk's own component, mounted into [data-clerk-user].
// Slate neither renders nor styles it, and under test it is the bare button the
// fixture puts there — which WebKit paints in its default grey and Chromium does
// not. Scanning it measures the stub, not the application. Its real
// accessibility is Clerk's to answer for, and is recorded as a residual
// limitation rather than proven here.
async function scan(page) {
  const results = await new AxeBuilder({ page }).withTags(TAGS).exclude('[data-clerk-user]').analyze();
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

test('the record-keeping screens have no WCAG 2.1 AA violations, in either theme', async ({ page }, testInfo) => {
  await installClerk(page);
  await page.goto('/');
  await page.waitForLoadState('networkidle');
  await expect(page.getByRole('button', { name: /open a new search/i }).first()).toBeVisible({ timeout: 10000 });

  // Both projects share one store, so the client name has to be unique.
  const search = await (await page.request.post('/api/searches', {
    data: { client: 'Recorded County ' + testInfo.project.name, position: 'County Administrator', jurisdictionType: 'county' }
  })).json();
  const revision = async () => String((await (await page.request.get('/api/searches/' + search.id)).json()).revision);
  const withCandidate = await (await page.request.post('/api/searches/' + search.id + '/candidates', {
    headers: { 'if-match': await revision() }, data: { name: 'Lee Morgan', cur: 'Deputy Administrator', org: 'County of Elsewhere' }
  })).json();
  const candidate = withCandidate.candidates[0];

  // Scan these populated, not empty: the rows, badges and log entries are the
  // parts a scan has anything to say about.
  await page.request.post('/api/searches/' + search.id + '/candidates/' + candidate.id + '/documents', {
    headers: { 'if-match': await revision() },
    data: { kind: 'reference', label: 'Reference call notes', url: 'https://records.example.gov/lee' }
  });
  await page.request.post('/api/searches/' + search.id + '/candidates/' + candidate.id + '/communications', {
    headers: { 'if-match': await revision() },
    data: { channel: 'phone', purpose: 'scheduling', summary: 'Agreed a panel slot.', followUpOn: '2020-01-02' }
  });
  await page.request.post('/api/searches/' + search.id + '/candidates/' + candidate.id + '/disposition', {
    headers: { 'if-match': await revision() },
    data: { outcome: 'not-selected', reason: 'Two stronger finalists.', evidence: 'Scores against S1 and S3.' }
  });

  const surfaces = [
    ['verify', null],
    ['closeout', null],
    ['screen', null],
    ['person/' + candidate.id, 'Details'],
    ['person/' + candidate.id, 'Outcome']
  ];
  for (const [view, tab] of surfaces) {
    await page.goto('/#/s/' + search.id + '/' + view);
    await expect(page.locator('#main h1')).toBeVisible({ timeout: 10000 });
    if (tab) await page.getByRole('tab', { name: tab }).click();

    for (const theme of ['light', 'dark']) {
      await setTheme(page, theme);
      const violations = await scan(page);
      expect(violations, view + (tab ? ' · ' + tab : '') + ' in ' + theme + ':\n    ' + describeViolations(violations)).toEqual([]);
    }
  }
});

test('an ordinary Ctrl+P drops the navigation chrome, without the print flag set', async ({ page }, testInfo) => {
  // The test above sets `data-print` by hand, which only the brochure and
  // advertisement Print controls ever do. That left the common case unchecked:
  // someone pressing Ctrl+P on any other screen used to print the navigation
  // rail and the filter controls, losing about a fifth of the page width.
  // Found by looking at scripts/print-samples.js output, not by a test.
  await installClerk(page);
  await page.goto('/');
  await page.waitForLoadState('networkidle');
  await expect(page.getByRole('button', { name: /open a new search/i }).first()).toBeVisible({ timeout: 10000 });

  const search = await (await page.request.post('/api/searches', {
    data: { client: 'Printed Plainly ' + testInfo.project.name, position: 'County Administrator', package: 'executive' }
  })).json();
  await page.request.post('/api/searches/' + search.id + '/candidates', {
    headers: { 'if-match': String((await (await page.request.get('/api/searches/' + search.id)).json()).revision) },
    data: { name: 'Ada Baker', cur: 'Deputy County Administrator', org: 'County of Elsewhere' }
  });

  await page.goto('/#/s/' + search.id + '/screen');
  await expect(page.locator('#main h1')).toBeVisible({ timeout: 10000 });
  await page.emulateMedia({ media: 'print' });

  const hidden = sel => page.evaluate(s => {
    const el = document.querySelector(s);
    return !el || getComputedStyle(el).display === 'none';
  }, sel);

  // No print flag is set here on purpose.
  expect(await page.evaluate(() => document.documentElement.dataset.print)).toBeUndefined();
  expect(await hidden('.rail'), 'the navigation rail prints').toBe(true);
  expect(await hidden('.listbar'), 'the list filters print').toBe(true);
  expect(await hidden('.backbar'), 'the back control prints').toBe(true);
  // And the content is still there, which is the half that matters.
  expect(await hidden('#main h1'), 'the page heading is missing from the printed page').toBe(false);
  expect(await hidden('.candtable'), 'the candidate table is missing from the printed page').toBe(false);

  await page.emulateMedia({ media: 'screen' });
});

test('a review warning never prints on the packet it warns about', async ({ page }, testInfo) => {
  // "The candidate profile changed. Review this copy against the current
  // profile." is for the consultant who has to act on it. It was printing on
  // the brochure a county receives.
  await installClerk(page);
  await page.goto('/');
  await page.waitForLoadState('networkidle');
  await expect(page.getByRole('button', { name: /open a new search/i }).first()).toBeVisible({ timeout: 10000 });

  const search = await (await page.request.post('/api/searches', {
    data: { client: 'Warned County ' + testInfo.project.name, position: 'County Administrator', package: 'executive' }
  })).json();
  const revision = async () => String((await (await page.request.get('/api/searches/' + search.id)).json()).revision);
  await page.request.put('/api/searches/' + search.id + '/artifact/community', {
    headers: { 'if-match': await revision() },
    data: { body: { history: 'A county with a history.', qualityOfLife: 'Good.' } }
  });
  await page.request.post('/api/searches/' + search.id + '/assemble', {
    headers: { 'if-match': await revision() }, data: { kind: 'brochure' }
  });
  // Changing the profile is what marks the brochure stale.
  await page.request.put('/api/searches/' + search.id + '/profile', {
    headers: { 'if-match': await revision() },
    data: { criteria: [{ id: 'S1', kind: 'skill', label: 'Financial management', weight: 5, note: '' }] }
  });

  await page.goto('/#/s/' + search.id + '/brochure');
  await expect(page.locator('#main h1, .pack').first()).toBeVisible({ timeout: 10000 });
  await expect(page.locator('.notice')).toContainText(/profile changed/i);

  await page.emulateMedia({ media: 'print' });
  await page.evaluate(() => { document.documentElement.dataset.print = 'brochure'; });
  const noticeShown = await page.evaluate(() => {
    const el = document.querySelector('.notice');
    return Boolean(el) && getComputedStyle(el).display !== 'none';
  });
  expect(noticeShown, 'an internal review warning printed on the client-facing brochure').toBe(false);
  await page.evaluate(() => { delete document.documentElement.dataset.print; });
  await page.emulateMedia({ media: 'screen' });
});
