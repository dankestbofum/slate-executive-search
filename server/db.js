'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const integrity = require('./integrity');
const backup = require('./backup');
const jurisdictions = require('./jurisdictions');
const organizations = require('./organizations');
const committee = require('./committee');

const isProd = process.env.NODE_ENV === 'production';
const DATA_DIR = process.env.DATA_DIR
  || process.env.RAILWAY_VOLUME_MOUNT_PATH
  || path.join(__dirname, '..', 'data');
const DATA_FILE = path.join(DATA_DIR, 'slate.json');
if (isProd && !process.env.DATA_DIR && !process.env.RAILWAY_VOLUME_MOUNT_PATH) {
  console.error('Slate: production needs a persistent disk. Set DATA_DIR or attach a volume.');
  process.exit(1);
}

const { PHASES, STEPS, STAFF_STEPS, STAFF_STAGES, PACKAGES, PACKAGE_ORDER, DEFAULT_PACKAGE, COMPARE, COMPARE_BANDS, packageOf, stepsFor } = require('./steps');

// A shared firm sign-in, so day-to-day work does not require remembering which
// named consultant you are. It is ensured on every boot rather than only at
// first seed, so it exists on stores that predate it. Sign-in uses email only.
const TEAM_ACCOUNT = {
  id: 'u0',
  name: 'Slate Team',
  init: 'ST',
  role: 'consultant',
  title: 'Search team'
};

function ensureTeamAccount(store){
  const email = (process.env.SLATE_EMAIL_TEAM || 'team@slate.local').toLowerCase();
  const existing = store.users.find(u => u.id === TEAM_ACCOUNT.id);
  if (existing) {
    existing.email = email;
    existing.role = 'consultant';
    return;
  }
  // First in the list, so it is the account the sign-in page offers.
  store.users.unshift({ ...TEAM_ACCOUNT, email });
}

function seedUsers(){
  return [
    { id:'u1', email: process.env.SLATE_EMAIL_ABE || 'abe@slate.local', name:'Abe Macy', init:'AM', role:'consultant', title:'Operations' },
    { id:'u2', email: process.env.SLATE_EMAIL_MIKE || 'mike@slate.local', name:'Mike Letcher', init:'ML', role:'consultant', title:'Search consultant' }
  ];
}

function now(){ return new Date().toISOString(); }
function nid(prefix){ return prefix + '-' + crypto.randomBytes(4).toString('hex'); }

function initials(name){
  const parts = String(name || '').trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return '??';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

function blankSearch(input, user, organizationId){
  if (!organizationId) throw new Error('A search is opened inside an organization.');
  return {
    id: nid('sr'),
    no: null,
    // Set once, from the session's verified organization, and never from a
    // submitted field. A search does not move between firms.
    organizationId,
    client: input.client || '',
    jurisdictionType: jurisdictions.typeOf(input.jurisdictionType),
    position: input.position || '',
    // Which service package the client bought. Decides how many of the
    // sixteen steps are on this file (server/steps.js).
    package: packageOf(input.package),
    state: input.state || '',
    website: input.website || '',
    fog: input.fog || jurisdictions.TYPES[jurisdictions.typeOf(input.jurisdictionType)].governmentPlaceholder,
    population: input.population || '',
    budget: input.budget || '',
    salary: input.salary || '',
    opened: input.opened || now().slice(0,10),
    firstReview: input.firstReview || '',
    notes: input.notes || '',
    research: null,
    aiUsage: { input_tokens: 0, output_tokens: 0 },
    createdBy: user.id,
    createdAt: now(),
    updatedAt: now(),
    // The person who opened the search runs it until somebody reassigns the
    // place. `members` is the whole roster, manager included, so there is one
    // list to read rather than a field plus a list that can disagree.
    members: [{ userId: user.id, searchRole: 'manager', addedAt: now(), addedBy: user.id }],
    team: { confirmedAt: null, confirmedBy: null },
    intake: {
      status: 'draft',
      dueBy: '',
      prompt: '',
      openedAt: null,
      closedAt: null,
      // One record per person: their private draft and their committed
      // answer, kept apart so saving the first never retracts the second.
      responses: {}
    },
    // Every time the profile was built from committee input: when, by whom,
    // and the evidence each adopted line rested on at that moment.
    adoptions: [],
    criteria: [],
    artifacts: {},
    // Work the firm does by hand, one record per staff step: a running log of
    // what was done, working notes, and who marked it complete.
    staff: {},
    reviews: {},
    candidates: [],
    scores: {},
    notesBy: {},
    released: false,
    activity: [{ at: now(), who: user.name, by: user.id || null, role: user.role || null, x: 'opened the search' }]
  };
}

// The container runs as an unprivileged user, so a volume mounted with root-only
// ownership is a realistic deployment mistake. Prove the directory is writable at
// startup and stop with an actionable message, rather than accepting sign-ins and
// failing later on the first save that matters.
function requireWritableDataDir(){
  const probe = path.join(DATA_DIR, '.write-probe');
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(probe, String(process.pid));
    fs.unlinkSync(probe);
  } catch (error) {
    console.error('Slate: DATA_DIR is not writable: ' + DATA_DIR);
    console.error('Slate: running as uid ' + (process.getuid ? process.getuid() : 'n/a') + '. ' + error.message);
    console.error('Slate: grant the runtime user write access to the mounted volume, then restart.');
    process.exit(1);
  }
}

/* ------------------------------------------------------------------ *
 * Single writer
 *
 * The store is one JSON file rewritten whole. Two processes against the same
 * volume do not merge, they overwrite: the second writer's save silently
 * discards everything the first committed since it loaded. Clustering and
 * multiple replicas are unsupported, and this makes that enforceable rather
 * than a line in a document.
 *
 * A process ID is not an identity. The operating system reuses them, so the
 * number a crashed writer left behind can belong to an unrelated program by
 * the time the replacement boots — asking whether *something* holds that
 * number then wedges the store shut for good. Across containers on a shared
 * volume the number is worse than useless: it describes a process this one
 * cannot see at all, and every absent PID reads as free.
 *
 * So the holder proves it is alive by touching the lock on a timer, and names
 * itself with a token no recycled PID can forge. The PID is still recorded,
 * and still used, but only as a fast path on the machine that wrote it: a
 * writer that crashed on this host is reclaimed at once instead of waiting
 * out the heartbeat.
 * ------------------------------------------------------------------ */
const LOCK_FILE = path.join(DATA_DIR, '.writer.lock');
const LOCK_HEARTBEAT_MS = 30000;
const LOCK_STALE_MS = 90000; // three missed beats, so a slow moment is not a takeover
const HOST = os.hostname();

// Unique to this run of this process, which is the thing a PID fails to be.
const instanceToken = crypto.randomUUID();
const PROCESS_STARTED_AT = Date.now() - Math.round(process.uptime() * 1000);
let claimedAt = null;
let heartbeat = null;

function holderIsAlive(pid){
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try { process.kill(pid, 0); return true; }
  catch (error) { return error.code === 'EPERM'; } // exists, owned by someone else
}

function readWriterLock(){
  try { return JSON.parse(fs.readFileSync(LOCK_FILE, 'utf8')); }
  catch (error) {
    if (error.code === 'ENOENT' || error instanceof SyntaxError) return null;
    throw error;
  }
}

// Whether a record is this process's own. The token settles it. Failing that,
// a record naming our own PID on our own host is ours only if it was written
// after we started: a module reloaded inside one process is not a second
// writer, but a container restart hands the replacement PID 1 and the same
// hostname, and that predecessor is dead rather than us.
function heldByThisProcess(held){
  if (held.token === instanceToken) return true;
  if (held.pid !== process.pid || held.host !== HOST) return false;
  const written = Date.parse(held.renewedAt ?? held.at ?? '');
  return Number.isFinite(written) && written >= PROCESS_STARTED_AT;
}

// Age of the last heartbeat. A record from a release that did not keep one is
// infinitely old on purpose: it carries no evidence that anyone is still there.
function heartbeatAge(held){
  const stamp = Date.parse(held?.renewedAt ?? '');
  return Number.isFinite(stamp) ? Date.now() - stamp : Infinity;
}

function writeWriterLock(){
  const record = {
    token: instanceToken,
    pid: process.pid,
    host: HOST,
    release: process.env.SLATE_RELEASE || 'dev',
    at: claimedAt,
    renewedAt: now()
  };
  // Same discipline as the store itself: a reader must never catch this file
  // half-written, because a parse failure here reads as "no lock at all".
  const tmp = LOCK_FILE + '.' + process.pid + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(record));
  fs.renameSync(tmp, LOCK_FILE);
}

function claimWriterLock(){
  const held = readWriterLock();
  if (held && !heldByThisProcess(held)) {
    const age = heartbeatAge(held);
    // Beating recently. The one exception is a writer that beat recently and
    // then died on this machine: its PID is gone for certain, so a crash is
    // recovered now rather than after the staleness window.
    // On this host the holder is provably gone if its number is now ours — a
    // PID cannot name two live processes — or if nothing is running under it.
    const crashedHere = held.host === HOST && (held.pid === process.pid || !holderIsAlive(held.pid));
    if (age <= LOCK_STALE_MS && !crashedHere) {
      console.error('Slate: another process (pid ' + held.pid + ' on ' + (held.host || 'an unknown host')
        + ', last seen ' + Math.round(age / 1000) + 's ago) is already writing ' + DATA_DIR + '.');
      console.error('Slate: the JSON store supports one writer. Do not run multiple replicas or PM2 cluster mode.');
      process.exit(1);
    }
    const why = crashedHere ? 'the process is gone'
      : held.renewedAt ? 'last seen ' + Math.round(age / 1000) + 's ago'
      : 'it predates heartbeats, so nothing says its holder is still running';
    console.warn('Slate: taking over a stale write lock from pid ' + held.pid + ' (' + why + ').');
  }
  claimedAt = now();
  writeWriterLock();
  startHeartbeat();
}

// The heartbeat is what makes the lock trustworthy, so it also watches for the
// one thing the claim check cannot rule out: another process deciding we were
// stale and taking the store while we are still holding records in memory.
// Two writers against one JSON file is silent data loss, and the loser of that
// race cannot save its way out of it. Leaving is the only safe move.
function startHeartbeat(){
  if (heartbeat) return;
  heartbeat = setInterval(() => {
    let held = null;
    try { held = readWriterLock(); }
    catch { return; } // a transient read failure is not evidence of anything
    if (held && !heldByThisProcess(held)) {
      console.error('Slate: the write lock on ' + DATA_DIR + ' was taken by pid ' + held.pid
        + ' on ' + (held.host || 'an unknown host') + '.');
      console.error('Slate: exiting rather than letting two processes overwrite each other.');
      return process.exit(1);
    }
    try { writeWriterLock(); }
    catch (error) { console.error('Slate: could not refresh the write lock: ' + error.message); }
  }, LOCK_HEARTBEAT_MS);
  // Never a reason for the process to stay up.
  heartbeat.unref();
}

function releaseWriterLock(){
  if (heartbeat) { clearInterval(heartbeat); heartbeat = null; }
  try {
    const held = readWriterLock();
    if (held && heldByThisProcess(held)) fs.unlinkSync(LOCK_FILE);
  } catch { /* never block shutdown on the lock file */ }
}

/* ------------------------------------------------------------------ *
 * Schema version and ordered migrations
 *
 * MIGRATIONS[i] upgrades a store at version i to version i+1. A store from a
 * newer release is refused outright: rolling the application back onto a store
 * it does not understand is how a rollback turns into data loss.
 * ------------------------------------------------------------------ */
const SCHEMA_VERSION = 7;

function removeLegacyPins(store){
  const users = [...(store.users || []),
    ...(store.archivedSearches || []).flatMap(s => s.archivedUsers || [])];
  for (const user of users) {
    delete user.pin;
    delete user.pinHash;
  }
}

const MIGRATIONS = [
  // 0 -> 1: the shape that predates explicit versioning. The backfills in
  // migrate() below are idempotent and already ran on every boot, so this
  // records the version rather than changing data.
  store => { store.archivedSearches ||= []; },
  // 1 -> 2: email-only accounts. The version prevents older PIN-based builds
  // from opening a store whose credentials have been removed.
  removeLegacyPins,
  // 2 -> 3: Clerk holds the session. Slate's own session table is dropped, so
  // an older build cannot open this store and honour a cookie nobody issues.
  store => { delete store.sessions; },
  // 3 -> 4: searches belong to an organization. Every existing record is left
  // unowned on purpose. An unowned search is readable by nobody, which is the
  // safe answer: deciding which firm owns a legacy file is a migration
  // decision (scripts/organizations.js), not something the first person to
  // sign in should be able to settle by signing in. An older build cannot open
  // this store, which is what stops a rollback from serving several firms
  // through the pre-organization permission model.
  store => {
    organizations.ensureTables(store);
    for (const s of [...(store.searches || []), ...(store.archivedSearches || [])]) {
      if (!Object.hasOwn(s, 'organizationId')) s.organizationId = null;
    }
  },
  // 4 -> 5: a roster place is a `searchRole`, not a `seat`. The UI stopped
  // saying "seat" first; this is the stored field catching up, so that the word
  // is gone from the vocabulary rather than merely hidden behind a label. The
  // values are untouched — 'manager', 'consultant', 'committee' — and archived
  // rosters and held places are carried over with the live ones, because an
  // archive that keeps the old spelling would restore a roster nobody can read.
  store => {
    const rename = row => {
      if (!row || !Object.hasOwn(row, 'seat')) return;
      if (!Object.hasOwn(row, 'searchRole')) row.searchRole = row.seat;
      delete row.seat;
    };
    for (const s of [...(store.searches || []), ...(store.archivedSearches || [])]) {
      for (const m of s.members || []) rename(m);
    }
    for (const p of store.pendingAssignments || []) rename(p);
  },
  // 5 -> 6: research has a durable job record (server/research-jobs.js), so a
  // consultant can leave the page and come back to the same operation instead
  // of the browser being the only thing that knows it exists. The table starts
  // empty; there is no history to reconstruct, and inventing one would be
  // inventing spend. An older build cannot open this store, which is what
  // stops a rollback from serving a client that polls a job table the previous
  // release neither writes nor recovers.
  store => { store.researchJobs ||= []; },
  // 6 -> 7: a member's private draft and their committed answer become two
  // fields instead of one record with a `submitted` flag, so saving a draft
  // stops retracting the submission. The conversion is in
  // migrateIntakeResponses(), which migrate() also runs on every boot; this
  // rung is the version marker that stops an older build — one that would
  // write the old shape back over a new draft — from opening the store.
  store => {
    for (const s of [...(store.searches || []), ...(store.archivedSearches || [])]) migrateIntakeResponses(s);
  },
];

/**
 * Legacy `intake.submissions` to per-member response records.
 *
 * A legacy record held one answer and a `submitted` flag. Read it for what it
 * was: a flagged record is the member's committed answer, an unflagged one is
 * a private draft they never sent. Nothing invents a submitted version the old
 * schema had already overwritten, existing timestamps and roster identity are
 * carried across, and rerunning it changes nothing.
 */
function migrateIntakeResponses(search){
  const intake = search && search.intake;
  if (!intake || typeof intake !== 'object') return;
  intake.responses ||= {};
  const legacy = intake.submissions;
  if (!legacy || typeof legacy !== 'object') { delete intake.submissions; return; }
  for (const [userId, record] of Object.entries(legacy)) {
    if (!record || typeof record !== 'object') continue;
    if (intake.responses[userId]) continue;
    const answer = {
      items: Array.isArray(record.items) ? record.items : [],
      mustHave: record.mustHave || '',
      dealBreaker: record.dealBreaker || '',
      context: record.context || '',
      at: record.at || null,
      updatedAt: record.updatedAt || record.at || null
    };
    intake.responses[userId] = record.submitted
      ? { revision: 1, draft: null, submitted: { ...answer, submittedAt: answer.updatedAt } }
      : { revision: 1, draft: answer, submitted: null };
  }
  delete intake.submissions;
}

function runMigrations(store){
  const from = Number.isInteger(store.schemaVersion) ? store.schemaVersion : 0;

  if (from > SCHEMA_VERSION) {
    console.error('Slate: this store was written by a newer release (schema ' + from
      + '; this build understands ' + SCHEMA_VERSION + ').');
    console.error('Slate: deploy the matching release, or restore the snapshot that belongs to this one.');
    process.exit(1);
  }
  if (from === SCHEMA_VERSION) return false;

  // A snapshot before any structural change, so a failed migration leaves a
  // recoverable copy rather than a partly-upgraded store.
  const preserved = path.join(DATA_DIR, 'backups', 'pre-migration-' + from + '-to-' + SCHEMA_VERSION + '-' + Date.now());
  try {
    backup.snapshot(DATA_DIR, preserved);
    console.log('Slate: pre-migration snapshot written to ' + preserved);
  } catch (error) {
    console.error('Slate: could not snapshot before migrating: ' + error.message);
    process.exit(1);
  }

  try {
    for (let v = from; v < SCHEMA_VERSION; v += 1) MIGRATIONS[v](store);
    store.schemaVersion = SCHEMA_VERSION;
  } catch (error) {
    // Fail closed. A half-migrated store must not start serving.
    console.error('Slate: migration ' + from + ' -> ' + SCHEMA_VERSION + ' failed: ' + error.message);
    console.error('Slate: the store was not modified on disk. Restore ' + preserved + ' if needed.');
    process.exit(1);
  }
  console.log('Slate: migrated store schema ' + from + ' -> ' + SCHEMA_VERSION + '.');
  return true;
}

function load(){
  requireWritableDataDir();
  claimWriterLock();
  if (!fs.existsSync(DATA_FILE)) {
    const db = { schemaVersion: SCHEMA_VERSION, users: seedUsers(), searches: [], seq: 0 };
    // A fresh store goes through the same path as an existing one, so the
    // backfills below are never a first-boot-only accident.
    migrate(db);
    save(db);
    return db;
  }
  backup.ensureDaily(DATA_DIR);
  const loaded = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
  runMigrations(loaded);
  migrate(loaded);
  save(loaded);
  return loaded;
}

// Searches written before the committee existed have no roster and no intake.
// Put their creator on as account manager and treat their profile as already
// adopted, so an in-flight search does not reopen at Step 1 with its later
// work locked behind a step that did not exist when it was done.
function migrate(store){
  store.archivedSearches ||= [];
  store.researchJobs ||= [];
  store.users = store.users || [];
  organizations.ensureTables(store);
  for (const u of store.users) {
    if (!u.role) u.role = 'consultant';
    if (!u.init) u.init = initials(u.name);
  }
  ensureTeamAccount(store);
  // Existing accounts keep their identity and access, but no longer use PINs.
  removeLegacyPins(store);
  for (const s of [...(store.searches || []), ...store.archivedSearches]) {
    // Unowned is a real state, not a missing field: a search with no
    // organization is refused everywhere rather than defaulting to somebody's.
    if (!Object.hasOwn(s, 'organizationId')) s.organizationId = null;
    s.jurisdictionType = jurisdictions.typeOf(s.jurisdictionType);
    s.revision ||= 1;
    s.profileRevision ||= 1;
    s.history ||= [];
    for (const c of s.candidates || []) {
      if (c.inviteVersion !== 2) {
        c.invite = crypto.randomBytes(24).toString('hex');
        c.inviteVersion = 2;
        s.invitesRotatedAt = now();
      }
      for (const key of ['survey1', 'survey2']) {
        if (c[key] && !c[key].survey) {
          c[key].survey = integrity.clone(s.artifacts?.[key] || { questions: [] });
          c[key].legacySnapshot = true;
        }
      }
    }
    // Searches written before packages existed ran the whole process. Keep it
    // that way rather than hiding steps that may already have work on file.
    if (!PACKAGES[s.package]) s.package = DEFAULT_PACKAGE;
    if (!s.staff || typeof s.staff !== 'object') s.staff = {};
    if (!Array.isArray(s.members) || !s.members.length) {
      s.members = [{
        userId: s.createdBy,
        searchRole: 'manager',
        addedAt: s.createdAt || s.opened || now(),
        addedBy: s.createdBy
      }];
    }
    if (!s.team) {
      const legacy = (s.criteria || []).some(c => c && String(c.label || '').trim());
      s.team = legacy
        ? { confirmedAt: s.createdAt || now(), confirmedBy: s.createdBy, legacy: true }
        : { confirmedAt: null, confirmedBy: null };
    }
    if (!s.intake) {
      const legacy = (s.criteria || []).some(c => c && String(c.label || '').trim());
      s.intake = {
        status: legacy ? 'closed' : 'draft',
        dueBy: '',
        prompt: '',
        openedAt: null,
        closedAt: legacy ? (s.createdAt || now()) : null,
        responses: {},
        legacy: legacy || undefined
      };
    }
    migrateIntakeResponses(s);
    s.adoptions ||= [];
    // A profile adopted before adoptions were recorded has no evidence behind
    // its support claims, and today's tally is not that evidence. Mark it for
    // review rather than reconstructing a history that was never stored.
    if ((s.criteria || []).some(c => c && c.from === 'committee' && !c.source) && !s.adoptions.length) {
      s.adoptionProvenance = 'unverified';
    }
  }
}

function save(db){
  const tmp = DATA_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(db, null, 2), { mode:0o600 });
  const handle = fs.openSync(tmp, 'r+');
  try { fs.fsyncSync(handle); } finally { fs.closeSync(handle); }
  // Never fall back to copying over the only committed store on rename failure.
  fs.renameSync(tmp, DATA_FILE);
}

let db = load();
let previous = new Map([...db.searches, ...db.archivedSearches].map(s => [s.id, integrity.clone(s)]));
let committed = integrity.clone(db);

function persist(){
  try {
    for (const s of [...db.searches, ...db.archivedSearches]) integrity.reconcile(s, previous.get(s.id));
    save(db);
  } catch (error) {
    db = integrity.clone(committed);
    throw error;
  }
  committed = integrity.clone(db);
  previous = new Map([...db.searches, ...db.archivedSearches].map(s => [s.id, integrity.clone(s)]));
}

function publicUser(u){
  if (!u) return null;
  return { id:u.id, email:u.email, name:u.name, init:u.init, role:u.role, title:u.title };
}

function findUserById(id){
  return db.users.find(u => u.id === id);
}

function memberOf(search, userId){
  return (search.members || []).find(m => m.userId === userId) || null;
}

function accountManager(search){
  return (search.members || []).find(m => m.searchRole === 'manager') || null;
}

/* ------------------------------------------------------------------ *
 * Permission
 *
 * Every one of these takes an access context (server/auth.js builds it), not a
 * user. The difference is the whole point of organization support: the same
 * person is a consultant in one firm's workspace and a committee member in
 * another's, and the answer has to come from the membership that was verified
 * for this request rather than from a role stored on the account.
 * ------------------------------------------------------------------ */

/**
 * The workspace role last verified for somebody, from the membership cache.
 *
 * Used only to answer "is this person eligible to hold that place", never to
 * decide what the person making the request may do — that answer always comes
 * from the membership verified for this request. A stale cache entry here can
 * propose a place; it cannot open anything, because the holder's own next
 * request re-reads their membership from the provider.
 */
function workspaceRoleOf(userId, orgId){
  const membership = (db.memberships || []).find(m => m.orgId === orgId && m.userId === userId);
  return membership ? membership.role : null;
}

/** Eligible to hold a consultant or manager place in this workspace. */
function isStaffOf(userId, orgId){
  const role = workspaceRoleOf(userId, orgId);
  return role === organizations.ADMIN || role === organizations.CONSULTANT;
}

/** Does this context work across its organization's whole book of business? */
function isStaff(access){
  return Boolean(access && access.orgId && access.capabilities && access.capabilities.staff);
}

/**
 * The gate every other check stands on: is this search in the workspace the
 * request is being made in? A search with no owner passes for nobody, so a
 * legacy record that migration has not mapped is unreadable rather than
 * public, and a search id from another firm is simply not found.
 */
function ownedBy(search, access){
  return Boolean(search && search.organizationId && access && access.orgId
    && search.organizationId === access.orgId);
}

/**
 * Who may open a search file at all.
 *
 * Staff see their own firm's whole book; that is how the firm works and inside
 * one workspace it is unchanged. A committee member sees only the searches
 * they are on, because their place exists for one search.
 */
function canView(search, access){
  if (!ownedBy(search, access)) return false;
  if (isStaff(access)) return true;
  return Boolean(memberOf(search, access.userId));
}

/** Editing the search file itself stays with the firm, not the committee. */
function canEdit(search, access){
  return isStaff(access) && canView(search, access);
}

/**
 * Who is on the committee has changed, or is about to.
 *
 * A confirmation given before this no longer describes the committee, so it is
 * withdrawn and asked for again. While the intake window is open the change is
 * also recorded against the window: who was asked is part of what "2 of 3
 * answered" means, and the manager confirms the committee again before those
 * answers are closed or published. Everybody on the roster, including whoever
 * was just added, keeps answering in the meantime.
 */
function rosterChanged(search){
  if (!search) return;
  search.team = { confirmedAt: null, confirmedBy: null };
  if (search.intake?.status === 'open') search.intake.rosterChangedAt = now();
}

/** Rostering, intake windows, and adoption belong to the account manager. */
function canManage(search, access){
  if (!canEdit(search, access)) return false;
  const mgr = accountManager(search);
  return !mgr || mgr.userId === access.userId;
}

/**
 * Retire unused invitation accounts that are no longer on any search.
 *
 * A committee account exists to serve one search. When that place goes away,
 * whether the member was removed or the whole search was deleted, the account
 * would otherwise linger as a live email sign-in that opens an app with
 * nothing in it. Consultants are never touched: their accounts belong to the
 * firm, not to a search. Keep accounts with saved setup so their identity and
 * onboarding choices survive removal of a search assignment.
 *
 * An account that holds an organization membership is never retired either,
 * whatever assignments it has. The person is in the firm's workspace; losing one
 * on one search is not leaving the firm, and deleting them here would only
 * strand a live Clerk membership against no Slate account.
 */
function pruneOrphanCommittee(){
  const onARoster = new Set();
  for (const s of db.searches) {
    for (const m of s.members || []) onARoster.add(m.userId);
  }
  const inWorkspace = new Set((db.memberships || []).map(m => m.userId));
  const orphans = new Set(
    db.users.filter(u => u.role === 'committee' && !u.onboarding
      && !onARoster.has(u.id) && !inWorkspace.has(u.id)).map(u => u.id)
  );
  if (!orphans.size) return 0;
  db.users = db.users.filter(u => !orphans.has(u.id));
  return orphans.size;
}

/**
 * The roster with names attached, ready for the client.
 *
 * `orgRole` is the workspace role last verified for this person in the firm
 * that owns the search. It is what the Committee screen labels a person with,
 * because the legacy account `role` says nothing about which workspace the
 * reader is in.
 */
function roster(search){
  const memberships = (db.memberships || []).filter(x => x.orgId === search.organizationId);
  return (search.members || []).map(m => {
    const u = findUserById(m.userId);
    const membership = memberships.find(x => x.userId === m.userId) || null;
    return {
      orgRole: membership ? membership.role : null,
      userId: m.userId,
      searchRole: m.searchRole,
      addedAt: m.addedAt,
      addedBy: m.addedBy,
      name: u ? u.name : 'Removed user',
      init: u ? u.init : '??',
      email: u ? u.email : '',
      title: u ? u.title : '',
      role: u ? u.role : 'committee'
    };
  });
}

const SIMPLE_ARTIFACT_STEPS = new Set(['community','brochure','ads','survey1','plan','guide','survey2','schedule','contract','bar']);

// Steps that go out to the public: a Claude draft is a starting point, not a
// finished product. These stay 'now' until a consultant marks them reviewed,
// so the step (and everything gated behind it) does not read as done on the
// strength of an unread draft. Saving, redrafting, or refilling clears the
// review (server/index.js), which drops the step back to 'now'.
const REVIEW_STEPS = new Set(['brochure', 'ads']);

function reviewed(search, key){
  return ((search.reviews || {})[key] || {}).status === 'approved';
}

/** The staff record for a step, created on first touch. */
function staffRecord(search, key){
  search.staff = search.staff || {};
  if (!search.staff[key]) search.staff[key] = { notes: '', log: [], doneAt: null, doneBy: null, doneByName: '' };
  return search.staff[key];
}

function stepStatus(search, step, cache){
  if (cache && cache.has(step.key)) return cache.get(step.key);
  const a = search.artifacts || {};
  let status;
  if (STAFF_STEPS.has(step.key)) {
    // Done when a consultant says so. Anything logged before that shows the
    // work is under way; a step with nothing on it is simply open.
    const rec = (search.staff || {})[step.key] || {};
    if (rec.doneAt) status = 'done';
    else status = ((rec.log || []).length || String(rec.notes || '').trim()) ? 'now' : 'open';
  } else if (SIMPLE_ARTIFACT_STEPS.has(step.key)) {
    if (!a[step.key]) status = 'open';
    else if (REVIEW_STEPS.has(step.key) && !reviewed(search, step.key)) status = 'now';
    else status = 'done';
  } else {
    const crit = (search.criteria || []).filter(c => c && String(c.label||'').trim());
    const cands = search.candidates || [];
    switch (step.key){
      case 'team': {
        // A one-person search is legitimate, so the roster is never "too small"
        // on its own. What marks the step done is the manager saying the roster
        // are set, which is also what makes it safe to open intake.
        const onSearch = (search.members || []).length;
        status = search.team?.confirmedAt ? 'done' : (onSearch > 1 ? 'now' : 'open');
        break;
      }
      case 'intake': {
        // Closing the window is the manager's call, not a headcount. A member
        // who never answers should not be able to stall the whole search.
        const intake = search.intake || {};
        if (intake.status === 'closed') status = 'done';
        else if (intake.status === 'open') status = 'now';
        else status = Object.keys(intake.responses || {}).length ? 'now' : 'open';
        break;
      }
      case 'profile': {
        const countKind = k => crit.filter(c => c.kind === k).length;
        const inRange = n => n >= 3 && n <= 5;
        const profileReady = ['skill','trait','chall','opp'].every(k => inRange(countKind(k)));
        status = profileReady ? 'done' : (crit.length ? 'now' : 'open');
        break;
      }
      case 'screen': {
        const scored = cands.filter(c => Object.values(search.scores||{}).some(u => u[c.id]));
        const semis = cands.filter(c => c.stage === 'semifinalist' || c.stage === 'finalist');
        status = (semis.length && search.released) ? 'done' : (scored.length || cands.length ? 'now' : 'open');
        break;
      }
      case 'send2': {
        const sent2 = cands.filter(c => c.survey2SentAt);
        status = sent2.length && sent2.every(c => c.survey2) ? 'done' : (sent2.length ? 'now' : 'open');
        break;
      }
      case 'finalists': status = cands.some(c=>c.stage==='finalist') ? 'done' : 'open'; break;
      default: status = 'open';
    }
  }
  if (cache) cache.set(step.key, status);
  return status;
}

/** The steps on this file: the catalog cut down to the search's package. */
function stepsOf(search){
  return stepsFor(search.package);
}

function blocked(search, step, catalog, cache){
  if (step.needsCandidates && !(search.candidates||[]).length) return true;
  return (step.needs||[]).some(k => {
    const need = catalog.find(s=>s.key===k);
    return need && stepStatus(search, need, cache) !== 'done';
  });
}

function decorate(search, access){
  const cache = new Map();
  const catalog = stepsOf(search);
  const steps = catalog.map(s => {
    const status = stepStatus(search, s, cache);
    const lock = blocked(search, s, catalog, cache);
    return { ...s, status: lock && status!=='done' ? 'idle' : status, blocked: lock && status!=='done' };
  });
  const done = steps.filter(s=>s.status==='done').length;
  const next = steps.find(s=>!s.blocked && s.status==='now')
    || steps.find(s=>!s.blocked && s.status!=='done' && !s.opt)
    || steps.find(s=>!s.blocked && s.status!=='done')
    || steps.find(s=>s.status!=='done');
  const mgr = accountManager(search);
  const out = {
    ...search,
    package: packageOf(search.package),
    packageInfo: PACKAGES[packageOf(search.package)],
    steps,
    progress: { done, total: steps.length, next },
    roster: roster(search),
    accountManager: mgr ? roster(search).find(r => r.userId === mgr.userId) : null
  };
  // History contains prior private scores and staff notes. It has its own editor-only route.
  delete out.history;
  // Intake is assembled for a named viewer below. The raw record must never
  // ride along on the spread: with no viewer there is nobody it could be
  // shared with, so only the window's own state survives.
  out.intake = { status: (search.intake || {}).status || 'draft', responses: {}, answered: {} };
  // The adoption records and the publication snapshot are assembled per viewer
  // too (server/index.js, painted). The stored forms carry a full copy of the
  // criteria and every source reason, so leaving them on the spread would be a
  // second path to a profile the viewer is not being shown.
  delete out.adoptions;
  delete out.publication;
  if (access) {
    const uid = access.userId;
    const searchRole = memberOf(search, uid);
    out.you = {
      searchRole: searchRole ? searchRole.searchRole : null,
      member: Boolean(searchRole),
      // "Staff" is the organization-scoped successor to the firm-wide
      // consultant flag. Kept under the old name as well so the client's
      // existing reads of `you.consultant` keep meaning the same thing.
      staff: isStaff(access),
      consultant: isStaff(access),
      role: access.role || null,
      canEdit: canEdit(search, access),
      canManage: canManage(search, access)
    };
    // Intake is answered in confidence. An unfinished draft belongs to its
    // author and to nobody else, before or after the window closes; closing
    // publishes committed answers to the room, not everything on file (CA-01).
    // Named fields only: what is not listed here is not sent, so a field added
    // to the stored record later is withheld until somebody decides otherwise.
    const intake = search.intake || {};
    out.intake = {
      status: intake.status || 'draft',
      dueBy: intake.dueBy || '',
      prompt: intake.prompt || '',
      openedAt: intake.openedAt || null,
      closedAt: intake.closedAt || null,
      legacy: intake.legacy,
      completedEmpty: intake.completedEmpty || null,
      rosterChangedAt: intake.rosterChangedAt || null,
      responses: committee.visibleResponses(search, {
        userId: uid,
        staff: isStaff(access),
        member: Boolean(searchRole)
      }),
      // Who has answered, which the roster ticks need and which discloses
      // nothing about what anybody said.
      answered: committee.answeredBy(search)
    };
    if (!search.released) {
      out.scores = { [uid]: (search.scores || {})[uid] || {} };
      out.notesBy = { [uid]: (search.notesBy || {})[uid] || {} };
    }
    // Sourcing calls and reference conversations are the firm's working notes
    // about people, some of whom are sitting managers who have not told their
    // own council they are looking. A committee member does not read them.
    if (!isStaff(access)) {
      out.staff = {};
      const fields = ['id', 'name', 'cur', 'org', 'yrs', 'email', 'stage', 'survey1', 'survey2', 'survey2SentAt', 'survey2Deadline', 'addedAt', 'referenceConsentAt', 'referenceConsentBy'];
      out.candidates = (search.candidates || []).map(c => Object.fromEntries(fields.filter(k => k in c).map(k => [k, c[k]])));
    }
  }
  return out;
}

/**
 * Counts only, for the portfolio list.
 *
 * Home needs to say how many people are on each file without loading every
 * search in full. Nothing identifying leaves this function: no names, no
 * organisations, no invitation tokens, no scores — only how many candidates
 * are at each stage the product actually stores, and how many have answered
 * the initial questionnaire. Returns null when the package leaves screening
 * off the file, so Home shows an absent count rather than a zero that would
 * read as "nobody applied".
 */
function candidateCounts(search){
  if (!stepsOf(search).some(s => s.key === 'screen')) return null;
  const list = search.candidates || [];
  const by = stage => list.filter(c => c.stage === stage).length;
  return {
    total: list.length,
    applicant: by('applicant'),
    semifinalist: by('semifinalist'),
    finalist: by('finalist'),
    declined: by('declined'),
    responses: list.filter(c => c.survey1).length
  };
}

function nextNo(){
  db.seq = (db.seq||0) + 1;
  return 'SR-' + new Date().getFullYear() + '-' + String(db.seq).padStart(3,'0');
}

function findUserByEmail(email){
  if (typeof email !== 'string' || !email.trim()) return undefined;
  return db.users.find(u => u.email.toLowerCase() === email.trim().toLowerCase());
}

/**
 * Disable or restore an account without deleting it.
 *
 * Deleting would break attribution: history records who made each decision,
 * and a search record has to stay readable after someone leaves. A disabled
 * account keeps its identity and can be restored if the person returns. Access
 * ends on the next request: every one of them resolves the Clerk identity back
 * to this account, and a disabled account is refused there.
 */
function setDisabled(user, disabled, actor){
  if (!user) return null;
  if (disabled) {
    user.disabled = true;
    user.disabledAt = now();
    user.disabledBy = actor || 'operator';
  } else {
    delete user.disabled;
    delete user.disabledAt;
    delete user.disabledBy;
  }
  return user;
}

function isDisabled(user){
  return Boolean(user && user.disabled);
}

function createUser({ name, email, title, role }){
  const u = {
    id: nid('u'),
    email: String(email || '').trim().toLowerCase(),
    name: String(name || '').trim(),
    init: initials(name),
    role: ['consultant', 'pending'].includes(role) ? role : 'committee',
    title: String(title || '').trim() || (role === 'pending' ? 'Account setup' : role === 'consultant' ? 'Search consultant' : 'Committee member'),
    createdAt: now()
  };
  db.users.push(u);
  return { user: u };
}

module.exports = {
  PHASES, STEPS, STAFF_STEPS, STAFF_STAGES, PACKAGES, PACKAGE_ORDER, DEFAULT_PACKAGE, COMPARE, COMPARE_BANDS, packageOf, stepsOf,
  staffRecord,
  REVIEW_STEPS, reviewed, nid, now, persist, DATA_DIR,
  get db(){ return db; },
  publicUser,
  decorate,
  candidateCounts,
  nextNo,
  blankSearch,
  createUser,
  SCHEMA_VERSION,
  runMigrations,
  releaseWriterLock,
  LOCK_FILE,
  setDisabled,
  isDisabled,
  initials,
  ensureBackup: () => backup.ensureDaily(DATA_DIR),
  memberOf,
  rosterChanged,
  accountManager,
  roster,
  pruneOrphanCommittee,
  isStaff,
  ownedBy,
  workspaceRoleOf,
  isStaffOf,
  canView,
  canEdit,
  canManage,
  findUserById,
  findUserByEmail,
  findSearch: id => db.searches.find(s=>s.id===id),
  findByInvite(token){
    for (const s of db.searches) {
      const c = s.candidates.find(x=>x.invite===token);
      if (c) return { search: s, candidate: c };
    }
    return null;
  },
  touch(search, user, x){
    search.updatedAt = now();
    // `who` is the display name a reader recognises; `by` is the stable account
    // id a record has to carry, because names change and two people can share
    // one. `role` separates a firm decision from a committee action without
    // needing to resolve the account later.
    if (x) search.activity.unshift({ at: now(), who: user.name, by: user.id || null, role: user.role || null, x });
  }
};
