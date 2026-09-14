'use strict';

/**
 * The workspace in the browser.
 *
 * Isolation itself is proved on the server (tests/organizations.js). What a
 * browser has to settle is the part no server test can: that a person can tell
 * which firm they are looking at, that switching between two of them takes the
 * first one's work off the screen rather than leaving it under the second one's
 * name, and that the administration screen says plainly what each control will
 * do before it is pressed.
 */
const { test, expect } = require('@playwright/test');
const AxeBuilder = require('@axe-core/playwright').default;
const { installClerk, authHeaders, sharedWorkspace } = require('./clerk');

const unique = (name, testInfo) => name + ' ' + testInfo.project.name;

// Below the desktop breakpoint the rail is a drawer, so anything in it has to
// be opened before it can be used.
async function openNav(page) {
  // Wait for the screen to settle first. Boot finishes by navigating, and a
  // navigation closes the drawer — so a Menu press that lands mid-boot opens a
  // drawer the very next render takes away again.
  await expect(page.locator('#main h1')).toBeVisible({ timeout: 10000 });
  const menu = page.getByRole('button', { name: 'Menu', exact: true });
  if (await menu.isVisible().catch(() => false)) {
    await menu.click();
    await expect(page.locator('.shell')).toHaveClass(/shell--navopen/);
  }
}


/**
 * An account that has confirmed its name, so the workspace screens are what it
 * reaches rather than account setup.
 */
async function named(page, email, name) {
  const res = await page.request.post('/api/me/onboarding', {
    headers: authHeaders(email, null), data: { name, requestedRole: 'consultant' }
  });
  expect(res.ok(), await res.text()).toBe(true);
}

async function makeSearch(page, data) {
  const res = await page.request.post('/api/searches', { headers: authHeaders('abe@slate.local'), data });
  expect(res.ok(), await res.text()).toBe(true);
  return res.json();
}

test('the workspace is named where the work is, and the searches under it are its own', async ({ page }, testInfo) => {
  const orgId = await sharedWorkspace();
  const search = await makeSearch(page, { client: unique('Named City', testInfo), position: 'City Manager' });
  await installClerk(page);
  await page.goto('/');

  // The firm's name is on Home, in the rail, and in the address.
  await expect(page.locator('#main h1')).toContainText('Fixture Search Partners searches');
  await expect(page.locator('.ws__name')).toContainText('Fixture Search Partners');
  await expect(page.locator('.ws__role')).toContainText('Organization administrator');
  await expect(page).toHaveURL(new RegExp('#/o/' + orgId + '/home$'));

  await page.getByRole('button', { name: search.client, exact: true }).click();
  await expect(page).toHaveURL(new RegExp('#/o/' + orgId + '/s/' + search.id));
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await page.screenshot({ path: testInfo.outputPath('workspace-named.png'), fullPage: true });
});

test('switching workspace clears the first firm’s work rather than reusing it', async ({ page }, testInfo) => {
  const email = `switcher-${testInfo.project.name}@example.test`;
  const shared = await sharedWorkspace();

  // This person is a consultant in the fixture firm and an administrator of
  // their own. The same account, two different jobs.
  await page.request.post('/api/organization/invitations', {
    headers: authHeaders('abe@slate.local'), data: { email, role: 'org:consultant' }
  });
  await page.request.get('/api/me', { headers: authHeaders(email, shared) });
  await named(page, email, 'Sam Switcher');
  const theirOwn = await page.request.post('/api/organizations', {
    headers: authHeaders(email, null), data: { name: unique('Switcher Partners', testInfo) }
  });
  expect(theirOwn.ok(), await theirOwn.text()).toBe(true);
  const second = (await theirOwn.json()).organization;

  const searchInShared = await makeSearch(page, { client: unique('Only In Shared', testInfo), position: 'Manager' });

  await installClerk(page, { email, organization: [shared, second.id] });
  await page.goto('/');
  await expect(page.locator('.ws__name')).toContainText('Fixture Search Partners');
  await expect(page.getByRole('button', { name: searchInShared.client, exact: true })).toBeVisible();

  // The switcher is Slate's own, above the rail's links and separate from the
  // account menu.
  await openNav(page);
  await page.getByRole('button', { name: 'Switch workspace' }).click();
  await page.locator('.ws__list button', { hasText: unique('Switcher Partners', testInfo) }).click();

  await page.waitForURL(new RegExp('#/o/' + second.id + '/home$'), { timeout: 15000 });
  await expect(page.locator('.ws__name')).toContainText(unique('Switcher Partners', testInfo));
  await expect(page.locator('#main h1')).toContainText(unique('Switcher Partners', testInfo) + ' searches');
  // The other firm's book is gone from the page, not merely unhighlighted.
  await expect(page.getByRole('button', { name: searchInShared.client, exact: true })).toHaveCount(0);
  await expect(page.getByText('No searches yet')).toBeVisible();
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await page.screenshot({ path: testInfo.outputPath('after-switch.png'), fullPage: true });

  // A link into the workspace they left is offered as a switch, and says
  // nothing about what is in it.
  await page.goto('/#/o/' + shared + '/s/' + searchInShared.id);
  await expect(page.locator('.notice')).toContainText('Fixture Search Partners');
  await expect(page.getByText(searchInShared.client)).toHaveCount(0);
  await page.getByRole('button', { name: 'Stay here' }).click();
  await expect(page.locator('.ws__name')).toContainText(unique('Switcher Partners', testInfo));
});

test('an unsaved edit can refuse a workspace switch', async ({ page }, testInfo) => {
  const email = `guarded-${testInfo.project.name}@example.test`;
  const shared = await sharedWorkspace();
  await page.request.post('/api/organization/invitations', {
    headers: authHeaders('abe@slate.local'), data: { email, role: 'org:consultant' }
  });
  await page.request.get('/api/me', { headers: authHeaders(email, shared) });
  await named(page, email, 'Gale Guarded');
  const second = (await (await page.request.post('/api/organizations', {
    headers: authHeaders(email, null), data: { name: unique('Guarded Partners', testInfo) }
  })).json()).organization;

  const search = await makeSearch(page, { client: unique('Guarded City', testInfo), position: 'Manager' });
  await installClerk(page, { email, organization: [shared, second.id] });
  await page.goto('/#/o/' + shared + '/s/' + search.id + '/facts');
  await expect(page.locator('#main h1')).toBeVisible({ timeout: 10000 });

  const note = page.locator('#main textarea').first();
  await note.fill('A note nobody has saved yet');
  page.once('dialog', d => d.dismiss());
  await openNav(page);
  await page.getByRole('button', { name: 'Switch workspace' }).click();
  await page.locator('.ws__list button', { hasText: unique('Guarded Partners', testInfo) }).click();

  // Cancelled: same screen, same workspace, same typed value.
  await expect(page.locator('.ws__name')).toContainText('Fixture Search Partners');
  await expect(note).toHaveValue('A note nobody has saved yet');
});

test('Team & access separates membership from invitation, and says what each control does', async ({ page }, testInfo) => {
  const invitee = `invitee-${testInfo.project.name}@example.test`;
  await installClerk(page);
  await page.goto('/');
  await openNav(page);
  await page.getByRole('button', { name: 'Team & access' }).click();
  await expect(page.locator('#main h1')).toContainText('Team & access');

  // Members, with the role each holds in this workspace.
  await expect(page.getByRole('tab', { name: /Members/ })).toBeVisible();
  await expect(page.locator('#panel-access-members .candtable')).toContainText('abe@slate.local');
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await page.screenshot({ path: testInfo.outputPath('team-access-members.png'), fullPage: true });

  await page.getByRole('tab', { name: /Invitations/ }).click();
  await expect(page.getByText(/Send invitation emails this address/)).toBeVisible();
  await page.getByLabel('Email').fill(invitee);
  await page.getByLabel('Role in this workspace').selectOption('org:committee');
  await page.getByRole('button', { name: 'Send invitation' }).click();

  // Reported as pending, in its own list, and explicitly not membership.
  await expect(page.getByRole('status')).toContainText(invitee);
  await expect(page.getByRole('status')).toContainText('once they accept');
  const pending = page.locator('#panel-access-invitations .candtable');
  await expect(pending).toContainText(invitee);
  await expect(pending).toContainText('Invitation sent');
  await expect(page.getByText('A pending invitation is not membership')).toBeVisible();
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await page.screenshot({ path: testInfo.outputPath('team-access-invitations.png'), fullPage: true });

  // A duplicate is refused with an explanation rather than silently resent.
  await page.getByLabel('Email').fill(invitee);
  await page.getByRole('button', { name: 'Send invitation' }).click();
  await expect(page.getByRole('alert')).toContainText(/already/i);
});

test('a consultant is not offered Team & access, and a link to it lands on Home', async ({ page, browser }, testInfo) => {
  const shared = await sharedWorkspace();
  const theirs = await browser.newContext();
  const them = await theirs.newPage();
  await installClerk(them, { email: 'mike@slate.local' });
  await them.goto('/');
  await openNav(them);
  await expect(them.locator('.ws__role')).toContainText('Search consultant');
  await expect(them.getByRole('button', { name: 'Team & access' })).toHaveCount(0);

  await them.goto('/#/o/' + shared + '/team-access');
  await expect(them.locator('#main h1')).toContainText('searches', { timeout: 10000 });
  await expect(them.locator('#toast')).toContainText(/administrator manages members/i);
  const refused = await them.request.get('/api/organization/members', { headers: authHeaders('mike@slate.local', shared) });
  expect(refused.status()).toBe(403);
  await theirs.close();
});

test('a workspace with several searches keeps its name visible at 320px', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'mobile-chrome', 'the narrow-width check runs on the phone project');
  await installClerk(page);
  await page.setViewportSize({ width: 320, height: 720 });
  await page.goto('/');
  await expect(page.locator('.appbar__ws')).toContainText('Fixture Search Partners');
  expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1);
  await page.getByRole('button', { name: 'Menu', exact: true }).click();
  await expect(page.locator('.ws__name')).toContainText('Fixture Search Partners');
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await page.screenshot({ path: testInfo.outputPath('workspace-320.png'), fullPage: true });
});
