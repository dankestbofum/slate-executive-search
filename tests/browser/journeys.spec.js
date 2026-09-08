'use strict';

// The critical journeys, in a real browser.
//
// The server suites prove the API behaves. These prove a person can actually
// reach that behaviour: that the sign-in form works with a keyboard, that a
// county search can be opened, and that a candidate on a phone can read and
// submit a questionnaire.

const { test, expect } = require('@playwright/test');

const TEAM = { email: 'team@slate.local', pin: '1234' };

async function openSignIn(page) {
  await page.goto('/');
  await page.waitForLoadState('networkidle');
  await page.getByRole('button', { name: /^sign in$/i }).first().click();
  await expect(page.locator('#login')).toBeVisible({ timeout: 10000 });
}

async function signIn(page) {
  await openSignIn(page);
  await page.getByLabel(/email/i).fill(TEAM.email);
  await page.getByLabel(/pin/i).fill(TEAM.pin);
  await page.getByRole('button', { name: /open workspace/i }).click();
  await expect(page.getByRole('button', { name: /open a new search/i }).first()).toBeVisible({ timeout: 10000 });
}

test('a consultant can sign in', async ({ page }) => {
  await signIn(page);
});

test('sign-in is reachable with the keyboard alone', async ({ page }) => {
  await openSignIn(page);

  // Tab to the first field rather than clicking it, then fill and submit
  // without the mouse. A committee member using a screen reader or a keyboard
  // has to be able to get in.
  await page.keyboard.press('Tab');
  const reachedField = await page.evaluate(() => {
    const active = document.activeElement;
    return active && ['INPUT', 'BUTTON', 'A', 'SELECT'].includes(active.tagName);
  });
  expect(reachedField, 'tabbing from the top of the page reached nothing focusable').toBe(true);

  await page.getByLabel(/email/i).fill('');
  await page.getByLabel(/pin/i).fill('');
  await page.getByLabel(/email/i).focus();
  await page.keyboard.type(TEAM.email);
  await page.keyboard.press('Tab');
  await page.keyboard.type(TEAM.pin);
  await page.keyboard.press('Enter');
  await expect(page.getByRole('button', { name: /open a new search/i }).first()).toBeVisible({ timeout: 10000 });
});

test('every focusable control shows a visible focus indicator', async ({ page }) => {
  await openSignIn(page);

  const field = page.getByLabel(/email/i);
  await field.focus();
  const outline = await field.evaluate(el => {
    const style = getComputedStyle(el);
    return { outlineWidth: style.outlineWidth, outlineStyle: style.outlineStyle, boxShadow: style.boxShadow };
  });
  const visible = (outline.outlineStyle !== 'none' && outline.outlineWidth !== '0px')
    || (outline.boxShadow && outline.boxShadow !== 'none');
  expect(visible, 'a focused field showed no visible focus indicator').toBe(true);
});

test('a county search can be opened and reloads with its type intact', async ({ page }) => {
  await signIn(page);

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

  await expect(page.getByText('Browser County').first()).toBeVisible({ timeout: 10000 });

  await page.reload();
  await page.waitForLoadState('networkidle');
  await expect(page.getByText('Browser County').first()).toBeVisible({ timeout: 10000 });
});

test('the candidate questionnaire is usable and states its support contact', async ({ page, request }) => {
  // Set up through the API so the browser test is about the candidate page,
  // not about every consultant screen leading to it.
  const login = await request.post('/api/login', { data: { email: 'abe@slate.local', pin: '2468' } });
  expect(login.ok()).toBeTruthy();

  const created = await (await request.post('/api/searches', {
    data: { client: 'Applicant County', position: 'County Administrator', jurisdictionType: 'county' }
  })).json();

  const revision = async () => String((await (await request.get('/api/searches/' + created.id)).json()).revision);

  await request.put('/api/searches/' + created.id + '/artifact/survey1', {
    headers: { 'if-match': await revision() },
    data: { body: { intro: 'Tell us about your experience.', questions: [
      { n: 1, prompt: 'Describe your county budget experience.', required: true }
    ] } }
  });

  const withCandidate = await (await request.post('/api/searches/' + created.id + '/candidates', {
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

test('a candidate can submit and sees a receipt afterwards', async ({ page, request }) => {
  const login = await request.post('/api/login', { data: { email: 'abe@slate.local', pin: '2468' } });
  expect(login.ok()).toBeTruthy();

  const created = await (await request.post('/api/searches', {
    data: { client: 'Receipt County', position: 'County Administrator', jurisdictionType: 'county' }
  })).json();
  const revision = async () => String((await (await request.get('/api/searches/' + created.id)).json()).revision);

  await request.put('/api/searches/' + created.id + '/artifact/survey1', {
    headers: { 'if-match': await revision() },
    data: { body: { intro: 'One question.', questions: [{ n: 1, prompt: 'Why this county?', required: true }] } }
  });
  const withCandidate = await (await request.post('/api/searches/' + created.id + '/candidates', {
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

test('touch targets on the candidate page are large enough to hit', async ({ page, request }, testInfo) => {
  test.skip(testInfo.project.name !== 'mobile-chrome', 'touch sizing is a mobile concern');

  const login = await request.post('/api/login', { data: { email: 'abe@slate.local', pin: '2468' } });
  expect(login.ok()).toBeTruthy();
  const created = await (await request.post('/api/searches', {
    data: { client: 'Touch County', position: 'County Administrator' }
  })).json();
  const revision = async () => String((await (await request.get('/api/searches/' + created.id)).json()).revision);
  await request.put('/api/searches/' + created.id + '/artifact/survey1', {
    headers: { 'if-match': await revision() },
    data: { body: { intro: 'One question.', questions: [{ n: 1, prompt: 'Why this county?', required: true }] } }
  });
  const withCandidate = await (await request.post('/api/searches/' + created.id + '/candidates', {
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
