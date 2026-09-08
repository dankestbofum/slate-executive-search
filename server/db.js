'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const integrity = require('./integrity');
const credentials = require('./credentials');
const backup = require('./backup');
const jurisdictions = require('./jurisdictions');

const isProd = process.env.NODE_ENV === 'production';
const DATA_DIR = process.env.DATA_DIR
  || process.env.RAILWAY_VOLUME_MOUNT_PATH
  || path.join(__dirname, '..', 'data');
const DATA_FILE = path.join(DATA_DIR, 'slate.json');
// Session length. Configurable so the county can set its own, with a ceiling
// that cannot be raised by configuration: a cookie that outlives the
// engagement is not a session, it is a standing key.
const SESSION_MAX_DAYS = 30;
const SESSION_DAYS = Math.min(
  Math.max(Number(process.env.SLATE_SESSION_DAYS) || 14, 1),
  SESSION_MAX_DAYS
);
const SESSION_MS = SESSION_DAYS * 24 * 60 * 60 * 1000;

if (isProd && !process.env.DATA_DIR && !process.env.RAILWAY_VOLUME_MOUNT_PATH) {
  console.error('Slate: production needs a persistent disk. Set DATA_DIR or attach a volume.');
  process.exit(1);
}

const { PHASES, STEPS, STAFF_STEPS, STAFF_STAGES, PACKAGES, PACKAGE_ORDER, DEFAULT_PACKAGE, COMPARE, COMPARE_BANDS, packageOf, stepsFor } = require('./steps');

// A shared firm sign-in, so day-to-day work does not require remembering which
// named consultant you are. It is ensured on every boot rather than only at
// first seed, so it exists on stores that predate it. Locally the PIN defaults
// to something obvious; in production it appears only if SLATE_PIN_TEAM is set.
const TEAM_ACCOUNT = {
  id: 'u0',
  name: 'Slate Team',
  init: 'ST',
  role: 'consultant',
  title: 'Search team'
};

function ensureTeamAccount(store){
  const pin = process.env.SLATE_PIN_TEAM || (isProd ? '' : '1234');
  const email = (process.env.SLATE_EMAIL_TEAM || 'team@slate.local').toLowerCase();
  const existing = store.users.find(u => u.id === TEAM_ACCOUNT.id);
  // No PIN configured in production: leave any existing account alone rather
  // than locking someone out mid-search, and do not conjure a new one.
  if (!pin) return;
  requireStrong('SLATE_PIN_TEAM', pin);
  if (existing) {
    existing.email = email;
    if (!credentials.verify(existing, String(pin))) {
      credentials.set(existing, String(pin));
      for (const [id, session] of Object.entries(store.sessions || {})) if (session.userId === existing.id) delete store.sessions[id];
    }
    existing.role = 'consultant';
    return;
  }
  // First in the list, so it is the account the sign-in page offers.
  store.users.unshift({ ...TEAM_ACCOUNT, email, pin: String(pin) });
}

// New production credentials must clear the strength policy. Applied when a
// value is supplied, in any environment, so the rule is exercised by the test
// suite rather than only discovered on a production first boot.
function requireStrong(label, secret){
  if (!isProd) return;
  const weak = credentials.weakness(secret);
  if (weak) {
    console.error('Slate: ' + label + ' is not acceptable for production. ' + weak);
    process.exit(1);
  }
}

/**
 * Report accounts that still authenticate with a published development PIN.
 *
 * Migration hashed whatever PIN an account already had. Hashing a weak secret
 * does not make it strong, so an operator needs to be told rather than left to
 * assume the upgrade fixed it.
 */
function auditWeakCredentials(store){
  const weak = (store.users || []).filter(user =>
    [...credentials.DEV_DEFAULTS].some(guess => credentials.verify(user, guess)));
  if (!weak.length) return [];
  console.error('Slate: ' + weak.length + ' account(s) still use a published development PIN: '
    + weak.map(u => u.email || u.id).join(', '));
  console.error('Slate: reset them with `node scripts/accounts.js reset <id>` before real records are entered.');
  return weak;
}

function seedUsers(){
  const abePin = process.env.SLATE_PIN_ABE || (isProd ? '' : '2468');
  const mikePin = process.env.SLATE_PIN_MIKE || (isProd ? '' : '1357');
  if (!abePin || !mikePin) {
    console.error('Slate: first boot needs SLATE_PIN_ABE and SLATE_PIN_MIKE.');
    process.exit(1);
  }
  requireStrong('SLATE_PIN_ABE', abePin);
  requireStrong('SLATE_PIN_MIKE', mikePin);
  return [
    { id:'u1', email: process.env.SLATE_EMAIL_ABE || 'abe@slate.local',  pin: String(abePin), name:'Abe Macy',     init:'AM', role:'consultant', title:'Operations' },
    { id:'u2', email: process.env.SLATE_EMAIL_MIKE || 'mike@slate.local', pin: String(mikePin), name:'Mike Letcher', init:'ML', role:'consultant', title:'Search consultant' }
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

// Committee members sign in with the same email plus PIN the consultants use.
// The consultant generates the PIN when they seat someone and reads it to them;
// there is no mail server in this app.
function makePin(){
  return String(crypto.randomInt(10000000, 100000000));
}

function blankSearch(input, user){
  return {
    id: nid('sr'),
    no: null,
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
    // seat. `members` is the whole roster, manager included, so there is one
    // list to read rather than a field plus a list that can disagree.
    members: [{ userId: user.id, seat: 'manager', addedAt: now(), addedBy: user.id }],
    team: { confirmedAt: null, confirmedBy: null },
    intake: {
      status: 'draft',
      dueBy: '',
      prompt: '',
      openedAt: null,
      closedAt: null,
      submissions: {}
    },
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
    activity: [{ at: now(), who: user.name, x: 'opened the search' }]
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

function load(){
  requireWritableDataDir();
  if (!fs.existsSync(DATA_FILE)) {
    const db = { users: seedUsers(), sessions: {}, searches: [], seq: 0 };
    // A fresh store goes through the same path as an existing one, so the
    // shared team sign-in is never a first-boot-only accident.
    migrate(db);
    save(db);
    return db;
  }
  backup.ensureDaily(DATA_DIR);
  const loaded = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
  // Backfill sessions written before `exp` existed, so every session object
  // always carries it and callers never need a per-request fallback.
  for (const [id, sess] of Object.entries(loaded.sessions || {})) {
    if (!sess.exp) sess.exp = Date.parse(sess.at || '') + SESSION_MS;
    if (!Number.isFinite(sess.exp) || sess.exp <= Date.now()) delete loaded.sessions[id];
  }
  migrate(loaded);
  if (isProd) auditWeakCredentials(loaded);
  save(loaded);
  return loaded;
}

// Searches written before the committee existed have no roster and no intake.
// Seat their creator as account manager and treat their profile as already
// adopted, so an in-flight search does not reopen at Step 1 with its later
// work locked behind a step that did not exist when it was done.
function migrate(store){
  store.archivedSearches ||= [];
  store.users = store.users || [];
  for (const u of store.users) {
    if (!u.role) u.role = 'consultant';
    if (!u.init) u.init = initials(u.name);
  }
  ensureTeamAccount(store);
  for (const u of store.users) if (u.pin !== undefined) credentials.set(u, String(u.pin));
  for (const s of [...(store.searches || []), ...store.archivedSearches]) {
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
        seat: 'manager',
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
        submissions: {},
        legacy: legacy || undefined
      };
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
  return (search.members || []).find(m => m.seat === 'manager') || null;
}

function isConsultant(user){
  return Boolean(user) && user.role === 'consultant';
}

/**
 * Who may open a search file at all.
 *
 * Consultants see the whole book of business; that is how the firm works and it
 * is unchanged. A committee member sees only the searches they are seated on,
 * because their account exists for one search.
 */
function canView(search, user){
  if (!user) return false;
  if (isConsultant(user)) return true;
  return Boolean(memberOf(search, user.id));
}

/** Editing the search file itself stays with the firm, not the committee. */
function canEdit(search, user){
  return isConsultant(user) && canView(search, user);
}

/** Rostering, intake windows, and adoption belong to the account manager. */
function canManage(search, user){
  if (!isConsultant(user)) return false;
  const mgr = accountManager(search);
  return !mgr || mgr.userId === user.id;
}

/**
 * Retire committee accounts that are no longer seated anywhere.
 *
 * A committee account exists to serve one search. When that seat goes away,
 * whether the member was removed or the whole search was deleted, the account
 * would otherwise linger as a live email and PIN that opens an app with
 * nothing in it. Consultants are never touched: their accounts belong to the
 * firm, not to a search.
 */
function pruneOrphanCommittee(){
  const seated = new Set();
  for (const s of db.searches) {
    for (const m of s.members || []) seated.add(m.userId);
  }
  const orphans = new Set(
    db.users.filter(u => u.role === 'committee' && !seated.has(u.id)).map(u => u.id)
  );
  if (!orphans.size) return 0;
  db.users = db.users.filter(u => !orphans.has(u.id));
  for (const [sid, sess] of Object.entries(db.sessions)) {
    if (orphans.has(sess.userId)) delete db.sessions[sid];
  }
  return orphans.size;
}

/** The roster with names attached, ready for the client. */
function roster(search){
  return (search.members || []).map(m => {
    const u = findUserById(m.userId);
    return {
      userId: m.userId,
      seat: m.seat,
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
        // on its own. What marks the step done is the manager saying the seats
        // are set, which is also what makes it safe to open intake.
        const seated = (search.members || []).length;
        status = search.team?.confirmedAt ? 'done' : (seated > 1 ? 'now' : 'open');
        break;
      }
      case 'intake': {
        // Closing the window is the manager's call, not a headcount. A member
        // who never answers should not be able to stall the whole search.
        const intake = search.intake || {};
        if (intake.status === 'closed') status = 'done';
        else if (intake.status === 'open') status = 'now';
        else status = Object.keys(intake.submissions || {}).length ? 'now' : 'open';
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

function decorate(search, viewer){
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
  if (viewer) {
    const uid = viewer.id;
    const seat = memberOf(search, uid);
    out.you = {
      seat: seat ? seat.seat : null,
      member: Boolean(seat),
      consultant: isConsultant(viewer),
      canEdit: canEdit(search, viewer),
      canManage: canManage(search, viewer)
    };
    // Intake is answered in confidence. Until the manager closes the window,
    // each person sees only their own submission; showing the room's answers
    // early would turn independent input into an anchoring exercise.
    const intake = search.intake || {};
    const open = intake.status !== 'closed';
    out.intake = {
      ...intake,
      submissions: open
        ? { [uid]: (intake.submissions || {})[uid] || null }
        : (intake.submissions || {})
    };
    if (!search.released) {
      out.scores = { [uid]: (search.scores || {})[uid] || {} };
      out.notesBy = { [uid]: (search.notesBy || {})[uid] || {} };
    }
    // Sourcing calls and reference conversations are the firm's working notes
    // about people, some of whom are sitting managers who have not told their
    // own council they are looking. A committee member does not read them.
    if (!isConsultant(viewer)) {
      out.staff = {};
      const fields = ['id', 'name', 'cur', 'org', 'yrs', 'email', 'stage', 'survey1', 'survey2', 'survey2SentAt', 'survey2Deadline', 'addedAt', 'referenceConsentAt', 'referenceConsentBy'];
      out.candidates = (search.candidates || []).map(c => Object.fromEntries(fields.filter(k => k in c).map(k => [k, c[k]])));
    }
  }
  return out;
}

function nextNo(){
  db.seq = (db.seq||0) + 1;
  return 'SR-' + new Date().getFullYear() + '-' + String(db.seq).padStart(3,'0');
}

function findUserByEmail(email){
  return db.users.find(u => u.email.toLowerCase() === String(email || '').toLowerCase());
}

/**
 * Seat someone who does not have an account yet.
 *
 * Returns the user and the plaintext PIN, which is the only time the PIN is
 * handed back. The consultant reads it to the member; only its salted hash
 * remains in the store.
 */
/**
 * Sessions belonging to one account.
 *
 * Every path that weakens or withdraws an account's authority calls this.
 * Changing a credential or disabling an account has to take effect now, not
 * whenever a fourteen-day cookie happens to lapse.
 */
function revokeSessions(userId){
  let n = 0;
  for (const [id, sess] of Object.entries(db.sessions || {})) {
    if (sess.userId === userId) { delete db.sessions[id]; n += 1; }
  }
  return n;
}

/**
 * Disable or restore an account without deleting it.
 *
 * Deleting would break attribution: history records who made each decision,
 * and a search record has to stay readable after someone leaves. A disabled
 * account keeps its identity, loses its access immediately, and can be
 * restored if the person returns.
 */
function setDisabled(user, disabled, actor){
  if (!user) return null;
  if (disabled) {
    user.disabled = true;
    user.disabledAt = now();
    user.disabledBy = actor || 'operator';
    revokeSessions(user.id);
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
  const pin = makePin();
  const u = {
    id: nid('u'),
    email: String(email || '').trim().toLowerCase(),
    pin,
    name: String(name || '').trim(),
    init: initials(name),
    role: role === 'consultant' ? 'consultant' : 'committee',
    title: String(title || '').trim() || 'Committee member',
    createdAt: now()
  };
  credentials.set(u, pin);
  db.users.push(u);
  return { user: u, pin };
}

module.exports = {
  PHASES, STEPS, STAFF_STEPS, STAFF_STAGES, PACKAGES, PACKAGE_ORDER, DEFAULT_PACKAGE, COMPARE, COMPARE_BANDS, packageOf, stepsOf,
  staffRecord,
  REVIEW_STEPS, reviewed, nid, now, persist, DATA_DIR, SESSION_MS, SESSION_DAYS, SESSION_MAX_DAYS,
  get db(){ return db; },
  publicUser,
  decorate,
  nextNo,
  blankSearch,
  createUser,
  auditWeakCredentials,
  revokeSessions,
  setDisabled,
  isDisabled,
  initials,
  makePin,
  ensureBackup: () => backup.ensureDaily(DATA_DIR),
  memberOf,
  accountManager,
  roster,
  pruneOrphanCommittee,
  isConsultant,
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
    if (x) search.activity.unshift({ at: now(), who: user.name, x });
  }
};
