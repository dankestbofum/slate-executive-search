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

test('the landing page has no WCAG 2.1 AA violations', async ({ page }) => {
  await page.goto('/');
  await page.waitForLoadState('networkidle');
  const violations = await scan(page);
  expect(violations, '\n    ' + describeViolations(violations)).toEqual([]);
});

test('the workspace opened with Start has no WCAG 2.1 AA violations', async ({ page }) => {
  await page.goto('/');
  await page.waitForLoadState('networkidle');
  await page.getByRole('button', { name: 'Start', exact: true }).first().click();
  await expect(page.getByRole('button', { name: /open a new search/i }).first()).toBeVisible();

  const violations = await scan(page);
  expect(violations, '\n    ' + describeViolations(violations)).toEqual([]);
});

test('the candidate questionnaire has no WCAG 2.1 AA violations', async ({ page, request }) => {
  const login = await request.post('/api/login', { data: { email: 'abe@slate.local', pin: '2468' } });
  expect(login.ok()).toBeTruthy();

  const created = await (await request.post('/api/searches', {
    data: { client: 'Accessible County', position: 'County Administrator', jurisdictionType: 'county' }
  })).json();
  const revision = async () => String((await (await request.get('/api/searches/' + created.id)).json()).revision);

  await request.put('/api/searches/' + created.id + '/artifact/survey1', {
    headers: { 'if-match': await revision() },
    data: { body: { intro: 'Tell us about your experience.', questions: [
      { n: 1, prompt: 'Describe your county budget experience.', required: true },
      { n: 2, prompt: 'What would your first ninety days look like?', required: false }
    ] } }
  });
  const withCandidate = await (await request.post('/api/searches/' + created.id + '/candidates', {
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

test('the document declares a language and has one main heading', async ({ page }) => {
  await page.goto('/');
  await page.waitForLoadState('networkidle');

  const lang = await page.evaluate(() => document.documentElement.lang);
  expect(lang, 'the document has no lang attribute, so a screen reader cannot pick a voice').toBeTruthy();

  const headings = await page.locator('h1').count();
  expect(headings, 'the page has no h1').toBeGreaterThan(0);
});

test('a print stylesheet exists for the materials that get printed', async ({ page }) => {
  await page.goto('/');
  await page.waitForLoadState('networkidle');

  const hasPrintRules = await page.evaluate(() => {
    for (const sheet of document.styleSheets) {
      let rules;
      try { rules = sheet.cssRules; } catch { continue; }
      for (const rule of rules) {
        if (rule.type === CSSRule.MEDIA_RULE && String(rule.conditionText || '').includes('print')) return true;
      }
    }
    return false;
  });
  expect(hasPrintRules, 'no @media print rules; brochures and panel materials print as screen layout').toBe(true);
});
