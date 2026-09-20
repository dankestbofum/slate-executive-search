'use strict';
const { test, expect } = require('@playwright/test');
const AxeBuilder = require('@axe-core/playwright').default;
const { installClerk } = require('./clerk');

test('the public home explains the product and connects hiring, candidate, and subscription paths', async ({ page }, testInfo) => {
  await installClerk(page, { signedIn:false, organization:null });
  await page.goto('/');
  await expect(page.getByRole('heading', { name:'What brings you to Slate?' })).toBeVisible();
  await expect(page.getByRole('link', { name:'Set up an organization' })).toHaveAttribute('href', '/sign-up');
  await expect(page.getByRole('link', { name:'Browse openings', exact:true })).toHaveAttribute('href', '/careers');
  await expect(page.getByRole('heading', { name:'How your team gets started' })).toBeVisible();
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1);
  await page.screenshot({ path:testInfo.outputPath('welcome.png'), fullPage:true });
  await page.emulateMedia({ colorScheme:'dark' });
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await page.screenshot({ path:testInfo.outputPath('welcome-dark.png'), fullPage:true });
  await page.getByRole('link', { name:'View subscription information' }).click();
  await expect(page.getByRole('heading', { name:'Subscriptions', exact:true })).toBeVisible();
  await expect(page.getByText(/Subscriptions are not available for purchase yet/)).toBeVisible();
  await page.getByRole('link', { name:'Browse openings', exact:true }).click();
  await expect(page).toHaveURL(/\/careers$/);
});

test('dedicated sign-up connects a new account to organization setup and its first search', async ({ page }, testInfo) => {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await installClerk(page, { email:`welcome-owner-${testInfo.project.name}@example.test`, signedIn:false, organization:null });
  await page.goto('/');
  await page.getByRole('button', { name:'Sign up', exact:true }).click();
  await expect(page).toHaveURL(/\/sign-up$/);
  await expect(page.getByRole('heading', { name:'Create your Slate account' })).toBeVisible();
  // The offline provider fixture finishes authentication; setup and membership
  // then use the real server, including its authorization checks.
  await page.getByRole('button', { name:'Create test account' }).click();
  await expect(page.getByRole('heading', { name:'How will you use Slate?' })).toBeVisible();
  await page.getByLabel('Your name').fill('Jordan Hiring');
  await page.getByRole('radio', { name:/Organization conducting a search/ }).check();
  await page.getByRole('button', { name:'Continue', exact:true }).click();
  await page.getByLabel('Workspace name').fill(`Welcome Town ${testInfo.project.name}`);
  await page.getByRole('button', { name:'Create a workspace', exact:true }).click();
  await expect(page.getByRole('heading', { name:'Get started with Slate' })).toBeVisible();
  await page.screenshot({ path:testInfo.outputPath('first-workspace.png'), fullPage:true });
  await page.getByRole('button', { name:'Start your first search' }).click();
  await expect(page).toHaveURL(/\/new$/);
  expect(errors).toEqual([]);
});

test('candidate setup persists, avoids workspace setup, and can be corrected', async ({ page }, testInfo) => {
  await installClerk(page, { email:`welcome-candidate-${testInfo.project.name}@example.test`, organization:null });
  await page.goto('/');
  await page.getByLabel('Your name').fill('Sam Candidate');
  await page.getByRole('radio', { name:/Candidate looking for a position/ }).check();
  await page.getByRole('button', { name:'Continue', exact:true }).click();
  await expect(page.getByRole('heading', { name:'Find your next position' })).toBeVisible();
  await expect(page.getByLabel('Workspace name')).toHaveCount(0);
  await page.reload();
  await expect(page.getByRole('heading', { name:'Find your next position' })).toBeVisible();
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1);
  expect((await page.request.get('/api/searches')).status()).toBe(403);
  await page.screenshot({ path:testInfo.outputPath('candidate-start.png'), fullPage:true });
  await page.getByRole('button', { name:'Change how I use Slate' }).click();
  await page.getByRole('radio', { name:/Organization conducting a search/ }).check();
  await page.getByRole('button', { name:'Continue', exact:true }).click();
  await expect(page.getByRole('heading', { name:'You are not in a workspace yet' })).toBeVisible();
  await page.getByRole('button', { name:'Change how I use Slate' }).click();
  await page.getByRole('radio', { name:/Candidate looking for a position/ }).check();
  await page.getByRole('button', { name:'Continue', exact:true }).click();
  await page.getByRole('link', { name:'Browse openings' }).click();
  await expect(page).toHaveURL(/\/careers$/);
});
