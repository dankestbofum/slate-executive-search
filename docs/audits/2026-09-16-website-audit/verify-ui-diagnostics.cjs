'use strict';

// Diagnostic reproduction only. Runs selected functions from public/app.js in
// isolated contexts. No browser, network, credentials, or application data.
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');

const root = path.resolve(__dirname, '../../..');
const source = fs.readFileSync(path.join(root, 'public/app.js'), 'utf8');
function extract(name) {
  const match = source.match(new RegExp('^(?:async )?function ' + name + '\\([^]*?^}', 'm'));
  assert.ok(match, 'Function missing: ' + name);
  return match[0];
}
function context(functions) {
  const observations = { messages: [], requests: [], timers: [] };
  const sandbox = {
    state: { search: { id: 'synthetic-search', steps: [] }, org: { id: 'synthetic-org' }, research: { token: 0, active: null, error: null, review: null, key: null } },
    RESEARCH_TERMINAL: new Set(['succeeded', 'partial', 'failed', 'cancelled', 'interrupted']),
    AbortController, Promise, Date, Math,
    $: () => null,
    clearTimeout: () => {},
    setTimeout: (fn, ms) => { observations.timers.push(ms); return 1; },
    toast: message => observations.messages.push(message),
    render: () => {}, hideWait: () => {}, researchWait: () => {},
    researchStale: () => false, pollResearch: () => {},
    api: (url, options) => { observations.requests.push({ url, signal: Boolean(options.signal) }); return new Promise(() => {}); }
  };
  vm.createContext(sandbox);
  vm.runInContext(functions.map(extract).join('\n'), sandbox);
  return { sandbox, observations };
}

(async () => {
  const results = [];
  for (const status of ['failed', 'interrupted']) {
    const { sandbox } = context(['adoptResearchJob']);
    sandbox.state.search.researchJob = { id: 'synthetic-job', state: status, reviewable: false, failure: { code: 'RESEARCH_TIMEOUT', error: 'Synthetic timeout' } };
    sandbox.adoptResearchJob();
    assert.equal(sandbox.state.research.error, null);
    results.push({ check: 'Restore ' + status + ' research on reopen', reproduced: true, actual: 'Stored failure and reference are not restored to the failure panel.' });
  }

  {
    const { sandbox, observations } = context(['endResearch', 'cancelResearch']);
    const active = { jobId: 'synthetic-job', searchId: sandbox.state.search.id, orgId: sandbox.state.org.id, controller: new AbortController() };
    sandbox.state.research.active = active;
    sandbox.state.research.key = 'original-key';
    void sandbox.cancelResearch(active); // Cancellation endpoint never acknowledges.
    assert.equal(observations.messages[0], 'Research cancelled. Nothing was saved.');
    assert.equal(observations.requests.length, 1);
    results.push({ check: 'Cancel with unacknowledged server request', reproduced: true, actual: observations.messages[0], cancellationConfirmedByServer: false });
  }

  {
    const { sandbox, observations } = context(['startResearch', 'endResearch', 'cancelResearch']);
    void sandbox.startResearch({ city: 'Synthetic City', website: 'https://example.gov', premium: false });
    const firstKey = sandbox.state.research.key;
    assert.ok(firstKey);
    assert.equal(observations.requests.length, 1);
    assert.equal(observations.timers.length, 0);
    assert.equal(sandbox.state.research.active.deadlineAt, null);
    results.push({ check: 'Initial research start request stalls', reproduced: true, actual: 'No automatic deadline is installed before the first response; only manual cancellation is available.', timersInstalled: 0, deadlineAt: null });
    await sandbox.cancelResearch(sandbox.state.research.active);
    assert.equal(sandbox.state.research.key, null);
    assert.equal(observations.requests.length, 1); // No job id: no cancellation request.
    void sandbox.startResearch({ city: 'Synthetic City', website: 'https://example.gov', premium: false });
    assert.notEqual(sandbox.state.research.key, firstKey);
    results.push({ check: 'Cancel before job acknowledgement then retry', reproduced: true, actual: 'The original idempotency key is discarded and the next start receives a new key; no server cancellation was sent.', consequence: 'If the original request reached the server, its outcome remains unknown. See server active-job deduplication before assessing duplicate-work risk.' });
  }

  const report = { capturedAt: new Date().toISOString(), runtime: process.version, source: 'public/app.js', sourceSha256: crypto.createHash('sha256').update(source).digest('hex'), scope: 'Isolated execution of actual source functions with synthetic state; not authenticated browser coverage.', results };
  fs.writeFileSync(path.join(__dirname, 'ui-diagnostic-evidence.json'), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report, null, 2));
})().catch(error => { console.error(error); process.exitCode = 1; });
