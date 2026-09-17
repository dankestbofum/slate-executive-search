'use strict';

// Research reliability.
//
// The failure this suite exists for: research was reported as failing after
// about six minutes, which is a 180-second attempt plus one retry, and the
// application had no way to prove or disprove that because a timeout, a dropped
// socket and an invalid key all arrived as the same generic connection error.
//
// Everything here is offline and deterministic. The provider is a mock, the
// clock is injectable, and no billed call is made — so what is proved is the
// behaviour around the model: that the bound holds, that cancellation stops
// work, that failures are told apart, that incomplete findings are offered
// rather than discarded, and that a job survives a restart.
//
// What is not claimed: that a real research run succeeds, what it costs, or how
// long it takes. That is the hosted check the plan keeps separate.

const assert = require('assert');
const researchOp = require('../server/research-op');
const researchJobs = require('../server/research-jobs');
const site = require('../server/site');
const ai = require('../server/ai');
const identity = require('./identity');

const BASE = process.env.SLATE_URL || 'http://127.0.0.1:4173';
const JSON_HEADERS = { 'Content-Type': 'application/json' };
let passed = 0;
let failed = 0;

async function check(name, fn) {
  try { await fn(); passed += 1; console.log('PASS  Research: ' + name); }
  catch (error) { failed += 1; console.error('FAIL  Research: ' + name + '\n      ' + (error && error.stack || error)); }
}

// Nothing in this file has real I/O to keep the event loop alive, and the
// deadline timers are deliberately unref'd so a draining process is not held
// open by one. This is the stand-in for the provider socket that keeps the loop
// alive in production.
const keepAlive = setInterval(() => {}, 50);

/* ------------------------------------------------------------------ *
 * Provider mocks
 * ------------------------------------------------------------------ */

function message(overrides = {}) {
  return {
    stop_reason: 'end_turn',
    content: [],
    usage: { input_tokens: 100, output_tokens: 50 },
    ...overrides
  };
}

/** A provider that answers with whatever the script says, in order. */
function scripted(script) {
  let i = 0;
  const calls = [];
  return {
    calls,
    messages: {
      stream(request, opts) {
        const at = Math.min(i, script.length - 1);
        i += 1;
        calls.push({ request, opts });
        const step = script[at];
        return {
          abort() {},
          finalMessage: async () => {
            if (typeof step === 'function') return step(request, opts);
            if (step instanceof Error) throw step;
            return step;
          }
        };
      }
    }
  };
}

/** A provider that accepts the request and then never answers. */
function silent() {
  const calls = [];
  return {
    calls,
    messages: {
      stream(request, opts) {
        calls.push({ request, opts });
        return {
          abort() {},
          finalMessage: () => new Promise((_resolve, reject) => {
            if (opts.signal) {
              opts.signal.addEventListener('abort',
                () => reject(opts.signal.reason || new Error('aborted')), { once: true });
            }
          })
        };
      }
    }
  };
}

function submitCall(input) {
  return message({
    stop_reason: 'tool_use',
    content: [{ type: 'tool_use', id: 'tu-1', name: 'submit_research', input }]
  });
}

const FULL_FILE = {
  facts: {
    client: 'City of Example', state: 'AZ', fog: 'Council-manager',
    population: '41,000 (2020 Census)', budget: '$88M (FY2026)', salary: '', notes: 'Growing.'
  },
  community: { lede: 'A city in Arizona.', government: { form: 'Council-manager' }, community: { history: 'Founded 1901.' }, why: 'Real work.' },
  sources: [{ title: 'City site', url: 'https://example.gov/' }]
};

const THIN_FILE = {
  // Name, state and a write-up: enough to review. No published budget or
  // population, which is a real condition for small jurisdictions and used to
  // send the agent round the loop until the budget ran out.
  facts: { client: 'Town of Example', state: 'NM', fog: '', population: '', budget: '', salary: '', notes: '' },
  community: { lede: 'A small town in New Mexico.', government: {}, community: {}, why: '' },
  sources: []
};

const REQUEST = {
  model: 'claude-sonnet-5',
  max_tokens: 8000,
  messages: [{ role: 'user', content: 'Research this jurisdiction.' }],
  tools: [{ type: 'web_search_20260209', name: 'web_search', max_uses: 8 }]
};

function op(overrides = {}) {
  return researchOp.begin({
    limits: {
      totalMs: 2000, crawlMs: 300, roundMs: 400, maxRounds: 3,
      synthesisReserveMs: 300, retries: 0, ...overrides
    }
  });
}

(async () => {

  /* ---------------- Limits ---------------- */

  await check('research limits are configurable and validated', () => {
    const fallback = researchOp.limits({});
    assert.strictEqual(fallback.totalMs, 180000);
    assert.strictEqual(fallback.maxRounds, 4);
    assert.strictEqual(fallback.retries, 0,
      'automatic provider retries are on for research; one stalled attempt plus a retry is the six-minute failure');

    const configured = researchOp.limits({
      SLATE_RESEARCH_TIMEOUT_MS: '60000',
      SLATE_RESEARCH_CRAWL_TIMEOUT_MS: '9000',
      SLATE_RESEARCH_MAX_ROUNDS: '2'
    });
    assert.strictEqual(configured.totalMs, 60000, 'changing the timeout did not change the limit');
    assert.strictEqual(configured.crawlMs, 9000);
    assert.strictEqual(configured.maxRounds, 2);

    // A value one typo could use to remove the bound is clamped, not honoured.
    const silly = researchOp.limits({ SLATE_RESEARCH_TIMEOUT_MS: '1', SLATE_RESEARCH_MAX_ROUNDS: '9999' });
    assert.ok(silly.totalMs >= 15000, 'a one-millisecond total deadline was accepted');
    assert.ok(silly.maxRounds <= 8, 'an unbounded round count was accepted');

    // SLATE_AI_TIMEOUT_MS keeps its meaning as the per-call ceiling. The
    // offline reproduction in the plan set it to 25ms and watched research
    // ignore it; it must not be ignored.
    const ceiling = researchOp.limits({ SLATE_AI_TIMEOUT_MS: '25' });
    assert.strictEqual(ceiling.roundMs, 25, 'the per-call timeout is still being bypassed');
  });

  await check('no round may outlast the operation', () => {
    const o = researchOp.begin({ limits: { totalMs: 500, crawlMs: 100, roundMs: 5000, maxRounds: 4, synthesisReserveMs: 100, retries: 0 } });
    assert.ok(o.roundBudget() <= 500, 'a round was allowed more time than the whole operation');
    assert.ok(o.crawlBudget() <= 500);
    o.end();
  });

  await check('an await in the save phase is bounded by the operation', async () => {
    // The save phase is not a provider call: nothing in it carries the abort
    // signal, so before op.guard existed a directory that never answered held
    // the operation open past its own deadline (D02).
    const slow = op({ totalMs: 300 });
    const started = Date.now();
    let code = null;
    try { await slow.guard(new Promise(() => {}), 'the access check'); }
    catch (error) { code = error.code; }
    const ms = Date.now() - started;
    slow.end();
    assert.strictEqual(code, 'RESEARCH_TIMEOUT', 'an unbounded await reported ' + code);
    assert.ok(ms < 1500, 'the guard waited ' + ms + 'ms on an operation with 300ms left');

    // Cancellation reaches the waiter at once, and is reported as itself.
    const stopped = op({ totalMs: 60000 });
    setTimeout(() => stopped.cancel('user'), 20);
    let cancelled = null;
    try { await stopped.guard(new Promise(() => {})); }
    catch (error) { cancelled = error.code; }
    stopped.end();
    assert.strictEqual(cancelled, 'RESEARCH_CANCELLED',
      'a cancelled wait reported ' + cancelled + '; the consultant would be told the provider was slow');

    // An operation that is already over does not wait at all.
    const over = op({ totalMs: 60000 });
    over.cancel('user');
    await assert.rejects(() => over.guard(Promise.resolve('ignored')),
      'an operation that was already cancelled still waited on the save phase');
    over.end();

    // And work that finishes inside the bound is simply returned.
    const fine = op({ totalMs: 60000 });
    assert.strictEqual(await fine.guard(Promise.resolve('ok')), 'ok');
    fine.end();
  });

  /* ---------------- The deadline actually ends things ---------------- */

  await check('a provider that never answers is stopped by the shared deadline', async () => {
    const o = op({ totalMs: 900, roundMs: 250, maxRounds: 20 });
    const provider = silent();
    const started = Date.now();
    let code = null;
    try { await ai.runResearchAgent(provider, REQUEST, o); }
    catch (error) { code = error.code; }
    const ms = Date.now() - started;
    o.end();
    assert.ok(code === 'TIMEOUT' || code === 'RESEARCH_TIMEOUT', 'a stalled call reported ' + code);
    assert.ok(ms < 2000, 'it ran for ' + ms + 'ms, past the deadline it was given');
    assert.ok(provider.calls.length >= 1);
    assert.ok(provider.calls.every(c => c.opts.maxRetries === 0),
      'a research call was made with automatic retries enabled');
  });

  await check('a stalled round leaves the timer running through the stream, not just the headers', async () => {
    // finalMessage resolves only at the end of the stream, so a body that
    // stalls after headers is bounded the same way a silent request is.
    const o = op({ totalMs: 3000, roundMs: 200, maxRounds: 1 });
    const started = Date.now();
    let code = null;
    try { await ai.streamMessage(silent(), REQUEST, { timeoutMs: 200, signal: o.signal, maxRetries: 0 }); }
    catch (error) { code = error.code; }
    o.end();
    assert.strictEqual(code, 'TIMEOUT');
    assert.ok(Date.now() - started < 1500, 'the round timeout did not bound the stream');
  });

  await check('cancellation stops the work and is not reported as a provider fault', async () => {
    const o = op({ totalMs: 60000, roundMs: 30000, maxRounds: 4 });
    setTimeout(() => o.cancel('user'), 60);
    let code = null;
    try { await ai.runResearchAgent(silent(), REQUEST, o); }
    catch (error) { code = ai.normalizeClaudeError(error, o).code; }
    o.end();
    assert.strictEqual(code, 'RESEARCH_CANCELLED',
      'a cancelled operation reported ' + code + '; the consultant would be told the provider was slow');
  });

  await check('rounds are bounded, and shared with continuations', async () => {
    const o = op({ totalMs: 60000, roundMs: 5000, maxRounds: 3, synthesisReserveMs: 1 });
    const provider = scripted([message({ stop_reason: 'pause_turn', content: [{ type: 'text', text: 'searching' }] })]);
    const out = await ai.runResearchAgent(provider, REQUEST, o);
    o.end();
    assert.strictEqual(provider.calls.length, 3, 'pause_turn was continued ' + provider.calls.length + ' times');
    assert.strictEqual(out.exhausted, true);
    assert.strictEqual(out.submitted, null);
    assert.strictEqual(o.usage.input_tokens, 300, 'usage was not counted across every round');
  });

  /* ---------------- Usage survives failure ---------------- */

  await check('usage from successful rounds survives a later failure', async () => {
    const o = op({ totalMs: 60000, roundMs: 5000, maxRounds: 4, synthesisReserveMs: 1 });
    const boom = new Error('connection reset');
    boom.code = 'CONNECTION_ERROR';
    const provider = scripted([
      message({ stop_reason: 'pause_turn', content: [{ type: 'text', text: 'one' }] }),
      message({ stop_reason: 'pause_turn', content: [{ type: 'text', text: 'two' }] }),
      boom
    ]);
    let code = null;
    try { await ai.runResearchAgent(provider, REQUEST, o); }
    catch (error) { code = error.code; }
    assert.strictEqual(code, 'CONNECTION_ERROR');
    assert.strictEqual(o.usage.input_tokens, 200, 'earlier rounds stopped being counted once one failed');
    assert.strictEqual(o.usageKnown, true);
    assert.strictEqual(o.attempts.length, 3, 'the failing attempt was not recorded');
    assert.strictEqual(o.attempts[2].ok, false);
    o.end();
  });

  await check('an attempt that reports no usage is marked unknown, not free', () => {
    const o = op();
    o.addUsage(null);
    assert.strictEqual(o.usageKnown, false);
    assert.strictEqual(o.unknownUsageAttempts, 1);
    o.end();
  });

  /* ---------------- Error classification ---------------- */

  await check('a timeout is classified before a generic connection error', () => {
    const Anthropic = require('@anthropic-ai/sdk');
    // APIConnectionTimeoutError extends APIConnectionError. Testing the base
    // class first is what made every research timeout read as CONNECTION_ERROR.
    const timeout = new Anthropic.APIConnectionTimeoutError({ message: 'Request timed out.' });
    assert.strictEqual(ai.normalizeClaudeError(timeout).code, 'TIMEOUT');
    const dropped = new Anthropic.APIConnectionError({ message: 'socket hang up' });
    assert.strictEqual(ai.normalizeClaudeError(dropped).code, 'CONNECTION_ERROR');
  });

  await check('authentication, rate limits and refusals are told apart', () => {
    const Anthropic = require('@anthropic-ai/sdk');
    const headers = new Headers({ 'request-id': 'req_abc123' });
    const make = (Kind, status, message) => new Kind(status, { error: { message } }, message, headers);

    const auth = make(Anthropic.AuthenticationError, 401, 'invalid x-api-key');
    assert.strictEqual(ai.normalizeClaudeError(auth).code, 'AUTH_ERROR');
    assert.strictEqual(auth.requestId, 'req_abc123',
      'the provider request id was not captured, so an upstream failure cannot be correlated with Anthropic logs');
    assert.strictEqual(ai.normalizeClaudeError(make(Anthropic.RateLimitError, 429, 'slow down')).code, 'RATE_LIMIT');
    assert.strictEqual(ai.normalizeClaudeError(make(Anthropic.NotFoundError, 404, 'model not found')).code, 'MODEL_UNAVAILABLE');
    assert.strictEqual(ai.normalizeClaudeError(make(Anthropic.BadRequestError, 400, 'bad')).code, 'BAD_REQUEST');
    assert.strictEqual(ai.normalizeClaudeError(make(Anthropic.InternalServerError, 500, 'oops')).code, 'PROVIDER_ERROR');
  });

  await check('the fallback is not started by any error that mentions the word tool', () => {
    // This was `/web_search|web_fetch|tool/i.test(err.message)`, so a rate
    // limit that happened to name a tool threw away the first loop's progress
    // and started a second one.
    const rate = { code: 'RATE_LIMIT', message: 'rate limit exceeded for tool use' };
    assert.strictEqual(ai.toolUnavailableError(rate), false, 'a rate limit would start a second research loop');
    const provider = { code: 'PROVIDER_ERROR', message: 'internal error in tool execution' };
    assert.strictEqual(ai.toolUnavailableError(provider), false);

    const unentitled = { code: 'BAD_REQUEST', message: 'The tool web_search is not supported for this account.' };
    assert.strictEqual(ai.toolUnavailableError(unentitled), true, 'a genuinely unavailable tool was not recognised');
  });

  await check('tool errors inside a successful response are recognised', () => {
    // A perfectly successful HTTP 200 whose tool calls all failed. The old
    // message test could not see this at all.
    const allFailed = message({
      content: [{
        type: 'web_search_tool_result',
        content: [{ type: 'web_search_tool_result_error', error_code: 'unavailable' }]
      }]
    });
    assert.strictEqual(ai.toolUnavailableResponse(allFailed), true);

    // One failed search among working ones is ordinary, and must not throw the
    // web tools away.
    const mixed = message({
      content: [
        { type: 'web_search_tool_result', content: [{ type: 'web_search_tool_result_error', error_code: 'unavailable' }] },
        { type: 'web_search_tool_result', content: [{ type: 'web_search_result', url: 'https://example.gov/' }] }
      ]
    });
    assert.strictEqual(ai.toolUnavailableResponse(mixed), false);

    // A tool error that is not unavailability is not unavailability.
    const query = message({
      content: [{ type: 'web_search_tool_result', content: [{ type: 'web_search_tool_result_error', error_code: 'max_uses_exceeded' }] }]
    });
    assert.strictEqual(ai.toolUnavailableResponse(query), false);
  });

  /* ---------------- Completeness without an endless loop ---------------- */

  await check('unpublished figures can stand as unknown after the first ask', () => {
    const first = ai.researchGaps(ai.normalizeResearch(THIN_FILE), 1);
    assert.ok(first.some(m => /budget/.test(m)), 'the first submission was not asked for a budget');
    const second = ai.researchGaps(ai.normalizeResearch(THIN_FILE), 2);
    assert.deepStrictEqual(second, [],
      'a jurisdiction that publishes no budget, population or government form would be asked forever');
  });

  await check('a file with no name, state or write-up is a failure, not a partial', () => {
    assert.deepStrictEqual(ai.researchShortfall(ai.normalizeResearch(FULL_FILE)), []);
    assert.deepStrictEqual(ai.researchShortfall(ai.normalizeResearch(THIN_FILE)), []);
    const empty = ai.normalizeResearch({ facts: {}, community: {} });
    assert.strictEqual(ai.researchShortfall(empty).length, 3);
  });

  await check('a complete submission is accepted and recorded, not announced as saved', async () => {
    const o = op({ totalMs: 60000, roundMs: 5000, maxRounds: 4, synthesisReserveMs: 1 });
    const provider = scripted([submitCall(FULL_FILE)]);
    const out = await ai.runResearchAgent(provider, REQUEST, o);
    o.end();
    assert.ok(out.submitted, 'a complete submission was refused');
    assert.strictEqual(out.partial, null);
    assert.strictEqual(out.submitted.facts.client, 'City of Example');
  });

  await check('supported but incomplete findings come back as a partial, not as nothing', async () => {
    const o = op({ totalMs: 60000, roundMs: 5000, maxRounds: 2, synthesisReserveMs: 1 });
    // Submits the same thin file every round. It can never satisfy the full
    // checklist, so the rounds run out.
    const provider = scripted([submitCall(THIN_FILE)]);
    const out = await ai.runResearchAgent(provider, REQUEST, o);
    o.end();
    assert.strictEqual(out.submitted, null, 'an incomplete file was accepted as complete');
    assert.ok(out.partial, 'usable findings were discarded rather than offered for review');
    assert.strictEqual(out.partial.facts.client, 'Town of Example');
    assert.ok(out.warnings.some(w => /budget/.test(w)), 'the gaps were not named');
  });

  await check('a refusal and a truncated answer each get an explicit outcome', async () => {
    const refusing = op({ totalMs: 60000, roundMs: 5000, maxRounds: 4 });
    const one = await ai.runResearchAgent(scripted([message({ stop_reason: 'refusal' })]), REQUEST, refusing);
    refusing.end();
    assert.ok(one.refusal, 'a refusal was retried instead of reported');
    assert.strictEqual(one.submitted, null);

    const cut = op({ totalMs: 60000, roundMs: 5000, maxRounds: 4 });
    const two = await ai.runResearchAgent(
      scripted([message({ stop_reason: 'max_tokens', content: [{ type: 'text', text: '{"facts":{' }] })]), REQUEST, cut);
    cut.end();
    assert.ok(two.refusal, 'a truncated response had no explicit outcome');
  });

  await check('malformed JSON is asked again rather than crashing the run', async () => {
    const o = op({ totalMs: 60000, roundMs: 5000, maxRounds: 2, synthesisReserveMs: 1 });
    const provider = scripted([message({ content: [{ type: 'text', text: 'not json at all' }] })]);
    const out = await ai.runResearchAgent(provider, REQUEST, o);
    o.end();
    assert.strictEqual(out.submitted, null);
    assert.strictEqual(out.exhausted, true);
    assert.strictEqual(provider.calls.length, 2);
  });

  await check('near the deadline the agent is told to write up rather than keep searching', async () => {
    // Reserve is the whole budget, so synthesis is requested immediately.
    const o = op({ totalMs: 60000, roundMs: 5000, maxRounds: 2, synthesisReserveMs: 60000 });
    const provider = scripted([
      message({ stop_reason: 'pause_turn', content: [{ type: 'text', text: 'searching' }] }),
      submitCall(FULL_FILE)
    ]);
    await ai.runResearchAgent(provider, REQUEST, o);
    o.end();
    const sent = JSON.stringify(provider.calls[provider.calls.length - 1].request.messages);
    assert.match(sent, /Stop searching/, 'the agent was cut off mid-search instead of being asked to submit');
    // The tools stay defined: removing one from a conversation that referenced
    // it is how a continuation breaks.
    assert.ok(provider.calls.every(c => (c.request.tools || []).length), 'a tool was removed mid-conversation');
  });

  /* ---------------- The crawler ---------------- */

  await check('private and non-public addresses are still refused', () => {
    for (const bad of ['http://169.254.169.254/latest/meta-data/', 'http://127.0.0.1/', 'http://10.0.0.5/',
      'http://localhost/', 'https://foo.internal/', 'javascript:alert(1)', 'file:///etc/passwd']) {
      assert.throws(() => site.publicUrl(bad), error => error.code === 'BAD_URL', bad + ' was accepted');
    }
  });

  await check('a DNS wait has a deadline, and an abandoned lookup is discarded', async () => {
    let code = null;
    try { await site.resolvePublic('no-such-host.invalid.example', { timeoutMs: 1 }); }
    catch (error) { code = error.code; }
    // Either the deadline fired or the resolver failed outright; both are
    // bounded answers. What must not happen is waiting on the OS resolver.
    assert.ok(code === 'DNS_TIMEOUT' || typeof code === 'string', 'the lookup did not end with a code');

    const controller = new AbortController();
    controller.abort();
    await assert.rejects(() => site.resolvePublic('example.com', { signal: controller.signal }),
      'an already-cancelled operation still started a lookup');
  });

  await check('the crawl is bounded by the operation, and cancellation is not swallowed', async () => {
    const o = op({ totalMs: 300, crawlMs: 200 });
    const started = Date.now();
    let outcome = null;
    try { outcome = await site.fetchCitySite('https://example.com', 'municipality', o); }
    catch (error) { outcome = error; }
    o.end();
    assert.ok(Date.now() - started < 3000, 'the crawl outlasted its budget');
    if (outcome instanceof Error) {
      assert.ok(['BAD_URL', 'DNS_TIMEOUT', 'RESEARCH_TIMEOUT', 'RESEARCH_CANCELLED', 'ENOTFOUND', 'EAI_AGAIN'].includes(outcome.code),
        'the crawl failed with an unclassified error: ' + outcome.code);
    } else {
      assert.ok(Array.isArray(outcome.pages), 'a truncated crawl returned no page list');
    }
  });

  await check('the crawler still swallows one unreadable page', () => {
    // The distinction the broad catch has to preserve: an unreachable page is
    // ordinary, the operation ending is not.
    assert.strictEqual(site.operationEnded({ code: 'RESEARCH_TIMEOUT' }), true);
    assert.strictEqual(site.operationEnded({ code: 'RESEARCH_CANCELLED' }), true);
    assert.strictEqual(site.operationEnded({ code: 'ENOTFOUND' }), false);
    assert.strictEqual(site.operationEnded(null), false);
  });

  await check('attempts are bounded, not only successes', () => {
    assert.ok(site.ATTEMPT_LIMIT >= site.PAGE_LIMIT,
      'the attempt cap is below the page cap, so no page could ever be read');
    assert.ok(site.ATTEMPT_LIMIT <= 32, 'the attempt cap is high enough to be no cap at all');
  });

  /* ------------------------------------------------------------------ *
   * The job lifecycle
   *
   * Driven against a fake store so restart recovery, the queue and the
   * conflict paths can be exercised without a server.
   * ------------------------------------------------------------------ */

  function harness({ research, concurrent = 1, limits = null } = {}) {
    const store = { researchJobs: [] };
    const persists = { n: 0, fail: false };
    const applied = [];
    const db = {
      db: store,
      persist(){ persists.n += 1; if (persists.fail) throw new Error('disk full'); }
    };
    let inFlight = 0;
    const aibudget = {
      check: () => inFlight >= concurrent ? { ok: false, code: 'AI_BUSY', error: 'busy' } : { ok: true },
      begin(){ inFlight += 1; },
      record(){ inFlight = Math.max(0, inFlight - 1); },
      limits: () => ({ concurrent })
    };
    const telemetry = { log: { info(){}, warn(){}, error(){} }, recordAi(){} };
    let authorize = job => ({ ok: true, search: { id: job.searchId, revision: job.revisionAtStart }, user: { id: 'u1' } });
    const manager = researchJobs.create({
      db, ai, telemetry, aibudget,
      apply: (search, user, payload) => { applied.push(payload); return { held: [] }; },
      authorize: job => authorize(job),
      research: research || (async () => ({ model: 'claude-sonnet-5', json: FULL_FILE, sources: [], usage: { input_tokens: 1, output_tokens: 1 }, partial: false, warnings: [] })),
      limits: { totalMs: 5000, crawlMs: 300, roundMs: 400, maxRounds: 3, synthesisReserveMs: 100, retries: 0, ...(limits || {}) }
    });
    return {
      manager, store, applied, persists,
      setAuthorize(fn){ authorize = fn; },
      search: (id = 'sr-1', revision = 3) => ({ id, revision, organizationId: 'org-1' }),
      access: { clerkUserId: 'user_1', orgId: 'org-1' },
      user: { id: 'u1', name: 'Abe' }
    };
  }

  const settle = () => new Promise(resolve => setTimeout(resolve, 30));

  await check('a job is recorded before it is answered, and returns a status handle', async () => {
    const h = harness();
    const out = h.manager.start({ search: h.search(), access: h.access, user: h.user, input: { city: 'Example', website: 'https://example.gov' } });
    assert.ok(out.job, out.error);
    assert.ok(h.store.researchJobs.length === 1, 'the job was not persisted before the caller was answered');
    assert.ok(h.persists.n >= 1, 'a job was accepted without being written down');
    assert.ok(out.job.deadlineAt, 'the job carries no deadline');
    await settle();
    assert.strictEqual(h.manager.find(out.job.id).state, 'succeeded');
    assert.strictEqual(h.applied.length, 1, 'a succeeded job did not write its result');
  });

  await check('the same idempotency key creates one operation, not two', async () => {
    const h = harness();
    const first = h.manager.start({ search: h.search(), access: h.access, user: h.user, input: { city: 'Example', website: 'https://example.gov' }, idempotencyKey: 'k-1' });
    await settle();
    const second = h.manager.start({ search: h.search(), access: h.access, user: h.user, input: { city: 'Example', website: 'https://example.gov' }, idempotencyKey: 'k-1' });
    assert.strictEqual(second.job.id, first.job.id, 'a refresh started a second paid run');
    assert.strictEqual(second.reused, true);
    assert.strictEqual(h.store.researchJobs.length, 1);
  });

  await check('one active job per search, whatever the key', () => {
    const h = harness({ research: () => new Promise(() => {}) });
    const first = h.manager.start({ search: h.search(), access: h.access, user: h.user, input: { city: 'A', website: 'https://a.gov' } });
    const second = h.manager.start({ search: h.search(), access: h.access, user: h.user, input: { city: 'A', website: 'https://a.gov' } });
    assert.strictEqual(second.job.id, first.job.id, 'a double click started a second operation');
    assert.strictEqual(second.reused, true);
    h.manager.stop();
  });

  await check('a second search waits for capacity rather than being dropped or run anyway', async () => {
    const h = harness({ research: () => new Promise(() => {}), concurrent: 1 });
    h.manager.start({ search: h.search('sr-a'), access: h.access, user: h.user, input: { city: 'A', website: 'https://a.gov' } });
    const second = h.manager.start({ search: h.search('sr-b'), access: h.access, user: h.user, input: { city: 'B', website: 'https://b.gov' } });
    await settle();
    assert.strictEqual(h.manager.find(second.job.id).state, 'queued', 'concurrency was exceeded');
    assert.strictEqual(h.manager.counts().running, 1);
    h.manager.stop();
  });

  await check('an over-full queue is refused before it is accepted', () => {
    const h = harness({ research: () => new Promise(() => {}), concurrent: 1 });
    for (let i = 0; i < researchJobs.MAX_QUEUED + 2; i += 1) {
      h.manager.start({ search: h.search('sr-' + i), access: h.access, user: h.user, input: { city: 'C', website: 'https://c.gov' } });
    }
    const over = h.manager.start({ search: h.search('sr-last'), access: h.access, user: h.user, input: { city: 'C', website: 'https://c.gov' } });
    assert.strictEqual(over.code, 'RESEARCH_QUEUE_FULL', 'the queue grew without bound');
    assert.strictEqual(over.status, 429);
    h.manager.stop();
  });

  await check('cancelling stops the work and prevents a later commit', async () => {
    let seen = null;
    const h = harness({
      research: (input, operation) => new Promise((_resolve, reject) => {
        seen = operation;
        operation.signal.addEventListener('abort', () => reject(operation.signal.reason), { once: true });
      })
    });
    const out = h.manager.start({ search: h.search(), access: h.access, user: h.user, input: { city: 'Example', website: 'https://example.gov' } });
    await settle();
    h.manager.cancel(h.manager.find(out.job.id), h.user);
    assert.ok(seen && seen.signal.aborted, 'cancelling did not abort the running operation');
    await settle();
    assert.strictEqual(h.manager.find(out.job.id).state, 'cancelled');
    assert.strictEqual(h.applied.length, 0, 'a cancelled job still wrote to the search file');
    // Idempotent.
    assert.strictEqual(h.manager.cancel(h.manager.find(out.job.id), h.user).job.state, 'cancelled');
  });

  await check('a result that arrives after cancellation is not written', async () => {
    let release = null;
    const h = harness({ research: () => new Promise(resolve => { release = resolve; }) });
    const out = h.manager.start({ search: h.search(), access: h.access, user: h.user, input: { city: 'Example', website: 'https://example.gov' } });
    await settle();
    h.manager.cancel(h.manager.find(out.job.id), h.user);
    release({ model: 'claude-sonnet-5', json: FULL_FILE, sources: [], usage: { input_tokens: 1, output_tokens: 1 }, partial: false, warnings: [] });
    await settle();
    assert.strictEqual(h.applied.length, 0, 'a late result landed on the file after cancellation');
    assert.strictEqual(h.manager.find(out.job.id).state, 'cancelled');
    // The findings are still there to review rather than silently dropped.
    assert.ok(h.manager.find(out.job.id).result, 'paid findings were discarded with no record');
  });

  await check('cancelling during the access check writes nothing', async () => {
    // The reproduction in docs/audits/2026-09-16-website-audit: the job checked
    // cancellation, then awaited the access check, and the write on the far
    // side of that await was never checked again. The real manager acknowledged
    // "cancelled" and then recorded "succeeded" over it.
    let release = null;
    const h = harness();
    h.setAuthorize(() => new Promise(resolve => {
      release = () => resolve({ ok: true, search: h.search(), user: h.user });
    }));
    const out = h.manager.start({ search: h.search(), access: h.access, user: h.user, input: { city: 'Example', website: 'https://example.gov' } });
    await settle();
    const job = h.manager.find(out.job.id);
    assert.strictEqual(job.stage, 'saving', 'the job never reached the access check (stage ' + job.stage + ')');
    const acknowledged = h.manager.cancel(job, h.user).job.state;
    assert.strictEqual(acknowledged, 'cancelled');
    if (release) release();
    await settle();
    assert.strictEqual(h.applied.length, 0, 'a cancelled job wrote to the search file from the far side of the access check');
    assert.strictEqual(h.manager.find(out.job.id).state, 'cancelled',
      'the acknowledged cancellation was overwritten by the run that followed it');
    // The findings are still there to review: they were paid for either way.
    assert.ok(h.manager.find(out.job.id).result, 'paid findings were discarded with no record');
  });

  await check('an operation that expires during the access check writes nothing', async () => {
    const h = harness({ limits: { totalMs: 1400 } });
    // Slower than the whole operation, on purpose.
    h.setAuthorize(() => new Promise(resolve => {
      setTimeout(() => resolve({ ok: true, search: h.search(), user: h.user }), 4000);
    }));
    const started = Date.now();
    const out = h.manager.start({ search: h.search(), access: h.access, user: h.user, input: { city: 'Example', website: 'https://example.gov' } });
    for (let i = 0; i < 60 && !researchJobs.TERMINAL.has(h.manager.find(out.job.id).state); i += 1) {
      await new Promise(r => setTimeout(r, 50));
    }
    const ms = Date.now() - started;
    const job = h.manager.find(out.job.id);
    assert.ok(researchJobs.TERMINAL.has(job.state), 'the job never ended: ' + job.state);
    assert.ok(ms < 3500, 'the job ran ' + ms + 'ms, past a 1400ms deadline, waiting on the access check');
    assert.strictEqual(h.applied.length, 0, 'an expired job wrote to the search file');
    assert.strictEqual(job.state, 'failed');
    assert.strictEqual(job.failure.code, 'RESEARCH_TIMEOUT');
    assert.ok(job.result, 'the paid findings were discarded');
    h.manager.stop();
  });

  await check('a search edited while the access check was in flight is not overwritten', async () => {
    // The revision moves during the await. The verdict was read before the
    // edit; the check that decides the write is re-run after it.
    const h = harness();
    let revision = 3;
    h.setAuthorize(async () => {
      const search = h.search('sr-1', revision);
      revision = 4;
      return {
        ok: true, search, user: h.user,
        recheck: () => revision === 3
          ? { ok: true, search, user: h.user }
          : { ok: false, code: 'STALE_SEARCH', error: 'This search changed while research was running.' }
      };
    });
    const out = h.manager.start({ search: h.search(), access: h.access, user: h.user, input: { city: 'Example', website: 'https://example.gov' } });
    await settle();
    const job = h.manager.find(out.job.id);
    assert.strictEqual(h.applied.length, 0, 'the write landed on a search that had moved under it');
    assert.strictEqual(job.state, 'failed');
    assert.strictEqual(job.failure.code, 'STALE_SEARCH');
    assert.ok(h.manager.publicJob(job).reviewable, 'the paid findings were thrown away');
  });

  await check('a state recorded from outside the run is not overwritten by it', async () => {
    // A restart sweep marks a running job interrupted. The run then concludes
    // whatever it was going to conclude, and must not rewrite the record.
    let release = null;
    const h = harness({ research: () => new Promise(resolve => { release = resolve; }) });
    const out = h.manager.start({ search: h.search(), access: h.access, user: h.user, input: { city: 'Example', website: 'https://example.gov' } });
    await settle();
    h.manager.recover();
    const job = h.manager.find(out.job.id);
    assert.strictEqual(job.state, 'interrupted');
    release({ model: 'claude-sonnet-5', json: FULL_FILE, sources: [], usage: { input_tokens: 1, output_tokens: 1 }, partial: false, warnings: [] });
    await settle();
    const after = h.manager.find(out.job.id);
    assert.strictEqual(after.state, 'interrupted', 'the run overwrote a terminal state with ' + after.state);
    assert.strictEqual(after.failure.code, 'RESEARCH_INTERRUPTED');
    assert.strictEqual(h.applied.length, 0, 'an interrupted job wrote to the search file');
    // The findings still arrived, and are kept for review rather than lost.
    assert.ok(after.result, 'findings that arrived after the sweep were discarded');
    h.manager.stop();
  });

  await check('an idempotency key can be reconciled without starting anything', async () => {
    // What a browser holding a key and no job id needs: a read. Retrying the
    // start to find out would risk paying for the work twice (D03).
    const h = harness({ research: () => new Promise(() => {}) });
    assert.strictEqual(h.manager.findByKey('sr-1', 'u1', 'rk-9'), null);
    assert.strictEqual(h.store.researchJobs.length, 0, 'a lookup created an operation');
    const out = h.manager.start({
      search: h.search(), access: h.access, user: h.user,
      input: { city: 'Example', website: 'https://example.gov' }, idempotencyKey: 'rk-9'
    });
    await settle();
    assert.strictEqual(h.manager.findByKey('sr-1', 'u1', 'rk-9').id, out.job.id);
    // A key is scoped to one person and one search, like the operation it names.
    assert.strictEqual(h.manager.findByKey('sr-1', 'u-other', 'rk-9'), null);
    assert.strictEqual(h.manager.findByKey('sr-other', 'u1', 'rk-9'), null);
    assert.strictEqual(h.manager.findByKey('sr-1', 'u1', ''), null);
    assert.strictEqual(h.store.researchJobs.length, 1, 'reconciliation created a second operation');
    h.manager.stop();
  });

  await check('cancelling something already saved reports the completed outcome', async () => {
    const h = harness();
    const out = h.manager.start({ search: h.search(), access: h.access, user: h.user, input: { city: 'Example', website: 'https://example.gov' } });
    await settle();
    const verdict = h.manager.cancel(h.manager.find(out.job.id), h.user);
    assert.strictEqual(verdict.alreadyDone, true, 'a completed job was reported as cancelled');
    assert.strictEqual(h.manager.find(out.job.id).state, 'succeeded');
  });

  await check('a concurrent edit keeps the newer work and offers the findings for review', async () => {
    const h = harness();
    h.setAuthorize(() => ({ ok: false, code: 'STALE_SEARCH', error: 'This search changed while research was running.' }));
    const out = h.manager.start({ search: h.search(), access: h.access, user: h.user, input: { city: 'Example', website: 'https://example.gov' } });
    await settle();
    const job = h.manager.find(out.job.id);
    assert.strictEqual(job.state, 'failed');
    assert.strictEqual(job.failure.code, 'STALE_SEARCH', 'a stale-search conflict was not given its own code');
    assert.strictEqual(h.applied.length, 0, 'the conflict overwrote newer work');
    assert.ok(h.manager.publicJob(job).reviewable, 'the paid findings were thrown away');
  });

  await check('losing authority stops the write, and says so without guessing', async () => {
    const h = harness();
    h.setAuthorize(() => ({ ok: false, code: 'RESEARCH_UNAUTHORIZED', error: 'Your access changed.' }));
    const out = h.manager.start({ search: h.search(), access: h.access, user: h.user, input: { city: 'Example', website: 'https://example.gov' } });
    await settle();
    assert.strictEqual(h.manager.find(out.job.id).failure.code, 'RESEARCH_UNAUTHORIZED');
    assert.strictEqual(h.applied.length, 0);
  });

  await check('a directory outage does not become a write into an unconfirmed workspace', async () => {
    const h = harness();
    h.setAuthorize(() => { throw new Error('directory unavailable'); });
    const out = h.manager.start({ search: h.search(), access: h.access, user: h.user, input: { city: 'Example', website: 'https://example.gov' } });
    await settle();
    assert.strictEqual(h.manager.find(out.job.id).failure.code, 'RESEARCH_UNVERIFIED');
    assert.strictEqual(h.applied.length, 0);
  });

  await check('a partial result is held for review and applied only when asked', async () => {
    const h = harness({
      research: async () => ({
        model: 'claude-sonnet-5', json: THIN_FILE, sources: [{ title: 'Town', url: 'https://town.gov/' }],
        usage: { input_tokens: 5, output_tokens: 5 }, partial: true, warnings: ['operating or general-fund budget']
      })
    });
    const out = h.manager.start({ search: h.search(), access: h.access, user: h.user, input: { city: 'Example', website: 'https://example.gov' } });
    await settle();
    const job = h.manager.find(out.job.id);
    assert.strictEqual(job.state, 'partial');
    assert.strictEqual(h.applied.length, 0, 'a partial result was written without review');
    const view = h.manager.publicJob(job);
    assert.strictEqual(view.reviewable, true);
    assert.deepStrictEqual(view.missing, ['operating or general-fund budget']);

    h.manager.applyReviewed(job, { search: h.search(), user: h.user });
    assert.strictEqual(h.applied.length, 1, 'applying a reviewed partial wrote nothing');
    assert.strictEqual(h.applied[0].out.partial, true, 'a reviewed partial was applied as if it were complete');
    assert.strictEqual(h.manager.publicJob(h.manager.find(out.job.id)).reviewable, false);
    // Applying twice is refused rather than writing twice.
    assert.ok(h.manager.applyReviewed(job, { search: h.search(), user: h.user }).error);
  });

  await check('a restart marks running work interrupted and never replays it', async () => {
    const h = harness({ research: () => new Promise(() => {}) });
    const out = h.manager.start({ search: h.search(), access: h.access, user: h.user, input: { city: 'Example', website: 'https://example.gov' } });
    await settle();
    assert.strictEqual(h.manager.find(out.job.id).state, 'running');
    // Stand a second manager over the same store: this is what a redeploy is.
    const second = researchJobs.create({
      db: { db: h.store, persist(){} }, ai,
      telemetry: { log: { info(){}, warn(){}, error(){} }, recordAi(){} },
      aibudget: { check: () => ({ ok: true }), begin(){}, record(){}, limits: () => ({ concurrent: 1 }) },
      apply: () => ({ held: [] }),
      authorize: () => ({ ok: true, search: {}, user: {} }),
      research: () => { throw new Error('a restart replayed a possibly-billed request'); }
    });
    second.recover();
    const job = second.find(out.job.id);
    assert.strictEqual(job.state, 'interrupted');
    assert.strictEqual(job.failure.code, 'RESEARCH_INTERRUPTED');
    await settle();
    second.stop();
    h.manager.stop();
    assert.ok(!h.store.researchJobs.some(j => j.state === 'running'), 'a job was left permanently running');
  });

  await check('a persistence failure on a terminal state is loud, not silent', async () => {
    const h = harness();
    const out = h.manager.start({ search: h.search(), access: h.access, user: h.user, input: { city: 'Example', website: 'https://example.gov' } });
    h.persists.fail = true;
    await settle();
    // The in-memory state is still terminal; it does not hang on "running"
    // because the write failed.
    assert.ok(researchJobs.TERMINAL.has(h.manager.find(out.job.id).state),
      'a failed write left the job in a non-terminal state');
    h.persists.fail = false;
  });

  await check('deleting a search takes its research history and stops its work', async () => {
    const h = harness({ research: () => new Promise(() => {}) });
    h.manager.start({ search: h.search('sr-doomed'), access: h.access, user: h.user, input: { city: 'X', website: 'https://x.gov' } });
    await settle();
    const dropped = h.manager.dropForSearch('sr-doomed');
    assert.strictEqual(dropped, 1);
    assert.strictEqual(h.store.researchJobs.length, 0);
    h.manager.stop();
  });

  await check('the status a browser sees carries no provider or prompt detail', async () => {
    const h = harness();
    const out = h.manager.start({ search: h.search(), access: h.access, user: h.user, input: { city: 'Example', website: 'https://example.gov' } });
    await settle();
    const view = JSON.stringify(h.manager.publicJob(h.manager.find(out.job.id)));
    assert.doesNotMatch(view, /apiKey|sk-ant|authorization/i, 'a credential reached the job view');
    assert.doesNotMatch(view, /Research this jurisdiction/, 'the prompt reached the job view');
    assert.ok(!('requestedByClerkId' in JSON.parse(view)), 'the identity provider id reached the browser');
  });

  /* ------------------------------------------------------------------ *
   * Over HTTP
   *
   * The shared harness runs with no API key, which is the outage case. What is
   * proved here is the contract: the job is accepted, recorded, pollable,
   * cancellable, and fails with a code that says what went wrong.
   * ------------------------------------------------------------------ */

  const auth = identity.signer().headers('abe@slate.local');
  const call = (path, { method = 'GET', body, revision, headers = {} } = {}) => {
    const all = { ...JSON_HEADERS, ...auth, ...headers };
    if (revision !== undefined) all['if-match'] = String(revision);
    return fetch(BASE + path, { method, headers: all, body: body ? JSON.stringify(body) : undefined });
  };

  let search = null;
  try {
    search = await (await call('/api/searches', {
      method: 'POST', body: { client: 'Research City', position: 'City Manager' }
    })).json();
  } catch { /* the server is not up; the HTTP checks below will report it */ }

  if (search && search.id) {
    const revisionOf = async () => String((await (await call('/api/searches/' + search.id)).json()).revision);

    await check('starting research is acknowledged separately from doing it', async () => {
      const res = await call('/api/searches/' + search.id + '/research-jobs', {
        method: 'POST', revision: await revisionOf(),
        headers: { 'idempotency-key': 'http-1' },
        body: { city: 'Research City', website: 'https://example.gov' }
      });
      assert.strictEqual(res.status, 202, 'expected 202 Accepted, got ' + res.status);
      const body = await res.json();
      assert.ok(body.job && body.job.id, 'no job id came back');
      assert.ok(body.status.includes(body.job.id), 'no status address came back');
      assert.ok(['queued', 'running', 'failed'].includes(body.job.state), 'unexpected initial state ' + body.job.state);

      // The same key again finds the same operation.
      const again = await call('/api/searches/' + search.id + '/research-jobs', {
        method: 'POST', revision: await revisionOf(),
        headers: { 'idempotency-key': 'http-1' },
        body: { city: 'Research City', website: 'https://example.gov' }
      });
      const twice = await again.json();
      assert.strictEqual(twice.job.id, body.job.id, 'the same key started a second operation');
      assert.strictEqual(twice.reused, true);

      // It is pollable, and reaches a terminal state on its own. With no key
      // configured that is a failure, and the failure has to say which.
      let job = body.job;
      for (let i = 0; i < 40 && !researchJobs.TERMINAL.has(job.state); i += 1) {
        await new Promise(r => setTimeout(r, 50));
        job = (await (await call(body.status)).json()).job;
      }
      assert.ok(researchJobs.TERMINAL.has(job.state), 'the job never reached a terminal state: ' + job.state);
      assert.strictEqual(job.state, 'failed');
      assert.ok(['NO_KEY', 'AI_AUTH_ERROR', 'AUTH_ERROR'].includes(job.failure.code),
        'a missing key failed as ' + job.failure.code + ' rather than as a credential problem');
      assert.match(job.failure.error, /key|unavailable/i);
    });

    await check('the search carries its research operation, so a reload reconnects', async () => {
      const painted = await (await call('/api/searches/' + search.id)).json();
      assert.ok(painted.researchJob, 'a search read does not name its research operation');
      assert.ok(painted.researchJob.id, 'the operation reference has no id');
    });

    await check('cancelling does not need a fresh revision', async () => {
      const started = await (await call('/api/searches/' + search.id + '/research-jobs', {
        method: 'POST', revision: await revisionOf(),
        headers: { 'idempotency-key': 'http-cancel' },
        body: { city: 'Research City', website: 'https://example.gov' }
      })).json();
      // A stale revision on purpose: stopping work is not an edit, and needing
      // to reload first would mean a paid operation nobody can stop.
      const res = await call('/api/searches/' + search.id + '/research-jobs/' + started.job.id + '/cancel', {
        method: 'POST', revision: '999999', body: {}
      });
      assert.strictEqual(res.status, 200, 'cancel was refused with ' + res.status);
      const body = await res.json();
      assert.ok(['cancelled', 'failed'].includes(body.job.state), 'cancel left the job ' + body.job.state);
    });

    await check('another search cannot read this one\'s research operation', async () => {
      const other = await (await call('/api/searches', { method: 'POST', body: { client: 'Other City', position: 'Manager' } })).json();
      const started = await (await call('/api/searches/' + search.id + '/research-jobs', {
        method: 'POST', revision: await revisionOf(),
        headers: { 'idempotency-key': 'http-scope' },
        body: { city: 'Research City', website: 'https://example.gov' }
      })).json();
      const res = await call('/api/searches/' + other.id + '/research-jobs/' + started.job.id);
      assert.strictEqual(res.status, 404, 'a job leaked across searches (' + res.status + ')');
    });

    await check('a missing key is reported as a credential problem, not as a connection error', async () => {
      const res = await call('/api/searches/' + search.id + '/research', {
        method: 'POST', revision: await revisionOf(),
        body: { city: 'Research City', website: 'https://example.gov' }
      });
      assert.strictEqual(res.status, 503, 'expected 503, got ' + res.status);
      const body = await res.json();
      assert.strictEqual(body.code, 'AI_AUTH_ERROR',
        'a key problem was reported as ' + body.code + '; that is the ambiguity the audit found');
    });

    await check('a key can be reconciled over HTTP without starting work', async () => {
      const before = (await (await fetch(BASE + '/api/ready')).json()).research.total;
      // A key that names nothing: null is the answer, and no operation appears.
      const miss = await (await call('/api/searches/' + search.id + '/research-jobs?key=never-used')).json();
      assert.strictEqual(miss.job, null, 'a key that named nothing returned an operation');
      assert.strictEqual(miss.matchedKey, false);
      const after = (await (await fetch(BASE + '/api/ready')).json()).research.total;
      assert.strictEqual(after, before, 'a read-only lookup created ' + (after - before) + ' operation(s)');

      // A key that does name one finds it, and only for the search it is on.
      const started = await (await call('/api/searches/' + search.id + '/research-jobs', {
        method: 'POST', revision: await revisionOf(),
        headers: { 'idempotency-key': 'http-reconcile' },
        body: { city: 'Research City', website: 'https://example.gov' }
      })).json();
      const hit = await (await call('/api/searches/' + search.id + '/research-jobs?key=http-reconcile')).json();
      assert.strictEqual(hit.job.id, started.job.id, 'the key did not find the operation it created');
      assert.strictEqual(hit.matchedKey, true);
      const other = await (await call('/api/searches', { method: 'POST', body: { client: 'Elsewhere City', position: 'Manager' } })).json();
      const elsewhere = await (await call('/api/searches/' + other.id + '/research-jobs?key=http-reconcile')).json();
      assert.strictEqual(elsewhere.job, null, 'a key leaked across searches');
    });

    await check('readiness separates a configured key from research that works', async () => {
      const body = await (await fetch(BASE + '/api/ready')).json();
      // The test server runs with no key, and jobs above have failed. Both
      // facts have to be readable, separately (D07).
      assert.strictEqual(body.ai.configured, false);
      assert.ok(body.ai.research, 'readiness reports no research outcomes at all');
      assert.strictEqual(body.ai.research.verified, false,
        'readiness claims research is verified with no successful job on record');
      assert.ok(['not yet verified', 'only failures so far'].includes(body.ai.research.observed),
        'readiness described research as ' + body.ai.research.observed);
      assert.ok(body.ai.entitlement, 'readiness does not say where an entitlement answer comes from');
      assert.strictEqual(body.ai.entitlement.checkedHere, false,
        'readiness claims to have checked model entitlement, which it cannot do');
      // Outcomes are counts and codes. Never a jurisdiction, never findings.
      assert.doesNotMatch(JSON.stringify(body.ai.research), /Research City|example\.gov/,
        'record contents leaked into research outcome telemetry');
      assert.ok('releaseStamped' in body, 'readiness does not say whether the release is traceable to a build');
    });

    await check('the limits in force and the queue are visible to an operator', async () => {
      const body = await (await fetch(BASE + '/api/ready')).json();
      assert.ok(body.research, 'readiness does not report research at all');
      assert.ok(body.research.limits.totalMs > 0, 'the operation deadline in force is not reported');
      assert.ok(body.research.limits.maxRounds > 0);
      assert.strictEqual(body.research.limits.retries, 0,
        'readiness reports automatic retries enabled for research');
      assert.ok('queued' in body.research && 'running' in body.research, 'the queue is not reported');
      // Counts and limits only: which jurisdictions are being researched is
      // not operational capacity information.
      assert.doesNotMatch(JSON.stringify(body.research), /Research City|example\.gov/,
        'record contents leaked into research telemetry');
    });

    await check('an unusable website is refused before anything is spent', async () => {
      const res = await call('/api/searches/' + search.id + '/research-jobs', {
        method: 'POST', revision: await revisionOf(),
        body: { city: 'Research City', website: 'http://169.254.169.254/latest/meta-data/' }
      });
      // Either refused on input, or accepted and failed as BAD_URL. What must
      // not happen is the metadata service being read.
      if (res.status === 202) {
        const body = await res.json();
        let job = body.job;
        for (let i = 0; i < 40 && !researchJobs.TERMINAL.has(job.state); i += 1) {
          await new Promise(r => setTimeout(r, 50));
          job = (await (await call(body.status)).json()).job;
        }
        assert.ok(['BAD_URL', 'NO_KEY', 'AI_AUTH_ERROR', 'AUTH_ERROR'].includes(job.failure.code),
          'a link-local address failed as ' + job.failure.code);
      } else {
        assert.ok(res.status >= 400, 'a link-local address was accepted');
      }
    });
  } else {
    failed += 1;
    console.error('FAIL  Research: the shared test server was not reachable at ' + BASE);
  }

  clearInterval(keepAlive);
  console.log(passed + ' research checks passed' + (failed ? ', ' + failed + ' failed' : '') + '.');
  process.exitCode = failed ? 1 : 0;
})().catch(error => { clearInterval(keepAlive); console.error(error); process.exitCode = 1; });
