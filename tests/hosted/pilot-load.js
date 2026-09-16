'use strict';

// Opt-in hosted pilot measurement. This mutates only records whose client name
// contains the caller-supplied synthetic run id, and refuses to start without
// an explicit staging acknowledgement. It never runs in default CI.

const fs = require('fs');
const path = require('path');

const BASE = String(process.env.SLATE_HOSTED_URL || '').replace(/\/$/, '');
const CONFIRM = process.env.SLATE_HOSTED_CONFIRM;
const RUN_ID = String(process.env.SLATE_HOSTED_RUN_ID || '');
const TOKENS = String(process.env.SLATE_HOSTED_TOKENS || '').split(',').map(value => value.trim()).filter(Boolean);
const CANDIDATES = number('SLATE_HOSTED_CANDIDATES', 100, 1, 500);
const SESSIONS = number('SLATE_HOSTED_SESSIONS', 20, 1, 50);
const WARMUP_SECONDS = number('SLATE_HOSTED_WARMUP_SECONDS', 300, 0, 3600);
const LOAD_SECONDS = number('SLATE_HOSTED_LOAD_SECONDS', 900, 1, 7200);
const SOAK_SECONDS = number('SLATE_HOSTED_SOAK_SECONDS', 3600, 0, 14400);
const THINK_MIN_MS = number('SLATE_HOSTED_THINK_MIN_MS', 750, 50, 10000);
const THINK_MAX_MS = number('SLATE_HOSTED_THINK_MAX_MS', 2500, THINK_MIN_MS, 30000);
const TARGET_P95_MS = number('SLATE_HOSTED_TARGET_P95_MS', 1000, 1, 60000);
const CLEANUP = process.env.SLATE_HOSTED_CLEANUP === 'true';

function number(name, fallback, min, max) {
  const value = process.env[name] === undefined ? fallback : Number(process.env[name]);
  if (!Number.isFinite(value) || value < min || value > max) throw new Error(name + ' must be from ' + min + ' to ' + max + '.');
  return Math.floor(value);
}

function guard() {
  if (CONFIRM !== 'I_AM_USING_SYNTHETIC_STAGING') throw new Error('Set SLATE_HOSTED_CONFIRM=I_AM_USING_SYNTHETIC_STAGING.');
  if (!/^pilot-[a-z0-9-]{6,60}$/.test(RUN_ID)) throw new Error('SLATE_HOSTED_RUN_ID must look like pilot-20260916-abc123.');
  if (!BASE) throw new Error('Set SLATE_HOSTED_URL to the isolated staging deployment.');
  const url = new URL(BASE);
  if (url.protocol !== 'https:' && process.env.SLATE_HOSTED_ALLOW_HTTP !== 'true') throw new Error('Hosted runs require HTTPS.');
  if (!TOKENS.length) throw new Error('Set SLATE_HOSTED_TOKENS to one or more comma-separated Clerk session JWTs.');
  if (TOKENS.some(token => token.split('.').length !== 3)) throw new Error('Every SLATE_HOSTED_TOKENS entry must be a JWT.');
}

function percentile(values, p) {
  const sorted = [...values].sort((a, b) => a - b);
  if (!sorted.length) return 0;
  return sorted[Math.max(0, Math.min(sorted.length - 1, Math.ceil(sorted.length * p / 100) - 1))];
}

function summary(values) {
  return { n: values.length, p50: percentile(values, 50), p95: percentile(values, 95), p99: percentile(values, 99), max: Math.max(0, ...values) };
}

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const think = () => sleep(THINK_MIN_MS + Math.floor(Math.random() * (THINK_MAX_MS - THINK_MIN_MS + 1)));

async function request(token, method, route, body, extraHeaders = {}) {
  const started = performance.now();
  let response;
  try {
    response = await fetch(BASE + route, {
      method,
      headers: { authorization: 'Bearer ' + token, 'content-type': 'application/json', ...extraHeaders },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(30000)
    });
  } catch (error) {
    return { status: 0, ms: performance.now() - started, error: error.message, body: null };
  }
  const text = await response.text();
  let parsed = null;
  try { parsed = JSON.parse(text); } catch { /* reported below as response text */ }
  return { status: response.status, ms: performance.now() - started, body: parsed, text: text.slice(0, 300) };
}

async function createSearch(token, suffix) {
  const result = await request(token, 'POST', '/api/searches', {
    client: '[SYNTHETIC ' + RUN_ID + '] ' + suffix,
    position: 'County Manager', jurisdictionType: 'county', package: 'executive',
    state: 'Arizona', website: 'https://example.gov'
  });
  if (result.status !== 200) throw new Error('Could not create synthetic search: ' + result.status + ' ' + (result.body?.error || result.text));
  return result.body;
}

async function revision(token, id) {
  const result = await request(token, 'GET', '/api/searches/' + id);
  if (result.status !== 200) throw new Error('Could not read revision for ' + id + ': ' + result.status);
  return result.body.revision;
}

async function write(token, method, route, id, body) {
  return request(token, method, route, body, { 'if-match': String(await revision(token, id)) });
}

async function phase(name, seconds, searches, samples, failures) {
  if (!seconds) return;
  console.log(name + ': ' + seconds + 's with ' + SESSIONS + ' request loops');
  const until = Date.now() + seconds * 1000;
  await Promise.all(Array.from({ length: SESSIONS }, async (_, index) => {
    const token = TOKENS[index % TOKENS.length];
    const own = searches[index];
    let iteration = 0;
    while (Date.now() < until) {
      const read = await request(token, 'GET', iteration % 3 ? '/api/searches/' + own.id : '/api/searches');
      samples.read.push(read.ms);
      if (read.status !== 200) failures.push({ phase: name, kind: 'read', status: read.status, error: read.body?.error || read.error || read.text });

      // Each loop normally writes its own record. Every tenth pass, two loops
      // intentionally collide on search zero so expected 409s are measured.
      const target = iteration % 10 === 9 ? searches[0] : own;
      const rev = await revision(token, target.id).catch(error => { failures.push({ phase: name, kind: 'revision', status: 0, error: error.message }); return null; });
      if (rev !== null) {
        if (iteration % 10 === 9 && index % 2 === 1) await sleep(100);
        const saved = await request(token, 'PATCH', '/api/searches/' + target.id,
          { notes: 'Synthetic ' + RUN_ID + ' session ' + index + ' iteration ' + iteration },
          { 'if-match': String(rev) });
        samples.write.push(saved.ms);
        if (saved.status === 409) samples.conflicts += 1;
        else if (saved.status !== 200) failures.push({ phase: name, kind: 'write', status: saved.status, error: saved.body?.error || saved.error || saved.text });
      }
      iteration += 1;
      await think();
    }
  }));
}

(async () => {
  guard();
  const owner = TOKENS[0];
  const createdIds = [];
  const samples = { read: [], write: [], conflicts: 0 };
  const failures = [];
  const startedAt = new Date().toISOString();

  console.log('Hosted pilot load run ' + RUN_ID);
  console.log('Target: ' + new URL(BASE).origin + '; tokens: ' + TOKENS.length + '; sessions: ' + SESSIONS);
  console.log('All created client names begin with [SYNTHETIC ' + RUN_ID + '].');

  try {
    const healthBefore = await request(owner, 'GET', '/api/ready');
    if (healthBefore.status !== 200 || !healthBefore.body?.ready) throw new Error('Staging is not ready; refusing to mutate it.');

    const main = await createSearch(owner, 'Envelope County');
    createdIds.push(main.id);
    for (let index = 0; index < CANDIDATES; index += 1) {
      const added = await write(owner, 'POST', '/api/searches/' + main.id + '/candidates', main.id, {
        name: 'Synthetic Candidate ' + String(index + 1).padStart(3, '0'),
        email: 'synthetic-' + RUN_ID + '-' + index + '@example.test',
        cur: 'Assistant Manager', org: 'Example County'
      });
      if (added.status !== 200) throw new Error('Candidate fixture ' + index + ' failed: ' + added.status + ' ' + (added.body?.error || added.text));
    }

    const searches = [];
    for (let index = 0; index < SESSIONS; index += 1) {
      const search = await createSearch(owner, 'Session ' + String(index + 1).padStart(2, '0'));
      createdIds.push(search.id);
      searches.push(search);
    }

    await phase('warmup', WARMUP_SECONDS, searches, samples, failures);
    samples.read.length = 0; samples.write.length = 0; samples.conflicts = 0; failures.length = 0;
    await phase('load', LOAD_SECONDS, searches, samples, failures);
    await phase('soak', SOAK_SECONDS, searches, samples, failures);

    const healthAfter = await request(owner, 'GET', '/api/ready');
    const result = {
      runId: RUN_ID, target: new URL(BASE).origin, startedAt, finishedAt: new Date().toISOString(),
      configuration: { candidates: CANDIDATES, requestedSessions: SESSIONS, distinctTokens: TOKENS.length,
        warmupSeconds: WARMUP_SECONDS, loadSeconds: LOAD_SECONDS, soakSeconds: SOAK_SECONDS,
        thinkMinMs: THINK_MIN_MS, thinkMaxMs: THINK_MAX_MS, targetP95Ms: TARGET_P95_MS },
      latencyMs: { reads: summary(samples.read), writes: summary(samples.write) },
      expectedConflicts: samples.conflicts, unexpectedErrors: failures,
      readinessBefore: healthBefore.body, readinessAfter: healthAfter.body,
      createdSearchIds: createdIds, cleanupRequested: CLEANUP
    };

    if (CLEANUP) {
      const removed = await request(owner, 'POST', '/api/searches/bulk-delete', { ids: createdIds });
      result.cleanup = { status: removed.status, body: removed.body };
      if (removed.status !== 200 || removed.body?.deleted !== createdIds.length) failures.push({ phase: 'cleanup', status: removed.status, error: removed.body?.error || removed.text });
    }

    const output = process.env.SLATE_HOSTED_OUTPUT
      ? path.resolve(process.env.SLATE_HOSTED_OUTPUT)
      : path.resolve('test-results', 'hosted-' + RUN_ID + '.json');
    fs.mkdirSync(path.dirname(output), { recursive: true });
    fs.writeFileSync(output, JSON.stringify(result, null, 2));
    console.log(JSON.stringify({ output, latencyMs: result.latencyMs, expectedConflicts: result.expectedConflicts,
      unexpectedErrors: result.unexpectedErrors.length, storeBytes: result.readinessAfter?.metrics?.storeBytes }, null, 2));

    if (result.latencyMs.reads.p95 > TARGET_P95_MS || result.latencyMs.writes.p95 > TARGET_P95_MS || failures.length) process.exitCode = 1;
  } catch (error) {
    console.error(error.stack || error.message);
    console.error('Created synthetic search ids (for scoped cleanup): ' + createdIds.join(', '));
    process.exitCode = 1;
  }
})();
