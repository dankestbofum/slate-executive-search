'use strict';
const fs = require('fs');
const path = require('path');
const { test, expect } = require('@playwright/test');
const AxeBuilder = require('@axe-core/playwright').default;
const { installClerk, joinWorkspace } = require('../../../tests/browser/clerk');

test('committee intake audit through member and facilitator screens', async ({ page, browser }, testInfo) => {
  const evidence = { project: testInfo.project.name, steps: [], observations: {}, dialogs: [] };
  const record = (step, detail) => evidence.steps.push({ step, detail });
  const screenshot = async (target, name) => target.screenshot({ path: path.join(__dirname, 'browser-' + testInfo.project.name + '-' + name + '.png'), fullPage: true });
  const get = async () => (await page.request.get('/api/searches/' + search.id)).json();
  const memberContexts = [];
  page.on('dialog', async dialog => { evidence.dialogs.push(dialog.message()); await dialog.accept(); });
  try {
    await installClerk(page);
    const created = await page.request.post('/api/searches', { data: { client: 'Committee browser audit ' + testInfo.project.name, position: 'City Manager', package: 'executive' } });
    expect(created.ok()).toBeTruthy();
    var search = await created.json();
    const members = [];
    for (const [index, name] of ['Alex Budget', 'Blair Growth'].entries()) {
      const email = `committee-browser-${testInfo.project.name}-${index}@example.test`;
      const add = await page.request.post('/api/searches/' + search.id + '/members', {
        headers: { 'if-match': String((await get()).revision) }, data: { name, email, searchRole: 'committee' }
      });
      expect(add.ok(), await add.text()).toBeTruthy();
      await joinWorkspace(email);
      const context = await browser.newContext({ ...testInfo.project.use, baseURL: process.env.SLATE_BROWSER_BASE });
      memberContexts.push(context);
      const member = await context.newPage();
      await installClerk(member, { email });
      members.push(member);
    }
    await page.goto('/#/s/' + search.id + '/team');
    await page.locator('[data-act="confirm-team"]').click();
    await expect(page.getByText('Roster confirmed', { exact: true }).first()).toBeVisible();
    await page.goto('/#/s/' + search.id + '/intake');
    await page.locator('[name="dueBy"]').fill('21 Sep 2026');
    await page.locator('[name="prompt"]').fill('Prioritize the next three years of city leadership.');
    await page.locator('[data-act="intake-open"]').click();
    await expect(page.locator('[data-act="intake-close"]')).toBeVisible();
    record('Facilitator opens intake', 'Confirmed roster and opened window in browser, with due date and prompt. Roster creation used authenticated fixture API.');

    const [alex, blair] = members;
    for (const member of members) {
      await member.goto('/#/s/' + search.id + '/intake');
      await expect(member.getByRole('heading', { name: 'What are you looking for?' })).toBeVisible();
    }
    const fillItem = async (member, kind, label, weight, note = '') => {
      await member.locator('[data-iadd="' + kind + '"]').click();
      const row = member.locator('#intake-sec-' + kind + ' .intake-row').last();
      await row.locator('[data-f="label"]').fill(label);
      await row.locator('[data-f="note"]').fill(note);
      await row.locator('[data-iw="' + weight + '"]').click();
    };
    await fillItem(alex, 'skill', 'Strong financial management skills', 5, 'Balance a constrained budget.');
    await fillItem(alex, 'trait', 'Integrity', 5);
    await fillItem(alex, 'chall', 'Infrastructure renewal', 4);
    await fillItem(alex, 'opp', 'Regional partnerships', 3);
    await alex.locator('#intake-mustHave').fill('Evidence of transparent financial decisions.');
    await alex.locator('[data-act="save-intake"]').click();
    await expect(alex.locator('#toast')).toContainText('Come back and submit');
    expect((await get()).consensus.submitted).toBe(0);
    await alex.reload();
    await expect(alex.locator('#intake-sec-skill [data-f="label"]')).toHaveValue('Strong financial management skills');
    record('Member saves draft and reloads', 'All four categories entered via browser. Draft persisted; consultant aggregate stayed at zero submissions.');
    const axe = await new AxeBuilder({ page: alex }).analyze();
    evidence.observations.accessibility = axe.violations.map(v => ({ id: v.id, impact: v.impact, description: v.description, nodes: v.nodes.map(n => ({ target: n.target, failureSummary: n.failureSummary })) }));
    evidence.observations.overflow = await alex.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    await screenshot(alex, 'saved-draft');
    await alex.locator('[data-act="submit-intake"]').click();
    await expect(alex.getByText('Your answers are in', { exact: true })).toBeVisible();
    expect((await get()).consensus.submitted).toBe(1);
    record('Member submits', 'Submitted draft through browser; consultant aggregate changed to one.');
    await page.reload();
    await expect(page.locator('.cons').filter({ hasText: 'Strong financial management skills' })).toContainText('1 of 1');
    await screenshot(page, 'running-tally');
    evidence.observations.openMemberConsensus = (await (await blair.request.get('/api/searches/' + search.id)).json()).consensus;

    await alex.locator('[data-act="save-intake"]').click();
    await expect(alex.locator('#toast')).toContainText('Come back and submit');
    const retracted = await get();
    evidence.observations.saveAfterSubmit = { submittedCount: retracted.consensus.submitted, pendingCount: retracted.consensus.pending.length, confirmationDialogs: [] };
    expect(retracted.consensus.submitted).toBe(0);
    record('Save after submission', 'Clicking Save and finish later withdrew the previously submitted answers from the tally without confirmation.');
    await alex.locator('[data-act="submit-intake"]').click();
    await expect(alex.getByText('Your answers are in', { exact: true })).toBeVisible();

    await fillItem(blair, 'skill', 'Financial management', 1, 'Delegate technical work; focus on leadership.');
    await fillItem(blair, 'trait', 'Integrity', 5);
    await fillItem(blair, 'chall', 'Infrastructure renewal', 4);
    await fillItem(blair, 'opp', 'Economic development', 5);
    const conflictResponse = blair.waitForResponse(r => r.url().endsWith('/intake') && r.request().method() === 'PUT');
    await blair.locator('[data-act="submit-intake"]').click();
    const conflict = await conflictResponse;
    evidence.observations.concurrentSubmission = { status: conflict.status(), body: await conflict.json(), retainedRowsBeforeReload: await blair.locator('.intake-row').count() };
    expect(conflict.status()).toBe(409);
    evidence.observations.concurrentSubmission.inAppReloadControls = await blair.locator('[data-act="reload-search"]').count();
    const retryResponse = blair.waitForResponse(r => r.url().endsWith('/intake') && r.request().method() === 'PUT');
    await blair.locator('[data-act="submit-intake"]').click();
    evidence.observations.concurrentSubmission.retryStatus = (await retryResponse).status();
    expect(evidence.observations.concurrentSubmission.retryStatus).toBe(409);
    await screenshot(blair, 'submission-conflict');
    await blair.reload();
    await expect(blair.getByRole('heading', { name: 'What are you looking for?' })).toBeVisible();
    evidence.observations.concurrentSubmission.rowsAfterReload = await blair.locator('.intake-row').count();
    record('Concurrent member submission', 'Second member opened before first submitted. Their submit received HTTP 409; reload discarded unsaved rows. Reentered answers after reload to continue.');
    await fillItem(blair, 'skill', 'Financial management', 1, 'Delegate technical work; focus on leadership.');
    await fillItem(blair, 'trait', 'Integrity', 5);
    await fillItem(blair, 'chall', 'Infrastructure renewal', 4);
    await fillItem(blair, 'opp', 'Economic development', 5);
    await blair.locator('[data-act="submit-intake"]').click();
    await expect(blair.getByText('Your answers are in', { exact: true })).toBeVisible();
    await page.reload();
    const tally = page.locator('.cons').filter({ hasText: 'Financial management' });
    await expect(tally).toContainText('2 of 2');
    await expect(tally).toContainText('avg 3.0');
    await expect(tally).toContainText('Contested');
    evidence.observations.aggregate = (await get()).consensus;
    record('Second member submits matching wording', 'Financial management merged into 2 of 2, average 3.0, Contested for weights 5 and 1. Manager remained pending (2 of 3 people answered).');
    await page.locator('[data-act="intake-close"]').click();
    await expect(page.locator('[data-act="intake-open"]')).toHaveText('Reopen the window');
    await alex.reload();
    await expect(alex.getByText('Intake is closed', { exact: true })).toBeVisible();
    await expect(alex.locator('.cons').filter({ hasText: 'Financial management' })).toContainText('2 of 2');
    record('Close and release', 'Close action warned that one member had not answered. After accepting, member could read named aggregate and could no longer edit answers.');
    await screenshot(alex, 'closed-member');

    await page.locator('[data-act="adopt-consensus"]').click();
    await expect(page.getByRole('heading', { name: 'Candidate profile' })).toBeVisible();
    const profileRow = page.locator('#prof-skill .crit-row').first();
    await expect(profileRow.locator('.crit-src')).toContainText('2 of 2');
    await expect(profileRow.locator('[data-w="3"]')).toHaveAttribute('aria-pressed', 'true');
    evidence.observations.adoptedCriteria = (await get()).criteria;
    await screenshot(page, 'adopted-profile');
    record('Adopt aggregate', 'Browser built persisted profile with average weight rounded to 3 and support/contested badges. Missing categories still require additions before profile completion.');
    await profileRow.locator('[data-f="label"]').fill('Financial stewardship');
    await profileRow.locator('[data-w="4"]').click();
    evidence.observations.renamedSourceBadge = await page.locator('#prof-skill .crit-row').first().locator('.crit-src').innerText();
    expect(evidence.observations.renamedSourceBadge).toBe('Yours');
    record('Rename adopted criterion', 'Renaming then clicking a weight rerendered the committee-origin line as Yours and removed its support/contested badge.');
    await screenshot(page, 'renamed-profile');
  } finally {
    fs.writeFileSync(path.join(__dirname, 'browser-' + testInfo.project.name + '-evidence.json'), JSON.stringify(evidence, null, 2));
    for (const context of memberContexts) await context.close();
  }
});
