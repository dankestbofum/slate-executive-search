'use strict';

// Structured logging, counters, and alerting.
//
// The constraint that shapes this file: Slate holds job applications from
// people who in many cases have not told their current employer they are
// looking. Telemetry is read by more people, kept longer, and shipped further
// than the record itself, so nothing that identifies a candidate or reproduces
// what they wrote goes into it. Route names are templates, never real paths;
// actors are ids, never names; bodies are never logged at all.

const os = require('os');
const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');
const { safePath } = require('./http');

const started = Date.now();
const RELEASE = String(process.env.SLATE_RELEASE || '').trim() || 'dev';
const isTest = process.env.NODE_ENV === 'test';

const counters = {
  requests: 0,
  byStatusClass: { '2xx': 0, '3xx': 0, '4xx': 0, '5xx': 0 },
  serverErrors: 0,
  clientErrors: 0,
  slowRequests: 0,
  aiCalls: 0,
  aiFailures: 0,
  aiLatencyMsTotal: 0,
  aiInputTokens: 0,
  aiOutputTokens: 0
};

const SLOW_MS = 1000; // the plan's proposed p95 for ordinary reads and saves

/* ------------------------------------------------------------------ *
 * Structured log lines
 *
 * One JSON object per line so a hosting platform can index them. Written to
 * stdout/stderr rather than a file: the container has no durable log volume,
 * and shipping is the platform's job.
 * ------------------------------------------------------------------ */
function emit(level, event, fields = {}) {
  if (isTest && !process.env.SLATE_LOG_IN_TESTS) return;
  const line = JSON.stringify({
    at: new Date().toISOString(),
    level,
    event,
    release: RELEASE,
    ...fields
  });
  if (level === 'error') console.error(line);
  else console.log(line);
}

const log = {
  info: (event, fields) => emit('info', event, fields),
  warn: (event, fields) => emit('warn', event, fields),
  error: (event, fields) => emit('error', event, fields)
};

/* ------------------------------------------------------------------ *
 * Request logging
 * ------------------------------------------------------------------ */

/**
 * Collapse a path to a route template.
 *
 * safePath() already removes candidate tokens. This additionally replaces
 * record identifiers, so a log aggregator groups by route rather than
 * accumulating one distinct label per search, and so the log does not become a
 * list of which searches exist.
 */
function routeName(urlPath) {
  return safePath(urlPath)
    .replace(/\/sr-[a-z0-9]+/gi, '/:search')
    .replace(/\/[uC]-[a-z0-9]+/gi, '/:id')
    .replace(/\/u\d+\b/g, '/:id');
}

function requests(){
  return (req, res, next) => {
    const startedAt = process.hrtime.bigint();
    res.on('finish', () => {
      const ms = Number(process.hrtime.bigint() - startedAt) / 1e6;
      const statusClass = Math.floor(res.statusCode / 100) + 'xx';

      counters.requests += 1;
      if (counters.byStatusClass[statusClass] !== undefined) counters.byStatusClass[statusClass] += 1;
      if (res.statusCode >= 500) counters.serverErrors += 1;
      else if (res.statusCode >= 400) counters.clientErrors += 1;
      if (ms > SLOW_MS) counters.slowRequests += 1;

      // Health checks would otherwise dominate the log without adding anything.
      const noisy = req.path === '/api/health' || req.path === '/api/ready';
      if (noisy && res.statusCode < 400) return;

      log[res.statusCode >= 500 ? 'error' : 'info']('request', {
        ref: req.ref,
        method: req.method,
        route: routeName(req.originalUrl || req.path),
        status: res.statusCode,
        ms: Math.round(ms),
        // Who acted, as an opaque id. Never a name, never an email: an audit
        // trail needs to identify the actor, not describe the person.
        actor: req.user?.id || null,
        slow: ms > SLOW_MS || undefined
      });
    });
    next();
  };
}

/** Record an AI call's outcome. Counts and timings only; no prompt, no output. */
function recordAi({ ok, ms, usage, kind, code }){
  counters.aiCalls += 1;
  if (!ok) counters.aiFailures += 1;
  if (Number.isFinite(ms)) counters.aiLatencyMsTotal += ms;
  counters.aiInputTokens += Number(usage?.input_tokens) || 0;
  counters.aiOutputTokens += Number(usage?.output_tokens) || 0;
  log[ok ? 'info' : 'warn']('ai', { kind, ok, ms: Math.round(ms || 0), code: code || undefined });
}

/* ------------------------------------------------------------------ *
 * Event-loop delay
 *
 * The store is rewritten whole and synchronously, so the thing that degrades
 * first under load is the event loop, not CPU or memory. Sampling it is the
 * cheapest early warning that the JSON store has stopped being adequate.
 * ------------------------------------------------------------------ */
let loopDelayMs = 0;
let loopTimer = null;

function watchEventLoop(intervalMs = 5000){
  let last = process.hrtime.bigint();
  loopTimer = setInterval(() => {
    const now = process.hrtime.bigint();
    const drift = Number(now - last) / 1e6 - intervalMs;
    loopDelayMs = Math.max(0, Math.round(drift));
    last = now;
  }, intervalMs);
  loopTimer.unref();
}

function directorySize(dir){
  let total = 0;
  let files = 0;
  const walk = current => {
    let entries;
    try { entries = fs.readdirSync(current, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) walk(full);
      else {
        try { total += fs.statSync(full).size; files += 1; } catch { /* raced with a sweep */ }
      }
    }
  };
  walk(dir);
  return { bytes: total, files };
}

/**
 * Metrics for the readiness endpoint.
 *
 * Counts and sizes only. A number of searches is operational capacity
 * information; the names of those searches would not be, so they are not here.
 */
function metrics({ dataDir, storeSize, searches, archived } = {}){
  const memory = process.memoryUsage();
  const disk = dataDir ? directorySize(dataDir) : null;
  const errorRate = counters.requests ? counters.serverErrors / counters.requests : 0;

  return {
    uptimeSeconds: Math.round((Date.now() - started) / 1000),
    release: RELEASE,
    requests: counters.requests,
    byStatusClass: { ...counters.byStatusClass },
    serverErrors: counters.serverErrors,
    clientErrors: counters.clientErrors,
    errorRate: Number(errorRate.toFixed(4)),
    slowRequests: counters.slowRequests,
    slowThresholdMs: SLOW_MS,
    eventLoopDelayMs: loopDelayMs,
    memoryRssMb: Math.round(memory.rss / 1048576),
    heapUsedMb: Math.round(memory.heapUsed / 1048576),
    loadAverage1m: Number((os.loadavg()[0] || 0).toFixed(2)),
    dataDirBytes: disk?.bytes ?? null,
    dataDirFiles: disk?.files ?? null,
    storeBytes: storeSize ?? null,
    searches: searches ?? null,
    archivedSearches: archived ?? null,
    ai: {
      calls: counters.aiCalls,
      failures: counters.aiFailures,
      failureRate: counters.aiCalls ? Number((counters.aiFailures / counters.aiCalls).toFixed(4)) : 0,
      averageLatencyMs: counters.aiCalls ? Math.round(counters.aiLatencyMsTotal / counters.aiCalls) : 0,
      inputTokens: counters.aiInputTokens,
      outputTokens: counters.aiOutputTokens
    }
  };
}

/* ------------------------------------------------------------------ *
 * Alerting
 *
 * Slate has no mail server, so this hands a payload to whatever the operator
 * already uses: a webhook, or a command. Who receives it is an owner decision
 * and cannot be answered here — but an unconfigured alert is reported as
 * unconfigured rather than silently doing nothing.
 * ------------------------------------------------------------------ */
const alertState = { active: new Map(), configured: false, lastError: null, sent: 0 };

function alertConfig(env = process.env){
  return {
    webhook: String(env.SLATE_ALERT_WEBHOOK || '').trim() || null,
    command: String(env.SLATE_ALERT_COMMAND || '').trim() || null
  };
}

async function deliver(payload, config){
  if (config.webhook) {
    const response = await fetch(config.webhook, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(10000)
    });
    if (!response.ok) throw new Error('alert webhook returned ' + response.status);
    return;
  }
  if (config.command) {
    await new Promise((resolve, reject) => {
      const [command, ...args] = config.command.split(/\s+/).filter(Boolean);
      const child = execFile(command, args, { timeout: 30000 }, error => error ? reject(error) : resolve());
      child.stdin?.end(JSON.stringify(payload));
    });
  }
}

/**
 * Raise or clear a named alert.
 *
 * Deduplicated by key, so a condition that stays true for hours produces one
 * notification and one recovery notification, not one per check. An operator
 * who is paged every minute stops reading pages.
 */
async function alert(key, firing, detail = {}, env = process.env){
  const config = alertConfig(env);
  alertState.configured = Boolean(config.webhook || config.command);

  const wasFiring = alertState.active.has(key);
  if (firing === wasFiring) return false;

  if (firing) alertState.active.set(key, { since: new Date().toISOString(), ...detail });
  else alertState.active.delete(key);

  const payload = {
    alert: key,
    state: firing ? 'firing' : 'resolved',
    at: new Date().toISOString(),
    release: RELEASE,
    detail
  };
  log[firing ? 'error' : 'info']('alert', payload);

  if (!alertState.configured) {
    alertState.lastError = 'no alert destination configured';
    return true;
  }
  try {
    await deliver(payload, config);
    alertState.sent += 1;
    alertState.lastError = null;
  } catch (error) {
    alertState.lastError = error.message;
    log.error('alert-delivery-failed', { alert: key, error: error.message });
  }
  return true;
}

function alerts(env = process.env){
  const config = alertConfig(env);
  return {
    destination: config.webhook ? 'webhook' : (config.command ? 'command' : 'NOT CONFIGURED'),
    firing: [...alertState.active.keys()],
    sent: alertState.sent,
    lastError: alertState.lastError
  };
}

function reset(){
  for (const key of Object.keys(counters)) {
    if (typeof counters[key] === 'number') counters[key] = 0;
  }
  counters.byStatusClass = { '2xx': 0, '3xx': 0, '4xx': 0, '5xx': 0 };
  alertState.active.clear();
  alertState.sent = 0;
  alertState.lastError = null;
}

function stop(){ if (loopTimer) clearInterval(loopTimer); loopTimer = null; }

module.exports = {
  log, requests, routeName, recordAi, metrics, watchEventLoop,
  alert, alerts, alertConfig, alertState, counters, reset, stop, SLOW_MS
};
