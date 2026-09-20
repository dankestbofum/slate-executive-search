'use strict';

const organizations = require('./organizations');

// What a person says they came here to do. It is a preference that shapes the
// guidance they are shown and nothing else: an administrator assigns the role
// that actually grants access, and accepting an invitation adopts the role
// that invitation carried.
const ROLES = ['organization', 'consultant', 'committee', 'candidate'];

/**
 * Do we know what to call this person?
 *
 * A new Clerk account often arrives with no name at all, and Slate falls back
 * to the email address so there is something to show. That fallback is what
 * account setup exists to replace. New accounts also confirm their intended
 * use, even when the provider supplied a name. Named legacy accounts retain
 * access without being forced through setup again.
 */
function hasName(user) {
  const name = String(user.name || '').trim();
  return Boolean(name) && name.toLowerCase() !== String(user.email || '').trim().toLowerCase();
}

/**
 * Where this person is in getting to work, in one word.
 *
 *   identity            — has not confirmed who they are yet
 *   candidate           — uses the public portal, no staff workspace needed
 *   workspace           — signed in, but no organization is active
 *   membership-lost     — the session names a workspace they are no longer in
 *   role-pending        — in the workspace, holding a role Slate does not act on
 *   assignment-pending  — in the workspace, with no search assigned to them
 *   ready               — has somewhere to work
 *
 * Only `ready` opens the workspace. Each of the others is a different screen
 * with a different next step, which is the point of naming them separately:
 * "no access" covers four situations that need four different answers.
 */
function stageOf(store, access, assigned) {
  // New provider accounts have an explicit incomplete setup record, even when
  // the provider supplied a name. Preserve named legacy accounts without one.
  if (!hasName(access.user) || (access.user.onboarding && !access.user.onboarding.completedAt)) return 'identity';
  if (access.user.onboarding?.requestedRole === 'candidate' && !access.orgId) return 'candidate';
  if (access.membershipLost) return 'membership-lost';
  if (!access.orgId) return 'workspace';
  if (!access.role) return 'role-pending';
  if (!access.capabilities.staff && !assigned) return 'assignment-pending';
  return 'ready';
}

function status(store, access) {
  const user = access.user;
  const orgId = access.orgId;
  const assigned = orgId
    ? store.db.searches.filter(s => s.organizationId === orgId && store.memberOf(s, user.id)).length
    : 0;
  const stage = stageOf(store, access, assigned);
  const heldPlaces = orgId
    ? organizations.pendingForEmail(store.db, user.email).filter(p => p.orgId === orgId).length
    : 0;

  return {
    stage,
    // The account-setup form still has to be filled in. Kept under the old
    // name because the client has always gated the form on it.
    required: stage === 'identity',
    // True whenever the workspace itself is not open yet, whatever the reason.
    blocked: stage !== 'ready',
    requestedRole: user.onboarding?.requestedRole || null,
    completedAt: user.onboarding?.completedAt || null,
    organization: access.organization ? { id: access.organization.id, name: access.organization.name } : null,
    role: access.role,
    roleLabel: access.role ? organizations.ROLE_LABEL[access.role] : null,
    roleSummary: access.role ? organizations.ROLE_SUMMARY[access.role] : null,
    // What the provider actually reports, shown only so an administrator can
    // see why an unmapped role is not opening anything.
    providerRole: access.providerRole || null,
    capabilities: access.capabilities,
    // 'staff' and 'committee' describe what this person does in the active
    // workspace; 'pending' means they are not working anywhere yet.
    access: access.role ? (access.capabilities.staff ? 'staff' : 'committee') : 'pending',
    assignments: assigned,
    heldPlaces,
    membershipLost: Boolean(access.membershipLost)
  };
}

module.exports = { ROLES, hasName, stageOf, status };
