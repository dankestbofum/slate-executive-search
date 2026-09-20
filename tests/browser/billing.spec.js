'use strict';
const { test, expect } = require('@playwright/test');
const AxeBuilder = require('@axe-core/playwright').default;
const { installClerk } = require('./clerk');
const catalog = { mode: 'test', status: 'ready', plans: [{ id: 'test', name: 'Test organization plan', description: 'Shared workspace', fee: { currency: 'USD', amountFormatted: '12.00', amount: 1200 }, features: [{ name: 'Search workspace' }] }] };
const reply = body => ({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });

test('public pricing explains test mode and requires an organization before checkout', async ({ page }, testInfo) => {
  await installClerk(page, { signedIn: false, organization: null });
  let privateRequests = 0;
  page.on('request', r => { if (r.url().includes('/api/billing/subscription')) privateRequests++; });
  await page.route('**/api/public/billing/plans', route => route.fulfill(reply(catalog)));
  await page.goto('/subscriptions');
  await expect(page.getByText('Test organization plan', { exact: true })).toBeVisible();
  await expect(page.getByText('Test billing.', { exact: true })).toBeVisible();
  await expect(page.locator('[data-clerk-pricing]')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Manage subscription' })).toHaveCount(0);
  expect(privateRequests).toBe(0);
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1);
  await page.screenshot({ path: testInfo.outputPath('public-pricing.png'), fullPage: true });
});

test('administrator checkout and management stay with the active organization', async ({ page }, testInfo) => {
  const { startingOrg } = await installClerk(page);
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.route('**/api/public/billing/plans', route => route.fulfill(reply(catalog)));
  let privateRequests = 0;
  await page.route('**/api/billing/subscription', route => {
    privateRequests++;
    return route.fulfill(reply({ status: 'ready', organizationId: startingOrg, subscription: { status: 'active', items: [{ name: 'Test organization plan', status: 'active' }] } }));
  });
  await page.goto('/subscriptions');
  await expect(page.getByText('Organization checkout fixture')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Billing for Fixture Search Partners' })).toBeVisible();
  await page.getByRole('button', { name: 'Manage subscription', exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.__billingManaged)).toBe(true);
  expect(privateRequests).toBe(2);
  await page.getByRole('button', { name: 'Refresh billing status' }).click();
  await expect(page.getByText('Organization checkout fixture')).toBeVisible();
  expect(await page.evaluate(() => window.__billingUnmounts)).toBeGreaterThan(0);
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await page.screenshot({ path: testInfo.outputPath('workspace-billing.png'), fullPage: true });
  expect(errors).toEqual([]);
});

test('a consultant can read plans but cannot open private billing or checkout', async ({ page }) => {
  await installClerk(page, { email: 'mike@slate.local' });
  let privateRequests = 0;
  page.on('request', r => { if (r.url().includes('/api/billing/subscription')) privateRequests++; });
  await page.route('**/api/public/billing/plans', route => route.fulfill(reply(catalog)));
  await page.goto('/subscriptions');
  await expect(page.getByText('Ask your workspace administrator to purchase or manage its subscription.')).toBeVisible();
  await expect(page.locator('[data-clerk-pricing]')).toHaveCount(0);
  expect(privateRequests).toBe(0);
  expect((await page.request.get('/api/billing/subscription')).status()).toBe(403);
});

test('billing outages offer retry and unpublished plans never invent a price', async ({ page }) => {
  await installClerk(page, { signedIn: false, organization: null });
  let ready = false;
  await page.route('**/api/public/billing/plans', route => route.fulfill(ready
    ? reply({ ...catalog, plans: [] })
    : { status: 503, contentType: 'application/json', body: JSON.stringify({ error: 'Billing is temporarily unavailable. Please try again.' }) }));
  await page.goto('/subscriptions');
  await expect(page.getByRole('alert')).toContainText('Billing is temporarily unavailable');
  ready = true;
  await page.getByRole('button', { name: 'Try again' }).click();
  await expect(page.getByText('Plans and prices have not been published yet.')).toBeVisible();
  await expect(page.locator('[data-clerk-pricing]')).toHaveCount(0);
});

test('legacy plan UI is removed while saved searches retain their workflow', async ({ page }) => {
  const { startingOrg } = await installClerk(page);
  const config = await (await page.request.get('/api/config')).json();
  expect(config.packages.map(p => p.label)).toEqual(['Posting and screening', 'Recruited search', 'Full search']);
  expect(config.packages.every(p => !Object.hasOwn(p, 'fee'))).toBe(true);
  const created = await page.request.post('/api/searches', { data: { client: 'Workflow migration town', position: 'City Manager', package: 'basic' } });
  expect(created.ok()).toBe(true);
  const search = await created.json();
  await page.goto('/#/o/' + startingOrg + '/s/' + search.id + '/facts');
  await expect(page.getByRole('button', { name: 'Change the workflow' })).toBeVisible();
  await page.getByRole('button', { name: 'Change the workflow' }).click();
  await expect(page.getByLabel('Search workflow', { exact: true })).toHaveValue('basic');
  await expect(page.getByRole('button', { name: 'Packages', exact: true })).toHaveCount(0);
  await expect(page.locator('.pkgmx, .pkg__fee')).toHaveCount(0);
  await page.getByRole('button', { name: 'Save facts', exact: true }).click();
  const saved = await (await page.request.get('/api/searches/' + search.id)).json();
  expect(saved.package).toBe('basic');
  expect(saved.steps.map(s => s.key)).toEqual(search.steps.map(s => s.key));
  await page.goto('/#/o/' + startingOrg + '/packages/basic');
  await expect(page.getByRole('heading', { name: 'Plans have moved' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'View subscriptions', exact: true })).toHaveAttribute('href', '/subscriptions');
  await expect(page.locator('.pkgmx, .showtabs')).toHaveCount(0);
});
