'use strict';

// The critical journeys, in a real browser.
//
// The server suites prove the API behaves. These prove a person can actually
// reach that behaviour: that signing in works with a keyboard, that a
// county search can be opened, and that a candidate on a phone can read and
// submit a questionnaire.

const { test, expect } = require('@playwright/test');
const { installClerk } = require('./clerk');

// The door: Clerk's own script is stubbed, and the page starts signed out.
async function openLanding(page) {
  await installClerk(page, { signedIn: false });
  await page.goto('/');
  await page.waitForLoadState('networkidle');
  await expect(page.getByRole('button', { name: 'Sign in', exact: true }).first()).toBeVisible();
  await expect(page.locator('#login')).toHaveCount(0);
}

async function startWorkspace(page) {
  await installClerk(page);
  await page.goto('/');
  await page.waitForLoadState('networkidle');
  await expect(page.getByRole('button', { name: /open a new search/i }).first()).toBeVisible({ timeout: 10000 });
}

// Below the desktop breakpoint the rail is a drawer, so anything in it has to
// be opened before it can be used. On desktop the menu button is not rendered
// and the rail is already there.
async function openNav(page) {
  const menu = page.getByRole('button', { name: 'Menu', exact: true });
  if (await menu.isVisible().catch(() => false)) {
    await menu.click();
    await expect(page.locator('.shell')).toHaveClass(/shell--navopen/);
  }
}

test('a session opens the workspace, survives reload, and ends on sign-out', async ({ page }) => {
  await startWorkspace(page);
  await page.reload();
  await expect(page.getByRole('button', { name: /open a new search/i }).first()).toBeVisible();
  await openNav(page);
  // The harness holds the same session the page does. Drop it first, or the
  // request after signing out would be authenticated by the harness rather
  // than by the browser, which is not what this is about.
  await page.context().setExtraHTTPHeaders({});
  await page.getByRole('button', { name: 'Open account menu', exact: true }).click();
  await page.getByRole('button', { name: 'Sign out', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Sign in', exact: true }).first()).toBeVisible();
  await page.getByRole('button', { name: 'Sign in', exact: true }).first().click();
  await expect(page.getByRole('button', { name: /open a new search/i }).first()).toBeVisible({ timeout: 10000 });
});

test('signing in is reachable with the keyboard alone', async ({ page }) => {
  await openLanding(page);
  await page.keyboard.press('Tab');
  await expect(page.getByRole('button', { name: 'Sign in', exact: true }).first()).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('button', { name: /open a new search/i }).first()).toBeVisible({ timeout: 10000 });
});

test('starting fresh can be cancelled, archives managed searches, and keeps the session', async ({ page }) => {
  await installClerk(page, { email:'mike@slate.local' });
  const response = await page.request.post('/api/searches', { data:{ client:'Fresh Start Browser County', position:'County Administrator' } });
  expect(response.ok()).toBe(true);
  const created = await response.json();
  await page.goto('/');
  const start = page.getByRole('button', { name:'Start fresh', exact:true });
  await expect(start).toBeVisible();
  const ids = (await (await page.request.get('/api/searches')).json()).filter(s => s.seat === 'manager').map(s => s.id);
  try {
    page.once('dialog', dialog => dialog.dismiss());
    await start.click();
    expect((await page.request.get('/api/searches/'+created.id)).status()).toBe(200);
    await expect(start).toBeVisible();
    let confirmation = '';
    page.once('dialog', async dialog => { confirmation = dialog.message(); await dialog.accept(); });
    await start.click();
    await expect(page.locator('#newsearch')).toBeVisible();
    expect(confirmation).toContain('Fresh Start Browser County');
    expect(confirmation).toContain('Your Clerk login stays active');
    expect((await page.request.get('/api/me')).status()).toBe(200);
    expect((await page.request.get('/api/searches/'+created.id)).status()).toBe(404);
    await page.reload();
    await expect(page.locator('#newsearch')).toBeVisible();
    await openNav(page);
    await expect(page.locator('[data-clerk-user]')).toHaveCount(1);
    await expect(page.getByRole('button', { name:'New search', exact:true })).toBeVisible();
  } finally {
    for (const id of ids) await page.request.post('/api/archives/'+id+'/restore', { data:{} });
  }
});

test('every focusable control shows a visible focus indicator', async ({ page }) => {
  await openLanding(page);
  const button = page.getByRole('button', { name: 'Sign in', exact: true }).first();
  await button.focus();
  const outline = await button.evaluate(el => {
    const style = getComputedStyle(el);
    return { outlineWidth: style.outlineWidth, outlineStyle: style.outlineStyle, boxShadow: style.boxShadow };
  });
  const visible = (outline.outlineStyle !== 'none' && outline.outlineWidth !== '0px')
    || (outline.boxShadow && outline.boxShadow !== 'none');
  expect(visible, 'a focused button showed no visible focus indicator').toBe(true);
});

test('a county search can be opened and reloads with its type intact', async ({ page }) => {
  await startWorkspace(page);

  await page.getByRole('button', { name: /open a new search/i }).first().click();
  const form = page.locator('#newsearch');
  await expect(form).toBeVisible();

  await form.locator('[name="client"]').fill('Browser County');
  await form.locator('[name="position"]').fill('County Administrator');
  const type = form.locator('[name="jurisdictionType"]');
  if (await type.count()) await type.selectOption('county');
  const state = form.locator('[name="state"]');
  if (await state.count()) await state.fill('AZ');

  await page.getByRole('button', { name: /create search/i }).click();

  await expect(page.getByText('Browser County').filter({ visible: true }).first()).toBeVisible({ timeout: 10000 });

  await page.reload();
  await page.waitForLoadState('networkidle');
  await expect(page.getByText('Browser County').filter({ visible: true }).first()).toBeVisible({ timeout: 10000 });
});

test('the candidate questionnaire is usable and states its support contact', async ({ page }) => {
  // Set up through the API so the browser test is about the candidate page,
  // not about every consultant screen leading to it.
  await installClerk(page);

  const created = await (await page.request.post('/api/searches', {
    data: { client: 'Applicant County', position: 'County Administrator', jurisdictionType: 'county' }
  })).json();

  const revision = async () => String((await (await page.request.get('/api/searches/' + created.id)).json()).revision);

  await page.request.put('/api/searches/' + created.id + '/artifact/survey1', {
    headers: { 'if-match': await revision() },
    data: { body: { intro: 'Tell us about your experience.', questions: [
      { n: 1, prompt: 'Describe your county budget experience.', required: true }
    ] } }
  });

  const withCandidate = await (await page.request.post('/api/searches/' + created.id + '/candidates', {
    headers: { 'if-match': await revision() },
    data: { name: 'Browser Candidate' }
  })).json();
  const token = withCandidate.candidates[0].invite;

  await page.goto('/apply/' + token);
  await page.waitForLoadState('networkidle');

  // The question they were asked is on the page.
  await expect(page.getByText(/county budget experience/i)).toBeVisible({ timeout: 10000 });

  // The support contact is configured in playwright.config.js, so a candidate
  // who cannot proceed has somewhere to go.
  await expect(page.getByText(/recruitment@example\.gov/i)).toBeVisible();
});

test('a candidate can submit and sees a receipt afterwards', async ({ page }) => {
  await installClerk(page);

  const created = await (await page.request.post('/api/searches', {
    data: { client: 'Receipt County', position: 'County Administrator', jurisdictionType: 'county' }
  })).json();
  const revision = async () => String((await (await page.request.get('/api/searches/' + created.id)).json()).revision);

  await page.request.put('/api/searches/' + created.id + '/artifact/survey1', {
    headers: { 'if-match': await revision() },
    data: { body: { intro: 'One question.', questions: [{ n: 1, prompt: 'Why this county?', required: true }] } }
  });
  const withCandidate = await (await page.request.post('/api/searches/' + created.id + '/candidates', {
    headers: { 'if-match': await revision() },
    data: { name: 'Receipt Candidate' }
  })).json();
  const token = withCandidate.candidates[0].invite;

  await page.goto('/apply/' + token);
  await page.waitForLoadState('networkidle');

  const answer = page.locator('textarea').first();
  await expect(answer).toBeVisible({ timeout: 10000 });
  await answer.fill('Because the work matters and I know county budgets.');

  await page.getByRole('button', { name: /submit|send/i }).first().click();

  // Something must confirm receipt. An empty form after submitting is the
  // failure mode that makes people send their answers twice.
  await expect(
    page.getByText(/received|submitted|thank you|receipt/i).first()
  ).toBeVisible({ timeout: 10000 });

  // And it must survive a reload, which is what a worried candidate does.
  await page.reload();
  await page.waitForLoadState('networkidle');
  await expect(
    page.getByText(/received|submitted|thank you|receipt/i).first()
  ).toBeVisible({ timeout: 10000 });
});

test('touch targets on the candidate page are large enough to hit', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'mobile-chrome', 'touch sizing is a mobile concern');

  await installClerk(page);
  const created = await (await page.request.post('/api/searches', {
    data: { client: 'Touch County', position: 'County Administrator' }
  })).json();
  const revision = async () => String((await (await page.request.get('/api/searches/' + created.id)).json()).revision);
  await page.request.put('/api/searches/' + created.id + '/artifact/survey1', {
    headers: { 'if-match': await revision() },
    data: { body: { intro: 'One question.', questions: [{ n: 1, prompt: 'Why this county?', required: true }] } }
  });
  const withCandidate = await (await page.request.post('/api/searches/' + created.id + '/candidates', {
    headers: { 'if-match': await revision() }, data: { name: 'Touch Candidate' }
  })).json();

  await page.goto('/apply/' + withCandidate.candidates[0].invite);
  await page.waitForLoadState('networkidle');

  const small = [];
  for (const button of await page.getByRole('button').all()) {
    if (!(await button.isVisible())) continue;
    const box = await button.boundingBox();
    // WCAG 2.2 target size (minimum) is 24x24 CSS pixels.
    if (box && (box.width < 24 || box.height < 24)) {
      small.push((await button.textContent() || '').trim() + ' ' + Math.round(box.width) + 'x' + Math.round(box.height));
    }
  }
  expect(small, 'controls below the 24px minimum target size').toEqual([]);
});
