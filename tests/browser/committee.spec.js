'use strict';

/**
 * The committee workflow in a real browser, on desktop and on a phone.
 *
 * Acceptance evidence for docs/audits/2026-09-17-committee-aggregate: the
 * browser walkthrough reproduced CA-04 (saving a draft withdrew the answer),
 * CA-08 (renaming a criterion lost its provenance) and CA-12 (an independent
 * member was refused because somebody else had answered). These assert the
 * corrected behaviour on the controls a member actually uses.
 */

const { test, expect } = require('@playwright/test');
const { installClerk, joinWorkspace, authHeaders } = require('./clerk');

async function revision(page, id) {
  return String((await (await page.request.get('/api/searches/' + id)).json()).revision);
}

/** A confirmed roster, an open window, and two committee members signed in. */
async function openIntake(browser, testInfo, names, { draft = false } = {}) {
  const managerContext = await browser.newContext();
  const manager = await managerContext.newPage();
  await installClerk(manager, { email: 'abe@slate.local' });
  const tag = testInfo.project.name + '-' + Date.now().toString(36);
  const search = await (await manager.request.post('/api/searches', {
    data: { client: 'Committee City ' + tag, position: 'City Manager', package: 'executive' }
  })).json();

  const members = {};
  for (const name of names) {
    const email = name + '-' + tag + '@example.test';
    await joinWorkspace(email);
    // Confirm the account's name first, so what the member reaches is the
    // questionnaire rather than account setup, and so the roster is offered
    // the name the account already answers to.
    await manager.request.post('/api/me/onboarding', {
      headers: authHeaders(email, null), data: { name: name + ' Member', requestedRole: 'committee' }
    });
    const added = await manager.request.post('/api/searches/' + search.id + '/members', {
      headers: { 'if-match': await revision(manager, search.id) },
      data: { name: name + ' Member', email, searchRole: 'committee' }
    });
    expect(added.ok(), await added.text()).toBe(true);
    expect((await added.json()).added, 'the member was held rather than added').toBe(true);
    const context = await browser.newContext();
    const page = await context.newPage();
    await installClerk(page, { email });
    members[name] = { page, context, email };
  }
  await manager.request.post('/api/searches/' + search.id + '/team/confirm', {
    headers: { 'if-match': await revision(manager, search.id) }, data: { confirmed: true }
  });
  if (!draft) await manager.request.post('/api/searches/' + search.id + '/intake/status', {
    headers: { 'if-match': await revision(manager, search.id) }, data: { status: 'open', dueBy: '19 Sep 2026' }
  });
  return { search, manager, managerContext, members };
}

// Seed a saved draft so focused regression tests do not click the whole ballot.
// The end-to-end test below also verifies a blank ballot and required ratings.
async function primeRatings(page, searchId, overrides=[]) {
  const search = await (await page.request.get('/api/searches/'+searchId)).json();
  const own = Object.values(search.intake.responses).find(r => Object.hasOwn(r,'draft'));
  const items = search.intake.qualities.map(q => ({...q,weight:1}));
  for (const [label,weight,kind='skill'] of overrides) {
    const found = items.find(q => q.label === label && q.kind === kind);
    if (found) found.weight = weight;
    else items.push({kind,label,weight});
  }
  const saved = await page.request.put('/api/searches/'+searchId+'/intake',{data:{submitted:false,items,responseRevision:own?.revision || 1}});
  expect(saved.ok(),await saved.text()).toBe(true);
}
async function namePriorities(page, searchId, priorities) {
  await primeRatings(page,searchId,priorities);
  await page.goto('/#/s/'+searchId+'/intake-mine');
  for (const [label,weight] of priorities) await page.getByRole('button',{name:'Rate '+label+' '+weight+' of 5',exact:true}).click();
}

const nameOnePriority = (page, searchId, label, weight) =>
  namePriorities(page, searchId, [[label, weight]]);

test('waiting member checks again while staff can preview but cannot control the window', async ({ browser }, testInfo) => {
  const {search, manager, managerContext, members} = await openIntake(browser, testInfo, ['waiting'], {draft:true});
  const staffContext = await browser.newContext();
  const staff = await staffContext.newPage();
  try {
    await installClerk(staff, {email:'mike@slate.local'});
    await members.waiting.page.goto('/#/s/'+search.id+'/intake');
    await expect(members.waiting.page.getByText('Preview only — answers are not open')).toBeVisible();
    await expect(members.waiting.page.getByRole('button',{name:'Submit my answers'})).toHaveCount(0);
    await staff.goto('/#/s/'+search.id+'/intake');
    await expect(staff.getByText('Budgeting')).toBeVisible();
    await expect(staff.getByRole('button',{name:'Open the window'})).toHaveCount(0);
    await expect(staff.getByText('You are not on this search roster')).toBeVisible();
    await manager.goto('/#/s/'+search.id+'/intake');
    await manager.getByRole('button',{name:'Open the window'}).click();
    await members.waiting.page.getByRole('button',{name:'Check again'}).click();
    await expect(members.waiting.page.getByRole('button',{name:'Submit my answers'})).toBeVisible();
  } finally {
    await Promise.all([staffContext.close(), managerContext.close(), ...Object.values(members).map(m => m.context.close())]);
  }
});

test('an administrator outside the roster sees the ballot and the separate skip decision', async ({ browser }, testInfo) => {
  const managerContext = await browser.newContext();
  const adminContext = await browser.newContext();
  try {
    const manager = await managerContext.newPage();
    const admin = await adminContext.newPage();
    await installClerk(manager, {email:'mike@slate.local'});
    await installClerk(admin, {email:'abe@slate.local'});
    const search = await (await manager.request.post('/api/searches', {
      data:{client:'Admin Preview '+testInfo.project.name,position:'City Manager',package:'executive'}
    })).json();
    const root = '/api/searches/'+search.id;
    const revision = String((await (await manager.request.get(root)).json()).revision);
    const confirmed = await manager.request.post(root+'/team/confirm', {headers:{'if-match':revision},data:{confirmed:true}});
    expect(confirmed.ok(), await confirmed.text()).toBe(true);
    await admin.goto('/#/s/'+search.id+'/intake');
    await expect(admin.getByText('Budgeting')).toBeVisible();
    await expect(admin.getByText('You are not on this search roster')).toBeVisible();
    await expect(admin.getByRole('button',{name:'Open the window'})).toHaveCount(0);
    await expect(admin.getByRole('button',{name:'Skip questionnaire and continue'})).toBeEnabled();
  } finally { await Promise.all([managerContext.close(),adminContext.close()]); }
});

test('the administrator can skip the questionnaire and enable it again without asking members to respond', async ({ browser }, testInfo) => {
  test.slow();
  const {search, manager, managerContext, members} = await openIntake(browser, testInfo, ['ada'], {draft:true});
  try {
    await manager.setViewportSize(testInfo.project.use.viewport || {width:1280, height:720});
    await manager.goto('/#/s/' + search.id + '/intake');
    await manager.getByRole('button', {name:'Skip questionnaire and continue', exact:true}).click();
    await expect(manager).toHaveURL(/\/profile$/);
    await expect(manager.getByRole('navigation', {name:'Search stages'})).toContainText('Committee questionnaire · Skipped');
    const skipped = await (await manager.request.get('/api/searches/' + search.id)).json();
    expect(skipped.steps.find(s => s.key === 'profile').blocked).toBe(false);

    await members.ada.page.goto('/#/s/' + search.id + '/intake');
    await expect(members.ada.page.locator('.notice__t')).toHaveText('Committee questionnaire skipped');
    await expect(members.ada.page.getByRole('button', {name:'Submit my answers', exact:true})).toHaveCount(0);
    await expect(members.ada.page.getByRole('button', {name:'Include committee questionnaire', exact:true})).toHaveCount(0);
    await members.ada.page.goto('/#/s/' + search.id + '/overview');
    await expect(members.ada.page.locator('h1')).toBeVisible();
    await expect(members.ada.page.getByText('Submit what you are looking for in this hire', {exact:true})).toHaveCount(0);

    await manager.goto('/#/s/' + search.id + '/intake');
    await expect(manager.locator('.notice__t')).toHaveText('Committee questionnaire skipped');
    await manager.getByRole('button', {name:'Include committee questionnaire', exact:true}).click();
    await expect(manager.getByRole('button', {name:'Open the window', exact:true})).toBeVisible();
    await manager.getByRole('button', {name:'Open the window', exact:true}).click();
    await expect(manager.locator('#toast')).toContainText('Intake is open');
    await nameOnePriority(members.ada.page, search.id, 'Budgeting', 5);
    await members.ada.page.getByRole('button', {name:'Submit my answers', exact:true}).click();
    await expect(members.ada.page.locator('#toast')).toContainText('Your answers are in');
  } finally {
    await Promise.all([managerContext.close(), members.ada.context.close()]);
  }
});

test('standard questionnaire feeds scored recommendations, reviewed favorites and custom profile qualities', async ({browser},testInfo) => {
  test.setTimeout(180000);
  const {search,manager,managerContext,members} = await openIntake(browser,testInfo,['ada','bo'],{draft:true});
  try {
    await manager.goto('/#/s/'+search.id+'/intake');
    await expect(manager.locator('#sharedqualities')).toHaveCount(0);
    await expect(manager.getByRole('button',{name:'Save shared qualities',exact:true})).toHaveCount(0);
    const forbidden = await manager.request.put('/api/searches/'+search.id+'/intake/qualities',{headers:{'if-match':await revision(manager,search.id)},data:{qualities:[{kind:'skill',label:'Administrator favorite'}]}});
    expect(forbidden.status()).toBe(409);
    const ballot = await (await manager.request.get('/api/searches/'+search.id)).json();
    expect(ballot.intake.qualities).toHaveLength(35);
    await members.ada.page.goto('/#/s/'+search.id+'/intake');
    await expect(members.ada.page.getByRole('button',{name:'Rate Financial management 5 of 5',exact:true})).toBeDisabled();
    await expect(members.ada.page.locator('[data-act="next-step"]')).toHaveCount(0);
    await manager.getByRole('button',{name:'Open the window',exact:true}).click();
    await expect(manager.locator('#toast')).toContainText('Intake is open');
    for (const page of [members.ada.page,members.bo.page,manager]) {
      await page.setViewportSize(testInfo.project.use.viewport || {width:1280,height:720});
      await page.goto('/#/s/'+search.id+'/intake-mine');
      await expect(page.locator('.intake-row')).toHaveCount(35);
      await expect(page.locator('.intake-row .wgt [aria-pressed="true"]')).toHaveCount(0);
      await page.getByRole('button',{name:'Submit my answers',exact:true}).click();
      await expect(page.locator('#toast')).toContainText('Rate every shared quality');
      await primeRatings(page,search.id,[['Financial management',5],['Community engagement',4],['Staff leadership',3],['Infrastructure needs',5,'chall'],['Community development',4,'opp']]);
      await page.reload();
      await page.getByRole('button',{name:'Rate Financial management 5 of 5',exact:true}).click();
      await page.getByRole('textbox',{name:'Explain why Infrastructure needs matters (optional)',exact:true}).fill('Reliable water services are our urgent community need.');
      await page.locator('#intake-context').fill('Residents want reliable utilities and a stronger downtown.');
      await page.getByRole('button',{name:'Submit my answers',exact:true}).click();
      await expect(page.locator('#toast')).toContainText('Your answers are in');
    }
    await manager.goto('/#/s/'+search.id+'/intake');
    await expect(manager.locator('.cons')).toHaveCount(0);
    await manager.getByRole('button',{name:'Close and read the room',exact:true}).click();
    await expect(manager.locator('#toast')).toContainText('Intake closed');
    await manager.getByRole('button',{name:'Review committee input',exact:true}).click();
    await expect(manager.locator('#committee-review')).toContainText('Reliable water services are our urgent community need.');
    await expect(manager.locator('#committee-review .cons').first()).toContainText('Financial management');
    await expect(manager.locator('#committee-review .cons').first()).toContainText('Score: 5.00 / 5');
    const categories = manager.locator('#committee-review > .spec');
    await categories.first().screenshot({path:testInfo.outputPath('scored-quality-shortlist.png')});
    for (let i=0;i<4;i++) {
      const choices = categories.nth(i).locator('input[type="checkbox"]:checked');
      await expect(choices).toHaveCount(5);
      await choices.last().uncheck();
      await choices.last().uncheck();
      await expect(choices).toHaveCount(3);
    }
    await manager.getByRole('button',{name:'Review what this would change',exact:true}).click();
    await expect(manager).toHaveURL(/\/profile$/);
    await manager.getByRole('button',{name:'Save this profile',exact:true}).click();
    await expect(manager.locator('#toast')).toContainText('Profile saved from committee input');
    await expect(manager.locator('.crit-row')).toHaveCount(12);
    await manager.locator('#prof-skill [data-add="skill"]').click();
    const extra = manager.locator('#prof-skill .crit-row').last();
    await extra.locator('[data-f="label"]').fill('Grant administration');
    await extra.locator('[data-f="note"]').fill('A missing capability needed for the capital program.');
    await extra.locator('[data-w="4"]').click();
    await manager.getByRole('button',{name:'Save profile',exact:true}).click();
    await expect(manager.locator('#toast')).toContainText('Profile saved');
    const result = await (await manager.request.get('/api/searches/'+search.id,{maxRetries:1})).json();
    expect(result.criteria).toHaveLength(13);
    expect(result.criteria.find(c=>c.label==='Grant administration').from).toBe('consultant');
    expect(result.adoption.groups).toHaveLength(12);
    await members.ada.page.goto('/#/s/'+search.id+'/profile');
    await expect(members.ada.page.locator('.crit-row')).toHaveCount(0);
    await expect(members.ada.page.locator('.crit-read').filter({hasText:'Grant administration'})).toHaveCount(1);
    await manager.screenshot({path:testInfo.outputPath('consensus-profile.png'),fullPage:true});
  } finally {await Promise.all([managerContext.close(),members.ada.context.close(),members.bo.context.close()]);}
});

test('skipping intake still lets the administrator select, edit, add and weight profile qualities', async ({browser}, testInfo) => {
  const {search, manager, managerContext} = await openIntake(browser, testInfo, [], {draft:true});
  try {
    await manager.setViewportSize(testInfo.project.use.viewport || {width:1280,height:720});
    await manager.goto('/#/s/' + search.id + '/intake');
    await manager.getByRole('button',{name:'Skip questionnaire and continue',exact:true}).click();
    await expect(manager).toHaveURL(/\/profile$/);
    const choices = manager.locator('#pick-skill');
    for (const label of ['Financial management','Community engagement','Staff leadership']) await choices.getByRole('button',{name:label,exact:true}).click();
    await expect(choices.getByRole('button',{name:'Communication',exact:true})).toBeVisible();
    const rows = manager.locator('#prof-skill .crit-row');
    await rows.first().locator('[data-f="label"]').fill('Public finance leadership');
    await expect(rows.first().getByText('Explain why',{exact:true})).toBeVisible();
    await rows.first().locator('[data-f="note"]').fill('The capital plan needs steady financial oversight.');
    await rows.first().locator('[data-w="5"]').click();
    await manager.locator('#prof-skill [data-add="skill"]').click();
    await rows.last().locator('[data-f="label"]').fill('Grant administration');
    await rows.last().locator('[data-w="4"]').click();
    await manager.getByRole('button',{name:'Save profile',exact:true}).click();
    await expect(manager.locator('#toast')).toContainText('Profile saved');
    await manager.reload();
    await expect(rows.first().locator('[data-f="label"]')).toHaveValue('Public finance leadership');
    await expect(rows.first().locator('[data-w="5"]')).toHaveAttribute('aria-pressed','true');
    await expect(rows.first().locator('[data-f="note"]')).toHaveValue('The capital plan needs steady financial oversight.');
    await expect(rows.last().locator('[data-f="label"]')).toHaveValue('Grant administration');
    await expect(choices.getByRole('button',{name:'Community engagement',exact:true})).toHaveAttribute('aria-pressed','true');
    await manager.screenshot({path:testInfo.outputPath('profile-quality-picker.png'),fullPage:true});
  } finally { await managerContext.close(); }
});

test('saving a draft after submitting keeps the submitted answer in the tally', async ({ browser }, testInfo) => {
  const { search, manager, managerContext, members } = await openIntake(browser, testInfo, ['ada']);
  const page = members.ada.page;
  try {
    await nameOnePriority(page, search.id, 'Financial management', 5);
    await page.getByRole('button', { name: 'Submit my answers' }).click();
    await expect(page.locator('#toast')).toContainText('Your answers are in');
    await expect(page.locator('.notice__t', { hasText: 'Your answers are in' })).toBeVisible();

    // The same control the diagnostic used to lose an answer with.
    const row = page.locator('#intake-sec-skill .intake-row').first();
    await row.locator('[data-f="note"]').fill('Something I am still thinking about');
    await page.getByRole('button', { name: 'Save and finish later', exact: true }).click();
    await expect(page.locator('#toast')).toContainText('Saved privately');
    await expect(page.locator('.notice__t', { hasText: 'Submitted — you have unpublished changes' })).toBeVisible();

    const tally = await (await manager.request.get('/api/searches/' + search.id)).json();
    expect(tally.consensus.submitted).toBe(1);
    expect(tally.consensus.byKind.skill[0].label).toBe('Financial management');

    // A reload restores the saved draft and still distinguishes it from the
    // submission.
    await page.reload();
    await expect(page.locator('.notice__t', { hasText: 'Submitted — you have unpublished changes' })).toBeVisible({ timeout: 15000 });
    await expect(page.locator('#intake-sec-skill .intake-row').first().locator('[data-f="note"]'))
      .toHaveValue('Something I am still thinking about');
  } finally {
    await Promise.all([managerContext.close(), members.ada.context.close()]);
  }
});

test('two members submit independently without either being told to retype', async ({ browser }, testInfo) => {
  const { search, manager, managerContext, members } = await openIntake(browser, testInfo, ['ada', 'bo']);
  try {
    // Both have the form open at the same revision before either saves.
    await nameOnePriority(members.ada.page, search.id, 'Financial management', 5);
    await nameOnePriority(members.bo.page, search.id, 'Community engagement', 4);

    await members.ada.page.getByRole('button', { name: 'Submit my answers' }).click();
    await expect(members.ada.page.locator('#toast')).toContainText('Your answers are in');

    await members.bo.page.getByRole('button', { name: 'Submit my answers' }).click();
    await expect(members.bo.page.locator('#toast')).toContainText('Your answers are in');
    // Nothing was lost and nobody was asked to copy their edits and reload.
    await expect(members.bo.page.locator('#toast')).not.toContainText(/copy your edits/i);

    const tally = await (await manager.request.get('/api/searches/' + search.id)).json();
    expect(tally.consensus.submitted).toBe(2);
  } finally {
    await Promise.all([managerContext.close(), members.ada.context.close(), members.bo.context.close()]);
  }
});

test('an unfinished draft stays private, and renaming an adopted line keeps its provenance', async ({ browser }, testInfo) => {
  // Three browser contexts, two questionnaires, a close, a preview, an
  // adoption and a rename. WebKit does not finish that inside the default
  // budget, and the point of the test is the workflow rather than its speed.
  test.slow();
  const { search, manager, managerContext, members } = await openIntake(browser, testInfo, ['ada', 'bo']);
  try {
    // Three skills, so the profile the manager saves afterwards is a complete
    // category rather than one the editor would refuse.
    await namePriorities(members.ada.page, search.id,
      [['Financial management', 5], ['Community engagement', 4], ['Staff leadership', 3]]);
    await members.ada.page.getByRole('button', { name: 'Submit my answers' }).click();
    await expect(members.ada.page.locator('#toast')).toContainText('Your answers are in');

    // Bo writes something and never submits it.
    await nameOnePriority(members.bo.page, search.id, 'A thought I never sent', 2);
    await members.bo.page.locator('#intake-sec-words #intake-context').fill('BO_PRIVATE_CONTEXT');
    await members.bo.page.getByRole('button', { name: 'Save and finish later', exact: true }).click();
    await expect(members.bo.page.locator('#toast')).toContainText('Saved');

    // Close the window, then look at what Ada's browser is given.
    await manager.request.post('/api/searches/' + search.id + '/intake/status', {
      headers: { 'if-match': await revision(manager, search.id) }, data: { status: 'closed' }
    });
    const asAda = await (await members.ada.page.request.get('/api/searches/' + search.id)).json();
    expect(JSON.stringify(asAda)).not.toContain('BO_PRIVATE_CONTEXT');
    expect(JSON.stringify(asAda)).not.toContain('A thought I never sent');

    // Adopt through the preview the manager now has to review.
    await manager.goto('/#/s/' + search.id + '/profile');
    await manager.getByRole('button', { name: 'Review what this would change' }).click();
    await expect(manager.locator('#adoptplan')).toBeVisible({ timeout: 15000 });
    await expect(manager.locator('#adoptplan')).toContainText('Financial management');
    await manager.getByRole('button', { name: 'Save this profile' }).click();
    await expect(manager.locator('#toast')).toContainText('Profile saved from committee input');

    // The badge is the committee's count, and it survives a rename.
    // A criterion's label lives in an input value, not in the row's text, so
    // the row is found by the ID beside it.
    const skillRow = manager.locator('#prof-skill .crit-row').first();
    await expect(skillRow.locator('[data-f="label"]')).toHaveValue('Financial management');
    await expect(skillRow).toContainText('1 of 1');
    await skillRow.locator('[data-f="label"]').fill('Financial management.');
    const savedProfile = manager.waitForResponse(r => r.url().endsWith('/api/searches/'+search.id+'/profile') && r.request().method()==='PUT');
    await manager.getByRole('button', { name: 'Save profile' }).click();
    expect((await savedProfile).ok()).toBe(true);
    await expect(manager.locator('#toast')).toContainText('Profile saved');
    await manager.reload();
    const renamed = manager.locator('#prof-skill .crit-row').first();
    await expect(renamed.locator('[data-f="label"]')).toHaveValue('Financial management.');
    await expect(renamed).toContainText('1 of 1');
    await expect(renamed).not.toContainText('Yours');
  } finally {
    await Promise.all([managerContext.close(), members.ada.context.close(), members.bo.context.close()]);
  }
});

test('every intake weight control names the priority it belongs to', async ({ browser }, testInfo) => {
  const { search, managerContext, members } = await openIntake(browser, testInfo, ['ada']);
  const page = members.ada.page;
  try {
    await nameOnePriority(page, search.id, 'Financial management', 5);
    await page.locator('#intake-sec-trait').getByRole('button', { name: 'Write my own' }).click();
    await page.locator('#intake-sec-trait .intake-row').last().locator('[data-f="label"]').fill('Approachable');
    // Re-render on blur is what puts the typed label into the button names.
    await page.locator('#intake-sec-trait .intake-row').last()
      .getByRole('button', { name: /Rate .* 3 of 5/ }).click();

    const names = await page.locator('.intake-row .wgt button').evaluateAll(
      buttons => buttons.map(b => b.getAttribute('aria-label')));
    expect(names.length).toBeGreaterThanOrEqual(10);
    expect(new Set(names).size).toBe(names.length);
    expect(names.some(n => /Financial management/.test(n))).toBe(true);
    expect(names.some(n => /Approachable/.test(n))).toBe(true);

    // Rating a priority redraws the row. Activated from the keyboard — which
    // is the case that matters, since WebKit deliberately does not focus a
    // button that was clicked — the keyboard stays on the scale it was using.
    const rated = page.locator('#intake-sec-skill .intake-row').first()
      .getByRole('button', { name: /Rate .* 4 of 5/ });
    await rated.focus();
    await rated.press('Enter');
    await expect(rated).toHaveAttribute('aria-pressed', 'true');
    await expect(rated).toBeFocused();

    // Adding a row must not throw focus back to the top of the form either.
    const add = page.locator('#intake-sec-skill').getByRole('button', { name: 'Write my own' });
    await add.focus();
    await add.press('Enter');
    await expect(page.locator('#intake-sec-skill .intake-row')).toHaveCount(9);
    await expect(add).toBeFocused();
  } finally {
    await Promise.all([managerContext.close(), members.ada.context.close()]);
  }
});
