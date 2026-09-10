const { test, expect } = require('@playwright/test');

test('probe: manual survey creation', async ({ page }) => {
  await page.goto('/');
  await page.waitForLoadState('networkidle');
  await page.getByRole('button', { name: 'Start', exact: true }).first().click();
  await expect(page.getByRole('button', { name: /open a new search/i }).first()).toBeVisible();
  const created = await (await page.request.post('/api/searches', {
    data: { client: 'Survey City', position: 'City Manager', package: 'executive' }
  })).json();

  await page.goto('/#/s/' + created.id + '/survey1');
  await page.waitForTimeout(1200);
  console.log('URL', page.url(), 'status', await page.locator('.docbar .pill').textContent());
  console.log('add buttons', await page.getByRole('button', { name: 'Add a question' }).count());
  await page.getByRole('button', { name: 'Add a question' }).first().click();
  await page.waitForTimeout(400);
  console.log('focused', await page.evaluate(() => document.activeElement?.dataset?.path));
  await page.locator('[data-path="questions.0.prompt"]').fill('Describe a budget you turned around.');
  await page.locator('[data-path="questions.0.required"]').check();
  await page.getByRole('button', { name: 'Add a question' }).first().click();
  await page.waitForTimeout(400);
  await page.locator('[data-path="questions.1.prompt"]').fill('What are your first ninety days?');
  console.log('q0 still there:', await page.locator('[data-path="questions.0.prompt"]').inputValue());
  // preview keeps edits
  await page.getByRole('button', { name: 'Preview', exact: true }).click();
  await page.waitForTimeout(400);
  console.log('preview text', (await page.locator('#main').innerText()).includes('budget you turned around'));
  await page.getByRole('button', { name: 'Edit', exact: true }).click();
  await page.waitForTimeout(400);
  console.log('after back to edit', await page.locator('[data-path="questions.0.prompt"]').inputValue(), await page.locator('[data-path="questions.0.required"]').isChecked());
  // save
  await page.getByRole('button', { name: 'Save edits' }).click();
  await page.waitForTimeout(1200);
  console.log('status after save', await page.locator('.docbar .pill').textContent());
  const saved = await (await page.request.get('/api/searches/' + created.id)).json();
  console.log('server questions', JSON.stringify(saved.artifacts?.survey1?.questions));
});
