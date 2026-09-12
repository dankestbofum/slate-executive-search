'use strict';

/**
 * The browser half of the identity fixture.
 *
 * A real session needs Clerk's own JavaScript, served from Clerk's domain, and
 * an account at Clerk. The browser suite has neither and must stay offline, so
 * the SDK is stubbed at its origin: the page gets a Clerk object that hands out
 * the same fixture-signed token the server verifies for real. Everything below
 * the token — proving it, resolving it to an account, roles and seats — is the
 * production path, and so is every request the app makes with it.
 */
const identity = require('../identity');

const ORIGIN = 'https://' + identity.DOMAIN;
const SCRIPTS = ORIGIN + '/npm/**';

/** Authorization headers for API calls made outside the page. */
function authHeaders(email) {
  return identity.signer(process.env.SLATE_TEST_CLERK_KEY).headers(email);
}

const UI_STUB = 'window.__internal_ClerkUICtor = class ClerkUI {};';

// Signed-in state is kept in localStorage so it survives the reload the app
// performs when the session changes, exactly as a real Clerk cookie would.
function clerkStub(token, email, signedInByDefault) {
  return `(() => {
  const TOKEN = ${JSON.stringify(token)};
  const EMAIL = ${JSON.stringify(email)};
  const KEY = 'slate-clerk-fixture';
  let stored = null;
  try { stored = localStorage.getItem(KEY); } catch {}
  let signedIn = stored === null ? ${Boolean(signedInByDefault)} : stored === '1';
  const listeners = [];
  const remember = value => { signedIn = value; try { localStorage.setItem(KEY, value ? '1' : '0'); } catch {} };
  const session = () => signedIn ? { id: 'sess_fixture', getToken: async () => TOKEN } : null;
  const emit = () => { for (const fn of listeners) fn({ session: session() }); };
  window.Clerk = {
    get user() { return signedIn ? { id: 'user_fixture', primaryEmailAddress: { emailAddress: EMAIL } } : null; },
    get session() { return session(); },
    async load() {},
    addListener(fn) { listeners.push(fn); },
    openSignIn() { remember(true); emit(); },
    openSignUp() { remember(true); emit(); },
    async signOut() { remember(false); emit(); },
    mountUserButton(element) { element.textContent = 'Account'; },
    unmountUserButton() {}
  };
})();`;
}

/**
 * Serve the stubbed SDK to one page or context.
 *
 * `email` is the account the session belongs to; `signedIn` is only the state
 * the page starts in, since signing in and out during a test moves it.
 */
async function installClerk(target, { email = 'abe@slate.local', signedIn = true } = {}) {
  const token = identity.signer(process.env.SLATE_TEST_CLERK_KEY).token(email);
  // API calls a test makes outside the page carry the same session the page
  // holds. A page that starts signed out gets no header, or /api/me would
  // answer for an account the app does not believe it is signed in as.
  if (signedIn) {
    const context = target.context ? target.context() : target;
    await context.setExtraHTTPHeaders({ authorization: 'Bearer ' + token });
  }
  await target.route(SCRIPTS, route => route.fulfill({
    status: 200,
    contentType: 'application/javascript',
    headers: { 'access-control-allow-origin': '*', 'cache-control': 'no-store' },
    body: route.request().url().includes('/@clerk/ui@') ? UI_STUB : clerkStub(token, email, signedIn)
  }));
}

module.exports = { ORIGIN, authHeaders, installClerk };
