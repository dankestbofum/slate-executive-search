'use strict';
// Diagnostic-only scenarios. Isolated fixture authentication, disposable store,
// loopback listener, no Anthropic credentials and no paid endpoints.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { fork } = require('child_process');
const root = path.resolve(__dirname, '../../..');
const identity = require(path.join(root, 'tests/identity'));
const fixture = identity.serverEnv();
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'slate-workflow-audit-'));
const evidence = { generatedAt: new Date().toISOString(), isolation: 'Disposable OS temporary DATA_DIR, loopback port, fixture Clerk signatures; no paid API calls', results: [] };
const server = fork(path.join(root, 'tests/server.js'), [], { cwd: root, windowsHide: true,
  env: { ...process.env, NODE_ENV: 'test', PORT: '0', HOST: '127.0.0.1', DATA_DIR: path.join(dir, 'server'), ANTHROPIC_API_KEY: '', TRUST_PROXY: '', ...fixture.server,
    SLATE_EMAIL_TEAM: 'team@slate.local', SLATE_EMAIL_ABE: 'abe@slate.local', SLATE_EMAIL_MIKE: 'mike@slate.local' }, stdio: ['ignore','ignore','pipe','ipc'] });
server.stderr.on('data', () => {});
function record(id, description, observed) { evidence.results.push({ id, description, ...observed }); console.log(id + ': ' + JSON.stringify(observed)); }
(async () => {
  try {
    const ready = await new Promise((resolve, reject) => { const t = setTimeout(() => reject(new Error('startup timeout')), 20000); server.once('message', x => { clearTimeout(t); resolve(x); }); server.once('error', reject); });
    const base = 'http://127.0.0.1:' + ready.port;
    const org = await identity.bootstrapWorkspace(base, { owner: 'abe@slate.local', staff: ['mike@slate.local'], privateKey: fixture.privateKey });
    const sign = identity.signer(fixture.privateKey);
    const abe = 'abe@slate.local', mike = 'mike@slate.local', alice = 'alice-workflow@example.com', bob = 'bob-workflow@example.com';
    async function api(url, email = abe, method = 'GET', body, revision) {
      const headers = { 'content-type': 'application/json', ...sign.inOrg(email, org) };
      if (revision !== undefined) headers['if-match'] = String(revision);
      const r = await fetch(base + url, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
      const data = await r.json(); return { status: r.status, data };
    }
    let search = (await api('/api/searches', abe, 'POST', { client: 'Workflow Audit County', position: 'Administrator', jurisdictionType: 'county' })).data;
    const url = '/api/searches/' + search.id;
    async function read(email = abe) { return api(url, email); }
    async function write(suffix, email, method, body, rev) { const current = await read(abe); return api(url + suffix, email, method, body, rev === undefined ? current.data.revision : rev); }
    const item = (label, note = '') => ({ kind: 'skill', label, weight: 5, note });
    record('W01', 'Opening without confirmed roster is refused', await write('/intake/status', abe, 'POST', { status: 'open' }));
    for (const [name, email] of [['Alice Workflow', alice], ['Bob Workflow', bob]]) {
      const added = await write('/members', abe, 'POST', { name, email, searchRole: 'committee' });
      if (added.status !== 200) throw new Error('roster ' + JSON.stringify(added));
      await api('/api/me', email);
    }
    const roster = (await read()).data.roster;
    const aliceId = roster.find(x => x.email === alice).userId;
    const bobId = roster.find(x => x.email === bob).userId;
    await write('/team/confirm', abe, 'POST', { confirmed: true });
    record('W02', 'Confirmed roster permits opening', { status: (await write('/intake/status', abe, 'POST', { status: 'open' })).status });
    record('W03', 'Unassigned staff cannot submit, close or adopt', { submit: (await write('/intake', mike, 'PUT', { submitted: true, items: [item('Staff input')] })).status, close: (await write('/intake/status', mike, 'POST', { status: 'closed' })).status, adopt: (await write('/intake/adopt', mike, 'POST', {})).status });
    record('W04', 'Committee cannot close or adopt', { close: (await write('/intake/status', alice, 'POST', { status: 'closed' })).status, adopt: (await write('/intake/adopt', alice, 'POST', {})).status });
    record('W05', 'Empty and narrative-only submissions are refused', { empty: (await write('/intake', alice, 'PUT', { submitted: true, items: [] })).status, narrativeOnly: (await write('/intake', alice, 'PUT', { submitted: true, mustHave: 'A public servant', items: [] })).status, noInputAdopt: (await write('/intake/adopt', abe, 'POST', {})).status });
    const beforeDraft = (await read(alice)).data.revision;
    const draft = await write('/intake', alice, 'PUT', { submitted: false, items: [item('UNFINISHED ALICE DRAFT', 'DRAFT PRIVATE NOTE')], context: 'DRAFT PRIVATE CONTEXT' });
    const afterDraft = (await read()).data;
    record('W06', 'Draft excluded from tally and revision changes', { status: draft.status, beforeRevision: beforeDraft, afterRevision: afterDraft.revision, submitted: afterDraft.consensus.submitted, staleDraftStatus: (await write('/intake', alice, 'PUT', { submitted: false, items: [item('Stale edit')] }, beforeDraft)).status });
    await write('/intake', bob, 'PUT', { submitted: true, items: [item('Financial stewardship', 'SUBMITTED PRIVATE BOB NOTE')], mustHave: 'SUBMITTED PRIVATE BOB NARRATIVE' });
    const aliceOpen = (await read(alice)).data;
    const staffOpen = (await read(mike)).data;
    record('W07', 'Open-window direct privacy and staff aggregate visibility', { committeeConsensus: aliceOpen.consensus, committeeSubmissionKeys: Object.keys(aliceOpen.intake.submissions), committeeSeesBobNote: JSON.stringify(aliceOpen).includes('SUBMITTED PRIVATE BOB NOTE'), unassignedStaffVoters: staffOpen.consensus.byKind.skill[0].voters, unassignedStaffVoices: staffOpen.consensus.voices });
    const adoptedOpen = await write('/intake/adopt', abe, 'POST', {});
    const afterEarly = (await read(alice)).data;
    record('W08', 'Adopt while open exposes source note and support count through profile', { status: adoptedOpen.status, intakeStatus: afterEarly.intake.status, consensus: afterEarly.consensus, criteria: afterEarly.criteria, memberSeesBobNote: JSON.stringify(afterEarly).includes('SUBMITTED PRIVATE BOB NOTE'), gaps: adoptedOpen.data.gaps });
    await write('/intake/status', abe, 'POST', { status: 'closed' });
    const bobClosed = (await read(bob)).data;
    record('W09', 'Closing publishes unfinished drafts to another committee member', { draftVisible: bobClosed.intake.submissions[aliceId], submittedCount: bobClosed.consensus.submitted, rawSubmissionCount: Object.keys(bobClosed.intake.submissions).length });
    record('W10', 'Closed intake rejects edits', { status: (await write('/intake', bob, 'PUT', { submitted: true, items: [item('Too late')] })).status });
    await write('/intake/status', abe, 'POST', { status: 'open' });
    const reopened = (await read(alice)).data;
    record('W11', 'Reopening hides aggregate but cannot unpublish profile source note', { intakeStatus: reopened.intake.status, consensus: reopened.consensus, memberSeesBobNote: JSON.stringify(reopened).includes('SUBMITTED PRIVATE BOB NOTE') });
    const beforeWithdrawal = (await read()).data;
    await write('/intake', bob, 'PUT', { submitted: false, items: [item('Financial stewardship', 'REVISED UNSUBMITTED BOB NOTE')] });
    const withdrawn = (await read()).data;
    record('W12', 'Save-and-finish-later after submission silently withdraws tally but keeps adopted profile', { submittedBefore: beforeWithdrawal.consensus.submitted, submittedAfter: withdrawn.consensus.submitted, profileCriteria: withdrawn.criteria, activityUnchanged: JSON.stringify(beforeWithdrawal.activity) === JSON.stringify(withdrawn.activity), activityBefore: beforeWithdrawal.activity?.slice(0, 3), activityAfter: withdrawn.activity?.slice(0, 3) });
    await write('/intake', bob, 'PUT', { submitted: true, items: [item('Strategic planning', 'REPLACEMENT BOB NOTE')] });
    const revised = (await read()).data;
    record('W13', 'Revision updates aggregate without stale adoption warning', { aggregateSkill: revised.consensus.byKind.skill.map(x => x.label), profileSkill: revised.criteria.map(x => x.label), staleFields: Object.fromEntries(Object.entries(revised).filter(([k]) => /stale|revision|adopt/i.test(k))) });
    await write('/intake/status', abe, 'POST', { status: 'closed' });
    const readopted = await write('/intake/adopt', abe, 'POST', {});
    record('W14', 'Rebuild retains obsolete committee criteria as filler', { status: readopted.status, criteria: readopted.data.search.criteria });
    const removed = await write('/members/' + bobId, abe, 'DELETE');
    record('W15', 'Removing member withdraws answers and access but keeps adopted criteria', { status: removed.status, submitted: removed.data.search.consensus.submitted, criteria: removed.data.search.criteria, removedMemberReadStatus: (await read(bob)).status, rosterConfirmed: Boolean(removed.data.search.team.confirmedAt), intakeStatus: removed.data.search.intake.status });
    record('W16', 'Cannot reopen after roster change until reconfirmed', { status: (await write('/intake/status', abe, 'POST', { status: 'open' })).status });
    await write('/team/confirm', abe, 'POST', { confirmed: true });
    await write('/intake/status', abe, 'POST', { status: 'open' });
    await write('/members', abe, 'POST', { name: 'Mike Letcher', email: mike, searchRole: 'consultant' });
    const addedDuringOpen = (await read()).data;
    record('W17', 'Adding member while open clears roster confirmation but intake remains open', { confirmed: Boolean(addedDuringOpen.team.confirmedAt), intakeStatus: addedDuringOpen.intake.status, newMemberSubmitStatus: (await write('/intake', mike, 'PUT', { submitted: true, items: [item('New member priority')] })).status });
    await write('/intake/status', abe, 'POST', { status: 'draft' });
    const draftStateAdopt = await write('/intake/adopt', abe, 'POST', {});
    record('W18', 'Adoption also succeeds in draft intake state with retained answers', { status: draftStateAdopt.status, intakeStatus: draftStateAdopt.data.search?.intake.status });
    const blank = (await api('/api/searches', abe, 'POST', { client: 'Empty Closure Audit', position: 'Administrator' })).data;
    const emptyClose = await api('/api/searches/' + blank.id + '/intake/status', abe, 'POST', { status: 'closed' }, blank.revision);
    record('W19', 'Can close never-opened empty intake without roster confirmation', { status: emptyClose.status, intakeStatus: emptyClose.data.intake?.status, submitted: emptyClose.data.consensus?.submitted, intakeStep: emptyClose.data.steps?.find(x => x.key === 'intake') });
  } catch (e) { evidence.error = e.stack; process.exitCode = 1; console.error(e); }
  finally { server.kill(); fs.writeFileSync(path.join(__dirname, 'workflow-evidence.json'), JSON.stringify(evidence, null, 2) + '\n'); }
})();
