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

/** Open this member's questionnaire and name one or more essential skills. */
async function namePriorities(page, searchId, priorities) {
  await page.goto('/#/s/' + searchId + '/intake-mine');
  await expect(page.getByRole('button', { name: 'Submit my answers' })).toBeVisible({ timeout: 15000 });
  const section = page.locator('#intake-sec-skill');
  for (const [label, weight] of priorities) {
    await section.getByRole('button', { name: 'Write my own' }).click();
    const row = section.locator('.intake-row').last();
    await row.locator('[data-f="label"]').fill(label);
    await row.getByRole('button', { name: new RegExp('Rate .* ' + weight + ' of 5') }).click();
  }
}

const nameOnePriority = (page, searchId, label, weight) =>
  namePriorities(page, searchId, [[label, weight]]);

test('the administrator can skip the questionnaire and enable it again without asking members to respond', async ({ browser }, testInfo) => {
  test.slow();
  const {search, manager, managerContext, members} = await openIntake(browser, testInfo, ['ada'], {draft:true});
  try {
    await manager.setViewportSize(testInfo.project.use.viewport || {width:1280, height:720});
    await manager.goto('/#/s/' + search.id + '/intake');
    await manager.getByRole('button', {name:'Skip questionnaire and continue', exact:true}).click();
    await expect(manager).toHaveURL(/\/profile$/);
    await expect(manager.getByRole('navigation', {name:'Search stages'})).toContainText('Committee rankings · Skipped');
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

test('shared qualities reach every member and the owner can navigate from aggregate to recruiting and review', async ({ browser }, testInfo) => {
  test.slow();
  const { search, manager, managerContext, members } = await openIntake(browser, testInfo, ['ada', 'bo'], { draft:true });
  try {
    for (const page of [manager, members.ada.page, members.bo.page]) {
      await page.setViewportSize(testInfo.project.use.viewport || {width:1280, height:720});
    }
    await manager.goto('/#/s/' + search.id + '/intake');
    await manager.locator('#sharedqualities [name="skill"]').fill('Financial management\nCommunity engagement\nStaff leadership');
    await manager.locator('#sharedqualities [name="chall"]').fill('Aging water infrastructure');
    await manager.locator('#sharedqualities [name="opp"]').fill('Downtown revitalization');
    await manager.getByRole('button', { name:'Save shared qualities', exact:true }).click();
    await expect(manager.locator('#toast')).toContainText('Shared qualities saved');
    await members.ada.page.goto('/#/s/' + search.id + '/intake');
    await expect(members.ada.page.getByRole('heading',{name:'Committee questionnaire',exact:true})).toBeVisible();
    await expect(members.ada.page.getByRole('button',{name:'Rate Financial management 5 of 5',exact:true})).toBeDisabled();
    await expect(members.ada.page.getByRole('textbox',{name:'Explain why Financial management matters (optional)',exact:true})).toBeDisabled();
    await expect(members.ada.page.locator('[data-act="next-step"]')).toHaveCount(0);
    await members.ada.page.screenshot({path:testInfo.outputPath('member-questionnaire-waiting.png'),fullPage:true});
    await manager.getByRole('button', { name:'Open the window', exact:true }).click();
    await expect(manager.locator('#toast')).toContainText('Intake is open');

    const labels = ['Financial management', 'Community engagement', 'Staff leadership'];
    for (const page of [members.ada.page, members.bo.page, manager]) {
      await page.goto('/#/s/' + search.id + '/intake-mine');
      await expect(page.getByText('Rank the shared candidate qualities', { exact:true })).toBeVisible();
      await expect(page.locator('#intake-sec-skill .intake-row')).toHaveCount(3);
      await expect(page.getByRole('textbox', { name:'Priority: Financial management', exact:true })).toHaveAttribute('readonly', '');
      await page.getByRole('button', { name:'Submit my answers', exact:true }).click();
      await expect(page.locator('#toast')).toContainText('Rate every shared quality');
      await page.getByRole('button', { name:'Save and finish later', exact:true }).click();
      await expect(page.locator('#toast')).toContainText('Saved privately');
      await page.reload();
      await expect(page.locator('#intake-sec-skill .wgt [aria-pressed="true"]')).toHaveCount(0);
      for (const [i, label] of labels.entries()) {
        await page.getByRole('button', { name:'Rate ' + label + ' ' + (5-i) + ' of 5', exact:true }).click();
      }
      await page.getByRole('button',{name:'Rate Aging water infrastructure 5 of 5',exact:true}).click();
      await page.getByRole('textbox',{name:'Explain why Aging water infrastructure matters (optional)',exact:true}).fill('Water main replacements are the most urgent community need.');
      await page.getByRole('button',{name:'Rate Downtown revitalization 4 of 5',exact:true}).click();
      await page.locator('#intake-context').fill('Residents need reliable utilities and a stronger downtown.');
      await page.getByRole('button', { name:'Submit my answers', exact:true }).click();
      await expect(page.locator('#toast')).toContainText('Your answers are in');
    }

    await manager.goto('/#/s/' + search.id + '/intake');
    await expect(manager.locator('.cons')).toHaveCount(0);
    await expect(manager.locator('[data-act="adopt-preview"]')).toHaveCount(0);
    await manager.getByRole('button',{name:'Review committee input',exact:true}).click();
    await expect(manager.locator('h1')).toHaveText('Review committee input');
    await expect(manager.locator('#committee-review .cons').first()).toContainText('3 of 3');
    await expect(manager.locator('#committee-review .cons').first()).toContainText('avg 5.0');
    await expect(manager.locator('#committee-review')).toContainText('Water main replacements are the most urgent community need.');
    await expect(manager.locator('#committee-review')).toContainText('Residents need reliable utilities and a stronger downtown.');
    await expect(manager.locator('.crit-row')).toHaveCount(0);
    await expect(manager.getByRole('button',{name:'Review what this would change',exact:true})).toBeDisabled();
    await manager.getByRole('button',{name:'Manage questionnaire',exact:true}).click();
    await manager.getByRole('button', { name:'Close and read the room', exact:true }).click();
    await expect(manager.locator('#toast')).toContainText('Intake closed');
    await manager.getByRole('button',{name:'Review committee input',exact:true}).click();
    await manager.getByRole('button', { name:'Review what this would change', exact:true }).click();
    await expect(manager).toHaveURL(/\/profile$/);
    await expect(manager.locator('#adoptplan')).toContainText('Financial management');
    await manager.screenshot({path:testInfo.outputPath('administrator-review.png'),fullPage:true});
    await manager.getByRole('button', { name:'Save this profile', exact:true }).click();
    await expect(manager.locator('#toast')).toContainText('Profile saved from committee input');
    await expect(manager.locator('#prof-skill .crit-row').first().locator('[data-f="label"]')).toHaveValue('Financial management');
    await members.ada.page.goto('/#/s/' + search.id + '/profile');
    await expect(members.ada.page.locator('h1')).toHaveText('Adopted candidate profile');
    await expect(members.ada.page.locator('.crit-row')).toHaveCount(0);
    await expect(members.ada.page.locator('[data-act="adopt-preview"]')).toHaveCount(0);
    await expect(members.ada.page.locator('.crit-read')).toContainText(['Financial management','Community engagement','Staff leadership','Aging water infrastructure','Downtown revitalization']);
    await members.ada.page.getByText('View submitted committee input (read-only)',{exact:true}).click();
    await expect(members.ada.page.locator('details .voice').first()).toContainText('Residents need reliable utilities and a stronger downtown.');
    for (const [label, route] of [['Create brochure','brochure'], ['Create advertisement','ads'], ['Review candidates','screen']]) {
      await manager.getByRole('navigation', { name:'Search stages', exact:true }).getByRole('button', { name:new RegExp('^' + label) }).click();
      await expect(manager).toHaveURL(new RegExp('/' + route + '$'));
      await expect(manager.locator('h1')).toBeVisible();
    }
    await expect(members.ada.page.getByRole('navigation', { name:'Search stages', exact:true })).toHaveCount(0);
    await manager.screenshot({ path:testInfo.outputPath('owner-stages.png'), fullPage:true });
  } finally {
    await Promise.all([managerContext.close(), members.ada.context.close(), members.bo.context.close()]);
  }
});

test('quality suggestions build the shared questionnaire without losing custom wording or window notes', async ({ browser }, testInfo) => {
  test.slow();
  const {search, manager, managerContext, members} = await openIntake(browser, testInfo, ['ada'], {draft:true});
  try {
    for (const page of [manager, members.ada.page]) await page.setViewportSize(testInfo.project.use.viewport || {width:1280,height:720});
    await manager.goto('/#/s/' + search.id + '/intake');
    const form = manager.locator('#sharedqualities');
    const financial = form.getByRole('button', {name:'Financial management',exact:true});
    await manager.locator('#intakewindow [name="prompt"]').fill('Consider our next five years.');
    await form.locator('[name="trait"]').fill('Calm under pressure');
    await financial.click();
    await expect(financial).toHaveAttribute('aria-pressed','true');
    await form.getByRole('button', {name:'Staff leadership',exact:true}).click();
    await form.locator('[name="skill"]').fill('Financial management\nStaff leadership\nGrant administration');
    await financial.click();
    await expect(financial).toHaveAttribute('aria-pressed','false');
    await expect(form.locator('[name="skill"]')).toHaveValue('Staff leadership\nGrant administration');
    await form.locator('[name="skill"]').fill('Team development\nGrant administration');
    await expect(form.getByRole('button', {name:'Staff leadership',exact:true})).toHaveAttribute('aria-pressed','false');
    await financial.click();
    await expect(form.locator('[name="trait"]')).toHaveValue('Calm under pressure');
    await expect(manager.locator('#intakewindow [name="prompt"]')).toHaveValue('Consider our next five years.');
    await manager.getByRole('button', {name:'Save shared qualities',exact:true}).click();
    await expect(manager.locator('#toast')).toContainText('Shared qualities saved');
    await manager.reload();
    await expect(form.locator('[name="skill"]')).toHaveValue('Team development\nGrant administration\nFinancial management');
    await expect(financial).toHaveAttribute('aria-pressed','true');
    await manager.screenshot({path:testInfo.outputPath('shared-quality-picker.png'),fullPage:true});
    await manager.getByRole('button', {name:'Open the window',exact:true}).click();
    await expect(manager.locator('#toast')).toContainText('Intake is open');

    const member = members.ada.page;
    await member.goto('/#/s/' + search.id + '/intake');
    const financialRow = member.locator('.intake-row').filter({has:member.locator('[data-f="label"][value="Financial management"]')});
    await expect(financialRow.getByText('Explain why', {exact:true})).toBeVisible();
    await financialRow.getByRole('textbox', {name:'Explain why Financial management matters (optional)',exact:true}).fill('We need careful oversight of the capital budget.');
    for (const rating of [1,2,3,4,5]) await expect(financialRow.getByRole('button',{name:`Rate Financial management ${rating} of 5`,exact:true})).toBeVisible();
    const additions = member.locator('#ipick-skill');
    await expect(additions.getByRole('button',{name:'Financial management',exact:true})).toBeDisabled();
    await additions.getByRole('button',{name:'Communication',exact:true}).click();
    await expect(additions.getByRole('button',{name:'Strategic leadership',exact:true})).toBeVisible();
    for (const label of ['Team development','Grant administration','Financial management','Calm under pressure']) {
      await member.getByRole('button',{name:'Rate '+label+' 5 of 5',exact:true}).click();
    }
    await member.getByRole('button',{name:'Submit my answers',exact:true}).click();
    await expect(member.locator('#toast')).toContainText('Your answers are in');
    const result = await (await manager.request.get('/api/searches/' + search.id)).json();
    expect(result.intake.prompt).toBe('Consider our next five years.');
    expect(result.consensus.byKind.skill.map(q => q.label)).toEqual(expect.arrayContaining(['Team development','Grant administration','Financial management','Communication']));
    expect(result.consensus.byKind.skill.find(q => q.label === 'Financial management').notes).toEqual(expect.arrayContaining([expect.objectContaining({note:'We need careful oversight of the capital budget.',weight:5})]));
  } finally { await Promise.all([managerContext.close(), members.ada.context.close()]); }
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
    await row.locator('[data-f="label"]').fill('Something I am still thinking about');
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
    await expect(page.locator('#intake-sec-skill .intake-row').first().locator('[data-f="label"]'))
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
    await manager.getByRole('button', { name: 'Save profile' }).click();
    await expect(manager.locator('#toast')).toContainText('Profile saved');
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
    await page.locator('#intake-sec-trait .intake-row').first().locator('[data-f="label"]').fill('Approachable');
    // Re-render on blur is what puts the typed label into the button names.
    await page.locator('#intake-sec-trait .intake-row').first()
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
    await expect(page.locator('#intake-sec-skill .intake-row')).toHaveCount(2);
    await expect(add).toBeFocused();
  } finally {
    await Promise.all([managerContext.close(), members.ada.context.close()]);
  }
});
