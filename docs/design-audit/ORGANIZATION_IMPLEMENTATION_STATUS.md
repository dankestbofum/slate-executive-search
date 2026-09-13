# Organization workspaces: what was built

Status as of September 13, 2026. The companion to
[ORGANIZATION_IMPLEMENTATION_PLAN.md](ORGANIZATION_IMPLEMENTATION_PLAN.md): what
that plan asked for, what is now in the code, and what it still cannot claim.

**No production migration, deployment, or invitation to a real address is part
of this work.** Everything below was built and verified locally against the
offline identity fixture.

## The shape of it

One Clerk organization is one firm. Two questions decide what somebody can do,
and they are deliberately answered by two different systems:

| Question | Authority | Where it lives |
|---|---|---|
| Which firm am I in, and what may I do across it? | Clerk | organization membership and role |
| Which searches do I work on? | Slate | the `members` roster on each search |

A search records its `organizationId` when it is opened, from the verified
session and never from a submitted field, and never moves. A search with no
owner is readable by nobody — which is the state every pre-existing search comes
out of the migration in, on purpose.

## Files

| File | What it does now |
|---|---|
| `server/organizations.js` | New. Roles, capabilities, the local organization/membership/held-seat tables, and the directory: one place that talks to Clerk's Backend API, and the one place the offline suite substitutes. |
| `server/auth.js` | Builds `req.access` — identity, active organization, the role re-read from the directory, and the capabilities that follow. Handles a session Clerk is holding on an unanswered task, and turns held seats into real ones when the person joins. |
| `server/onboarding.js` | Names the five states somebody can be in before the workspace opens, so each gets its own screen instead of one "no access". |
| `server/db.js` | Schema 4. `canView`/`canEdit`/`canManage` take the access context instead of a user; `isConsultant` is gone. |
| `server/index.js` | Every search, archive, export and media route runs behind `requireWorkspace`. New organization and administration routes. Held seats on every search read. |
| `server/http.js` | A provider outage is a 503 the client can retry, and a provider refusal keeps its own message. |
| `public/auth.js` | Active organization, switching, invitations, and the pending-task state. |
| `public/app.js` | Workspace identity and switcher, `#/o/{orgId}/…` addresses, the five onboarding screens, My access, Team & access, held seats on the roster, and authenticated photo fetches. |
| `scripts/organizations.js` | New. `plan`, `adopt`, `link` — a dry run until `--apply`. |
| `scripts/accounts.js` | Keeps only the deployment-level authority. No command grants access any more. |

## What the plan asked for, and where it is

- **Roles.** `org:admin`, `org:consultant`, `org:committee`. Anything else,
  including Clerk's own `org:member`, resolves to no access rather than to a
  guess — `capabilitiesFor` in `server/organizations.js`.
- **Authority from membership only.** The consultant-email allowlist
  (`SLATE_CLERK_ADMIN_EMAILS`) and the `approve` command are gone, and
  `user.role` no longer decides anything.
- **Revocation.** Every protected request re-reads the membership from the
  Backend API and fails closed on an outage. No cache, deliberately: the plan
  asked for a tested revocation guarantee before one is introduced.
- **Ownership.** Set at creation from the session. Unknown ownership denies.
- **Scoping.** Searches, the directory, portfolio counts, archives, restore,
  bulk archive, Start fresh, exports, history, and media are all scoped. The
  boundary is proved end to end in `tests/organizations.js`.
- **Two authorities, kept apart.** A search manager rosters a committee; an
  administrator invites people to the firm. A manager who is not an
  administrator gets a held seat marked **Invitation needed**, and Slate never
  implies an email went out when it did not.
- **The multi-tab hazard.** Brochure photos are fetched with the page's own
  bearer token; the server refuses an image request without one, because Clerk's
  cookie carries whichever workspace was selected most recently in any tab.
- **Late writes.** Navigations are ordered by when they were asked for, and an
  AI job re-checks that it still has authority over the search it started on
  before it commits.

## What it found on the way

Three defects the work surfaced, all now fixed:

- A navigation that waited on a fetch could paint over a later one that had
  already finished. Ordering is now by request time, not by which finished
  first.
- An address changed in place — pasted into the bar of an open tab — did
  nothing, because only history navigation was listened for.
- The count on a hovered rail row sat at 4.19:1 against its hover background,
  under the AA threshold.

## Verification

- `npm run check` — 64 files parsed, 0 failed.
- `npm test` — 508 checks, exit 0. Includes `tests/organizations.js`: 19 checks
  covering reads, writes, listings, counts, directories, archives, exports,
  media, administration, held seats, removal, and forged organization claims.
- `npm run test:browser` — 178 checks across Chromium, WebKit and a phone
  viewport, 0 failed. The runner exits normally and leaves no listener behind;
  the teardown problem noted in the plan is resolved (`SLATE_EXIT_WITH_PARENT`
  plus closing idle connections on shutdown).
- Accessibility scans pass in both themes on every new screen, and the workspace
  name stays readable at 320px.

## What this does not prove

The offline fixture stands in for Clerk's directory the same way `fixtureProfile`
already stood in for its user lookup, and it accepts an invitation on sight
because there is no Clerk UI here to accept it in. So none of the following is
evidence yet, and all of it needs a hosted instance:

- Invitation email delivery, and a person accepting one.
- The organization-selection session task as Clerk actually presents it.
- Clerk's own components, which remain outside the accessibility scan.
- The latency of one Backend API call per protected request, which is the cost
  this release pays for immediate revocation. Measure it before considering a
  cache.
- That the deployed environment points at an instance with Organizations enabled
  and the two custom roles registered. The development instance having them is
  not evidence about a hosted one.

## One thing to decide, not a defect

`/api/ready` is unauthenticated, because a platform health check cannot carry a
session, and it reports a store-wide record count. That count was always
store-wide; what multi-tenancy changes is its meaning — it is now the number of
searches across every firm on the deployment, readable by anyone who can reach
the URL. Nothing identifying is in it, and it is not reachable through an
organization member's session, so it is outside what the plan asked for and was
left as it is. If several firms are on one deployment and that aggregate is
considered commercially sensitive, the answer is to put the metrics block behind
an operator credential — a configuration decision, not a code fix to make
quietly.

## Still a person's decision

The destination workspace for the existing searches, and who its first
administrator is, are decisions for a person: `scripts/organizations.js`
will not invent either, and until it is run those searches are readable by
nobody.
