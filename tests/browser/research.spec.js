'use strict';

// Browser coverage for the research screen.
//
// This is the only place the trapped loading state can actually be reproduced.
// The old dialog awaited one promise with no deadline and no cancel, marked
// #app inert, and advanced four labels on an eight-second timer — so after
// about twenty-four seconds it claimed it was writing the search file whether
// or not the server had answered, and if the promise never settled the whole
// application stayed unreachable.
//
// These tests hold the network open on purpose and then check that a
// consultant can still get their page back.

const { test, expect } = require('@playwright/test');
const { installClerk } = require('./clerk');

// The browser server runs with no API key, which correctly disables the
// research control. These tests are about the loading state, the failure panel
// and the review step, so the key is reported as present and every research
// request is answered by a route handler. No paid call is ever made.
test.beforeEach(async ({ page }) => {
  await installClerk(page);
  await page.route('**/api/me', async route => {
    try {
      const response = await route.fetch();
      if (!response.ok()) return await route.fulfill({ response });
      const body = await response.json();
      if (body.health) body.health.hasKey = true;
      await route.fulfill({ response, json: body });
    } catch {
      // A navigation can dispose a request mid-flight. Nothing to assert here;
      // let it go rather than failing the test the route only supports.
      try { await route.fallback(); } catch { /* already gone */ }
    }
  });
});

async function workspace(page) {
  await page.goto('/');
  await page.waitForLoadState('networkidle');
  await expect(page.getByRole('button', { name: /open a new search/i }).first()).toBeVisible({ timeout: 10000 });
}

async function revision(page, id) {
  return String((await (await page.request.get('/api/searches/' + id)).json()).revision);
}

// Research waits until the candidate profile is adopted, so the fixture adopts
// one. Three to five of each kind is what marks that step done.
function criteria() {
  const kinds = ['skill', 'trait', 'chall', 'opp'];
  const rows = [];
  for (const kind of kinds) {
    for (let i = 1; i <= 3; i += 1) {
      rows.push({ id: kind[0].toUpperCase() + i, kind, label: kind + ' ' + i, weight: 4, note: 'Matters here.' });
    }
  }
  return rows;
}

async function researchableSearch(page, client) {
  const search = await (await page.request.post('/api/searches', {
    data: { client, position: 'City Manager', package: 'executive', website: 'https://example.gov' }
  })).json();
  await page.request.put('/api/searches/' + search.id + '/profile', {
    headers: { 'if-match': await revision(page, search.id) },
    data: { criteria: criteria() }
  });
  return search;
}

async function openCommunity(page, id) {
  await page.goto('/#/s/' + id + '/community');
  await expect(page.getByRole('button', { name: /^research this/i })).toBeVisible({ timeout: 10000 });
}

const dialog = page => page.locator('#lookup');
const startButton = page => page.getByRole('button', { name: /^research this/i });

test('a request that never answers cannot trap the interface', async ({ page }) => {
  await workspace(page);
  const search = await researchableSearch(page, 'Stuck City');

  // The failure this replaces: a start request that never settles.
  await page.route('**/research-jobs', () => { /* deliberately never fulfilled */ });

  await openCommunity(page, search.id);
  await startButton(page).click();

  await expect(dialog(page)).toBeVisible();
  await expect(page.locator('#app')).toHaveAttribute('inert', '');
  // A Cancel action exists and has focus, so a keyboard user is not stranded.
  const cancel = page.locator('#lookup-cancel');
  await expect(cancel).toBeVisible();
  await expect(cancel).toBeFocused();

  await cancel.click();

  await expect(dialog(page)).toBeHidden({ timeout: 7000 });
  await expect(page.locator('#app')).not.toHaveAttribute('inert', '');
  // And the page is genuinely usable again, not merely un-dimmed.
  await expect(startButton(page)).toBeEnabled();
  await startButton(page).focus();
});

test('the dialog reports the stage the server is in and never claims a save that has not happened', async ({ page }) => {
  await workspace(page);
  const search = await researchableSearch(page, 'Honest City');

  await page.route('**/research-jobs', async route => {
    await route.fulfill({
      status: 202,
      contentType: 'application/json',
      body: JSON.stringify({
        job: {
          id: 'rj-test', searchId: search.id, state: 'running', stage: 'crawling',
          city: 'Honest City', website: 'https://example.gov',
          createdAt: new Date().toISOString(),
          deadlineAt: new Date(Date.now() + 180000).toISOString()
        },
        reused: false,
        status: '/api/searches/' + search.id + '/research-jobs/rj-test'
      })
    });
  });
  let stage = 'crawling';
  await page.route('**/research-jobs/rj-test', async route => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ job: {
        id: 'rj-test', searchId: search.id, state: 'running', stage,
        createdAt: new Date().toISOString(),
        deadlineAt: new Date(Date.now() + 180000).toISOString()
      } })
    });
  });

  await openCommunity(page, search.id);
  await startButton(page).click();

  await expect(page.locator('#lookup-stage')).toHaveText(/Reading the official website/);
  stage = 'researching';
  await expect(page.locator('#lookup-stage')).toHaveText(/Searching public records/, { timeout: 10000 });
  // Elapsed time is real, and the old simulated step list is gone.
  await expect(page.locator('#lookup-elapsed')).toHaveText(/\d+s/);
  await expect(page.locator('#lookup-steps li')).toHaveCount(0);
  // The claim the old dialog made after twenty-four seconds, whatever the
  // server was doing.
  await expect(page.locator('#lookup-stage')).not.toHaveText(/Saving/);

  await page.locator('#lookup-cancel').click();
  await expect(dialog(page)).toBeHidden({ timeout: 7000 });
});

test('a failure leaves an explanation on the page with retry and manual entry', async ({ page }) => {
  await workspace(page);
  const search = await researchableSearch(page, 'Timeout City');

  await page.route('**/research-jobs', async route => {
    await route.fulfill({
      status: 504,
      contentType: 'application/json',
      body: JSON.stringify({
        code: 'RESEARCH_TIMEOUT',
        error: 'Research ran past its time limit and was stopped. Nothing was saved. Try again, or fill the facts by hand.',
        operation: 'op-abc123'
      })
    });
  });

  await openCommunity(page, search.id);
  await startButton(page).click();

  // Not a toast that is gone before it is read.
  const panel = page.locator('.notice--stop', { hasText: /Research did not finish/i });
  await expect(panel).toBeVisible({ timeout: 10000 });
  await expect(panel).toContainText(/past its time limit/i);
  await expect(panel).toContainText('op-abc123');
  await expect(panel.getByRole('button', { name: /try research again/i })).toBeVisible();
  await expect(panel.getByRole('button', { name: /fill the facts by hand/i })).toBeVisible();
  // The dialog let go, and the page is usable.
  await expect(dialog(page)).toBeHidden();
  await expect(page.locator('#app')).not.toHaveAttribute('inert', '');

  // It stays until it is dismissed, rather than disappearing on the next
  // render the way a toast does.
  await page.reload();
  await expect(page.locator('.notice--stop', { hasText: /Research did not finish/i })).toBeHidden();
});

test('findings that are incomplete are offered for review rather than discarded', async ({ page }) => {
  await workspace(page);
  const search = await researchableSearch(page, 'Partial Town');

  const job = {
    id: 'rj-partial', searchId: search.id, state: 'partial', stage: 'done',
    city: 'Partial Town', website: 'https://example.gov',
    createdAt: new Date().toISOString(), finishedAt: new Date().toISOString(),
    deadlineAt: new Date(Date.now() + 1000).toISOString(),
    reviewable: true, applied: false, partial: true,
    missing: ['operating or general-fund budget'],
    sources: [{ title: 'Town of Partial', url: 'https://example.gov/' }],
    failure: null
  };
  await page.route('**/research-jobs', async route => {
    await route.fulfill({
      status: 202, contentType: 'application/json',
      body: JSON.stringify({ job: { ...job, state: 'running', stage: 'researching' }, reused: false,
        status: '/api/searches/' + search.id + '/research-jobs/rj-partial' })
    });
  });
  await page.route('**/research-jobs/rj-partial', async route => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ job }) });
  });

  await openCommunity(page, search.id);
  await startButton(page).click();

  const review = page.locator('.notice--wait', { hasText: /research ready for review/i });
  await expect(review).toBeVisible({ timeout: 10000 });
  await expect(review).toContainText(/operating or general-fund budget/);
  await expect(review.getByRole('button', { name: /apply what it found/i })).toBeVisible();
  await expect(review.getByRole('button', { name: /leave it for now/i })).toBeVisible();
  // Nothing was written: applying is a separate, deliberate act.
  await expect(page.locator('.notice--stop')).toBeHidden();

  await review.getByRole('button', { name: /leave it for now/i }).click();
  await expect(review).toBeHidden();
});

test('research that is already running is picked up again on reload', async ({ page }) => {
  await workspace(page);
  const search = await researchableSearch(page, 'Reconnect City');

  // What the server reports on every read of the search once a job is running.
  await page.route('**/api/searches/' + search.id, async route => {
    if (route.request().method() !== 'GET') return route.fallback();
    const response = await route.fetch();
    const body = await response.json();
    body.researchJob = {
      id: 'rj-live', searchId: search.id, state: 'running', stage: 'researching',
      city: 'Reconnect City', website: 'https://example.gov',
      createdAt: new Date(Date.now() - 30000).toISOString(),
      deadlineAt: new Date(Date.now() + 150000).toISOString(),
      reviewable: false, applied: false, partial: false, missing: [], sources: []
    };
    await route.fulfill({ response, json: body });
  });
  await page.route('**/research-jobs/rj-live', async route => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ job: {
      id: 'rj-live', searchId: search.id, state: 'running', stage: 'researching',
      createdAt: new Date(Date.now() - 30000).toISOString(),
      deadlineAt: new Date(Date.now() + 150000).toISOString()
    } }) });
  });

  await page.goto('/#/s/' + search.id + '/community');

  // Nobody had to keep the tab open: revisiting the search finds the operation.
  await expect(dialog(page)).toBeVisible({ timeout: 10000 });
  await expect(page.locator('#lookup-stage')).toHaveText(/Searching public records/);
  // Its age is the operation's age, not the age of this dialog.
  await expect(page.locator('#lookup-elapsed')).toHaveText(/(3\d|4\d)s/);
  await page.locator('#lookup-cancel').click();
  await expect(dialog(page)).toBeHidden({ timeout: 7000 });
});

test('a lost start response does not become a second paid operation on retry', async ({ page }) => {
  await workspace(page);
  const search = await researchableSearch(page, 'Double City');

  // The case the idempotency key exists for: the request may or may not have
  // reached the server, and the browser cannot tell. An automatic retry would
  // risk paying twice, so the consultant retries — with the same key, so the
  // server hands back the operation it already has.
  const keys = [];
  await page.route('**/research-jobs', async route => {
    keys.push(route.request().headers()['idempotency-key'] || null);
    if (keys.length === 1) return route.abort('connectionreset');
    await route.fulfill({
      status: 202, contentType: 'application/json',
      body: JSON.stringify({
        job: { id: 'rj-once', searchId: search.id, state: 'running', stage: 'crawling',
          createdAt: new Date().toISOString(), deadlineAt: new Date(Date.now() + 180000).toISOString() },
        reused: true,
        status: '/api/searches/' + search.id + '/research-jobs/rj-once'
      })
    });
  });
  await page.route('**/research-jobs/rj-once', async route => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ job: {
      id: 'rj-once', searchId: search.id, state: 'running', stage: 'crawling',
      createdAt: new Date().toISOString(), deadlineAt: new Date(Date.now() + 180000).toISOString()
    } }) });
  });

  await openCommunity(page, search.id);
  await startButton(page).click();

  // Not retried on its own, and the page is handed back.
  const panel = page.locator('.notice--stop', { hasText: /Research did not finish/i });
  await expect(panel).toBeVisible({ timeout: 10000 });
  await expect(page.locator('#app')).not.toHaveAttribute('inert', '');
  expect(keys.length).toBe(1);

  await panel.getByRole('button', { name: /try research again/i }).click();
  await expect(dialog(page)).toBeVisible({ timeout: 10000 });
  expect(keys.length).toBe(2);
  expect(keys[0]).toBeTruthy();
  expect(keys[1]).toBe(keys[0]);

  await page.locator('#lookup-cancel').click();
  await expect(dialog(page)).toBeHidden({ timeout: 7000 });
});

test('starting research while it is already running does not start a second one', async ({ page }) => {
  await workspace(page);
  const search = await researchableSearch(page, 'Guarded City');

  let starts = 0;
  await page.route('**/research-jobs', async route => {
    starts += 1;
    await route.fulfill({
      status: 202, contentType: 'application/json',
      body: JSON.stringify({
        job: { id: 'rj-guard', searchId: search.id, state: 'running', stage: 'crawling',
          createdAt: new Date().toISOString(), deadlineAt: new Date(Date.now() + 180000).toISOString() },
        reused: false,
        status: '/api/searches/' + search.id + '/research-jobs/rj-guard'
      })
    });
  });
  await page.route('**/research-jobs/rj-guard', async route => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ job: {
      id: 'rj-guard', searchId: search.id, state: 'running', stage: 'crawling',
      createdAt: new Date().toISOString(), deadlineAt: new Date(Date.now() + 180000).toISOString()
    } }) });
  });

  await openCommunity(page, search.id);
  await startButton(page).click();
  await expect(dialog(page)).toBeVisible();

  // The action is refused while one is in flight, whatever reaches the handler:
  // the dialog's own inertness is belt, this is braces.
  await page.evaluate(() => {
    document.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    const button = document.querySelector('[data-act="research"]');
    if (button) button.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
  await page.waitForTimeout(600);
  expect(starts).toBe(1);

  await page.locator('#lookup-cancel').click();
  await expect(dialog(page)).toBeHidden({ timeout: 7000 });
});
