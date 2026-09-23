'use strict';
const { test, expect } = require('@playwright/test');
const AxeBuilder = require('@axe-core/playwright').default;
const { installClerk } = require('./clerk');

const reply = body => ({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });

test('public pricing states the one-time project terms without exposing unapproved amounts', async ({ page }, testInfo) => {
  await installClerk(page, { signedIn: false, organization: null });
  await page.goto('/subscriptions');
  await expect(page).toHaveURL(/\/pricing$/);
  await expect(page.getByRole('heading', { name: 'Search pricing' })).toBeVisible();
  await expect(page.getByText('Pricing available soon')).toBeVisible();
  await expect(page.getByText('Checkout is not open yet.')).toBeVisible();
  await expect(page.locator('[data-clerk-pricing]')).toHaveCount(0);
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1);
  await page.screenshot({ path: testInfo.outputPath('public-pricing.png'), fullPage: true });
});

test('an approved project offer renders its exact total and allowance', async ({ page }) => {
  await installClerk(page, { signedIn: false, organization: null });
  await page.route('**/api/public/project-offer', route => route.fulfill(reply({
    configured: true, name: 'Slate pilot search', amount: 125000, currency: 'usd', allowanceUsd: 50
  })));
  await page.goto('/pricing');
  await expect(page.getByText('USD 1250.00')).toBeVisible();
  await expect(page.getByText('of $50.00')).toBeVisible();
  await expect(page.getByRole('link', { name: 'Create account' })).toHaveAttribute('href', '/sign-up');
});

test('existing searches keep explicit legacy access and project payment details', async ({ page }) => {
  const { startingOrg } = await installClerk(page);
  const created = await page.request.post('/api/searches', {
    data: { client: 'Workflow migration town', position: 'City Manager', package: 'basic' }
  });
  expect(created.ok()).toBe(true);
  const search = await created.json();
  await page.goto('/#/o/' + startingOrg + '/s/' + search.id + '/billing');
  await expect(page.getByText('Project payment', { exact: true }).last()).toBeVisible();
  await expect(page.getByText('Legacy access pending owner review')).toBeVisible();
  await expect(page.getByText('This existing search remains accessible under legacy terms')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Continue to checkout' })).toHaveCount(0);
  const payment = await page.request.get('/api/searches/' + search.id + '/payment');
  expect((await payment.json()).state).toBe('legacy');
});

test('the pricing menu opens by keyboard and closes with Escape', async ({ page }) => {
  await installClerk(page, { signedIn: false, organization: null });
  await page.goto('/pricing');
  // The offer loads after the first paint and repaints the page; focus the
  // control that will stay on screen, not the one about to be replaced.
  await page.waitForLoadState('networkidle');
  const menu = page.getByRole('button', { name: 'Menu', exact: true });
  await menu.focus();
  await page.keyboard.press('Enter');
  await expect(menu).toHaveAttribute('aria-expanded', 'true');
  await expect(page.getByRole('navigation', { name: 'Site navigation' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(menu).toHaveAttribute('aria-expanded', 'false');
});

test('workspace home control and optional desktop menu keep navigation usable', async ({ page }, testInfo) => {
  await installClerk(page);
  await page.goto('/');
  // Hiding the rail is a desktop control. On a phone the rail is already a
  // drawer behind Menu, so only the home control is checked there.
  if (testInfo.project.name === 'mobile-chrome') {
    await page.getByRole('button', { name: 'Menu', exact: true }).click();
  } else {
    await expect(page.getByRole('navigation', { name: 'Primary' })).toBeVisible();
    await page.getByRole('button', { name: 'Hide menu' }).click();
    await expect(page.getByRole('navigation', { name: 'Primary' })).toBeHidden();
    await page.reload();
    await expect(page.getByRole('navigation', { name: 'Primary' })).toBeHidden();
    await page.getByRole('button', { name: 'Show menu' }).click();
  }
  await expect(page.getByRole('navigation', { name: 'Primary' })).toBeVisible();
  await page.getByRole('button', { name: 'New search', exact: true }).click();
  if (testInfo.project.name === 'mobile-chrome') await page.getByRole('button', { name: 'Menu', exact: true }).click();
  await page.getByRole('link', { name: 'Slate home' }).click();
  if (testInfo.project.name === 'mobile-chrome') await page.getByRole('button', { name: 'Menu', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Workspace home' })).toHaveAttribute('aria-current', 'page');
});
