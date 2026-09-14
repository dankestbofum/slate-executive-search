'use strict';

/**
 * Organizations — a firm's shared workspace.
 *
 * One Clerk organization is one firm. Membership in it is what gets a person
 * into the workspace at all; Slate's own roster (the `members` array on a
 * search) is what decides which searches they work on. The two are
 * deliberately different questions, and conflating them is how a committee
 * member from one client ends up reading another client's file.
 *
 *   Clerk is authoritative for membership and role.
 *   Slate is authoritative for search seats.
 *
 * Everything below follows from that. The local `organizations` and
 * `memberships` tables are a display cache and a migration mapping; nothing in
 * the request path grants access from them. A protected request re-reads the
 * membership from Clerk's Backend API, so removing somebody at Clerk ends
 * their access on their next request rather than whenever their session token
 * happens to expire.
 */

const crypto = require('crypto');

/* ------------------------------------------------------------------ *
 * Roles
 *
 * Clerk ships `org:admin` and `org:member`. `org:member` carries directory and
 * billing permissions by default, which is not what a committee member should
 * hold, so Slate does not read it as anything: the two working roles are
 * custom roles the instance has to declare. An unrecognised role — including
 * `org:member` — resolves to no access at all rather than to a guess.
 * ------------------------------------------------------------------ */
const ADMIN = 'org:admin';
const CONSULTANT = 'org:consultant';
const COMMITTEE = 'org:committee';

const ROLES = [ADMIN, CONSULTANT, COMMITTEE];

const ROLE_LABEL = {
  [ADMIN]: 'Organization administrator',
  [CONSULTANT]: 'Search consultant',
  [COMMITTEE]: 'Committee member'
};

const ROLE_SUMMARY = {
  [ADMIN]: 'Invites colleagues, sets their roles, and works across every search in this workspace.',
  [CONSULTANT]: 'Opens and runs this workspace’s searches alongside the rest of the firm.',
  [COMMITTEE]: 'Reads and scores the searches they are individually assigned to.'
};

// Least privilege is the default an administrator moves away from
// deliberately, not the one they have to remember to choose.
const DEFAULT_INVITE_ROLE = COMMITTEE;

function isSupportedRole(role) {
  return ROLES.includes(role);
}

/**
 * What this role may do inside its own organization.
 *
 * `staff` is the old firm-wide `isConsultant` answer, now scoped: it means
 * "works across this workspace's searches", which an administrator does too.
 * The client renders controls from these rather than inferring them from a
 * role name, so a role added later does not silently light up a button.
 */
function capabilitiesFor(role) {
  const admin = role === ADMIN;
  const staff = admin || role === CONSULTANT;
  return {
    staff,
    admin,
    createSearch: staff,
    viewArchives: staff,
    viewDirectory: staff,
    manageMembers: admin,
    inviteMembers: admin
  };
}

const NO_CAPABILITIES = Object.freeze(capabilitiesFor(null));

/* ------------------------------------------------------------------ *
 * Local tables
 *
 * `organizations` remembers a workspace's name so Home can be titled without a
 * provider round trip, and so an archived search still says which firm it
 * belonged to. `memberships` caches the last verified role for the
 * administrator's Members list and for migration mapping. `pendingAssignments`
 * is Slate's own: a search seat held for somebody who has been invited to the
 * organization but has not accepted yet.
 * ------------------------------------------------------------------ */

function ensureTables(store) {
  store.organizations ||= [];
  store.memberships ||= [];
  store.pendingAssignments ||= [];
  return store;
}

function now() {
  return new Date().toISOString();
}

function normalizeEmail(email) {
  return String(email || '').trim().toLowerCase();
}

function findOrganization(db, orgId) {
  return (db.organizations || []).find(o => o.id === orgId) || null;
}

function rememberOrganization(db, { id, name, slug = null, createdBy = null }) {
  ensureTables(db);
  const existing = findOrganization(db, id);
  if (existing) {
    if (name) existing.name = name;
    existing.slug = slug;
    existing.seenAt = now();
    return existing;
  }
  const record = { id, name: name || id, slug, createdAt: now(), createdBy, seenAt: now() };
  db.organizations.push(record);
  return record;
}

function findMembership(db, orgId, userId) {
  return (db.memberships || []).find(m => m.orgId === orgId && m.userId === userId) || null;
}

/** Record what the provider just said, so the Members list has names to show. */
function rememberMembership(db, { orgId, userId, role }) {
  ensureTables(db);
  const existing = findMembership(db, orgId, userId);
  if (existing) {
    existing.role = role;
    existing.verifiedAt = now();
    return existing;
  }
  const record = { orgId, userId, role, addedAt: now(), verifiedAt: now() };
  db.memberships.push(record);
  return record;
}

function forgetMembership(db, orgId, userId) {
  ensureTables(db);
  const before = db.memberships.length;
  db.memberships = db.memberships.filter(m => !(m.orgId === orgId && m.userId === userId));
  return db.memberships.length !== before;
}

function membershipsOfUser(db, userId) {
  return (db.memberships || []).filter(m => m.userId === userId);
}

/* ------------------------------------------------------------------ *
 * Pending search assignments
 *
 * A manager preparing a committee for a new client usually knows the names
 * before anybody has an account. Slate holds the seat against an email and the
 * organization it belongs to; it becomes a real seat only once that person
 * accepts the organization invitation and signs in. Matching on an email alone
 * never grants anything — acceptance at Clerk is what proves the address.
 * ------------------------------------------------------------------ */

function pendingFor(db, orgId, searchId) {
  return (db.pendingAssignments || []).filter(p => p.orgId === orgId && p.searchId === searchId);
}

function pendingForEmail(db, email) {
  const address = normalizeEmail(email);
  return (db.pendingAssignments || []).filter(p => p.email === address);
}

function addPendingAssignment(db, { orgId, searchId, email, name, seat, invitedBy, invitationId = null }) {
  ensureTables(db);
  const address = normalizeEmail(email);
  const existing = db.pendingAssignments.find(p => p.orgId === orgId && p.searchId === searchId && p.email === address);
  if (existing) {
    existing.seat = seat;
    if (name) existing.name = String(name).trim();
    if (invitationId) existing.invitationId = invitationId;
    return existing;
  }
  const record = {
    id: 'pa-' + crypto.randomBytes(4).toString('hex'),
    orgId, searchId, email: address, name: String(name || '').trim(), seat,
    invitationId, invitedBy, createdAt: now()
  };
  db.pendingAssignments.push(record);
  return record;
}

function removePendingAssignment(db, id) {
  ensureTables(db);
  const before = db.pendingAssignments.length;
  db.pendingAssignments = db.pendingAssignments.filter(p => p.id !== id);
  return db.pendingAssignments.length !== before;
}

/** Drop every held seat for a search, used when the search leaves the book. */
function clearPendingForSearch(db, searchId) {
  ensureTables(db);
  db.pendingAssignments = db.pendingAssignments.filter(p => p.searchId !== searchId);
}

/* ------------------------------------------------------------------ *
 * The directory
 *
 * Every question about who belongs to an organization goes through here, so
 * there is one place that talks to the provider and one place the regression
 * suite substitutes. The substitution is the same bargain `fixtureProfile` in
 * server/auth.js already makes: the suite signs real Clerk JWTs but has no
 * Clerk directory behind them, so under NODE_ENV=test with
 * SLATE_CLERK_FIXTURE=true — and only then — the directory is a table in the
 * store. Everything above it, including every authorization decision, is the
 * production path.
 * ------------------------------------------------------------------ */

/** A provider failure, so callers can fail closed with a 503 rather than a 500. */
function unavailable(cause) {
  const error = new Error('We could not verify your workspace membership. Please try again shortly.');
  error.code = 'DIRECTORY_UNAVAILABLE';
  error.cause = cause;
  return error;
}

/** A refusal the provider made, carried through with its own explanation. */
function rejected(message, status = 400) {
  const error = new Error(message);
  error.code = 'DIRECTORY_REJECTED';
  error.status = status;
  return error;
}

const PAGE = 100;
const MAX_PAGES = 5;

/** Walk a Clerk paginated list far enough for a firm-sized workspace. */
async function collect(fetchPage) {
  const out = [];
  for (let page = 0; page < MAX_PAGES; page += 1) {
    const result = await fetchPage({ limit: PAGE, offset: page * PAGE });
    const rows = result?.data || [];
    out.push(...rows);
    if (rows.length < PAGE) break;
  }
  return out;
}

function primaryEmailOf(userData) {
  if (!userData) return '';
  const list = userData.emailAddresses || [];
  const primary = list.find(e => e.id === userData.primaryEmailAddressId) || list[0];
  return normalizeEmail(primary?.emailAddress || userData.identifier || '');
}

function clerkDirectory(clerkClient) {
  const organizations = () => clerkClient.organizations;

  const shapeMembership = m => ({
    id: m.id,
    clerkUserId: m.publicUserData?.userId || m.publicUserData?.user_id || null,
    role: m.role,
    email: primaryEmailOf(m.publicUserData) || normalizeEmail(m.publicUserData?.identifier),
    name: [m.publicUserData?.firstName, m.publicUserData?.lastName].filter(Boolean).join(' '),
    createdAt: m.createdAt ? new Date(m.createdAt).toISOString() : null
  });

  const shapeInvitation = i => ({
    id: i.id,
    email: normalizeEmail(i.emailAddress),
    role: i.role,
    status: i.status,
    createdAt: i.createdAt ? new Date(i.createdAt).toISOString() : null,
    expiresAt: i.expiresAt ? new Date(i.expiresAt).toISOString() : null
  });

  return {
    provider: 'clerk',

    async organization(orgId) {
      try {
        const org = await organizations().getOrganization({ organizationId: orgId });
        return { id: org.id, name: org.name, slug: org.slug || null };
      } catch (error) {
        if (error?.status === 404) return null;
        throw unavailable(error);
      }
    },

    async membership(orgId, clerkUserId) {
      try {
        const result = await organizations().getOrganizationMembershipList({
          organizationId: orgId, userId: [clerkUserId], limit: 1
        });
        const row = (result?.data || [])[0];
        return row ? shapeMembership(row) : null;
      } catch (error) {
        // A deleted organization is a definite "no membership", not an outage.
        if (error?.status === 404) return null;
        throw unavailable(error);
      }
    },

    async members(orgId) {
      try {
        const rows = await collect(q => organizations().getOrganizationMembershipList({ organizationId: orgId, ...q }));
        return rows.map(shapeMembership);
      } catch (error) { throw unavailable(error); }
    },

    async userOrganizations(clerkUserId) {
      try {
        const rows = await collect(q => clerkClient.users.getOrganizationMembershipList({ userId: clerkUserId, ...q }));
        return rows.map(m => ({
          id: m.organization?.id, name: m.organization?.name, slug: m.organization?.slug || null, role: m.role
        })).filter(o => o.id);
      } catch (error) { throw unavailable(error); }
    },

    async invitations(orgId) {
      try {
        const rows = await collect(q => organizations().getOrganizationInvitationList({ organizationId: orgId, status: ['pending'], ...q }));
        return rows.map(shapeInvitation);
      } catch (error) { throw unavailable(error); }
    },

    async invite(orgId, { email, role, inviterClerkUserId, redirectUrl }) {
      try {
        const created = await organizations().createOrganizationInvitation({
          organizationId: orgId, emailAddress: email, role,
          ...(inviterClerkUserId ? { inviterUserId: inviterClerkUserId } : {}),
          ...(redirectUrl ? { redirectUrl } : {})
        });
        return shapeInvitation(created);
      } catch (error) {
        if (error?.status === 400 || error?.status === 422) {
          throw rejected(error?.errors?.[0]?.message || 'Clerk refused that invitation.', 400);
        }
        throw unavailable(error);
      }
    },

    async revokeInvitation(orgId, invitationId, requesterClerkUserId) {
      try {
        await organizations().revokeOrganizationInvitation({
          organizationId: orgId, invitationId, requestingUserId: requesterClerkUserId
        });
      } catch (error) {
        if (error?.status === 404) throw rejected('That invitation is no longer pending.', 409);
        throw unavailable(error);
      }
    },

    async setRole(orgId, clerkUserId, role) {
      try {
        const updated = await organizations().updateOrganizationMembership({ organizationId: orgId, userId: clerkUserId, role });
        return shapeMembership(updated);
      } catch (error) {
        if (error?.status === 404) throw rejected('That person is no longer in this workspace.', 409);
        throw unavailable(error);
      }
    },

    async removeMember(orgId, clerkUserId) {
      try {
        await organizations().deleteOrganizationMembership({ organizationId: orgId, userId: clerkUserId });
      } catch (error) {
        if (error?.status === 404) throw rejected('That person is no longer in this workspace.', 409);
        throw unavailable(error);
      }
    },

    async createOrganization({ name, createdByClerkUserId }) {
      try {
        const org = await organizations().createOrganization({ name, createdBy: createdByClerkUserId });
        return { id: org.id, name: org.name, slug: org.slug || null };
      } catch (error) {
        if (error?.status === 400 || error?.status === 422) {
          throw rejected(error?.errors?.[0]?.message || 'Clerk refused that workspace name.', 400);
        }
        throw unavailable(error);
      }
    }
  };
}

/**
 * The offline stand-in for the directory.
 *
 * Reachable only under NODE_ENV=test with SLATE_CLERK_FIXTURE=true. It keeps
 * its own tables, separate from the `organizations`/`memberships` cache, so
 * that "the local cache never grants access" stays a true statement about the
 * production code path rather than one this fixture quietly undermines.
 */
function fixtureDirectory(store) {
  const tables = () => {
    store.db.directoryFixture ||= { organizations: [], memberships: [], invitations: [], seq: 0 };
    return store.db.directoryFixture;
  };
  const find = (orgId) => tables().organizations.find(o => o.id === orgId) || null;

  return {
    provider: 'fixture',

    async organization(orgId) {
      const org = find(orgId);
      return org ? { id: org.id, name: org.name, slug: org.slug || null } : null;
    },

    async membership(orgId, clerkUserId) {
      const row = tables().memberships.find(m => m.orgId === orgId && m.clerkUserId === clerkUserId);
      return row ? { ...row } : null;
    },

    async members(orgId) {
      return tables().memberships.filter(m => m.orgId === orgId).map(m => ({ ...m }));
    },

    async userOrganizations(clerkUserId) {
      return tables().memberships.filter(m => m.clerkUserId === clerkUserId).map(m => {
        const org = find(m.orgId);
        return { id: m.orgId, name: org?.name || m.orgId, slug: org?.slug || null, role: m.role };
      });
    },

    async invitations(orgId) {
      return tables().invitations.filter(i => i.orgId === orgId && i.status === 'pending').map(i => ({ ...i }));
    },

    async invite(orgId, { email, role, inviterClerkUserId }) {
      const t = tables();
      const address = normalizeEmail(email);
      if (t.memberships.some(m => m.orgId === orgId && m.email === address)) {
        throw rejected(address + ' is already in this workspace.', 409);
      }
      if (t.invitations.some(i => i.orgId === orgId && i.email === address && i.status === 'pending')) {
        throw rejected(address + ' already has a pending invitation.', 409);
      }
      t.seq += 1;
      const invitation = {
        id: 'orginv_' + t.seq, orgId, email: address, role, status: 'pending',
        invitedBy: inviterClerkUserId || null,
        createdAt: now(), expiresAt: new Date(Date.now() + 30 * 86400000).toISOString()
      };
      t.invitations.push(invitation);
      store.persist();
      return { ...invitation };
    },

    async revokeInvitation(orgId, invitationId) {
      const invitation = tables().invitations.find(i => i.id === invitationId && i.orgId === orgId && i.status === 'pending');
      if (!invitation) throw rejected('That invitation is no longer pending.', 409);
      invitation.status = 'revoked';
      store.persist();
    },

    async setRole(orgId, clerkUserId, role) {
      const row = tables().memberships.find(m => m.orgId === orgId && m.clerkUserId === clerkUserId);
      if (!row) throw rejected('That person is no longer in this workspace.', 409);
      row.role = role;
      store.persist();
      return { ...row };
    },

    async removeMember(orgId, clerkUserId) {
      const t = tables();
      const before = t.memberships.length;
      t.memberships = t.memberships.filter(m => !(m.orgId === orgId && m.clerkUserId === clerkUserId));
      if (t.memberships.length === before) throw rejected('That person is no longer in this workspace.', 409);
      store.persist();
    },

    async createOrganization({ name, createdByClerkUserId, createdByEmail }) {
      const t = tables();
      t.seq += 1;
      const org = { id: 'org_fixture' + t.seq, name: String(name).trim(), slug: null, createdAt: now() };
      t.organizations.push(org);
      t.memberships.push({
        id: 'orgmem_' + t.seq, orgId: org.id, clerkUserId: createdByClerkUserId,
        role: ADMIN, email: normalizeEmail(createdByEmail), name: '', createdAt: now()
      });
      store.persist();
      return { id: org.id, name: org.name, slug: null };
    },

    /** Accepting an invitation, which a real instance does through Clerk's UI. */
    async acceptInvitation(clerkUserId, email) {
      const t = tables();
      const address = normalizeEmail(email);
      const accepted = [];
      for (const invitation of t.invitations.filter(i => i.email === address && i.status === 'pending')) {
        invitation.status = 'accepted';
        t.seq += 1;
        t.memberships.push({
          id: 'orgmem_' + t.seq, orgId: invitation.orgId, clerkUserId,
          role: invitation.role, email: address, name: '', createdAt: now()
        });
        accepted.push(invitation.orgId);
      }
      if (accepted.length) store.persist();
      return accepted;
    }
  };
}

function createDirectory(store, config) {
  return config.fixtureDirectory ? fixtureDirectory(store) : clerkDirectory(config.clerkClient);
}

module.exports = {
  ADMIN, CONSULTANT, COMMITTEE, ROLES, ROLE_LABEL, ROLE_SUMMARY, DEFAULT_INVITE_ROLE,
  NO_CAPABILITIES,
  isSupportedRole, capabilitiesFor, ensureTables, normalizeEmail,
  findOrganization, rememberOrganization,
  findMembership, rememberMembership, forgetMembership, membershipsOfUser,
  pendingFor, pendingForEmail, addPendingAssignment, removePendingAssignment, clearPendingForSearch,
  createDirectory, unavailable, rejected
};
