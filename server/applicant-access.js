'use strict';

/**
 * Who the applicant is, and how they get back to their own application.
 *
 * Deliberately a separate identity from the staff one. Workspace access runs
 * through Clerk organizations and decides what a consultant may do inside a
 * firm; this decides only one thing — that the person holding this session
 * proved control of one email address. The two never meet. An applicant cannot
 * acquire workspace access by applying, a staff session grants nothing in the
 * portal, and an applicant never needs an invitation to anything.
 *
 * The flow is passwordless because a password is a thing to lose, and somebody
 * applying for one job should not be made to create an account:
 *
 *   ask for a code -> a short-lived challenge is stored, hashed
 *   enter the code -> the challenge is consumed, a session cookie is issued
 *   come back later -> the cookie, or a fresh code
 *
 * Three properties matter enough to state:
 *
 *  - Nothing stored here is usable as a credential. Codes and session tokens
 *    are stored as SHA-256 hashes, so a copy of the store does not let its
 *    reader open somebody's application.
 *  - Requesting a code says the same thing whatever the address. "We sent a
 *    code if that address can apply" is the only answer, so the endpoint
 *    cannot be used to ask whether a person applied for a job.
 *  - Sessions are revocable and expire. A shared or borrowed computer is the
 *    normal case for a candidate, not the exception.
 */

const crypto = require('crypto');
const organizations = require('./organizations');

// Short, because a code sitting in a mailbox is a credential. Long enough that
// somebody can read it off a phone and type it on a laptop.
const CODE_TTL_MS = 15 * 60 * 1000;
const CODE_ATTEMPTS = 5;
// A session outlives the code by a lot, because the alternative is making an
// applicant re-verify every time they add a paragraph.
const SESSION_TTL_MS = 14 * 24 * 60 * 60 * 1000;
const COOKIE = 'slate_applicant';

function now() { return new Date().toISOString(); }

function hash(value) {
  return crypto.createHash('sha256').update(String(value)).digest('hex');
}

function ensureTables(store) {
  store.applicants ||= [];
  store.applicantChallenges ||= [];
  store.applicantSessions ||= [];
  return store;
}

/* ------------------------------------------------------------------ *
 * Email
 * ------------------------------------------------------------------ */

// Deliberately permissive. The code sent to the address is the real check, and
// a regular expression that rejects a valid but unusual address is a person
// who cannot apply for a job.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function normalizeEmail(value) {
  return organizations.normalizeEmail(value);
}

function validEmail(value) {
  const email = normalizeEmail(value);
  return Boolean(email) && email.length <= 254 && EMAIL_RE.test(email);
}

/* ------------------------------------------------------------------ *
 * Applicants
 * ------------------------------------------------------------------ */

/**
 * The person behind a verified address, created on first verification.
 *
 * One record per address across the whole deployment, because the same person
 * applying to two firms is the same person. What is kept separate is their
 * *applications*: see server/applications.js, where every read is scoped to
 * one workspace so one firm can never learn that somebody applied to another.
 */
function findApplicantByEmail(store, email) {
  const address = normalizeEmail(email);
  return (store.applicants || []).find(a => a.email === address) || null;
}

function findApplicant(store, id) {
  return (store.applicants || []).find(a => a.id === id) || null;
}

function upsertApplicant(store, email) {
  ensureTables(store);
  const address = normalizeEmail(email);
  const existing = findApplicantByEmail(store, address);
  if (existing) {
    existing.verifiedAt = now();
    return existing;
  }
  const record = {
    id: 'ap-' + crypto.randomBytes(6).toString('hex'),
    email: address,
    createdAt: now(),
    verifiedAt: now()
  };
  store.applicants.push(record);
  return record;
}

/* ------------------------------------------------------------------ *
 * Verification challenges
 * ------------------------------------------------------------------ */

function code() {
  // Six digits, uniformly drawn. Readable over a phone, and the attempt limit
  // rather than the length is what makes guessing it useless.
  return String(crypto.randomInt(0, 1000000)).padStart(6, '0');
}

/**
 * Start a verification.
 *
 * Any outstanding challenge for the same address is dropped first, so a resend
 * genuinely replaces the previous code rather than leaving two valid ones in
 * two mailboxes.
 */
function startChallenge(store, email) {
  ensureTables(store);
  const address = normalizeEmail(email);
  const emailKey = hash(address);
  store.applicantChallenges = store.applicantChallenges.filter(c => c.emailKey !== emailKey);
  const plain = code();
  const record = {
    id: 'ch-' + crypto.randomBytes(6).toString('hex'),
    emailKey,
    codeHash: hash(address + ':' + plain),
    createdAt: now(),
    expiresAt: new Date(Date.now() + CODE_TTL_MS).toISOString(),
    attempts: 0
  };
  store.applicantChallenges.push(record);
  prune(store);
  // The plain code is returned to the caller so it can be handed to the mailer
  // and then forgotten. It is never stored and never logged.
  return { challenge: record, code: plain, expiresInMinutes: Math.round(CODE_TTL_MS / 60000) };
}

/**
 * Check a code and, if it is right, create the applicant and a session.
 *
 * Every failure returns the same shape and a message that does not distinguish
 * "no challenge for that address" from "wrong code": the first would confirm
 * whether an address had asked to apply.
 */
function verifyChallenge(store, email, submitted) {
  ensureTables(store);
  const address = normalizeEmail(email);
  const emailKey = hash(address);
  const wrong = { error: 'That code is not right, or it has expired. Ask for a new one.' };

  const challenge = store.applicantChallenges.find(c => c.emailKey === emailKey);
  if (!challenge) return wrong;
  if (Date.parse(challenge.expiresAt) <= Date.now()) {
    store.applicantChallenges = store.applicantChallenges.filter(c => c !== challenge);
    return wrong;
  }
  challenge.attempts += 1;
  if (challenge.attempts > CODE_ATTEMPTS) {
    store.applicantChallenges = store.applicantChallenges.filter(c => c !== challenge);
    return { error: 'Too many attempts on that code. Ask for a new one.' };
  }
  const offered = hash(address + ':' + String(submitted || '').trim());
  // Constant-time, so the number of leading digits that matched is not
  // readable from how long the answer took.
  const ok = offered.length === challenge.codeHash.length
    && crypto.timingSafeEqual(Buffer.from(offered), Buffer.from(challenge.codeHash));
  if (!ok) return wrong;

  store.applicantChallenges = store.applicantChallenges.filter(c => c !== challenge);
  const applicant = upsertApplicant(store, address);
  const session = createSession(store, applicant);
  return { applicant, session: session.record, token: session.token };
}

/* ------------------------------------------------------------------ *
 * Sessions
 * ------------------------------------------------------------------ */

function createSession(store, applicant) {
  ensureTables(store);
  const token = crypto.randomBytes(32).toString('base64url');
  const record = {
    id: 'as-' + crypto.randomBytes(6).toString('hex'),
    tokenHash: hash(token),
    applicantId: applicant.id,
    createdAt: now(),
    lastSeenAt: now(),
    expiresAt: new Date(Date.now() + SESSION_TTL_MS).toISOString()
  };
  store.applicantSessions.push(record);
  prune(store);
  return { record, token };
}

function readSession(store, token) {
  if (!token) return null;
  ensureTables(store);
  const tokenHash = hash(token);
  const session = store.applicantSessions.find(s => s.tokenHash === tokenHash);
  if (!session) return null;
  if (session.revokedAt || Date.parse(session.expiresAt) <= Date.now()) return null;
  const applicant = findApplicant(store, session.applicantId);
  if (!applicant) return null;
  session.lastSeenAt = now();
  return { session, applicant };
}

function revokeSession(store, token) {
  ensureTables(store);
  const tokenHash = hash(token);
  const session = store.applicantSessions.find(s => s.tokenHash === tokenHash);
  if (!session) return false;
  session.revokedAt = now();
  return true;
}

/** Drop expired challenges and sessions. Cheap, and run on every write. */
function prune(store) {
  ensureTables(store);
  const at = Date.now();
  store.applicantChallenges = store.applicantChallenges.filter(c => Date.parse(c.expiresAt) > at);
  store.applicantSessions = store.applicantSessions.filter(s =>
    !s.revokedAt && Date.parse(s.expiresAt) > at);
}

/* ------------------------------------------------------------------ *
 * The cookie
 * ------------------------------------------------------------------ */

/**
 * Parsed by hand because the application has no cookie middleware and adding
 * one for a single cookie would put a dependency on the request path of every
 * staff route as well.
 */
function readCookie(req) {
  const header = String(req.headers?.cookie || '');
  for (const part of header.split(';')) {
    const [name, ...rest] = part.trim().split('=');
    if (name === COOKIE) return decodeURIComponent(rest.join('='));
  }
  return null;
}

/**
 * Scoped as narrowly as the flow allows.
 *
 * HttpOnly so a script cannot read it, SameSite=Lax so a cross-site form post
 * cannot ride it (the application's own same-origin check is the other half),
 * Secure wherever the deployment terminates TLS, and Path limited to the
 * applicant API so it is not attached to requests for the shell, the fonts, or
 * anything staff-facing.
 */
function cookieHeader(token, { secure = false, maxAgeMs = SESSION_TTL_MS } = {}) {
  const parts = [
    COOKIE + '=' + encodeURIComponent(token),
    'Path=/api/applications',
    'HttpOnly',
    'SameSite=Lax',
    'Max-Age=' + Math.floor(maxAgeMs / 1000)
  ];
  if (secure) parts.push('Secure');
  return parts.join('; ');
}

function clearCookieHeader({ secure = false } = {}) {
  const parts = [COOKIE + '=', 'Path=/api/applications', 'HttpOnly', 'SameSite=Lax', 'Max-Age=0'];
  if (secure) parts.push('Secure');
  return parts.join('; ');
}

module.exports = {
  COOKIE, CODE_TTL_MS, CODE_ATTEMPTS, SESSION_TTL_MS,
  ensureTables, normalizeEmail, validEmail,
  findApplicant, findApplicantByEmail, upsertApplicant,
  startChallenge, verifyChallenge,
  createSession, readSession, revokeSession, prune,
  readCookie, cookieHeader, clearCookieHeader
};
