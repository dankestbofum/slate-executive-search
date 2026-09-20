'use strict';

/**
 * The user guide, in a real browser.
 *
 * Three of its promises can only be checked here, because they are about
 * focus, the keyboard, and what survives a render:
 *
 *  - Opening help never costs somebody what they have typed. This is the whole
 *    reason the drawer is built against the live DOM instead of going through
 *    the application's renderer, and it is the thing most likely to regress.
 *  - Escape closes it and focus goes back to the control that opened it.
 *  - Every help trigger has a name of its own. "Explain this control" eleven
 *    times on one screen is a list a screen-reader user cannot navigate.
 *
 * A note for anyone writing a browser test against a control that has hover
 * text. Below the pointer:coarse breakpoint the tooltip's tap-alternative is
 * visible, and its accessible name contains the control's own label — "Save my
 * scores" and "Explain Save my scores" are both on the page. Playwright's
 * default name matching is a substring, so
 *
 *     getByRole('button', { name: 'Save my scores' })
 *
 * finds two elements on a phone and none on a desktop, which is a test that
 * passes in two projects and fails in the third. Name the control exactly:
 * `{ name: 'Save my scores', exact: true }`, or anchor the pattern when a
 * regular expression is genuinely needed.
 */

const { test, expect } = require('@playwright/test');
const { installClerk } = require('./clerk');

async function revision(page, id) {
  return String((await (await page.request.get('/api/searches/' + id)).json()).revision);
}

/**
 * Open "Help & user guide" wherever the navigation happens to be.
 *
 * Below the breakpoint the rail is a drawer, so the link is behind Menu. Both
 * paths are the same control; only the way to it differs.
 */
async function openGuide(page) {
  // Let the application finish booting first. Its opening navigation closes the
  // drawer, so a menu opened during boot is shut again a moment later — which
  // is right for a real navigation and only a hazard for a test that is faster
  // than a person.
  await page.waitForLoadState('networkidle');
  const link = page.locator('.rail__link', { hasText: 'Help & user guide' }).first();
  const menu = page.getByRole('button', { name: 'Menu', exact: true });
  if (await menu.isVisible().catch(() => false)) {
    await menu.click();
    // Waiting for the link to be hittable rather than merely present is what
    // keeps this from clicking a rail that is still off-screen.
    await expect(link).toBeVisible();
  }
  await link.click();
}

/**
 * The "Help with this page" control itself.
 *
 * On a touch screen the tooltip's tap-alternative is also visible and is named
 * "Explain Help with this page", so a substring match finds two controls. The
 * exact name is the one that opens the drawer.
 */
function helpTrigger(page) {
  return page.getByRole('button', { name: 'Help with this page', exact: true });
}

async function aSearch(page, label) {
  await installClerk(page);
  const search = await (await page.request.post('/api/searches', {
    data: { client: label, position: 'County Manager', package: 'executive', jurisdictionType: 'county' }
  })).json();
  return search;
}

test('the guide is reachable from the navigation and lists articles', async ({ page }, testInfo) => {
  await installClerk(page);
  await page.goto('/');
  await openGuide(page);

  await expect(page.getByRole('heading', { name: 'Help & user guide' })).toBeVisible();
  await expect(page.getByRole('button', { name: /Sign in for the first time/ })).toBeVisible();

  // The role picker changes explanations and says so.
  await page.getByRole('button', { name: 'Committee member' }).click();
  await expect(page.getByText('It never changes what you are allowed to do.')).toBeVisible();
  await expect(page.getByRole('button', { name: /Save and submit your committee input/ })).toBeVisible();

  expect(testInfo.project.name).toBeTruthy();
});

test('searching the guide finds an article by the button label it names', async ({ page }) => {
  await installClerk(page);
  await page.goto('/');
  await openGuide(page);

  await page.getByLabel('Search the guide').fill('Release scores');
  await expect(page.getByRole('status').filter({ hasText: /article/ })).toContainText('match');
  await expect(page.getByRole('button', { name: /Score candidates and release scores/ })).toBeVisible();
});

test('choosing an article opens it under its own heading', async ({ page }) => {
  await installClerk(page);
  await page.goto('/');
  await openGuide(page);

  await page.getByRole('button', { name: /Adopt the candidate profile/ }).click();
  // The reading pane has to lead with the article's title. Landing in the
  // middle of the prose leaves a reader unsure they opened the right thing.
  const reading = page.locator('.help__reading');
  await expect(reading.getByRole('heading', { name: 'Adopt the candidate profile', level: 2 })).toBeVisible();
  // And the template's own sections, in order, so an article cannot quietly
  // render without the half that says who sees the result.
  for (const section of ['Who this is for', 'Before you start', 'Do this',
    'How to know it worked', 'Who sees the result', 'If something goes wrong']) {
    await expect(reading.getByRole('heading', { name: section })).toBeVisible();
  }
});

test('opening help beside the work keeps what has been typed', async ({ page }, testInfo) => {
  const search = await aSearch(page, 'Help Drawer ' + testInfo.project.name);
  // Somewhere with a real form on it: the account manager's own intake answers.
  await page.request.post('/api/searches/' + search.id + '/team/confirm', {
    headers: { 'if-match': await revision(page, search.id) }, data: {}
  });
  await page.request.post('/api/searches/' + search.id + '/intake/status', {
    headers: { 'if-match': await revision(page, search.id) }, data: { status: 'open' }
  });

  await page.goto('/#/s/' + search.id + '/intake-mine');
  const field = page.locator('#intake-context');
  await expect(field).toBeVisible({ timeout: 10000 });
  await field.fill('A paragraph nobody should lose by asking for help.');

  const trigger = helpTrigger(page);
  await expect(trigger).toBeVisible();
  await trigger.click();

  const drawer = page.getByRole('dialog', { name: 'Help' });
  await expect(drawer).toBeVisible();
  await expect(drawer).toContainText('committee input');
  // The page behind it is untouched.
  await expect(field).toHaveValue('A paragraph nobody should lose by asking for help.');

  // Escape closes it, and focus comes back to the control that opened it.
  await page.keyboard.press('Escape');
  await expect(drawer).toBeHidden();
  await expect(trigger).toBeFocused();
  await expect(field).toHaveValue('A paragraph nobody should lose by asking for help.');
});

test('the drawer can be read and left with the keyboard alone', async ({ page }, testInfo) => {
  const search = await aSearch(page, 'Help Keyboard ' + testInfo.project.name);
  await page.goto('/#/s/' + search.id);
  const trigger = helpTrigger(page);
  await expect(trigger).toBeVisible({ timeout: 10000 });

  await trigger.focus();
  await page.keyboard.press('Enter');
  const drawer = page.getByRole('dialog', { name: 'Help' });
  await expect(drawer).toBeVisible();
  // Focus lands inside the drawer rather than being left on the page behind.
  await expect(page.locator(':focus')).toHaveCount(1);
  const focusedInDrawer = await drawer.evaluate(el => el.contains(document.activeElement));
  expect(focusedInDrawer).toBe(true);

  await page.getByRole('button', { name: 'Close help' }).click();
  await expect(drawer).toBeHidden();
});

/**
 * The guide is fetched in the background at boot, and its arrival must not
 * disturb the page.
 *
 * No form in this application holds an unsaved value anywhere but the DOM, so
 * an unrequested render is a way to destroy somebody's work. The first version
 * of this did re-render, and a slow catalog request would have wiped whatever
 * a consultant had started typing. The response is delayed here to make that
 * window wide enough to type in.
 */
test('the guide arriving does not disturb what is already on the page', async ({ page }, testInfo) => {
  const search = await aSearch(page, 'Help Preload ' + testInfo.project.name);
  await page.route('**/api/help', async route => {
    await new Promise(resolve => setTimeout(resolve, 2500));
    await route.fallback();
  });

  await page.goto('/#/s/' + search.id + '/facts');
  const note = page.locator('#main textarea').first();
  await expect(note).toBeVisible({ timeout: 10000 });
  await note.fill('A note typed before the guide arrived');

  // The control appears when the catalog lands; the typing is still there.
  await expect(helpTrigger(page)).toBeVisible({ timeout: 10000 });
  await expect(note).toHaveValue('A note typed before the guide arrived');

  // And it is a working control, not a decoration inserted into the page.
  await helpTrigger(page).click();
  await expect(page.getByRole('dialog', { name: 'Help' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(note).toHaveValue('A note typed before the guide arrived');

  // The inserted control carries its own tooltip, whose id is minted outside
  // the render that numbers all the others. A collision there would point some
  // other control's aria-describedby at this one's description.
  const duplicates = await page.evaluate(() => {
    const seen = new Set();
    const clashes = [];
    for (const el of document.querySelectorAll('[id]')) {
      if (seen.has(el.id)) clashes.push(el.id);
      seen.add(el.id);
    }
    return clashes;
  });
  expect(duplicates, 'the inserted help control reused an id already on the page').toEqual([]);
});

test('every help trigger on a screen has a name of its own', async ({ page }, testInfo) => {
  const search = await aSearch(page, 'Help Names ' + testInfo.project.name);
  await page.goto('/#/s/' + search.id + '/screen');
  await expect(page.locator('.pagehead__title')).toBeVisible({ timeout: 10000 });

  const names = await page.locator('.tiphelp').evaluateAll(
    nodes => nodes.map(n => n.getAttribute('aria-label')));
  expect(names.length).toBeGreaterThan(0);
  for (const name of names) {
    expect(name, 'a help trigger kept the generic name').not.toBe('Explain this control');
  }
  expect(new Set(names).size, 'two help triggers on one screen share a name: ' + names.join(' | '))
    .toBe(names.length);
});

test('a tooltip does not replace a field’s own description', async ({ page }, testInfo) => {
  const search = await aSearch(page, 'Help Describedby ' + testInfo.project.name);
  await page.goto('/#/s/' + search.id + '/facts');
  await expect(page.locator('.pagehead__title')).toBeVisible({ timeout: 10000 });

  // Wherever a control inside a tooltip wrapper already had a description, the
  // tooltip id is added to it rather than written over it.
  const kept = await page.locator('.tipwrap > [aria-describedby]').evaluateAll(nodes =>
    nodes.every(node => {
      const ids = (node.getAttribute('aria-describedby') || '').split(/\s+/).filter(Boolean);
      return ids.every(id => document.getElementById(id));
    }));
  expect(kept, 'a control points at a description that is not on the page').toBe(true);
});

test('the getting-started checklist can be hidden and brought back from the guide', async ({ page }, testInfo) => {
  const search = await aSearch(page, 'Checklist ' + testInfo.project.name);
  await page.goto('/#/s/' + search.id);
  const list = page.locator('.startlist');
  await expect(list).toBeVisible({ timeout: 10000 });
  await expect(list).toContainText('Adopt the candidate profile');

  await page.getByRole('button', { name: 'Hide this' }).click();
  await expect(list).toBeHidden();

  await openGuide(page);
  await page.getByRole('button', { name: 'Show it again' }).click();
  await page.goto('/#/s/' + search.id);
  await expect(page.locator('.startlist')).toBeVisible();
});
