'use strict';

// A local .env is a development convenience only. In production the platform's
// environment is authoritative: a stray .env baked into an image must never
// silently replace deployed configuration. Tests supply their own environment.
// The rule lives in server/env.js so the operator preflight reads exactly the
// configuration the application would, instead of disagreeing with it (D10).
require('./env').loadLocalEnv();

const fs = require('fs');
const path = require('path');
const express = require('express');
const crypto = require('crypto');
const db = require('./db');
const auth = require('./auth').createAuth(db);
const billing = require('./billing').create({ provider: require('@clerk/express').clerkClient.billing });
const projectBillingModule = require('./project-billing');
const projectEntitlements = require('./project-entitlements');
const projectBilling = projectBillingModule.create({ db });
const ai = require('./ai');
const committee = require('./committee');
const integrity = require('./integrity');
const jurisdictions = require('./jurisdictions');
const http = require('./http');
const media = require('./media');
const recovery = require('./recovery');
const backup = require('./backup');
const telemetry = require('./telemetry');
const exporter = require('./export');
const candidates = require('./candidates');
const disposition = require('./disposition');
const authority = require('./authority');
const aibudget = require('./aibudget');
const aiAllowance = require('./ai-allowance').create({ db });
const researchOp = require('./research-op');
const researchJobs = require('./research-jobs');
const organizations = require('./organizations');
const help = require('./help');
const postings = require('./postings');
const applications = require('./applications');
const applicantAccess = require('./applicant-access');
const applicationFiles = require('./application-files');
const mailer = require('./mailer');
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
  db, ai, telemetry, aibudget, allowance: aiAllowance,
  apply: (search, user, payload) => applyResearch(search, user, payload),
  authorize: job => authorizeJob(job),
  preflight: job => authorizeJob(job),
  research: (input, op) => ai.researchCity(input, op)
});

const app = express();
const PORT = Number(process.env.PORT || 4173);
const HOST = process.env.HOST || '0.0.0.0';
// Stamped into the image by CI (--build-arg SLATE_RELEASE). Lets an operator
// confirm which commit a running container was built from, which is what makes
// a rollback decision checkable rather than assumed.
//
// Two independent answers, because either can be wrong and the difference is
// what the audit found: the live service named a commit that did not contain
// the code the live service was running (D08). The rule for reconciling them
// lives in server/env.js, where it can be tested without a deploy.
const RELEASE_ID = require('./env').release(process.env);
const RELEASE = RELEASE_ID.id;
const RELEASE_STAMPED = RELEASE_ID.stamped;

/**
 * Where the release identity came from, so a rollback decision is checkable
 * rather than assumed. Resolved once at startup, because the environment a
 * process was started with is the environment it runs under.
 */
function releaseIdentity(){
  return RELEASE_ID;
}
// The supported Node major, read from the one place it is already declared
// rather than repeated here where it could drift from package.json.
const ENGINE_FLOOR = Number(String(require('../package.json').engines?.node || '').match(/\d+/)?.[0] || 0);
const NON_ARTIFACT_STEPS = new Set(['profile', 'screen', 'send2', 'finalists', ...db.STAFF_STEPS]);
const ARTIFACTS = new Set(db.STEPS.map(s => s.key).filter(k => !NON_ARTIFACT_STEPS.has(k)));

// The user guide names process steps and packages. A guide that points at a
// step this build does not have is a broken help link in front of somebody who
// is already stuck, so it is checked here rather than discovered there.
try {
  help.verify();
} catch (error) {
  console.error('Slate: ' + error.message);
  process.exit(1);
}

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
  return 'That step is not part of the ' + label + ' workflow.' + (needs ? ' It starts at ' + needs + '. Change the workflow on Search facts if the engagement changed.' : '');
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

// Verify Stripe against the raw bytes before JSON parsing and Clerk middleware.
app.post('/api/webhooks/stripe', express.raw({ type: 'application/json', limit: '256kb' }), async (req, res) => {
  const event = projectBillingModule.verifyWebhook(req.body, req.get('Stripe-Signature'), process.env.STRIPE_WEBHOOK_SECRET);
  if (!event) return res.status(400).json({ error: 'Invalid Stripe signature.' });
  try { await projectBilling.handleEvent(event); res.json({ received: true }); }
  catch (error) {
    telemetry.log.warn('stripe-webhook-failed', { eventId: event.id, message: error.message });
    res.status(503).json({ error: 'Payment reconciliation will retry.' });
  }
});

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
// An application material arrives the same way: base64 inside JSON, so it
// passes through the same origin and session checks as every other write
// rather than needing a second, differently-guarded upload path. The cap is
// the file limit in server/application-files.js plus base64 overhead.
const FILE_UPLOAD = /^\/api\/applications\/[^/]+\/files\/?$/;
const jsonMedia = express.json({ limit: '9mb' });
const jsonUpload = express.json({ limit: '12mb' });
app.use((req, res, next) => (req.method === 'POST' && MEDIA_UPLOAD.test(req.path)) ? jsonMedia(req, res, next) : next());
app.use((req, res, next) => (req.method === 'POST' && FILE_UPLOAD.test(req.path)) ? jsonUpload(req, res, next) : next());
app.use(express.json({ limit: '256kb' }));

app.use((req, res, next) => {
  // Candidate links, the public portal, and public configuration do not depend
  // on Clerk availability. An applicant reading a job page must not be turned
  // away because the staff identity provider is having a bad afternoon.
  if (/^\/api\/(config|health|ready|apply|public|applications)(\/|$)/.test(req.path)) return next();
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

/* Portal limits.
 *
 * Keyed by the verified applicant where there is one and by address otherwise,
 * so a whole county behind one NAT address is not locked out because somebody
 * else on it applied for a job this morning. Verification is keyed by the
 * *email address* as well as the caller, because the thing worth bounding
 * there is how often a code can be posted to one mailbox — that limit protects
 * a person who is not making the requests.
 */
const portalReadLimit = http.limiter({
  windowMs: 5 * 60 * 1000, max: 600, key: req => 'portal:' + clientIp(req),
  message: 'Too many requests. Wait a few minutes and try again.'
});
const verifyLimit = http.limiter({
  windowMs: 15 * 60 * 1000, max: 20, key: req => 'verify:' + clientIp(req),
  message: 'Too many verification attempts from this connection. Wait a few minutes and try again.'
});
const verifyAddressLimit = http.limiter({
  windowMs: 15 * 60 * 1000, max: 5,
  key: req => 'verify-to:' + applicantAccess.normalizeEmail(req.body?.email || ''),
  message: 'A code was sent to that address recently. Check your mail, including spam, before asking for another.'
});
const applicationLimit = http.limiter({
  windowMs: 5 * 60 * 1000, max: 240,
  key: req => 'application:' + (req.applicant?.id || clientIp(req)),
  message: 'Too many requests. Wait a few minutes and try again.'
});
const uploadLimit = http.limiter({
  windowMs: 30 * 60 * 1000, max: 30,
  key: req => 'upload:' + (req.applicant?.id || clientIp(req)),
  message: 'Too many uploads. Wait a few minutes and try again.'
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

/**
 * Is the profile something the committee may read yet?
 *
 * Adoption before closure used to hand one member another member's private
 * note through a criterion (CA-02). Publication is now the boundary: while the
 * window is open there is nothing to publish, and a profile whose provenance
 * predates adoption records has to be reviewed by staff before the room reads
 * support claims nothing on file establishes.
 */
function profilePublished(search){
  const intake = search.intake || {};
  if (intake.status === 'open') return false;
  if (search.adoptionProvenance === 'unverified') return false;
  return true;
}

function painted(req, search){
  const out = db.decorate(search, req.access);
  out.projectPayment = projectBilling.publicPayment(search);
  out.projectAccess = projectEntitlements.status(search, db.db.projectPurchases);
  out.consensus = consensusFor(search, req.access);
  const staff = db.isStaff(req.access);
  // Both data paths, not just the page: hiding the profile screen while the
  // criteria still ride along on the search response would move the disclosure
  // rather than close it.
  if (!staff && !profilePublished(search)) {
    out.criteria = [];
    out.profileWithheld = {
      reason: (search.intake || {}).status === 'open'
        ? 'The committee input window is open. The profile is published once the account manager closes it.'
        : 'This profile is being reviewed by the search team before it is shared.'
    };
  }
  // What the adopted profile rests on, and whether that has moved since. The
  // profile is never rewritten in response: a changed answer is a prompt for
  // the manager to look again, not an edit to a published record (CA-03).
  const adoption = (search.adoptions || [])[(search.adoptions || []).length - 1] || null;
  if (staff || (out.criteria || []).length) {
    out.adoption = adoption
      ? {
        id: adoption.id, at: adoption.at, by: adoption.byName || null,
        respondents: adoption.respondents, participants: adoption.participants,
        groups: adoption.groups || [], retained: adoption.retained || [],
        removed: adoption.removed || [], excluded: adoption.excluded || [],
        discussion: adoption.discussion || []
      }
      : null;
    out.sourceChanged = Boolean(adoption && committee.sourceFingerprint(search) !== adoption.fingerprint);
    out.adoptionProvenance = search.adoptionProvenance || (adoption ? 'recorded' : 'none');
    out.publication = search.publication
      ? { at: search.publication.at, by: search.publication.byName || null,
        profileRevision: search.publication.profileRevision, source: search.publication.source || null,
        reopenedAt: search.publication.reopenedAt || null }
      : null;
    // Gaps in the profile as it stands, which is a different question from how
    // much of it the committee covered (CA-06).
    out.profileGaps = committee.profileGaps(out.criteria || []);
  }
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
  // Whether this search is advertising, and how many applications are waiting.
  // Staff only: a committee member has no publishing screen and no application
  // inbox, and the count of who has applied is the firm's working information
  // until an applicant is accepted onto the candidate list.
  if (db.canEdit(search, req.access)) {
    const posting = postings.of(search);
    out.posting = {
      state: posting.state,
      published: Boolean(posting.published),
      live: postings.isLive(posting, { searchFrozen: disposition.isFrozen(search) }),
      accepting: postings.acceptsApplications(posting, { searchFrozen: disposition.isFrozen(search) }),
      unpublishedChanges: Boolean(posting.published)
        && JSON.stringify(posting.draft) !== JSON.stringify(posting.published.fields)
    };
    out.applications = applications.countsFor(db.db, search);
  }
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

// A member writing their own intake answer. The search-wide revision is the
// wrong precondition for it: two members answering independently change the
// same search, and one submitting must not make the other's answer unsaveable
// (CA-12). These routes carry their own per-member precondition instead, and
// re-check membership and the window themselves. Nothing else is relaxed.
const PERSONAL_INTAKE_PATH = /^\/api\/searches\/[^/]+\/intake(\/withdraw)?\/?$/;

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
  if (!reads && !projectEntitlements.allows(s, db.db.projectPurchases, 'work')) {
    const rootFacts = req.method === 'PATCH' && /^\/api\/searches\/[^/]+\/?$/.test(req.path)
      && Object.keys(req.body || {}).every(key => [
        'jurisdictionType', 'client', 'position', 'state', 'website', 'fog',
        'population', 'budget', 'salary', 'opened', 'firstReview', 'notes', 'package'
      ].includes(key));
    const paymentRoute = /^\/api\/searches\/[^/]+\/(checkout|payment\/reconcile)\/?$/.test(req.path);
    if (!rootFacts && !paymentRoute) return res.status(402).json({ code: 'PROJECT_PAYMENT_REQUIRED',
      error: 'Complete this search’s project payment before starting work.' });
  }
  // Stopping work already underway is not an edit to the search. A consultant
  // must be able to cancel research whose search has changed under them, or
  // been closed, without first reloading to collect a fresh revision — the
  // alternative is a paid operation nobody can stop.
  const stopsWork = STOP_WORK_PATH.test(req.path);
  const personal = req.method !== 'GET' && PERSONAL_INTAKE_PATH.test(req.path);
  if (!reads && !stopsWork && !personal && req.headers['if-match'] === undefined) {
    return res.status(428).json({ error:'Reload this search before saving.', code:'REVISION_REQUIRED' });
  }
  if (!reads && !stopsWork && !personal && req.headers['if-match'] !== undefined
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
  return db.canEdit(current, req.access)
    && projectEntitlements.allows(current, db.db.projectPurchases, 'work');
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
  // Deliberately small and fast: this is the endpoint the platform polls to
  // decide whether to keep sending traffic here, so it reports liveness and
  // identity and asks nothing else. Everything diagnostic is on /api/ready.
  res.json({
    ok: true,
    release: RELEASE,
    releaseStamped: RELEASE_STAMPED,
    releaseSource: releaseIdentity().source,
    node: process.versions.node
  });
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
  const storageUsage = readinessStorage();

  res.status(ready ? 200 : 503).json({
    ready,
    shuttingDown,
    release: RELEASE,
    // Unstamped, or stamped inconsistently, means this container cannot be
    // reliably traced back to a commit. That is a release-process fault rather
    // than a runtime one, so it is reported rather than made into a failing
    // readiness check that would pull traffic.
    releaseStamped: RELEASE_STAMPED,
    releaseIdentity: releaseIdentity(),
    schemaVersion: db.db.schemaVersion,
    storage: {
      ...storage,
      // What Slate is costing on the volume, and what bounds it. These are the
      // numbers that decide whether the disk is big enough, and an operator
      // should not have to shell into the container to find them. Sizes and
      // counts only — never a filename, a candidate, or a record.
      // Measured once and used twice. Adding up the volume walks every file in
      // every snapshot, so this is a sample with a time on it rather than a
      // fresh reading per poll — see dataUsage() in server/backup.js.
      usage: storageUsage.usage,
      // Whether the volume is plausibly big enough for what this deployment is
      // configured to put on it. A judgement and its reasons, never an
      // instruction, and it names no hosting platform.
      pressure: storageUsage.pressure,
      // What the last retention sweep actually did. Operational recovery
      // points only: this never applies a records retention policy, and it
      // never touches a pre-migration or hand-labelled copy. See
      // docs/operations.md.
      retention: backup.pruneStatus()
    },
    // Drafting is unavailable without a key, but nothing else is. This is
    // reported separately, and it is deliberately not part of `ready` above:
    // Render takes a failing health check as a reason to pull traffic and
    // restart the container, and an Anthropic outage is not a reason to do
    // either. See https://render.com/docs/health-checks.
    //
    // `configured` is configuration. `verified` is evidence. They were the
    // same field, which is how this endpoint came to report "not degraded"
    // beside one failed call and no successful ones (D07).
    ai: {
      configured: aiConfigured(),
      // Now means "not known to be working": no key at all, or a run of
      // research jobs that all failed. Never inferred from key presence alone.
      degraded: !aiConfigured() || telemetry.researchHealth().failingSince >= AI_DEGRADED_FAILURES,
      entitlement: entitlement(),
      // Final research outcomes, so "the key is set" is never mistaken for
      // "research works".
      research: telemetry.researchHealth(),
      budget: aibudget.status()
    },
    // Research runs as a bounded job with a durable record, so an operator can
    // see what is waiting, what is running, and the limits in force without
    // reading the logs. Counts and limits only; never what is being researched.
    research: {
      jobs: researchJobs.enabled(),
      limits: researchOp.limits(),
      ...jobs.counts()
    },
    // What the public portal can honestly do on this deployment. Reported
    // rather than assumed, because both of these are "off" by default and a
    // posting published without them behaves differently: no mail means no
    // application flow at all, and no scanner means materials are stored but
    // unreadable. An operator should be able to see that without publishing a
    // posting to find out.
    portal: {
      postings: db.db.searches.filter(s => s.posting?.published).length,
      mail: mailer.status(),
      files: {
        ...applicationFiles.scannerStatus(),
        uploads: applicationFiles.uploadsEnabled(),
        // What the materials are costing, and what the snapshots of them are
        // costing on top. These are the two numbers that decide whether the
        // volume is big enough, and an operator should not have to shell into
        // the container to find them.
        bytes: applicationFileBytes(),
        snapshots: backup.snapshotUsage(db.DATA_DIR),
        keepDays: backup.keepDays()
      },
      applications: (db.db.applications || []).reduce((counts, a) => {
        counts[a.state] = (counts[a.state] || 0) + 1;
        return counts;
      }, {})
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

/**
 * What the volume is carrying, and whether that is a problem.
 *
 * One measurement feeding both answers. dataUsage() samples rather than
 * measures per call, so a monitor polling readiness does not spend a second of
 * disk reads walking every snapshot each time it asks.
 */
function readinessStorage(){
  const usage = backup.dataUsage(db.DATA_DIR);
  const { space, pressured, reasons, copies } = backup.storagePressure(db.DATA_DIR, {
    uploadsEnabled: applicationFiles.uploadsEnabled(), usage
  });
  return { usage, pressure: { space, pressured, reasons, retainedCopies: copies } };
}

function aiConfigured(){
  return Boolean(String(process.env.ANTHROPIC_API_KEY || '').trim());
}

// How many consecutive failed research jobs before AI is called degraded. One
// failure is a bad afternoon at a provider; three in a row with nothing
// succeeding between them is a condition.
const AI_DEGRADED_FAILURES = 3;

/**
 * What is known about model entitlement, which is not knowable from here.
 *
 * A key being present does not mean this account may call the configured
 * model. The check that answers that is the Models API call in
 * scripts/preflight.js, run by an operator against this deployment's own
 * environment — so this reports where the answer comes from rather than
 * implying it already has one.
 */
function entitlement(){
  return {
    checkedHere: false,
    command: 'npm run preflight',
    model: ai.MODEL,
    premiumModel: ai.MODEL,
    note: 'Entitlement is not checked by this endpoint. Run the preflight in this deployment, or read the research outcomes below.'
  };
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

/** What applicant materials occupy on the volume, live rather than in snapshots. */
function applicationFileBytes(){
  const root = applicationFiles.root(db.DATA_DIR);
  let total = 0;
  try {
    for (const dir of fs.readdirSync(root, { withFileTypes: true })) {
      if (!dir.isDirectory()) continue;
      for (const name of fs.readdirSync(path.join(root, dir.name))) {
        try { total += fs.statSync(path.join(root, dir.name, name)).size; }
        catch { /* removed while being counted */ }
      }
    }
  } catch { return 0; }
  return total;
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

/**
 * Remove work nobody came back to.
 *
 * Three things expire, and only one of them used to be cleaned up at all:
 *
 *  - Application drafts, with the files attached to them. These are the reason
 *    this exists. The bytes live on disk rather than in the store, so deleting
 *    the record without deleting the file would leave somebody's resume behind
 *    with nothing pointing at it and nothing ever removing it.
 *  - Candidate questionnaire drafts, which were already treated as spent on
 *    read but stayed in the store for ever.
 *  - Verification challenges and applicant sessions.
 *
 * Deliberately not on the request path. Sweeping on every call would put a
 * whole-store walk in front of ordinary work, which is the mistake the backup
 * used to make.
 */
function sweepExpiredDrafts(){
  let changed = 0;
  try {
    const expired = applications.pruneDrafts(db.db);
    for (const id of expired.ids) applicationFiles.removeAll(db.DATA_DIR, id);
    changed += expired.removed;
    for (const search of db.db.searches) changed += candidates.pruneDrafts(search);
    // Both tables, not just sessions. A sweep that cleared only expired
    // verification challenges would count nothing, skip the persist, and leave
    // the store on disk holding rows this process has already dropped.
    const before = (db.db.applicantSessions?.length || 0) + (db.db.applicantChallenges?.length || 0);
    applicantAccess.prune(db.db);
    changed += before - ((db.db.applicantSessions?.length || 0) + (db.db.applicantChallenges?.length || 0));
    if (changed) db.persist();
  } catch (error) {
    // Never fatal. A sweep that cannot run is a storage problem the alerts
    // already watch for, and it must not take the process down with it.
    console.error('Slate: expiry sweep failed: ' + error.message);
  }
  return changed;
}

function expirySweep(){
  const timer = setInterval(sweepExpiredDrafts, 6 * 60 * 60 * 1000);
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

/* ------------------------------------------------------------------ *
 * The user guide
 *
 * Two projections of one catalog (content/help). The staff guide needs a
 * signed-in reader because it describes the inside of a firm's workspace; the
 * candidate guide is served to the public portal and is built from an
 * allowlist of articles written for applicants, never from the staff guide
 * with things taken out.
 * ------------------------------------------------------------------ */
app.get('/api/help', requireUser, (_req, res) => {
  res.json(help.staffCatalog());
});

app.get('/api/public/help', (_req, res) => {
  // Cacheable, unlike the rest of /api: it is the same content for everybody
  // and it holds nothing about anybody. Short, so a correction reaches readers
  // the same day it is made.
  res.set('Cache-Control', 'public, max-age=300');
  res.json(help.publicCatalog());
});

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
      model: ai.MODEL,
      premium: ai.MODEL,
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
  user.title = req.access.role ? organizations.ROLE_LABEL[req.access.role] : requestedRole === 'candidate' ? 'Candidate' : 'Awaiting access';
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
    redirectUrl: invitationLanding(req)
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
      if (search.intake?.responses) delete search.intake.responses[local.id];
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
      intakeMine: Boolean((intake.responses || {})[req.user.id]?.submitted)
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
    return res.status(400).json({ error:'Choose a search workflow on Search facts.' });
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

app.get('/api/public/project-offer', (_req, res) => res.json(projectBillingModule.publicOffer()));

app.get('/api/searches/:id/payment', ...requireWorkspace, requireSearch, (req, res) => {
  res.json(projectBilling.publicPayment(req.search));
});

app.post('/api/searches/:id/checkout', ...requireWorkspace, requireSearch, async (req, res) => {
  if (!req.access.capabilities.manageMembers) return res.status(403).json({ error: 'A workspace administrator purchases a search.' });
  const origin = String(process.env.SLATE_PUBLIC_URL || '').replace(/\/$/, '');
  if (!/^https:\/\/[^/]+$/.test(origin)) return res.status(503).json({ error: 'Checkout return address is not configured.' });
  try {
    const result = await projectBilling.checkout(req.search, origin);
    res.status(result.status).json(result.payment ? { ...result.payment, reused: result.reused } : result);
  } catch (error) {
    telemetry.log.warn('project-checkout-failed', { searchId: req.search.id, message: error.message });
    res.status(502).json({ error: 'Checkout could not start. Try again or contact support.' });
  }
});

app.post('/api/searches/:id/payment/reconcile', ...requireWorkspace, requireSearch, async (req, res) => {
  if (!db.canEdit(req.search, req.access)) return res.status(403).json({ error: 'Only the search team can check payment.' });
  const p = projectBilling.purchaseFor(req.search);
  if (!p?.checkoutSessionId) return res.json(projectBilling.publicPayment(req.search));
  try { await projectBilling.reconcile(p); res.json(projectBilling.publicPayment(req.search)); }
  catch (error) {
    telemetry.log.warn('project-payment-reconcile-failed', { purchaseId: p.id, message: error.message });
    res.status(502).json({ error: 'Payment verification is unavailable. Please try again.' });
  }
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
    db.rosterChanged(req.search);
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
        redirectUrl: invitationLanding(req, req.search.id)
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
  // The manager has decided this person belongs on the committee. The place is
  // held rather than filled, but the confirmation that said who the committee
  // was is already out of date, and so is a window that was opened under it.
  db.rosterChanged(req.search);
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
  if (req.search.intake?.responses) delete req.search.intake.responses[m.userId];
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
 * has spoken. Closing is what publishes consensus to the room, and nothing is
 * adopted into the profile before it.
 * ------------------------------------------------------------------------- */

/** The tally, named, as every publication decision reads it. */
function tallyOf(search){
  return committee.aggregate(search, id => db.findUserById(id)?.name || '');
}

// The one rule every profile write path answers to (server/committee.js).
const publicationBlock = committee.publicationBlock;

/** The profile that was published, and the state it was published against. */
function recordPublication(search, req, extra){
  search.publication = {
    at: db.now(),
    by: req.user.id,
    byName: req.user.name,
    // Stamped by integrity.reconcile once it knows which revision this became.
    profileRevision: null,
    fingerprint: committee.sourceFingerprint(search),
    criteria: integrity.clone(search.criteria || []),
    ...extra
  };
}

// The common ballot is deliberately separate from private answers and profile
// provenance. Freeze it when collection begins so everyone rates the same list.
app.put('/api/searches/:id/intake/qualities', ...requireWorkspace, requireSearch, requireManager, (req, res) => {
  const intake = req.search.intake;
  if (intake.status !== 'draft' || intake.openedAt || Object.keys(intake.responses || {}).length) {
    return res.status(409).json({ error: 'The shared qualities cannot change after the response window has opened.' });
  }
  const raw = req.body?.qualities;
  if (!Array.isArray(raw) || raw.length > 40 || raw.some(q => !q || !committee.KINDS.includes(q.kind)
      || typeof q.label !== 'string' || !q.label.trim() || q.label.trim().length > 200)) {
    return res.status(400).json({ error: 'Use up to 40 qualities, each with a category and a name of 200 characters or fewer.' });
  }
  intake.qualities = committee.cleanItems(raw).map(({ kind, label }) => ({ kind, label }));
  if ('dueBy' in req.body) intake.dueBy = String(req.body.dueBy || '').slice(0, 120);
  if ('prompt' in req.body) intake.prompt = String(req.body.prompt || '').slice(0, 2000);
  db.touch(req.search, req.user, 'prepared shared qualities for committee ranking');
  db.persist();
  res.json(painted(req, req.search));
});

app.post('/api/searches/:id/intake/status', ...requireWorkspace, requireSearch, requireManager, (req, res) => {
  const want = String(req.body?.status || '');
  if (!['draft', 'open', 'closed'].includes(want)) {
    return res.status(400).json({ error:'Intake is draft, open, or closed.' });
  }
  if (want === 'open' && !req.search.team?.confirmedAt) {
    return res.status(400).json({ error:'Confirm the roster first. People added later would miss the window.' });
  }
  const intake = req.search.intake;
  const agg = tallyOf(req.search);
  if (want === 'closed' && intake.status !== 'closed') {
    // A roster that moved mid-window means the denominator moved. The manager
    // says out loud that this is still the right committee before the answers
    // become the room's, and before anything is built from them.
    if (!req.search.team?.confirmedAt) {
      return res.status(409).json({
        error: 'The roster changed while the window was open. Confirm the roster again before closing intake.',
        code: 'ROSTER_UNCONFIRMED'
      });
    }
    // Finishing with nothing on file is allowed and sometimes right. It is a
    // decision the manager makes and signs, not a step that quietly completes.
    if (!agg.submitted) {
      const reason = String(req.body?.emptyReason || '').trim().slice(0, 400);
      if (!reason) {
        return res.status(409).json({
          error: 'Nobody submitted committee input. Closing now completes this step without it — say why, and it will be recorded as a decision.',
          code: 'EMPTY_INTAKE'
        });
      }
      intake.completedEmpty = { at: db.now(), by: req.user.id, byName: req.user.name, reason };
    } else {
      intake.completedEmpty = null;
    }
  }
  intake.status = want;
  if ('dueBy' in (req.body || {})) intake.dueBy = String(req.body.dueBy || '').slice(0, 120);
  if ('prompt' in (req.body || {})) intake.prompt = String(req.body.prompt || '').slice(0, 2000);
  if (want === 'open') {
    intake.openedAt = db.now();
    intake.closedAt = null;
    intake.rosterChangedAt = null;
    // Reopening collects new input under the normal rules: private until the
    // window closes again. It does not retract the profile already published,
    // and it does not republish through a derived field either — `publication`
    // is the dated snapshot, and the live profile stops being publishable
    // until the window closes.
    if (req.search.publication) req.search.publication.reopenedAt = db.now();
  }
  if (want === 'closed') intake.closedAt = db.now();
  db.touch(req.search, req.user,
    want === 'open' ? 'opened committee intake' :
    want === 'closed' ? (agg.submitted ? 'closed committee intake' : 'completed committee intake without input') :
    'put committee intake back in draft');
  db.persist();
  res.json(painted(req, req.search));
});

/**
 * One member's own intake write.
 *
 * Two different things arrive here. `submitted: false` saves the private
 * working copy and leaves the last committed answer exactly where it is, in
 * the tally (CA-04). `submitted: true` replaces the committed answer.
 *
 * The precondition is this member's own response revision, not the whole
 * search's, so another member submitting does not make an independent answer
 * unsaveable (CA-12). Everything else the search-wide check was doing —
 * workspace, membership, the window being open — is checked here explicitly.
 */
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
        ? 'Intake is closed. Ask the account manager to reopen it. Your answers are still on this page — copy anything you need before leaving.'
        : 'Intake has not opened yet.',
      code: 'INTAKE_SHUT'
    });
  }
  intake.responses ||= {};
  const record = intake.responses[req.user.id] || committee.emptyResponse();
  const claimed = req.body?.responseRevision;
  if (claimed === undefined) {
    // An older client that would write the pre-draft shape back over this
    // record. Refuse it in a way that says what to do about it.
    return res.status(428).json({
      error: 'Reload this page before saving your answers. Slate now keeps your draft and your submitted answers separately.',
      code: 'RESPONSE_REVISION_REQUIRED'
    });
  }
  if (Number(claimed) !== Number(record.revision || 1)) {
    return res.status(409).json({
      error: 'Your answers were changed somewhere else — another tab, or another device. Nothing here was overwritten. '
        + 'Compare the two versions and keep the one you want.',
      code: 'STALE_RESPONSE',
      response: { revision: record.revision || 1, draft: record.draft || null, submitted: record.submitted || null }
    });
  }
  const submitting = Boolean(req.body?.submitted);
  const now = db.now();
  const answer = committee.normalizeAnswer(req.body, submitting ? record.submitted : record.draft, now);
  // An unanswered common quality is not a default vote of 3. Preserve it in
  // private drafts and require an explicit 1–5 rating before submission.
  for (const quality of intake.qualities || []) {
    const key = committee.groupKey(quality.kind, quality.label);
    const raw = (Array.isArray(req.body?.items) ? req.body.items : [])
      .find(i => i && committee.groupKey(i.kind, i.label) === key);
    const weight = Number(raw?.weight);
    const rated = typeof raw?.weight === 'number' && Number.isInteger(weight) && weight >= 1 && weight <= 5;
    if (submitting && !rated) {
      return res.status(400).json({ error: 'Rate every shared quality from 1 to 5 before submitting.' });
    }
    answer.items = answer.items.filter(i => committee.groupKey(i.kind, i.label) !== key);
    answer.items.push({ ...quality, weight: rated ? weight : null, note: String(raw?.note || '').trim().slice(0, 600) });
  }
  if (submitting && !answer.items.length) {
    return res.status(400).json({ error:'Name at least one quality before you submit.' });
  }
  const first = !record.submitted;
  if (submitting) {
    record.submitted = { ...answer, submittedAt: now };
    // The draft has become the submission. Clearing it is what makes the
    // "you have unpublished changes" notice honest afterwards.
    record.draft = null;
    record.withdrawnAt = null;
  } else {
    // An empty draft is a draft, not a withdrawal. Withdrawing is its own
    // action, below.
    record.draft = answer;
  }
  record.revision = Number(record.revision || 1) + 1;
  intake.responses[req.user.id] = record;
  if (submitting) {
    db.touch(req.search, req.user, first ? 'submitted committee input' : 'revised their committee input');
  } else {
    req.search.updatedAt = now;
  }
  db.persist();
  res.json(painted(req, req.search));
});

/**
 * Take a submitted answer back out of the tally, deliberately.
 *
 * Separate from saving a draft, separately explained, and separately
 * recorded — and it marks every profile adopted from that answer as resting on
 * input that has since changed.
 */
app.post('/api/searches/:id/intake/withdraw', ...requireWorkspace, requireSearch, (req, res) => {
  const searchRole = db.memberOf(req.search, req.user.id);
  if (!searchRole) return res.status(403).json({ error:'You are not on this search.' });
  const intake = req.search.intake;
  if (intake.status !== 'open') {
    return res.status(400).json({ error:'Answers can only be withdrawn while the window is open.', code:'INTAKE_SHUT' });
  }
  const record = (intake.responses || {})[req.user.id];
  if (!record || !record.submitted) {
    return res.status(400).json({ error:'You have no submitted answers to withdraw.' });
  }
  // The answer becomes the member's own draft again rather than disappearing:
  // withdrawing is leaving the tally, not destroying what they wrote.
  record.draft = record.draft || { ...record.submitted };
  record.submitted = null;
  record.withdrawnAt = db.now();
  record.revision = Number(record.revision || 1) + 1;
  // Deliberately says nothing about what the answer contained.
  db.touch(req.search, req.user, 'withdrew their committee input from the tally');
  db.persist();
  res.json(painted(req, req.search));
});

/**
 * Build the profile from committee input.
 *
 * `preview: true` returns the decision without making it: what arrives, what
 * changes, what no longer has support, what a consultant wrote and is being
 * kept, and what the five-item cap excludes. Applying requires the fingerprint
 * and profile revision the preview was built from, so a selection cannot be
 * confirmed against input that has moved underneath it (CA-03, CA-06).
 */
app.post('/api/searches/:id/intake/adopt', ...requireWorkspace, requireSearch, requireManager, (req, res) => {
  const blocked = publicationBlock(req.search);
  if (blocked) return res.status(blocked.status).json({ error: blocked.error, code: blocked.code });
  const agg = tallyOf(req.search);
  if (!agg.submitted) {
    return res.status(400).json({ error:'No committee input on file yet. Nothing to adopt.' });
  }
  const fingerprint = committee.sourceFingerprint(req.search);
  const preview = Boolean(req.body?.preview);
  const retain = Array.isArray(req.body?.retain) ? req.body.retain.filter(id => typeof id === 'string').slice(0, 100) : [];
  const retainReasons = (req.body?.retainReasons && typeof req.body.retainReasons === 'object') ? req.body.retainReasons : {};
  const adoptionId = 'ADOPT-' + ((req.search.adoptions || []).length + 1);
  const plan = committee.adoptionPreview(req.search.criteria, agg, {
    retain, retainReasons, adoptionId, at: db.now(), actor: req.user.id
  });

  if (preview) {
    return res.json({
      preview: true,
      fingerprint,
      profileRevision: req.search.profileRevision,
      respondents: agg.submitted,
      participants: agg.asked,
      criteria: plan.criteria,
      changes: plan.changes,
      discussion: plan.discussion,
      // Gaps in the finished profile, and gaps in what the committee covered.
      // "Only one opportunity was nominated" is not "your profile needs two
      // more opportunities" (CA-06).
      gaps: committee.profileGaps(plan.criteria),
      coverage: committee.coverageGaps(agg)
    });
  }

  if (req.body?.fingerprint !== undefined && req.body.fingerprint !== fingerprint) {
    return res.status(409).json({
      error: 'Committee input changed since this preview was built. Review the proposal again before applying it.',
      code: 'STALE_SOURCE', fingerprint
    });
  }
  if (req.body?.profileRevision !== undefined && Number(req.body.profileRevision) !== Number(req.search.profileRevision)) {
    return res.status(409).json({
      error: 'The profile changed since this preview was built. Review the proposal again before applying it.',
      code: 'STALE_PROFILE', profileRevision: req.search.profileRevision
    });
  }
  const invalid = integrity.validateCriteria(plan.criteria);
  if (invalid) return res.status(422).json({ error: 'The profile was not saved: ' + invalid });

  req.search.criteria = plan.criteria;
  req.search.adoptions ||= [];
  req.search.adoptions.push({
    id: adoptionId,
    at: db.now(),
    by: req.user.id,
    byName: req.user.name,
    fingerprint,
    respondents: agg.submitted,
    participants: agg.asked,
    // The evidence each adopted line rested on, frozen here, so renaming or
    // reweighting a criterion later cannot rewrite what the committee said.
    groups: plan.groups,
    selected: plan.criteria.filter(c => c.source?.adoptionId === adoptionId).map(c => ({ id: c.id, key: c.source.key })),
    retained: plan.changes.retained,
    removed: plan.changes.removed,
    excluded: plan.changes.excluded,
    discussion: plan.discussion
  });
  // Superseded adoption records stay: they are the dated evidence for the
  // profile revisions scored against them. Bound the list so one search cannot
  // grow without limit.
  if (req.search.adoptions.length > 25) req.search.adoptions = req.search.adoptions.slice(-25);
  delete req.search.adoptionProvenance;
  recordPublication(req.search, req, { adoptionId, source: 'committee' });
  db.touch(req.search, req.user, 'built the profile from ' + agg.submitted + ' committee submissions');
  db.persist();
  res.json({
    search: painted(req, req.search),
    adoptionId,
    changes: plan.changes,
    discussion: plan.discussion,
    gaps: committee.profileGaps(req.search.criteria),
    coverage: committee.coverageGaps(agg)
  });
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
    // Staff is a workspace fact, not a property of the account record, so it
    // is resolved here and handed over rather than re-derived from a role name.
    viewer: { ...req.user, staff: db.isStaff(req.access) },
    users: db.db.users,
    dataDir: db.DATA_DIR,
    release: RELEASE,
    // Submitted applications only. Drafts are not passed in at all, rather
    // than passed in and filtered downstream: the export module should not be
    // holding an unsent application even for the length of one function.
    applications: applications.submittedFor(db.db, req.search)
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
  if ('package' in body && !Object.hasOwn(db.PACKAGES, body.package)) return res.status(400).json({ error:'Choose a search workflow on Search facts.' });
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
      return res.status(400).json({ error:'Choose a search workflow on Search facts.' });
    }
    if (body.package !== req.search.package) {
      req.search.package = body.package;
      db.touch(req.search, req.user, 'moved the engagement to the ' + db.PACKAGES[body.package].label + ' workflow');
    }
  }
  db.touch(req.search, req.user, 'updated search facts');
  db.persist();
  res.json(painted(req, req.search));
});

app.put('/api/searches/:id/profile', ...requireWorkspace, requireSearch, requireEditor, (req, res) => {
  // The same boundary direct adoption answers to. Saving the profile by hand
  // publishes it to the committee just as surely as adopting does (CA-02).
  const blocked = publicationBlock(req.search);
  if (blocked) return res.status(blocked.status).json({ error: blocked.error, code: blocked.code });
  const criteria = Array.isArray(req.body?.criteria) ? req.body.criteria : [];
  if (criteria.some(c => !c || typeof c !== 'object')) return res.status(400).json({ error:'Invalid profile criterion.' });
  const prior = new Map((req.search.criteria || []).map(c => [c.id, c]));
  const next = criteria.map((c,i) => {
    const was = prior.get(c.id);
    const row = {
      id: c.id || ('X'+(i+1)),
      kind: c.kind || 'skill',
      label: String(c.label||'').trim(),
      weight: clampWeight(c.weight),
      note: String(c.note||''),
      // Kept so the profile page can still show which lines came out of the
      // committee's own words after the consultant has edited around them.
      from: CRIT_SOURCES.has(c.from) ? c.from : 'consultant'
    };
    // Where a line came from is the record's, not the form's. A criterion the
    // consultant renamed keeps the adoption it was created by; a hand-written
    // one cannot acquire provenance by being posted with a source on it
    // (CA-08).
    if (was?.source && was.kind === row.kind) row.source = was.source;
    else if (!was) row.from = row.from === 'committee' ? 'consultant' : row.from;
    return row;
  }).filter(c=>c.label);
  const error = integrity.validateCriteria(next);
  if (error) return res.status(400).json({ error });
  req.search.criteria = next;
  // Saving the profile by hand is the staff review a legacy, unverified
  // provenance was waiting for.
  delete req.search.adoptionProvenance;
  recordPublication(req.search, req, { source: 'consultant' });
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
  // Refused before any provider work, not after paying for it: a draft that
  // could not be applied must not be bought.
  const blockedNow = kind === 'profile' ? publicationBlock(req.search) : null;
  if (blockedNow) return res.status(blockedNow.status).json({ error: blockedNow.error, code: blockedNow.code });
  const aiOperationId = 'gen-' + crypto.randomUUID();
  const reserved = aiAllowance.reserve(req.search, aiOperationId, 'draft');
  if (!reserved.ok) return res.status(reserved.status).json({ code:reserved.code, error:reserved.error });
  if (!reserved.legacy) db.persist();
  const sourceAtStart = kind === 'profile' ? committee.sourceFingerprint(req.search) : null;
  try {
    // The profile draft writes from what the committee said, not from one
    // person's recollection of the workshop. Everything else inherits the
    // profile, so this is the only prompt that needs the room.
    const agg = kind === 'profile'
      ? committee.aggregate(req.search, id => db.findUserById(id)?.name || '')
      : null;
    const room = agg ? committee.packForPrompt(agg) : null;
    const aiStartedAt = Date.now();
    aibudget.begin();
    let out;
    try {
      out = await ai.generate(kind, snapshot, { premium, notes: req.body?.notes||'', committee: room });
      telemetry.recordAi({ ok: true, ms: Date.now() - aiStartedAt, usage: out.usage, kind });
      aibudget.record({ searchId: req.search.id, model: out.model, usage: out.usage, ok: true });
      aiAllowance.settle(aiOperationId, out.model, out.usage, true);
    } catch (error) {
      // Counted even though the work is lost: a failed call can still have
      // been billed, and an outage has to be visible in the numbers.
      telemetry.recordAi({ ok: false, ms: Date.now() - aiStartedAt, kind, code: error.code });
      // Counted with unknown usage: a failed call may still have been billed.
      aibudget.record({ searchId: req.search.id, model: null, usage: null, ok: false });
      aiAllowance.settle(aiOperationId, null, null, true);
      throw error;
    }
    if (!stillAuthorized(req)) {
      return res.status(409).json({ error:'This search was closed to you while the draft was generating. Nothing was saved.' });
    }
    if (req.search.revision !== revision) return res.status(409).json({ error:'This search changed while the draft was generating. The newer work was kept. Reload the search before drafting again.', code:'STALE_SEARCH' });
    if (kind === 'profile') {
      // The window can have reopened, or the roster changed, while the model
      // was writing. Authority, publication status and the input the draft was
      // built from are all rechecked against the record as it is now, not as
      // it was when the request started.
      const blockedNow2 = publicationBlock(req.search);
      if (blockedNow2) return res.status(blockedNow2.status).json({ error: blockedNow2.error, code: blockedNow2.code });
      if (committee.sourceFingerprint(req.search) !== sourceAtStart) {
        return res.status(409).json({
          error: 'Committee input changed while the draft was generating. Nothing was saved. Draft again from the current answers.',
          code: 'STALE_SOURCE'
        });
      }
    }
    const invalid = kind === 'profile' ? integrity.validateCriteria(out.json.criteria)
      : ['survey1', 'survey2'].includes(kind) ? integrity.validateSurvey(out.json) : null;
    if (invalid) return res.status(422).json({ error:'The generated draft was not saved: ' + invalid });
    if (kind === 'profile') {
      // Provenance comes from the tally, never from the model. A `sourceKey`
      // it returns is honoured only when it names a group the committee
      // actually produced; an invented or mismatched one leaves the line
      // marked as a draft with no support claim behind it.
      const bySourceKey = new Map((agg ? committee.KINDS.flatMap(k => agg.byKind[k] || []) : []).map(e => [e.key, e]));
      req.search.criteria = (out.json.criteria||[]).map((c,i)=>{
        const entry = typeof c.sourceKey === 'string' ? bySourceKey.get(c.sourceKey) : null;
        const matches = entry && entry.kind === c.kind;
        return {
          id: c.id || ('X'+(i+1)),
          kind: c.kind,
          label: c.label,
          weight: clampWeight(c.weight),
          note: c.note||'',
          from: matches ? 'committee' : 'draft',
          ...(matches ? { source: { key: entry.key, adoptionId: null, at: db.now(), support: 'current', via: 'draft' } } : {})
        };
      });
      recordPublication(req.search, req, { source: 'draft', model: out.model });
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
      jurisdictionType: req.search.jurisdictionType,
      organizationId: req.search.organizationId,
      refreshEvidence: Boolean(body.refreshEvidence)
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
    fieldEvidence: out.json?.fieldEvidence || {},
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

  const coreLimits = researchOp.limits();
  if (!input.premium) { coreLimits.totalMs = Math.min(coreLimits.totalMs, 90000);
    coreLimits.crawlMs = Math.min(coreLimits.crawlMs, 20000); }
  const op = researchOp.begin({ searchId: req.search.id, limits:coreLimits });
  const reserved = aiAllowance.reserve(req.search, op.id, 'research');
  if (!reserved.ok) { op.end(); return res.status(reserved.status).json({ code:reserved.code, error:reserved.error }); }
  if (!reserved.legacy) db.persist();
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
    if (out?.reused) { aibudget.release(); aiAllowance.settle(op.id, null, null, false); return; }
    telemetry.recordAi({ ok, ms: Date.now() - startedAt, usage: out && out.usage, kind: 'research', code: out && out.code });
    // Recorded on the attempt, and with unknown usage marked as unknown: a
    // failed round may still have been billed.
    aibudget.record({
      searchId: req.search.id,
      model: (out && out.model) || null,
      usage: op.usageKnown ? op.usage : null,
      ok
    });
    aiAllowance.settle(op.id, (out && out.model) || null, op.usageKnown ? op.usage : null, true);
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
/**
 * The half of the check that reads only this process's own store.
 *
 * Split out because it costs nothing and can therefore be run twice: once
 * before the directory lookup, and again in the same synchronous turn as the
 * write. The search can be edited, closed, moved, or deleted while the
 * directory is answering, and the write has to see the store as it is at the
 * moment it happens rather than as it was when the lookup started (D02).
 */
function jobStoreVerdict(job){
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
  if (!projectEntitlements.allows(search, db.db.projectPurchases, 'ai')) {
    return { ok:false, code:'PROJECT_PAYMENT_REQUIRED', error:'This search no longer has AI access.' };
  }
  const user = db.findUserById(job.requestedBy);
  if (!user || !job.requestedByClerkId) {
    return { ok: false, code: 'RESEARCH_UNAUTHORIZED', error: 'The account that started this research is no longer available, so nothing was saved.' };
  }
  if (search.revision !== job.revisionAtStart) {
    return {
      ok: false,
      code: 'STALE_SEARCH',
      error: 'This search changed while research was running. The newer work was kept; review the research before applying it.'
    };
  }
  return { ok: true, search, user };
}

async function authorizeJob(job){
  const local = jobStoreVerdict(job);
  if (!local.ok) return local;
  const access = await auth.accessFor(local.user, job.requestedByClerkId, job.organizationId);
  if (!access || !access.orgId || !access.role || !db.canEdit(local.search, access)) {
    return { ok: false, code: 'RESEARCH_UNAUTHORIZED', error: 'Your access to this search changed while research was running, so nothing was saved.' };
  }
  return {
    ok: true,
    search: local.search,
    user: local.user,
    access,
    /**
     * Confirm, synchronously, immediately before the write.
     *
     * The directory lookup is not repeated: its answer is what this verdict
     * carries, and asking again would only open another await. What is repeated
     * is everything readable from the store, plus the permission that answer
     * grants — so a role the directory reported is still checked against the
     * search as it stands now.
     */
    recheck(){
      const now = jobStoreVerdict(job);
      if (!now.ok) return now;
      if (!db.canEdit(now.search, access)) {
        return { ok: false, code: 'RESEARCH_UNAUTHORIZED', error: 'Your access to this search changed while research was running, so nothing was saved.' };
      }
      return { ok: true, search: now.search, user: now.user, access };
    }
  };
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

/**
 * Reconcile an idempotency key, without starting anything.
 *
 * A browser whose start request was answered but whose answer was lost holds a
 * key and no job id. It cannot poll, and it must not retry the start to find
 * out what happened, because a start request is allowed to create work. This
 * route only reads: it reports the operation that key names, the search's
 * current operation, or that there is none (D03).
 *
 * Registered before the :jobId route so the fixed segment is never read as an
 * id. It shares the status allowance, not the one that bounds paid work.
 */
app.get('/api/searches/:id/research-jobs', ...requireWorkspace, requireSearch, requireEditor, researchStatusLimit, (req, res) => {
  const key = String(req.query.key || req.query.idempotencyKey || '').trim();
  if (key.length > 120) return res.status(400).json({ error: 'That idempotency key is too long.' });
  const byKey = key ? jobs.findByKey(req.search.id, req.user.id, key) : null;
  // The search's own current or latest operation, which is what answers "is
  // anything running on this search?" when the key names nothing.
  const current = jobs.referenceFor(req.search.id);
  res.json({
    // null is a real answer here and means the operation was never recorded:
    // nothing was started, and nothing was billed for this key.
    job: byKey ? jobs.publicJob(byKey, { includeResult: Boolean(byKey.result && byKey.result.reviewable) }) : null,
    matchedKey: Boolean(byKey),
    current
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
  const out = jobs.applyReviewed(job, { search: req.search, user: req.user,
    selectedFields: req.body?.selectedFields });
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

/* ===========================================================================
 * Public postings: the staff side
 *
 * Consultants prepare and preview; the search manager publishes. The split is
 * enforced by the authority table (server/authority.js) rather than by a role
 * check written out here, so the control the client draws and the answer the
 * route gives come from the same statement.
 * ========================================================================= */

// Where a published posting lives, for the address shown to staff. Taken from
// the request rather than configured, so it is right on every host the
// application answers on instead of right on the one somebody remembered.
function publicBase(req){
  const configured = String(process.env.SLATE_PUBLIC_URL || '').trim().replace(/\/+$/, '');
  if (configured) return configured;
  // Fallback only. `req.protocol` is http behind a TLS terminator unless the
  // proxy is trusted, and TRUST_PROXY is not set on the deployment — so
  // without this a consultant would be handed an http:// address to paste
  // into a job advertisement. The forwarded header is read the same way
  // secureCookies() reads it. Set SLATE_PUBLIC_URL in production: the host
  // here is whatever the client sent.
  const scheme = (req.secure || req.get('x-forwarded-proto') === 'https') ? 'https' : req.protocol;
  return scheme + '://' + req.get('host');
}

function invitationLanding(req, searchId) {
  const base = publicBase(req);
  const configured = auth.config.invitationRedirectUrl;
  const url = new URL(configured || '/join', base);
  // Existing deployments used the app homepage as their override. Upgrade
  // that destination too, so fresh emails carry the actual assigned search.
  if (url.origin !== new URL(base).origin || !['/', '/join'].includes(url.pathname)) return url.href;
  url.pathname = '/join';
  url.hash = '';
  url.searchParams.set('organization', req.access.orgId);
  if (searchId) url.searchParams.set('search', searchId);
  return url.href;
}

function postingResponse(req){
  const posting = postings.of(req.search);
  return {
    // Editing a posting is an edit to the search, so it moves the search's
    // revision. Returned here for the same reason every other write returns
    // it: the client holds one revision per search and sends it as the
    // precondition on the next save. Leaving it out would make the save after
    // this one fail as a conflict that never happened.
    revision: req.search.revision,
    ...postings.staffView(posting, {
      searchFrozen: disposition.isFrozen(req.search),
      publicBase: publicBase(req)
    })
  };
}

app.get('/api/searches/:id/posting', ...requireWorkspace, requireSearch, requireEditor, (req, res) => {
  res.json({
    ...postingResponse(req),
    // What the deployment can honestly promise an applicant. The screen warns
    // before publishing rather than after somebody has tried to apply.
    capabilities: {
      mail: mailer.status(),
      files: { ...applicationFiles.scannerStatus(), uploads: applicationFiles.uploadsEnabled() }
    }
  });
});

app.put('/api/searches/:id/posting', ...requireWorkspace, requireSearch, requireEditor, (req, res) => {
  const invalid = postings.validateDraft(req.body);
  if (invalid) return res.status(400).json({ error: invalid });
  const posting = postings.ensure(req.search);
  postings.applyDraft(posting, req.body || {});
  // Saving the draft changes nothing the public can see. Said here because it
  // is the single most useful fact about this screen.
  db.touch(req.search, req.user, 'edited the public posting');
  db.persist();
  res.json(postingResponse(req));
});

app.post('/api/searches/:id/posting/publish', ...requireWorkspace, requireSearch, requireEditor,
  authority.requireAuthority('publishPosting'), (req, res) => {
    const organization = db.findOrganization(req.search.organizationId);
    if (!organization) {
      return res.status(409).json({ error: 'This search has no workspace on record, so it cannot be published. Contact support.' });
    }
    const result = postings.publish(req.search, organization, req.user);
    if (result.error) return res.status(400).json({ error: result.error, missing: result.missing });
    db.touch(req.search, req.user, 'published the public job posting (version ' + result.posting.version + ')');
    db.persist();
    res.json(postingResponse(req));
  });

app.post('/api/searches/:id/posting/state', ...requireWorkspace, requireSearch, requireEditor,
  authority.requireAuthority('publishPosting'), (req, res) => {
    const next = String(req.body?.state || '');
    const result = postings.setState(req.search, next, req.user);
    if (result.error) return res.status(400).json({ error: result.error });
    db.touch(req.search, req.user, 'set the public posting to ' + next);
    db.persist();
    res.json(postingResponse(req));
  });

/* ===========================================================================
 * Applications from the portal: the staff side
 *
 * Only submitted applications are visible here. A draft somebody is still
 * writing is not an application, is not in this list, and is not in an export.
 * ========================================================================= */

function applicationOnSearch(req, res, next){
  const application = applications.byId(db.db, req.params.aid);
  // Scope is checked against the search this route already resolved and
  // authorized, never against anything in the request.
  if (!application
      || application.searchId !== req.search.id
      || application.organizationId !== req.search.organizationId) {
    return res.status(404).json({ error: 'Application not found.' });
  }
  req.application = application;
  next();
}

app.get('/api/searches/:id/applications', ...requireWorkspace, requireSearch, requireEditor, (req, res) => {
  const list = applications.submittedFor(db.db, req.search);
  res.json({
    applications: list.map(a => applications.staffRow(a, req.search)),
    counts: applications.countsFor(db.db, req.search),
    posting: {
      published: Boolean(req.search.posting?.published),
      accepting: postings.acceptsApplications(postings.of(req.search), {
        searchFrozen: disposition.isFrozen(req.search)
      })
    }
  });
});

app.get('/api/searches/:id/applications/:aid', ...requireWorkspace, requireSearch, requireEditor,
  applicationOnSearch, (req, res) => {
    if (req.application.state !== 'submitted') return res.status(404).json({ error: 'Application not found.' });
    res.json(applications.staffView(req.application, req.search, { files: applicationFiles }));
  });

/**
 * One material, for a reviewer.
 *
 * Authorized per request against the search this file belongs to, and refused
 * outright unless a scan has cleared it. An unscanned or quarantined file is
 * not served on the grounds that the reviewer is trusted: the reviewer is not
 * the risk, the file is.
 */
app.get('/api/searches/:id/applications/:aid/files/:fid', ...requireWorkspace, requireSearch, requireEditor,
  applicationOnSearch, (req, res) => {
    const application = req.application;
    if (application.state !== 'submitted') return res.status(404).json({ error: 'Application not found.' });
    const file = (application.submitted.files || []).find(f => f.id === req.params.fid);
    if (!file) return res.status(404).json({ error: 'That file is not on this application.' });
    if (!applicationFiles.readable(file)) {
      return res.status(409).json({
        error: applicationFiles.SCAN_STATES[file.scan.state]?.staff || 'That file is not available.',
        code: 'FILE_NOT_CLEARED',
        scanState: file.scan.state
      });
    }
    let body;
    try { body = applicationFiles.read(db.DATA_DIR, application.id, file); }
    catch { return res.status(410).json({ error: 'That file is no longer in storage.' }); }
    res.set('Content-Type', file.contentType);
    res.set('Content-Disposition', 'attachment; filename="' + file.label.replace(/"/g, '') + '"');
    res.set('Cache-Control', 'no-store, private');
    res.send(body);
  });

/**
 * Bring a submitted application onto the candidate list.
 *
 * The candidate record is built here, in the one place that owns what a
 * candidate is, and the application keeps the link. Reconciliation is never
 * automatic: if this person might already be on the file, the caller has to
 * say they looked.
 */
app.post('/api/searches/:id/applications/:aid/accept', ...requireWorkspace, requireSearch, requireEditor,
  applicationOnSearch, (req, res) => {
    const application = req.application;
    if (application.state !== 'submitted') return res.status(409).json({ error: 'Only a submitted application can be accepted.' });
    const matches = applications.possibleMatches(req.search, application);
    if (matches.length && !req.body?.reconciled) {
      return res.status(409).json({
        error: 'This application may be somebody already on this search. Read both records and confirm before adding a second one.',
        code: 'RECONCILE_FIRST',
        possibleMatches: matches
      });
    }
    const answers = application.submitted.answers;
    const candidate = {
      id: db.nid('c'),
      name: answers.name,
      cur: '',
      org: '',
      yrs: 0,
      email: answers.email,
      stage: 'applicant',
      invite: crypto.randomBytes(24).toString('hex'),
      inviteVersion: 2,
      survey1: null,
      survey2: null,
      survey2SentAt: null,
      survey2Deadline: '',
      addedAt: db.now(),
      // Where this person came from, so the list can say so and an export can
      // distinguish an applicant from somebody a consultant sourced by hand.
      source: 'public-portal',
      applicationId: application.id
    };
    req.search.candidates.push(candidate);
    const accepted = applications.accept(application, candidate.id, req.user);
    if (accepted.error) return res.status(409).json({ error: accepted.error });
    db.touch(req.search, req.user, 'accepted a public application from ' + candidate.name);
    db.persist();
    res.json({ candidateId: candidate.id, search: painted(req, req.search) });
  });

/**
 * Authorise a correction to a submitted application.
 *
 * Follows the questionnaire reopening pattern exactly: the original submission
 * is kept in the record, the applicant can edit and submit again, and the
 * reason is written down. Nothing is edited in place by staff.
 */
app.post('/api/searches/:id/applications/:aid/reopen', ...requireWorkspace, requireSearch, requireEditor,
  applicationOnSearch, (req, res) => {
    const reason = String(req.body?.reason || '').trim();
    if (!reason) return res.status(400).json({ error: 'Record why this application is being reopened.' });
    if (req.application.staff?.acceptedAt) {
      return res.status(409).json({ error: 'This application is already on the candidate list. Correct the candidate record instead.' });
    }
    const result = applications.reopen(req.application, req.user, reason);
    if (result.error) return res.status(409).json({ error: result.error });
    db.touch(req.search, req.user, 'reopened a public application for correction: ' + reason);
    db.persist();
    // The activity entry moved the search's revision; hand it back so the next
    // save from this client is not refused as a conflict.
    res.json({ ok: true, revision: req.search.revision });
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

/* ===========================================================================
 * The public careers portal
 *
 * Everything below this comment is reachable by anybody on the internet with
 * no account. Three rules run through all of it:
 *
 *  - The only records it can reach are published posting snapshots and, once
 *    an address has been verified, that address's own application. It never
 *    takes a search or a candidate as an argument.
 *  - Scope is resolved from the server's own records. A submitted workspace or
 *    search id is not read anywhere in this section.
 *  - A refusal never tells the caller something they did not already know. An
 *    unverified request learns nothing about whether an application exists.
 * ========================================================================= */

function searchFrozenFor(search){
  return disposition.isFrozen(search);
}

/** Resolve a public address to a posting, or null. Archived searches are not consulted. */
function resolvePosting(firmSlug, postingSlug){
  const found = db.findPosting(String(firmSlug || ''), String(postingSlug || ''));
  if (!found) return null;
  const searchFrozen = searchFrozenFor(found.search);
  if (!postings.isLive(found.posting, { searchFrozen })) return null;
  return { ...found, searchFrozen };
}

app.get('/api/public/firms', portalReadLimit, (_req, res) => {
  res.set('Cache-Control', 'public, max-age=60');
  res.json({ firms: db.publishedFirms() });
});

/**
 * The listings.
 *
 * Grouped by firm rather than served as one cross-firm directory: a combined
 * index is a product decision the plan defers, and building one by default
 * would make it by accident.
 */
app.get('/api/public/postings', portalReadLimit, (req, res) => {
  const firm = String(req.query.firm || '').trim();
  const query = String(req.query.q || '').trim().toLowerCase().slice(0, 120);
  const place = String(req.query.location || '').trim().toLowerCase().slice(0, 120);
  if (!firm) return res.status(400).json({ error: 'Name the recruiting firm whose openings you want to see.' });

  const rows = db.livePostings(firm)
    .map(({ search, posting }) => postings.publicSummary(posting, { searchFrozen: searchFrozenFor(search) }))
    .filter(Boolean)
    .filter(row => {
      if (place && !String(row.location || '').toLowerCase().includes(place)) return false;
      if (!query) return true;
      return [row.title, row.employer, row.location].some(v => String(v || '').toLowerCase().includes(query));
    })
    .sort((a, b) => String(b.publishedAt).localeCompare(String(a.publishedAt)));

  const organization = db.publishedFirms().find(f => f.slug === firm) || null;
  // A short cache, because unpublishing has to reach the public quickly. A
  // closed or paused posting stays listed with its state rather than
  // disappearing, so somebody following an advertisement is told what happened
  // instead of getting a page that says the job never existed.
  res.set('Cache-Control', 'public, max-age=60');
  res.json({ firm: organization, postings: rows });
});

app.get('/api/public/postings/:firmSlug/:postingSlug', portalReadLimit, (req, res) => {
  const found = resolvePosting(req.params.firmSlug, req.params.postingSlug);
  if (!found) return res.status(404).json({ error: 'That opening is not available.' });
  const view = postings.publicView(found.posting, { searchFrozen: found.searchFrozen });
  res.set('Cache-Control', 'public, max-age=60');
  res.json({
    posting: view,
    firm: { slug: found.posting.published.firmSlug, name: found.organization?.name || 'Recruiting firm' },
    // What this deployment can actually do, so the page offers an application
    // flow only when it can complete one. Collecting an address and then
    // failing to send a code is the outcome this prevents.
    apply: {
      available: view.accepting && mailer.configured(),
      reason: !view.accepting
        ? (view.state === 'paused'
          ? 'This posting is not accepting applications right now.'
          : 'This posting is closed to new applications.')
        : (mailer.configured() ? null : 'Online applications are not available on this service yet. Use the contact below to reach the search team.'),
      uploads: applicationFiles.uploadsEnabled()
    }
  });
});

/* --- applicant identity ------------------------------------------------- */

// Attach the verified applicant, if the request carries a live session. Never
// refuses: the routes that need one say so themselves, so a read can decide
// what to show rather than being bounced.
function readApplicant(req, _res, next){
  const token = applicantAccess.readCookie(req);
  const found = token ? applicantAccess.readSession(db.db, token) : null;
  req.applicant = found?.applicant || null;
  req.applicantToken = found ? token : null;
  next();
}

function requireApplicant(req, res, next){
  if (!req.applicant) {
    return res.status(401).json({
      error: 'Verify your email address to open your application.',
      code: 'VERIFY_REQUIRED'
    });
  }
  next();
}

function secureCookies(req){
  return req.secure || req.get('x-forwarded-proto') === 'https';
}

/**
 * Ask for a verification code.
 *
 * Answers identically whatever the address, whether or not it has ever applied
 * for anything, and whether or not the mail actually went out. The only way to
 * learn that an address has an application is to read the code sent to it.
 */
app.post('/api/applications/verify/start', verifyLimit, verifyAddressLimit, async (req, res) => {
  const email = String(req.body?.email || '');
  const same = {
    ok: true,
    message: 'If that address can apply, a code is on its way. It expires in '
      + Math.round(applicantAccess.CODE_TTL_MS / 60000) + ' minutes.'
  };
  if (!applicantAccess.validEmail(email)) {
    return res.status(400).json({ error: 'Enter an email address you can receive mail at.' });
  }
  if (!mailer.configured()) {
    return res.status(503).json({
      error: 'Online applications are not available on this service yet. Use the contact on the posting to reach the search team.',
      code: 'MAIL_UNAVAILABLE'
    });
  }
  // The posting is named only so the message can say which job it is about. It
  // grants nothing and is not trusted for scope.
  const found = req.body?.firmSlug && req.body?.postingSlug
    ? resolvePosting(req.body.firmSlug, req.body.postingSlug) : null;
  const title = found ? found.posting.published.fields.title : null;

  const started = applicantAccess.startChallenge(db.db, email);
  db.persist();
  const message = mailer.verificationMessage({
    code: started.code, posting: title, minutes: started.expiresInMinutes
  });
  const sent = await mailer.deliver({ to: applicantAccess.normalizeEmail(email), ...message });
  if (!sent.accepted) {
    return res.status(503).json({
      error: 'The code could not be sent. Use the contact on the posting to reach the search team.',
      code: 'MAIL_UNAVAILABLE'
    });
  }
  // The test transport hands the message back so an automated test can finish
  // a verification without a mailbox. It exists for that and nothing else:
  // server/mailer.js resolves the transport to "none" under NODE_ENV
  // production whatever the environment says, so this branch cannot be reached
  // by a deployment and cannot be switched on by configuration alone.
  if (mailer.transportName() === 'echo') return res.json({ ...same, testMessage: sent.body });
  res.json(same);
});

app.post('/api/applications/verify/confirm', verifyLimit, (req, res) => {
  const email = String(req.body?.email || '');
  if (!applicantAccess.validEmail(email)) {
    return res.status(400).json({ error: 'Enter the address the code was sent to.' });
  }
  const result = applicantAccess.verifyChallenge(db.db, email, req.body?.code);
  if (result.error) {
    db.persist();
    return res.status(400).json({ error: result.error });
  }
  db.persist();
  res.set('Set-Cookie', applicantAccess.cookieHeader(result.token, { secure: secureCookies(req) }));
  res.json({ ok: true, email: result.applicant.email });
});

app.post('/api/applications/signout', readApplicant, (req, res) => {
  if (req.applicantToken) {
    applicantAccess.revokeSession(db.db, req.applicantToken);
    db.persist();
  }
  res.set('Set-Cookie', applicantAccess.clearCookieHeader({ secure: secureCookies(req) }));
  res.json({ ok: true });
});

app.get('/api/applications/session', portalReadLimit, readApplicant, (req, res) => {
  res.json({ verified: Boolean(req.applicant), email: req.applicant?.email || null });
});

/* --- one applicant's application ---------------------------------------- */

/**
 * The applicant's application to one posting.
 *
 * Both the address and the session have to agree before anything is returned,
 * and the application is found by (applicant, search) rather than by an id in
 * the URL, so there is no id to guess.
 */
app.get('/api/applications/:firmSlug/:postingSlug', readApplicant, applicationLimit, requireApplicant, (req, res) => {
  const found = resolvePosting(req.params.firmSlug, req.params.postingSlug);
  if (!found) return res.status(404).json({ error: 'That opening is not available.' });
  const application = applications.forApplicant(db.db, {
    applicantId: req.applicant.id, searchId: found.search.id
  });
  if (!application) return res.json({ application: null, accepting: postings.acceptsApplications(found.posting, { searchFrozen: found.searchFrozen }) });
  // A posting edited since this draft began. Told about on the read, not
  // sprung at submit time.
  const drift = application.state === 'draft'
    ? applications.formDrift(application.form, found.posting) : { changed: false };
  res.json({
    application: applications.applicantView(application, { files: applicationFiles }),
    accepting: postings.acceptsApplications(found.posting, { searchFrozen: found.searchFrozen }),
    formChanged: drift.changed ? {
      material: drift.material,
      added: (drift.added || []).map(q => q.prompt),
      nowRequired: (drift.nowRequired || []).map(q => q.prompt),
      removed: (drift.removed || []).map(q => q.prompt),
      reworded: (drift.reworded || []).length,
      materials: (drift.materials || []).map(m => m.label)
    } : null
  });
});

app.post('/api/applications/:firmSlug/:postingSlug/start', readApplicant, applicationLimit, requireApplicant, (req, res) => {
  const found = resolvePosting(req.params.firmSlug, req.params.postingSlug);
  if (!found) return res.status(404).json({ error: 'That opening is not available.' });
  if (!postings.acceptsApplications(found.posting, { searchFrozen: found.searchFrozen })) {
    return res.status(409).json({
      error: 'This posting is not accepting applications.',
      support: postings.publicView(found.posting, { searchFrozen: found.searchFrozen })?.support || null
    });
  }
  const result = applications.start(db.db, {
    search: found.search, posting: found.posting,
    applicant: req.applicant, prefillEmail: req.applicant.email
  });
  if (result.error) return res.status(409).json({ error: result.error });
  db.persist();
  res.json({ application: applications.applicantView(result.application, { files: applicationFiles }) });
});

/**
 * Every write below is addressed by application id and then checked against
 * the session. The id is generated and unguessable, but that is not what makes
 * this safe — the ownership check is.
 */
function requireOwnApplication(req, res, next){
  const application = applications.byId(db.db, req.params.appId);
  if (!application || application.applicantId !== req.applicant.id) {
    return res.status(404).json({ error: 'That application is not on this account.' });
  }
  const search = db.findSearch(application.searchId);
  if (!search) return res.status(410).json({ error: 'That opening is no longer available.' });
  req.ownApplication = application;
  req.applicationSearch = search;
  req.applicationPosting = postings.of(search);
  next();
}

app.put('/api/applications/:appId', readApplicant, applicationLimit, requireApplicant, requireOwnApplication, (req, res) => {
  const result = applications.saveDraft(req.ownApplication, req.body || {});
  if (result.error) return res.status(409).json({ error: result.error });
  db.persist();
  res.json({
    ok: true,
    savedAt: result.application.updatedAt,
    expiresAt: result.application.expiresAt,
    missing: applications.missingFor(result.application)
  });
});

/** Accept a posting's changed form onto this draft, keeping every answer. */
app.post('/api/applications/:appId/adopt-form', readApplicant, applicationLimit, requireApplicant, requireOwnApplication, (req, res) => {
  if (req.ownApplication.state !== 'draft') return res.status(409).json({ error: 'This application was already submitted.' });
  const result = applications.adoptForm(req.ownApplication, req.applicationPosting);
  db.persist();
  res.json({
    ok: true,
    application: applications.applicantView(result.application, { files: applicationFiles })
  });
});

app.post('/api/applications/:appId/files', readApplicant, uploadLimit, requireApplicant, requireOwnApplication, (req, res) => {
  const application = req.ownApplication;
  if (application.state !== 'draft') return res.status(409).json({ error: 'This application was already submitted.' });
  const checked = applicationFiles.validate({
    filename: req.body?.filename,
    contentType: req.body?.contentType,
    data: req.body?.data,
    existing: (application.files || []).length
  });
  if (checked.error) return res.status(400).json({ error: checked.error });

  let record;
  try {
    record = applicationFiles.store(db.DATA_DIR, application.id, {
      type: checked.type, buffer: checked.buffer,
      filename: req.body?.filename, materialKey: req.body?.materialKey
    });
  } catch (error) {
    console.error('[' + req.ref + '] application file write failed: ' + error.message);
    return res.status(503).json({ error: 'That file could not be stored. Try again in a moment.' });
  }
  application.files ||= [];
  application.files.push(record);
  application.updatedAt = db.now();
  db.persist();
  res.json({
    ok: true,
    file: applicationFiles.applicantView(record),
    missing: applications.missingFor(application)
  });
});

app.delete('/api/applications/:appId/files/:fid', readApplicant, applicationLimit, requireApplicant, requireOwnApplication, (req, res) => {
  const application = req.ownApplication;
  if (application.state !== 'draft') return res.status(409).json({ error: 'This application was already submitted.' });
  const file = (application.files || []).find(f => f.id === req.params.fid);
  if (!file) return res.status(404).json({ error: 'That file is not on this application.' });
  application.files = application.files.filter(f => f !== file);
  applicationFiles.remove(db.DATA_DIR, application.id, file);
  application.updatedAt = db.now();
  db.persist();
  res.json({ ok: true, missing: applications.missingFor(application) });
});

/**
 * Submit.
 *
 * The posting state, the deadline, and the form version are all re-checked
 * here rather than trusted from when the page was drawn. Everything the commit
 * touches is in memory until one persist, so a retry either finds the
 * application already submitted — and gets the same receipt — or finds it
 * untouched. A failed confirmation email is recorded and changes nothing: the
 * application is received either way.
 */
app.post('/api/applications/:appId/submit', readApplicant, applicationLimit, requireApplicant, requireOwnApplication, async (req, res) => {
  const application = req.ownApplication;
  const posting = req.applicationPosting;
  if (searchFrozenFor(req.applicationSearch)) {
    return res.status(409).json({
      error: 'This search has ended and is no longer accepting applications. Nothing you wrote has been lost, and it has not been submitted.',
      code: 'POSTING_CLOSED'
    });
  }
  const result = applications.submit(application, {
    posting,
    timezone: posting.published?.fields?.deadline?.timezone || null
  });
  if (result.duplicate) {
    return res.json({ ok: true, duplicate: true, receipt: result.receipt,
      message: 'This application was already received. Nothing was sent twice.' });
  }
  if (result.closed) {
    return res.status(409).json({ error: result.error, code: 'POSTING_CLOSED',
      support: postings.publicView(posting, {})?.support || null });
  }
  if (result.formChanged) {
    return res.status(409).json({ error: result.error, code: 'FORM_CHANGED', drift: result.drift });
  }
  if (result.error) {
    return res.status(400).json({ error: result.error, missing: result.missing, receipt: result.receipt });
  }

  db.touch(req.applicationSearch,
    { name: application.submitted.answers.name, id: null, role: 'applicant' },
    'submitted a public application');
  db.persist();

  // After the commit, and never allowed to undo it.
  const receipt = result.receipt;
  const message = mailer.receiptMessage({
    reference: receipt.reference,
    posting: posting.published?.fields?.title || null,
    submittedAt: receipt.submittedAt,
    returnUrl: publicBase(req) + '/careers/' + posting.published.firmSlug + '/' + posting.slug
  });
  let delivery = null;
  try { delivery = await mailer.deliver({ to: req.applicant.email, ...message }); }
  catch (error) { console.error('[' + req.ref + '] receipt mail failed: ' + error.message); }

  res.json({
    ok: true,
    receipt,
    // Said plainly rather than implied by the absence of a message: the
    // application is received whether or not the confirmation reached them.
    confirmationSent: Boolean(delivery?.accepted),
    confirmationNote: delivery?.accepted
      ? 'A confirmation has been sent to ' + req.applicant.email + '.'
      : 'Your application was received. A confirmation email could not be sent, so keep the reference number above.'
  });
});

/* --- the portal pages ---------------------------------------------------- */

function careersPage(_req, res){
  // No bearer token in these addresses, so they may be cached as an ordinary
  // shell. The application data behind them is not.
  res.sendFile(path.join(__dirname, '..', 'public', 'careers.html'));
}

app.get('/careers', portalReadLimit, careersPage);
app.get('/careers/:firmSlug', portalReadLimit, careersPage);
app.get('/careers/:firmSlug/:postingSlug', portalReadLimit, careersPage);
app.get('/careers/:firmSlug/:postingSlug/apply', portalReadLimit, (_req, res) => {
  // The application itself is private. It must not be cached on a borrowed
  // computer, and it must not be indexed.
  res.set('Cache-Control', 'no-store, private');
  res.set('X-Robots-Tag', 'noindex, nofollow');
  res.sendFile(path.join(__dirname, '..', 'public', 'careers.html'));
});

// Real authentication paths let Clerk keep verification and callback steps on
// the same page. They never enter the offline shell cache.
app.get('/subscriptions', (_req, res) => res.redirect(308, '/pricing'));
app.get(['/join', '/join/*path', '/sign-up', '/sign-up/*path', '/sign-in', '/sign-in/*path', '/pricing', '/how-it-works'], (_req, res) => {
  res.set('Cache-Control', 'no-store, private');
  res.sendFile(path.join(__dirname, '..', 'public', 'index.html'));
});

const billingReadLimit = http.limiter({ windowMs: 60000, max: 60, key: req => req.ip,
  message: 'Too many billing requests. Please try again shortly.' });
app.get('/api/public/billing/plans', billingReadLimit, async (_req, res) => {
  try { res.json(await billing.catalog()); }
  catch (error) { res.status(503).json({ error: error.message }); }
});
app.get('/api/billing/subscription', requireOrgAdmin, billingReadLimit, async (req, res) => {
  // Never accept a payer or organization id from a query string or request body.
  try { res.json(await billing.subscription(req.access.orgId)); }
  catch (error) { res.status(503).json({ error: error.message }); }
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
  // Said once, loudly, at the only moment somebody is reading the boot log.
  const identity = releaseIdentity();
  if (!RELEASE_STAMPED && process.env.NODE_ENV === 'production') {
    console.warn('Slate: neither SLATE_RELEASE nor RENDER_GIT_COMMIT is set, so this container '
      + 'reports its release as "dev". Build with --build-arg SLATE_RELEASE=$COMMIT_SHA; without it '
      + 'a running service cannot be matched to the code it was built from.');
  }
  if (!identity.agrees) {
    // This is the D08 condition: the image says one commit and the deploy says
    // another. Exactly one of them describes the running code, and which one is
    // not knowable from in here.
    console.warn('Slate: release identity disagrees. The image was stamped ' + identity.build
      + ' and the platform reports ' + identity.platform + '. One of them is stale — usually a '
      + 'SLATE_RELEASE deployment variable set by hand. Clear it and let the build stamp the image.');
    telemetry.log.warn('release-identity-mismatch', { build: identity.build, platform: identity.platform });
  }
  // The Dockerfile and CI pin the supported major. A local runtime below it
  // still starts, because refusing to boot over it would help nobody, but it
  // is said out loud: a difference between what you are testing on and what
  // production runs is worth knowing before it explains a bug.
  if (ENGINE_FLOOR && Number(process.versions.node.split('.')[0]) < ENGINE_FLOOR) {
    console.warn('Slate: Node ' + process.versions.node + ' is below the supported floor (>=' + ENGINE_FLOOR
      + '). Production runs Node ' + ENGINE_FLOOR + '; behaviour here may not match it.');
  }
  console.log('Default model:', ai.MODEL);
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
  // Whether this volume is plausibly big enough for what the deployment is
  // configured to put on it. Said once, at startup, because the moment to find
  // out is before a posting is published — not when a save starts failing
  // because the disk filled with copies of other people's resumes.
  try {
    const pressure = backup.storagePressure(db.DATA_DIR, {
      uploadsEnabled: applicationFiles.uploadsEnabled()
    });
    if (pressure.space) {
      console.log('Storage: ' + Math.round(pressure.usage.totalBytes / 1e6) + ' MB used of '
        + Math.round(pressure.space.totalBytes / 1e6) + ' MB; retention holds up to ' + pressure.copies + ' snapshots');
    }
    for (const reason of pressure.reasons) console.warn('Slate: storage pressure — ' + reason + '.');
  } catch (error) {
    console.error('Slate: could not measure storage. ' + error.message);
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
  // Webhooks are the primary fulfillment path. Recheck pending sessions after
  // restart and while the buyer is away so a lost callback cannot strand access.
  if (process.env.STRIPE_SECRET_KEY) {
    let running = false;
    const reconcilePending = async () => {
      if (running) return;
      running = true;
      try {
        const pending = db.db.projectPurchases.filter(p => p.checkoutSessionId
          && ['checkout-open', 'processing'].includes(p.state)).slice(0, 10);
        for (const p of pending) {
          try { await projectBilling.reconcile(p); }
          catch (error) { telemetry.log.warn('project-payment-reconcile-failed', { purchaseId:p.id, message:error.message }); }
        }
      } finally { running = false; }
    };
    setImmediate(reconcilePending);
    setInterval(reconcilePending, 60000).unref();
  }
  telemetry.watchEventLoop();
  watchAlerts();
  sweepExpiredDrafts();
  expirySweep();
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
