'use strict';

// A single JSON writer still receives concurrent browser requests. The
// revision precondition must reject stale work and the browser must leave the
// user's unsaved text in place so they can reconcile it with the saved file.

const { test, expect } = require('@playwright/test');
const { installClerk } = require('./clerk');

test('two consultants editing the same facts cannot silently overwrite one another', async ({ browser }, testInfo) => {
  const firstContext = await browser.newContext();
  const secondContext = await browser.newContext();
  const first = await firstContext.newPage();
  const second = await secondContext.newPage();
  await installClerk(first, { email: 'abe@slate.local' });
  await installClerk(second, { email: 'mike@slate.local' });

  const search = await (await first.request.post('/api/searches', {
    data: { client: 'Conflict City ' + testInfo.project.name, position: 'City Manager', package: 'executive' }
  })).json();
  const url = '/#/s/' + search.id + '/facts';
  await Promise.all([first.goto(url), second.goto(url)]);
  const firstNotes = first.locator('#facts [name="notes"]');
  const secondNotes = second.locator('#facts [name="notes"]');
  await Promise.all([expect(firstNotes).toBeVisible({ timeout: 10000 }), expect(secondNotes).toBeVisible({ timeout: 10000 })]);

  await firstNotes.fill('The first consultant saved this version.');
  await secondNotes.fill('The second consultant still has local work.');
  await first.getByRole('button', { name: 'Save facts' }).click();
  await expect(first.locator('#toast')).toContainText('Facts saved');

  await second.getByRole('button', { name: 'Save facts' }).click();
  await expect(second.locator('#toast')).toContainText(/changed|reload|newer/i);
  await expect(secondNotes).toHaveValue('The second consultant still has local work.');

  const stored = await (await first.request.get('/api/searches/' + search.id)).json();
  expect(stored.notes).toBe('The first consultant saved this version.');

  await Promise.all([firstContext.close(), secondContext.close()]);
});
