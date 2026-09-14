'use strict';

// Building the roster in a browser.
//
// The add form is the one place a manager types several people in a row, and
// the things that can go wrong there are all browser-side: a disclosure that
// does not open, rows that lose what was typed when another is added, and a
// second request that goes out carrying the revision the first one replaced.
// None of that is reachable from the server suite.

const { test, expect } = require('@playwright/test');
const AxeBuilder = require('@axe-core/playwright').default;
const { installClerk, authHeaders, sharedWorkspace } = require('./clerk');

const unique = (label, testInfo) => label + ' ' + testInfo.project.name + ' ' + Date.now();

async function makeSearch(page, data) {
  // Signed into the fixture workspace, which has to exist before the header
  // can name it.
  await sharedWorkspace();
  const res = await page.request.post('/api/searches', { headers: authHeaders('abe@slate.local'), data });
  expect(res.ok(), await res.text()).toBe(true);
  return res.json();
}

async function openRoster(page, searchId) {
  const orgId = await sharedWorkspace();
  await installClerk(page);
  await page.goto(`/#/o/${orgId}/s/${searchId}/team`);
  await expect(page.getByRole('heading', { name: 'Search committee' })).toBeVisible();
}

test('several people are added in one pass, and the form stays closed until asked for', async ({ page }, testInfo) => {
  const search = await makeSearch(page, { client: unique('Roster City', testInfo), position: 'City Manager', package: 'executive' });
  await openRoster(page, search.id);

  // Collapsed by default: the roster is what the page is for, not the form.
  const open = page.locator('[data-panel="addpeople"]');
  await expect(open).toBeVisible();
  await expect(open).toHaveAttribute('aria-expanded', 'false');
  await expect(page.getByRole('button', { name: 'Add this person' })).toBeHidden();

  await open.click();
  await expect(open).toHaveAttribute('aria-expanded', 'true');
  await expect(open).toHaveText('Close this form');
  await expect(page.getByRole('button', { name: 'Add this person' })).toBeVisible();

  const rows = page.locator('#newpeople [data-row]');
  await expect(rows).toHaveCount(1);
  await rows.nth(0).getByLabel('Name').fill('Dana Reyes');
  await rows.nth(0).getByLabel('Email').fill(`dana-${testInfo.project.name}@example.gov`);

  // A second row must not disturb the first. This is the regression that a
  // re-render would cause if the rows were not collected before redrawing.
  await page.getByRole('button', { name: 'Add another person' }).click();
  await expect(rows).toHaveCount(2);
  await expect(rows.nth(0).getByLabel('Name')).toHaveValue('Dana Reyes');

  await rows.nth(1).getByLabel('Name').fill('Sam Ortiz');
  await rows.nth(1).getByLabel('Email').fill(`sam-${testInfo.project.name}@example.gov`);

  await page.getByRole('button', { name: 'Add another person' }).click();
  await rows.nth(2).getByLabel('Name').fill('Pat Lane');
  await rows.nth(2).getByLabel('Email').fill(`pat-${testInfo.project.name}@example.gov`);
  await expect(page.getByRole('button', { name: 'Add these 3 people' })).toBeVisible();

  await page.getByRole('button', { name: 'Add these 3 people' }).click();

  // All three land. The second and third prove the revision from each reply is
  // carried into the request after it; a stale one would be refused.
  await expect(page.getByText('Dana Reyes')).toBeVisible();
  await expect(page.getByText('Sam Ortiz')).toBeVisible();
  await expect(page.getByText('Pat Lane')).toBeVisible();
  await expect(page.getByText('Waiting to join')).toBeVisible();

  // Everything succeeded, so the form closes and empties rather than leaving
  // three filled rows somebody could submit again.
  await expect(open).toHaveAttribute('aria-expanded', 'false');
  await expect(open).toHaveText('Add people');
  await open.click();
  await expect(page.locator('#newpeople [data-row]')).toHaveCount(1);
  await expect(page.locator('#newpeople [data-row]').nth(0).getByLabel('Name')).toHaveValue('');

  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
});

test('a row the server refuses keeps its reason, and the ones that worked are gone', async ({ page }, testInfo) => {
  const search = await makeSearch(page, { client: unique('Partial City', testInfo), position: 'City Manager', package: 'executive' });
  await openRoster(page, search.id);
  await page.locator('[data-panel="addpeople"]').click();

  const rows = page.locator('#newpeople [data-row]');
  await rows.nth(0).getByLabel('Name').fill('Good Person');
  await rows.nth(0).getByLabel('Email').fill(`good-${testInfo.project.name}@example.gov`);

  // A consultant role for somebody outside the firm is refused by the server,
  // which is a real refusal rather than a fixture: it is the rule that a
  // search manager cannot add staff to the firm.
  await page.getByRole('button', { name: 'Add another person' }).click();
  await rows.nth(1).getByLabel('Name').fill('Outside Consultant');
  await rows.nth(1).getByLabel('Email').fill(`outside-${testInfo.project.name}@example.gov`);
  await rows.nth(1).getByLabel('Role on this search').selectOption('consultant');

  await page.getByRole('button', { name: 'Add these 2 people' }).click();

  // The good one is on the roster and out of the form; the refused one is
  // still there with the server's own reason against it.
  await expect(page.getByText('Good Person')).toBeVisible();
  await expect(page.locator('#newpeople [data-row]')).toHaveCount(1);
  await expect(page.locator('#newpeople [data-row]').nth(0).getByLabel('Name')).toHaveValue('Outside Consultant');
  await expect(page.locator('.person-row__err')).toContainText('already in this workspace');
});

// The page action bar is sticky at the bottom of the viewport, and with three
// people typed this form is long enough to run under it. What has to hold is
// that the position a manager finishes in — scrolled to the end of the form —
// puts their own submit in front, rather than the roster-confirm button that
// would otherwise be sitting exactly where they are about to click.
test('the submit button is in front where the form ends', async ({ page }, testInfo) => {
  const search = await makeSearch(page, { client: unique('Sticky City', testInfo), position: 'City Manager', package: 'executive' });
  await openRoster(page, search.id);
  await page.locator('[data-panel="addpeople"]').click();
  const rows = page.locator('#newpeople [data-row]');
  for (let i = 0; i < 3; i += 1) {
    if (i) await page.getByRole('button', { name: 'Add another person' }).click();
    await rows.nth(i).getByLabel('Name').fill('Person ' + i);
    await rows.nth(i).getByLabel('Email').fill('p' + i + '-' + testInfo.project.name + '@example.gov');
  }

  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await page.waitForTimeout(150);
  const onTop = await page.evaluate(() => {
    const b = document.querySelector('#newpeople button[type="submit"]');
    const r = b.getBoundingClientRect();
    return document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2) === b;
  });
  expect(onTop).toBe(true);
});

test('the roster is described in plain words, not as seating', async ({ page }, testInfo) => {
  const search = await makeSearch(page, { client: unique('Wording City', testInfo), position: 'City Manager', package: 'executive' });
  await openRoster(page, search.id);
  const body = await page.locator('#main').innerText();
  expect(body).not.toMatch(/\bseat(s|ed|ing)?\b/i);
});
