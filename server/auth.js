'use strict';

// Clerk proves identity and organization membership; Slate retains authority
// over search seats. The two halves meet in the access context this module
// builds for every request (`req.access`), which is the only thing the
// permission helpers in server/db.js will answer from.
const { clerkMiddleware, clerkClient, getAuth } = require('@clerk/express');
const organizations = require('./organizations');
const committee = require('./committee');

function configuration(env = process.env) {
  const publishableKey = String(env.CLERK_PUBLISHABLE_KEY || '').trim();
  let domain = '';
  if (/^pk_(test|live)_[A-Za-z0-9_-]+$/.test(publishableKey)) {
    const decoded = Buffer.from(publishableKey.split('_')[2], 'base64').toString('utf8');
    if (/^[a-z0-9]+(?:[.-][a-z0-9]+)+\$$/i.test(decoded)) domain = decoded.slice(0, -1);
  }
  return {
    publishableKey, domain,
    configured: Boolean(domain && env.CLERK_SECRET_KEY),
    // The regression suite signs real Clerk JWTs with a fixture key, but there
    // is no Clerk directory behind them to ask who a subject is, or which
    // organizations it belongs to. Only then, and only under NODE_ENV=test, is
    // the subject read as the account's email and the directory read from the
    // store.
    fixtureDirectory: env.NODE_ENV === 'test' && env.SLATE_CLERK_FIXTURE === 'true',
    invitationRedirectUrl: String(env.SLATE_INVITATION_REDIRECT_URL || '').trim(),
    authorizedParties: String(env.CLERK_AUTHORIZED_PARTIES || '').split(',').map(s => s.trim()).filter(Boolean)
  };
}

/** The profile Clerk would return, derived from a `user_<base64url(email)>` subject. */
function fixtureProfile(userId) {
  const encoded = String(userId).replace(/^user_/, '');
  const email = Buffer.from(encoded, 'base64url').toString('utf8');
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new Error('No fixture account for ' + userId);
  return {
    primaryEmailAddressId: 'primary', firstName: '', lastName: '',
    emailAddresses: [{ id: 'primary', emailAddress: email, verification: { status: 'verified' } }]
  };
}

/**
 * The Slate account behind a Clerk identity.
 *
 * A new account arrives with no role and no workspace. Nothing about the email
 * address grants anything: an operator allowlist used to mint a consultant
 * here, which is exactly the kind of global grant that would sit above
 * organization membership and defeat it. Authority now comes only from an
 * accepted membership in an organization.
 */
async function resolveUser(store, userId, getUser) {
  let user = store.db.users.find(u => u.clerkUserId === userId);
  if (user) return store.isDisabled(user) ? null : user;

  const profile = await getUser(userId);
  const verified = (profile.emailAddresses || []).filter(e => e.verification?.status === 'verified');
  const primary = verified.find(e => e.id === profile.primaryEmailAddressId);
  if (!primary) return null;
  const email = primary.emailAddress.trim().toLowerCase();
  // Recheck after the network request, so concurrent first requests cannot
  // create duplicate users or bind an email to two different Clerk identities.
  user = store.db.users.find(u => u.clerkUserId === userId) || store.findUserByEmail(email);
  if (user && (store.isDisabled(user) || (user.clerkUserId && user.clerkUserId !== userId))) return null;
  if (!user) {
    user = store.createUser({
      email, name: [profile.firstName, profile.lastName].filter(Boolean).join(' ') || email,
      role: 'pending', title: 'Account setup'
    }).user;
    user.onboarding = { completedAt: null };
  }
  user.clerkUserId = userId;
  store.persist();
  return user;
}

/**
 * Turn a held seat into a real one, now that the person has actually joined.
 *
 * A search manager can prepare a committee before anybody has an account. The
 * seat waits as a pending assignment against an email and an organization; it
 * only becomes a seat when that same person shows up with a verified primary
 * email and a membership in that organization. Running on every request is
 * what makes it idempotent — the pending record is consumed, so a retry after
 * a crashed save finds nothing left to do rather than seating them twice.
 */
function adoptPendingAssignments(store, user, orgId) {
  if (!orgId) return false;
  const waiting = organizations.pendingForEmail(store.db, user.email).filter(p => p.orgId === orgId);
  if (!waiting.length) return false;
  let changed = false;
  for (const held of waiting) {
    const search = store.db.searches.find(s => s.id === held.searchId && s.organizationId === orgId);
    if (!search) {
      // The search was archived or deleted while the invitation was out. The
      // held seat has nothing to attach to, so it goes rather than lingering.
      organizations.removePendingAssignment(store.db, held.id);
      changed = true;
      continue;
    }
    // The manager typed a name when they held the seat. Use it if the Clerk
    // profile gave us nothing better, so the roster reads as people rather
    // than as email addresses.
    if (held.name && user.name === user.email) {
      user.name = held.name;
      user.init = store.initials(user.name);
    }
    if (!store.memberOf(search, user.id)) {
      search.members.push({
        userId: user.id, seat: committee.seatOf(held.seat),
        addedAt: store.now(), addedBy: held.invitedBy || null, fromInvitation: held.id
      });
      // The roster changed, so a confirmation given before this person joined
      // no longer describes the committee.
      search.team = { confirmedAt: null, confirmedBy: null };
      store.touch(search, user, 'joined the search from an invitation');
    }
    organizations.removePendingAssignment(store.db, held.id);
    changed = true;
  }
  return changed;
}

/**
 * What this request is allowed to be, resolved once and used everywhere.
 *
 * The active organization comes from the signed session, never from a body or
 * a query parameter. The role attached to it is re-read from the directory
 * rather than trusted from the token: a session token issued before somebody
 * was demoted still carries the old role until it refreshes, and Slate should
 * not honour it for even that long. The cost is one directory call per
 * protected request, taken deliberately for the pilot in preference to a cache
 * whose revocation guarantee has not been tested.
 */
async function buildAccess(store, directory, user, clerkUserId, claimedOrgId) {
  const base = {
    user, userId: user.id, clerkUserId,
    orgId: null, organization: null, role: null,
    capabilities: organizations.NO_CAPABILITIES,
    // Set when the session names an organization the directory says this
    // person is no longer in. The client explains that rather than silently
    // showing an empty workspace.
    membershipLost: false
  };
  // Accepting an invitation happens in Clerk's own UI, which the offline
  // fixture does not have; the fixture directory accepts on sight instead.
  // Undefined against a real Clerk instance, where acceptance is the person's
  // own deliberate act and nothing here may stand in for it.
  if (directory.acceptInvitation) await directory.acceptInvitation(clerkUserId, user.email);

  if (!claimedOrgId) return base;

  const membership = await directory.membership(claimedOrgId, clerkUserId);
  if (!membership) return { ...base, membershipLost: true };

  const role = organizations.isSupportedRole(membership.role) ? membership.role : null;
  const organization = await directory.organization(claimedOrgId);

  let changed = false;
  if (organization) {
    organizations.rememberOrganization(store.db, { id: organization.id, name: organization.name, slug: organization.slug });
    changed = true;
  }
  organizations.rememberMembership(store.db, { orgId: claimedOrgId, userId: user.id, role: membership.role });
  changed = true;

  // An unsupported role — Clerk's own `org:member` among them — is a member of
  // the organization with no Slate capabilities at all. They get the awaiting
  // access screen, not a guess at what the role was meant to mean.
  const access = {
    ...base,
    orgId: claimedOrgId,
    organization: organization || organizations.findOrganization(store.db, claimedOrgId) || { id: claimedOrgId, name: claimedOrgId },
    role,
    providerRole: membership.role,
    capabilities: organizations.capabilitiesFor(role)
  };

  if (role && adoptPendingAssignments(store, user, claimedOrgId)) changed = true;
  if (changed) store.persist();
  return access;
}

function createAuth(store, config = configuration()) {
  const middleware = config.configured
    ? clerkMiddleware({ ...(config.authorizedParties.length ? { authorizedParties: config.authorizedParties } : {}) })
    : (_req, _res, next) => next();
  const getUser = config.fixtureDirectory
    ? async id => fixtureProfile(id)
    : id => clerkClient.users.getUser(id);
  const directory = organizations.createDirectory(store, { ...config, clerkClient });

  return {
    config, middleware, directory,
    publicConfig: {
      provider: 'clerk',
      configured: config.configured,
      ...(config.configured ? { publishableKey: config.publishableKey, domain: config.domain } : {})
    },

    /**
     * Identity, plus whatever organization context the session carries.
     *
     * Deliberately does not require an organization: account setup, the
     * workspace chooser, and creating a first workspace all have to be
     * reachable before there is one. `requireWorkspace` is the gate for
     * everything that touches a firm's records.
     */
    async requireUser(req, res, next) {
      if (!config.configured) return res.status(503).json({ error: 'Sign-in is temporarily unavailable. Please contact the workspace administrator.' });
      // Pending sessions are read rather than discarded: Clerk holds a session
      // in `pending` while a required task — choosing an organization — is
      // unresolved, and answering that with a bare 401 would send the client
      // back to a sign-in screen the person has already passed.
      const { userId, isAuthenticated, sessionStatus, orgId } = getAuth(req, { treatPendingAsSignedOut: false });
      if (sessionStatus === 'pending') {
        return res.status(401).json({
          error: 'Finish choosing a workspace to continue.', code: 'SESSION_TASK_PENDING'
        });
      }
      if (!isAuthenticated || !userId) return res.status(401).json({ error: 'Sign in to open the workspace.' });
      try {
        const user = await resolveUser(store, userId, getUser);
        if (!user) return res.status(403).json({ error: 'Your account is unavailable. Verify your primary email or contact the workspace administrator.' });
        req.user = user;
        req.access = await buildAccess(store, directory, user, userId, orgId || null);
        next();
      } catch (error) {
        if (error?.code === 'DIRECTORY_UNAVAILABLE') {
          return res.status(503).json({ error: error.message, code: 'DIRECTORY_UNAVAILABLE' });
        }
        res.status(503).json({ error: 'We could not verify your account. Please try again shortly.' });
      }
    },

    /** Everything that reads or writes a firm's records runs inside a workspace. */
    requireWorkspace(req, res, next) {
      const access = req.access;
      if (!access?.orgId) {
        return res.status(403).json({
          error: 'Choose a workspace to continue.', code: 'NO_ACTIVE_ORGANIZATION'
        });
      }
      if (!access.role) {
        return res.status(403).json({
          error: 'Your role in this workspace does not open the search records. Ask an administrator to assign your access.',
          code: 'ROLE_NOT_SUPPORTED'
        });
      }
      next();
    },

    /** Organization administration: invitations, roles, and removals. */
    requireOrgAdmin(req, res, next) {
      if (!req.access?.capabilities?.manageMembers) {
        return res.status(403).json({ error: 'An organization administrator manages members and invitations.' });
      }
      next();
    }
  };
}

module.exports = { configuration, fixtureProfile, resolveUser, adoptPendingAssignments, buildAccess, createAuth };
