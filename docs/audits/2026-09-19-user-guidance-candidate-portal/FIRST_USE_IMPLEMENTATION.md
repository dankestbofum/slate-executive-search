# First visit, account setup, and subscription discovery

September 19, 2026. Implemented locally; not deployed.

A newly created Clerk profile could bypass Slate setup if it already had a
name. The public home offered little orientation, the setup choices excluded
candidates and hiring organizations, and the existing careers portal was not
discoverable there.

## Delivered

- Public home with a product explanation, separate hiring-team and candidate
  entry points, and three getting-started steps.
- Dedicated `/sign-up` and `/sign-in` pages using Clerk's existing components.
  Verification subpaths are served by Express and bypass the service worker.
- Organization, candidate, consultant, and committee setup choices. Explicitly
  incomplete new-account setup is required even when Clerk provided a name.
  Named legacy accounts without a setup record retain access.
- Candidate setup leads to `/careers` without requesting a staff workspace.
  The preference persists server-side, can be changed, and grants no staff
  authority. Existing assigned workspace roles remain authoritative.
- A visible first-search checklist on empty workspace homes, links to the
  existing guide, and the actual workspace role in the account footer.
- Preservation of an assigned search link when a new member confirms their
  name. Workspace setup copy now addresses organizations as well as firms.
- `/subscriptions`, linked from public navigation, workspace navigation, and
  setup. It clearly states that prices and online billing are not available;
  creating an account is not a subscription purchase. No payment provider,
  plan prices, entitlements, or charges were added.
- Updated first-sign-in help to match the implemented signup and setup flow.

## Verification

Validation uses Node 24.19.0 and isolated test records. The server suite covers
setup persistence and refusal of staff access for both candidate and
organization preferences. Browser coverage includes Chrome, desktop WebKit,
and Pixel 7 emulation: public navigation, signup through workspace creation,
candidate setup and correction, reload, invitations, keyboard access,
accessibility scans, and responsive layout. Screenshots were inspected for
the home, real signup form, first workspace, and candidate entry screens.

- `npm run check`: 98 JavaScript files parsed; packaging check passed.
- `npm test`: complete server suite passed, exit 0.
- Browser selection: `welcome`, `onboarding`, `journeys`, `accessibility`, and
  `reflow` across all three configured projects. Of 99 selected cases, 93 were
  exercised and six were intentionally skipped by project. Initial failures
  were corrected and rerun; all exercised cases ultimately passed. The last
  correction made the mobile committee test wait for the actual search page
  before opening its navigation drawer.
- `tests/clerk-browser.js`: real Clerk form rendering and CSP smoke passed.
- `git diff --check`: passed.

The live Clerk rendering smoke check passed against an isolated local server
using the configured development instance. It opened forms without creating
accounts or sending email. Full hosted signup completion and deployment are
not claimed by that check. The browser journey suite substitutes Clerk's
provider interaction and exercises the actual application server afterward.

The initial regression checks needed updates for the new headline, additional
keyboard navigation stops, and the requirement that invited new accounts
complete setup. Those changes preserve the checks for access and usability.

## Remaining product dependencies

The subsequent [Clerk Billing implementation](BILLING_IMPLEMENTATION.md) adds
organization checkout and management. Provider activation, approved commercial
plans and a hosted test checkout are still needed before paid launch. Candidate
applications retain the portal's existing email, upload, and scanning
configuration requirements; this change does not activate those services or
introduce a reusable candidate profile across postings. Production workspace
creation continues to honor the existing founder allowlist.
