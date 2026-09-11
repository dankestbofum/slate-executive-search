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

/** A signer bound to one fixture key, usually the one in SLATE_TEST_CLERK_KEY. */
function signer(privateKeyPem = process.env.SLATE_TEST_CLERK_KEY) {
  if (!privateKeyPem) throw new Error('No fixture signing key. Run this suite through tests/run.js.');
  const key = crypto.createPrivateKey(privateKeyPem);
  const encode = value => Buffer.from(JSON.stringify(value)).toString('base64url');
  function token(email, overrides = {}) {
    const now = Math.floor(Date.now() / 1000);
    const body = encode({ alg: 'RS256', typ: 'JWT', kid: 'fixture' }) + '.' + encode({
      iss: ISSUER, sub: subject(email), sid: 'sess_' + crypto.randomBytes(8).toString('hex'),
      iat: now, nbf: now - 10, exp: now + 3600, ...overrides
    });
    return body + '.' + crypto.sign('RSA-SHA256', Buffer.from(body), key).toString('base64url');
  }
  return {
    token,
    /** Authorization headers for `email`, ready to spread into a fetch. */
    headers(email, overrides) { return { authorization: 'Bearer ' + token(email, overrides) }; }
  };
}

module.exports = { ISSUER, DOMAIN, serverEnv, subject, signer };
