'use strict';
const { test, expect } = require('@playwright/test');
const { installClerk } = require('../../../../tests/browser/clerk');

test('a new manager sees the unpaid search gate before committee work', async ({ page }, testInfo) => {
  await installClerk(page, { email: 'pilot-manager-' + testInfo.project.name + '@example.test', organization: null });
  await page.goto('/');
  await page.getByLabel('Your name').fill('Synthetic Pilot Manager');
  await page.getByRole('radio', { name: /Search consultant/ }).check();
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await page.getByLabel('Workspace name').fill('Synthetic Pilot Workspace');
  await page.getByRole('button', { name: 'Create a workspace' }).click();
  await expect(page.getByText('No searches yet')).toBeVisible();

  await page.getByRole('button', { name: /open a new search/i }).first().click();
  await page.locator('#newsearch [name="client"]').fill('Synthetic Pilot County');
  await page.locator('#newsearch [name="position"]').fill('County Manager');
  await page.locator('#newsearch [name="jurisdictionType"]').selectOption('county');
  await page.locator('#newsearch [name="state"]').fill('Arizona');
  await page.getByRole('button', { name: 'Create search' }).click();
  await page.waitForURL(/\/s\/[^/]+\/billing$/);
  const searchId = page.url().match(/\/s\/([^/]+)\/billing$/)[1];
  await expect(page.getByText('Project payment', { exact: true }).last()).toBeVisible();
  await expect(page.getByText(/Payment status:\s*unpaid/)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Continue to checkout' })).toHaveCount(0);
  await page.screenshot({ path: testInfo.outputPath('unpaid-payment.png'), fullPage: true });

  const search = await (await page.request.get('/api/searches/' + searchId)).json();
  expect(search.projectAccess.state).toBe('unpaid');
  const payment = await (await page.request.get('/api/searches/' + searchId + '/payment')).json();
  expect(payment.state).toBe('unpaid');
  const blocked = await page.request.post('/api/searches/' + searchId + '/candidates', {
    headers: { 'if-match': String(search.revision) }, data: { name: 'Synthetic Candidate' }
  });
  expect(blocked.status()).toBe(402);
  expect((await blocked.json()).code).toBe('PROJECT_PAYMENT_REQUIRED');

  await page.goto('/#/s/' + searchId + '/team');
  await expect(page.getByRole('heading', { name: 'Search committee' })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('unpaid-committee.png'), fullPage: true });
});
