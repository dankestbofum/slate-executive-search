'use strict';

/**
 * The browser half of the identity fixture.
 *
 * A real session needs Clerk's own JavaScript, served from Clerk's domain, and
 * an account at Clerk. The browser suite has neither and must stay offline, so
 * the SDK is stubbed at its origin: the page gets a Clerk object that hands out
 * the same fixture-signed token the server verifies for real. Everything below
 * the token — proving it, resolving it to an account, the workspace membership
 * behind it, roles and assignments — is the production path, and so is every request
 * the app makes with it.
 *
 * Organizations are part of the session, so the stub carries them too: one
 * pre-minted token per workspace, `setActive` to move between them, and the
 * listener event the app watches for a switch made in another tab.
 */
const identity = require('../identity');

const ORIGIN = 'https://' + identity.DOMAIN;
const SCRIPTS = ORIGIN + '/npm/**';
let BASE = process.env.SLATE_BROWSER_BASE || 'http://127.0.0.1:4188';

/**
 * Point the fixture at a different server.
 *
 * The browser suite's server is fixed by playwright.config.js, but the design
 * audit tools in docs/design-audit start their own on their own ports and reuse
 * this fixture. They call this before anything else so the workspace is created
 * against the server they are actually driving.
 */
function useBase(url) {
  BASE = url;
  sharedWorkspaceId = null;
  bootstrapping = null;
}

const signer = () => identity.signer(process.env.SLATE_TEST_CLERK_KEY);

/** Authorization headers for API calls made outside the page. */
function authHeaders(email, orgId = sharedWorkspaceId) {
  return orgId ? signer().inOrg(email, orgId) : signer().headers(email, { org_id: undefined });
}

/**
 * The firm workspace the suite works in.
 *
 * Created once, through the same route a real firm owner uses, because a
 * workspace is now the precondition for every screen that is not account setup.
 * Specs that are about not having one ask for `organization: null` instead.
 */
let sharedWorkspaceId = null;
let bootstrapping = null;

async function sharedWorkspace() {
  if (sharedWorkspaceId) return sharedWorkspaceId;
  bootstrapping ||= (async () => {
    const owner = 'abe@slate.local';
    const sign = signer();
    const headers = { ...sign.headers(owner, { org_id: undefined }), 'content-type': 'application/json' };
    const existing = await fetch(BASE + '/api/organizations', { headers });
    if (existing.ok) {
      const usable = (await existing.json()).workspaces.find(w => w.role);
      if (usable) return usable.id;
    }
    const created = await fetch(BASE + '/api/organizations', {
      method: 'POST', headers, body: JSON.stringify({ name: 'Fixture Search Partners' })
    });
    if (!created.ok) throw new Error('Could not create the fixture workspace: ' + await created.text());
    const { organization } = await created.json();
    // The other seeded consultants join it the way anybody does.
    for (const email of ['mike@slate.local', 'team@slate.local']) {
      await fetch(BASE + '/api/organization/invitations', {
        method: 'POST',
        headers: { ...sign.inOrg(owner, organization.id, 'org:admin'), 'content-type': 'application/json' },
        body: JSON.stringify({ email, role: 'org:consultant' })
      });
      await fetch(BASE + '/api/me', { headers: sign.inOrg(email, organization.id) });
    }
    return organization.id;
  })();
  sharedWorkspaceId = await bootstrapping;
  return sharedWorkspaceId;
}

/** Invite `email` into the shared workspace and let their first request accept. */
async function joinWorkspace(email, role = 'org:committee') {
  const orgId = await sharedWorkspace();
  const sign = signer();
  await fetch(BASE + '/api/organization/invitations', {
    method: 'POST',
    headers: { ...sign.inOrg('abe@slate.local', orgId, 'org:admin'), 'content-type': 'application/json' },
    body: JSON.stringify({ email, role })
  });
  await fetch(BASE + '/api/me', { headers: sign.inOrg(email, orgId) });
  return orgId;
}

const UI_STUB = 'window.__internal_ClerkUICtor = class ClerkUI {};';

// Signed-in state and the active workspace are kept in localStorage so they
// survive the reload the app performs when either changes, exactly as a real
// Clerk cookie would.
function clerkStub(tokens, workspaces, email, signedInByDefault, startingOrg) {
  return `(() => {
  const TOKENS = ${JSON.stringify(tokens)};
  const WORKSPACES = ${JSON.stringify(workspaces)};
  const EMAIL = ${JSON.stringify(email)};
  const KEY = 'slate-clerk-fixture';
  const ORG_KEY = 'slate-clerk-fixture-org';
  let stored = null, storedOrg = null;
  try { stored = localStorage.getItem(KEY); storedOrg = localStorage.getItem(ORG_KEY); } catch {}
  let signedIn = stored === null ? ${Boolean(signedInByDefault)} : stored === '1';
  let orgId = storedOrg === null ? ${JSON.stringify(startingOrg)} : (storedOrg || null);
  const listeners = [];
  // A workspace created during the test. The harness signs a session for it in
  // Node the moment the API returns and hands it over here, because the page
  // has no key and a workspace id is not knowable in advance.
  window.__slateFixtureAddWorkspace = (id, token, name) => {
    TOKENS[id] = token;
    if (!WORKSPACES.some(w => w.id === id)) WORKSPACES.push({ id, name, role: 'org:admin', invited: false });
  };
  const remember = value => { signedIn = value; try { localStorage.setItem(KEY, value ? '1' : '0'); } catch {} };
  const rememberOrg = value => { orgId = value; try { localStorage.setItem(ORG_KEY, value || ''); } catch {} };
  const organization = () => {
    const found = WORKSPACES.find(w => w.id === orgId);
    return found ? { id: found.id, name: found.name } : null;
  };
  const session = () => signedIn
    ? { id: 'sess_fixture', currentTask: null, getToken: async () => TOKENS[orgId || ''] || TOKENS[''] }
    : null;
  const emit = () => { for (const fn of listeners) fn({ session: session(), organization: organization() }); };
  const invitations = () => WORKSPACES.filter(w => w.invited && w.id !== orgId).map(w => ({
    id: 'inv_' + w.id,
    role: w.role,
    publicOrganizationData: { id: w.id, name: w.name },
    accept: async () => { rememberOrg(w.id); emit(); }
  }));
  window.Clerk = {
    get user() {
      return signedIn ? {
        id: 'user_fixture',
        primaryEmailAddress: { emailAddress: EMAIL },
        getOrganizationInvitations: async () => ({ data: invitations() })
      } : null;
    },
    get session() { return session(); },
    get organization() { return organization(); },
    async load() {},
    addListener(fn) { listeners.push(fn); },
    async setActive({ organization: next }) {
      const id = typeof next === 'string' ? next : next?.id || null;
      if (!TOKENS[id || '']) throw new Error('No session for that workspace.');
      // Playwright's context headers are applied over the page's own, so the
      // out-of-page session has to move at the same moment the in-page one does
      // or the next request would carry the workspace we just left.
      if (window.__slateFixtureSwitched) await window.__slateFixtureSwitched(id || '');
      rememberOrg(id);
      emit();
    },
    // Signing back in returns to the workspace this session was last in, which
    // is what a real instance does with an account that has one.
    openSignIn() { remember(true); if (!orgId) rememberOrg(${JSON.stringify(startingOrg)}); emit(); },
    openSignUp() { remember(true); if (!orgId) rememberOrg(${JSON.stringify(startingOrg)}); emit(); },
    async signOut() { remember(false); rememberOrg(null); emit(); },
    mountUserButton(element) {
      const account = document.createElement('button');
      account.type = 'button';
      account.textContent = 'AM';
      // Clerk's own button is styled; this stand-in would otherwise be an
      // unstyled native control whose default grey-on-white fails a contrast
      // audit of Slate's page for a reason that is not Slate's.
      account.style.cssText = 'background:#1D4E89;color:#FFFFFF;border:0;border-radius:999px;padding:6px 10px;font:inherit';
      account.setAttribute('aria-label', 'Open account menu');
      account.setAttribute('aria-expanded', 'false');
      const signOut = document.createElement('button');
      signOut.type = 'button';
      signOut.textContent = 'Sign out';
      signOut.style.cssText = 'background:#FFFFFF;color:#163D50;border:1px solid #5E737D;border-radius:6px;padding:6px 10px;font:inherit';
      signOut.hidden = true;
      account.onclick = () => { signOut.hidden = !signOut.hidden; account.setAttribute('aria-expanded', String(!signOut.hidden)); };
      signOut.onclick = () => window.Clerk.signOut();
      element.replaceChildren(account, signOut);
    },
    unmountUserButton() {}
  };
})();`;
}

/**
 * Serve the stubbed SDK to one page or context.
 *
 * `email` is the account the session belongs to; `signedIn` is only the state
 * the page starts in, since signing in and out during a test moves it.
 * `organization` is the workspace the session starts active in: the shared
 * fixture workspace by default, `null` for a spec about not having one, and an
 * array to give the account several to choose between.
 */
async function installClerk(target, { email = 'abe@slate.local', signedIn = true, organization = 'shared', invited = [] } = {}) {
  const sign = signer();
  const shared = await sharedWorkspace();
  const resolve = id => (id === 'shared' ? shared : id);

  const wanted = Array.isArray(organization) ? organization.map(resolve) : [resolve(organization)].filter(Boolean);
  const startingOrg = wanted[0] || null;
  const invitedIds = invited.map(resolve);

  // One signed session per workspace, plus one with no workspace at all, so
  // switching in the page produces exactly the token that workspace's requests
  // must carry.
  const tokens = { '': sign.token(email, { org_id: undefined }) };
  for (const id of [...wanted, ...invitedIds]) tokens[id] = sign.token(email, identity.orgClaims(id));

  const names = { [shared]: 'Fixture Search Partners' };
  const workspaces = [...new Set([...wanted, ...invitedIds])].map(id => ({
    id, name: names[id] || 'Workspace ' + id, role: 'org:committee', invited: invitedIds.includes(id)
  }));

  const context = target.context ? target.context() : target;

  // API calls a test makes outside the page carry the same session the page
  // holds. A page that starts signed out gets no header, or /api/me would
  // answer for an account the app does not believe it is signed in as.
  if (signedIn) {
    await context.setExtraHTTPHeaders({ authorization: 'Bearer ' + (tokens[startingOrg || ''] || tokens['']) });
  }

  // Playwright applies a context's extra headers over the ones a page sets on
  // its own fetches, so the out-of-page session has to follow the in-page one
  // through a switch. The stub calls this the instant it changes workspace.
  if (target.exposeBinding) {
    // A spec may install the fixture twice on one page, to move from one
    // account to another. The binding is per page and only has to exist once.
    await target.exposeBinding('__slateFixtureSwitched', async (_source, id) => {
      await context.setExtraHTTPHeaders({ authorization: 'Bearer ' + (tokens[id || ''] || tokens['']) });
    }).catch(error => {
      if (!/already registered/.test(String(error?.message))) throw error;
    });
  }

  // Read at serve time, so a workspace created mid-test is present in the stub
  // the page gets after the reload that completes the switch.
  await target.route(SCRIPTS, route => route.fulfill({
    status: 200,
    contentType: 'application/javascript',
    headers: { 'access-control-allow-origin': '*', 'cache-control': 'no-store' },
    body: route.request().url().includes('/@clerk/ui@')
      ? UI_STUB
      : clerkStub(tokens, workspaces, email, signedIn, startingOrg)
  }));

  /**
   * Sign a session for a workspace the test creates while it is running.
   *
   * A workspace id is decided by the server, so it cannot be pre-minted. The
   * moment the API hands one back, this signs a session for it in Node — the
   * page has no key — and gives it to the running stub as well as to every
   * later page load.
   */
  await target.route('**/api/organizations', async route => {
    const response = await route.fetch();
    const body = await response.text();
    if (route.request().method() === 'POST' && response.ok()) {
      try {
        const { organization } = JSON.parse(body);
        if (organization?.id && !tokens[organization.id]) {
          tokens[organization.id] = sign.token(email, identity.orgClaims(organization.id, 'org:admin'));
          names[organization.id] = organization.name;
          workspaces.push({ id: organization.id, name: organization.name, role: 'org:admin', invited: false });
          await context.setExtraHTTPHeaders({ authorization: 'Bearer ' + tokens[organization.id] });
          if (target.evaluate) {
            await target.evaluate(([id, token, name]) => window.__slateFixtureAddWorkspace?.(id, token, name),
              [organization.id, tokens[organization.id], organization.name]);
          }
        }
      } catch { /* a body this fixture does not need to understand */ }
    }
    await route.fulfill({ response, body });
  });

  return { workspaceId: shared, startingOrg };
}

module.exports = { ORIGIN, useBase, authHeaders, installClerk, sharedWorkspace, joinWorkspace, get BASE() { return BASE; } };
