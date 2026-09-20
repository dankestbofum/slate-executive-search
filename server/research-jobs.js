'use strict';

// Research as a job with a life of its own.
//
// Until this file existed, one HTTP request held the whole operation: the
// crawl, every model round, and the database write. That had four consequences
// worth naming, because they are what this replaces.
//
//  - A consultant who navigated away, refreshed, or lost their connection had
//    no way back to the work. The browser was the only record that it existed.
//  - A double click started a second paid run.
//  - The authority the write landed under was the authority the request
//    started with, minutes earlier.
//  - There was nowhere to put a result that was good but incomplete, so it was
//    thrown away.
//
// Deliberately still single-instance and single-writer. The store is one JSON
// file, and the Render blueprint says plainly that a second writer would
// overwrite it, so this is an in-process queue with a durable record, not a
// worker. A real worker needs a transactional shared store, and pretending
// otherwise here would trade a visible problem for a silent one.

const crypto = require('crypto');
const researchOp = require('./research-op');

const TERMINAL = new Set(['succeeded', 'partial', 'failed', 'cancelled', 'interrupted']);

// Global bound on work accepted but not started. Refused before it is accepted,
// so a queue cannot grow into a backlog of operations whose deadlines have all
// expired by the time they run.
const MAX_QUEUED = 6;
// How many job records the store keeps. A research history is useful for a few
// days; it is not an archive, and it must not grow without bound inside a file
// that is rewritten whole on every save.
const RETAIN_RECORDS = 60;
const RETAIN_MS = 7 * 24 * 60 * 60 * 1000;

function enabled(env = process.env){
  // On by default. The flag exists so the synchronous contract can be rolled
  // back to without a deploy, not because the job path is experimental.
  return String(env.SLATE_RESEARCH_JOBS ?? 'on').trim().toLowerCase() !== 'off';
}

/**
 * The job manager.
 *
 * Dependencies are injected rather than required, so the storage, recovery and
 * race tests can drive it with a fake clock and a provider that never answers
 * without standing up a server or spending anything.
 */
function create({ db, ai, telemetry, aibudget, apply, authorize, research, clock = Date.now, limits = null }){
  // Operations for jobs currently running in this process. Not persisted:
  // an abort signal does not survive a restart, which is exactly why a
  // restart marks running jobs interrupted rather than pretending to resume.
  const live = new Map();
  let pumpTimer = null;

  function table(){
    if (!Array.isArray(db.db.researchJobs)) db.db.researchJobs = [];
    return db.db.researchJobs;
  }

  function find(id){
    return table().find(j => j.id === id) || null;
  }

  /**
   * Find the operation an idempotency key names, without starting one.
   *
   * The browser can lose the answer to a start request, which leaves it holding
   * a key and no job id: it cannot poll, and it cannot honestly say whether
   * anything is running. Retrying the start would be one way to find out, and
   * it is the wrong way — a start request is allowed to create work. This reads
   * only (D03).
   */
  function findByKey(searchId, userId, key){
    const wanted = String(key || '').trim();
    if (!wanted) return null;
    return table().find(j => j.idempotencyKey === wanted
      && j.searchId === searchId
      && j.requestedBy === userId) || null;
  }

  function activeFor(searchId){
    return table().find(j => j.searchId === searchId && !TERMINAL.has(j.state)) || null;
  }

  function latestFor(searchId){
    const rows = table().filter(j => j.searchId === searchId);
    return rows.length ? rows[rows.length - 1] : null;
  }

  function running(){
    return table().filter(j => j.state === 'running').length;
  }

  function queued(){
    return table().filter(j => j.state === 'queued').length;
  }

  function researchLimits(){
    return limits || researchOp.limits();
  }

  /**
   * What a browser may see.
   *
   * No input snapshot beyond the jurisdiction and site it was asked about, no
   * provider detail, and the result body only when it is there to be reviewed.
   */
  function publicJob(job, { includeResult = false } = {}){
    if (!job) return null;
    const deadline = job.deadlineAt ? Date.parse(job.deadlineAt) : null;
    return {
      id: job.id,
      searchId: job.searchId,
      state: job.state,
      stage: job.stage,
      city: job.input.city,
      website: job.input.website,
      premium: Boolean(job.input.premium),
      requestedBy: job.requestedBy,
      createdAt: job.createdAt,
      startedAt: job.startedAt,
      finishedAt: job.finishedAt,
      deadlineAt: job.deadlineAt,
      elapsedMs: Math.max(0, (job.finishedAt ? Date.parse(job.finishedAt) : clock()) - Date.parse(job.createdAt)),
      remainingMs: deadline && !TERMINAL.has(job.state) ? Math.max(0, deadline - clock()) : 0,
      rounds: job.rounds || 0,
      usage: job.usage || null,
      usageKnown: Boolean(job.usageKnown),
      failure: job.failure || null,
      // Is there something to review? Separate from `state` on purpose: a
      // stale-search conflict is a failure that still has paid findings behind
      // it, and throwing those away would be its own defect.
      reviewable: Boolean(job.result && job.result.reviewable && !job.result.applied),
      applied: Boolean(job.result && job.result.applied),
      partial: Boolean(job.result && job.result.partial),
      missing: (job.result && job.result.warnings) || [],
      sources: (job.result && job.result.sources) || [],
      result: includeResult && job.result && job.result.json ? job.result.json : undefined
    };
  }

  /** The job reference a search reload carries, so a revisit reconnects. */
  function referenceFor(searchId){
    const active = activeFor(searchId);
    const job = active || latestFor(searchId);
    if (!job) return null;
    return publicJob(job);
  }

  function refuse(status, code, error){
    return { error, code, status };
  }

  /**
   * Accept a research job, or refuse it before anything is spent.
   *
   * Capacity is reserved in the same synchronous turn as the check, so two
   * requests that arrive together cannot both be told there was room. That is
   * not a claim about clusters: it holds because this process is the only
   * writer, which is also why there is no second worker.
   */
  function startJob({ search, access, user, input, idempotencyKey }){
    if (!enabled()) return refuse(404, 'RESEARCH_JOBS_OFF', 'Background research is not enabled on this deployment.');

    const key = String(idempotencyKey || '').trim().slice(0, 120);
    if (key) {
      const already = table().find(j => j.idempotencyKey === key && j.searchId === search.id && j.requestedBy === user.id);
      // A refresh or a double click finds its own operation rather than paying
      // for a second one.
      if (already) return { job: already, reused: true };
    }

    const active = activeFor(search.id);
    if (active) return { job: active, reused: true };

    if (queued() >= MAX_QUEUED) {
      return refuse(429, 'RESEARCH_QUEUE_FULL', 'Too much research is already waiting. Try again in a few minutes.');
    }
    const verdict = aibudget.check(search.id);
    // AI_BUSY is capacity, not a refusal: the job waits in the queue, and its
    // deadline is already running so it cannot wait forever.
    if (!verdict.ok && verdict.code !== 'AI_BUSY') {
      return refuse(429, verdict.code, verdict.error);
    }

    const lim = researchLimits();
    const createdAt = new Date(clock()).toISOString();
    const job = {
      id: 'rj-' + crypto.randomBytes(6).toString('hex'),
      organizationId: search.organizationId || null,
      searchId: search.id,
      requestedBy: user.id,
      // Held so the result can be revalidated against the directory later,
      // rather than trusting the access object this request happened to carry.
      requestedByClerkId: access.clerkUserId || null,
      idempotencyKey: key || null,
      input: {
        city: input.city,
        website: input.website,
        premium: Boolean(input.premium),
        position: input.position || '',
        state: input.state || '',
        jurisdictionType: input.jurisdictionType || 'municipality'
      },
      revisionAtStart: search.revision,
      createdAt,
      startedAt: null,
      finishedAt: null,
      // The deadline runs from acceptance, so queue waiting is inside it.
      deadlineAt: new Date(clock() + lim.totalMs).toISOString(),
      state: 'queued',
      stage: 'queued',
      stageAt: createdAt,
      rounds: 0,
      usage: null,
      usageKnown: false,
      model: null,
      result: null,
      failure: null
    };
    table().push(job);
    prune();
    db.persist();
    telemetry.log.info('research-job', { job: job.id, event: 'queued', search: 'redacted' });
    pump();
    return { job };
  }

  /** Start whatever is queued, as far as capacity allows. */
  function pump(){
    for (const job of table().filter(j => j.state === 'queued')) {
      if (Date.parse(job.deadlineAt) - clock() <= 1000) {
        finish(job, 'failed', { failure: { code: 'RESEARCH_TIMEOUT', error: 'Research expired while waiting for a free slot. Try again.' } });
        continue;
      }
      const verdict = aibudget.check(job.searchId);
      if (!verdict.ok) break;
      void run(job);
    }
    schedulePump();
  }

  // Drafting shares the concurrency allowance, so a slot can free up without a
  // job finishing. A light timer exists only while something is waiting.
  function schedulePump(){
    const waiting = queued() > 0;
    if (!waiting && pumpTimer) { clearInterval(pumpTimer); pumpTimer = null; return; }
    if (waiting && !pumpTimer) {
      pumpTimer = setInterval(() => pump(), 2000);
      if (pumpTimer.unref) pumpTimer.unref();
    }
  }

  function stageOf(job, stage){
    job.stage = stage;
    job.stageAt = new Date(clock()).toISOString();
    // Persisted before it is exposed: a status a poller can read has to be a
    // status that survived a restart, not one held only in memory.
    try { db.persist(); } catch (error) {
      telemetry.log.error('research-job-persist-failed', { job: job.id, stage, error: error.message });
    }
  }

  /**
   * A terminal state, reached while this run was still finishing.
   *
   * Cancellation and the restart sweep both write a terminal state from outside
   * the run, and the run then carries on to whatever it was going to conclude.
   * The state already recorded stands; what the run learned is still attached,
   * because the findings were paid for and are worth reviewing. This is the last
   * line of defence behind the pre-save checks, not a substitute for them: it
   * keeps the record honest, it cannot un-write a file.
   */
  function attachLate(job, state, { result = null, usage = null, usageKnown = false, model = null, rounds = 0 } = {}){
    if (result && !job.result) job.result = result;
    if (usage && !job.usage) job.usage = usage;
    if (usageKnown && !job.usageKnown) job.usageKnown = true;
    if (model && !job.model) job.model = model;
    if (rounds && !job.rounds) job.rounds = rounds;
    live.delete(job.id);
    try { db.persist(); } catch (error) {
      telemetry.log.error('research-job-persist-failed', { job: job.id, state: job.state, error: error.message });
    }
    telemetry.log.warn('research-job-terminal-conflict', { job: job.id, kept: job.state, refused: state });
    schedulePump();
  }

  function finish(job, state, { failure = null, result = null, usage = null, usageKnown = false, model = null, rounds = 0 } = {}){
    // A job that is already terminal keeps the state it reached. Without this,
    // a run that concluded "succeeded" after cancel() had recorded "cancelled"
    // overwrote it, and the record then said the opposite of what happened.
    if (TERMINAL.has(job.state) && job.state !== state) {
      attachLate(job, state, { result, usage, usageKnown, model, rounds });
      return;
    }
    job.state = state;
    job.stage = state === 'succeeded' ? 'done' : job.stage;
    job.finishedAt = new Date(clock()).toISOString();
    if (failure) job.failure = failure;
    if (result) job.result = result;
    if (usage) job.usage = usage;
    job.usageKnown = Boolean(usageKnown);
    if (model) job.model = model;
    if (rounds) job.rounds = rounds;
    live.delete(job.id);
    try { db.persist(); } catch (error) {
      // A terminal state that cannot be written is the one failure that would
      // leave a job permanently "running" to every later reader, so it is
      // logged loudly rather than swallowed.
      telemetry.log.error('research-job-persist-failed', { job: job.id, state, error: error.message });
    }
    const ms = Date.parse(job.finishedAt) - Date.parse(job.createdAt);
    telemetry.log.info('research-job', {
      job: job.id, event: state, rounds: job.rounds, ms,
      code: failure ? failure.code : null
    });
    // The outcome of the job, which is a different measurement from the
    // outcome of the provider call inside it: a call that answered and then
    // could not be saved is a success by one count and a failure by the other,
    // and readiness has to be able to tell them apart (D07).
    if (typeof telemetry.recordResearchOutcome === 'function') {
      telemetry.recordResearchOutcome({ state, code: failure ? failure.code : null, ms, rounds: job.rounds });
    }
    schedulePump();
  }

  /**
   * Run one job.
   *
   * Everything after the provider returns is re-checked: cancellation, current
   * authority, the search still existing and not being frozen, and the
   * revision. A job can outlive the membership that started it, so the check
   * asks the directory again rather than trusting the access object the request
   * arrived with.
   */
  async function run(job){
    const left = Date.parse(job.deadlineAt) - clock();
    if (left <= 1000) {
      finish(job, 'failed', { failure: { code: 'RESEARCH_TIMEOUT', error: 'Research expired before it could start. Try again.' } });
      return;
    }
    // What is left of the deadline that started when the job was accepted, so
    // time spent queued is inside the bound rather than added to it.
    const op = researchOp.begin({
      searchId: job.searchId,
      limits: { ...researchLimits(), totalMs: left },
      onStage: stage => { if (job.state === 'running') stageOf(job, stage); }
    });
    live.set(job.id, op);
    try {
      await execute(job, op);
    } finally {
      // The deadline timer is released once, on every path, and only after the
      // save has been attempted — an operation is not over when the provider
      // answers. Whatever happened, the next queued job gets its turn.
      op.end();
      live.delete(job.id);
      pump();
    }
  }

  async function execute(job, op){
    job.state = 'running';
    job.startedAt = new Date(clock()).toISOString();
    stageOf(job, 'starting');

    const startedAt = clock();
    aibudget.begin();
    let settled = false;
    const account = (ok, model) => {
      if (settled) return;
      settled = true;
      telemetry.recordAi({ ok, ms: clock() - startedAt, usage: op.usageKnown ? op.usage : null, kind: 'research' });
      aibudget.record({ searchId: job.searchId, model: model || null, usage: op.usageKnown ? op.usage : null, ok });
    };

    let out = null;
    try {
      out = await research(job.input, op);
      account(true, out.model);
    } catch (error) {
      const normalized = ai.normalizeClaudeError(error, op);
      account(false, null);
      job.rounds = op.rounds;
      job.usage = op.usageKnown ? op.usage : null;
      job.usageKnown = op.usageKnown;
      const cancelled = normalized.code === 'RESEARCH_CANCELLED' || job.state === 'cancelled';
      telemetry.log.warn('research-job-failed', {
        job: job.id,
        code: normalized.code || null,
        stage: op.stage,
        rounds: op.rounds,
        elapsedMs: op.elapsed(),
        sdkClass: normalized.sdkClass || null,
        network: normalized.networkCode || null,
        providerRequestId: normalized.requestId || null,
        attempts: op.attempts,
        usageKnown: op.usageKnown
      });
      finish(job, cancelled ? 'cancelled' : 'failed', {
        failure: cancelled ? null : safeFailure(normalized),
        usage: op.usageKnown ? op.usage : null,
        usageKnown: op.usageKnown,
        rounds: op.rounds
      });
      return;
    }

    job.rounds = op.rounds;
    // What the run actually cost in time, logged before the save is attempted
    // so the measurement survives whatever the save decides. A run that
    // succeeded in 170 seconds is the measurement that matters most: it says
    // the bound is nearly too tight. Never the jurisdiction or what was found.
    telemetry.log.info('research-run', {
      route: 'research-job',
      job: job.id,
      operation: op.id,
      outcome: out.partial ? 'incomplete' : 'complete',
      elapsedMs: op.elapsed(),
      deadlineMs: op.limits.totalMs,
      rounds: op.rounds,
      maxRounds: op.limits.maxRounds,
      pagesRead: out.pagesRead ?? null,
      crawlTruncated: out.crawlTruncated || undefined,
      timeline: op.timeline,
      attempts: op.attempts,
      usage: op.usage,
      usageKnown: op.usageKnown,
      unknownUsageAttempts: op.unknownUsageAttempts
    });

    // What the run learned, attached to whatever the save decides, so every
    // path below reports the same cost and the same findings.
    const ledger = () => ({
      result: reviewableResult(out, { applied: false }),
      usage: op.usageKnown ? op.usage : null,
      usageKnown: op.usageKnown,
      model: out.model,
      rounds: op.rounds
    });

    // A cancellation that arrived while the provider was answering wins. The
    // work is paid for either way, but it is not written to the file.
    if (stopped(job, op)) { concludeStopped(job, op, ledger()); return; }

    stageOf(job, 'saving');
    let verdict;
    try {
      // Bounded by what is left of this operation's deadline. The directory
      // lookup carries no abort signal of its own, so an unreachable directory
      // held the save phase open past the deadline, and the cancellation check
      // on the near side of this await was the last one before the write (D02).
      verdict = await op.guard(authorize(job), 'the access check');
    } catch (error) {
      // Three different things arrive here and must not be conflated: the
      // consultant cancelled, the operation ran out of time, or the directory
      // could not answer. None of them is a reason to write.
      if (stopped(job, op) || error.code === 'RESEARCH_CANCELLED' || error.code === 'RESEARCH_TIMEOUT') {
        concludeStopped(job, op, ledger(), error);
        return;
      }
      // The directory being unreachable is not a reason to write into a
      // workspace whose membership we could not confirm.
      finish(job, 'failed', {
        failure: { code: 'RESEARCH_UNVERIFIED', error: 'Slate could not confirm your access to this search, so the result was not saved. Reload and review it.' },
        ...ledger()
      });
      telemetry.log.warn('research-job-unverified', { job: job.id, error: error.message });
      return;
    }

    if (!verdict.ok) {
      finish(job, 'failed', {
        failure: { code: verdict.code, error: verdict.error },
        // Kept for review rather than discarded: the findings were paid for,
        // and a consultant who reloads can decide what to do with them.
        ...ledger()
      });
      return;
    }

    if (out.partial) {
      // Supported findings with named gaps. Offered for review; never written
      // over a consultant's own work without them asking.
      finish(job, 'partial', ledger());
      return;
    }

    /* ----------------------------------------------------------------
     * The write.
     *
     * Everything from here to apply() is synchronous, deliberately. The last
     * check before a write has to be the last thing that happens before it: an
     * await in between is a window in which Cancel can be pressed, the deadline
     * can pass, or the search can be edited, and the reproduction in
     * docs/audits/2026-09-16-website-audit showed all three landing on the file
     * anyway.
     * ---------------------------------------------------------------- */
    if (stopped(job, op)) { concludeStopped(job, op, ledger()); return; }

    // The synchronous half of the access check, re-run against the store as it
    // is now rather than as it was before the await: the search may have been
    // edited, closed, moved, or deleted while the directory was answering. The
    // asynchronous half — the directory lookup — is not repeated, because its
    // answer is what this verdict carries.
    const confirmed = typeof verdict.recheck === 'function' ? verdict.recheck() : verdict;
    if (!confirmed.ok) {
      finish(job, 'failed', { failure: { code: confirmed.code, error: confirmed.error }, ...ledger() });
      return;
    }

    // The saved result and the job outcome are written together, in one
    // persist, so there is no window where the file has the research and the
    // job still says it is running.
    try {
      apply(confirmed.search || verdict.search, confirmed.user || verdict.user,
        { city: job.input.city, website: job.input.website, out });
    } catch (error) {
      finish(job, 'failed', {
        failure: { code: 'RESEARCH_SAVE_FAILED', error: 'The research could not be written to the search file. Review it and try again.' },
        ...ledger()
      });
      telemetry.log.error('research-job-save-failed', { job: job.id, error: error.message });
      return;
    }
    finish(job, 'succeeded', {
      result: { applied: true, partial: false, reviewable: false, warnings: [], sources: out.sources || [] },
      usage: op.usageKnown ? op.usage : null,
      usageKnown: op.usageKnown,
      model: out.model,
      rounds: op.rounds
    });
  }

  /**
   * Is this operation over, whatever the provider just handed back?
   *
   * Cancellation and expiry are both checked, and both are checked again after
   * every await in the save phase. Reading the job record as well as the
   * operation is not redundancy: cancel() marks the record terminal from
   * outside the run, and a restart's recovery sweep can too.
   */
  function stopped(job, op){
    return TERMINAL.has(job.state) || op.cancelled || op.expired();
  }

  /**
   * Conclude a job that was stopped rather than finished.
   *
   * Cancellation is reported as cancellation and expiry as expiry, because a
   * consultant who pressed Cancel must not be told the provider was slow. The
   * findings are kept for review either way; nothing is written.
   */
  function concludeStopped(job, op, ledger, error = null){
    const cancelled = job.state === 'cancelled' || op.cancelled
      || (error && error.code === 'RESEARCH_CANCELLED');
    if (cancelled) {
      finish(job, 'cancelled', ledger);
      return;
    }
    finish(job, 'failed', {
      failure: {
        code: 'RESEARCH_TIMEOUT',
        error: 'Research ran past its time limit before it could be saved. Nothing was written. Review what it found, or try again.'
      },
      ...ledger
    });
  }

  function reviewableResult(out, { applied }){
    if (!out) return null;
    return {
      applied: Boolean(applied),
      partial: Boolean(out.partial),
      reviewable: !applied,
      warnings: (out.warnings || []).slice(0, 12),
      sources: (out.sources || []).slice(0, 12),
      model: out.model || null,
      usage: out.usage || null,
      json: out.json || null
    };
  }

  /** A failure a consultant may read. Provider text stays in the log. */
  function safeFailure(err){
    const code = err.code === 'TIMEOUT' ? 'RESEARCH_TIMEOUT' : (err.code || 'RESEARCH_FAILED');
    const messages = {
      RESEARCH_TIMEOUT: 'Research ran past its time limit and was stopped. Nothing was saved. Try again, or fill the facts by hand.',
      RESEARCH_CONNECTION_ERROR: 'Slate could not complete the call to Anthropic. Nothing was saved. Try again in a moment.',
      CONNECTION_ERROR: 'Slate could not complete the call to Anthropic. Nothing was saved. Try again in a moment.',
      PROVIDER_ERROR: 'Anthropic returned an error. Nothing was saved. Try again in a moment.',
      AUTH_ERROR: 'The Anthropic API key is invalid or expired. Tell an operator; research is unavailable until it is replaced.',
      NO_KEY: 'No Anthropic API key is configured, so research is unavailable. Fill the facts by hand.',
      RATE_LIMIT: 'Claude is rate-limited. Wait a minute and try again.',
      MODEL_UNAVAILABLE: 'Anthropic refused the research request for this model or tool configuration. Tell an operator.',
      BAD_REQUEST: 'Anthropic refused the research request. Tell an operator.',
      BAD_URL: 'That website cannot be used. Check the address on the search file.',
      RESEARCH_INCOMPLETE: err.message
    };
    return {
      code: code === 'CONNECTION_ERROR' ? 'RESEARCH_CONNECTION_ERROR' : code,
      error: messages[code] || 'Research failed. Nothing was saved. Try again, or fill the facts by hand.',
      missing: Array.isArray(err.warnings) && err.warnings.length ? err.warnings.slice(0, 12) : undefined
    };
  }

  /**
   * Request cancellation. Idempotent.
   *
   * A job that has already saved its result is not cancellable; saying so is
   * more use than a success that did not undo anything.
   */
  function cancel(job, user){
    if (job.state === 'succeeded') {
      return { alreadyDone: true, job };
    }
    if (TERMINAL.has(job.state)) return { job };
    const op = live.get(job.id);
    // A job that never started has no run to conclude it, so its outcome is
    // recorded here. One that is running is recorded when its run finishes,
    // which is the same cancellation counted once rather than twice.
    if (!op && job.state === 'queued' && typeof telemetry.recordResearchOutcome === 'function') {
      telemetry.recordResearchOutcome({ state: 'cancelled', code: null, ms: clock() - Date.parse(job.createdAt), rounds: 0 });
    }
    job.state = 'cancelled';
    job.finishedAt = new Date(clock()).toISOString();
    job.failure = null;
    if (op) op.cancel('cancelled by ' + (user && user.id ? user.id : 'requester'));
    live.delete(job.id);
    db.persist();
    telemetry.log.info('research-job', { job: job.id, event: 'cancelled' });
    schedulePump();
    return { job };
  }

  /**
   * Apply a result that was held back for review.
   *
   * Authorization and the revision are checked again here rather than being
   * inherited from whenever the job ran, and the result is marked applied in
   * the same persist that writes it to the search.
   */
  function applyReviewed(job, { search, user }){
    if (!job.result || !job.result.json || job.result.applied) {
      return { error: 'There is nothing from this research to apply.', code: 'NOTHING_TO_APPLY', status: 409 };
    }
    const out = {
      model: job.result.model,
      json: job.result.json,
      sources: job.result.sources || [],
      usage: job.result.usage || null,
      partial: Boolean(job.result.partial),
      warnings: job.result.warnings || []
    };
    const { held } = apply(search, user, { city: job.input.city, website: job.input.website, out });
    job.result.applied = true;
    job.result.reviewable = false;
    job.result.appliedAt = new Date(clock()).toISOString();
    db.persist();
    telemetry.log.info('research-job', { job: job.id, event: 'applied', partial: Boolean(job.result.partial) });
    return { held };
  }

  /**
   * What a restart does to work that was in flight.
   *
   * A running job is marked interrupted, never replayed: the request may
   * already have been billed, and a silent re-run would bill it again. A queued
   * job never reached the provider, so it may resume if its deadline has not
   * passed.
   */
  function recover(){
    let changed = 0;
    for (const job of table()) {
      if (job.state === 'running') {
        job.state = 'interrupted';
        job.finishedAt = new Date(clock()).toISOString();
        job.failure = {
          code: 'RESEARCH_INTERRUPTED',
          error: 'Slate restarted while this research was running, so it was stopped. Nothing was saved. Start it again when you are ready.'
        };
        changed += 1;
      } else if (job.state === 'queued') {
        if (Date.parse(job.deadlineAt) - clock() <= 1000) {
          job.state = 'interrupted';
          job.finishedAt = new Date(clock()).toISOString();
          job.failure = { code: 'RESEARCH_INTERRUPTED', error: 'This research expired while Slate was restarting. Start it again.' };
          changed += 1;
        }
      }
    }
    if (changed) {
      telemetry.log.warn('research-jobs-recovered', { interrupted: changed });
      db.persist();
    }
    pump();
    return changed;
  }

  /**
   * Bounded retention.
   *
   * A research history is useful for a few days. It is not an archive, and it
   * must not grow without bound inside a file that is rewritten whole on every
   * save. Only terminal records are dropped: nothing in flight is ever removed,
   * however full the table is.
   */
  function prune(){
    const rows = table();
    const cutoff = clock() - RETAIN_MS;
    const fresh = rows.filter(job => !TERMINAL.has(job.state)
      || Date.parse(job.finishedAt || job.createdAt) >= cutoff);
    const inFlight = fresh.filter(job => !TERMINAL.has(job.state));
    const room = Math.max(0, RETAIN_RECORDS - inFlight.length);
    // The newest terminal records, up to whatever room is left beside the work
    // that is still running.
    const recent = new Set(fresh.filter(job => TERMINAL.has(job.state)).slice(-room));
    const kept = fresh.filter(job => !TERMINAL.has(job.state) || recent.has(job));
    if (kept.length !== rows.length) db.db.researchJobs = kept;
  }

  /** A deleted search takes its research history with it. */
  function dropForSearch(searchId){
    for (const [id, op] of live) {
      const job = find(id);
      if (job && job.searchId === searchId) op.cancel('search deleted');
    }
    const rows = table();
    db.db.researchJobs = rows.filter(j => j.searchId !== searchId);
    return rows.length - db.db.researchJobs.length;
  }

  /** Shutdown: stop live work so a draining process does not keep billing. */
  function stop(){
    for (const op of live.values()) op.cancel('shutting down');
    live.clear();
    if (pumpTimer) { clearInterval(pumpTimer); pumpTimer = null; }
  }

  return {
    enabled, table, find, findByKey, activeFor, latestFor, referenceFor, publicJob,
    start: startJob, cancel, applyReviewed, recover, prune, dropForSearch, stop,
    counts: () => ({ queued: queued(), running: running(), total: table().length }),
    MAX_QUEUED
  };
}

module.exports = { create, enabled, TERMINAL, MAX_QUEUED, RETAIN_RECORDS };
