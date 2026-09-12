'use strict';

// DEP-06 acceptance evidence: health, monitoring, and support operations.
//
// The acceptance criteria are operational: an alert can be triggered and
// cleared, an operator can find a request by its correlation id, and telemetry
// never carries what a candidate wrote.

const assert = require('assert');
const telemetry = require('../server/telemetry');
const identity = require('./identity');

const BASE = process.env.SLATE_URL || 'http://127.0.0.1:4173';
const auth = identity.signer().headers('abe@slate.local');
let passed = 0;
let failed = 0;

async function check(name, fn) {
  try { await fn(); passed += 1; console.log('PASS  Monitoring: ' + name); }
  catch (error) { failed += 1; console.error('FAIL  Monitoring: ' + name + '\n      ' + error.message); }
}

(async () => {

  /* ---------------- Liveness and readiness are different questions ---------------- */

  await check('liveness is cheap and says nothing about the volume', async () => {
    const res = await fetch(BASE + '/api/health');
    assert.strictEqual(res.status, 200);
    const body = await res.json();
    assert.strictEqual(body.ok, true);
    assert.ok(body.release);
    // If liveness reported storage or backups, a backup problem would restart
    // the container instead of paging someone.
    assert.strictEqual(body.recovery, undefined, 'liveness leaked recovery state');
    assert.strictEqual(body.metrics, undefined, 'liveness leaked metrics');
  });

  await check('readiness reports storage, schema, AI and recovery', async () => {
    const res = await fetch(BASE + '/api/ready');
    assert.strictEqual(res.status, 200, 'expected ready, got ' + res.status);
    const body = await res.json();
    assert.strictEqual(body.ready, true);
    assert.strictEqual(body.storage.writable, true);
    assert.ok(Number.isInteger(body.schemaVersion));
    assert.ok(body.recovery, 'no recovery block');
    assert.ok(body.metrics, 'no metrics block');
    assert.ok(body.alerts, 'no alert status');
  });

  await check('AI availability is reported separately from readiness', async () => {
    const body = await (await fetch(BASE + '/api/ready')).json();
    // The isolated suite runs with no API key, so this is the outage case: the
    // app must still be ready. Drafting is one feature, not the application.
    assert.strictEqual(body.ai.configured, false, 'the test server should have no API key');
    assert.strictEqual(body.ai.degraded, true);
    assert.strictEqual(body.ready, true, 'an AI outage was reported as the app being unready');
  });

  await check('core work stays usable without AI', async () => {
    const made = await fetch(BASE + '/api/searches', {
      method: 'POST', headers: { 'Content-Type': 'application/json', ...auth },
      body: JSON.stringify({ client: 'Monitoring County', position: 'County Administrator' })
    });
    assert.strictEqual(made.status, 200, 'a search could not be opened without an API key');
  });

  /* ---------------- Correlation ---------------- */

  await check('every response carries a correlation id an operator can search', async () => {
    const res = await fetch(BASE + '/api/health');
    const ref = res.headers.get('x-request-id');
    assert.match(ref || '', /^[a-f0-9]{16}$/, 'no usable correlation id');
  });

  await check('an error returns the same reference it logs', async () => {
    const res = await fetch(BASE + '/api/searches', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{ broken'
    });
    const header = res.headers.get('x-request-id');
    const body = await res.json();
    assert.ok(body.ref, 'the error gave the caller no reference to quote');
    assert.strictEqual(body.ref, header,
      'the reference in the body differs from the header, so a support request cannot be traced');
  });

  /* ---------------- Route naming and privacy ---------------- */

  await check('log route names carry no identifiers or tokens', () => {
    assert.strictEqual(telemetry.routeName('/api/apply/abc123def456'), '/api/apply/:token');
    assert.strictEqual(telemetry.routeName('/apply/abc123def456'), '/apply/:token');
    assert.strictEqual(telemetry.routeName('/api/searches/sr-9f2a1b/candidates'), '/api/searches/:search/candidates');
    assert.strictEqual(telemetry.routeName('/api/searches/sr-9f2a1b/members/u-77aa/pin'),
      '/api/searches/:search/members/:id/pin');
    assert.strictEqual(telemetry.routeName('/media/sr-9f2a1b/cover.jpg'), '/media/:id/cover.jpg');
  });

  await check('metrics are counts and sizes, never record contents', () => {
    const text = JSON.stringify(telemetry.metrics({ dataDir: null, searches: 3, archived: 1 }));
    assert.doesNotMatch(text, /County|Ruiz|@example|answer/i, 'record contents leaked into metrics');
    assert.match(text, /"uptimeSeconds"/);
    assert.match(text, /"eventLoopDelayMs"/);
  });

  await check('metrics cover the signals the runbook depends on', () => {
    const m = telemetry.metrics({ dataDir: null, storeSize: 1234, searches: 2, archived: 0 });
    for (const key of ['uptimeSeconds', 'requests', 'errorRate', 'slowRequests', 'eventLoopDelayMs',
      'memoryRssMb', 'storeBytes', 'searches', 'ai']) {
      assert.ok(key in m, 'metrics are missing ' + key);
    }
    for (const key of ['calls', 'failures', 'failureRate', 'averageLatencyMs', 'inputTokens', 'outputTokens']) {
      assert.ok(key in m.ai, 'AI metrics are missing ' + key);
    }
  });

  await check('AI outcomes are counted without prompts or output', () => {
    telemetry.reset();
    telemetry.recordAi({ ok: true, ms: 900, usage: { input_tokens: 100, output_tokens: 50 }, kind: 'profile' });
    telemetry.recordAi({ ok: false, ms: 300, kind: 'research', code: 'TIMEOUT' });
    const m = telemetry.metrics();
    assert.strictEqual(m.ai.calls, 2);
    assert.strictEqual(m.ai.failures, 1, 'a failed call was not counted; failures can still be billed');
    assert.strictEqual(m.ai.inputTokens, 100);
    assert.strictEqual(m.ai.averageLatencyMs, 600);
    telemetry.reset();
  });

  /* ---------------- Alerts ---------------- */

  await check('an alert can be raised and cleared, and does not repeat', async () => {
    telemetry.reset();
    const env = {}; // no destination configured

    assert.strictEqual(await telemetry.alert('test-condition', true, { why: 'drill' }, env), true,
      'raising an alert reported no state change');
    assert.deepStrictEqual(telemetry.alerts(env).firing, ['test-condition']);

    // Still true on the next check: an operator paged every minute stops reading pages.
    assert.strictEqual(await telemetry.alert('test-condition', true, { why: 'drill' }, env), false,
      'a persisting condition raised a second alert');

    assert.strictEqual(await telemetry.alert('test-condition', false, {}, env), true,
      'clearing an alert reported no state change');
    assert.deepStrictEqual(telemetry.alerts(env).firing, []);
    telemetry.reset();
  });

  await check('an unconfigured alert destination is reported, not silently ignored', () => {
    assert.strictEqual(telemetry.alerts({}).destination, 'NOT CONFIGURED');
    assert.strictEqual(telemetry.alerts({ SLATE_ALERT_WEBHOOK: 'https://example.invalid/hook' }).destination, 'webhook');
    assert.strictEqual(telemetry.alerts({ SLATE_ALERT_COMMAND: 'notify-send' }).destination, 'command');
  });

  await check('a failing alert destination does not take the app down', async () => {
    telemetry.reset();
    const env = { SLATE_ALERT_WEBHOOK: 'http://127.0.0.1:1/nowhere' };
    await telemetry.alert('unreachable-drill', true, {}, env);
    assert.ok(telemetry.alerts(env).lastError, 'a failed delivery was not recorded');
    telemetry.reset();
  });

  /* ---------------- Candidate support ---------------- */

  await check('a real candidate page carries a support and accommodation contact', async () => {
    const json = { 'Content-Type': 'application/json', ...auth };

    const search = await (await fetch(BASE + '/api/searches', {
      method: 'POST', headers: json,
      body: JSON.stringify({ client: 'Support County', position: 'County Administrator' })
    })).json();

    const revision = String((await (await fetch(BASE + '/api/searches/' + search.id, { headers: auth })).json()).revision);
    const withCandidate = await (await fetch(BASE + '/api/searches/' + search.id + '/candidates', {
      method: 'POST', headers: { ...json, 'if-match': revision },
      body: JSON.stringify({ name: 'Support Test Candidate' })
    })).json();

    const token = withCandidate.candidates[0].invite;
    assert.ok(token, 'no invitation token was issued');

    const page = await (await fetch(BASE + '/api/apply/' + token)).json();
    assert.ok(page.support, 'the candidate page has no support contact field at all');
    assert.ok('configured' in page.support, 'the page cannot tell whether support exists');
    // Unconfigured here, which is the point: the field is always present so the
    // page can say help is unavailable rather than silently omitting it.
    assert.strictEqual(page.support.configured, false);
  });

  console.log(passed + ' monitoring checks passed' + (failed ? ', ' + failed + ' failed' : '') + '.');
  process.exitCode = failed ? 1 : 0;
})().catch(error => { console.error(error); process.exitCode = 1; });
