'use strict';

// A local .env is a development convenience only. In production the platform's
// environment is authoritative: a stray .env baked into an image must never
// silently replace deployed configuration. Tests supply their own environment.
if (process.env.NODE_ENV !== 'test' && process.env.NODE_ENV !== 'production') {
  require('dotenv').config({
    path: require('path').join(__dirname, '..', '.env'),
    override: true
  });
}

const fs = require('fs');
const path = require('path');
const express = require('express');
const crypto = require('crypto');
const db = require('./db');
const auth = require('./auth').createAuth(db);
const ai = require('./ai');
const committee = require('./committee');
const integrity = require('./integrity');
const jurisdictions = require('./jurisdictions');
const http = require('./http');
const media = require('./media');
const recovery = require('./recovery');
const telemetry = require('./telemetry');
const exporter = require('./export');
const candidates = require('./candidates');
const disposition = require('./disposition');
const authority = require('./authority');
const aibudget = require('./aibudget');
const researchOp = require('./research-op');
const researchJobs = require('./research-jobs');
const organizations = require('./organizations');
const {
  assembleBrochure, applyBrochureDefaults, packTheme, packScheme,
  PLACE_FIELDS, GOV_FIELDS, PACK_THEMES, PACK_SCHEMES
} = require('./brochure');

/**
 * Research jobs.
 *
 * Built here rather than inside the module so the module carries no opinion
 * about this application's storage, its permission model, or where a result
 * lands. `applyResearch` and `authorizeJob` are hoisted declarations further
 * down this file; nothing calls them until a request arrives.
 */
const jobs = researchJobs.create({
  db, ai, telemetry, aibudget,
  apply: (search, user, payload) => applyResearch(search, user, payload),
  authorize: job => authorizeJob(job),
  research: (input, op) => ai.researchCity(input, op)
});

const app = express();
const PORT = Number(process.env.PORT || 4173);
const HOST = process.env.HOST || '0.0.0.0';
// Stamped into the image by CI (--build-arg SLATE_RELEASE). Lets an operator
// confirm which commit a running container was built from, which is what makes
// a rollback decision checkable rather than assumed.
const RELEASE = String(process.env.SLATE_RELEASE || '').trim() || 'dev';
// The supported Node major, read from the one place it is already declared
// rather than repeated here where it could drift from package.json.
const ENGINE_FLOOR = Number(String(require('../package.json').engines?.node || '').match(/\d+/)?.[0] || 0);
const NON_ARTIFACT_STEPS = new Set(['profile', 'screen', 'send2', 'finalists', ...db.STAFF_STEPS]);
const ARTIFACTS = new Set(db.STEPS.map(s => s.key).filter(k => !NON_ARTIFACT_STEPS.has(k)));

/**
 * Whether a step is on this search's file at all. A Basic search has no
 * brochure step, so drafting, saving, or reviewing one is refused rather than
 * quietly stored where the UI will never show it.
 */
function inPackage(search, key){
  return db.stepsOf(search).some(s => s.key === key);
}

function outsidePackage(search, key){
  const step = db.STEPS.find(s => s.key === key);
  const label = db.PACKAGES[db.packageOf(search.package)].label;
  const needs = step ? db.PACKAGES[step.pkg || 'basic'].label : '';
  return 'That step is not part of the ' + label + ' package.' + (needs ? ' It starts at ' + needs + '. Change the package on Search facts if the engagement changed.' : '');
}

function requireStepOnFile(pick){
  return (req, res, next) => {
    const key = pick(req);
    if (!key || !db.STEPS.some(s => s.key === key)) return next();
    if (!inPackage(req.search, key)) return res.status(400).json({ error: outsidePackage(req.search, key) });
    next();
  };
}
const artifactOnFile = requireStepOnFile(req => req.params.key);
const kindOnFile = requireStepOnFile(req => req.body?.kind);

// Trust only explicitly configured proxy addresses/subnets, never arbitrary client headers.
app.set('trust proxy', process.env.TRUST_PROXY ? process.env.TRUST_PROXY.split(',').map(s => s.trim()) : false);
// Express advertises itself by default; there is no reason to name the stack.
app.disable('x-powered-by');

app.use(http.correlate);
app.use(http.securityHeaders);
// Logged after correlate so every line carries the same reference the client
// was given, which is what makes a support request traceable to a log entry.
app.use(telemetry.requests());

const PHOTO_SLOTS = new Set(['cover', 'place', 'org']);
// Content-addressed names written by server/media.js, plus the legacy
// slot.jpg written before DEP-04, so brochures created earlier keep rendering.
const PHOTO_FILE_RE = new RegExp('^(' + [...PHOTO_SLOTS].join('|') + ')(\\.[a-f0-9]{16})?\\.jpg$', 'i');

// Only the photo route accepts a large body. A base64 JPEG at the 6 MB decoded
// cap enforced below arrives as roughly 8 MB of JSON, so it gets its own
// parser; every other endpoint takes small structured records and must not
// inherit an upload-sized allowance. body-parser marks the request once
// parsed, so the general parser below is a no-op for these.
const MEDIA_UPLOAD = /^\/api\/searches\/[^/]+\/media\/?$/;
const jsonMedia = express.json({ limit: '9mb' });
app.use((req, res, next) => (req.method === 'POST' && MEDIA_UPLOAD.test(req.path)) ? jsonMedia(req, res, next) : next());
app.use(express.json({ limit: '256kb' }));

app.use((req, res, next) => {
  // Candidate links and public configuration do not depend on Clerk availability.
  if (/^\/api\/(config|health|ready|apply)(\/|$)/.test(req.path)) return next();
  if (req.path.startsWith('/api/') || req.path.startsWith('/media/')) return auth.middleware(req, res, next);
  next();
});

// Set by the SIGTERM handler at the foot of this file. Declared and read here
// because the guard has to sit ahead of every route it protects.
let shuttingDown = false;
let recoveryConfig = {};

// Once draining, reads still succeed but writes are refused outright. A write
// accepted now might not reach disk before the process is killed, and a
// half-applied change is worse than a retry.
app.use((req, res, next) => {
  if (!shuttingDown || ['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  res.set('Retry-After', '15');
  return res.status(503).json({ error: 'Slate is restarting. Your work was not saved; try again in a moment.' });
});

// Refuse session-authenticated mutations that a browser did not initiate from
// this origin. Registered before any route so it covers every API call.
app.use(http.sameOrigin);

app.use(express.static(path.join(__dirname, '..', 'public'), {
  setHeaders(res, filePath) {
    // Vendored fonts carry a content hash in the filename, so they can be
    // cached indefinitely; everything else in the shell must revalidate.
    if (/[\\/]fonts[\\/].*\.woff2$/.test(filePath)) res.set('Cache-Control', 'public, max-age=31536000, immutable');
  }
}));

// Backups used to run from here, synchronously, ahead of every API request
// including /api/health. That put a whole-store copy on the latency path of
// ordinary work and turned a disk problem into an opaque error on every call.
// They now run on a timer (server/recovery.js) and report through /api/health.
app.use('/api', (_req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });

/* Rate limits. Bounds on abuse, not on ordinary work: a consultant drafting
 * all day or a committee behind one county NAT address stays well under these.
 * Candidate routes are keyed by IP because the caller is unauthenticated;
 * everything else is keyed by account so one busy user cannot exhaust another. */
const candidateLimit = http.limiter({
  windowMs: 5 * 60 * 1000, max: 240, key: req => 'apply:' + clientIp(req),
  message: 'Too many requests. Wait a few minutes and try again.'
});
const mediaLimit = http.limiter({
  windowMs: 5 * 60 * 1000, max: 120, key: req => 'media:' + (req.user?.id || clientIp(req)),
  message: 'Too many photo uploads. Wait a few minutes.'
});
const generateLimit = http.limiter({
  windowMs: 10 * 60 * 1000, max: 120, key: req => 'gen:' + (req.user?.id || clientIp(req)),
  message: 'Too many drafts requested. Wait a few minutes.'
});
const researchLimit = http.limiter({
  windowMs: 10 * 60 * 1000, max: 60, key: req => 'research:' + (req.user?.id || clientIp(req)),
  message: 'Too much research requested. Wait a few minutes.'
});

function clientIp(req){
  return String(req.ip || req.socket?.remoteAddress || 'unknown');
}

/**
 * Consensus is only assembled for people entitled to read the room.
 *
 * A consultant facilitating the search sees it as answers come in. Everybody
 * else sees it once the manager closes the window, so nobody can watch the
 * tally move and time their own submission against it.
 */
function consensusFor(search, access){
  const closed = (search.intake || {}).status === 'closed';
  if (!db.isStaff(access) && !(closed && db.memberOf(search, access.userId))) return null;
  return committee.aggregate(search, id => {
    const u = db.findUserById(id);
    return u ? u.name : 'Removed member';
  });
}

function painted(req, search){
  const out = db.decorate(search, req.access);
  out.consensus = consensusFor(search, req.access);
  // Which workspace this record belongs to, so the client can refuse to paint
  // it under a different one after a switch.
  out.organization = req.access?.organization || null;
  // Places that are spoken for but not yet taken. On every read, not only on
  // the response to adding somebody: a manager who opens the Committee screen
  // tomorrow has to see who is still outstanding.
  out.pending = heldPlaces(search);
  // Which authority facts are confirmed and which are still assertions. Shown
  // on every read so the gap is visible while the work is happening, not
  // discovered when the county reads the brochure.
  out.factStatus = jurisdictions.factStatus(search);
  // How the search concluded, if it has. Kept separate from Archive: filing a
  // search away is not the same statement as the work having finished.
  out.lifecycle = disposition.summary(search);
  // The research operation this search has in flight, or the last one it ran.
  // Carried on every read so refreshing the page, or coming back to it
  // tomorrow, reconnects to the same operation instead of losing it or
  // starting a second paid one.
  out.researchJob = db.canEdit(search, req.access) ? jobs.referenceFor(search.id) : null;
  // Which late-stage decisions this viewer may make, from the same table the
  // routes enforce (server/authority.js). The client draws its controls from
  // this rather than re-deriving authority from a role name, so a policy change
  // moves the buttons and the refusals together.
  if (req.access && out.you) out.you.may = authority.permissions(search, req.access);
  return out;
}

function claudeFail(err){
  if (err.code === 'NO_KEY') return { status: 503, error: err.message };
  if (err.code === 'BAD_KIND' || err.code === 'BAD_URL' || err.code === 'BAD_JSON') {
    return { status: 400, error: err.message };
  }
  if (err.code === 'AUTH_ERROR') {
    console.error('Claude auth failed:', err.message || 'authentication_error');
    return { status: 503, error: 'The Anthropic API key is invalid or expired. Update ANTHROPIC_API_KEY and try again.' };
  }
  if (err.code === 'RATE_LIMIT') {
    return { status: 429, error: 'Claude is rate-limited. Wait a minute and try again.' };
  }
  // Defense in depth for an SDK error that reached here unnormalized (ai.js
  // normalizes the calls it makes into the codes above).
  const status = err.status || err.statusCode;
  if (status === 401) return { status: 503, error: 'The Anthropic API key is invalid or expired. Update ANTHROPIC_API_KEY and try again.' };
  if (status === 429) return { status: 429, error: 'Claude is rate-limited. Wait a minute and try again.' };
  return { status: 500, error: err.message || 'Request failed.' };
}

/**
 * What research tells the browser when it fails.
 *
 * Every outcome gets its own code and status, because "it failed" is not
 * actionable and the previous single generic error is what made the hosted
 * six-minute failures unreadable: an expired deadline, a dropped socket and an
 * invalid key all arrived as the same `CONNECTION_ERROR`. What a consultant can
 * do about each of those is different, so the answer distinguishes them.
 *
 * The provider's own text, request id and network error code stay in operator
 * telemetry. What travels to the browser is the operation reference, so a
 * support request can be matched to a log line without the log line's contents
 * being published.
 */
function researchFail(err, op = null){
  const reference = op ? op.id : (err && err.operation) || null;
  const body = extra => ({ ...extra, ...(reference ? { operation: reference } : {}) });

  if (err.code === 'RESEARCH_CANCELLED') {
    return { status: 409, body: body({ code: 'RESEARCH_CANCELLED', error: 'Research was cancelled. Nothing was saved.' }) };
  }
  if (err.code === 'RESEARCH_TIMEOUT' || err.code === 'TIMEOUT' || err.code === 'DNS_TIMEOUT') {
    return { status: 504, body: body({
      code: 'RESEARCH_TIMEOUT',
      error: 'Research ran past its time limit and was stopped. Nothing was saved. Try again, or fill the facts by hand.',
      retry: true
    }) };
  }
  if (err.code === 'NO_KEY' || err.code === 'AUTH_ERROR') {
    return { status: 503, body: body({
      code: 'AI_AUTH_ERROR',
      error: err.code === 'NO_KEY'
        ? err.message
        : 'The Anthropic API key is invalid or expired. Update ANTHROPIC_API_KEY and try again.',
      retry: false
    }) };
  }
  if (err.code === 'RATE_LIMIT') {
    return { status: 429, body: body({ code: 'AI_RATE_LIMIT', error: 'Claude is rate-limited. Wait a minute and try again.', retry: true }) };
  }
  if (err.code === 'CONNECTION_ERROR' || err.code === 'PROVIDER_ERROR') {
    return { status: 502, body: body({
      code: 'RESEARCH_CONNECTION_ERROR',
      error: 'Slate could not complete the call to Anthropic. Nothing was saved. Try again in a moment.',
      retry: true
    }) };
  }
  if (err.code === 'MODEL_UNAVAILABLE' || err.code === 'BAD_REQUEST') {
    return { status: 502, body: body({
      code: 'RESEARCH_CONNECTION_ERROR',
      error: 'Anthropic refused the research request for this model or tool configuration. Fill the facts by hand and tell an operator.',
      retry: false
    }) };
  }
  if (err.code === 'RESEARCH_INCOMPLETE' || err.code === 'BAD_JSON') {
    return { status: 422, body: body({
      code: 'RESEARCH_INCOMPLETE',
      error: err.message,
      missing: Array.isArray(err.warnings) ? err.warnings : undefined,
      retry: true
    }) };
  }
  if (err.code === 'BAD_URL') {
    return { status: 400, body: body({ code: 'BAD_URL', error: err.message, retry: false }) };
  }
  if (err.code === 'STALE_SEARCH') {
    return { status: 409, body: body({ code: 'STALE_SEARCH', error: err.message, retry: false }) };
  }
  const fail = claudeFail(err);
  return { status: fail.status, body: body({ code: err.code || 'RESEARCH_FAILED', error: fail.error }) };
}

/** Operator-only detail about a research failure. Never in a response body. */
function logResearchFailure(err, op, fields = {}){
  telemetry.log.warn('research-failed', {
    ...fields,
    operation: op ? op.id : null,
    code: err.code || null,
    stage: op ? op.stage : null,
    elapsedMs: op ? op.elapsed() : null,
    rounds: op ? op.rounds : null,
    sdkClass: err.sdkClass || null,
    network: err.networkCode || null,
    providerRequestId: err.requestId || null,
    timeline: op ? op.timeline : null,
    attempts: op ? op.attempts : null,
    usageKnown: op ? op.usageKnown : null
  });
}

/**
 * What a research run actually cost in time, logged whether or not it worked.
 *
 * A limit is only worth raising against measurements, and a run that succeeded
 * in 170 seconds is the most important measurement there is: it says the bound
 * is nearly too tight. Stage timings, round count and usage; never the
 * jurisdiction, the prompt, or what was found.
 */
function logResearchRun(op, { outcome, partial = false, pages = null, truncated = false, route }){
  telemetry.log.info('research-run', {
    route,
    operation: op.id,
    outcome,
    partial: partial || undefined,
    elapsedMs: op.elapsed(),
    deadlineMs: op.limits.totalMs,
    rounds: op.rounds,
    maxRounds: op.limits.maxRounds,
    pagesRead: pages,
    crawlTruncated: truncated || undefined,
    timeline: op.timeline,
    attempts: op.attempts,
    usage: op.usage,
    usageKnown: op.usageKnown,
    unknownUsageAttempts: op.unknownUsageAttempts
  });
}

// Clerk is the only way into the workspace. Identity is proven by the request's
// Clerk session; Slate resolves it to the account, and the session's active
// organization to a verified role inside that firm's workspace.
function requireUser(req, res, next){
  return auth.requireUser(req, res, next);
}

// Everything that reads or writes a firm's records. Account setup, the
// workspace chooser and organization creation deliberately sit outside it.
const requireWorkspace = [requireUser, (req, res, next) => auth.requireWorkspace(req, res, next)];

// Invitations, roles, and removals within the active organization.
const requireOrgAdmin = [...requireWorkspace, (req, res, next) => auth.requireOrgAdmin(req, res, next)];

function clampWeight(w){
  const n = (w === '' || w === null || w === undefined) ? 3 : Number(w);
  return Math.max(1, Math.min(5, Number.isFinite(n) ? n : 3));
}

// Where a profile line came from: the committee's own submissions, a Claude
// draft, or the consultant typing it. Shown on the profile page so nobody has
// to remember which lines carry the room behind them.
const CRIT_SOURCES = new Set(['committee', 'draft', 'consultant']);

// Requests that stop work rather than change the record. They skip the
// revision precondition and the frozen-search refusal; see requireSearch.
const STOP_WORK_PATH = /\/research-jobs\/[^/]+\/cancel\/?$/;

function requireSearch(req, res, next){
  const s = db.findSearch(req.params.id);
  if (!s) return res.status(404).json({ error:'Search not found.' });
  // A committee member on a different search, or anybody at all in
  // another firm's workspace, must not learn this one exists: an unauthorized
  // read looks the same as a missing file. A search whose owning organization
  // is unknown is refused on the same terms rather than falling through.
  if (!db.canView(s, req.access)) return res.status(404).json({ error:'Search not found.' });
  req.search = s;
  const reads = ['GET', 'HEAD'].includes(req.method);
  // Stopping work already underway is not an edit to the search. A consultant
  // must be able to cancel research whose search has changed under them, or
  // been closed, without first reloading to collect a fresh revision — the
  // alternative is a paid operation nobody can stop.
  const stopsWork = STOP_WORK_PATH.test(req.path);
  if (!reads && !stopsWork && req.headers['if-match'] === undefined) {
    return res.status(428).json({ error:'Reload this search before saving.', code:'REVISION_REQUIRED' });
  }
  if (!reads && !stopsWork && req.headers['if-match'] !== undefined
      && req.headers['if-match'] !== String(s.revision)) {
    return res.status(409).json({ error:'This search changed since you opened it. Your edits were not saved. Copy your edits, then reload the search and try again.', code:'STALE_SEARCH' });
  }
  // A closed or cancelled search accepts no ordinary edits, so a concluded
  // record cannot drift afterwards. Reads continue, and reopening is the one
  // deliberate act that is allowed through.
  // Filing a closed search preserves its lifecycle; it is not ordinary editing.
  // Keep the single-search route consistent with bulk archiving.
  const archiving = req.method === 'DELETE' && /^\/api\/searches\/[^/]+\/?$/.test(req.path);
  if (!reads && !stopsWork && !archiving && disposition.isFrozen(s) && !/\/reopen\/?$/.test(req.path)) {
    return res.status(409).json({
      error: 'This search is ' + disposition.lifecycleOf(s) + '. Reopen it deliberately before making further changes.',
      code: 'SEARCH_CLOSED'
    });
  }
  next();
}

/** Writing to the search file is the firm's work, not the committee's. */
function requireEditor(req, res, next){
  if (!db.canEdit(req.search, req.access)) {
    return res.status(403).json({ error:'Committee members read the search file. A consultant edits it.' });
  }
  next();
}

/**
 * Is the authority this request started with still the authority it has?
 *
 * A draft can take a minute to come back. In that minute the search can be
 * archived, the person can be removed from the workspace, or — the case
 * organization support introduces — the browser can have switched to a
 * different firm. The job keeps the search and organization it began with and
 * refuses to commit into anything else, so a late response never lands in a
 * workspace nobody asked it to.
 */
function stillAuthorized(req){
  const current = db.findSearch(req.search.id);
  if (!current || current !== req.search) return false;
  return db.canEdit(current, req.access);
}

/** Rostering, the intake window, and adoption sit with the account manager. */
function requireManager(req, res, next){
  if (!db.canManage(req.search, req.access)) {
    const mgr = db.accountManager(req.search);
    const who = mgr ? (db.findUserById(mgr.userId)?.name || 'the account manager') : 'the account manager';
    return res.status(403).json({ error: who + ' runs this search. Ask them, or reassign the account.' });
  }
  next();
}

// Cheap liveness: is this process answering at all. No disk work, no AI call,
// so a platform health check cannot be made expensive or flaky by either.
app.get('/api/health', (_req, res) => {
  res.json({ ok: true, release: RELEASE, node: process.versions.node });
});

// Readiness, including recovery health. Separate from liveness because the
// answers differ: the app can be serving correctly while its backups are
// overdue, and an operator needs to see that without it restarting the
// container. Deliberately unauthenticated so a platform monitor can read it;
// it reports state, never record contents.
app.get('/api/ready', (_req, res) => {
  const recoveryStatus = recovery.status(recoveryConfig);
  let storage = { writable: true };
  try {
    // Cheap: proves the volume still takes a write, without copying the store.
    const probe = path.join(db.DATA_DIR, '.ready-probe');
    fs.writeFileSync(probe, String(Date.now()));
    fs.unlinkSync(probe);
  } catch (error) {
    storage = { writable: false, error: error.code || 'unknown' };
  }

  const ready = !shuttingDown && storage.writable && db.db.schemaVersion === db.SCHEMA_VERSION;

  res.status(ready ? 200 : 503).json({
    ready,
    shuttingDown,
    release: RELEASE,
    schemaVersion: db.db.schemaVersion,
    storage,
    // Drafting is unavailable without a key, but nothing else is. This is
    // reported separately so an Anthropic outage never reads as the
    // application being down.
    ai: { configured: aiConfigured(), degraded: !aiConfigured(), budget: aibudget.status() },
    // Research runs as a bounded job with a durable record, so an operator can
    // see what is waiting, what is running, and the limits in force without
    // reading the logs. Counts and limits only; never what is being researched.
    research: {
      jobs: researchJobs.enabled(),
      limits: researchOp.limits(),
      ...jobs.counts()
    },
    recovery: recoveryStatus,
    alerts: telemetry.alerts(),
    metrics: telemetry.metrics({
      dataDir: db.DATA_DIR,
      storeSize: storeBytes(),
      searches: db.db.searches.length,
      archived: (db.db.archivedSearches || []).length
    })
  });
});

function aiConfigured(){
  return Boolean(String(process.env.ANTHROPIC_API_KEY || '').trim());
}

/**
 * The support and accommodation contact shown to candidates.
 *
 * Who staffs this, and during what hours, is an owner decision. Reporting it
 * as unconfigured is the honest default: a candidate needing an accommodation
 * should never be shown a contact that nobody reads.
 */
function support(){
  const email = String(process.env.SLATE_SUPPORT_EMAIL || '').trim();
  const phone = String(process.env.SLATE_SUPPORT_PHONE || '').trim();
  const hours = String(process.env.SLATE_SUPPORT_HOURS || '').trim();
  return {
    configured: Boolean(email || phone),
    email: email || null,
    phone: phone || null,
    hours: hours || null
  };
}

function storeBytes(){
  try { return fs.statSync(path.join(db.DATA_DIR, 'slate.json')).size; }
  catch { return null; }
}

/**
 * Watch the conditions worth waking someone for.
 *
 * Deliberately few. An alert that fires often is an alert that gets ignored,
 * and the two things that actually lose a search are storage failing and
 * backups silently not happening.
 */
function watchAlerts(){
  const check = () => {
    const status = recovery.status(recoveryConfig);
    telemetry.alert('backup-overdue', Boolean(status.overdue), {
      lastSnapshotAt: status.lastSnapshotAt,
      lastMirrorAt: status.lastMirrorAt,
      offVolumeCopy: status.offVolumeCopy,
      error: status.lastSnapshotError || status.lastMirrorError || null
    });

    let writable = true;
    try {
      const probe = path.join(db.DATA_DIR, '.alert-probe');
      fs.writeFileSync(probe, '1');
      fs.unlinkSync(probe);
    } catch { writable = false; }
    telemetry.alert('storage-unwritable', !writable, { dataDir: db.DATA_DIR });

    const m = telemetry.metrics();
    // Rate alone would fire on the first failed request after a restart.
    telemetry.alert('error-rate', m.requests >= 20 && m.errorRate > 0.05, {
      errorRate: m.errorRate, requests: m.requests
    });
  };
  const timer = setInterval(check, 60000);
  timer.unref();
  return timer;
}

app.get('/api/config', (_req, res) => {
  const body = {
    auth: auth.publicConfig,
    jurisdictionTypes: Object.values(jurisdictions.TYPES),
    communityFields: { place: PLACE_FIELDS, gov: GOV_FIELDS },
    packThemes: PACK_THEMES,
    packSchemes: PACK_SCHEMES,
    reviewSteps: [...db.REVIEW_STEPS],
    phases: db.PHASES,
    steps: db.STEPS.map(s => ({ n:s.n, key:s.key, t:s.t, phase:s.phase, opt:Boolean(s.opt), pkg:s.pkg || 'basic', kind:s.kind || 'desk' })),
    packages: db.PACKAGE_ORDER.map(k => db.PACKAGES[k]),
    defaultPackage: db.DEFAULT_PACKAGE,
    compare: db.COMPARE,
    compareBands: db.COMPARE_BANDS
  };
  res.json(body);
});

/**
 * The directory a viewer needs to put names to ids.
 *
 * Never the whole user table. Staff see the people in their own workspace —
 * anyone holding a membership there, plus anyone on one of its searches
 * — and a committee member sees only the people beside them on it. Another
 * firm's staff list is not a name, a count, or an absence somebody can
 * subtract: they are simply not in the answer.
 */
function visibleUsers(access){
  if (!access.orgId || !access.role) return [access.user];
  const ids = new Set([access.userId]);
  const ours = db.db.searches.filter(s => s.organizationId === access.orgId);
  if (db.isStaff(access)) {
    for (const m of db.db.memberships) if (m.orgId === access.orgId) ids.add(m.userId);
    for (const s of ours) for (const m of s.members || []) ids.add(m.userId);
  } else {
    for (const s of ours) {
      if (!db.memberOf(s, access.userId)) continue;
      for (const m of s.members || []) ids.add(m.userId);
    }
  }
  return db.db.users.filter(u => ids.has(u.id));
}

const onboarding = require('./onboarding');

/** Every workspace this person can switch into, named, with their role in each. */
async function workspacesFor(access){
  const list = await auth.directory.userOrganizations(access.clerkUserId);
  return list.map(o => ({
    id: o.id,
    name: o.name,
    role: organizations.isSupportedRole(o.role) ? o.role : null,
    roleLabel: organizations.isSupportedRole(o.role) ? organizations.ROLE_LABEL[o.role] : null,
    providerRole: o.role,
    active: o.id === access.orgId
  })).sort((a, b) => String(a.name || '').localeCompare(String(b.name || '')));
}

app.get('/api/me', requireUser, async (req, res) => {
  let workspaces = null;
  try {
    workspaces = await workspacesFor(req.access);
  } catch (error) {
    // The workspace chooser is missing, which is a recoverable state the client
    // can retry. It is not a reason to refuse the rest of the answer, and it is
    // never a reason to show the workspace as if there were none.
    if (error?.code !== 'DIRECTORY_UNAVAILABLE') throw error;
  }
  res.json({
    user: db.publicUser(req.user),
    onboarding: onboarding.status(db, req.access),
    organization: req.access.organization,
    role: req.access.role,
    capabilities: req.access.capabilities,
    // Deliberately outside `capabilities`, which describe what somebody may do
    // inside the workspace they are in. This is about founding a new one, which
    // is a property of the deployment rather than of any membership.
    canCreateWorkspace: auth.mayCreateWorkspace(req.user),
    workspaces,
    workspacesError: workspaces ? null : 'We could not list your workspaces. Try again shortly.',
    users: visibleUsers(req.access).map(db.publicUser),
    health: {
      model: process.env.CLAUDE_MODEL || 'claude-sonnet-5',
      premium: process.env.CLAUDE_MODEL_PREMIUM || 'claude-opus-5',
      hasKey: Boolean(String(process.env.ANTHROPIC_API_KEY || '').trim())
    }
  });
});

/**
 * Account setup: who you are, and — only if nobody has told us yet — what you
 * came here to do.
 *
 * Somebody arriving on an invitation already has a role: the one the
 * invitation carried and Clerk recorded. Asking them to pick one would invite
 * them to contradict it, so the choice is not accepted from them at all. What
 * they are asked for is their name, which is what the roster shows.
 */
app.post('/api/me/onboarding', requireUser, (req, res) => {
  const { name, requestedRole } = req.body || {};
  if (typeof name !== 'string' || !name.trim() || name.trim().length > 120) {
    return res.status(400).json({ error: 'Enter your name (up to 120 characters).' });
  }
  const assigned = Boolean(req.access.role);
  if (!assigned && !onboarding.ROLES.includes(requestedRole)) {
    return res.status(400).json({ error: 'Choose how you will use Slate.' });
  }
  const user = req.user;
  user.name = name.trim();
  user.init = db.initials(user.name);
  user.onboarding = {
    // A stated preference, never a grant. It shapes the guidance shown while
    // somebody waits for access, and is ignored the moment a workspace assigns
    // them a real role.
    requestedRole: assigned ? (user.onboarding?.requestedRole || null) : requestedRole,
    completedAt: db.now()
  };
  user.title = req.access.role ? organizations.ROLE_LABEL[req.access.role] : 'Awaiting access';
  db.persist();
  res.json({ user: db.publicUser(user), onboarding: onboarding.status(db, req.access) });
});

/* ---------------------------------------------------------------------------
 * Organizations
 *
 * The workspace a firm shares. Creating one, listing the ones a person can
 * enter, and — for an administrator — managing who is in the one they are in.
 * Switching between them happens at Clerk in the browser, because the active
 * organization is part of the session; the server's job is to answer for
 * whichever one the session names.
 * ------------------------------------------------------------------------- */

const ORG_NAME_MAX = 100;

app.get('/api/organizations', requireUser, async (req, res) => {
  res.json({ workspaces: await workspacesFor(req.access), active: req.access.orgId });
});

/**
 * Create a firm's workspace.
 *
 * Authority over a new workspace and authority over an existing one are not
 * the same thing: creating one makes the creator its administrator and touches
 * nothing else. It never claims unowned legacy searches — mapping those is a
 * migration decision made with scripts/organizations.js, where somebody can
 * see what they are about to hand over.
 *
 * Who may do it at all is bounded in production (see `workspaceFounders` in
 * server/auth.js), because the sign-up page is reachable by anyone who has the
 * URL and a workspace nobody asked for is still a workspace.
 */
app.post('/api/organizations', requireUser, async (req, res) => {
  if (!auth.mayCreateWorkspace(req.user)) {
    return res.status(403).json({
      error: 'New workspaces are created by the operator of this deployment. '
        + 'If a firm invited you, ask them to send the invitation to ' + req.user.email + '.',
      code: 'WORKSPACE_CREATION_CLOSED'
    });
  }
  const name = String(req.body?.name || '').trim();
  if (!name || name.length > ORG_NAME_MAX) {
    return res.status(400).json({ error: 'Name the workspace (up to ' + ORG_NAME_MAX + ' characters).' });
  }
  const created = await auth.directory.createOrganization({
    name, createdByClerkUserId: req.access.clerkUserId, createdByEmail: req.user.email
  });
  organizations.rememberOrganization(db.db, { id: created.id, name: created.name, slug: created.slug, createdBy: req.user.id });
  organizations.rememberMembership(db.db, { orgId: created.id, userId: req.user.id, role: organizations.ADMIN });
  db.persist();
  // The session does not become active in the new workspace here: the browser
  // has to ask Clerk to switch, and the next request carries the result.
  res.json({ organization: created, role: organizations.ADMIN });
});

app.get('/api/organization', ...requireWorkspace, (req, res) => {
  res.json({
    organization: req.access.organization,
    role: req.access.role,
    roleLabel: organizations.ROLE_LABEL[req.access.role],
    capabilities: req.access.capabilities,
    roles: organizations.ROLES.map(r => ({ id: r, label: organizations.ROLE_LABEL[r], summary: organizations.ROLE_SUMMARY[r] }))
  });
});

/** The people in this workspace, and the invitations still out. */
app.get('/api/organization/members', ...requireOrgAdmin, async (req, res) => {
  const [members, invitations] = await Promise.all([
    auth.directory.members(req.access.orgId),
    auth.directory.invitations(req.access.orgId)
  ]);
  const rows = members.map(m => {
    const local = db.db.users.find(u => u.clerkUserId === m.clerkUserId)
      || (m.email ? db.findUserByEmail(m.email) : null);
    const supported = organizations.isSupportedRole(m.role);
    return {
      clerkUserId: m.clerkUserId,
      userId: local ? local.id : null,
      name: local?.name || m.name || m.email || 'Invited member',
      email: m.email || local?.email || '',
      role: m.role,
      roleLabel: supported ? organizations.ROLE_LABEL[m.role] : null,
      supported,
      you: m.clerkUserId === req.access.clerkUserId,
      // Assignments are Slate's side of the record. They say what removing this
      // person would actually end.
      searches: local ? db.db.searches.filter(s => s.organizationId === req.access.orgId && db.memberOf(s, local.id)).length : 0
    };
  }).sort((a, b) => a.name.localeCompare(b.name));
  res.json({
    members: rows,
    invitations: invitations.map(i => ({
      ...i,
      roleLabel: organizations.isSupportedRole(i.role) ? organizations.ROLE_LABEL[i.role] : null,
      // Places already held for this address, so revoking an invitation shows
      // what else it would strand.
      heldPlaces: organizations.pendingForEmail(db.db, i.email).filter(p => p.orgId === req.access.orgId).length
    })),
    admins: rows.filter(r => r.role === organizations.ADMIN).length
  });
});

app.post('/api/organization/invitations', ...requireOrgAdmin, async (req, res) => {
  const email = organizations.normalizeEmail(req.body?.email);
  const role = String(req.body?.role || '');
  if (!EMAIL_RE.test(email)) return res.status(400).json({ error: 'Enter the email this person will sign in with.' });
  if (!organizations.isSupportedRole(role)) {
    return res.status(400).json({ error: 'Choose the role this person will hold in this workspace.' });
  }
  const invitation = await auth.directory.invite(req.access.orgId, {
    email, role, inviterClerkUserId: req.access.clerkUserId,
    redirectUrl: auth.config.invitationRedirectUrl || undefined
  });
  res.json({
    invitation: { ...invitation, roleLabel: organizations.ROLE_LABEL[role], heldPlaces: organizations.pendingForEmail(db.db, email).filter(p => p.orgId === req.access.orgId).length },
    sent: true
  });
});

app.delete('/api/organization/invitations/:id', ...requireOrgAdmin, async (req, res) => {
  await auth.directory.revokeInvitation(req.access.orgId, String(req.params.id), req.access.clerkUserId);
  res.json({ ok: true });
});

/** Change somebody's role in this workspace. */
app.patch('/api/organization/members/:clerkUserId', ...requireOrgAdmin, async (req, res) => {
  const target = String(req.params.clerkUserId);
  const role = String(req.body?.role || '');
  if (!organizations.isSupportedRole(role)) return res.status(400).json({ error: 'Choose a role.' });
  const members = await auth.directory.members(req.access.orgId);
  const member = members.find(m => m.clerkUserId === target);
  if (!member) return res.status(404).json({ error: 'That person is not in this workspace.' });
  // A workspace with no administrator cannot invite anybody or repair itself.
  const admins = members.filter(m => m.role === organizations.ADMIN);
  if (member.role === organizations.ADMIN && role !== organizations.ADMIN && admins.length <= 1) {
    return res.status(409).json({ error: 'This workspace needs an administrator. Promote someone else first.' });
  }
  await auth.directory.setRole(req.access.orgId, target, role);
  const local = db.db.users.find(u => u.clerkUserId === target) || (member.email ? db.findUserByEmail(member.email) : null);
  if (local) {
    organizations.rememberMembership(db.db, { orgId: req.access.orgId, userId: local.id, role });
    db.persist();
  }
  res.json({ ok: true, role, roleLabel: organizations.ROLE_LABEL[role] });
});

/**
 * Remove somebody from the workspace.
 *
 * Their search assignments go with their membership, because one that outlives
 * the membership is access nobody can see. What they did stays: activity,
 * scores, and authorship name them exactly as before, which is why the account
 * is kept rather than deleted.
 */
app.delete('/api/organization/members/:clerkUserId', ...requireOrgAdmin, async (req, res) => {
  const target = String(req.params.clerkUserId);
  if (target === req.access.clerkUserId) {
    return res.status(409).json({ error: 'You cannot remove yourself. Ask another administrator.' });
  }
  const members = await auth.directory.members(req.access.orgId);
  const member = members.find(m => m.clerkUserId === target);
  if (!member) return res.status(404).json({ error: 'That person is not in this workspace.' });
  const admins = members.filter(m => m.role === organizations.ADMIN);
  if (member.role === organizations.ADMIN && admins.length <= 1) {
    return res.status(409).json({ error: 'This workspace needs an administrator. Promote someone else first.' });
  }

  const local = db.db.users.find(u => u.clerkUserId === target) || (member.email ? db.findUserByEmail(member.email) : null);
  // Checked before the provider call, so a search is never left managerless by
  // a removal that already succeeded at Clerk.
  const managed = local
    ? db.db.searches.filter(s => s.organizationId === req.access.orgId && db.accountManager(s)?.userId === local.id)
    : [];
  if (managed.length) {
    return res.status(409).json({
      error: (local.name || 'That person') + ' manages ' + managed.map(s => s.client || s.no).join(', ')
        + '. Hand ' + (managed.length === 1 ? 'that search' : 'those searches') + ' to someone else, then remove them.'
    });
  }

  await auth.directory.removeMember(req.access.orgId, target);

  let releasedPlaces = 0;
  if (local) {
    organizations.forgetMembership(db.db, req.access.orgId, local.id);
    for (const search of db.db.searches.filter(s => s.organizationId === req.access.orgId)) {
      if (!db.memberOf(search, local.id)) continue;
      search.members = search.members.filter(m => m.userId !== local.id);
      if (search.intake?.submissions) delete search.intake.submissions[local.id];
      db.touch(search, req.user, 'removed ' + local.name + ' from the search with their workspace access');
      releasedPlaces += 1;
    }
    db.db.pendingAssignments = db.db.pendingAssignments
      .filter(p => !(p.orgId === req.access.orgId && p.email === local.email));
    db.persist();
  }
  res.json({ ok: true, releasedPlaces });
});

app.get('/api/searches', ...requireWorkspace, (req, res) => {
  res.json(db.db.searches.filter(s => db.canView(s, req.access)).map(s => {
    const d = db.decorate(s, req.access);
    const searchRole = db.memberOf(s, req.user.id);
    const intake = s.intake || {};
    return {
      id:s.id, no:s.no, client:s.client, position:s.position, state:s.state, jurisdictionType:s.jurisdictionType,
      package: d.package, packageLabel: d.packageInfo.label,
      fog:s.fog, opened:s.opened, updatedAt:s.updatedAt,
      progress: d.progress,
      // Counts, so the portfolio can say how many people are on each file
      // without Home fetching every search in full. Nothing identifying is in
      // here; null means the package leaves screening off this file, which is
      // a different statement from nobody having applied.
      candidateCounts: db.candidateCounts(s),
      accountManager: d.accountManager ? { name: d.accountManager.name, init: d.accountManager.init } : null,
      people: (s.members || []).length,
      searchRole: searchRole ? searchRole.searchRole : null,
      // Home offers archiving across the book, so it needs the same answer the
      // archive route will give, per search rather than per person.
      mayArchive: authority.allows('archiveSearch', s, req.access),
      revision: s.revision,
      // Drives the "you owe them an answer" prompt on Home. A member should not
      // have to open every search to find the one waiting on them.
      intakeOpen: intake.status === 'open',
      intakeDue: intake.dueBy || '',
      intakeMine: Boolean(((intake.submissions || {})[req.user.id] || {}).submitted)
    };
  }).sort((a,b)=> (b.updatedAt||'').localeCompare(a.updatedAt||'')));
});

app.post('/api/searches', ...requireWorkspace, (req, res) => {
  if (!req.access.capabilities.createSearch) return res.status(403).json({ error:'A search consultant or an administrator opens a search in this workspace.' });
  const body = req.body || {};
  if (body.jurisdictionType !== undefined && (typeof body.jurisdictionType !== 'string' || !Object.hasOwn(jurisdictions.TYPES, body.jurisdictionType))) return res.status(400).json({ error:'Choose City or town, or County.' });
  if (!String(body.client || '').trim() || !String(body.position || '').trim()) {
    return res.status(400).json({ error:'Client and position are required.' });
  }
  if (body.package !== undefined && body.package !== '' && !Object.hasOwn(db.PACKAGES, body.package)) {
    return res.status(400).json({ error:'Pick a package: Basic, Enhanced, or Executive.' });
  }
  // Ownership comes from the verified session, never from the submitted body.
  const s = db.blankSearch(body, req.user, req.access.orgId);
  s.no = db.nextNo();
  db.db.searches.unshift(s);
  db.persist();
  res.json(painted(req, s));
});

app.get('/api/searches/:id', ...requireWorkspace, requireSearch, (req, res) => {
  res.json(painted(req, req.search));
});

/* ---------------------------------------------------------------------------
 * Step 1 — the roster
 *
 * A search has one account manager and any number of consultants and committee
 * members. Adding someone who has no account creates an email-only sign-in.
 * ------------------------------------------------------------------------- */

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * The roster, plus the places that are held but not yet filled.
 *
 * Three states are shown separately because they need three different actions:
 * an active assignment (accepted membership and a place), an assignment waiting
 * on somebody to accept an organization invitation, and a place a manager has
 * proposed for an address nobody has invited yet. The last one says
 * "Invitation needed" rather than implying an email went out.
 */
function rosterOnly(search){
  return {
    roster: db.roster(search),
    accountManager: db.accountManager(search),
    pending: heldPlaces(search)
  };
}

function heldPlaces(search){
  return organizations.pendingFor(db.db, search.organizationId, search.id).map(p => ({
    id: p.id, email: p.email, name: p.name, searchRole: p.searchRole,
    status: p.invitationId ? 'invitation-sent' : 'invitation-needed',
    createdAt: p.createdAt
  }));
}

/**
 * Add somebody to this search.
 *
 * A place is only ever given to a member of the firm that owns the search.
 * Somebody outside it gets a held place instead, waiting on an organization
 * invitation: an administrator sending that invitation is a separate authority
 * from a manager rostering a committee, and pretending otherwise would let a
 * search manager add people to the firm. Where the manager is also an
 * administrator the two steps happen together, and the response says which of
 * them actually occurred.
 */
app.post('/api/searches/:id/members', ...requireWorkspace, requireSearch, requireManager, async (req, res) => {
  const b = req.body || {};
  const searchRole = committee.searchRoleOf(b.searchRole);
  const name = String(b.name || '').trim();
  const email = organizations.normalizeEmail(b.email);
  if (!name) return res.status(400).json({ error:'Name is required.' });
  if (!EMAIL_RE.test(email)) return res.status(400).json({ error:'Enter a working email. It is their sign-in.' });
  if (searchRole === 'manager') {
    return res.status(400).json({ error:'Add them first, then hand over the account.' });
  }

  const orgId = req.access.orgId;
  const existing = db.findUserByEmail(email);
  if (existing && String(existing.name || '').trim() !== name) {
    return res.status(409).json({
      error: email + ' already signs in as ' + existing.name + '. Add them under that name, or use a different email.'
    });
  }
  if (existing && db.memberOf(req.search, existing.id)) {
    return res.status(409).json({ error: name + ' is already on this search.' });
  }

  // Membership in the owning organization is what separates a place from a held
  // one, and it is read from the provider rather than from the local cache so
  // that somebody removed at Clerk cannot be added straight back in. The
  // lookup falls back to the email because a colleague can be in the firm's
  // Clerk organization without ever having opened Slate.
  let member = existing?.clerkUserId
    ? await auth.directory.membership(orgId, existing.clerkUserId)
    : null;
  if (!member) {
    member = (await auth.directory.members(orgId)).find(m => m.email === email) || null;
  }

  if (member && organizations.isSupportedRole(member.role)) {
    if (searchRole === 'consultant' && !organizations.capabilitiesFor(member.role).staff) {
      return res.status(400).json({ error: name + ' is a committee member in this workspace. Change their role first, or add them to the committee.' });
    }
    // A verified member of this workspace who has no Slate account yet gets
    // one now. Their Clerk identity binds to it on their first request, which
    // is the same path every other account takes.
    const person = existing || db.createUser({ name, email, title: b.title, role: 'committee' }).user;
    req.search.members.push({ userId: person.id, searchRole, addedAt: db.now(), addedBy: req.user.id });
    // The roster changed, so a confirmation given before this person joined no
    // longer describes the committee. Ask for it again.
    req.search.team = { confirmedAt: null, confirmedBy: null };
    db.touch(req.search, req.user, 'added ' + name + ' as ' + committee.SEARCH_ROLE_LABEL[searchRole].toLowerCase());
    db.persist();
    return res.json({ search: painted(req, req.search), ...rosterOnly(req.search), email, added: true });
  }

  if (searchRole !== 'committee') {
    return res.status(400).json({ error: 'The consultant role goes to somebody already in this workspace. Invite them from Team & access first.' });
  }

  let invitation = null;
  let inviteError = null;
  if (req.access.capabilities.inviteMembers) {
    try {
      invitation = await auth.directory.invite(orgId, {
        email, role: organizations.COMMITTEE, inviterClerkUserId: req.access.clerkUserId,
        redirectUrl: auth.config.invitationRedirectUrl || undefined
      });
    } catch (error) {
      // An address that already has an invitation out is not a failure of this
      // request: the held place is still worth recording against it.
      if (error?.code !== 'DIRECTORY_REJECTED') throw error;
      inviteError = error.message;
    }
  }

  const held = organizations.addPendingAssignment(db.db, {
    orgId, searchId: req.search.id, email, name, searchRole,
    invitedBy: req.user.id, invitationId: invitation?.id || null
  });
  db.touch(req.search, req.user, invitation
    ? 'invited ' + name + ' to the workspace and held a committee place'
    : 'held a committee place for ' + name + ', pending a workspace invitation');
  db.persist();
  res.json({
    search: painted(req, req.search), ...rosterOnly(req.search), email,
    added: false,
    // Said plainly, because "pending" without this is indistinguishable from an
    // email that was actually sent.
    invitationSent: Boolean(invitation),
    invitationNeeded: !invitation,
    note: invitation
      ? 'An invitation was sent to ' + email + '. They join the search when they accept it.'
      : (inviteError || 'A place is held for ' + email + '. An organization administrator must invite them before they can join.')
  });
});

/** Release a held place that has not been taken up. */
app.delete('/api/searches/:id/members/pending/:pid', ...requireWorkspace, requireSearch, requireManager, (req, res) => {
  const held = organizations.pendingFor(db.db, req.access.orgId, req.search.id).find(p => p.id === req.params.pid);
  if (!held) return res.status(404).json({ error:'That pending person is no longer waiting.' });
  organizations.removePendingAssignment(db.db, held.id);
  db.touch(req.search, req.user, 'released the held place for ' + (held.name || held.email));
  db.persist();
  // Deliberately does not revoke the organization invitation: being invited to
  // the firm and being on one search are different decisions, and this
  // route only undoes the second.
  res.json({ search: painted(req, req.search), ...rosterOnly(req.search) });
});

// Role changes. Handing over or claiming the account is open to any consultant
// on the file: who runs an account is a firm decision, not a wall between
// colleagues, and gating it on the current manager leaves a search stranded
// whenever that person is unavailable. Every other roster change stays with the
// manager.
// A consultant putting themselves on a search they can already see. Needed
// because the roster is otherwise the manager's job, which would leave a
// colleague unable to join a file in order to pick it up.
app.post('/api/searches/:id/members/self', ...requireWorkspace, requireSearch, requireEditor, (req, res) => {
  if (db.memberOf(req.search, req.user.id)) {
    return res.status(409).json({ error:'You are already on this search.' });
  }
  req.search.members.push({ userId: req.user.id, searchRole: 'consultant', addedAt: db.now(), addedBy: req.user.id });
  db.touch(req.search, req.user, 'joined the search');
  db.persist();
  res.json({ search: painted(req, req.search), ...rosterOnly(req.search) });
});

app.patch('/api/searches/:id/members/:uid', ...requireWorkspace, requireSearch, requireEditor, (req, res) => {
  const m = db.memberOf(req.search, req.params.uid);
  if (!m) return res.status(404).json({ error:'That person is not on this search.' });
  const searchRole = committee.searchRoleOf(req.body?.searchRole);
  const user = db.findUserById(m.userId);

  if (searchRole === 'manager') {
    if (!db.isStaffOf(user.id, req.access.orgId)) {
      return res.status(400).json({ error:'The account manager is a consultant or administrator in this workspace.' });
    }
    // Handover is the one move that changes who holds every other late-stage
    // decision, so it cannot be a move anybody can make. Without this, a
    // consultant refused a closeout could simply take the account and close the
    // search anyway, and the whole matrix would be advisory.
    const refusal = authority.refusalFor('handoverManager', req.search, req.access);
    if (refusal) return res.status(refusal.status).json(refusal);
    const reason = String(req.body?.reason || '').trim().slice(0, 600);
    // An administrator reassigning a search they do not run is the emergency
    // path. It is allowed, and it is never silent: it says why, on the file.
    const reassignment = !db.canManage(req.search, req.access);
    if (reassignment && !reason) {
      return res.status(400).json({
        error: 'Record why this account is being reassigned. An administrator taking a search from its manager is written down.',
        code: 'REASON_REQUIRED'
      });
    }
    // Exactly one manager. The outgoing one stays on the search as a
    // consultant rather than losing their place.
    const outgoing = db.accountManager(req.search);
    const outgoingName = outgoing ? (db.findUserById(outgoing.userId)?.name || 'the previous manager') : '';
    for (const other of req.search.members) {
      if (other.searchRole === 'manager') other.searchRole = 'consultant';
    }
    m.searchRole = 'manager';
    db.touch(req.search, req.user, (reassignment
      ? 'reassigned the account from ' + outgoingName + ' to ' + user.name
      : 'handed the account to ' + user.name) + (reason ? ': ' + reason : ''));
  } else {
    if (!db.canManage(req.search, req.access)) {
      const mgr = db.accountManager(req.search);
      const who = mgr ? (db.findUserById(mgr.userId)?.name || 'the account manager') : 'the account manager';
      return res.status(403).json({ error: who + ' runs this search. Take the account first, or ask them.' });
    }
    if (m.searchRole === 'manager') {
      return res.status(400).json({ error:'Hand the account to someone else first. A search always has a manager.' });
    }
    if (searchRole === 'consultant' && !db.isStaffOf(user.id, req.access.orgId)) {
      return res.status(400).json({ error:'Only this workspace\u2019s consultants and administrators can be added as a consultant.' });
    }
    m.searchRole = searchRole;
    db.touch(req.search, req.user, 'moved ' + user.name + ' to ' + committee.SEARCH_ROLE_LABEL[searchRole].toLowerCase());
  }
  db.persist();
  res.json({ search: painted(req, req.search), ...rosterOnly(req.search) });
});

app.delete('/api/searches/:id/members/:uid', ...requireWorkspace, requireSearch, requireManager, (req, res) => {
  const m = db.memberOf(req.search, req.params.uid);
  if (!m) return res.status(404).json({ error:'That person is not on this search.' });
  if (m.searchRole === 'manager') {
    return res.status(400).json({ error:'Hand the account to someone else before leaving the search.' });
  }
  const user = db.findUserById(m.userId);
  req.search.members = req.search.members.filter(x => x.userId !== m.userId);
  // Their answers leave with them. Consensus counts people who are still on
  // the committee, so a departed member cannot keep voting.
  if (req.search.intake?.submissions) delete req.search.intake.submissions[m.userId];
  db.touch(req.search, req.user, 'removed ' + (user ? user.name : 'a member') + ' from the search');
  // If this was their only assignment, their sign-in goes with it.
  db.pruneOrphanCommittee();
  db.persist();
  res.json({ search: painted(req, req.search), ...rosterOnly(req.search) });
});

app.post('/api/searches/:id/team/confirm', ...requireWorkspace, requireSearch, requireManager, (req, res) => {
  const confirm = req.body?.confirmed !== false;
  req.search.team = confirm
    ? { confirmedAt: db.now(), confirmedBy: req.user.id }
    : { confirmedAt: null, confirmedBy: null };
  db.touch(req.search, req.user, confirm ? 'confirmed the search committee roster' : 'reopened the roster');
  db.persist();
  res.json(painted(req, req.search));
});

/* ---------------------------------------------------------------------------
 * Step 2 — intake
 *
 * Everyone on the search answers privately. The manager opens the window, watches
 * who has answered (never what they said), and closes it when the committee
 * has spoken. Closing is what publishes consensus to the room.
 * ------------------------------------------------------------------------- */

app.post('/api/searches/:id/intake/status', ...requireWorkspace, requireSearch, requireManager, (req, res) => {
  const want = String(req.body?.status || '');
  if (!['draft', 'open', 'closed'].includes(want)) {
    return res.status(400).json({ error:'Intake is draft, open, or closed.' });
  }
  if (want === 'open' && !req.search.team?.confirmedAt) {
    return res.status(400).json({ error:'Confirm the roster first. People added later would miss the window.' });
  }
  const intake = req.search.intake;
  intake.status = want;
  if ('dueBy' in (req.body || {})) intake.dueBy = String(req.body.dueBy || '').slice(0, 120);
  if ('prompt' in (req.body || {})) intake.prompt = String(req.body.prompt || '').slice(0, 2000);
  if (want === 'open') { intake.openedAt = db.now(); intake.closedAt = null; }
  if (want === 'closed') intake.closedAt = db.now();
  db.touch(req.search, req.user,
    want === 'open' ? 'opened committee intake' :
    want === 'closed' ? 'closed committee intake' : 'put committee intake back in draft');
  db.persist();
  res.json(painted(req, req.search));
});

app.put('/api/searches/:id/intake', ...requireWorkspace, requireSearch, (req, res) => {
  const searchRole = db.memberOf(req.search, req.user.id);
  if (!searchRole) return res.status(403).json({ error:'You are not on this search.' });
  if (!committee.INTAKE_ROLES.has(committee.searchRoleOf(searchRole.searchRole))) {
    return res.status(403).json({ error:'Your role on this search does not answer intake.' });
  }
  const intake = req.search.intake;
  if (intake.status !== 'open') {
    return res.status(400).json({
      error: intake.status === 'closed'
        ? 'Intake is closed. Ask the account manager to reopen it.'
        : 'Intake has not opened yet.'
    });
  }
  const prev = intake.submissions[req.user.id] || null;
  const next = committee.normalizeSubmission(req.body, prev, db.now());
  if (next.submitted && !next.items.length) {
    return res.status(400).json({ error:'Name at least one quality before you submit.' });
  }
  intake.submissions[req.user.id] = next;
  const first = !prev || !prev.submitted;
  if (next.submitted) {
    db.touch(req.search, req.user, first ? 'submitted committee input' : 'revised their committee input');
  } else {
    req.search.updatedAt = db.now();
  }
  db.persist();
  res.json(painted(req, req.search));
});

app.post('/api/searches/:id/intake/adopt', ...requireWorkspace, requireSearch, requireManager, (req, res) => {
  const agg = committee.aggregate(req.search, id => db.findUserById(id)?.name || '');
  if (!agg.submitted) {
    return res.status(400).json({ error:'No committee input on file yet. Nothing to adopt.' });
  }
  req.search.criteria = committee.mergeIntoCriteria(req.search.criteria, agg);
  db.touch(req.search, req.user, 'built the profile from ' + agg.submitted + ' committee submissions');
  db.persist();
  res.json({ search: painted(req, req.search), gaps: committee.adoptionGaps(agg) });
});

function removeSearch(search){
  search.archivedAt = db.now();
  // Held places belong to a live search. Archiving one would otherwise leave an
  // invitation that adds somebody to a file nobody can open.
  organizations.clearPendingForSearch(db.db, search.id);
  search.archivedUsers = db.db.users.filter(u => (search.members || []).some(m => m.userId === u.id) && u.role === 'committee').map(integrity.clone);
  db.db.archivedSearches.push(search);
  db.db.searches = db.db.searches.filter(s => s.id !== search.id);
}

app.post('/api/account/start-fresh', ...requireWorkspace, (req, res) => {
  if (!db.isStaff(req.access)) return res.status(403).json({ error:'Only a consultant can archive managed searches.' });
  const ids = req.body?.ids;
  if (!Array.isArray(ids) || !ids.length || ids.some(id => typeof id !== 'string') || new Set(ids).size !== ids.length) {
    return res.status(400).json({ error:'Confirm the searches to archive.' });
  }
  // Confirm exactly the managed searches shown to this person. New searches or
  // a reassigned manager must prompt a fresh review, never expand the reset.
  const searches = db.db.searches.filter(s => s.organizationId === req.access.orgId
    && db.accountManager(s)?.userId === req.user.id);
  if (searches.length !== ids.length || searches.some(s => !ids.includes(s.id))) {
    return res.status(409).json({ error:'Your managed searches changed. Refresh Home and review them before starting fresh.' });
  }
  for (const s of searches) {
    db.touch(s, req.user, 'archived the search to start fresh');
    removeSearch(s);
  }
  // Keep account identities so a committee member signing in while their
  // search is archived cannot create a conflicting account on restoration.
  db.persist();
  res.json({ ok:true, archived:searches.length, ids });
});

// The archive is part of a firm's book of business, so it is scoped exactly
// like the live one: another workspace's archived search is not listed, not
// restorable, and not distinguishable from one that does not exist.
app.get('/api/archives', ...requireWorkspace, (req, res) => {
  if (!db.isStaff(req.access)) return res.status(403).json({ error:'A consultant manages archived searches.' });
  res.json(db.db.archivedSearches
    .filter(s => s.organizationId === req.access.orgId)
    // Whether this reader can take it back out, so the list can say who to ask
    // instead of offering a button that will be refused. The manager's name
    // comes with it for exactly that sentence; the roster itself does not,
    // because the listing is an index rather than a way to read a filed search.
    .map(s => {
      const mgr = db.accountManager(s);
      return {
        id:s.id, no:s.no, client:s.client, position:s.position, archivedAt:s.archivedAt,
        mayRestore: authority.allows('restoreArchive', s, req.access),
        managerName: mgr ? (db.findUserById(mgr.userId)?.name || '') : ''
      };
    }));
});

// Restoring is the alternate way back into a search file, so it answers to the
// same table as everything else that reaches one. The archived record still
// carries its roster, which is what `canManage` reads: the person who ran the
// search before it was filed away is the person who takes it back out.
app.post('/api/archives/:id/restore', ...requireWorkspace, (req, res) => {
  // Ahead of the lookup, as it was before: somebody who cannot see the archive
  // at all must not be able to tell a real archived id from an invented one by
  // reading which refusal comes back.
  if (!db.isStaff(req.access)) return res.status(403).json({ error:'A consultant manages archived searches.' });
  const s = db.db.archivedSearches.find(s => s.id === req.params.id && s.organizationId === req.access.orgId);
  if (!s) return res.status(404).json({ error:'Archived search not found.' });
  const refusal = authority.refusalFor('restoreArchive', s, req.access);
  if (refusal) return res.status(refusal.status).json(refusal);
  for (const u of s.archivedUsers || []) {
    const current = db.findUserByEmail(u.email);
    if (current && current.id !== u.id) return res.status(409).json({ error:'A different account now uses ' + u.email + '. Resolve that account conflict before restoring this roster.' });
  }
  for (const u of s.archivedUsers || []) if (!db.findUserById(u.id)) db.db.users.push(u);
  delete s.archivedUsers;
  delete s.archivedAt;
  // Restoring the file never grants candidate access, including for archives
  // written by older releases that still contain invitation tokens.
  for (const c of s.candidates || []) c.invite = null;
  db.db.archivedSearches = db.db.archivedSearches.filter(x => x.id !== s.id);
  db.db.searches.push(s);
  db.touch(s, req.user, 'restored the search; candidate invitation links remain revoked');
  db.persist();
  res.json(painted(req, s));
});

/**
 * The complete record of one search, for county records review.
 *
 * requireEditor, so a committee member cannot obtain through an export what
 * they cannot read in the application. The export is a different format for
 * the same authority, never a wider one.
 *
 * ?format=text returns the readable report; the default is the machine-readable
 * bundle. Both come from one build so they cannot drift apart.
 */
/**
 * Record the county's authority facts and who confirmed them.
 *
 * Deliberately separate from the AI-drafted material. A draft can suggest what
 * to ask; only a person can confirm who appoints the administrator or which
 * offices are separately elected, and the record has to show which of the two
 * happened.
 */
/* ---------------------------------------------------------------------------
 * Candidate documents and communications (DEP-08)
 *
 * Both are staff-recorded. Slate stores references and a contact log; it does
 * not hold resumes and does not send messages.
 * ------------------------------------------------------------------------- */

/* ---------------------------------------------------------------------------
 * Disposition and closeout (DEP-09)
 * ------------------------------------------------------------------------- */

/** Record an outcome for one candidate. */
app.post('/api/searches/:id/candidates/:cid/disposition', ...requireWorkspace, requireSearch, requireEditor, authority.requireAuthority('recordOutcome'), (req, res) => {
  const candidate = candidateOr404(req, res);
  if (!candidate) return;

  const invalid = disposition.validateDisposition(req.body);
  if (invalid) return res.status(400).json({ error: invalid });

  const entry = disposition.recordDisposition(candidate, req.body, req.user);

  // An outcome that ends someone's participation ends their submission access
  // with it. Leaving a live bearer link on a withdrawn candidate means a URL
  // that still opens a questionnaire nobody will read.
  if (disposition.OUTCOMES[entry.outcome].revokesAccess) {
    candidate.invite = null;
    candidate.inviteRevokedAt = entry.at;
  }

  db.touch(req.search, req.user,
    (entry.supersedes ? 'corrected the outcome for ' : 'recorded ' + disposition.OUTCOMES[entry.outcome].label + ' for ') + candidate.name);
  db.persist();
  res.json(painted(req, req.search));
});

/** Close or cancel the search. */
app.post('/api/searches/:id/close', ...requireWorkspace, requireSearch, requireEditor, authority.requireAuthority('closeSearch'), (req, res) => {
  if (disposition.isFrozen(req.search)) {
    return res.status(409).json({ error: 'This search is already ' + disposition.lifecycleOf(req.search) + '.' });
  }
  const invalid = disposition.validateClose(req.body);
  if (invalid) return res.status(400).json({ error: invalid });

  const entry = disposition.close(req.search, req.body, req.user);

  // Closing stops submissions. Every outstanding link is revoked here rather
  // than left to expire, so a questionnaire cannot be filled in against a
  // search that has concluded.
  let revoked = 0;
  for (const candidate of req.search.candidates || []) {
    if (candidate.invite) { candidate.invite = null; candidate.inviteRevokedAt = entry.at; revoked += 1; }
  }

  db.touch(req.search, req.user, entry.status === 'cancelled' ? 'cancelled the search' : 'closed the search');
  db.persist();
  res.json({ search: painted(req, req.search), summary: disposition.summary(req.search), linksRevoked: revoked });
});

/** Reopen a closed search, deliberately and with a reason. */
app.post('/api/searches/:id/reopen', ...requireWorkspace, requireSearch, requireEditor, authority.requireAuthority('reopenSearch'), (req, res) => {
  if (!disposition.isFrozen(req.search)) {
    return res.status(409).json({ error: 'This search is already active.' });
  }
  const reason = String(req.body?.reason || '').trim();
  if (!reason) return res.status(400).json({ error: 'Record why the search is being reopened.' });

  disposition.reopen(req.search, { reason }, req.user);
  db.touch(req.search, req.user, 'reopened the search');
  db.persist();
  // Links revoked at closeout stay revoked. Reissuing one is a separate act,
  // so reopening never puts an old bearer URL back into circulation.
  res.json({ search: painted(req, req.search), linksRestored: false });
});

/** How the search concluded. */
app.get('/api/searches/:id/disposition', ...requireWorkspace, requireSearch, requireEditor, (req, res) => {
  res.json(disposition.summary(req.search));
});


/**
 * Stop an AI call before it is made if it would breach a limit.
 *
 * Checked ahead of the request because the point is to prevent the spend. A
 * refusal here is not an application error: manual work is unaffected.
 */
function withinAiBudget(req, res, next){
  const verdict = aibudget.check(req.search?.id);
  if (verdict.ok) return next();
  telemetry.log.warn('ai-budget-refused', { code: verdict.code, route: 'ai' });
  res.set('Retry-After', '900');
  return res.status(429).json({ error: verdict.error, code: verdict.code });
}

function candidateOr404(req, res){
  const candidate = (req.search.candidates || []).find(c => c.id === req.params.cid);
  if (!candidate) { res.status(404).json({ error: 'Candidate not found.' }); return null; }
  return candidate;
}

app.post('/api/searches/:id/candidates/:cid/documents', ...requireWorkspace, requireSearch, requireEditor, (req, res) => {
  const candidate = candidateOr404(req, res);
  if (!candidate) return;

  const invalid = candidates.validateDocument(req.body);
  if (invalid) return res.status(400).json({ error: invalid });

  const record = candidates.addDocument(candidate, req.body, req.user);
  db.touch(req.search, req.user, 'recorded a ' + record.kind + ' for ' + candidate.name);
  db.persist();
  res.json(painted(req, req.search));
});

app.delete('/api/searches/:id/candidates/:cid/documents/:docId', ...requireWorkspace, requireSearch, requireEditor, (req, res) => {
  const candidate = candidateOr404(req, res);
  if (!candidate) return;

  const before = (candidate.documents || []).length;
  candidate.documents = (candidate.documents || []).filter(d => d.id !== req.params.docId);
  if (candidate.documents.length === before) return res.status(404).json({ error: 'Document not found.' });

  db.touch(req.search, req.user, 'removed a document reference for ' + candidate.name);
  db.persist();
  res.json(painted(req, req.search));
});

app.post('/api/searches/:id/candidates/:cid/communications', ...requireWorkspace, requireSearch, requireEditor, (req, res) => {
  const candidate = candidateOr404(req, res);
  if (!candidate) return;

  const invalid = candidates.validateCommunication(req.body);
  if (invalid) return res.status(400).json({ error: invalid });

  const record = candidates.addCommunication(candidate, req.body, req.user);
  db.touch(req.search, req.user, 'logged ' + record.channel + ' contact with ' + candidate.name);
  db.persist();
  res.json(painted(req, req.search));
});

/** Who has not been contacted, and whose follow-up date has passed. */
app.get('/api/searches/:id/follow-ups', ...requireWorkspace, requireSearch, requireEditor, (req, res) => {
  res.json(candidates.followUps(req.search));
});

app.put('/api/searches/:id/verification', ...requireWorkspace, requireSearch, requireEditor, (req, res) => {
  const invalid = jurisdictions.validateVerification(req.body);
  if (invalid) return res.status(400).json({ error: invalid });

  const existing = req.search.verification || {};
  const merged = { ...existing };
  for (const [key, record] of Object.entries(req.body || {})) {
    const previous = existing[key] || {};
    const next = { ...previous, ...record };
    // Confirmation is stamped by the server. A client cannot backdate who
    // confirmed a fact or when.
    const changed = ['value', 'source', 'asOf', 'confirmedBy'].some(f => (previous[f] || '') !== (next[f] || ''));
    if (changed) {
      next.confirmedAt = next.confirmedBy ? db.now() : '';
      next.recordedBy = req.user.id;
    }
    merged[key] = next;
  }

  req.search.verification = merged;
  db.touch(req.search, req.user, 'recorded county facts');
  db.persist();
  res.json(painted(req, req.search));
});

app.get('/api/searches/:id/export', ...requireWorkspace, requireSearch, requireEditor, authority.requireAuthority('exportRecords'), (req, res) => {
  const bundle = exporter.build(req.search, {
    viewer: req.user,
    users: db.db.users,
    dataDir: db.DATA_DIR,
    release: RELEASE
  });

  db.touch(req.search, req.user, 'exported the search record');
  db.persist();

  const stem = 'slate-' + (req.search.no || req.search.id);
  if (req.query.format === 'text') {
    res.type('text/plain; charset=utf-8');
    res.set('Content-Disposition', 'attachment; filename="' + stem + '.txt"');
    return res.send(exporter.report(bundle));
  }
  res.set('Content-Disposition', 'attachment; filename="' + stem + '.json"');
  res.json(bundle);
});

app.get('/api/searches/:id/history', ...requireWorkspace, requireSearch, requireEditor, (req, res) => {
  const history = (req.search.history || []).map(entry => {
    if (!entry.scores && !entry.notesBy) return entry;
    const visible = entry.released || (entry.revision === req.search.profileRevision && req.search.released);
    if (visible) return entry;
    return { ...entry, scores:{ [req.user.id]:entry.scores?.[req.user.id] || {} }, notesBy:{ [req.user.id]:entry.notesBy?.[req.user.id] || {} } };
  });
  res.json({ history, activity: req.search.activity || [] });
});

app.post('/api/searches/:id/history/:entry/restore', ...requireWorkspace, requireSearch, requireEditor, authority.requireAuthority('restoreHistory'), (req, res) => {
  const entry = /^\d+$/.test(req.params.entry) && req.search.history[Number(req.params.entry)];
  if (!entry || !['artifact', 'profile', 'facts'].includes(entry.kind)) return res.status(400).json({ error:'Choose a saved document, profile, or search facts.' });
  if (entry.kind === 'artifact') {
    if (!inPackage(req.search, entry.key)) return res.status(400).json({ error:outsidePackage(req.search, entry.key) });
    req.search.artifacts[entry.key] = integrity.clone(entry.body);
  } else if (entry.kind === 'profile') req.search.criteria = integrity.clone(entry.criteria);
  else Object.assign(req.search, integrity.clone(entry.body));
  db.touch(req.search, req.user, 'restored saved ' + (entry.key || entry.kind) + ' from ' + entry.at);
  db.persist();
  res.json(painted(req, req.search));
});

app.post('/api/searches/bulk-delete', ...requireWorkspace, (req, res) => {
  const raw = Array.isArray(req.body?.ids) ? req.body.ids : [];
  const ids = [...new Set(raw.map(id => String(id || '').trim()).filter(Boolean))];
  if (!ids.length) return res.status(400).json({ error:'Pick at least one search.' });
  // Archiving in bulk is archiving, one search at a time, and each one needs
  // its own manager's authority. A batch is refused whole rather than partly
  // applied: a request that archives four of five searches and reports success
  // leaves the caller no way to tell which four.
  const refused = [];
  for (const id of ids) {
    const s = db.db.searches.find(x => x.id === id);
    if (!s || !db.canView(s, req.access)) continue;
    if (!authority.allows('archiveSearch', s, req.access)) refused.push(s);
  }
  if (refused.length) {
    return res.status(403).json({
      code: 'AUTHORITY_REQUIRED', action: 'archiveSearch', requires: 'manager',
      error: 'You do not run ' + (refused.length === 1
        ? refused[0].client + ' · ' + refused[0].position
        : refused.length + ' of the searches you picked') + '. Archiving a search is its manager’s decision. Nothing was archived.'
    });
  }
  const deleted = [];
  for (const id of ids) {
    const s = db.db.searches.find(x => x.id === id);
    if (!s || !db.canEdit(s, req.access)) continue;
    removeSearch(s);
    deleted.push(id);
  }
  if (!deleted.length) return res.status(404).json({ error:'None of those searches are on the book.' });
  db.pruneOrphanCommittee();
  db.persist();
  res.json({ ok:true, deleted: deleted.length, ids: deleted });
});

app.delete('/api/searches/:id', ...requireWorkspace, requireSearch, requireEditor, authority.requireAuthority('archiveSearch'), (req, res) => {
  // Research in flight is stopped and its history goes with the search, so a
  // deleted record leaves no job pointing at an id nobody can read.
  jobs.dropForSearch(req.search.id);
  removeSearch(req.search);
  // Committee accounts existed for this search. With it gone they are live
  // sign-ins to nothing, so they go too.
  db.pruneOrphanCommittee();
  db.persist();
  res.json({ ok:true, id: req.search.id });
});

// The generic facts path carries one field that is not a fact: `released`
// decides whether the committee's private scores become visible to each other
// and to an export. It needs its own authority, and it needs it here rather
// than only on whichever button the client draws, because this route is the
// route — sending `{ released: true }` to it is the whole action.
const PATCH_FIELDS = [
  'jurisdictionType',
  'client', 'position', 'state', 'website', 'fog', 'population', 'budget', 'salary', 'opened', 'firstReview', 'notes',
  { key: 'released', action: 'releaseScores' }
];

app.patch('/api/searches/:id', ...requireWorkspace, requireSearch, requireEditor, (req, res) => {
  const body = req.body || {};
  if ('jurisdictionType' in body && (typeof body.jurisdictionType !== 'string' || !Object.hasOwn(jurisdictions.TYPES, body.jurisdictionType))) return res.status(400).json({ error:'Choose City or town, or County.' });
  if ('package' in body && !Object.hasOwn(db.PACKAGES, body.package)) return res.status(400).json({ error:'Pick a package: Basic, Enhanced, or Executive.' });
  for (const key of PATCH_FIELDS.filter(f => typeof f === 'string')) {
    if (key in body && (typeof body[key] !== 'string' || body[key].length > 20000)) return res.status(400).json({ error:'Search facts must be text, no longer than 20,000 characters.' });
  }
  if ('released' in body && typeof body.released !== 'boolean') return res.status(400).json({ error:'Released must be true or false.' });
  for (const f of PATCH_FIELDS) {
    if (typeof f !== 'object' || !f.action) continue;
    if (!(f.key in body) || body[f.key] === req.search[f.key]) continue;
    const refusal = authority.refusalFor(f.action, req.search, req.access);
    if (refusal) return res.status(refusal.status).json(refusal);
  }
  for (const f of PATCH_FIELDS) {
    const key = typeof f === 'string' ? f : f.key;
    if (key === 'jurisdictionType' && key in body && body[key] !== req.search[key]) {
      const oldDefault = jurisdictions.TYPES[jurisdictions.typeOf(req.search[key])].governmentPlaceholder;
      if ((body.fog ?? req.search.fog) === oldDefault) body.fog = jurisdictions.TYPES[body[key]].governmentPlaceholder;
    }
    if (key in body) req.search[key] = body[key];
  }
  // The package is a commercial term, so it is changed deliberately and shows
  // up in the activity feed by name rather than folded into "updated facts".
  if ('package' in body) {
    if (!db.PACKAGES[body.package]) {
      return res.status(400).json({ error:'Pick a package: Basic, Enhanced, or Executive.' });
    }
    if (body.package !== req.search.package) {
      req.search.package = body.package;
      db.touch(req.search, req.user, 'moved the engagement to the ' + db.PACKAGES[body.package].label + ' package');
    }
  }
  db.touch(req.search, req.user, 'updated search facts');
  db.persist();
  res.json(painted(req, req.search));
});

app.put('/api/searches/:id/profile', ...requireWorkspace, requireSearch, requireEditor, (req, res) => {
  const criteria = Array.isArray(req.body?.criteria) ? req.body.criteria : [];
  if (criteria.some(c => !c || typeof c !== 'object')) return res.status(400).json({ error:'Invalid profile criterion.' });
  const next = criteria.map((c,i) => ({
    id: c.id || ('X'+(i+1)),
    kind: c.kind || 'skill',
    label: String(c.label||'').trim(),
    weight: clampWeight(c.weight),
    note: String(c.note||''),
    // Kept so the profile page can still show which lines came out of the
    // committee's own words after the consultant has edited around them.
    from: CRIT_SOURCES.has(c.from) ? c.from : 'consultant'
  })).filter(c=>c.label);
  const error = integrity.validateCriteria(next);
  if (error) return res.status(400).json({ error });
  req.search.criteria = next;
  db.touch(req.search, req.user, 'saved the candidate profile');
  db.persist();
  res.json(painted(req, req.search));
});

function clearReview(search, key){
  if (search.reviews) delete search.reviews[key];
}

app.put('/api/searches/:id/artifact/:key', ...requireWorkspace, requireSearch, requireEditor, artifactOnFile, (req, res) => {
  if (!ARTIFACTS.has(req.params.key)) return res.status(400).json({ error:'Unknown artifact.' });
  const incoming = req.body?.body ?? req.body;
  if (!incoming || typeof incoming !== 'object' || Array.isArray(incoming)) return res.status(400).json({ error:'Provide an artifact object.' });
  if (['survey1', 'survey2'].includes(req.params.key)) {
    const error = integrity.validateSurvey(incoming);
    if (error) return res.status(400).json({ error });
  }
  if (req.params.key === 'brochure') {
    const prev = req.search.artifacts.brochure || {};
    const next = incoming && typeof incoming === 'object' ? incoming : {};
    req.search.artifacts.brochure = applyBrochureDefaults(next, prev);
  } else {
    req.search.artifacts[req.params.key] = incoming;
  }
  clearReview(req.search, req.params.key);
  db.touch(req.search, req.user, 'saved '+req.params.key);
  db.persist();
  res.json(painted(req, req.search));
});

// Signing off on recruiting copy is the firm’s ordinary work. It used to read
// the legacy account-level role, which only the seeded accounts carry: a
// consultant invited into a workspace today was refused by it.
app.post('/api/searches/:id/artifact/:key/review', ...requireWorkspace, requireSearch, requireEditor, authority.requireAuthority('certifyStaffWork'), artifactOnFile, (req, res) => {
  const key = req.params.key;
  if (!db.REVIEW_STEPS.has(key)) return res.status(400).json({ error:'That step does not take a review.' });
  if (!req.search.artifacts[key]) return res.status(400).json({ error:'Nothing on file yet to review.' });
  req.search.reviews = req.search.reviews || {};
  const approve = Boolean(req.body?.approve);
  if (approve) {
    delete (req.search.staleArtifacts || {})[key];
    req.search.reviews[key] = { status:'approved', by: req.user.id, byName: req.user.name, at: db.now() };
    db.touch(req.search, req.user, 'approved '+key);
  } else {
    delete req.search.reviews[key];
    db.touch(req.search, req.user, 'marked '+key+' as needing another look');
  }
  db.persist();
  res.json(painted(req, req.search));
});

app.post('/api/searches/:id/assemble', ...requireWorkspace, requireSearch, requireEditor, kindOnFile, (req, res) => {
  const kind = req.body?.kind;
  if (kind !== 'brochure') return res.status(400).json({ error:'Unknown assemble kind.' });
  const community = req.search.artifacts.community;
  if (!community || typeof community !== 'object') {
    return res.status(400).json({ error:'Finish the community profile first.' });
  }
  req.search.artifacts.brochure = assembleBrochure(req.search);
  clearReview(req.search, 'brochure');
  db.touch(req.search, req.user, 'filled the brochure from the community file');
  db.persist();
  res.json(painted(req, req.search));
});

function photoDir(searchId){
  return path.join(db.DATA_DIR, 'media', searchId);
}

function requireMediaAuthorization(req, res, next){
  if (!/^Bearer\s+\S/i.test(String(req.headers.authorization || ''))) {
    return res.status(401).json({ error:'Open this image from the workspace.', code:'BEARER_REQUIRED' });
  }
  next();
}

// wipeSlotFiles was removed in DEP-04. It deleted the committed photo before
// the replacement record was saved, so a failed save rolled the record back
// over an image that no longer existed. server/media.js stages, commits, then
// sweeps instead.

app.post('/api/searches/:id/media', ...requireWorkspace, requireSearch, requireEditor, mediaLimit, requireStepOnFile(() => 'brochure'), (req, res) => {
  const slot = String(req.body?.slot || '');
  if (!PHOTO_SLOTS.has(slot)) return res.status(400).json({ error:'Unknown photo slot.' });

  const decoded = media.decodeJpeg(req.body?.data);
  if (decoded.error) return res.status(400).json({ error: decoded.error });

  const dir = photoDir(req.search.id);
  // Staged under a content-addressed name nothing references yet, so the photo
  // currently on the record is untouched until the new one is committed.
  const file = media.stage(dir, slot, decoded.buf);

  const brochure = req.search.artifacts.brochure || {};
  brochure.photos = { ...(brochure.photos || {}), [slot]: '/media/' + req.search.id + '/' + file };
  brochure.theme = packTheme(brochure.theme);
  brochure.scheme = packScheme(brochure.scheme);
  req.search.artifacts.brochure = brochure;
  clearReview(req.search, 'brochure');
  db.touch(req.search, req.user, 'added the ' + slot + ' photo');

  try {
    db.persist();
  } catch (error) {
    // The record rolled back, so nothing points at the staged file. Remove it
    // and leave the previously committed photo exactly as it was.
    media.discard(dir, file);
    throw error;
  }

  // Committed. Only now is it safe to reclaim files the record and its history
  // no longer reference.
  media.sweep(dir, req.search);
  res.json(painted(req, req.search));
});

app.delete('/api/searches/:id/media/:slot', ...requireWorkspace, requireSearch, requireEditor, (req, res) => {
  const slot = String(req.params.slot || '');
  if (!PHOTO_SLOTS.has(slot)) return res.status(400).json({ error:'Unknown photo slot.' });

  const brochure = req.search.artifacts.brochure || {};
  const photos = { ...(brochure.photos || {}) };
  delete photos[slot];
  brochure.photos = photos;
  req.search.artifacts.brochure = brochure;
  clearReview(req.search, 'brochure');
  db.touch(req.search, req.user, 'removed the ' + slot + ' photo');

  // Drop the reference first. If the save fails the record rolls back with its
  // photo intact, which it could not do if the bytes were already deleted.
  db.persist();

  // Sweep keeps anything an earlier brochure revision still points at, so
  // removing today's photo does not blank a historical one.
  media.sweep(photoDir(req.search.id), req.search);
  res.json(painted(req, req.search));
});

/**
 * A brochure photo, fetched with the session the page is holding.
 *
 * An <img src> would carry the session cookie, and Clerk's cookie reflects
 * whichever organization was selected most recently in any tab — not
 * necessarily the one this page is showing. That is exactly the request that
 * must not be allowed to resolve against the wrong workspace, so the header is
 * required and the client fetches the image rather than letting the browser do
 * it ambiently.
 */
app.get('/media/:id/:file', requireMediaAuthorization, ...requireWorkspace, requireSearch, (req, res) => {
  const file = path.basename(String(req.params.file || ''));
  if (!PHOTO_FILE_RE.test(file)) return res.status(404).end();
  const dir = photoDir(req.search.id);
  const abs = path.resolve(path.join(dir, file));
  const root = path.resolve(dir);
  if (!abs.startsWith(root + path.sep)) return res.status(404).end();
  if (!fs.existsSync(abs)) return res.status(404).end();
  // Brochure photos are private to a search. Without this they persist in the
  // browser's disk cache and stay readable after the session is revoked, which
  // no server-side check can undo.
  res.set('Cache-Control', 'no-store, private');
  res.set('Vary', 'Cookie');
  res.type('image/jpeg');
  res.sendFile(abs);
});


app.post('/api/searches/:id/generate', ...requireWorkspace, requireSearch, requireEditor, generateLimit, withinAiBudget, kindOnFile, async (req, res) => {
  const kind = req.body?.kind;
  const premium = Boolean(req.body?.premium);
  const revision = req.search.revision;
  const snapshot = integrity.clone(req.search);
  try {
    // The profile draft writes from what the committee said, not from one
    // person's recollection of the workshop. Everything else inherits the
    // profile, so this is the only prompt that needs the room.
    const room = kind === 'profile'
      ? committee.packForPrompt(committee.aggregate(req.search, id => db.findUserById(id)?.name || ''))
      : null;
    const aiStartedAt = Date.now();
    aibudget.begin();
    let out;
    try {
      out = await ai.generate(kind, snapshot, { premium, notes: req.body?.notes||'', committee: room });
      telemetry.recordAi({ ok: true, ms: Date.now() - aiStartedAt, usage: out.usage, kind });
      aibudget.record({ searchId: req.search.id, model: out.model, usage: out.usage, ok: true });
    } catch (error) {
      // Counted even though the work is lost: a failed call can still have
      // been billed, and an outage has to be visible in the numbers.
      telemetry.recordAi({ ok: false, ms: Date.now() - aiStartedAt, kind, code: error.code });
      // Counted with unknown usage: a failed call may still have been billed.
      aibudget.record({ searchId: req.search.id, model: null, usage: null, ok: false });
      throw error;
    }
    if (!stillAuthorized(req)) {
      return res.status(409).json({ error:'This search was closed to you while the draft was generating. Nothing was saved.' });
    }
    if (req.search.revision !== revision) return res.status(409).json({ error:'This search changed while the draft was generating. The newer work was kept. Reload the search before drafting again.', code:'STALE_SEARCH' });
    const invalid = kind === 'profile' ? integrity.validateCriteria(out.json.criteria)
      : ['survey1', 'survey2'].includes(kind) ? integrity.validateSurvey(out.json) : null;
    if (invalid) return res.status(422).json({ error:'The generated draft was not saved: ' + invalid });
    if (kind === 'profile') {
      req.search.criteria = (out.json.criteria||[]).map((c,i)=>({
        id: c.id || ('X'+(i+1)),
        kind: c.kind,
        label: c.label,
        weight: clampWeight(c.weight),
        note: c.note||'',
        from: 'draft'
      }));
      db.touch(req.search, req.user, 'drafted the profile with '+out.model);
    } else {
      const prev = req.search.artifacts[kind] || {};
      req.search.artifacts[kind] = out.json;
      if (kind === 'brochure') {
        const next = req.search.artifacts.brochure || {};
        req.search.artifacts.brochure = applyBrochureDefaults(next, prev, { preferPrev: true });
      }
      clearReview(req.search, kind);
      db.touch(req.search, req.user, 'drafted '+kind+' with '+out.model);
    }
    req.search.aiUsage = ai.addUsage(req.search.aiUsage, out.usage);
    db.persist();
    // `desk` is the code-side review that ran before the draft landed: how
    // many rounds it took and what, if anything, is still open for a human.
    res.json({ search: painted(req, req.search), model: out.model, usage: out.usage, desk: out.desk });
  } catch (err) {
    const fail = claudeFail(err);
    res.status(fail.status).json({ error: fail.error });
  }
});

/**
 * Read the research request off the wire.
 *
 * Shared by the synchronous route and the job route so the two contracts
 * cannot drift into validating different things.
 */
function researchInput(req){
  const body = req.body || {};
  const city = String(Object.prototype.hasOwnProperty.call(body, 'city') ? body.city : (req.search.client || '')).trim();
  const website = String(Object.prototype.hasOwnProperty.call(body, 'website') ? body.website : (req.search.website || '')).trim();
  if (!city) {
    return { error: req.search.jurisdictionType === 'county' ? 'Enter the county name.' : 'Enter the city or jurisdiction name.' };
  }
  if (!website) return { error: 'Enter the official jurisdiction website.' };
  return {
    input: {
      city, website,
      premium: Boolean(body.premium),
      position: req.search.position,
      state: req.search.state,
      jurisdictionType: req.search.jurisdictionType
    }
  };
}

const RESEARCH_NOTE_MARK = '— From city research —';

/**
 * Write a research result onto the search file.
 *
 * One place where research lands, shared by the synchronous route and the job
 * runner, so there is one set of rules about what it may overwrite.
 *
 * A full result behaves as it always has: the research is the authority on the
 * facts it found. A partial result does not. It has named gaps, it is applied
 * only after a consultant has reviewed it, and it fills blanks rather than
 * replacing anything a person has already put on the file — including the
 * previous completed research, which stays until a full result replaces it.
 * Whatever it declined to overwrite is returned so the consultant is told
 * rather than left to notice.
 */
function applyResearch(search, user, { city, website, out }){
  const partial = Boolean(out.partial);
  const facts = (out.json && out.json.facts) || {};
  const held = [];
  const keep = (key, label) => {
    if (!facts[key]) return false;
    if (partial && String(search[key] || '').trim() && String(search[key]) !== String(facts[key])) {
      held.push(label);
      return false;
    }
    return true;
  };

  search.website = website;
  if (keep('client', 'jurisdiction name')) search.client = facts.client;
  else if (!search.client) search.client = city;
  for (const [k, label] of [['state','state'],['fog','form of government'],['population','population'],['budget','budget'],['salary','salary']]) {
    if (keep(k, label)) search[k] = facts[k];
  }
  if (facts.notes) {
    const base = String(search.notes || '').split(RESEARCH_NOTE_MARK)[0].trim();
    search.notes = base ? base + '\n\n' + RESEARCH_NOTE_MARK + '\n' + facts.notes : facts.notes;
  }

  const community = (out.json && out.json.community) || {};
  const hasCommunity = Boolean(community.lede || community.government || community.community
    || community.organization || community.why || (community.facts || []).length);
  const onFile = search.artifacts && search.artifacts.community;
  const occupied = Boolean(onFile && Object.keys(onFile).length);
  if (hasCommunity && (!partial || !occupied)) {
    search.artifacts.community = community;
  } else if (hasCommunity && partial && occupied) {
    held.push('community profile');
  }

  search.research = {
    at: db.now(),
    city,
    website,
    sources: out.sources || [],
    model: out.model,
    // A reviewed partial is recorded as partial, with the gaps it was accepted
    // with. Nothing on this file should look more researched than it is.
    partial: partial || undefined,
    missing: partial && (out.warnings || []).length ? out.warnings.slice(0, 12) : undefined
  };
  db.touch(search, user, (partial ? 'applied partial research for ' : 'researched ') + city + ' from the official website');
  search.aiUsage = ai.addUsage(search.aiUsage, out.usage);
  return { held };
}

/**
 * Research, synchronously, inside one bounded operation.
 *
 * Kept alongside the job contract below for rollback: an already-open browser
 * that has not reloaded still calls this. It is bounded the same way the job
 * runner is — the difference is only who holds the connection while it runs.
 */
app.post('/api/searches/:id/research', ...requireWorkspace, requireSearch, requireEditor, researchLimit, withinAiBudget, async (req, res) => {
  const parsed = researchInput(req);
  if (parsed.error) return res.status(400).json({ error: parsed.error });
  const input = parsed.input;
  const revision = req.search.revision;

  const op = researchOp.begin({ searchId: req.search.id });
  // While one request holds the work, losing the browser means nobody is
  // waiting for it, so it is stopped rather than left to finish and bill.
  // `close` fires on a completed response too, hence the guard: a successful
  // reply must not be read as a disconnect.
  const onClose = () => { if (!res.writableEnded) op.cancel('client-disconnect'); };
  res.on('close', onClose);

  const startedAt = Date.now();
  let settled = false;
  const settle = (ok, out) => {
    if (settled) return;
    settled = true;
    telemetry.recordAi({ ok, ms: Date.now() - startedAt, usage: out && out.usage, kind: 'research', code: out && out.code });
    // Recorded on the attempt, and with unknown usage marked as unknown: a
    // failed round may still have been billed.
    aibudget.record({
      searchId: req.search.id,
      model: (out && out.model) || null,
      usage: op.usageKnown ? op.usage : null,
      ok
    });
  };

  aibudget.begin();
  try {
    let out;
    try {
      out = await ai.researchCity(input, op);
    } catch (error) {
      const normalized = ai.normalizeClaudeError(error, op);
      settle(false, { code: normalized.code });
      throw normalized;
    }
    settle(true, out);

    // Checked again here, after the wait: authority, lifecycle and revision can
    // all have changed while research was running, and a late write must not
    // land in a workspace nobody asked it to.
    op.throwIfDone();
    op.stageIs('saving');
    if (!stillAuthorized(req)) {
      return res.status(409).json({ code: 'RESEARCH_UNAUTHORIZED', error: 'This search was closed to you while research was running. Nothing was saved.' });
    }
    if (req.search.revision !== revision) {
      return res.status(409).json({ error: 'This search changed during research. The newer work was kept. Reload before researching again.', code: 'STALE_SEARCH' });
    }
    if (out.partial) {
      // Supported findings with named gaps are offered, not written. The job
      // contract gives them a review step; this path hands them back so the
      // consultant can see what is missing and decide.
      logResearchRun(op, {
        route: 'research-sync', outcome: 'incomplete', partial: true,
        pages: out.pagesRead, truncated: out.crawlTruncated
      });
      return res.status(422).json({
        code: 'RESEARCH_INCOMPLETE',
        error: 'Research found some of the file but not all of it. Review what it found, or fill the rest by hand.',
        missing: out.warnings,
        operation: op.id
      });
    }
    const { held } = applyResearch(req.search, req.user, { city: input.city, website: input.website, out });
    db.persist();
    op.stageIs('done');
    logResearchRun(op, {
      route: 'research-sync', outcome: 'saved',
      pages: out.pagesRead, truncated: out.crawlTruncated
    });
    res.json({
      search: painted(req, req.search),
      model: out.model,
      usage: out.usage,
      usageKnown: out.usageKnown !== false,
      held,
      operation: op.id
    });
  } catch (err) {
    settle(false, { code: err.code });
    const fail = researchFail(err, op);
    logResearchFailure(err, op, { route: 'research-sync' });
    res.status(fail.status).json(fail.body);
  } finally {
    res.off('close', onClose);
    op.end();
  }
});

/* ===========================================================================
 * Research as a job
 *
 * The same work, started and answered separately, so a consultant is not the
 * only record that it is happening. See server/research-jobs.js for why this
 * stays in one process.
 * ========================================================================= */

// Status polling is frequent by design — roughly every two seconds while the
// tab is visible — so it gets its own allowance rather than eating the one
// that bounds starting paid work.
const researchStatusLimit = http.limiter({
  windowMs: 10 * 60 * 1000, max: 900, key: req => 'rstatus:' + (req.user?.id || clientIp(req)),
  message: 'Too many status checks. Wait a moment.'
});

/**
 * Is the authority this job started with still the authority it has?
 *
 * `stillAuthorized` compares against the access object its request arrived
 * with, which is right for a call that lasts seconds. A job can outlive the
 * membership that started it, so this asks the directory again: the person may
 * have been removed from the firm, had their role changed, or the search may
 * have been closed, deleted, or edited since.
 */
async function authorizeJob(job){
  const search = db.findSearch(job.searchId);
  if (!search) {
    return { ok: false, code: 'SEARCH_GONE', error: 'That search no longer exists, so the research was not saved.' };
  }
  if ((search.organizationId || null) !== (job.organizationId || null)) {
    return { ok: false, code: 'RESEARCH_UNAUTHORIZED', error: 'That search moved to another workspace, so the research was not saved.' };
  }
  if (disposition.isFrozen(search)) {
    return { ok: false, code: 'SEARCH_CLOSED', error: 'This search was ' + disposition.lifecycleOf(search) + ' while research was running, so nothing was saved.' };
  }
  const user = db.findUserById(job.requestedBy);
  if (!user || !job.requestedByClerkId) {
    return { ok: false, code: 'RESEARCH_UNAUTHORIZED', error: 'The account that started this research is no longer available, so nothing was saved.' };
  }
  const access = await auth.accessFor(user, job.requestedByClerkId, job.organizationId);
  if (!access || !access.orgId || !access.role || !db.canEdit(search, access)) {
    return { ok: false, code: 'RESEARCH_UNAUTHORIZED', error: 'Your access to this search changed while research was running, so nothing was saved.' };
  }
  if (search.revision !== job.revisionAtStart) {
    return {
      ok: false,
      code: 'STALE_SEARCH',
      error: 'This search changed while research was running. The newer work was kept; review the research before applying it.'
    };
  }
  return { ok: true, search, user, access };
}

app.post('/api/searches/:id/research-jobs', ...requireWorkspace, requireSearch, requireEditor, researchLimit, async (req, res) => {
  const parsed = researchInput(req);
  if (parsed.error) return res.status(400).json({ error: parsed.error });
  const key = String(req.get('idempotency-key') || (req.body && req.body.idempotencyKey) || '').trim();
  if (key && key.length > 120) return res.status(400).json({ error: 'That idempotency key is too long.' });

  const started = jobs.start({
    search: req.search,
    access: req.access,
    user: req.user,
    input: parsed.input,
    idempotencyKey: key
  });
  if (started.error) {
    if (started.code === 'RESEARCH_QUEUE_FULL' || String(started.code || '').startsWith('AI_')) res.set('Retry-After', '120');
    return res.status(started.status).json({ error: started.error, code: started.code });
  }
  // 202, not 200: the work is accepted and recorded, and has not happened yet.
  // `reused` is how a refresh or a double click learns it found the operation
  // it already started rather than a second one.
  res.status(202).json({
    job: jobs.publicJob(started.job),
    reused: Boolean(started.reused),
    status: '/api/searches/' + encodeURIComponent(req.search.id) + '/research-jobs/' + encodeURIComponent(started.job.id)
  });
});

app.get('/api/searches/:id/research-jobs/:jobId', ...requireWorkspace, requireSearch, requireEditor, researchStatusLimit, (req, res) => {
  const job = jobs.find(req.params.jobId);
  // A job belonging to another search, or another firm, is not found rather
  // than refused: an unauthorized read must look the same as a missing record.
  if (!job || job.searchId !== req.search.id) return res.status(404).json({ error: 'That research job was not found.' });
  res.json({ job: jobs.publicJob(job, { includeResult: Boolean(job.result && job.result.reviewable) }) });
});

app.post('/api/searches/:id/research-jobs/:jobId/cancel', ...requireWorkspace, requireSearch, requireEditor, (req, res) => {
  const job = jobs.find(req.params.jobId);
  if (!job || job.searchId !== req.search.id) return res.status(404).json({ error: 'That research job was not found.' });
  const out = jobs.cancel(job, req.user);
  res.json({
    job: jobs.publicJob(out.job, { includeResult: Boolean(out.job.result && out.job.result.reviewable) }),
    // Cancelling something that already saved is reported as what happened,
    // not as a cancellation that undid nothing.
    alreadyCompleted: Boolean(out.alreadyDone),
    search: out.alreadyDone ? painted(req, req.search) : undefined
  });
});

/**
 * Apply findings that were held back for review.
 *
 * Partial results and results a conflict refused always land here rather than
 * being written the moment they arrive. Authority and the revision are checked
 * again at this point, against this request, because this is the moment the
 * write happens.
 */
app.post('/api/searches/:id/research-jobs/:jobId/apply', ...requireWorkspace, requireSearch, requireEditor, (req, res) => {
  const job = jobs.find(req.params.jobId);
  if (!job || job.searchId !== req.search.id) return res.status(404).json({ error: 'That research job was not found.' });
  if (!job.result || !job.result.json || job.result.applied) {
    return res.status(409).json({ error: 'There is nothing from this research to apply.', code: 'NOTHING_TO_APPLY' });
  }
  const out = jobs.applyReviewed(job, { search: req.search, user: req.user });
  if (out.error) return res.status(out.status).json({ error: out.error, code: out.code });
  res.json({
    search: painted(req, req.search),
    job: jobs.publicJob(job),
    // Anything the partial declined to overwrite, so the consultant is told
    // rather than left to notice that a figure did not change.
    held: out.held || []
  });
});

app.post('/api/searches/:id/candidates', ...requireWorkspace, requireSearch, requireEditor, (req, res) => {
  const b = req.body || {};
  const invalid = integrity.validateCandidate(b);
  if (invalid) return res.status(400).json({ error: invalid });
  const c = {
    id: db.nid('C'),
    name: String(b.name||'').trim(),
    cur: String(b.cur||'').trim(),
    org: String(b.org||'').trim(),
    yrs: Number(b.yrs)||0,
    email: String(b.email||'').trim(),
    stage: 'applicant',
    invite: crypto.randomBytes(24).toString('hex'),
    inviteVersion: 2,
    survey1: null,
    survey2: null,
    survey2SentAt: null,
    survey2Deadline: '',
    addedAt: db.now()
  };
  req.search.candidates.push(c);
  db.touch(req.search, req.user, 'added '+c.name);
  db.persist();
  res.json(painted(req, req.search));
});

app.patch('/api/searches/:id/candidates/:cid', ...requireWorkspace, requireSearch, requireEditor, (req, res) => {
  const c = req.search.candidates.find(x=>x.id===req.params.cid);
  if (!c) return res.status(404).json({ error:'Candidate not found.' });
  const body = req.body || {};
  if ('stage' in body) {
    const ok = ['applicant','semifinalist','finalist','declined'];
    if (!ok.includes(body.stage)) return res.status(400).json({ error:'Unknown stage.' });
    // Reaching the finalist stage, and coming back off it, is the decision the
    // matrix reserves to the manager. Moving through the earlier stages is the
    // consultant's ordinary screening work, so the authority asked for depends
    // on which side of the line this change crosses — in either direction.
    const finalistChange = body.stage !== c.stage && (body.stage === 'finalist' || c.stage === 'finalist');
    const refusal = authority.refusalFor(finalistChange ? 'advanceFinalist' : 'advanceStage', req.search, req.access);
    if (refusal) return res.status(refusal.status).json(refusal);
    // An outcome is a decision about this person's participation. Advancing
    // them afterwards would put the pipeline and the record in contradiction.
    const blocked = disposition.blocksAdvancement(c);
    if (blocked && body.stage !== c.stage) {
      return res.status(409).json({
        error: c.name + ' is recorded as "' + blocked + '". Correct that outcome before changing their stage.',
        code: 'DISPOSITION_FINAL'
      });
    }
  }
  const wasFinalist = c.stage === 'finalist';
  const allow = ['name','cur','org','yrs','email','stage'];
  for (const k of allow) if (k in body) c[k] = body[k];
  // A certification describes the finalists who were on the file when it was
  // made. Changing who they are makes that statement untrue, so it is withdrawn
  // here rather than left standing over a roster it never covered.
  if ((c.stage === 'finalist') !== wasFinalist) {
    reopenReferences(req.search, req.user, 'the finalists changed');
  }
  db.touch(req.search, req.user, 'updated '+c.name);
  db.persist();
  res.json(painted(req, req.search));
});

function isSemifinalistOrFinalist(c){
  return c.stage === 'semifinalist' || c.stage === 'finalist';
}

function sendSurvey2(search, candidate, deadline, user){
  if (!isSemifinalistOrFinalist(candidate)) {
    const err = new Error('Advance '+candidate.name+' to semifinalist before sending the second survey.');
    err.status = 400;
    throw err;
  }
  if (!search.artifacts.survey2) {
    const err = new Error('Develop the semifinalist survey first.');
    err.status = 400;
    throw err;
  }
  candidate.survey2SentAt = db.now();
  issueSurvey(search, candidate, 'survey2');
  if (deadline != null) candidate.survey2Deadline = String(deadline);
  db.touch(search, user, 'opened the semifinalist questionnaire for '+candidate.name+'; notification is manual');
}

/* ---------------------------------------------------------------------------
 * Staff steps: sourcing, video interviews, reference checks.
 *
 * The firm does this work off the platform and records it here. Each step has
 * a log (who did what, when, about whom), running notes, and a completion the
 * consultant sets. There is nothing to generate; the record is the deliverable.
 * ------------------------------------------------------------------------- */

const LOG_MAX = 2000;
const STAFF_LOG_CAP = 200;

function requireStaffStep(req, res, next){
  const key = req.params.key;
  if (!db.STAFF_STEPS.has(key)) return res.status(400).json({ error:'That step is not staff work.' });
  if (!inPackage(req.search, key)) return res.status(400).json({ error: outsidePackage(req.search, key) });
  req.staffKey = key;
  // Rejected completion/log requests must not create an empty record that a
  // later identity refresh persists, invalidating the browser's revision.
  req.staff = req.search.staff?.[key] || { notes: '', log: [], doneAt: null, doneBy: null, doneByName: '' };
  next();
}

// A log entry may name a candidate only where the step is about candidates
// on the file, and only at the stage the step works with. Reference contact
// additionally waits for the candidate's recorded consent: a sitting manager
// whose references are called before they agreed has just been outed.
function staffCandidateFor(req, res){
  const cid = req.body?.candidateId;
  if (!cid && db.STAFF_STAGES[req.staffKey]) return { ok: false, status: 400, error:'Choose a candidate for this contact. Use working notes for general administration.' };
  if (!cid) return { ok: true, candidate: null };
  const stages = db.STAFF_STAGES[req.staffKey];
  if (!stages) return { ok: false, status: 400, error: 'This step is not tied to a candidate on the file.' };
  const c = (req.search.candidates || []).find(x => x.id === cid);
  if (!c) return { ok: false, status: 404, error: 'Candidate not found.' };
  if (!stages.includes(c.stage)) {
    return { ok: false, status: 400, error: c.name + ' is not a ' + stages.join(' or ') + ' yet.' };
  }
  if (req.staffKey === 'references' && !c.referenceConsentAt) {
    return { ok: false, status: 400, error: 'Record ' + c.name + '\'s consent before logging a reference contact.' };
  }
  return { ok: true, candidate: c };
}

/**
 * Withdraw a completion whose supporting record has changed.
 *
 * A completion stamp is a statement about a body of evidence at a moment: this
 * work was done, and here is what it consisted of. Any change to that evidence
 * makes the statement describe something that is no longer on the file, so the
 * stamp comes off and somebody has to look again and re-certify. The reason is
 * written to the activity feed, because a certification disappearing without
 * explanation is worse than one that never existed.
 *
 * Returns true when something was actually withdrawn, so callers can leave the
 * feed alone in the ordinary case where nothing was certified.
 */
function uncertify(record, search, user, why){
  if (!record || !record.doneAt) return false;
  record.doneAt = null; record.doneBy = null; record.doneByName = '';
  db.touch(search, user, 'reopened a completed step because ' + why);
  return true;
}

/** The same, reached from outside the staff routes: consent and the finalist roster. */
function reopenReferences(search, user, why){
  return uncertify((search.staff || {}).references, search, user, why);
}

app.post('/api/searches/:id/staff/:key/log', ...requireWorkspace, requireSearch, requireEditor, requireStaffStep, (req, res) => {
  const text = String(req.body?.text || '').trim().slice(0, LOG_MAX);
  if (!text) return res.status(400).json({ error:'Write down what was done.' });
  const who = staffCandidateFor(req, res);
  if (!who.ok) return res.status(who.status).json({ error: who.error });
  const entry = {
    id: db.nid('lg'),
    at: db.now(),
    by: req.user.id,
    byName: req.user.name,
    text,
    candidateId: who.candidate ? who.candidate.id : null,
    candidateName: who.candidate ? who.candidate.name : ''
  };
  req.staff.log.unshift(entry);
  if (req.staff.log.length > STAFF_LOG_CAP) req.staff.log.length = STAFF_LOG_CAP;
  // Fresh work on a step that was marked complete reopens it; the completion
  // stamp described a record that has since changed.
  uncertify(req.staff, req.search, req.user, 'new work was logged');
  const step = db.STEPS.find(s => s.key === req.staffKey);
  db.touch(req.search, req.user, 'logged ' + (step ? step.t.toLowerCase() : req.staffKey) + (who.candidate ? ' for ' + who.candidate.name : ''));
  req.search.staff ||= {};
  req.search.staff[req.staffKey] = req.staff;
  db.persist();
  res.json(painted(req, req.search));
});

app.delete('/api/searches/:id/staff/:key/log/:lid', ...requireWorkspace, requireSearch, requireEditor, requireStaffStep, (req, res) => {
  const before = req.staff.log.length;
  req.staff.log = req.staff.log.filter(e => e.id !== req.params.lid);
  if (req.staff.log.length === before) return res.status(404).json({ error:'That entry is not on the log.' });
  // Removing evidence changes the record the completion certified, exactly as
  // adding to it does. The stamp comes off on both edges; leaving it on would
  // let a step be certified and then quietly emptied.
  uncertify(req.staff, req.search, req.user, 'an entry was removed');
  db.touch(req.search, req.user, 'removed a ' + req.staffKey + ' log entry');
  req.search.staff ||= {};
  req.search.staff[req.staffKey] = req.staff;
  db.persist();
  res.json(painted(req, req.search));
});

app.put('/api/searches/:id/staff/:key', ...requireWorkspace, requireSearch, requireEditor, requireStaffStep, (req, res) => {
  const next = String(req.body?.notes || '').slice(0, 8000);
  const changed = next !== String(req.staff.notes || '');
  req.staff.notes = next;
  // Working notes can be the only evidence a step has: completion accepts a
  // step with notes and no log. Rewriting them after certification is the same
  // change of record as rewriting the log.
  if (changed) uncertify(req.staff, req.search, req.user, 'the notes were rewritten');
  db.touch(req.search, req.user, 'updated ' + req.staffKey + ' notes');
  req.search.staff ||= {};
  req.search.staff[req.staffKey] = req.staff;
  db.persist();
  res.json(painted(req, req.search));
});

app.post('/api/searches/:id/staff/:key/complete', ...requireWorkspace, requireSearch, requireEditor, requireStaffStep, (req, res) => {
  // Reference completion is a certification about people outside the firm who
  // agreed to be contacted, so the matrix keeps it with the manager. Sourcing
  // and interview sign-off stay with the consultant who did the work.
  const refusal = authority.refusalFor(
    req.staffKey === 'references' ? 'certifyReferences' : 'certifyStaffWork', req.search, req.access);
  if (refusal) return res.status(refusal.status).json(refusal);
  const done = Boolean(req.body?.done);
  const step = db.STEPS.find(s => s.key === req.staffKey);
  if (done) {
    if (!req.staff.log.length && !String(req.staff.notes || '').trim()) {
      return res.status(400).json({ error:'Log what was done before marking this complete. An empty record is not a completed step.' });
    }
    if (req.staffKey === 'references') {
      const finalists = req.search.candidates.filter(c => c.stage === 'finalist');
      if (!finalists.length || finalists.some(c => !c.referenceConsentAt || !req.staff.log.some(e => e.candidateId === c.id))) {
        return res.status(400).json({ error:'Record consent and a reference contact for every current finalist before completing reference checks.' });
      }
    }
    req.staff.doneAt = db.now();
    req.staff.doneBy = req.user.id;
    req.staff.doneByName = req.user.name;
    db.touch(req.search, req.user, 'completed ' + step.t.toLowerCase());
  } else {
    req.staff.doneAt = null; req.staff.doneBy = null; req.staff.doneByName = '';
    db.touch(req.search, req.user, 'reopened ' + step.t.toLowerCase());
  }
  req.search.staff ||= {};
  req.search.staff[req.staffKey] = req.staff;
  db.persist();
  res.json(painted(req, req.search));
});

// Consent to contact references is recorded on the candidate, so it survives
// the step being reopened and is visible wherever the person is shown.
app.post('/api/searches/:id/candidates/:cid/consent', ...requireWorkspace, requireSearch, requireEditor, (req, res) => {
  const c = (req.search.candidates || []).find(x => x.id === req.params.cid);
  if (!c) return res.status(404).json({ error:'Candidate not found.' });
  const consent = Boolean(req.body?.consent);
  if (consent) {
    c.referenceConsentAt = db.now();
    c.referenceConsentBy = req.user.name;
    db.touch(req.search, req.user, 'recorded ' + c.name + '\'s consent to contact references');
  } else {
    delete c.referenceConsentAt;
    delete c.referenceConsentBy;
    // Completion required consent from every current finalist. Withdrawing one
    // person's consent takes that support away, so the certification goes with
    // it rather than standing over a finalist who has since said no.
    if (c.stage === 'finalist') reopenReferences(req.search, req.user, c.name + ' withdrew reference consent');
    db.touch(req.search, req.user, 'withdrew ' + c.name + '\'s reference consent');
  }
  db.persist();
  res.json(painted(req, req.search));
});

const send2OnFile = requireStepOnFile(() => 'send2');

app.post('/api/searches/:id/candidates/:cid/send2', ...requireWorkspace, requireSearch, requireEditor, authority.requireAuthority('advanceStage'), send2OnFile, (req, res) => {
  const c = req.search.candidates.find(x=>x.id===req.params.cid);
  if (!c) return res.status(404).json({ error:'Candidate not found.' });
  try {
    sendSurvey2(req.search, c, req.body?.deadline, req.user);
  } catch (err) {
    return res.status(err.status || 400).json({ error: err.message });
  }
  db.persist();
  res.json(painted(req, req.search));
});

app.post('/api/searches/:id/send2', ...requireWorkspace, requireSearch, requireEditor, authority.requireAuthority('advanceStage'), send2OnFile, (req, res) => {
  const deadline = req.body?.deadline;
  const eligible = req.search.candidates.filter(isSemifinalistOrFinalist);
  if (!eligible.length) return res.status(400).json({ error:'Advance at least one candidate to semifinalist first.' });
  try {
    for (const c of eligible) sendSurvey2(req.search, c, deadline, req.user);
  } catch (err) {
    return res.status(err.status || 400).json({ error: err.message });
  }
  db.persist();
  res.json(painted(req, req.search));
});

app.put('/api/searches/:id/scores/:cid', ...requireWorkspace, requireSearch, (req, res) => {
  const c = req.search.candidates.find(x=>x.id===req.params.cid);
  if (!c) return res.status(404).json({ error:'Candidate not found.' });
  // Scores already recorded stay: they are evidence of how the committee
  // worked. What stops is new evaluation of someone whose participation ended.
  const concluded = disposition.blocksAdvancement(c);
  if (concluded) {
    return res.status(409).json({
      error: c.name + ' is recorded as "' + concluded + '". Existing scores are kept; new scoring is closed.',
      code: 'DISPOSITION_FINAL'
    });
  }
  if (disposition.isFrozen(req.search)) {
    return res.status(409).json({ error: 'This search is closed. Reopen it before scoring.', code: 'SEARCH_CLOSED' });
  }
  const scores = req.body?.scores;
  const allowed = new Set(req.search.criteria.map(c => c.id));
  if (!scores || typeof scores !== 'object' || Array.isArray(scores)
      || Object.entries(scores).some(([id, n]) => !allowed.has(id) || !Number.isInteger(n) || n < 1 || n > 5)) {
    return res.status(400).json({ error:'Scores must use current criterion IDs and whole numbers from 1 to 5.' });
  }
  if (!req.search.scores[req.user.id]) req.search.scores[req.user.id] = {};
  req.search.scores[req.user.id][c.id] = req.body?.scores || {};
  if (req.body?.note != null) {
    if (!req.search.notesBy[req.user.id]) req.search.notesBy[req.user.id] = {};
    req.search.notesBy[req.user.id][c.id] = String(req.body.note);
  }
  db.touch(req.search, req.user, 'scored '+c.name);
  db.persist();
  res.json(painted(req, req.search));
});

function issueSurvey(search, candidate, key) {
  const source = search.artifacts[key];
  if (!source || integrity.validateSurvey(source)) return null;
  candidate.issuedSurveys ||= {};
  if (!candidate.issuedSurveys[key]) {
    const survey = integrity.clone(source);
    candidate.issuedSurveys[key] = { survey, version:integrity.digest(survey), profileRevision:search.profileRevision, criteria:integrity.clone(search.criteria) };
  }
  return candidate.issuedSurveys[key];
}

app.post('/api/searches/:id/candidates/:cid/invite', ...requireWorkspace, requireSearch, requireEditor, (req, res) => {
  const c = req.search.candidates.find(c => c.id === req.params.cid);
  if (!c) return res.status(404).json({ error:'Candidate not found.' });
  c.invite = crypto.randomBytes(24).toString('hex');
  db.touch(req.search, req.user, 'replaced the invitation link for ' + c.name);
  db.persist();
  res.json(painted(req, req.search));
});

app.post('/api/searches/:id/candidates/:cid/reopen', ...requireWorkspace, requireSearch, requireEditor, (req, res) => {
  const c = req.search.candidates.find(c => c.id === req.params.cid);
  const which = req.body?.which;
  const reason = String(req.body?.reason || '').trim().slice(0, 2000);
  if (!c) return res.status(404).json({ error:'Candidate not found.' });
  if (!['survey1', 'survey2'].includes(which) || !c[which] || !reason) return res.status(400).json({ error:'Choose a submitted questionnaire and record why it is being reopened.' });
  req.search.history.push({ kind:'response', at:db.now(), who:req.user.name, candidateId:c.id, candidateName:c.name, key:which, reason, body:integrity.clone(c[which]) });
  c.issuedSurveys ||= {};
  c.issuedSurveys[which] = { survey:integrity.clone(c[which].survey), version:integrity.digest(c[which].survey), profileRevision:c[which].profileRevision, criteria:c[which].criteria || [] };
  c[which] = null;
  c.invite = crypto.randomBytes(24).toString('hex');
  db.touch(req.search, req.user, 'reopened ' + which + ' for ' + c.name + ': ' + reason);
  db.persist();
  res.json(painted(req, req.search));
});

app.get('/api/apply/:token', candidateLimit, (req, res) => {
  const found = db.findByInvite(req.params.token);
  if (found) {
    const { search: s, candidate: c } = found;
    const sent2 = Boolean(c.survey2SentAt);
    const first = issueSurvey(s, c, 'survey1');
    const second = sent2 ? issueSurvey(s, c, 'survey2') : null;
    db.persist();
    return res.json({
      token: req.params.token,
      client: s.client,
      position: s.position,
      candidate: { name:c.name, id:c.id },
      survey1: first?.survey || null,
      survey2: second?.survey || null,
      versions: { survey1:first?.version, survey2:second?.version },
      submitted1: Boolean(c.survey1),
      submitted2: Boolean(c.survey2),
      sent2,
      deadline2: c.survey2Deadline || '',
      // Proof of what arrived and when. Returned on every load so a candidate
      // who lost the response can reload and see their submission stood,
      // instead of guessing and sending it again.
      receipts: candidates.receipts(c),
      // Whatever they had typed but not sent, if it has not expired.
      drafts: {
        survey1: candidates.readDraft(c, 'survey1'),
        survey2: candidates.readDraft(c, 'survey2')
      },
      deadlines: {
        survey2: c.survey2Deadline || null,
        // Stated rather than left to be inferred from a bare date.
        enforced: false,
        note: c.survey2Deadline
          ? 'This date is when the search team plans to review responses. It is not enforced by this page; '
            + 'if you need more time, contact the team using the details below.'
          : null,
        timezone: process.env.SLATE_TIMEZONE || 'America/Phoenix'
      },
      instructions: String(process.env.SLATE_CANDIDATE_INSTRUCTIONS || '').trim() || null,
      privacyNotice: String(process.env.SLATE_PRIVACY_NOTICE || '').trim() || null,
      privacyNoticeConfigured: Boolean(String(process.env.SLATE_PRIVACY_NOTICE || '').trim()),
      correctionNote: 'If you need to change an answer after submitting, contact the search team. '
        + 'They can reopen the questionnaire; your original response is kept either way.',
      // A candidate who cannot submit, or who needs an accommodation to
      // complete the questionnaire, must have somewhere to go that is not a
      // dead end. Empty until an operator configures it, and the page says so
      // rather than pretending help exists.
      support: support()
    });
  }
  res.status(404).json({ error:'This link is not valid.' });
});

app.post('/api/apply/:token', candidateLimit, (req, res) => {
  const found = db.findByInvite(req.params.token);
  if (found) {
    const { search: s, candidate: c } = found;
    const which = req.body?.which || 'survey1';
    if (!['survey1', 'survey2'].includes(which)) return res.status(400).json({ error:'Unknown questionnaire.' });
    if (disposition.isFrozen(s)) {
      return res.status(409).json({ error: 'This search has closed and is no longer accepting responses. Contact the search team if you believe this is a mistake.', support: support() });
    }
    const issued = c.issuedSurveys?.[which];
    if (!s.artifacts[which] && !issued) {
      return res.status(400).json({ error:'This survey is not open yet.' });
    }
    if (which === 'survey2' && !c.survey2SentAt) {
      return res.status(400).json({ error:'The search team has not sent this questionnaire yet.' });
    }
    if (!issued || req.body?.surveyVersion !== issued.version) return res.status(409).json({ error:'Reload this questionnaire before submitting. Your answers have not been saved.' });
    const invalid = integrity.validateAnswers(issued.survey, req.body?.answers);
    if (invalid) return res.status(400).json({ error:invalid });

    // Fingerprint of exactly what was sent, so a retry can be told apart from
    // a different set of answers.
    const digest = integrity.digest(req.body.answers);

    if (c[which]) {
      const existing = c[which];
      // The submission committed but the candidate never saw the response:
      // the connection dropped, the phone suspended the tab, they hit submit
      // twice. Returning an error here is what pushes someone into sending a
      // second, conflicting set of answers. Their work is safe, so say so.
      if (existing.digest === digest && existing.version === issued.version) {
        return res.json({
          ok: true,
          duplicate: true,
          receipt: candidates.receiptOf(c, which),
          message: 'This questionnaire was already received. Your answers are safe; nothing was sent twice.'
        });
      }
      // Genuinely different answers against an already-submitted questionnaire.
      // Never silently overwrite a submitted response: the first one is part of
      // the record, and replacing it is a correction a person has to make.
      return res.status(409).json({
        error: 'This questionnaire was already submitted with different answers. Your earlier response is safe. '
          + 'Contact the search team to request a correction; they can reopen it for you.',
        receipt: candidates.receiptOf(c, which),
        support: support()
      });
    }

    c[which] = { at: db.now(), answers: req.body.answers, digest, ...integrity.clone(issued) };
    candidates.clearDraft(c, which);
    // Recorded as the candidate's own action, not a consultant decision.
    db.touch(s, { name: c.name, id: null, role: 'candidate' }, 'submitted the ' + which + ' questionnaire');
    db.persist();
    return res.json({ ok: true, receipt: candidates.receiptOf(c, which) });
  }
  res.status(404).json({ error:'This link is not valid.' });
});

/**
 * Save what a candidate has typed but not sent.
 *
 * Server-side and expiring, rather than left in localStorage: a long answer
 * typed on a borrowed or shared phone should not sit in that browser
 * indefinitely with nothing to remove it.
 *
 * A draft can never touch a submitted response.
 */
app.post('/api/apply/:token/draft', candidateLimit, (req, res) => {
  const found = db.findByInvite(req.params.token);
  if (!found) return res.status(404).json({ error: 'This link is not valid.' });

  const { search: s, candidate: c } = found;
  const which = req.body?.which || 'survey1';
  if (!['survey1', 'survey2'].includes(which)) return res.status(400).json({ error: 'Unknown questionnaire.' });
  if (which === 'survey2' && !c.survey2SentAt) {
    return res.status(400).json({ error: 'The search team has not sent this questionnaire yet.' });
  }
  const issued = c.issuedSurveys?.[which];
  if (!issued || req.body?.surveyVersion !== issued.version) {
    return res.status(409).json({ error: 'Reload this questionnaire before saving a draft. Your submitted response has not changed.' });
  }
  const allowed = new Set((issued.survey?.questions || []).map(question => 'q' + question.n));
  if (Object.keys(req.body?.answers || {}).some(key => !allowed.has(key))) {
    return res.status(400).json({ error: 'That draft does not match this questionnaire. Reload it before saving.' });
  }

  const result = candidates.saveDraft(c, which, req.body?.answers);
  if (result.error) return res.status(400).json({ error: result.error });

  db.persist();
  res.json({ ok: true, savedAt: result.saved.at, expiresAt: result.saved.expiresAt });
});

app.get('/apply/:token', candidateLimit, (_req, res) => {
  // The token is in the URL of this page. Keeping it out of the shared cache
  // and out of the back/forward buffer limits how long a candidate's link
  // survives on a borrowed or public computer.
  res.set('Cache-Control', 'no-store, private');
  res.sendFile(path.join(__dirname, '..', 'public', 'index.html'));
});

// Unknown API route. Express would answer an HTML error page, which is the
// one response shape a client that only ever parses JSON cannot read: a
// typo in a path would surface to the user as a parse failure rather than
// as the 404 it is. Registered after every route, so it only sees paths
// nothing claimed.
app.use('/api', (req, res) => {
  res.status(404).json({ error: 'No such endpoint.', ref: req.ref });
});

// Terminal handler. Registered last so it sees failures from every route,
// including malformed JSON and oversized bodies rejected by the parsers.
app.use(http.errors());

const server = app.listen(PORT, HOST, () => {
  console.log('Slate listening on http://'+HOST+':'+PORT);
  console.log('Release:', RELEASE, '| Node', process.versions.node, '| data', db.DATA_DIR);
  // The Dockerfile and CI pin the supported major. A local runtime below it
  // still starts, because refusing to boot over it would help nobody, but it
  // is said out loud: a difference between what you are testing on and what
  // production runs is worth knowing before it explains a bug.
  if (ENGINE_FLOOR && Number(process.versions.node.split('.')[0]) < ENGINE_FLOOR) {
    console.warn('Slate: Node ' + process.versions.node + ' is below the supported floor (>=' + ENGINE_FLOOR
      + '). Production runs Node ' + ENGINE_FLOOR + '; behaviour here may not match it.');
  }
  console.log('Default model:', process.env.CLAUDE_MODEL || 'claude-sonnet-5');
  console.log('API key:', String(process.env.ANTHROPIC_API_KEY || '').trim() ? 'present' : 'MISSING — set ANTHROPIC_API_KEY');
  try {
    recoveryConfig = recovery.start(db.DATA_DIR, process.env);
    console.log('Recovery: snapshot every ' + Math.round(recoveryConfig.intervalMs / 60000) + ' min; off-volume copy '
      + (recoveryConfig.mirrorTo || recoveryConfig.mirrorCommand ? 'configured' : 'NOT CONFIGURED'));
  } catch (error) {
    // Misconfigured recovery must be loud, but it must not stop the app from
    // serving work that is already underway.
    console.error('Recovery: not scheduled. ' + error.message);
  }
  // Whatever was in flight when the last process stopped. A running job is
  // marked interrupted rather than replayed: the provider may already have
  // billed it, and a silent re-run would bill it twice.
  try {
    const interrupted = jobs.recover();
    if (interrupted) console.log('Slate: ' + interrupted + ' research job(s) marked interrupted after restart.');
  } catch (error) {
    console.error('Slate: research job recovery failed: ' + error.message);
  }
  telemetry.watchEventLoop();
  watchAlerts();
  console.log('Alerts:', telemetry.alerts().destination);
  telemetry.log.info('started', {
    port: server.address().port,
    schemaVersion: db.db.schemaVersion,
    ai: aiConfigured() ? 'configured' : 'no-key',
    alerts: telemetry.alerts().destination
  });
  if (process.send) process.send({ port:server.address().port });
});

/* ---------------------------------------------------------------------------
 * Shutdown
 *
 * A deploy sends SIGTERM and then waits a bounded time before killing the
 * process. Stop accepting new writes immediately so nothing is half-applied,
 * let reads and in-flight requests drain, then release the write lock so the
 * replacement process does not find a lock it has to treat as stale.
 * ------------------------------------------------------------------------- */
function shutdown(signal){
  if (shuttingDown) return;
  shuttingDown = true;
  console.log('Slate: ' + signal + ' received, draining requests.');
  // A draining process must stop paying for work it will not be able to save.
  // The records stay; the next process marks them interrupted.
  jobs.stop();

  // Hard ceiling well inside a typical platform termination allowance, so the
  // process exits deliberately rather than being killed mid-write.
  const forced = setTimeout(() => {
    console.error('Slate: drain timed out, exiting anyway.');
    db.releaseWriterLock();
    process.exit(1);
  }, 10000).unref();

  // Keep-alive connections a browser is holding open would otherwise keep
  // `close` waiting for the full drain ceiling on every shutdown. Idle ones go
  // at once; a request still in flight finishes.
  server.closeIdleConnections?.();

  server.close(() => {
    clearTimeout(forced);
    recovery.stop();
    telemetry.stop();
    db.releaseWriterLock();
    console.log('Slate: closed cleanly.');
    process.exit(0);
  });
}

for (const signal of ['SIGTERM', 'SIGINT']) process.on(signal, () => shutdown(signal));

// Leave when whoever started us does, if they asked for that.
//
// Windows has no process groups and no real signals, so a test runner that is
// interrupted cannot reliably signal this process — it is left listening, and
// the next run fails on a port that is "already used" by a server nobody
// remembers starting. A parent that hands us a stdin pipe can set
// SLATE_EXIT_WITH_PARENT, and the end of that pipe becomes the one
// cross-platform notice that the parent has gone. Opt-in, because a parent
// that gives us no stdin at all would otherwise look like one that had left.
if (process.env.SLATE_EXIT_WITH_PARENT === 'true') {
  process.stdin.on('end', () => shutdown('parent exit'));
  process.stdin.on('close', () => shutdown('parent exit'));
  process.stdin.resume();
}
