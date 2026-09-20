'use strict';

/**
 * The public careers portal, in a real browser.
 *
 * The server suite proves the rules. This proves the things only a browser
 * decides: that the page renders under the strict Content-Security-Policy it
 * is served with, that a person can get from a listing to a submitted
 * application with a keyboard and a phone-sized screen, and that the page
 * never tells an applicant something the record does not support.
 *
 * The mail transport here is the test one, so a verification code can be read
 * out of the response the way the server suite reads it. Everything else —
 * publication, ownership, submission — is the production path.
 */

const { test, expect } = require('@playwright/test');
const { installClerk } = require('./clerk');

const READY = {
  title: 'City Manager', employer: 'City of Synthetic', location: 'Synthetic, AZ',
  compensation: '$180,000 to $210,000',
  summary: 'A synthetic posting used by the browser suite.',
  responsibilities: 'Run the synthetic organization.',
  qualifications: 'Ten years of synthetic local government experience.',
  applicationInstructions: 'Answer the questions below. No documents are required.',
  privacyNotice: 'Synthetic privacy notice for the test suite.',
  supportEmail: 'recruitment@example.gov',
  supportHours: 'Weekdays 8am-5pm Arizona time',
  deadline: { kind: 'open', firstReviewOn: '2026-12-01', timezone: 'America/Phoenix' },
  questions: [{ prompt: 'Why this city?', required: true }],
  materials: []
};

async function revision(page, id) {
  return String((await (await page.request.get('/api/searches/' + id)).json()).revision);
}

/** A published posting, and the public address it lives at. */
async function publish(page, label) {
  await installClerk(page);
  // The client name is deliberately not in the posting. It is what the public
  // page must never carry, so it has to be a string the page has no other
  // reason to contain.
  const search = await (await page.request.post('/api/searches', {
    data: { client: 'Confidential Client ' + label, position: 'City Manager', package: 'executive', jurisdictionType: 'municipality' }
  })).json();
  const saved = await page.request.put('/api/searches/' + search.id + '/posting', {
    headers: { 'if-match': await revision(page, search.id) },
    data: { ...READY, title: 'City Manager — ' + label }
  });
  expect(saved.ok(), await saved.text()).toBe(true);
  const published = await page.request.post('/api/searches/' + search.id + '/posting/publish', {
    headers: { 'if-match': await revision(page, search.id) }
  });
  expect(published.ok(), await published.text()).toBe(true);
  const body = await published.json();
  const parts = new URL(body.publicUrl).pathname.split('/').filter(Boolean);
  return { search, firmSlug: parts[1], postingSlug: parts[2], path: new URL(body.publicUrl).pathname };
}

test('a published job page is readable with no account and states its deadline policy', async ({ page }, testInfo) => {
  const { path } = await publish(page, 'Careers Read ' + testInfo.project.name);
  // A fresh context with no staff session at all.
  await page.context().clearCookies();
  await page.goto(path);

  await expect(page.getByRole('heading', { level: 1 })).toContainText('City Manager');
  await expect(page.getByText('Accepting applications')).toBeVisible();
  await expect(page.getByText('Open until filled')).toBeVisible();
  await expect(page.getByText('America/Phoenix')).toBeVisible();
  await expect(page.getByText('recruitment@example.gov')).toBeVisible();

  // Nothing from the search file reaches this page.
  await expect(page.locator('body')).not.toContainText('Confidential Client');
});

test('the page renders under its own strict policy, with no console errors', async ({ page }, testInfo) => {
  const problems = [];
  page.on('console', message => { if (message.type() === 'error') problems.push(message.text()); });
  page.on('pageerror', error => problems.push(String(error)));

  const { path } = await publish(page, 'Careers CSP ' + testInfo.project.name);
  await page.context().clearCookies();
  await page.goto(path);
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  expect(problems, 'the careers page reported errors: ' + problems.join(' | ')).toEqual([]);
});

test('an applicant verifies, saves a draft, and comes back to it', async ({ page }, testInfo) => {
  const { firmSlug, postingSlug, path } = await publish(page, 'Careers Apply ' + testInfo.project.name);
  const email = 'browser-' + testInfo.project.name.replace(/\W/g, '') + '@example.test';
  await page.context().clearCookies();
  await page.goto(path);

  await page.getByRole('link', { name: 'Apply for this position' }).click();
  await expect(page.getByRole('heading', { name: 'Verify your email address' })).toBeVisible();

  // The code comes back on the response under the test transport, exactly as
  // it does for the server suite. Captured here rather than guessed.
  let code = null;
  page.on('response', async response => {
    if (!response.url().includes('/api/applications/verify/start')) return;
    const body = await response.json().catch(() => ({}));
    code = /(\d{6})/.exec(body.testMessage || '')?.[1] || code;
  });

  await page.getByLabel('Email address').fill(email);
  await page.getByRole('button', { name: 'Send me a code' }).click();
  await expect(page.getByLabel('Six-digit code')).toBeVisible();
  expect(code, 'no verification code was returned; is SLATE_MAIL_TRANSPORT=echo set?').toBeTruthy();

  await page.getByLabel('Six-digit code').fill(code);
  await page.getByRole('button', { name: 'Verify and continue' }).click();

  await page.getByRole('button', { name: 'Start my application' }).click();
  await expect(page.getByRole('heading', { name: /^Apply:/ })).toBeVisible();

  // Saving is not applying, and the page says so before and after.
  await expect(page.getByText('Saving is not applying')).toBeVisible();
  await page.getByLabel('Full name').fill('Synthetic Applicant');
  await page.getByLabel('Why this city?').fill('Because of the synthetic work ahead.');
  await page.getByRole('button', { name: 'Save draft' }).click();
  await expect(page.getByText(/Draft saved/)).toBeVisible();

  // Come back to it. The cookie is the return path; no password anywhere.
  await page.goto('/careers/' + firmSlug + '/' + postingSlug + '/apply');
  await expect(page.getByLabel('Full name')).toHaveValue('Synthetic Applicant');
  await expect(page.getByLabel('Why this city?')).toHaveValue('Because of the synthetic work ahead.');
});

test('review, submit, and a receipt that does not claim a hiring status', async ({ page }, testInfo) => {
  const { path } = await publish(page, 'Careers Submit ' + testInfo.project.name);
  const email = 'submit-' + testInfo.project.name.replace(/\W/g, '') + '@example.test';
  await page.context().clearCookies();

  let code = null;
  page.on('response', async response => {
    if (!response.url().includes('/api/applications/verify/start')) return;
    const body = await response.json().catch(() => ({}));
    code = /(\d{6})/.exec(body.testMessage || '')?.[1] || code;
  });

  await page.goto(path);
  await page.getByRole('link', { name: 'Apply for this position' }).click();
  await page.getByLabel('Email address').fill(email);
  await page.getByRole('button', { name: 'Send me a code' }).click();
  await expect(page.getByLabel('Six-digit code')).toBeVisible();
  await page.getByLabel('Six-digit code').fill(code);
  await page.getByRole('button', { name: 'Verify and continue' }).click();
  await page.getByRole('button', { name: 'Start my application' }).click();

  await page.getByLabel('Full name').fill('Synthetic Applicant');
  await page.getByLabel('Why this city?').fill('A complete synthetic answer.');
  await page.getByRole('button', { name: 'Review and submit' }).click();

  await expect(page.getByRole('heading', { name: 'Review your application' })).toBeVisible();
  await expect(page.getByText('Synthetic Applicant')).toBeVisible();
  await expect(page.getByText('It is not a decision')).toBeVisible();

  await page.getByRole('button', { name: 'Submit application' }).click();
  await expect(page.getByRole('heading', { name: 'Application received' })).toBeVisible();
  await expect(page.getByText(/This confirms your application arrived/)).toBeVisible();
  const reference = await page.locator('.careers__receipt .mono').first().textContent();
  expect(reference.trim().length).toBeGreaterThan(4);

  // The receipt time has to be the time in the zone it names. Submissions are
  // stored in UTC and this posting is America/Phoenix, so printing the UTC
  // clock beside that label would put the arrival seven hours late — on the
  // wrong side of a closing date. The expected rendering is computed here
  // independently of the page's own formatter.
  const submittedAt = await page.evaluate(async () => {
    const parts = location.pathname.split('/').filter(Boolean);
    const mine = await (await fetch('/api/applications/' + parts[1] + '/' + parts[2])).json();
    return mine.application.receipt.submittedAt;
  });
  const expected = new Intl.DateTimeFormat('en-GB', {
    year: 'numeric', month: 'long', day: 'numeric', hour: 'numeric', minute: '2-digit',
    timeZone: 'America/Phoenix'
  }).format(new Date(submittedAt));
  await expect(page.locator('.careers__receipt')).toContainText(expected);
  await expect(page.locator('.careers__receipt')).toContainText('America/Phoenix');
  // And not the UTC clock time wearing that label.
  const utc = new Intl.DateTimeFormat('en-GB', {
    hour: 'numeric', minute: '2-digit', timeZone: 'UTC'
  }).format(new Date(submittedAt));
  const phoenix = new Intl.DateTimeFormat('en-GB', {
    hour: 'numeric', minute: '2-digit', timeZone: 'America/Phoenix'
  }).format(new Date(submittedAt));
  if (utc !== phoenix) {
    await expect(page.locator('.careers__receipt')).not.toContainText(utc + ' (America/Phoenix)');
  }

  // Returning shows the receipt, and still never a hiring status.
  await page.reload();
  await expect(page.getByText(reference.trim())).toBeVisible();
  // Every mention of a hiring stage has to be a denial. Checked by what comes
  // before it rather than by banning the words, because the page has to be
  // able to say "it does not mean your application is under review".
  const stages = await page.evaluate(() => {
    const text = document.body.innerText.toLowerCase().replace(/\s+/g, ' ');
    return [...text.matchAll(/(under review|shortlisted|declined|rejected)/g)]
      .map(m => text.slice(Math.max(0, m.index - 90), m.index + m[0].length));
  });
  expect(stages.length, 'the receipt never mentions what it is not').toBeGreaterThan(0);
  for (const phrase of stages) {
    expect(phrase, 'the page states a hiring stage as fact').toMatch(/ not | never | does not | is not /);
  }
});

test('the application page is not cached and asks not to be indexed', async ({ page }, testInfo) => {
  const { firmSlug, postingSlug } = await publish(page, 'Careers Cache ' + testInfo.project.name);
  const res = await page.request.get('/careers/' + firmSlug + '/' + postingSlug + '/apply');
  expect(res.headers()['cache-control']).toContain('no-store');
  expect(res.headers()['x-robots-tag']).toContain('noindex');
});

test('the listing reflows on a phone with no sideways scroll', async ({ page }, testInfo) => {
  const { firmSlug } = await publish(page, 'Careers Reflow ' + testInfo.project.name);
  await page.context().clearCookies();
  await page.setViewportSize({ width: 320, height: 720 });
  await page.goto('/careers/' + firmSlug);
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  const overflow = await page.evaluate(() =>
    document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow, 'the listing scrolls sideways at 320px').toBeLessThanOrEqual(1);
});

test('candidate help is available in the portal and carries no staff content', async ({ page }, testInfo) => {
  const { path } = await publish(page, 'Careers Help ' + testInfo.project.name);
  await page.context().clearCookies();
  await page.goto(path);
  await page.getByRole('button', { name: 'Help for applicants' }).click();

  const drawer = page.getByRole('dialog', { name: 'Help' });
  await expect(drawer).toBeVisible();
  await expect(drawer).toContainText('Apply for an opening');
  await expect(drawer).not.toContainText('committee');
  await expect(drawer).not.toContainText('workspace');

  await page.keyboard.press('Escape');
  await expect(drawer).toBeHidden();
});
