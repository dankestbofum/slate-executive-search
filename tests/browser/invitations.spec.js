'use strict';
const { test, expect } = require('@playwright/test');
const AxeBuilder = require('@axe-core/playwright').default;
const { installClerk, authHeaders, sharedWorkspace } = require('./clerk');

test('invitation links keep their ticket and show the right account form', async ({ page }, testInfo) => {
  await installClerk(page, { signedIn: false, organization: null });
  const response = await page.goto('/join?__clerk_ticket=fixture-ticket&__clerk_status=sign_up');
  expect(response.headers()['cache-control']).toContain('no-store');
  await expect(page.getByRole('heading', { name: 'Join your search team' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Create test account' })).toBeVisible();
  expect(await page.evaluate(() => window.__authMount.props.forceRedirectUrl)).toBe('/join');
  await page.getByRole('link', { name: 'Already have an account? Sign in' }).click();
  await expect(page.getByRole('button', { name: 'Sign in to test account' })).toBeVisible();
  expect(new URL(page.url()).searchParams.get('__clerk_ticket')).toBe('fixture-ticket');
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1);
  await page.screenshot({ path: testInfo.outputPath('invitation-landing.png'), fullPage: true });
  await page.goto('/?__clerk_ticket=legacy-ticket&__clerk_status=sign_in#/home');
  await expect(page.getByRole('heading', { name: 'Join your search team' })).toBeVisible();
  expect(new URL(page.url()).pathname).toBe('/join/sign-in');
  expect(new URL(page.url()).searchParams.get('__clerk_ticket')).toBe('legacy-ticket');
  await page.goto('/join/sign-up/verify-email-address');
  await expect(page.getByRole('button', { name: 'Create test account' })).toBeVisible();
});

test('accepting a search invitation opens its assigned search after account setup', async ({ page }, testInfo) => {
  const orgId = await sharedWorkspace();
  const email = `landing-${testInfo.project.name}@example.test`;
  const headers = authHeaders('abe@slate.local', orgId);
  const search = await (await page.request.post('/api/searches', {
    headers, data: { client: 'Invitation City', position: 'City Manager' }
  })).json();
  const invited = await page.request.post(`/api/searches/${search.id}/members`, {
    headers: { ...headers, 'if-match': String(search.revision) },
    data: { name: 'Jordan Rivera', email, searchRole: 'committee' }
  });
  expect(invited.ok(), await invited.text()).toBe(true);
  const team = await (await page.request.get('/api/organization/members', { headers })).json();
  const invitation = team.invitations.find(i => i.email === email);
  const landing = new URL(invitation.redirectUrl);
  expect(landing.pathname).toBe('/join');
  expect(landing.searchParams.get('organization')).toBe(orgId);
  expect(landing.searchParams.get('search')).toBe(search.id);
  await installClerk(page, { email, organization: null, invited: ['shared'] });
  await page.goto(landing.pathname + landing.search);
  await expect(page.getByRole('heading', { name: 'Join your search team' })).toBeVisible();
  await page.getByRole('button', { name: 'Accept and open' }).click();
  await expect(page.getByLabel('Your name')).toBeVisible();
  await expect(page.getByRole('radio')).toHaveCount(0);
  await page.getByLabel('Your name').fill('Jordan Rivera');
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await expect(page).toHaveURL(new RegExp('/s/' + search.id + '$'));
  await expect(page.locator('#main')).toContainText('Invitation City');
  // Reopening an accepted link works with an already-active membership.
  await page.goto(landing.pathname + landing.search);
  await expect(page).toHaveURL(new RegExp('/s/' + search.id + '$'));
});

test('an unmatched account gets recovery guidance without search details', async ({ page }, testInfo) => {
  await installClerk(page, { email: `wrong-invite-${testInfo.project.name}@example.test`, organization: null });
  await page.goto('/join?organization=org_someone_else&search=private-search');
  await expect(page.getByRole('status')).toContainText('No invitations are waiting');
  await expect(page.getByRole('button', { name: 'Use a different account' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Continue to workspace' })).toHaveCount(0);
  await expect(page.getByText('private-search', { exact: true })).toHaveCount(0);
});

test('a revoked invitation reports the failure and offers account recovery', async ({ page }, testInfo) => {
  await installClerk(page, { email: `revoked-invite-${testInfo.project.name}@example.test`, organization: null });
  await page.goto('/join');
  await expect(page.getByRole('heading', { name: 'Your team access' })).toBeVisible();
  await page.evaluate(() => {
    window.SlateAuth.invitations = async () => [{
      id: 'expired', organizationId: 'org_expired', organizationName: 'Invited workspace', role: 'org:committee',
      accept: async () => { throw new Error('This invitation has expired. Ask your administrator for a new one.'); }
    }];
  });
  await page.getByRole('button', { name: 'Check invitations' }).click();
  await page.getByRole('button', { name: 'Accept and open' }).click();
  await expect(page.getByRole('alert')).toContainText('This invitation has expired');
  await expect(page.getByRole('button', { name: 'Use a different account' })).toBeEnabled();
  await expect(page).toHaveURL(/\/join$/);
});

test('an interrupted pending sign-in opens a workspace task and then the assigned search', async ({ page }, testInfo) => {
  const orgId = await sharedWorkspace();
  const email = `pending-join-${testInfo.project.name}@example.test`;
  const headers = authHeaders('abe@slate.local', orgId);
  const search = await (await page.request.post('/api/searches', {
    headers, data: { client: 'Pending Invitation City', position: 'City Manager' }
  })).json();
  const invitation = await page.request.post(`/api/searches/${search.id}/members`, {
    headers: { ...headers, 'if-match': String(search.revision) },
    data: { name: 'Pending Member', email, searchRole: 'committee' }
  });
  expect(invitation.ok()).toBe(true);
  await installClerk(page, { email, organization: null, invited: ['shared'], pendingTask: 'choose-organization' });
  // Legacy email has no explicit organization/search params. The ticket's
  // organization hint is untrusted; only signed membership opens the search.
  const ticket = 'fixture.' + Buffer.from(JSON.stringify({ oid: orgId })).toString('base64url') + '.fixture';
  await page.goto('/join/sign-in?__clerk_status=sign_in&__clerk_ticket=' + ticket);
  await expect(page.getByRole('heading', { name: 'Choose your search workspace' })).toBeVisible();
  await expect(page.locator('[data-clerk-auth]')).toHaveCount(0);
  await expect(page.getByRole('button', { name: /Create.*workspace|Create.*organization/i })).toHaveCount(0);
  await page.getByRole('button', { name: 'Accept invitation to Fixture Search Partners' }).click();
  await expect(page.getByLabel('Your name')).toBeVisible();
  await page.getByLabel('Your name').fill('Pending Member');
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await expect(page).toHaveURL(new RegExp('/s/' + search.id + '$'));
  await expect(page.locator('#main')).toContainText('Pending Invitation City');
});

test('a required task completing within the same session and workspace refreshes access', async ({ page }) => {
  await installClerk(page, { pendingTask: 'setup-mfa' });
  await page.goto('/join');
  await expect(page.getByRole('heading', { name: 'Secure your account' })).toBeVisible();
  await page.getByRole('button', { name: 'Complete test MFA setup' }).click();
  await expect(page).toHaveURL(/\/#\/o\/[^/]+\/home$/);
  await expect(page.getByRole('heading', { name: 'Secure your account' })).toHaveCount(0);
});

test('an invitation organization hint never opens a different workspace', async ({ page }) => {
  await installClerk(page);
  const ticket = 'fixture.' + Buffer.from(JSON.stringify({ oid: 'org_unrelated' })).toString('base64url') + '.fixture';
  await page.goto('/join/sign-in?__clerk_ticket=' + ticket);
  await expect(page.getByRole('heading', { name: 'Your team access' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Continue to workspace' })).toHaveCount(0);
  await expect(page).toHaveURL(/\/join\/sign-in\?/);
});

test('an opaque invitation ticket does not silently open an existing workspace', async ({ page }) => {
  await installClerk(page);
  await page.goto('/join/sign-in?__clerk_ticket=opaque-ticket&__clerk_status=sign_in');
  await expect(page.getByRole('heading', { name: 'Your team access' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Continue to workspace' })).toBeVisible();
  await expect(page).toHaveURL(/\/join\/sign-in\?/);
});

test('a pending account without an invitation gets recovery instead of workspace creation', async ({ page }, testInfo) => {
  await installClerk(page, { email: `no-workspace-${testInfo.project.name}@example.test`, organization: null, pendingTask: 'choose-organization' });
  await page.goto('/join');
  await expect(page.getByRole('status')).toContainText('No workspace or invitation is available');
  await expect(page.getByRole('button', { name: /Create.*workspace|Create.*organization/i })).toHaveCount(0);
  await page.getByRole('button', { name: 'Use a different account' }).click();
  await expect(page.getByRole('heading', { name: 'Sign in to join' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Sign in to test account' })).toBeVisible();
});
