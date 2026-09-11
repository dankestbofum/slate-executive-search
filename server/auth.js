'use strict';

// Clerk proves identity; Slate retains authority over roles and search seats.
const { clerkMiddleware, clerkClient, getAuth } = require('@clerk/express');

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
    // is no Clerk directory behind them to ask who a subject is. Only then, and
    // only under NODE_ENV=test, is the subject read as the account's email.
    fixtureDirectory: env.NODE_ENV === 'test' && env.SLATE_CLERK_FIXTURE === 'true',
    adminEmails: String(env.SLATE_CLERK_ADMIN_EMAILS || '').split(',').map(s => s.trim().toLowerCase()).filter(Boolean),
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

async function resolveUser(store, userId, getUser, adminEmails = []) {
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
    const admin = adminEmails.includes(email);
    user = store.createUser({
      email, name: [profile.firstName, profile.lastName].filter(Boolean).join(' ') || email,
      role: admin ? 'consultant' : 'committee',
      title: admin ? 'Search consultant' : 'Committee member'
    }).user;
  }
  user.clerkUserId = userId;
  store.persist();
  return user;
}

function createAuth(store, config = configuration()) {
  const middleware = config.configured
    ? clerkMiddleware({ ...(config.authorizedParties.length ? { authorizedParties: config.authorizedParties } : {}) })
    : (_req, _res, next) => next();
  const getUser = config.fixtureDirectory
    ? async id => fixtureProfile(id)
    : id => clerkClient.users.getUser(id);
  return {
    config, middleware,
    publicConfig: {
      provider: 'clerk',
      configured: config.configured,
      ...(config.configured ? { publishableKey: config.publishableKey, domain: config.domain } : {})
    },
    async requireUser(req, res, next) {
      if (!config.configured) return res.status(503).json({ error: 'Sign-in is temporarily unavailable. Please contact the workspace administrator.' });
      const { userId, isAuthenticated } = getAuth(req);
      if (!isAuthenticated || !userId) return res.status(401).json({ error: 'Sign in to open the workspace.' });
      try {
        const user = await resolveUser(store, userId, getUser, config.adminEmails);
        if (!user) return res.status(403).json({ error: 'Your account is unavailable. Verify your primary email or contact the workspace administrator.' });
        req.user = user;
        next();
      } catch {
        res.status(503).json({ error: 'We could not verify your account. Please try again shortly.' });
      }
    }
  };
}

module.exports = { configuration, fixtureProfile, resolveUser, createAuth };
