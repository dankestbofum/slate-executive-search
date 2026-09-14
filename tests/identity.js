'use strict';

/**
 * One way in, in tests too.
 *
 * Slate has a single sign-in path: a Clerk session. Rather than keep a second
 * login for the suite, tests mint real Clerk JWTs signed with a fixture key the
 * test server verifies against, so every request runs the production identity
 * path. The Clerk directory is the only part stubbed: the subject carries the
 * account's email (see `fixtureProfile` in server/auth.js), which is what lets
 * the whole suite run offline with no Clerk credentials.
 */
const crypto = require('crypto');

const ISSUER = 'https://fixture.clerk.accounts.dev';
const DOMAIN = 'fixture.clerk.accounts.dev';

/** The environment a test server needs to accept fixture-signed sessions. */
function serverEnv() {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
  return {
    server: {
      CLERK_PUBLISHABLE_KEY: 'pk_test_' + Buffer.from(DOMAIN + '$').toString('base64').replace(/=+$/, ''),
      CLERK_SECRET_KEY: 'sk_test_offline_fixture',
      CLERK_JWT_KEY: publicKey.export({ type: 'spki', format: 'pem' }),
      SLATE_CLERK_FIXTURE: 'true',
      // Keep the suite offline: nothing here should reach clerk.com.
      CLERK_TELEMETRY_DISABLED: '1'
    },
    privateKey: privateKey.export({ type: 'pkcs8', format: 'pem' })
  };
}

/** The Clerk subject Slate resolves back to this account. */
function subject(email) {
  return 'user_' + Buffer.from(String(email).trim().toLowerCase(), 'utf8').toString('base64url');
}

/**
 * Session claims for an active organization.
 *
 * Clerk's v1 claim shape, which is what a token without a `v` claim is read as
 * (see __experimental_JWTPayloadToAuthObjectProperties in @clerk/shared). The
 * role in the token is deliberately not what Slate acts on — the server
 * re-reads it from the directory — so a test can sign a token claiming any role
 * it likes and the answer still comes from the membership.
 */
function orgClaims(orgId, role = 'org:consultant') {
  return orgId ? { org_id: orgId, org_role: role } : {};
}

/**
 * The workspace the suite works in.
 *
 * Almost every test is about something inside one firm, not about the boundary
 * between firms, so the harness stands one workspace up and every signed
 * session names it by default. SLATE_TEST_ORG_ID is how tests/run.js passes it
 * to the suites it spawns; a test about isolation overrides it per request.
 */
function defaultOrg() {
  return process.env.SLATE_TEST_ORG_ID || null;
}

/**
 * Stand up a workspace with the seeded accounts in it.
 *
 * Runs the production path end to end: the first account creates the
 * organization and becomes its administrator, then invites the others. The
 * offline directory accepts an invitation on the invitee's next request (see
 * server/organizations.js), which is what a person does in Clerk's own UI.
 */
async function bootstrapWorkspace(base, { owner, staff = [], name = 'Fixture Search Partners', privateKey } = {}) {
  const sign = signer(privateKey);
  const json = { 'content-type': 'application/json' };
  const created = await fetch(base + '/api/organizations', {
    method: 'POST', headers: { ...sign.headers(owner), ...json }, body: JSON.stringify({ name })
  });
  if (!created.ok) throw new Error('Could not create the fixture workspace: ' + await created.text());
  const { organization } = await created.json();

  for (const email of staff) {
    const invited = await fetch(base + '/api/organization/invitations', {
      method: 'POST', headers: { ...sign.inOrg(owner, organization.id, 'org:admin'), ...json },
      body: JSON.stringify({ email, role: 'org:consultant' })
    });
    if (!invited.ok) throw new Error('Could not invite ' + email + ': ' + await invited.text());
    // Their first request is what accepts the invitation.
    await fetch(base + '/api/me', { headers: sign.inOrg(email, organization.id, 'org:consultant') });
  }
  return organization.id;
}

/** A signer bound to one fixture key, usually the one in SLATE_TEST_CLERK_KEY. */
function signer(privateKeyPem = process.env.SLATE_TEST_CLERK_KEY) {
  if (!privateKeyPem) throw new Error('No fixture signing key. Run this suite through tests/run.js.');
  const key = crypto.createPrivateKey(privateKeyPem);
  const encode = value => Buffer.from(JSON.stringify(value)).toString('base64url');
  function token(email, overrides = {}) {
    const now = Math.floor(Date.now() / 1000);
    const body = encode({ alg: 'RS256', typ: 'JWT', kid: 'fixture' }) + '.' + encode({
      iss: ISSUER, sub: subject(email), sid: 'sess_' + crypto.randomBytes(8).toString('hex'),
      iat: now, nbf: now - 10, exp: now + 3600,
      // The workspace the suite is running in, unless the caller names another.
      // The claimed role is deliberately not what the server acts on: it
      // re-reads the membership from the directory on every request.
      ...orgClaims(defaultOrg()), ...overrides
    });
    return body + '.' + crypto.sign('RSA-SHA256', Buffer.from(body), key).toString('base64url');
  }
  return {
    token,
    /** Authorization headers for `email`, ready to spread into a fetch. */
    headers(email, overrides) { return { authorization: 'Bearer ' + token(email, overrides) }; },
    /** Headers for `email` working inside `orgId`. */
    inOrg(email, orgId, role, overrides) {
      return { authorization: 'Bearer ' + token(email, { ...orgClaims(orgId, role), ...overrides }) };
    },
    /** A session Clerk is holding until a required task is answered. */
    pending(email, overrides) {
      return { authorization: 'Bearer ' + token(email, { sts: 'pending', ...overrides }) };
    }
  };
}

module.exports = { ISSUER, DOMAIN, serverEnv, subject, signer, orgClaims, defaultOrg, bootstrapWorkspace };
