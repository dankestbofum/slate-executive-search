'use strict';
const { test, expect } = require('@playwright/test');
const AxeBuilder = require('@axe-core/playwright').default;
const { installClerk, authHeaders, sharedWorkspace } = require('./clerk');

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


test('a new account confirms who it is, then has to join a workspace before anything opens', async ({ page }, testInfo) => {
  const email = `new-setup-${testInfo.project.name}@example.test`;
  await installClerk(page, { email, organization: null });
  await page.goto('/#/new');

  // Step 1: who you are.
  await expect(page.getByRole('heading', { name:'How will you use Slate?' })).toBeVisible();
  await expect(page.getByRole('radio')).toHaveCount(2);
  await expect(page.getByRole('radio', { name:/^Candidate\b/i })).toHaveCount(0);
  await page.getByLabel('Your name').fill('Jordan Rivera');
  await page.getByRole('radio', { name:/Search consultant/ }).check();
  // Focused explicitly: the inputs sit inside their labels, and WebKit leaves
  // the label focused after a click where Chromium leaves the input. What this
  // is checking is that the arrow keys move within the group once somebody is
  // in it, not where a mouse press happens to land.
  await page.getByRole('radio', { name:/Search consultant/ }).focus();
  await expect(page.getByRole('radio', { name:/Search consultant/ })).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await expect(page.getByRole('radio', { name:/Committee member/ })).toBeChecked();
  await expect(page.getByRole('radio', { name:/Committee member/ })).toBeFocused();
  await page.keyboard.press('ArrowUp');
  await expect(page.getByText(/does not grant access/)).toBeVisible();
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1);
  await page.screenshot({ path:testInfo.outputPath('account-setup.png'), fullPage:true });
  await page.emulateMedia({ colorScheme:'dark' });
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await page.screenshot({ path:testInfo.outputPath('account-setup-dark.png'), fullPage:true });
  await page.emulateMedia({ colorScheme:'light' });
  await page.getByRole('button', { name:'Continue', exact:true }).click();

  // Step 2: choose a workspace. A stated preference opened nothing.
  await expect(page.getByRole('heading', { name:'You are not in a workspace yet' })).toBeVisible();
  await expect(page.getByRole('button', { name:/Open a new search/ })).toHaveCount(0);
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await page.screenshot({ path:testInfo.outputPath('choose-workspace.png'), fullPage:true });
  const denied = await page.request.post('/api/searches', { data:{ client:'Cannot create' } });
  expect(denied.status()).toBe(403);

  // The state survives a reload rather than sending them back to step 1.
  await page.reload();
  await expect(page.getByRole('heading', { name:'You are not in a workspace yet' })).toBeVisible();

  // Checking for invitations says plainly that there are none for this address.
  await page.getByRole('button', { name:'Check invitations' }).click();
  await expect(page.getByRole('status')).toContainText('No invitations are waiting');
  await expect(page.getByRole('status')).toContainText(email);
});

test('an invitation to a search holds a seat, and joining the workspace opens exactly that search', async ({ page, browser }, testInfo) => {
  const email = `invited-${testInfo.project.name}@example.test`;
  const orgId = await sharedWorkspace();
  const manager = authHeaders('abe@slate.local');

  const search = await (await page.request.post('/api/searches', {
    headers: manager, data:{ client:'Onboarding County', position:'Administrator' }
  })).json();
  const invite = await page.request.post(`/api/searches/${search.id}/members`, {
    headers:{ ...manager, 'if-match':String(search.revision) },
    data:{ name:'Jordan Rivera', email, seat:'committee' }
  });
  expect(invite.ok(), await invite.text()).toBe(true);
  const held = await invite.json();
  expect(held.seated).toBe(false);
  expect(held.invitationSent).toBe(true);

  // The manager's own view says the place is held, not that somebody is on it.
  await installClerk(page, { organization:'shared' });
  await page.goto(`/#/o/${orgId}/s/${search.id}/team`);
  await expect(page.getByText('Waiting to join')).toBeVisible();
  await expect(page.getByText('Invitation sent')).toBeVisible();
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);

  // The invited person, in their own browser context: a separate session, with
  // none of the manager's stored workspace state to inherit.
  const theirBrowser = await browser.newContext();
  const invited = await theirBrowser.newPage();
  await installClerk(invited, { email, organization:null, invited:['shared'] });
  await invited.goto('/');

  // Step 1 for them too: an invitation says what they may do, not what to call
  // them, so the name is still theirs to give.
  await expect(invited.getByRole('heading', { name:'How will you use Slate?' })).toBeVisible();
  await invited.getByLabel('Your name').fill('Jordan Rivera');
  await invited.getByRole('radio', { name:/Committee member/ }).check();
  await invited.getByRole('button', { name:'Continue', exact:true }).click();

  // Step 2. The offline directory accepts an invitation on sight, because
  // there is no Clerk UI here to accept it in (see server/organizations.js), so
  // what this account reaches is the chooser with one workspace on it rather
  // than the invitation list. Accepting a real hosted invitation is one of the
  // checks that has to be done against a Clerk instance.
  await expect(invited.getByRole('heading', { name:'Where are you working?' })).toBeVisible();
  await expect(invited.getByText('Fixture Search Partners')).toBeVisible();
  await expect(invited.getByText('Committee member')).toBeVisible();
  await invited.getByRole('button', { name:'Open', exact:true }).click();
  await expect(invited.getByRole('heading', { name:'Your assignments' })).toBeVisible();
  await expect(invited.getByRole('button', { name:'Onboarding County', exact:true })).toBeVisible();

  const me = await (await invited.request.get('/api/me', { headers: authHeaders(email, orgId) })).json();
  expect(me.role).toBe('org:committee');
  expect(me.capabilities.staff).toBe(false);
  expect(me.onboarding.access).toBe('committee');

  // And nothing outside their own search: the workspace is not the assignment.
  const everything = await (await invited.request.get('/api/searches', { headers: authHeaders(email, orgId) })).json();
  expect(everything).toHaveLength(1);
  expect(everything[0].client).toBe('Onboarding County');
  await theirBrowser.close();
});

test('a deployment that does not offer workspace creation says so instead of showing the form', async ({ page }, testInfo) => {
  const email = `closed-${testInfo.project.name}@example.test`;
  await installClerk(page, { email, organization: null });
  // The gate is live only in production, which the browser server is not, so
  // the answer it would give there is substituted here. What is under test is
  // the client honouring it: a form that will be refused must not be offered.
  await page.route('**/api/me', async route => {
    const response = await route.fetch();
    const body = await response.json();
    await route.fulfill({ response, json: { ...body, canCreateWorkspace: false } });
  });
  await page.goto('/');
  await page.getByLabel('Your name').fill('Closed Deployment');
  await page.getByRole('radio', { name:/Search consultant/ }).check();
  await page.getByRole('button', { name:'Continue', exact:true }).click();

  await expect(page.getByRole('heading', { name:'You are not in a workspace yet' })).toBeVisible();
  await expect(page.getByText(/join one by invitation from a firm already using Slate/)).toBeVisible();
  await expect(page.getByRole('button', { name:'Create a workspace' })).toHaveCount(0);
  await expect(page.getByLabel('Workspace name')).toHaveCount(0);
  // The way in that is on offer is still there, and still names the address.
  await expect(page.getByRole('button', { name:'Check invitations' })).toBeVisible();
  await expect(page.getByText(email)).toBeVisible();
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await page.screenshot({ path:testInfo.outputPath('workspace-creation-closed.png'), fullPage:true });
});

test('failed setup retains entries and can be retried', async ({ page }, testInfo) => {
  await installClerk(page, { email:`retry-setup-${testInfo.project.name}@example.test`, organization:null });
  await page.goto('/');
  await page.getByLabel('Your name').fill('Retry Person');
  await page.getByRole('radio', { name:/Committee member/ }).check();
  await page.route('**/api/me/onboarding', route => route.fulfill({ status:503, contentType:'application/json', body:JSON.stringify({ error:'Please try again.' }) }));
  await page.getByRole('button', { name:'Continue', exact:true }).click();
  await expect(page.getByRole('alert')).toContainText('Please try again.');
  await expect(page.getByLabel('Your name')).toHaveValue('Retry Person');
  await expect(page.getByRole('radio', { name:/Committee member/ })).toBeChecked();
  await page.unroute('**/api/me/onboarding');
  await page.getByRole('button', { name:'Continue', exact:true }).click();
  await expect(page.getByRole('heading', { name:'You are not in a workspace yet' })).toBeVisible();
});

test('creating a workspace makes the creator its administrator and claims nothing else', async ({ page }, testInfo) => {
  const email = `founder-${testInfo.project.name}@example.test`;
  await installClerk(page, { email, organization:null });
  await page.goto('/');
  await page.getByLabel('Your name').fill('Sam Founder');
  await page.getByRole('radio', { name:/Search consultant/ }).check();
  await page.getByRole('button', { name:'Continue', exact:true }).click();

  await expect(page.getByText(/creates a separate workspace for your firm/)).toBeVisible();
  await page.getByLabel('Workspace name').fill(`Founder Partners ${testInfo.project.name}`);
  await page.getByRole('button', { name:'Create a workspace' }).click();

  // Their own workspace, with nothing in it: creating one never adopts another
  // firm's book of business.
  await expect(page.getByRole('heading', { name:new RegExp(`Founder Partners ${testInfo.project.name} searches`) })).toBeVisible();
  await expect(page.getByText('No searches yet')).toBeVisible();
  await openNav(page);
  await expect(page.getByRole('button', { name:'Team & access' })).toBeVisible();
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await page.screenshot({ path:testInfo.outputPath('new-workspace-home.png'), fullPage:true });
});
