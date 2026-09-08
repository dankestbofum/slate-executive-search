'use strict';

// What AI work costs, and the limits that stop it running away.
//
// Two things this file insists on:
//
//  - A failed call can still have been billed. A request that times out, or
//    whose result is rejected as stale, consumed tokens at the provider. Usage
//    is therefore recorded on the attempt, not on the successful save, and
//    failures whose usage is unknown are counted as unknown rather than zero.
//  - Estimates are labelled as estimates. Token counts reported by the API are
//    known; anything derived from them is a calculation against a price table
//    that can go out of date, and a spending decision should be able to tell
//    the difference.

const PRICES_PER_MTOK = {
  // Anthropic first-party API rates. Partner platforms (Bedrock, Vertex) are
  // priced separately and are not modelled here.
  'claude-opus-5': { input: 5, output: 25 },
  'claude-sonnet-5': { input: 2, output: 10 },
  'claude-haiku-4-5': { input: 1, output: 5 },
  'claude-opus-4-8': { input: 5, output: 25 },
  'claude-sonnet-4-6': { input: 3, output: 15 },
  'claude-fable-5-1': { input: 10, output: 50 }
};

const PRICES_UPDATED = '2026-06-24';

/**
 * Estimated dollar cost of one call.
 *
 * Returns `known: false` for a model with no price on file, so an unpriced
 * model shows as unknown rather than as free.
 */
function estimateCost(model, usage) {
  const price = PRICES_PER_MTOK[model];
  const input = Number(usage?.input_tokens) || 0;
  const output = Number(usage?.output_tokens) || 0;
  const cacheRead = Number(usage?.cache_read_input_tokens) || 0;
  const cacheWrite = Number(usage?.cache_creation_input_tokens) || 0;

  if (!price) {
    return { known: false, usd: null, model, note: 'No price on file for this model.' };
  }
  // Cache reads bill at roughly a tenth of input, writes at roughly 1.25x.
  const usd = (input * price.input
    + cacheRead * price.input * 0.1
    + cacheWrite * price.input * 1.25
    + output * price.output) / 1_000_000;

  return {
    known: true,
    usd: Number(usd.toFixed(6)),
    model,
    basis: 'estimate from published per-token rates as of ' + PRICES_UPDATED
  };
}

/* ------------------------------------------------------------------ *
 * Limits
 *
 * Bounds on spend, not on ordinary work. They exist so a loop, a retry storm
 * or a mistake cannot quietly run up a bill nobody authorised.
 * ------------------------------------------------------------------ */
function limits(env = process.env) {
  const number = (name, fallback) => {
    const value = Number(env[name]);
    return Number.isFinite(value) && value > 0 ? value : fallback;
  };
  return {
    perSearchCalls: number('SLATE_AI_MAX_CALLS_PER_SEARCH', 200),
    perDayCalls: number('SLATE_AI_MAX_CALLS_PER_DAY', 500),
    perDayUsd: number('SLATE_AI_MAX_USD_PER_DAY', 25),
    concurrent: number('SLATE_AI_MAX_CONCURRENT', 3),
    // Must fit inside the host's own request timeout, or the client sees a
    // gateway error while the call keeps running and keeps billing.
    timeoutMs: number('SLATE_AI_TIMEOUT_MS', 180000),
    retries: Number.isFinite(Number(env.SLATE_AI_RETRIES)) ? Number(env.SLATE_AI_RETRIES) : 1
  };
}

/* ------------------------------------------------------------------ *
 * The ledger
 *
 * In memory, per process, reset daily. It is a spending guard, not an
 * accounting record: the provider's own usage reporting is authoritative, and
 * this cannot see calls made by another process or another deployment.
 * ------------------------------------------------------------------ */
const ledger = {
  day: today(),
  calls: 0,
  failures: 0,
  unknownUsage: 0,
  inputTokens: 0,
  outputTokens: 0,
  estimatedUsd: 0,
  bySearch: new Map(),
  inFlight: 0
};

function today() {
  return new Date().toISOString().slice(0, 10);
}

function rollover() {
  if (ledger.day === today()) return;
  ledger.day = today();
  ledger.calls = 0;
  ledger.failures = 0;
  ledger.unknownUsage = 0;
  ledger.inputTokens = 0;
  ledger.outputTokens = 0;
  ledger.estimatedUsd = 0;
  ledger.bySearch.clear();
}

/**
 * Whether another call may start.
 *
 * Checked before the request, because the point is to prevent the spend, not
 * to notice it afterwards.
 */
function check(searchId, env = process.env) {
  rollover();
  const max = limits(env);

  if (ledger.inFlight >= max.concurrent) {
    return { ok: false, code: 'AI_BUSY', error: 'Too many drafts are running at once. Try again in a moment.' };
  }
  if (ledger.calls >= max.perDayCalls) {
    return { ok: false, code: 'AI_DAILY_CALLS', error: 'The daily limit for AI drafting has been reached. It resets at midnight UTC.' };
  }
  if (ledger.estimatedUsd >= max.perDayUsd) {
    return { ok: false, code: 'AI_DAILY_SPEND', error: 'The daily spending limit for AI drafting has been reached. It resets at midnight UTC.' };
  }
  const forSearch = ledger.bySearch.get(searchId) || { calls: 0, estimatedUsd: 0 };
  if (searchId && forSearch.calls >= max.perSearchCalls) {
    return { ok: false, code: 'AI_SEARCH_CALLS', error: 'This search has reached its limit for AI drafting.' };
  }
  return { ok: true };
}

function begin() {
  rollover();
  ledger.inFlight += 1;
}

/**
 * Record an attempt.
 *
 * Called for successes and failures alike. `usage` may be absent on a failure;
 * that is counted as an attempt with unknown usage rather than as no cost,
 * because the provider may still have billed it.
 */
function record({ searchId, model, usage, ok }) {
  rollover();
  ledger.inFlight = Math.max(0, ledger.inFlight - 1);
  ledger.calls += 1;
  if (!ok) ledger.failures += 1;

  const cost = estimateCost(model, usage);
  const known = Boolean(usage && (usage.input_tokens || usage.output_tokens));
  if (!known) ledger.unknownUsage += 1;

  ledger.inputTokens += Number(usage?.input_tokens) || 0;
  ledger.outputTokens += Number(usage?.output_tokens) || 0;
  if (cost.known) ledger.estimatedUsd = Number((ledger.estimatedUsd + cost.usd).toFixed(6));

  if (searchId) {
    const row = ledger.bySearch.get(searchId) || { calls: 0, estimatedUsd: 0, failures: 0 };
    row.calls += 1;
    if (!ok) row.failures += 1;
    if (cost.known) row.estimatedUsd = Number((row.estimatedUsd + cost.usd).toFixed(6));
    ledger.bySearch.set(searchId, row);
  }
  return cost;
}

function status(env = process.env) {
  rollover();
  const max = limits(env);
  return {
    day: ledger.day,
    calls: ledger.calls,
    failures: ledger.failures,
    // Attempts whose token usage the provider did not report back. These may
    // still have been billed, so they are surfaced rather than hidden.
    attemptsWithUnknownUsage: ledger.unknownUsage,
    inputTokens: ledger.inputTokens,
    outputTokens: ledger.outputTokens,
    estimatedUsd: ledger.estimatedUsd,
    estimateBasis: 'Published per-token rates as of ' + PRICES_UPDATED
      + '. An estimate, not a bill; the provider’s usage reporting is authoritative.',
    inFlight: ledger.inFlight,
    limits: max,
    searchesTouched: ledger.bySearch.size
  };
}

function reset() {
  ledger.day = today();
  ledger.calls = 0;
  ledger.failures = 0;
  ledger.unknownUsage = 0;
  ledger.inputTokens = 0;
  ledger.outputTokens = 0;
  ledger.estimatedUsd = 0;
  ledger.inFlight = 0;
  ledger.bySearch.clear();
}

module.exports = {
  PRICES_PER_MTOK, PRICES_UPDATED,
  estimateCost, limits, check, begin, record, status, reset
};
