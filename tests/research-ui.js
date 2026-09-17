'use strict';

// The interface around a research operation.
//
// Four of the defects in docs/audits/2026-09-16-website-audit were in this
// file's subject rather than in the server: Cancel announced an outcome the
// server had not confirmed, a failed job lost its explanation when the search
// was reopened, the first request had no deadline of its own, and the two
// screens that start research disagreed about whether it was available.
//
// The functions are lifted out of public/app.js and run in an isolated context
// with synthetic state, the same technique the audit used to reproduce the
// defects. There is no browser and no network here, so what is proved is the
// decision-making: what is claimed, what is kept, what is asked of the server,
// and what is said to the consultant. Real rendering, focus and accessibility
// are the browser suite's job (tests/browser).

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const source = fs.readFileSync(path.join(__dirname, '../public/app.js'), 'utf8');
let passed = 0;
let failed = 0;

async function check(name, fn) {
  try { await fn(); passed += 1; console.log('PASS  Research UI: ' + name); }
  catch (error) { failed += 1; console.error('FAIL  Research UI: ' + name + '\n      ' + (error && error.stack || error)); }
}

/** One top-level function, by name, as it is actually written. */
function extract(name) {
  const match = source.match(new RegExp('^(?:async )?function ' + name + '\\([^]*?^}', 'm'));
  assert.ok(match, 'public/app.js no longer defines ' + name);
  return match[0];
}

/** One top-level constant, so a bound under test is the bound in the source. */
function constant(name) {
  const match = source.match(new RegExp('^const ' + name + ' = ([^;]+);', 'm'));
  assert.ok(match, 'public/app.js no longer defines ' + name);
  return match[0];
}

const TERMINAL = ['succeeded', 'partial', 'failed', 'cancelled', 'interrupted'];

/**
 * An isolated page.
 *
 * Everything the extracted functions reach for is either the real thing from
 * the source or a stub that records what was asked of it. `calls` is the
 * transcript: which requests were made, with which deadlines, and what the
 * consultant was told.
 */
function page({ functions = [], constants = [], respond = null, search = null } = {}) {
  const calls = { requests: [], messages: [], renders: 0, timers: [], refreshed: [] };
  const sandbox = {
    console,
    AbortController, AbortSignal, Promise, Date, Math, JSON, Set, Map, Object, Array,
    String, Number, Boolean, encodeURIComponent, setTimeout, clearTimeout,
    state: {
      search: search || { id: 'sr-synthetic', steps: [{ key: 'profile', status: 'done' }], client: 'Example City', website: 'https://example.gov' },
      org: { id: 'org-synthetic' },
      health: { hasKey: true },
      caps: { staff: true },
      research: { token: 0, active: null, error: null, review: null, key: null, dismissed: {}, draft: null }
    },
    RESEARCH_TERMINAL: new Set(TERMINAL),
    // Page furniture, stubbed: this suite is about decisions, not markup.
    $: () => null,
    esc: value => String(value === undefined || value === null ? '' : value),
    withTip: html => html,
    TIPS: { research: 'tip' },
    stepNo: () => 3,
    jurisdictionInfo: () => ({ noun: 'city' }),
    isCommittee: () => false,
    isFrozen: () => false,
    lifecycleOf: () => 'active',
    toast: message => { calls.messages.push(message); },
    render: () => { calls.renders += 1; },
    hideWait: () => {},
    showWait: () => {},
    setWaitStage: () => {},
    stageText: stage => String(stage || 'working'),
    researchWait: () => {},
    researchStale: () => false,
    pollResearch: () => {},
    researchInline: async () => {},
    loadSearch: async () => {},
    withBusy: async fn => fn(),
    refreshAfterResearch: (id, view) => { calls.refreshed.push({ id, view }); },
    api: (url, opts = {}) => {
      calls.requests.push({ url, method: opts.method || 'GET', timeoutMs: opts.timeoutMs || 0, headers: opts.headers || {} });
      if (!respond) return new Promise(() => {});
      return respond(url, opts, calls);
    }
  };
  vm.createContext(sandbox);
  vm.runInContext([...constants.map(constant), ...functions.map(extract)].join('\n'), sandbox);
  return { sandbox, calls, state: sandbox.state };
}

const settle = () => new Promise(resolve => setTimeout(resolve, 20));

(async () => {

  /* ---------------- D04: a failure survives leaving the page ---------------- */

  for (const kind of ['failed', 'interrupted']) {
    await check('reopening a search restores a ' + kind + ' job\'s explanation', async () => {
      const { sandbox, state } = page({ functions: ['adoptResearchJob', 'researchTerminal', 'restoreResearchOutcome'] });
      state.search.researchJob = {
        id: 'rj-synthetic', state: kind, reviewable: false,
        failure: { code: 'RESEARCH_TIMEOUT', error: 'Research ran past its time limit and was stopped.' }
      };
      sandbox.adoptResearchJob();
      assert.ok(state.research.error, 'the stored failure was not restored, so the page looks like nothing happened');
      assert.strictEqual(state.research.error.code, 'RESEARCH_TIMEOUT');
      assert.strictEqual(state.research.error.operation, 'rj-synthetic',
        'the support reference was lost, so a consultant cannot quote the operation');
      assert.strictEqual(state.research.error.retry, true, 'a timeout was reported as not retryable');
    });
  }

  await check('a failure the consultant has dealt with is not re-announced', async () => {
    const { sandbox, state } = page({ functions: ['adoptResearchJob', 'researchTerminal', 'restoreResearchOutcome', 'dismissResearchNotice'] });
    state.search.researchJob = {
      id: 'rj-one', state: 'failed', reviewable: false,
      failure: { code: 'RESEARCH_FAILED', error: 'Research did not finish.' }
    };
    sandbox.adoptResearchJob();
    assert.ok(state.research.error);
    sandbox.dismissResearchNotice();
    assert.strictEqual(state.research.error, null);
    // Coming back to the same search, with the same job on it.
    sandbox.adoptResearchJob();
    assert.strictEqual(state.research.error, null, 'a dismissed failure came back on the next visit');
    // A different operation is a different decision.
    state.search.researchJob = { id: 'rj-two', state: 'failed', reviewable: false, failure: { code: 'RESEARCH_FAILED', error: 'Research did not finish.' } };
    sandbox.adoptResearchJob();
    assert.ok(state.research.error, 'a later failure was suppressed by an earlier dismissal');
    assert.strictEqual(state.research.error.operation, 'rj-two');
  });

  await check('a job that saved needs no notice, and a conflict needs both', () => {
    const { sandbox } = page({ functions: ['researchTerminal'] });
    const saved = sandbox.researchTerminal({ id: 'rj-a', state: 'succeeded' });
    assert.strictEqual(saved.saved, true);
    assert.ok(!saved.error, 'a successful job produced a failure panel');

    // A stale-search conflict: good findings, and a file that moved under them.
    const conflict = sandbox.researchTerminal({
      id: 'rj-b', state: 'failed', reviewable: true,
      failure: { code: 'STALE_SEARCH', error: 'This search changed while research was running.' }
    });
    assert.ok(conflict.review, 'the paid findings were dropped from the conflict case');
    assert.ok(conflict.error, 'the reason the findings were held back was not reported');

    // A partial has findings and nothing to apologise for.
    const partial = sandbox.researchTerminal({ id: 'rj-c', state: 'partial', reviewable: true, missing: ['budget'] });
    assert.ok(partial.review);
    assert.strictEqual(partial.error, null, 'an incomplete-but-supported result was reported as a failure');

    // A credential problem is not something to retry into.
    const credentials = sandbox.researchTerminal({
      id: 'rj-d', state: 'failed', reviewable: false,
      failure: { code: 'AUTH_ERROR', error: 'The Anthropic API key is invalid or expired.' }
    });
    assert.strictEqual(credentials.error.retry, false, 'a bad key was offered a retry that cannot work');
  });

  /* ---------------- D03: Cancel claims only what it knows ---------------- */

  await check('Cancel returns control without claiming the outcome', async () => {
    const { sandbox, state, calls } = page({
      functions: ['cancelResearch', 'requestCancel', 'endResearch', 'reconcileResearch', 'researchTerminal', 'applyTerminalResearch'],
      constants: ['RESEARCH_CANCEL_TIMEOUT_MS', 'RESEARCH_LOOKUP_TIMEOUT_MS']
    });
    const active = { jobId: 'rj-synthetic', searchId: state.search.id, orgId: state.org.id, key: 'rk-1', controller: new AbortController() };
    state.research.active = active;
    state.research.key = 'rk-1';
    void sandbox.cancelResearch(active);
    await settle();
    assert.strictEqual(calls.messages[0], 'Cancellation requested. Waiting for the server to confirm.',
      'Cancel announced an outcome before the server answered: "' + calls.messages[0] + '"');
    assert.ok(!calls.messages.some(m => /Nothing was saved/.test(m)),
      'Cancel claimed nothing was saved while the server had not answered');
    assert.strictEqual(calls.requests.length, 1, 'the cancellation was not sent');
    assert.match(calls.requests[0].url, /\/cancel$/);
    assert.strictEqual(calls.requests[0].method, 'POST');
    assert.ok(calls.requests[0].timeoutMs > 0, 'the cancellation request has no deadline of its own');
    assert.strictEqual(state.research.active, null, 'the page was not released when Cancel was pressed');
  });

  await check('an acknowledged cancellation says what the server said', async () => {
    const answers = {
      plain: { job: { id: 'rj-1', state: 'cancelled', reviewable: false } },
      saved: { alreadyCompleted: true, job: { id: 'rj-1', state: 'succeeded' } },
      found: { job: { id: 'rj-1', state: 'cancelled', reviewable: true, sources: [], missing: [] } }
    };
    for (const [kind, answer] of Object.entries(answers)) {
      const { sandbox, state, calls } = page({
        functions: ['requestCancel', 'endResearch', 'researchTerminal'],
        constants: ['RESEARCH_CANCEL_TIMEOUT_MS'],
        respond: () => Promise.resolve(answer)
      });
      state.research.key = 'rk-1';
      await sandbox.requestCancel(state.search.id, 'rj-1');
      const said = calls.messages.join(' | ');
      if (kind === 'plain') assert.match(said, /cancelled\. Nothing was saved/i, 'a confirmed cancellation said: ' + said);
      if (kind === 'saved') {
        assert.match(said, /already finished and been saved/i, 'a save that won the race said: ' + said);
        assert.strictEqual(calls.refreshed.length, 1, 'the page was not reloaded to show what was written');
      }
      if (kind === 'found') {
        assert.ok(state.research.review, 'findings paid for before cancellation were thrown away');
        assert.match(said, /Nothing was saved/i);
      }
      assert.strictEqual(state.research.key, null, 'an acknowledged outcome left the key held');
    }
  });

  await check('a cancellation that is never acknowledged is reported as unknown', async () => {
    const { sandbox, state } = page({
      functions: ['requestCancel', 'endResearch', 'researchTerminal'],
      constants: ['RESEARCH_CANCEL_TIMEOUT_MS'],
      respond: () => Promise.reject(Object.assign(new Error('timeout'), { code: 'REQUEST_TIMEOUT', timedOut: true }))
    });
    await sandbox.requestCancel(state.search.id, 'rj-1');
    assert.ok(state.research.error, 'a lost cancellation left the page saying nothing');
    assert.match(state.research.error.error, /not known here/i,
      'a lost cancellation claimed an outcome: ' + state.research.error.error);
    assert.strictEqual(state.research.error.reload, true, 'no way to find out what happened was offered');
  });

  await check('Cancel before a job id is reconciled, not abandoned', async () => {
    // The case that could pay twice: the start was sent, its answer never
    // arrived, and the key is the only handle on the operation.
    const { sandbox, state, calls } = page({
      functions: ['cancelResearch', 'requestCancel', 'endResearch', 'reconcileResearch', 'researchTerminal', 'applyTerminalResearch', 'adoptResearchJob', 'restoreResearchOutcome'],
      constants: ['RESEARCH_CANCEL_TIMEOUT_MS', 'RESEARCH_LOOKUP_TIMEOUT_MS'],
      respond: url => /research-jobs\?key=/.test(url)
        ? Promise.resolve({ job: null, matchedKey: false, current: null })
        : Promise.resolve({ job: { id: 'rj-1', state: 'cancelled' } })
    });
    const active = { jobId: null, searchId: state.search.id, orgId: state.org.id, key: 'rk-held', controller: new AbortController() };
    state.research.active = active;
    state.research.key = 'rk-held';
    await sandbox.cancelResearch(active);
    await settle();
    assert.strictEqual(calls.requests.length, 1, 'the key was abandoned without asking what became of it');
    assert.strictEqual(calls.requests[0].method, 'GET', 'reconciliation used a request that can create work');
    assert.match(calls.requests[0].url, /research-jobs\?key=rk-held$/);
    assert.match(calls.messages.join(' | '), /had not started/i,
      'the reconciled answer was not passed on: ' + calls.messages.join(' | '));
    assert.strictEqual(state.research.key, null, 'a reconciled key was still held');
  });

  await check('a key that names a running operation cancels that operation', async () => {
    const { sandbox, state, calls } = page({
      functions: ['cancelResearch', 'requestCancel', 'endResearch', 'reconcileResearch', 'researchTerminal', 'applyTerminalResearch', 'adoptResearchJob', 'restoreResearchOutcome'],
      constants: ['RESEARCH_CANCEL_TIMEOUT_MS', 'RESEARCH_LOOKUP_TIMEOUT_MS'],
      respond: url => /research-jobs\?key=/.test(url)
        ? Promise.resolve({ job: { id: 'rj-found', state: 'running', stage: 'researching' }, matchedKey: true })
        : Promise.resolve({ job: { id: 'rj-found', state: 'cancelled', reviewable: false } })
    });
    const active = { jobId: null, searchId: state.search.id, orgId: state.org.id, key: 'rk-held', controller: new AbortController() };
    state.research.active = active;
    state.research.key = 'rk-held';
    await sandbox.cancelResearch(active);
    await settle();
    const urls = calls.requests.map(r => r.method + ' ' + r.url);
    assert.strictEqual(calls.requests.length, 2, 'the operation the key named was left running: ' + urls.join(', '));
    assert.match(urls[1], /POST .*rj-found\/cancel/, 'the cancellation was not delivered to the operation that was found');
    assert.match(calls.messages.join(' | '), /cancelled\. Nothing was saved/i);
  });

  /* ---------------- D05: nothing waits forever ---------------- */

  await check('the start request and the facts save both carry deadlines', async () => {
    const { sandbox, state, calls } = page({
      functions: ['startResearch', 'endResearch', 'researchStatus', 'researchTerminal', 'researchProblem', 'researchUnsureStart', 'factsSaveProblem', 'factsSaveUnsure'],
      constants: ['RESEARCH_START_TIMEOUT_MS', 'RESEARCH_SAVE_TIMEOUT_MS']
    });
    void sandbox.startResearch({ city: 'Example City', website: 'https://example.gov', premium: false, patch: { client: 'Example City' } });
    await settle();
    assert.strictEqual(calls.requests.length, 1, 'the facts save was not sent first');
    assert.strictEqual(calls.requests[0].method, 'PATCH');
    assert.ok(calls.requests[0].timeoutMs > 0, 'the facts save can wait forever');
    assert.ok(state.research.key, 'no idempotency key was issued, so a retry cannot find the same operation');
  });

  await check('a start request that is never answered returns control and keeps the key', async () => {
    const { sandbox, state } = page({
      functions: ['startResearch', 'endResearch', 'researchStatus', 'researchTerminal', 'researchProblem', 'researchUnsureStart', 'factsSaveProblem', 'factsSaveUnsure'],
      constants: ['RESEARCH_START_TIMEOUT_MS', 'RESEARCH_SAVE_TIMEOUT_MS'],
      respond: () => Promise.reject(Object.assign(new Error('no answer'), { code: 'REQUEST_TIMEOUT', timedOut: true }))
    });
    await sandbox.startResearch({ city: 'Example City', website: 'https://example.gov', premium: false });
    assert.strictEqual(state.research.active, null, 'the progress dialog was left up with nothing to end it');
    assert.ok(state.research.error, 'a start that never answered said nothing');
    assert.strictEqual(state.research.error.retry, false,
      'a retry was offered for an operation that may already be running and billing');
    assert.strictEqual(state.research.error.reconcile, true, 'no way to find out what happened was offered');
    assert.ok(state.research.key, 'the key was dropped, so a retry would pay for the same work twice');
    assert.doesNotMatch(state.research.error.error, /[Nn]othing was saved/,
      'an unknown outcome was reported as nothing having happened');
  });

  await check('a facts save that is never answered does not claim research failed', async () => {
    const { sandbox, state } = page({
      functions: ['startResearch', 'endResearch', 'researchStatus', 'researchTerminal', 'researchProblem', 'researchUnsureStart', 'factsSaveProblem', 'factsSaveUnsure'],
      constants: ['RESEARCH_START_TIMEOUT_MS', 'RESEARCH_SAVE_TIMEOUT_MS'],
      respond: () => Promise.reject(Object.assign(new Error('no answer'), { code: 'REQUEST_TIMEOUT', timedOut: true }))
    });
    await sandbox.startResearch({ city: 'Example City', website: 'https://example.gov', premium: false, patch: { client: 'Example City' } });
    assert.ok(state.research.error);
    assert.match(state.research.error.error, /saving these facts/i,
      'a failed facts save was reported as a research failure: ' + state.research.error.error);
    assert.strictEqual(state.research.error.reload, true, 'no way to see what was saved was offered');
  });

  await check('typed values survive a failed attempt', async () => {
    const { sandbox, state } = page({
      functions: ['startResearch', 'endResearch', 'researchStatus', 'researchTerminal', 'researchProblem', 'researchUnsureStart', 'factsSaveProblem', 'factsSaveUnsure', 'researchDraftValue', 'dismissResearchNotice'],
      constants: ['RESEARCH_START_TIMEOUT_MS', 'RESEARCH_SAVE_TIMEOUT_MS'],
      respond: () => Promise.reject(Object.assign(new Error('nope'), { code: 'RESEARCH_FAILED' }))
    });
    await sandbox.startResearch({ city: 'Typed County', website: 'https://typed.gov', premium: false });
    assert.strictEqual(sandbox.researchDraftValue('city', state.search.client), 'Typed County',
      'the jurisdiction that was typed was replaced by the one on the file');
    assert.strictEqual(sandbox.researchDraftValue('website', state.search.website), 'https://typed.gov');
    sandbox.dismissResearchNotice();
    assert.strictEqual(sandbox.researchDraftValue('city', state.search.client), 'Example City',
      'the file stopped being the fallback once the attempt was dismissed');
  });

  await check('token acquisition is bounded, and its length is stated', async () => {
    const { sandbox } = page({ functions: ['authToken'], constants: ['TOKEN_TIMEOUT_MS'] });
    const asked = [];
    sandbox.window = { SlateAuth: { token: () => new Promise(() => {}) } };
    // Fires whatever it was given, and records what that was.
    sandbox.setTimeout = (fn, ms) => { asked.push(ms); fn(); return 1; };
    sandbox.clearTimeout = () => {};
    let code = null;
    try { await sandbox.authToken(); } catch (error) { code = error.code; }
    assert.strictEqual(code, 'AUTH_TIMEOUT',
      'a sign-in service that never answers leaves every request waiting behind it');
    assert.ok(asked[0] > 0 && asked[0] <= 30000, 'the token wait is bounded at ' + asked[0] + 'ms');
  });

  await check('a request deadline and a cancellation are told apart', async () => {
    const { sandbox } = page({ functions: ['requestDeadline'] });
    const fire = [];
    sandbox.setTimeout = (fn, ms) => { fire.push(fn); return fire.length; };
    sandbox.clearTimeout = () => {};

    // The caller stopped it: not a timeout.
    const mine = new AbortController();
    const one = sandbox.requestDeadline(mine.signal, 5000);
    mine.abort();
    assert.strictEqual(one.timedOut(), false, 'a cancellation was recorded as a timeout');
    assert.strictEqual(one.signal.aborted, true, 'a cancellation did not reach the request');

    // The deadline fired: not a cancellation.
    const two = sandbox.requestDeadline(new AbortController().signal, 5000);
    fire[fire.length - 1]();
    assert.strictEqual(two.timedOut(), true, 'a deadline that fired was not recorded');
    assert.strictEqual(two.signal.aborted, true);

    // No deadline asked for, none imposed.
    const three = sandbox.requestDeadline(null, 0);
    assert.strictEqual(three.timedOut(), false);
  });

  /* ---------------- D06: one availability decision ---------------- */

  await check('both screens ask one question about availability', () => {
    const { sandbox, state } = page({ functions: ['researchEligibility', 'researchAction'] });
    const ready = sandbox.researchEligibility();
    assert.strictEqual(ready.ok, true, 'research was refused on a search that is ready: ' + ready.why);
    const enabled = sandbox.researchAction('Research this city');
    assert.doesNotMatch(enabled, /disabled/, 'an available action was drawn disabled');

    // The profile is not adopted: refused, with the step named, on both screens.
    state.search.steps = [{ key: 'profile', status: 'todo' }];
    const blocked = sandbox.researchEligibility();
    assert.strictEqual(blocked.ok, false, 'research was offered before the profile was adopted');
    assert.match(blocked.why, /candidate profile/i);
    assert.strictEqual(blocked.go, 'profile', 'the refusal does not say where to go');
    const drawn = sandbox.researchAction('Research this city');
    assert.match(drawn, /disabled/, 'Search facts offered an action the handler would refuse');
    assert.ok(drawn.includes(blocked.why), 'the button and its explanation disagree');

    // No key configured.
    state.search.steps = [{ key: 'profile', status: 'done' }];
    state.health.hasKey = false;
    const noKey = sandbox.researchEligibility();
    assert.strictEqual(noKey.ok, false);
    assert.match(noKey.why, /by hand/i, 'a missing key did not say what to do instead');

    // A closed search takes no new writes, and a committee member never did.
    state.health.hasKey = true;
    sandbox.isFrozen = () => true;
    assert.strictEqual(sandbox.researchEligibility().ok, false, 'a closed search accepted new research');
    sandbox.isFrozen = () => false;
    sandbox.isCommittee = () => true;
    assert.strictEqual(sandbox.researchEligibility().ok, false, 'a committee member was offered research');
    sandbox.isCommittee = () => false;

    // An operation already running is not started again.
    state.research.active = { jobId: 'rj-1' };
    assert.strictEqual(sandbox.researchEligibility().ok, false, 'a second operation was offered on the same search');
  });

  /* ---------------- Isolation: nothing crosses searches ---------------- */

  await check('a late answer cannot repaint another search', async () => {
    const { sandbox, state, calls } = page({
      functions: ['requestCancel', 'endResearch', 'researchTerminal'],
      constants: ['RESEARCH_CANCEL_TIMEOUT_MS'],
      respond: () => Promise.resolve({ job: { id: 'rj-1', state: 'cancelled', reviewable: true, sources: [], missing: [] } })
    });
    // The consultant moved on while the cancellation was in flight.
    const answered = sandbox.requestCancel('sr-elsewhere', 'rj-1');
    state.search = { id: 'sr-different', steps: [] };
    await answered;
    assert.strictEqual(state.research.review, null,
      'findings from another search were painted onto the one now open');
    assert.strictEqual(calls.messages.length, 0, 'another search\'s outcome was announced here');
  });

  await check('reconciliation ignores an answer that arrives after a search change', async () => {
    let release = null;
    const { sandbox, state } = page({
      functions: ['reconcileResearch', 'requestCancel', 'endResearch', 'researchTerminal', 'applyTerminalResearch', 'adoptResearchJob', 'restoreResearchOutcome'],
      constants: ['RESEARCH_CANCEL_TIMEOUT_MS', 'RESEARCH_LOOKUP_TIMEOUT_MS'],
      respond: () => new Promise(resolve => { release = resolve; })
    });
    const answered = sandbox.reconcileResearch({ searchId: 'sr-synthetic', key: 'rk-1' });
    state.search = { id: 'sr-different', steps: [] };
    release({ job: { id: 'rj-1', state: 'failed', reviewable: false, failure: { code: 'RESEARCH_FAILED', error: 'no' } } });
    await answered;
    assert.strictEqual(state.research.error, null, 'a failure from another search was shown on this one');
  });

  console.log(passed + ' research interface checks passed' + (failed ? ', ' + failed + ' failed' : '') + '.');
  process.exitCode = failed ? 1 : 0;
})().catch(error => { console.error(error); process.exitCode = 1; });
