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
const cookieParser = require('cookie-parser');
const crypto = require('crypto');
const db = require('./db');
const ai = require('./ai');
const committee = require('./committee');
const integrity = require('./integrity');
const credentials = require('./credentials');
const jurisdictions = require('./jurisdictions');
const http = require('./http');
const media = require('./media');
const recovery = require('./recovery');
const telemetry = require('./telemetry');
const exporter = require('./export');
const {
  assembleBrochure, applyBrochureDefaults, packTheme, packScheme,
  PLACE_FIELDS, GOV_FIELDS, PACK_THEMES, PACK_SCHEMES
} = require('./brochure');

const app = express();
const PORT = Number(process.env.PORT || 4173);
const HOST = process.env.HOST || '0.0.0.0';
const COOKIE = 'slate_sid';
const isProd = process.env.NODE_ENV === 'production';
// Stamped into the image by CI (--build-arg SLATE_RELEASE). Lets an operator
// confirm which commit a running container was built from, which is what makes
// a rollback decision checkable rather than assumed.
const RELEASE = String(process.env.SLATE_RELEASE || '').trim() || 'dev';
const showDemoLogins = !isProd && process.env.SHOW_DEMO_LOGINS !== 'false';
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

app.use(cookieParser());

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

// Refuse cookie-authenticated mutations that a browser did not initiate from
// this origin. Registered before any route so it covers login and logout too.
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

const SESSION_MS = db.SESSION_MS;
const loginHits = new Map();

function clientIp(req){
  return String(req.ip || req.socket?.remoteAddress || 'unknown');
}

function loginBlocked(ip){
  const now = Date.now();
  const row = loginHits.get(ip);
  if (!row) return false;
  if (row.until && now < row.until) return true;
  if (row.until && now >= row.until) loginHits.delete(ip);
  return false;
}

function loginFail(ip){
  const now = Date.now();
  const row = loginHits.get(ip) || { n: 0, until: 0, ts: now };
  if (row.until && now >= row.until) { row.n = 0; row.until = 0; }
  row.n += 1;
  row.ts = now;
  if (row.n >= 8) row.until = now + 15 * 60 * 1000;
  loginHits.set(ip, row);
}

function loginOk(ip){ loginHits.delete(ip); }

const LOGIN_HITS_IDLE_MS = 60 * 60 * 1000;
setInterval(() => {
  const now = Date.now();
  for (const [ip, row] of loginHits) {
    if (!row.until && now - row.ts > LOGIN_HITS_IDLE_MS) loginHits.delete(ip);
  }
}, 15 * 60 * 1000).unref();

/**
 * Consensus is only assembled for people entitled to read the room.
 *
 * A consultant facilitating the search sees it as answers come in. Everybody
 * else sees it once the manager closes the window, so nobody can watch the
 * tally move and time their own submission against it.
 */
function consensusFor(search, user){
  const closed = (search.intake || {}).status === 'closed';
  if (!db.isConsultant(user) && !(closed && db.memberOf(search, user.id))) return null;
  return committee.aggregate(search, id => {
    const u = db.findUserById(id);
    return u ? u.name : 'Removed member';
  });
}

function painted(req, search){
  const out = db.decorate(search, req.user);
  out.consensus = consensusFor(search, req.user);
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

function sid(){ return crypto.randomBytes(24).toString('hex'); }

function cookieOpts(){
  return {
    httpOnly: true,
    sameSite: 'lax',
    secure: isProd,
    path: '/',
    maxAge: SESSION_MS
  };
}

function currentUser(req){
  const id = req.cookies[COOKIE];
  const sess = id && db.db.sessions[id];
  if (!sess) return null;
  if (!Number.isFinite(sess.exp) || Date.now() > sess.exp) {
    delete db.db.sessions[id];
    db.persist();
    return null;
  }
  const user = db.findUserById(sess.userId);
  // Disabling revokes sessions, but this is checked on every request as well:
  // a session restored from a backup, or written by an older release, must not
  // outlive the decision to withdraw someone's access.
  if (!user || db.isDisabled(user)) {
    delete db.db.sessions[id];
    db.persist();
    return null;
  }
  return user;
}

function requireUser(req, res, next){
  const u = currentUser(req);
  if (!u) return res.status(401).json({ error:'Sign in required.' });
  req.user = u;
  next();
}

function clampWeight(w){
  const n = (w === '' || w === null || w === undefined) ? 3 : Number(w);
  return Math.max(1, Math.min(5, Number.isFinite(n) ? n : 3));
}

// Where a profile line came from: the committee's own submissions, a Claude
// draft, or the consultant typing it. Shown on the profile page so nobody has
// to remember which lines carry the room behind them.
const CRIT_SOURCES = new Set(['committee', 'draft', 'consultant']);

function requireSearch(req, res, next){
  const s = db.findSearch(req.params.id);
  if (!s) return res.status(404).json({ error:'Search not found.' });
  // A committee member seated on a different search must not learn this one
  // exists, so an unauthorized read looks the same as a missing file.
  if (!db.canView(s, req.user)) return res.status(404).json({ error:'Search not found.' });
  req.search = s;
  if (!['GET', 'HEAD'].includes(req.method) && req.headers['if-match'] === undefined) {
    return res.status(428).json({ error:'Reload this search before saving.', code:'REVISION_REQUIRED' });
  }
  if (!['GET', 'HEAD'].includes(req.method) && req.headers['if-match'] !== undefined
      && req.headers['if-match'] !== String(s.revision)) {
    return res.status(409).json({ error:'This search changed since you opened it. Your edits were not saved. Copy your edits, then reload the search and try again.', code:'STALE_SEARCH' });
  }
  next();
}

/** Writing to the search file is the firm's work, not the committee's. */
function requireEditor(req, res, next){
  if (!db.canEdit(req.search, req.user)) {
    return res.status(403).json({ error:'Committee members read the search file. A consultant edits it.' });
  }
  next();
}

/** Rostering, the intake window, and adoption sit with the account manager. */
function requireManager(req, res, next){
  if (!db.canManage(req.search, req.user)) {
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
    ai: { configured: aiConfigured(), degraded: !aiConfigured() },
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
    demoLogins: showDemoLogins,
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
  if (showDemoLogins) {
    // Only the firm's own seats. Committee accounts are created per search with
    // a generated PIN, and listing those on the sign-in page would hand anyone
    // who opens the app a way into a live client's search.
    body.accounts = db.db.users.filter(u => u.role === 'consultant').map(u => ({
      email: u.email, pin: demoPin(u), name: u.name, title: u.title
    }));
  }
  res.json(body);
});

function demoPin(user) {
  const env = { u0: ['TEAM', '1234'], u1: ['ABE', '2468'], u2: ['MIKE', '1357'] }[user.id];
  if (!env) return undefined;
  const pin = process.env['SLATE_PIN_' + env[0]] || env[1];
  return credentials.verify(user, pin) ? pin : undefined;
}

app.post('/api/login', (req, res) => {
  const ip = clientIp(req);
  const { email, pin } = req.body || {};
  const account = 'account:' + String(email || '').trim().toLowerCase().slice(0, 254);
  if (loginBlocked(ip) || loginBlocked(account)) {
    return res.status(429).json({ error:'Too many sign-in attempts. Wait a few minutes.' });
  }
  const u = db.findUserByEmail(email);
  // A disabled account still verifies its credential before being refused, so
  // the response and its timing do not reveal which accounts exist.
  if (!credentials.verify(u, typeof pin === 'string' ? pin : '') || db.isDisabled(u)) {
    loginFail(ip);
    loginFail(account);
    return res.status(401).json({ error:'Email or PIN is not right.' });
  }
  loginOk(ip);
  loginOk(account);
  const id = sid();
  db.db.sessions[id] = { userId: u.id, at: db.now(), exp: Date.now() + SESSION_MS };
  db.persist();
  res.cookie(COOKIE, id, cookieOpts());
  res.json({ user: db.publicUser(u) });
});

app.post('/api/logout', (req, res) => {
  const id = req.cookies[COOKIE];
  if (id) delete db.db.sessions[id];
  db.persist();
  res.clearCookie(COOKIE, { httpOnly: true, sameSite: 'lax', secure: isProd, path: '/' });
  res.json({ ok: true });
});

// The directory a viewer needs to put names to ids. Consultants work across the
// whole book; a committee member only ever needs the people seated beside them.
function visibleUsers(user){
  if (db.isConsultant(user)) return db.db.users;
  const ids = new Set([user.id]);
  for (const s of db.db.searches) {
    if (!db.memberOf(s, user.id)) continue;
    for (const m of s.members || []) ids.add(m.userId);
  }
  return db.db.users.filter(u => ids.has(u.id));
}

app.get('/api/me', requireUser, (req, res) => {
  res.json({
    user: db.publicUser(req.user),
    users: visibleUsers(req.user).map(db.publicUser),
    health: {
      model: process.env.CLAUDE_MODEL || 'claude-sonnet-5',
      premium: process.env.CLAUDE_MODEL_PREMIUM || 'claude-opus-5',
      hasKey: Boolean(String(process.env.ANTHROPIC_API_KEY || '').trim())
    }
  });
});

app.get('/api/searches', requireUser, (req, res) => {
  res.json(db.db.searches.filter(s => db.canView(s, req.user)).map(s => {
    const d = db.decorate(s, req.user);
    const seat = db.memberOf(s, req.user.id);
    const intake = s.intake || {};
    return {
      id:s.id, no:s.no, client:s.client, position:s.position, state:s.state, jurisdictionType:s.jurisdictionType,
      package: d.package, packageLabel: d.packageInfo.label,
      fog:s.fog, opened:s.opened, updatedAt:s.updatedAt,
      progress: d.progress,
      accountManager: d.accountManager ? { name: d.accountManager.name, init: d.accountManager.init } : null,
      seats: (s.members || []).length,
      seat: seat ? seat.seat : null,
      // Drives the "you owe them an answer" prompt on Home. A member should not
      // have to open every search to find the one waiting on them.
      intakeOpen: intake.status === 'open',
      intakeDue: intake.dueBy || '',
      intakeMine: Boolean(((intake.submissions || {})[req.user.id] || {}).submitted)
    };
  }).sort((a,b)=> (b.updatedAt||'').localeCompare(a.updatedAt||'')));
});

app.post('/api/searches', requireUser, (req, res) => {
  if (req.user.role !== 'consultant') return res.status(403).json({ error:'The consultant opens a search.' });
  const body = req.body || {};
  if (body.jurisdictionType !== undefined && (typeof body.jurisdictionType !== 'string' || !Object.hasOwn(jurisdictions.TYPES, body.jurisdictionType))) return res.status(400).json({ error:'Choose City or town, or County.' });
  if (!String(body.client || '').trim() || !String(body.position || '').trim()) {
    return res.status(400).json({ error:'Client and position are required.' });
  }
  if (body.package !== undefined && body.package !== '' && !Object.hasOwn(db.PACKAGES, body.package)) {
    return res.status(400).json({ error:'Pick a package: Basic, Enhanced, or Executive.' });
  }
  const s = db.blankSearch(body, req.user);
  s.no = db.nextNo();
  db.db.searches.unshift(s);
  db.persist();
  res.json(painted(req, s));
});

app.get('/api/searches/:id', requireUser, requireSearch, (req, res) => {
  res.json(painted(req, req.search));
});

/* ---------------------------------------------------------------------------
 * Step 1 — the roster
 *
 * A search has one account manager and any number of consultants and committee
 * members. Seating someone who has no account creates one and returns a PIN
 * once; there is no mail server here, so the manager reads it to them.
 * ------------------------------------------------------------------------- */

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function rosterOnly(search){
  return { roster: db.roster(search), accountManager: db.accountManager(search) };
}

app.post('/api/searches/:id/members', requireUser, requireSearch, requireManager, (req, res) => {
  const b = req.body || {};
  const seat = committee.seatOf(b.seat);
  const name = String(b.name || '').trim();
  const email = String(b.email || '').trim().toLowerCase();
  if (!name) return res.status(400).json({ error:'Name is required.' });
  if (!EMAIL_RE.test(email)) return res.status(400).json({ error:'Enter a working email. It is their sign-in.' });

  let user = db.findUserByEmail(email);
  let pin = null;
  if (user) {
    if (String(user.name || '').trim() !== name) {
      return res.status(409).json({
        error: email + ' already signs in as ' + user.name + '. Seat them under that name, or use a different email.'
      });
    }
  } else {
    // Only the firm seats consultants. A manager rostering a client contact
    // cannot mint a colleague with run-of-the-app powers.
    const created = db.createUser({ name, email, title: b.title, role: 'committee' });
    user = created.user;
    pin = created.pin;
  }
  if (db.memberOf(req.search, user.id)) {
    return res.status(409).json({ error: name + ' is already seated on this search.' });
  }
  if (seat === 'manager') {
    return res.status(400).json({ error:'Seat them first, then hand over the account.' });
  }
  req.search.members.push({ userId: user.id, seat, addedAt: db.now(), addedBy: req.user.id });
  // The roster changed, so a confirmation given before this person existed no
  // longer describes the committee. Ask for it again.
  req.search.team = { confirmedAt: null, confirmedBy: null };
  db.touch(req.search, req.user, 'seated ' + name + ' as ' + committee.SEAT_LABEL[seat].toLowerCase());
  db.persist();
  res.json({ search: painted(req, req.search), ...rosterOnly(req.search), pin, email: user.email });
});

// Seat changes. Handing over or claiming the account is open to any consultant
// on the file: who runs an account is a firm decision, not a wall between
// colleagues, and gating it on the current manager leaves a search stranded
// whenever that person is unavailable. Every other seat change stays with the
// manager.
// A consultant putting themselves on a search they can already see. Needed
// because seating is otherwise the manager's job, which would leave a
// colleague unable to join a file in order to pick it up.
app.post('/api/searches/:id/members/self', requireUser, requireSearch, requireEditor, (req, res) => {
  if (db.memberOf(req.search, req.user.id)) {
    return res.status(409).json({ error:'You are already on this search.' });
  }
  req.search.members.push({ userId: req.user.id, seat: 'consultant', addedAt: db.now(), addedBy: req.user.id });
  db.touch(req.search, req.user, 'joined the search');
  db.persist();
  res.json({ search: painted(req, req.search), ...rosterOnly(req.search) });
});

app.patch('/api/searches/:id/members/:uid', requireUser, requireSearch, requireEditor, (req, res) => {
  const m = db.memberOf(req.search, req.params.uid);
  if (!m) return res.status(404).json({ error:'That person is not on this search.' });
  const seat = committee.seatOf(req.body?.seat);
  const user = db.findUserById(m.userId);

  if (seat === 'manager') {
    if (!db.isConsultant(user)) {
      return res.status(400).json({ error:'The account manager is a consultant at the firm.' });
    }
    // Exactly one manager. The outgoing one stays on the search as a
    // consultant rather than losing their seat.
    for (const other of req.search.members) {
      if (other.seat === 'manager') other.seat = 'consultant';
    }
    m.seat = 'manager';
    db.touch(req.search, req.user, 'handed the account to ' + user.name);
  } else {
    if (!db.canManage(req.search, req.user)) {
      const mgr = db.accountManager(req.search);
      const who = mgr ? (db.findUserById(mgr.userId)?.name || 'the account manager') : 'the account manager';
      return res.status(403).json({ error: who + ' runs this search. Take the account first, or ask them.' });
    }
    if (m.seat === 'manager') {
      return res.status(400).json({ error:'Hand the account to someone else first. A search always has a manager.' });
    }
    if (seat === 'consultant' && !db.isConsultant(user)) {
      return res.status(400).json({ error:'Only firm accounts sit in a consultant seat.' });
    }
    m.seat = seat;
    db.touch(req.search, req.user, 'moved ' + user.name + ' to ' + committee.SEAT_LABEL[seat].toLowerCase());
  }
  db.persist();
  res.json({ search: painted(req, req.search), ...rosterOnly(req.search) });
});

app.delete('/api/searches/:id/members/:uid', requireUser, requireSearch, requireManager, (req, res) => {
  const m = db.memberOf(req.search, req.params.uid);
  if (!m) return res.status(404).json({ error:'That person is not on this search.' });
  if (m.seat === 'manager') {
    return res.status(400).json({ error:'Hand the account to someone else before leaving the search.' });
  }
  const user = db.findUserById(m.userId);
  req.search.members = req.search.members.filter(x => x.userId !== m.userId);
  // Their answers leave with them. Consensus counts people who are still on
  // the committee, so a departed member cannot keep voting.
  if (req.search.intake?.submissions) delete req.search.intake.submissions[m.userId];
  db.touch(req.search, req.user, 'removed ' + (user ? user.name : 'a member') + ' from the search');
  // If this was their only seat, their sign-in goes with it.
  db.pruneOrphanCommittee();
  db.persist();
  res.json({ search: painted(req, req.search), ...rosterOnly(req.search) });
});

app.post('/api/searches/:id/members/:uid/pin', requireUser, requireSearch, requireManager, (req, res) => {
  const m = db.memberOf(req.search, req.params.uid);
  if (!m) return res.status(404).json({ error:'That person is not on this search.' });
  const user = db.findUserById(m.userId);
  if (!user) return res.status(404).json({ error:'That account no longer exists.' });
  if (user.role === 'consultant') {
    return res.status(403).json({ error:'Consultant PINs are set from the environment, not from a search.' });
  }
  const pin = db.makePin();
  credentials.set(user, pin);
  for (const [id, session] of Object.entries(db.db.sessions)) if (session.userId === user.id) delete db.db.sessions[id];
  db.touch(req.search, req.user, 'reset the sign-in PIN for ' + user.name);
  db.persist();
  res.json({ pin, email: user.email, name: user.name, revision: req.search.revision });
});

app.post('/api/searches/:id/team/confirm', requireUser, requireSearch, requireManager, (req, res) => {
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
 * Each seated member answers privately. The manager opens the window, watches
 * who has answered (never what they said), and closes it when the committee
 * has spoken. Closing is what publishes consensus to the room.
 * ------------------------------------------------------------------------- */

app.post('/api/searches/:id/intake/status', requireUser, requireSearch, requireManager, (req, res) => {
  const want = String(req.body?.status || '');
  if (!['draft', 'open', 'closed'].includes(want)) {
    return res.status(400).json({ error:'Intake is draft, open, or closed.' });
  }
  if (want === 'open' && !req.search.team?.confirmedAt) {
    return res.status(400).json({ error:'Confirm the roster first. People seated later would miss the window.' });
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

app.put('/api/searches/:id/intake', requireUser, requireSearch, (req, res) => {
  const seat = db.memberOf(req.search, req.user.id);
  if (!seat) return res.status(403).json({ error:'You are not seated on this search.' });
  if (!committee.INTAKE_SEATS.has(committee.seatOf(seat.seat))) {
    return res.status(403).json({ error:'Your seat does not answer intake.' });
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

app.post('/api/searches/:id/intake/adopt', requireUser, requireSearch, requireManager, (req, res) => {
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
  search.archivedUsers = db.db.users.filter(u => (search.members || []).some(m => m.userId === u.id) && u.role === 'committee').map(integrity.clone);
  db.db.archivedSearches.push(search);
  db.db.searches = db.db.searches.filter(s => s.id !== search.id);
}

app.get('/api/archives', requireUser, (req, res) => {
  if (!db.isConsultant(req.user)) return res.status(403).json({ error:'A consultant manages archived searches.' });
  res.json(db.db.archivedSearches.map(s => ({ id:s.id, no:s.no, client:s.client, position:s.position, archivedAt:s.archivedAt })));
});

app.post('/api/archives/:id/restore', requireUser, (req, res) => {
  if (!db.isConsultant(req.user)) return res.status(403).json({ error:'A consultant restores a search.' });
  const s = db.db.archivedSearches.find(s => s.id === req.params.id);
  if (!s) return res.status(404).json({ error:'Archived search not found.' });
  for (const u of s.archivedUsers || []) {
    const current = db.findUserByEmail(u.email);
    if (current && current.id !== u.id) return res.status(409).json({ error:'A different account now uses ' + u.email + '. Resolve that account conflict before restoring this roster.' });
  }
  for (const u of s.archivedUsers || []) if (!db.findUserById(u.id)) db.db.users.push(u);
  delete s.archivedUsers;
  delete s.archivedAt;
  for (const c of s.candidates || []) c.invite = crypto.randomBytes(24).toString('hex');
  db.db.archivedSearches = db.db.archivedSearches.filter(x => x.id !== s.id);
  db.db.searches.push(s);
  db.touch(s, req.user, 'restored the search; candidate invitation links replaced');
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
app.get('/api/searches/:id/export', requireUser, requireSearch, requireEditor, (req, res) => {
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

app.get('/api/searches/:id/history', requireUser, requireSearch, requireEditor, (req, res) => {
  const history = (req.search.history || []).map(entry => {
    if (!entry.scores && !entry.notesBy) return entry;
    const visible = entry.released || (entry.revision === req.search.profileRevision && req.search.released);
    if (visible) return entry;
    return { ...entry, scores:{ [req.user.id]:entry.scores?.[req.user.id] || {} }, notesBy:{ [req.user.id]:entry.notesBy?.[req.user.id] || {} } };
  });
  res.json({ history, activity: req.search.activity || [] });
});

app.post('/api/searches/:id/history/:entry/restore', requireUser, requireSearch, requireEditor, (req, res) => {
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

app.post('/api/searches/bulk-delete', requireUser, (req, res) => {
  if (req.user.role !== 'consultant') return res.status(403).json({ error:'The consultant deletes a search.' });
  const raw = Array.isArray(req.body?.ids) ? req.body.ids : [];
  const ids = [...new Set(raw.map(id => String(id || '').trim()).filter(Boolean))];
  if (!ids.length) return res.status(400).json({ error:'Pick at least one search.' });
  const deleted = [];
  for (const id of ids) {
    const s = db.db.searches.find(x => x.id === id);
    if (!s || !db.canEdit(s, req.user)) continue;
    removeSearch(s);
    deleted.push(id);
  }
  if (!deleted.length) return res.status(404).json({ error:'None of those searches are on the book.' });
  db.pruneOrphanCommittee();
  db.persist();
  res.json({ ok:true, deleted: deleted.length, ids: deleted });
});

app.delete('/api/searches/:id', requireUser, requireSearch, requireEditor, (req, res) => {
  if (req.user.role !== 'consultant') return res.status(403).json({ error:'The consultant deletes a search.' });
  removeSearch(req.search);
  // Committee accounts existed for this search. With it gone they are live
  // sign-ins to nothing, so they go too.
  db.pruneOrphanCommittee();
  db.persist();
  res.json({ ok:true, id: req.search.id });
});

const PATCH_FIELDS = [
  'jurisdictionType',
  'client', 'position', 'state', 'website', 'fog', 'population', 'budget', 'salary', 'opened', 'firstReview', 'notes',
  { key: 'released', role: 'consultant', roleError: 'The consultant releases scores.' }
];

app.patch('/api/searches/:id', requireUser, requireSearch, requireEditor, (req, res) => {
  const body = req.body || {};
  if ('jurisdictionType' in body && (typeof body.jurisdictionType !== 'string' || !Object.hasOwn(jurisdictions.TYPES, body.jurisdictionType))) return res.status(400).json({ error:'Choose City or town, or County.' });
  if ('package' in body && !Object.hasOwn(db.PACKAGES, body.package)) return res.status(400).json({ error:'Pick a package: Basic, Enhanced, or Executive.' });
  for (const key of PATCH_FIELDS.filter(f => typeof f === 'string')) {
    if (key in body && (typeof body[key] !== 'string' || body[key].length > 20000)) return res.status(400).json({ error:'Search facts must be text, no longer than 20,000 characters.' });
  }
  if ('released' in body && typeof body.released !== 'boolean') return res.status(400).json({ error:'Released must be true or false.' });
  for (const f of PATCH_FIELDS) {
    if (typeof f !== 'object' || !f.role) continue;
    if (f.key in body && req.user.role !== f.role) {
      return res.status(403).json({ error: f.roleError });
    }
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

app.put('/api/searches/:id/profile', requireUser, requireSearch, requireEditor, (req, res) => {
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

app.put('/api/searches/:id/artifact/:key', requireUser, requireSearch, requireEditor, artifactOnFile, (req, res) => {
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

app.post('/api/searches/:id/artifact/:key/review', requireUser, requireSearch, requireEditor, artifactOnFile, (req, res) => {
  const key = req.params.key;
  if (!db.REVIEW_STEPS.has(key)) return res.status(400).json({ error:'That step does not take a review.' });
  if (req.user.role !== 'consultant') return res.status(403).json({ error:'A consultant signs off on recruiting copy.' });
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

app.post('/api/searches/:id/assemble', requireUser, requireSearch, requireEditor, kindOnFile, (req, res) => {
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

// wipeSlotFiles was removed in DEP-04. It deleted the committed photo before
// the replacement record was saved, so a failed save rolled the record back
// over an image that no longer existed. server/media.js stages, commits, then
// sweeps instead.

app.post('/api/searches/:id/media', requireUser, requireSearch, requireEditor, mediaLimit, requireStepOnFile(() => 'brochure'), (req, res) => {
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

app.delete('/api/searches/:id/media/:slot', requireUser, requireSearch, requireEditor, (req, res) => {
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

app.get('/media/:id/:file', requireUser, requireSearch, (req, res) => {
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


app.post('/api/searches/:id/generate', requireUser, requireSearch, requireEditor, generateLimit, kindOnFile, async (req, res) => {
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
    let out;
    try {
      out = await ai.generate(kind, snapshot, { premium, notes: req.body?.notes||'', committee: room });
      telemetry.recordAi({ ok: true, ms: Date.now() - aiStartedAt, usage: out.usage, kind });
    } catch (error) {
      // Counted even though the work is lost: a failed call can still have
      // been billed, and an outage has to be visible in the numbers.
      telemetry.recordAi({ ok: false, ms: Date.now() - aiStartedAt, kind, code: error.code });
      throw error;
    }
    if (!db.findSearch(req.search.id)) {
      return res.status(409).json({ error:'This search was deleted while the draft was generating.' });
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

app.post('/api/searches/:id/research', requireUser, requireSearch, requireEditor, researchLimit, async (req, res) => {
  const body = req.body || {};
  const revision = req.search.revision;
  const city = String(Object.prototype.hasOwnProperty.call(body, 'city') ? body.city : (req.search.client || '')).trim();
  const website = String(Object.prototype.hasOwnProperty.call(body, 'website') ? body.website : (req.search.website || '')).trim();
  const premium = Boolean(body.premium);
  if (!city) return res.status(400).json({ error:'Enter the city or jurisdiction name.' });
  if (!website) return res.status(400).json({ error:'Enter the official jurisdiction website.' });
  try {
    const researchStartedAt = Date.now();
    let out;
    try {
      out = await ai.researchCity({
        city, website, premium,
        position: req.search.position,
        state: req.search.state,
        jurisdictionType: req.search.jurisdictionType
      });
      telemetry.recordAi({ ok: true, ms: Date.now() - researchStartedAt, usage: out.usage, kind: 'research' });
    } catch (error) {
      telemetry.recordAi({ ok: false, ms: Date.now() - researchStartedAt, kind: 'research', code: error.code });
      throw error;
    }
    if (!db.findSearch(req.search.id)) {
      return res.status(409).json({ error:'This search was deleted while research was running.' });
    }
    if (req.search.revision !== revision) return res.status(409).json({ error:'This search changed during research. The newer work was kept. Reload before researching again.', code:'STALE_SEARCH' });
    const facts = (out.json && out.json.facts) || {};
    req.search.website = website;
    if (facts.client) req.search.client = facts.client;
    else if (!req.search.client) req.search.client = city;
    for (const k of ['state','fog','population','budget','salary']) {
      if (facts[k]) req.search[k] = facts[k];
    }
    if (facts.notes) {
      const mark = '— From city research —';
      const incoming = facts.notes;
      const base = String(req.search.notes || '').split(mark)[0].trim();
      req.search.notes = base ? base + '\n\n' + mark + '\n' + incoming : incoming;
    }
    const community = out.json.community || {};
    if (community.lede || community.government || community.community || community.organization || community.why || (community.facts||[]).length) {
      req.search.artifacts.community = community;
    }
    req.search.research = {
      at: db.now(),
      city,
      website,
      sources: out.sources || [],
      model: out.model
    };
    db.touch(req.search, req.user, 'researched '+city+' from the official website');
    req.search.aiUsage = ai.addUsage(req.search.aiUsage, out.usage);
    db.persist();
    res.json({ search: painted(req, req.search), model: out.model, usage: out.usage });
  } catch (err) {
    const fail = claudeFail(err);
    res.status(fail.status).json({ error: fail.error });
  }
});

app.post('/api/searches/:id/candidates', requireUser, requireSearch, requireEditor, (req, res) => {
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

app.patch('/api/searches/:id/candidates/:cid', requireUser, requireSearch, requireEditor, (req, res) => {
  const c = req.search.candidates.find(x=>x.id===req.params.cid);
  if (!c) return res.status(404).json({ error:'Candidate not found.' });
  const body = req.body || {};
  if ('stage' in body) {
    if (req.user.role !== 'consultant') return res.status(403).json({ error:'The consultant advances candidates.' });
    const ok = ['applicant','semifinalist','finalist','declined'];
    if (!ok.includes(body.stage)) return res.status(400).json({ error:'Unknown stage.' });
  }
  const allow = ['name','cur','org','yrs','email','stage'];
  for (const k of allow) if (k in body) c[k] = body[k];
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
  req.staff = db.staffRecord(req.search, key);
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

app.post('/api/searches/:id/staff/:key/log', requireUser, requireSearch, requireEditor, requireStaffStep, (req, res) => {
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
  if (req.staff.doneAt) { req.staff.doneAt = null; req.staff.doneBy = null; req.staff.doneByName = ''; }
  const step = db.STEPS.find(s => s.key === req.staffKey);
  db.touch(req.search, req.user, 'logged ' + (step ? step.t.toLowerCase() : req.staffKey) + (who.candidate ? ' for ' + who.candidate.name : ''));
  db.persist();
  res.json(painted(req, req.search));
});

app.delete('/api/searches/:id/staff/:key/log/:lid', requireUser, requireSearch, requireEditor, requireStaffStep, (req, res) => {
  const before = req.staff.log.length;
  req.staff.log = req.staff.log.filter(e => e.id !== req.params.lid);
  if (req.staff.log.length === before) return res.status(404).json({ error:'That entry is not on the log.' });
  db.touch(req.search, req.user, 'removed a ' + req.staffKey + ' log entry');
  db.persist();
  res.json(painted(req, req.search));
});

app.put('/api/searches/:id/staff/:key', requireUser, requireSearch, requireEditor, requireStaffStep, (req, res) => {
  req.staff.notes = String(req.body?.notes || '').slice(0, 8000);
  db.touch(req.search, req.user, 'updated ' + req.staffKey + ' notes');
  db.persist();
  res.json(painted(req, req.search));
});

app.post('/api/searches/:id/staff/:key/complete', requireUser, requireSearch, requireEditor, requireStaffStep, (req, res) => {
  if (req.user.role !== 'consultant') return res.status(403).json({ error:'A consultant signs off on staff work.' });
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
  db.persist();
  res.json(painted(req, req.search));
});

// Consent to contact references is recorded on the candidate, so it survives
// the step being reopened and is visible wherever the person is shown.
app.post('/api/searches/:id/candidates/:cid/consent', requireUser, requireSearch, requireEditor, (req, res) => {
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
    db.touch(req.search, req.user, 'withdrew ' + c.name + '\'s reference consent');
  }
  db.persist();
  res.json(painted(req, req.search));
});

const send2OnFile = requireStepOnFile(() => 'send2');

app.post('/api/searches/:id/candidates/:cid/send2', requireUser, requireSearch, requireEditor, send2OnFile, (req, res) => {
  if (req.user.role !== 'consultant') return res.status(403).json({ error:'The consultant sends the semifinalist survey.' });
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

app.post('/api/searches/:id/send2', requireUser, requireSearch, requireEditor, send2OnFile, (req, res) => {
  if (req.user.role !== 'consultant') return res.status(403).json({ error:'The consultant sends the semifinalist survey.' });
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

app.put('/api/searches/:id/scores/:cid', requireUser, requireSearch, (req, res) => {
  const c = req.search.candidates.find(x=>x.id===req.params.cid);
  if (!c) return res.status(404).json({ error:'Candidate not found.' });
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

app.post('/api/searches/:id/candidates/:cid/invite', requireUser, requireSearch, requireEditor, (req, res) => {
  const c = req.search.candidates.find(c => c.id === req.params.cid);
  if (!c) return res.status(404).json({ error:'Candidate not found.' });
  c.invite = crypto.randomBytes(24).toString('hex');
  db.touch(req.search, req.user, 'replaced the invitation link for ' + c.name);
  db.persist();
  res.json(painted(req, req.search));
});

app.post('/api/searches/:id/candidates/:cid/reopen', requireUser, requireSearch, requireEditor, (req, res) => {
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
    const issued = c.issuedSurveys?.[which];
    if (!s.artifacts[which] && !issued) {
      return res.status(400).json({ error:'This survey is not open yet.' });
    }
    if (which === 'survey2' && !c.survey2SentAt) {
      return res.status(400).json({ error:'The search team has not sent this questionnaire yet.' });
    }
    if (c[which]) {
      return res.status(409).json({ error:'This questionnaire was already submitted.' });
    }
    if (!issued || req.body?.surveyVersion !== issued.version) return res.status(409).json({ error:'Reload this questionnaire before submitting. Your answers have not been saved.' });
    const invalid = integrity.validateAnswers(issued.survey, req.body?.answers);
    if (invalid) return res.status(400).json({ error:invalid });
    c[which] = { at: db.now(), answers: req.body.answers, ...integrity.clone(issued) };
    db.touch(s, { name:c.name }, 'submitted the '+which+' questionnaire');
    db.persist();
    return res.json({ ok:true });
  }
  res.status(404).json({ error:'This link is not valid.' });
});

app.get('/apply/:token', candidateLimit, (_req, res) => {
  // The token is in the URL of this page. Keeping it out of the shared cache
  // and out of the back/forward buffer limits how long a candidate's link
  // survives on a borrowed or public computer.
  res.set('Cache-Control', 'no-store, private');
  res.sendFile(path.join(__dirname, '..', 'public', 'index.html'));
});

// Terminal handler. Registered last so it sees failures from every route,
// including malformed JSON and oversized bodies rejected by the parsers.
app.use(http.errors());

const server = app.listen(PORT, HOST, () => {
  console.log('Slate listening on http://'+HOST+':'+PORT);
  console.log('Release:', RELEASE, '| Node', process.versions.node, '| data', db.DATA_DIR);
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

  // Hard ceiling well inside a typical platform termination allowance, so the
  // process exits deliberately rather than being killed mid-write.
  const forced = setTimeout(() => {
    console.error('Slate: drain timed out, exiting anyway.');
    db.releaseWriterLock();
    process.exit(1);
  }, 10000).unref();

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
