# Organization workspaces and onboarding implementation plan

Prepared September 13, 2026. Status: **carried out locally**; see
[ORGANIZATION_IMPLEMENTATION_STATUS.md](ORGANIZATION_IMPLEMENTATION_STATUS.md)
for what was built, what it was verified against, and what it still cannot
claim. No production migration, deployment, or invitation to a real address is
part of that work. The plan below is kept as written, as the record of what was
asked for.

## Outcome

Give each firm a shared Slate workspace. Each person signs in with their own account, joins the appropriate organization, and sees searches and actions permitted by their membership and search assignment. An administrator can invite colleagues without sharing a login or using a server command for routine access management.

Keep the current recruiting interface, vanilla JavaScript, Express, and existing search workflow. Extend the recent local onboarding work instead of repeating the visual redesign. There is **no candidate account option** in this plan; public questionnaire links remain separate.

Example acceptance journey: an administrator creates a firm workspace and a search, invites Mike as a consultant, and Mike opens the same search with his own login. A committee member invited to that search sees their assignments and scoring tasks, while another firm's members cannot discover the search.

## Verified starting point

| Area | Current evidence | Required change |
|---|---|---|
| Clerk configuration | Earlier read-only inspection in this session confirmed Organizations enabled, organization selection required, and creator role `org:admin` in the linked development instance. Production settings were not verified. | Use the existing enabled development configuration; verify the target instance again before implementation and release. |
| Sign-in | `public/auth.js` mounts Clerk account controls and listens for session ID changes only. | Handle pending session tasks, active organization changes, and membership changes without requiring a new login. |
| Account setup | Local changes add Consultant/Committee choices and a pending-access page. A chosen role is only a preference. | Replace the generic wait with organization/invitation state and authoritative membership roles. |
| Permissions | `server/auth.js` resolves a global Slate user; `server/db.js` grants consultants access to every search. | Derive effective permissions within the active organization on every request. |
| Search ownership | Search records have a creator and roster, but no organization ID. | Add immutable organization ownership to active and archived searches. |
| Directory and archives | `visibleUsers()` returns all users to consultants; archive routes check a global consultant role. | Restrict directories, archive listing/restoration, and related operations to the active organization. |
| Search assignment | Search roster already distinguishes manager, consultant, and committee seats. | Retain these seats inside the owning organization; do not confuse organization membership with a search assignment. |
| API tokens | The central `api()` helper already obtains a Clerk token and sends an Authorization header. | Preserve this and audit downloads, media, and other requests that bypass the helper. |
| Baseline validation | Earlier local work passed the server suite and 27 browser scenarios; three browser checks were skipped. Browser teardown timed out. | Retain that evidence as a baseline, resolve the runner teardown issue, and add organization-specific tests. These earlier results do not verify organization isolation. |

The working tree contains uncommitted onboarding changes in application, server, account CLI, and test files. Preserve them. The older [UI implementation plan](IMPLEMENTATION_PLAN.md) and [recruiting redesign plan](RECRUITING_REDESIGN_PLAN.md) remain historical workstreams; this plan governs the organization integration.

## Proposed access model

One Clerk organization represents a firm; each firm can own many searches. Organization membership establishes access to the firm, and Slate's roster establishes a person's responsibilities on a search. Clerk supplies organization context and supports default and custom roles; the following application mapping is a proposed Slate policy. [Clerk Organizations](https://clerk.com/docs/guides/organizations/overview), [roles and permissions](https://clerk.com/docs/guides/organizations/control-access/roles-and-permissions)

| UI label | Proposed Clerk role | Workspace actions | Search access |
|---|---|---|---|
| Organization administrator | `org:admin` | Invite members, manage roles and organization details | Consultant capabilities within this organization; can take over a search through the existing explicit manager-reassignment action |
| Search consultant | Custom `org:consultant` | View the firm's search portfolio and create searches | Read and edit this organization's searches; manager-only actions still require the manager seat |
| Committee member | Custom `org:committee` | View their own access and assignments | Read permitted material and submit intake/scores only on assigned searches |
| Awaiting access | No accepted membership, or an unsupported role | Complete sign-in, select a workspace, or resolve an invitation | No search data or staff directory |

Register the proposed custom roles before assigning them. Make committee membership the least-privileged invitation default, with no organization directory or billing permissions. Clerk's built-in `org:member` includes some directory/billing permissions by default; do not automatically interpret it as consultant access. Explicitly map or migrate existing member roles before launch. [Clerk default roles](https://clerk.com/docs/guides/organizations/control-access/roles-and-permissions)

Keep these boundaries explicit:

- Organization administrators manage organization invitations and membership. Search managers assign accepted members to searches. A search manager preparing an external committee assignment sees **Invitation needed** until an administrator sends the organization invitation.
- Self-selected onboarding preferences never change a membership role. An administrator assigns roles; accepting an invitation adopts its assigned role.
- Users may have different roles in different organizations. A global `user.role`, the legacy shared account, and the consultant-email allowlist must not bypass organization checks.
- Creating a new organization grants authority only over that new workspace. It never claims existing searches or imports another firm's records.
- Removing a search seat ends committee access to that search. Removing organization membership ends access to all searches in that organization. Preserve historical attribution in both cases.
- Avoid placing the full organization directory in committee-facing Clerk components. Verify the configured role's actual permissions, including direct Clerk API access, instead of relying on hidden UI.

## UI changes

### 1. Entry and guided setup

Use a short sequence: **Sign in → Choose workspace → Confirm access → Start work**. Resolve Clerk's required organization-selection task before calling APIs that require a complete authenticated session. Clerk provides session-task support; validate the exact mount/unmount APIs against the installed JavaScript SDK during implementation. [Clerk session tasks](https://clerk.com/docs/guides/development/custom-flows/authentication/session-tasks)

| Entry condition | UI and next action |
|---|---|
| Person follows a valid invitation | Show the organization and assigned role, accept the invitation, then continue into that workspace. Skip the generic role-choice form. |
| Person already belongs to one organization | Restore its context when valid; show a brief first-use introduction and the appropriate Home. |
| Person belongs to several organizations | Show a workspace chooser with organization names and the person's role in each. |
| Firm owner has no organization | Offer **Create a workspace**. Collect organization name and explain that this creates a separate firm workspace. On completion, offer **Create your first search** and **Invite staff**. |
| Staff or committee member has no invitation | Offer **Join an existing workspace**, explain that an administrator must invite their verified email, and provide Check invitations and Switch account. Do not require them to create an unrelated organization. |
| Committee member has membership but no assigned searches | Show **You're part of [organization]. Your search assignment is pending.** Provide refresh and contact guidance. |
| Invitation expired, revoked, or for another email | Explain the specific recoverable state without exposing private search details. Offer Sign in with another account or guidance to request a new invitation. |
| Clerk cannot load or verify membership | Show retry and sign-out controls; do not show previously loaded search data. |

Retain name confirmation and the two staff-role descriptions where useful for an uninvited person. Replace **Change my role** with **My access** for members: show the assigned organization role and search responsibilities, plus guidance for requesting a change. Do not show a successful role-change message when only a preference was saved.

### 2. Workspace identity and switching

- Put the active organization name and a labeled **Switch workspace** control above the rail's workspace links. On mobile, keep the name visible in the app bar and put the chooser in the drawer.
- Keep the user's personal profile/sign-out menu separate from organization controls. Display the person's effective organization role in My access.
- Use a Slate-controlled chooser that checks for unsaved edits before invoking Clerk's organization switch. Reuse supported Clerk components for creation and invitation acceptance where they fit; do not assume a prebuilt switcher can be cancelled after its selection event.
- On a successful switch, clear the previous organization's search, directory, candidate selection, filters, drafts, archive data, and pending UI responses, then load the new workspace. Cancel switching without changing the current screen or draft when the user chooses to stay.
- Include organization ID in route context, for example `#/o/{orgId}/home` and `#/o/{orgId}/s/{searchId}/screen`. Slugs are currently disabled, so do not depend on them. Migrate old hashes through an authorized lookup; a deep link must never silently open a search under the wrong workspace.
- Preserve Back/Forward behavior within the correct context. When a link belongs to another organization the user can access, offer an explicit switch; otherwise show a generic unavailable page.

### 3. Home and New search

| Viewer | Home title and primary actions |
|---|---|
| Administrator | **[Organization] searches**; New search; secondary Team & access entry and pending invitations summary |
| Consultant | **[Organization] searches**; New search; existing attention list and portfolio |
| Committee member | **Your assignments** within the named organization; outstanding intake and scoring tasks |

Show the active organization's name as a read-only owner on New search. Explain that consultants in this organization can collaborate on the search. The server assigns ownership from verified session context; never accept ownership or a privileged role from a submitted form.

Keep existing overview, candidate review, interview, document, and activity layouts. Update context labels and permission-driven actions rather than redesigning those screens again.

### 4. Team & access

Add an administrator-only destination with **Members** and **Invitations** views. Members show name, email, assigned role, and permitted actions. Invitations show email, intended role, status, and created/expiry information when supplied by Clerk.

The invite form requires an email and an explicit role. Show the concrete effect before submission: **Send invitation** sends an email through Clerk. Report pending invitation separately from accepted membership; handle duplicates, expiry, resend, revocation, and provider failures. Clerk's invitation flow sends email and supports invitation acceptance for new or existing accounts. [Clerk organization invitations](https://clerk.com/docs/guides/organizations/add-members/invitations)

Protect the last administrator from removal or demotion. Explain the consequences of role changes and removal, retain the person's recorded work, and show clear errors for actions that failed. Do not include organization deletion, billing, verified-domain enrollment, or SSO management in this first delivery.

### 5. Search team and committee

Keep the existing Committee destination, with clearly labeled **Search staff** and **Committee members** sections.

- The manager picker lists eligible consultants and administrators from the owning organization only.
- Add existing committee members by organization membership; allow administrators to prepare an invitation and a pending assignment together for a new email.
- If a manager lacks organization-invitation authority, preserve the proposed assignment with **Invitation needed** and make it visible for an administrator to complete. Do not imply that an email was sent.
- Display invitation pending, assignment pending, and active assignment as distinct states. Only accepted and verified membership plus a valid seat gives committee access.
- Explain that staff can collaborate across the firm's searches, while a committee member is assigned individually. Organization membership alone does not add a committee seat.
- Retain explicit manager handover, roster confirmation, intake controls, and score-release rules.

## Backend and state contract required by the UI

Create a request-scoped access context containing the local identity, Clerk user ID, active organization ID, verified membership role, and effective capabilities. Keep the original identity stable for audit history. Return organization context, capabilities, and onboarding state from `/api/me`; render controls from those capabilities instead of treating every non-committee account as a consultant.

Persist `organizationId` on active and archived searches. Keep pending search assignments scoped to both organization and search, tied to an invitation and verified recipient. Clerk is authoritative for organization membership and roles; Slate is authoritative for search seats. Local membership data is a cache or migration mapping, never an independent source of grants.

Scope every search lookup and mutation, directory response, portfolio count, archive/restore, bulk archive, Start fresh action, export, history entry, media request, and organization-visible usage summary. Audit routes that bypass `requireSearch` and helpers such as `canManage` that currently assume earlier authorization. Unknown or missing organization ownership must deny access. Operational backups remain deployment-admin resources and never become downloadable through an organization-admin session.

For membership removal and role changes, verify current membership through the Backend API for protected requests in the initial release; fail closed on failed verification. This favors correctness over caching for the pilot. Measure latency and provider limits. Introduce a bounded cache or webhook invalidation only with an explicit, tested revocation guarantee; do not claim immediate revocation from an unrefreshed session token alone.

Keep using a fresh session token in Authorization headers. Clerk documents that cookie state can reflect another tab's active organization; this matters for background requests. Audit direct media URLs and downloads and use authenticated fetches or an equally explicit authorized design. [Clerk multi-tab organization behavior](https://clerk.com/docs/guides/organizations/overview)

Associate each request with its starting organization and a client context version. Abort obsolete fetches where possible and discard late results after switches, including metadata/revision updates. An AI job must retain the organization and search it started with, recheck authority before committing, and never write its response into a newly selected workspace. Preserve existing stale-write and unsaved-edit protection.

Invitation acceptance must reconcile the verified identity, organization membership, and pending search assignment idempotently. Email/name matching alone cannot grant membership. Handle provider success followed by local persistence failure through reconciliation, so retrying does not duplicate invitations or leave active access in an ambiguous state. No outbound invitation messages are authorized by this planning task; implementation tests use fixtures and synthetic staging recipients.

## Delivery sequence

Each phase ends with a reviewable local result. The organization UI and server authorization ship together; no intermediate production release exposes a switcher over global search permissions.

| Phase | Work and primary files | Acceptance gate |
|---|---|---|
| 1. Define roles and rehearse migration | Confirm role mappings and supported SDK APIs. Design `server/organizations.js`, a schema upgrade, and a dry-run migration command. Inspect all authorization call sites in `server/auth.js`, `server/db.js`, `server/index.js`, `server/export.js`, and `scripts/accounts.js`. | Produce an explicit mapping of legacy records/accounts to the intended organization. Missing mappings fail safely; no automatic claim by the first signed-in user. |
| 2. Enforce organization ownership | Add request access context, membership validation, organization-aware permission helpers, scoped directories/archives/exports/media, pending assignment storage, and migration support. Update direct global-role checks and remove global consultant bypasses. | Signed fixtures for organizations A and B prove isolation across all read/write paths, including active and archived searches. Role selection cannot escalate access. |
| 3. Connect sign-in and the shell | Update `public/auth.js`, `public/app.js`, `public/app.css`, `server/onboarding.js`, and `/api/me`. Implement pending-task handling, organization-aware onboarding, guarded switching, route context, and role-specific Home. | Fresh signup, invitation acceptance, returning membership, multiple workspaces, and no-access states all reach a useful screen. Switching/Back/refresh cannot mix data or discard drafts without a decision. |
| 4. Add administration and search-team flows | Build Team & access and protected membership/invitation endpoints; update roster and manager assignment interfaces. Reconcile invitation acceptance and pending assignments. | An admin invites a consultant who can open the same search. An invited committee member sees only assigned searches. Unauthorized users cannot call administration endpoints or grant stronger roles through Clerk permissions. |
| 5. Verify and prepare release | Extend `tests/identity.js`, `tests/clerk-auth.js`, `tests/roles.js`, `tests/auth.js`, `tests/browser/clerk.js`, `tests/browser/onboarding.spec.js`, and relevant recovery/export/browser coverage. Update README, operations, and release checklist. | Security, workflow, accessibility, migration/restore, and real Clerk staging checks pass; browser runner exits normally. Document remaining human checks and environment configuration. |

Planning estimate: approximately **10–16 engineering days** for one engineer familiar with this repository, including migration rehearsal and verification. This is an estimate, not a delivery commitment; existing data ambiguity and provider integration may change it.

## Migration and rollout

1. Inventory the existing active/archived searches, shared/named accounts, committee seats, and Clerk memberships using a dry run. Identify the actual destination organization and administrator; this plan does not invent either.
2. Back up and verify the store. Rehearse against a synthetic copy with at least two organizations. Version the schema and make migration idempotent, with a report of mapped and unresolved records.
3. Map the existing firm's searches explicitly to its organization, including archives. Preserve user IDs, creators, activity, scores, media associations, and pending onboarding information. Do not create organization authority from the old global role or an arbitrary email address.
4. Validate imported memberships and seats. Unmatched identities stay unavailable until resolved. Preserve the legacy shared account for historical attribution; any continued interactive use requires an explicit membership and cannot be a cross-organization master account. Routine work uses named users.
5. Prepare the Clerk role set, invitation redirects, pending-session-task handling, and instance variables for the intended deployment. The previously inspected development settings are not proof that a hosted environment points to the same Clerk instance.
6. Deploy application and authorization changes as one release during a controlled migration window. Smoke-test staff collaboration, committee restriction, cross-organization denial, and public questionnaire behavior.
7. Document rollback before cutover. Rolling back to the old globally scoped application after onboarding multiple firms would remove isolation. Use maintenance mode and an authorized restore procedure; do not silently serve multiple organizations from the old permission model. Account for Clerk-side memberships/invitations separately from a local database backup.

Existing candidate links remain governed by their current token, expiry, correction, and revocation rules. Organization migration alone does not create candidate accounts or broaden questionnaire responses. Existing archive restoration behavior, including replacement of invitation links, stays intact.

## Verification checklist

- Organization A administrator/consultant cannot list, read, modify, archive, restore, export, or fetch media from B, even with a valid B search ID or forged request body. Directory and summary responses do not leak B's identities or counts.
- A user who is a consultant in A and committee member in B receives the correct capabilities in each. The default/unknown role and a missing organization fail closed.
- Two consultants in one organization edit the same search with the existing revision-conflict handling. Only the assigned manager performs manager actions until an explicit handover.
- Committee members need both active membership and an assignment. Revoking either ends the relevant access. Removing membership does not erase historical scores or authorship; restore does not revive revoked access.
- Duplicate/expired/revoked invitations, wrong-account acceptance, provider errors, and repeated reconciliation have clear UI states and no duplicate seats. A non-admin cannot invite a consultant or promote themselves.
- A pending organization-selection task is handled before the workspace API is called. Refresh, sign-out, browser Back, multiple tabs, a slow response, and a mid-save organization switch never display another organization's data.
- Direct exports, images, document previews, AI completion, and downloads respect the initiating organization and current permissions. Public `/apply` pages continue to work without organization membership.
- At 320px, phone, tablet, and desktop widths, organization names, chooser, role descriptions, invitations, and roster controls remain readable in light/dark themes. Verify keyboard focus, screen-reader labels, visible status feedback, and unsaved-edit cancellation.
- Run syntax checks, the full isolated server suite, and relevant Chromium/WebKit browser journeys. Resolve the known browser teardown timeout before treating the runner as a passing release gate. Rehearse real Clerk invitation/task behavior in development with approved synthetic recipients; offline fixtures alone do not verify hosted Clerk components or email delivery.

## Decisions to confirm during implementation

The recommended defaults are one organization per firm, organization-wide collaboration for consultants, search-specific committee access, and organization-admin control of membership invitations. Use these defaults to build the local implementation and identify any needed deviation early.

The actual legacy-data destination organization and authorized first administrator must be supplied or verified before migration. Public self-service creation of additional firms is a separate rollout decision; local development can exercise it with empty synthetic workspaces. No production migration, deployment, organization deletion, or invitation sending is part of creating this plan.
