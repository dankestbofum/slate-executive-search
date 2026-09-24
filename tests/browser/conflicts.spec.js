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

test('two reviewers save scores from pages opened at the same time', async ({ browser }, testInfo) => {
  const contexts = await Promise.all([browser.newContext(), browser.newContext()]);
  try {
    const [first, second] = await Promise.all(contexts.map(c => c.newPage()));
    await installClerk(first, { email:'abe@slate.local' });
    await installClerk(second, { email:'mike@slate.local' });
    const search = await (await first.request.post('/api/searches', {
      data:{ client:'Scoring City '+testInfo.project.name, position:'City Manager', package:'executive' }
    })).json();
    const root = '/api/searches/' + search.id;
    const rev = async () => String((await (await first.request.get(root)).json()).revision);
    const confirmed = await first.request.post(root+'/team/confirm', {
      headers:{'if-match':await rev()}, data:{confirmed:true}
    });
    expect(confirmed.ok(), await confirmed.text()).toBe(true);
    const skip = await first.request.put(root+'/intake/participation', {
      headers:{'if-match':await rev()}, data:{enabled:false}
    });
    expect(skip.ok(), await skip.text()).toBe(true);
    const profile = await first.request.put(root+'/profile', {
      headers:{'if-match':await rev()}, data:{criteria:[{id:'S1',kind:'skill',label:'Budgeting',weight:3}]}
    });
    expect(profile.ok(), await profile.text()).toBe(true);
    const created = await first.request.post(root+'/candidates', {
      headers:{'if-match':await rev()}, data:{name:'Synthetic Candidate'}
    });
    expect(created.ok(), await created.text()).toBe(true);
    const cid = (await created.json()).candidates[0].id;
    const url = '/#/s/'+search.id+'/person/'+cid;
    await Promise.all([first.goto(url), second.goto(url)]);
    const firstRating = first.getByRole('button', {name:'Budgeting: 4 of 5'});
    const secondRating = second.getByRole('button', {name:'Budgeting: 5 of 5'});
    await expect(firstRating).toBeVisible();
    await expect(secondRating).toBeVisible();
    await firstRating.click();
    await secondRating.click();
    await first.locator('#cnote').fill('First reviewer');
    await second.locator('#cnote').fill('Second reviewer');
    await first.getByRole('button',{name:'Save my scores',exact:true}).click();
    await expect(first.locator('#toast')).toContainText('Your scores are on the file');
    await second.getByRole('button',{name:'Save my scores',exact:true}).click();
    await expect(second.locator('#toast')).toContainText('Your scores are on the file');
    const firstSaved = await (await first.request.get(root)).json();
    const secondSaved = await (await second.request.get(root)).json();
    expect(Object.values(firstSaved.scores).map(byCandidate => byCandidate[cid]?.S1)).toEqual([4]);
    expect(Object.values(secondSaved.scores).map(byCandidate => byCandidate[cid]?.S1)).toEqual([5]);
  } finally { await Promise.all(contexts.map(c => c.close())); }
});

test('competing tabs keep typed ratings and a lost score response can be retried', async ({ browser }, testInfo) => {
  const contexts = await Promise.all([browser.newContext(), browser.newContext()]);
  try {
    const [first, second] = await Promise.all(contexts.map(c => c.newPage()));
    await installClerk(first, {email:'abe@slate.local'});
    await installClerk(second, {email:'abe@slate.local'});
    const search = await (await first.request.post('/api/searches', {
      data:{client:'Same Reviewer '+testInfo.project.name,position:'City Manager',package:'executive'}
    })).json();
    const root = '/api/searches/'+search.id;
    const rev = async () => String((await (await first.request.get(root)).json()).revision);
    expect((await first.request.post(root+'/team/confirm', {headers:{'if-match':await rev()},data:{confirmed:true}})).ok()).toBe(true);
    expect((await first.request.put(root+'/intake/participation', {headers:{'if-match':await rev()},data:{enabled:false}})).ok()).toBe(true);
    expect((await first.request.put(root+'/profile', {headers:{'if-match':await rev()},data:{criteria:[{id:'S1',kind:'skill',label:'Budgeting',weight:3}]}})).ok()).toBe(true);
    const added = await first.request.post(root+'/candidates', {headers:{'if-match':await rev()},data:{name:'Synthetic Candidate'}});
    expect(added.ok(), await added.text()).toBe(true);
    const cid = (await added.json()).candidates[0].id;
    await Promise.all([first.goto('/#/s/'+search.id+'/person/'+cid), second.goto('/#/s/'+search.id+'/person/'+cid)]);
    await first.getByRole('button',{name:'Budgeting: 4 of 5'}).click();
    await second.getByRole('button',{name:'Budgeting: 5 of 5'}).click();
    await second.locator('#cnote').fill('Keep this typed note');
    await first.getByRole('button',{name:'Save my scores',exact:true}).click();
    await expect(first.locator('#toast')).toContainText('Your scores are on the file');
    await second.getByRole('button',{name:'Save my scores',exact:true}).click();
    await expect(second.getByText('Your ratings are still here')).toBeVisible();
    await expect(second.getByRole('button',{name:'Budgeting: 5 of 5'})).toHaveAttribute('aria-pressed','true');
    await expect(second.locator('#cnote')).toHaveValue('Keep this typed note');
    await second.getByRole('button',{name:'Save my reviewed ratings'}).click();
    await expect(second.locator('#toast')).toContainText('Your scores are on the file');

    await second.getByRole('button',{name:'Budgeting: 3 of 5'}).click();
    let dropped = false;
    await second.route('**/api/searches/'+search.id+'/scores/'+cid, async route => {
      if (route.request().method() !== 'PUT' || dropped) return route.fallback();
      dropped = true;
      const committed = await route.fetch();
      await committed.dispose();
      await route.abort('connectionreset');
    });
    await second.getByRole('button',{name:'Save my scores',exact:true}).click();
    await expect(second.getByRole('button',{name:'Budgeting: 3 of 5'})).toHaveAttribute('aria-pressed','true');
    await second.getByRole('button',{name:'Save my scores',exact:true}).click();
    await expect(second.locator('#toast')).toContainText('Your scores are on the file');
    const saved = await (await second.request.get(root)).json();
    expect(Object.values(saved.scores)[0][cid]).toEqual({S1:3});
  } finally { await Promise.all(contexts.map(c => c.close())); }
});
