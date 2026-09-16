'use strict';

// One research operation, bounded.
//
// Research is not one provider call. It is a website crawl, then several model
// rounds (server tools pause and resume), then possibly a fallback loop, then a
// database write. Before this file existed each of those pieces carried its own
// timeout and none of them knew about the others, so a stalled attempt plus one
// SDK retry could run for six minutes and a slow-but-succeeding sequence of
// rounds could run for eighteen. What the consultant was promised — "this takes
// a minute or two" — was not enforced anywhere.
//
// An operation context is the enforcement. It owns:
//
//  - one deadline for the whole operation, started before the crawl;
//  - one abort signal, threaded into DNS waits, fetches, response bodies and
//    provider streams, so cancelling stops real work rather than only stopping
//    us waiting for it;
//  - a round budget, so continuations and the fallback spend from the same
//    allowance rather than each getting a fresh one;
//  - a ledger of attempts and usage, so a failure after three successful
//    rounds still reports what it cost and what stage it died in.
//
// Cancellation and expiry are distinguishable on purpose: a consultant who
// pressed Cancel should not be told the provider was slow.

const crypto = require('crypto');
const budget = require('./aibudget');

// Starting limits to validate against real jurisdictions, not a promise that
// every jurisdiction completes in three minutes. They are deliberately
// conservative: the first release's job is to prove the bound holds.
const DEFAULTS = {
  totalMs: 180000,
  crawlMs: 25000,
  roundMs: 60000,
  maxRounds: 4,
  // Held back from the total so the last thing research does is submit what it
  // has, rather than spending the final seconds asking for one more source.
  synthesisReserveMs: 30000
};

// Configuration that would defeat the point is refused rather than honoured.
// A one-second total deadline cannot complete a crawl; a one-hour total is not
// a bound a browser can wait behind.
const RANGES = {
  totalMs: [15000, 900000],
  crawlMs: [1000, 120000],
  roundMs: [5000, 600000],
  maxRounds: [1, 8]
};

function configured(raw, fallback, range){
  if (raw === undefined || raw === null || String(raw).trim() === '') return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(range[0], Math.min(range[1], Math.round(n)));
}

/**
 * The limits in force, after validation.
 *
 * `SLATE_AI_TIMEOUT_MS` keeps its meaning as the per-provider-call ceiling, so
 * lowering it lowers the round timeout; it cannot raise a round above the
 * research round limit, and no round may exceed the whole operation.
 */
function limits(env = process.env){
  const totalMs = configured(env.SLATE_RESEARCH_TIMEOUT_MS, DEFAULTS.totalMs, RANGES.totalMs);
  const crawlMs = Math.min(configured(env.SLATE_RESEARCH_CRAWL_TIMEOUT_MS, DEFAULTS.crawlMs, RANGES.crawlMs), totalMs);
  const maxRounds = configured(env.SLATE_RESEARCH_MAX_ROUNDS, DEFAULTS.maxRounds, RANGES.maxRounds);
  const perCallCeiling = budget.limits(env).timeoutMs;
  const roundMs = Math.min(
    configured(env.SLATE_RESEARCH_ROUND_TIMEOUT_MS, DEFAULTS.roundMs, RANGES.roundMs),
    perCallCeiling,
    totalMs
  );
  return {
    totalMs,
    crawlMs,
    roundMs,
    maxRounds,
    synthesisReserveMs: Math.min(DEFAULTS.synthesisReserveMs, Math.floor(totalMs / 2)),
    // Automatic provider retries are off for research. One stalled attempt plus
    // one retry is what produced the six-minute failures; a retry, if it is
    // ever justified, has to be an explicit decision with budget left to pay
    // for it.
    retries: 0
  };
}

function fail(code, message){
  const err = new Error(message);
  err.code = code;
  return err;
}

const STAGES = new Set([
  'queued', 'starting', 'crawling', 'researching', 'synthesizing', 'saving', 'done'
]);

/**
 * Start an operation.
 *
 * `onStage` is called for every transition with a safe snapshot; it is where
 * the job record and the logs get their real stage instead of a simulated one.
 * `clock` is injectable so tests can drive deadlines without sleeping.
 */
function begin({ id, onStage = null, limits: given = null, clock = Date.now, searchId = null } = {}){
  const lim = given || limits();
  const controller = new AbortController();
  const startedAt = clock();
  const deadlineAt = startedAt + lim.totalMs;

  const state = {
    id: id || 'op-' + crypto.randomBytes(6).toString('hex'),
    searchId,
    startedAt,
    deadlineAt,
    stage: 'starting',
    stageAt: startedAt,
    timeline: [],
    attempts: [],
    rounds: 0,
    usage: { input_tokens: 0, output_tokens: 0 },
    // Tracked separately from the token counts: a failure that reported no
    // usage may still have been billed, and zero is not the same claim as
    // "we do not know".
    usageKnown: false,
    unknownUsageAttempts: 0,
    cancelled: false,
    cancelReason: null,
    timedOut: false,
    finished: false
  };

  let timer = setTimeout(() => {
    if (state.finished) return;
    state.timedOut = true;
    controller.abort(fail('RESEARCH_TIMEOUT', 'Research ran past its time limit.'));
  }, Math.max(1, deadlineAt - startedAt));
  if (timer.unref) timer.unref();

  const op = {
    get id(){ return state.id; },
    get searchId(){ return state.searchId; },
    get signal(){ return controller.signal; },
    get limits(){ return lim; },
    get startedAt(){ return state.startedAt; },
    get deadlineAt(){ return state.deadlineAt; },
    get stage(){ return state.stage; },
    get timeline(){ return state.timeline.slice(); },
    get attempts(){ return state.attempts.slice(); },
    get rounds(){ return state.rounds; },
    get usage(){ return { ...state.usage }; },
    get usageKnown(){ return state.usageKnown; },
    get unknownUsageAttempts(){ return state.unknownUsageAttempts; },
    get cancelled(){ return state.cancelled; },
    get cancelReason(){ return state.cancelReason; },
    get timedOut(){ return state.timedOut; },

    elapsed(){ return clock() - state.startedAt; },
    remaining(){ return Math.max(0, state.deadlineAt - clock()); },
    expired(){ return state.timedOut || op.remaining() <= 0; },
    done(){ return state.cancelled || op.expired(); },

    /**
     * The error this operation should report, or null while it may continue.
     *
     * Cancellation wins over expiry: if the consultant pressed Cancel and the
     * deadline then passed, the honest answer is that they cancelled it.
     */
    terminal(){
      if (state.cancelled) return fail('RESEARCH_CANCELLED', 'Research was cancelled.');
      if (op.expired()) return fail('RESEARCH_TIMEOUT', 'Research ran past its time limit before it could finish.');
      return null;
    },

    throwIfDone(){
      const err = op.terminal();
      if (err) throw err;
    },

    stageIs(name){
      if (!STAGES.has(name)) throw new Error('Unknown research stage: ' + name);
      const at = clock();
      state.timeline.push({ stage: state.stage, ms: at - state.stageAt });
      if (state.timeline.length > 32) state.timeline.shift();
      state.stage = name;
      state.stageAt = at;
      if (onStage) {
        try { onStage(name, op.snapshot()); }
        catch { /* a status listener must not be able to fail the operation */ }
      }
      return op;
    },

    /** One provider call, recorded whether it succeeded or not. */
    record(entry){
      state.attempts.push({ at: clock() - state.startedAt, ...entry });
      if (state.attempts.length > 24) state.attempts.shift();
      return op;
    },

    addUsage(usage){
      const input = Number(usage && usage.input_tokens) || 0;
      const output = Number(usage && usage.output_tokens) || 0;
      const cacheRead = Number(usage && usage.cache_read_input_tokens) || 0;
      const cacheWrite = Number(usage && usage.cache_creation_input_tokens) || 0;
      if (!input && !output && !cacheRead && !cacheWrite) {
        state.unknownUsageAttempts += 1;
        return op;
      }
      state.usage = {
        input_tokens: state.usage.input_tokens + input,
        output_tokens: state.usage.output_tokens + output,
        cache_read_input_tokens: (state.usage.cache_read_input_tokens || 0) + cacheRead,
        cache_creation_input_tokens: (state.usage.cache_creation_input_tokens || 0) + cacheWrite
      };
      state.usageKnown = true;
      return op;
    },

    /** How long the next provider call may take, never past the deadline. */
    roundBudget(){
      return Math.min(lim.roundMs, op.remaining());
    },

    crawlBudget(){
      return Math.min(lim.crawlMs, op.remaining());
    },

    /** Rounds are shared across continuations and the fallback loop. */
    roundsLeft(){ return Math.max(0, lim.maxRounds - state.rounds); },

    useRound(){
      if (!op.roundsLeft()) return false;
      state.rounds += 1;
      return true;
    },

    /**
     * True once there is only enough time left to write up what we have.
     *
     * The agent is told to stop gathering and submit rather than being cut off
     * mid-search with nothing to show.
     */
    synthesisOnly(){
      return op.remaining() <= lim.synthesisReserveMs;
    },

    cancel(reason = 'cancelled'){
      if (state.cancelled || state.finished) return false;
      state.cancelled = true;
      state.cancelReason = String(reason);
      controller.abort(fail('RESEARCH_CANCELLED', 'Research was cancelled.'));
      return true;
    },

    /** Release the deadline timer. Safe to call more than once. */
    end(){
      state.finished = true;
      if (timer) { clearTimeout(timer); timer = null; }
      return op;
    },

    /** Everything safe to log or hand to a status endpoint. */
    snapshot(){
      return {
        operation: state.id,
        stage: state.stage,
        elapsedMs: op.elapsed(),
        remainingMs: op.remaining(),
        deadlineAt: new Date(state.deadlineAt).toISOString(),
        rounds: state.rounds,
        maxRounds: lim.maxRounds,
        usage: { ...state.usage },
        usageKnown: state.usageKnown,
        unknownUsageAttempts: state.unknownUsageAttempts,
        cancelled: state.cancelled,
        timedOut: state.timedOut
      };
    }
  };

  return op;
}

module.exports = { begin, limits, DEFAULTS, RANGES, STAGES, fail };
