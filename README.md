# Slate

Guided executive-search workspace. Node 24 LTS, Express, JSON file store.

## First visit and account setup

The public home explains Slate and separates hiring teams from candidates.
`/sign-up` and `/sign-in` render Clerk's account forms. New accounts confirm
their name and choose organization, candidate, consultant, or committee use,
including accounts whose name was supplied by Clerk. This preference never
grants workspace permissions. Existing named accounts without a setup record
retain their existing access.

Organizations create a workspace when permitted or join by invitation. An
empty workspace shows the first-search instructions and links to the guide.
Candidates continue to `/careers`; applications still require their existing
posting-specific email verification and are not automatically linked to the
staff account. `/subscriptions` reads published organization plans from Clerk
Billing and offers checkout and subscription management to verified workspace
administrators. Candidates remain free; search packages are separate.

Billing defaults to `SLATE_BILLING_MODE=off`. Use `test` with development Clerk
keys after enabling organization Billing in Clerk; `live` requires matching
production keys and a configured Stripe connection. No prices or paid-feature
restrictions are supplied by this change. Follow the
[billing activation and validation record](docs/audits/2026-09-19-user-guidance-candidate-portal/BILLING_IMPLEMENTATION.md)
before launching paid plans.

See the [first-use implementation record](docs/audits/2026-09-19-user-guidance-candidate-portal/FIRST_USE_IMPLEMENTATION.md).

## How a search runs

Nineteen steps in three phases. The catalog lives in `server/steps.js`; both the
store and the Claude prompts read step numbers from there, so renumbering the
process is a one-file change.

**Phase 0 — assemble the committee and hear them.**

1. **Search committee.** Everyone who gets a say, plus one account manager.
   Adding someone without an account creates one. They sign in with their email.
2. **Committee input.** The manager opens a window; each committee member answers
   privately what they are looking for. Answers fold into one ranked read of the
   room, and the manager closes the window to publish it.

**Phase 1 — prepare and post.** Profile (built from the committee's answers),
community research, surveys, interview guide, ad plan, brochure, ads, sourcing.

**Phase 2 — once there are candidates.** Screening, semifinalist survey, video
interviews, finalists, finalist week, reference checks, contract, evaluation.

### Staff steps

Slate is the record, not the worker. Three steps are work the firm does by hand
and writes down here: **sourcing** (active and passive outreach, Enhanced+),
**video interviews** (semifinalists, Enhanced+), and **reference checks**
(finalists, Executive). They are marked `kind:'staff'` in the catalog. Nothing is
drafted for them; each has a log of entries (who, when, what, and for video and
references, which candidate), running notes, and a completion a consultant
signs. Logging new work on a completed step reopens it, and an empty record
cannot be marked complete.

Reference contact waits on consent. A finalist's consent is recorded on the
candidate (`POST /api/searches/:id/candidates/:cid/consent`), and the reference
log refuses an entry for anyone without it. Staff logs are stripped from the
file a committee member reads: sitting managers who have not told their own
council they are looking should not be named to the room.

Routes: `POST /staff/:key/log`, `DELETE /staff/:key/log/:lid`,
`PUT /staff/:key` (notes), `POST /staff/:key/complete` (`{ done }`).

## Search workflows and Clerk plans

The original commercial plans were **Basic**, **Enhanced**, and **Executive**.
Their descriptions, original price ranges, included services and workflow mappings
are preserved in [CLERK_PLAN_MIGRATION.json](docs/audits/2026-09-19-user-guidance-candidate-portal/CLERK_PLAN_MIGRATION.json).
The price ranges do not specify an exact checkout amount or billing interval; those
must be decided before publishing paid plans in Clerk.

The hardcoded pricing cards, comparison matrix and package-sales samples have
been removed. Subscriptions reads published organization plans from Clerk.
No commercial plan names or prices are supplied by the search workflow catalog.

Existing searches keep their saved internal package keys and step boundaries:

| Stored key | Workflow shown in the app | Scope |
|---|---|---|
| basic | Posting and screening | Committee, profile, announcements, screening and recommendations |
| enhanced | Recruited search | Adds community research, sourcing, assessments and interviews |
| executive | Full search | Adds references, contract and annual evaluation |

New searches still default to the full workflow. Search facts allows an authorized
search editor to choose its workflow. This is not a billing entitlement: checkout
and plan-based feature enforcement must be connected deliberately before paid launch.
No existing search records, work, permissions or audit history are deleted.

## Workspaces and roles

One firm is one workspace, and a workspace is one Clerk organization. Searches,
staff, committees, archives and directories never cross between them: a search
belongs to the workspace it was opened in, permanently, and a search whose
workspace is unknown is readable by nobody.

Two different questions decide what somebody can do, and keeping them apart is
the point of the design:

- **Membership** is Clerk's answer, and it decides which firm you are in and
  what you may do across it.
- **A place on a search** is Slate's answer, and it decides which searches
  you work on. In the store it is the member's `searchRole`.

Being in a firm's workspace does not put you on any of its searches; being on a
search does not survive losing the membership.

| Workspace role | Clerk role | In the workspace | On a search |
|---|---|---|---|
| Organization administrator | `org:admin` | Invites members, sets their roles, sees the whole book | Consultant powers; may take over a search by the ordinary handover |
| Search consultant | `org:consultant` | Opens searches, sees the whole book | Reads and edits every search here; manager actions still need the manager role |
| Committee member | `org:committee` | Sees only their own assignments | Reads and scores the searches they are on |
| Awaiting access | anything else | Nothing | Nothing |

Register `org:consultant` and `org:committee` on the Clerk instance before
anybody signs in. Slate acts on exactly those two and on `org:admin`; any
other role, **including Clerk's own `org:member`**, resolves to no access at
all rather than to a guess, because `org:member` carries directory and billing
permissions that a committee member should not hold.

Within one workspace the roles on a search are unchanged:

| | Consultant | Account manager | Committee member |
|---|---|---|---|
| See every search in this workspace | yes | yes | only their own |
| Edit the search file | yes | yes | no |
| Answer intake, score candidates | yes | yes | yes |
| Screen candidates, log staff work, export the record | yes | yes | no |
| Add members, run intake, adopt consensus | no | yes | no |
| Advance to finalist, release scores, record outcomes | no | yes | no |
| Certify reference completion | no | yes | no |
| Close, reopen, archive, restore | no | yes | no |
| Hand the account to someone else | no | yes | no |

The account manager is whichever consultant holds that role, one per search.
Consultants do the firm's work on any file; the decisions in the lower half of
that table are the ones a county is later shown a record of, so they stay with
the person accountable for the search. A consultant prepares the recommendation
and asks.

That includes handing the account over. An earlier version let any consultant
take it, so that a search would not be stranded when its manager was
unavailable; the cost was that the split above was advisory, since anyone
refused a decision could take the account and make it anyway. Nobody is
stranded: **a workspace administrator can reassign the account**, and Slate
requires a written reason, which goes on the file.

Every one of these answers comes from one table, `server/authority.js`. The
routes ask it, `/api/searches/:id` returns its answers to the browser as
`you.may`, and the screens draw their controls from those — so a control that
appears is a decision the server will accept, and a decision the server refuses
is one the screen explains rather than offers. The rows are the proposed matrix
in [docs/late-stage-pilot-plan.md](docs/late-stage-pilot-plan.md), which the
search owner has not yet accepted or revised.

The same person can be a consultant in one firm's workspace and a committee
member in another's. The answer always comes from the membership verified for
the request being made, never from anything stored on the account.

### Opening the workspace

Sign in → choose workspace → confirm access → start work.

Select **Sign in** or **Sign up** on the landing page. Clerk verifies identity;
the profile menu manages the account and signs out. On first sign-in a verified
primary email links to the matching Slate account; later requests use its
persisted Clerk user ID. Disabled accounts remain blocked.

Account setup asks for a name, and — only if no workspace has assigned one
already — which of **Search consultant** or **Committee member** describes what
they came to do. That choice guides the wording they see and grants nothing:
somebody arriving on an invitation is told the role it carried instead of being
invited to contradict it.

After that, the workspace step. Each of the ways it can go is its own screen,
because "no access" covers several situations that need different answers:

- **A firm owner with no workspace** is offered **Create a workspace**, if this
  deployment lets them (see below). Creating one makes them its administrator
  and touches nothing else — it never adopts existing searches.
- **Somebody waiting on an invitation** is told an administrator has to invite
  their exact address, with **Check invitations** and a way to sign in as
  somebody else.
- **Somebody in several workspaces** gets a chooser naming each and their role
  in it.
- **A member whose role Slate does not act on** is told which role they hold and
  who can change it.
- **A committee member with no assignment** is told they are part of the firm
  and that a search manager adds people individually.

#### Who may found a workspace

In production, only the verified emails in `SLATE_WORKSPACE_FOUNDERS`. An empty
list means nobody, which is the right default for a URL anyone can reach: Clerk's
sign-up page is public, so without this a stranger could sign up and create a
firm. They would see nothing of yours — a new workspace is empty and grants
authority over nothing that already exists — but it is still an account and a
workspace you did not ask for.

Set it to the first administrator's email to stand a firm up; everybody else
arrives by invitation. Where creation is closed, the workspace step says so and
does not show a form that would be refused after it was filled in. Outside
production it is open, so local development and the test suites need no
configuration.

This is not the operator allowlist the organization model removed. That one gave
somebody consultant access to searches that already existed, sitting above
organization membership and defeating it. This bounds who can bring a new, empty
firm into being, and grants nothing inside any workspace.

**My access** in the rail shows the role the workspace assigned, the searches
they are on, and who to ask for a change. It is not a control that
changes anything: roles are set by an administrator in **Team & access**.

### Team & access

An administrator's screen with two lists, kept separate because they are two
different states. **Members** are in the firm; **Invitations** have been emailed
and are not. Inviting somebody requires an address and an explicit role, and the
form says what pressing the button does before it is pressed. Changing a role
takes effect on that person's next request. Removing somebody ends their access
to every search in the workspace and releases their places, while their scores,
notes and authorship stay on the record under their name; somebody who manages a
search has to hand it over first. The last administrator cannot be removed or
demoted.

A search manager who is not an administrator can still prepare a committee: the
place is held against the address and shown under **Waiting to join** as
**Invitation needed** until an administrator sends the invitation. Slate never
implies an email went out when it did not. A held place becomes a real one when
that person accepts and signs in, and grants nothing before that.

People are added several at a time. The form on the committee step stays
collapsed until asked for, takes as many rows as the manager types, and puts
one request per person to the server, because each address needs its own
membership lookup and may need its own invitation. A row the server refuses
stays on screen with the reason against it while the rest go through, so a
retry cannot add anybody twice.

### Switching workspaces

The active workspace is part of the Clerk session, so every address carries it:
`#/o/{organizationId}/s/{searchId}/screen`. An older address without the
`/o/` segment still resolves — against the workspace you are in, and the search
it names is still looked up through an authorized request, so a link from
another firm comes back not-found rather than opening.

**Switch workspace** sits above the rail's links, apart from the account menu,
and is Slate's own control rather than a prebuilt one: it runs the same
unsaved-edit guard as everything else and can be cancelled, which a prebuilt
switcher's selection event cannot. On a switch the page reloads at the new
workspace's address — the only way to guarantee that no search, candidate,
filter, draft, cached photo or in-flight response from the previous firm
survives into the next one. A link belonging to another workspace you can enter
is offered as a switch rather than followed, and says nothing about what is in
it.

Brochure photos are fetched with the page's own session rather than by the
browser, because Clerk's cookie carries whichever workspace was selected most
recently in **any** tab. The server refuses an image request that arrives
without a bearer token.

### Administration

`node scripts/accounts.js` still lists accounts and disables or restores them
— the deployment-level authority that sits above every workspace. It no longer
grants anything: there is no command that makes somebody a consultant, because
there is no longer a firm-wide consultant. Membership and roles are managed in
Team & access and held at Clerk.

`node scripts/organizations.js` maps an existing store onto workspaces:

```bash
node scripts/organizations.js plan
node scripts/organizations.js adopt --org org_123 --name "Firm" # dry run
node scripts/organizations.js adopt --org org_123 --name "Firm" --apply
```

Run both with the app stopped, against its configured `DATA_DIR`, then restart
it so the single-process store reloads the change.

Clerk is the only way in. Slate issues no credential, keeps no session table
and has no sign-in route of its own; identity is proven on every request and
resolved to the account that holds the roles and assignments. Missing Clerk
configuration blocks workspace access rather than restoring open access.

The regression suite signs its own Clerk sessions with a throwaway key the test
server verifies for real (`tests/identity.js`), so it exercises that same path
offline. `SLATE_CLERK_FIXTURE` reads the account's email from the session
subject in place of a Clerk directory; it is ignored unless `NODE_ENV=test`.

Optional `SLATE_EMAIL_TEAM`, `SLATE_EMAIL_ABE`, and `SLATE_EMAIL_MIKE` variables
customize account emails. No `SLATE_PIN_*` variables are used.

## Consensus

`server/committee.js` folds submissions into one entry per idea. Labels are
normalized for case, punctuation, and filler ("strong financial management
skills" and "Financial management" are one line), then ranked by how many
members named it and how much they said it mattered. An item several people
named but weighted 3 or more apart is flagged **contested** rather than
averaged into the middle. Adoption merges consensus into the profile ahead of
anything written by hand, capped at five per category.

Each member's record holds a **private draft** and their **committed answer**,
and they are not the same thing. Saving a draft changes only the draft; the
answer already in the tally stays there until the member submits again, and
withdrawing is its own action with its own event. A draft goes to its author
and nobody else — not to the search team, not to the rest of the committee when
the window closes, and not into an export. A submitted answer is readable by
workspace staff while they facilitate, and by everyone on the search once the
window closes. That boundary is where publication sits too: adoption, saving
the profile by hand, and drafting it with Claude all wait for the window to
close, so nothing published to the committee can contain input somebody is
still giving.

Adopting records what it was adopting: who did it, when, the fingerprint of the
input, and the counts, ranges and every reason behind each line. The criteria
carry a durable link to that record, so renaming one does not change where it
came from, and support that describes earlier answers is dated as such.
Rebuilding is a preview first — what arrives, what changes, what no longer has
support, and what the five-item cap excludes — and keeping an unsupported line
is an explicit decision with a reason. Contested nominations past the cap go to
a discussion list rather than being forced into a slot.

## Local

Requires **Node 24 LTS** (24.20.0 or newer), matching the container and CI.
Node 20 is end of life and no longer receives security patches.

```bash
cp .env.example .env
# add ANTHROPIC_API_KEY
npm ci        # lockfile install, same as CI and the image
clerk auth login
clerk init --app app_3JCIQzCE9yeVbFBkzQF0qP4LRfS
# Enable Organizations on the Clerk instance and add the custom roles
# org:consultant and org:committee. Then sign in and create your workspace.
npm start
```

`.env` is loaded only outside production. In production the platform's
environment is authoritative, so a file that slipped into an image cannot
quietly replace deployed configuration.

Open http://localhost:4173 and select **Sign up** (or **Sign in**).

Clerk requires `CLERK_PUBLISHABLE_KEY` and `CLERK_SECRET_KEY`; the CLI writes
them to the ignored `.env`. Only the publishable key reaches the browser.
Set `CLERK_AUTHORIZED_PARTIES` to a comma-separated list of trusted app origins
when deploying, and configure production Clerk keys on the hosting platform.
The linked development instance is not a production deployment.

Run `clerk doctor --json` to check the link and keys. With the development app
running, `node tests/clerk-browser.js` checks the real sign-in and sign-up forms
without submitting an account or sending email. Complete first-account signup
manually to verify email delivery and the signed-in profile.

`npm test` starts its own local server and temporary data stores. It never reads
your `.env`, contacts Claude, or changes live searches. Failed checks exit nonzero.
`npm run test:live` explicitly targets an already-running server through
`SLATE_URL` (default `http://127.0.0.1:4173`) and creates test records there.
External website checks are opt-in with `SLATE_NETWORK_TESTS=true`.

## Render

`render.yaml` is a blueprint for the whole service: one Docker web service, one
disk, one instance. Point Render at this repository and it reads that file;
everything below is what the blueprint sets and what it deliberately leaves for
you to supply.

1. **Storage.** The blueprint mounts a disk at `/data` and sets `DATA_DIR` to
   `/data/clean-owner` for the clean owner workspace. Existing records at
   `/data/slate.json` remain available by switching `DATA_DIR` back to `/data`.
   Production refuses to start without configured storage, which stops records
   from being written into the container filesystem and lost on the next
   deploy. A disk needs a paid instance type; a free instance has no
   persistent storage.
2. **One instance.** The store is one JSON file with one writer, so two
   instances would overwrite each other. Render also holds a service with a
   disk to a single instance, and replaces it rather than running old and new
   side by side, which is the behaviour this app needs.
3. **Secrets**, prompted once by Render and never written into the repository:
   - `CLERK_PUBLISHABLE_KEY` and `CLERK_SECRET_KEY`. Without them every
     workspace request answers 503 rather than falling back to open access.
   - `CLERK_AUTHORIZED_PARTIES`, set to the service's own origin once it has
     one.
   - `SLATE_WORKSPACE_FOUNDERS`, the verified email of the first administrator.
     Without it nobody can create a workspace in production, which is the safe
     default for a public URL. It grants nothing inside any workspace; everybody
     else joins by invitation.
   - `ANTHROPIC_API_KEY` for drafts and city research. The app serves without
     it; those two features stop.
   - `SLATE_SUPPORT_EMAIL`, shown to candidates who cannot proceed alone.
4. **Optional:** `CLAUDE_MODEL` / `CLAUDE_MODEL_PREMIUM`, and
   `SLATE_EMAIL_TEAM` / `SLATE_EMAIL_ABE` / `SLATE_EMAIL_MIKE` to change which
   verified emails sign in as the seeded consultant accounts.

The app binds `0.0.0.0` and listens on `PORT` from the platform. Slate sets no
cookie of its own; the session belongs to Clerk. On a deploy it drains in-flight
requests and releases its write lock within ten seconds of SIGTERM, well inside
the platform's termination allowance, so a replacement never finds a lock it has
to treat as stale.

The image is built from `Dockerfile`. There is no second build path: the former
`nixpacks.toml` was removed so the runtime cannot drift between build methods.

### Claude API key on Render

Clerk authenticates users; the Express server checks their search access and
editor permissions before calling Claude with `ANTHROPIC_API_KEY`. Keep that
key in the server environment, separate from the Clerk keys.

In the Render Dashboard, select the Slate web service, open **Environment**,
and add `ANTHROPIC_API_KEY` under **Environment Variables**. Choose **Save and
deploy** to apply it to the existing build. For an initial Blueprint deployment,
Render prompts for the key because `render.yaml` marks it `sync: false`.
Never put the actual key in `render.yaml`, frontend code, or Clerk user metadata.
See [Render environment variables and secrets](https://render.com/docs/configure-environment-variables).

For local development, put a separate development key in the ignored `.env`.
Check that key and the configured models from the project directory with
`node --env-file=.env scripts/preflight.js`; this checks model metadata without
generating content. Production reads Render's environment variables and ignores
the local `.env` file.

### Container volume permissions

The container runs as the unprivileged `node` user (uid 1000), not root. A
mounted volume keeps whatever ownership the platform gives it, so if the volume
is root-owned the app cannot write to it. Slate checks this at startup and exits
with the offending path and uid rather than accepting sign-ins and failing on
the first save:

```
Slate: DATA_DIR is not writable: /data
Slate: running as uid 1000. EACCES: permission denied ...
Slate: grant the runtime user write access to the mounted volume, then restart.
```

If you see this, `chown 1000:1000` the volume (or configure the platform to
mount it for uid 1000) and redeploy.

### Release identity

CI builds with `--build-arg SLATE_RELEASE=$GITHUB_SHA`. The running app reports
it at startup and on `/api/health`:

```json
{ "ok": true, "release": "76598b9…", "node": "24.20.0" }
```

Use it to confirm which commit is actually serving before and after a deploy or
rollback. Building by hand without the build argument reports `dev`.

## Deployment status

**No release gate is reached.** The twelve DEP tickets from
`CLAUDE_DEPLOYMENT_HANDOFF.md` are implemented and tested, but several
acceptance criteria need evidence only real infrastructure or a person can
produce — a built container, a manual restore drill, one authorised AI run,
real-device browser testing, and the county decisions.

- **[docs/handoff.md](docs/handoff.md)** — what was built, what was verified,
  what was not, and why no gate is reached
- **[docs/release-checklist.md](docs/release-checklist.md)** — the gates, box by box
- **[docs/pilot-decisions.md](docs/pilot-decisions.md)** — decisions that cannot be answered in code
- **[docs/operations.md](docs/operations.md)** — recovery, monitoring, incidents
- **[docs/test-evidence.md](docs/test-evidence.md)** — what the suites do and do not prove

Do not enter real candidate information while a P0 control is unverified.

## AI drafting: limits and human review

Drafting and research are **advisory**. A consultant reviews sources, corrects
output, and approves the exact revision; nothing is published because a model
produced it, and no hiring decision is automated.

**Fetched pages are data, not instruction.** Web pages and pasted notes are
wrapped in an `<untrusted>` block, with any delimiter in the source stripped so
a page cannot close the block and have the rest read as prompt. The research
system prompt says to quote from that content and obey nothing in it.

**Spending is bounded before the call, not noticed after it** — per search, per
day, per day in estimated dollars, and concurrently
(`SLATE_AI_MAX_*`). Over a limit the route returns 429 and manual work is
unaffected.

**A failed call may still have been billed.** Usage is recorded on the attempt,
including timeouts and drafts rejected as stale, and failures whose usage the
provider did not report are counted as *unknown* rather than as zero.
`/api/ready` reports spend, limits, and unknown-usage attempts, and labels the
dollar figure an estimate rather than a bill.

**Preflight:** `npm run preflight` checks the key and asks the account whether
the configured models are actually available, via the Models API — metadata
only, no tokens consumed. It deliberately does not generate anything: a real
draft is a billed call and belongs in an authorised staging run.

### Jurisdiction research is one bounded operation

Research is not one call. It is a website crawl, several model rounds (server
tools pause and resume the turn), and then a database write. Each of those used
to carry its own timeout and none of them knew about the others, so a stalled
attempt plus one automatic retry ran for about six minutes and a slow but
succeeding sequence of rounds could have run for eighteen. See
**[docs/design-audit/RESEARCH_RELIABILITY_IMPLEMENTATION_PLAN.md](docs/design-audit/RESEARCH_RELIABILITY_IMPLEMENTATION_PLAN.md)**
for the diagnosis and
**[RESEARCH_RELIABILITY_IMPLEMENTATION_STATUS.md](docs/design-audit/RESEARCH_RELIABILITY_IMPLEMENTATION_STATUS.md)**
for what was built.

- **One deadline for the whole operation**, started before the crawl and shared
  by continuations and the page-only fallback: `SLATE_RESEARCH_TIMEOUT_MS`
  (180 s), `SLATE_RESEARCH_CRAWL_TIMEOUT_MS` (25 s),
  `SLATE_RESEARCH_MAX_ROUNDS` (4). `SLATE_AI_TIMEOUT_MS` keeps its meaning as
  the per-call ceiling and caps one round. Values outside their documented
  ranges are clamped: a limit one typo can remove is not a limit.
- **Automatic provider retries are off for research.** The SDK retries
  connection errors and timeouts, which is what turned one stalled attempt into
  a six-minute failure.
- **Provider calls are streamed**, and the operation timer runs to the last
  event of the stream rather than to the arrival of response headers.
- **Cancellation aborts real work** — DNS waits, sockets, response bodies and
  the provider stream — rather than only stopping us waiting for it. Private
  address checks, DNS pinning and redirect validation are unchanged.
- **Failures are told apart**: `RESEARCH_TIMEOUT` (504),
  `RESEARCH_CONNECTION_ERROR` (502), `AI_AUTH_ERROR` (503), `AI_RATE_LIMIT`
  (429), `RESEARCH_INCOMPLETE` (422), each with an operation reference. The
  provider's request id, SDK error class and underlying network code stay in
  operator logs. Before this, all of them arrived as one generic connection
  error, which is why the hosted failures could not be diagnosed.
- **Research is a job, not a request.** `POST
  /api/searches/:id/research-jobs` answers 202 with a job id; the status
  endpoint reports the real stage and elapsed time; cancel is idempotent.
  Refreshing or double-clicking finds the same operation (idempotency key), and
  a restart marks work that was running `interrupted` rather than replaying a
  request the provider may already have billed. `/api/ready` reports the queue
  and the limits in force.
- **Incomplete findings are reviewed, not discarded or forced.** A jurisdiction
  that publishes no budget can be recorded as unknown; supported findings with
  named gaps are offered for review, fill blanks rather than overwriting what a
  consultant entered, and never silently replace the previous research.

What that does **not** establish: that any particular jurisdiction completes
inside three minutes. These are starting limits to validate against real sites,
and the operation reference in the logs is what a decision to raise them should
be based on.

## Browser and accessibility testing

`npm run test:browser` (Playwright) starts its own server against a throwaway
data directory and runs 234 checks — the same 78 in each of three projects:
desktop Chromium, desktop WebKit, and an emulated Pixel 7. They cover the
critical journeys, WCAG 2.1 AA scanning with axe-core, whether the
Content-Security-Policy is actually enforced by a browser, and the research
screen — which is the only place a request that never answers can be held open
to prove it no longer traps the interface.

WebKit is there because it is the engine behind every browser on iOS, which is
what a committee member or a candidate is likely to be holding. It is a second
engine, not a second user-agent string: Chromium passing says nothing about how
WebKit parses the policy, the date inputs or the layout. Service workers are
blocked in that project, and `playwright.config.js` records why.

That last one matters. The CSP was verified only by asserting on the header
until DEP-12, and a real browser showed it was blocking the application's own
styling. **A header is a claim; the browser is what enforces it.**

Not covered, and so not evidenced by a green run: a real phone, screen-reader
testing, and print output. Desktop WebKit is not Safari on an iPhone. See
**[docs/test-evidence.md](docs/test-evidence.md)** for the full list of what is
and is not verified.

## Continuous integration

`.github/workflows/ci.yml` runs on pushes and pull requests to `main`:

| Job | What it proves |
|---|---|
| `checks` | Every first-party file parses (`npm run check`), the isolated suite passes on Node 24, and production dependencies have no advisory at moderate or above |
| `browser` | The full Playwright suite in Chromium and WebKit, plus mobile emulation: critical journeys, axe-core scanning, and the CSP as a browser actually enforces it |
| `container` | The image builds, refuses to start without storage, boots on an empty volume without PIN configuration, runs as non-root, answers `/api/health` with the built release, and preserves representative search, candidate, score, history, and media records across a restart |

A failing run means the commit is not eligible to be marked ready for release.
That is a rule, not yet an enforced one: `main` is unprotected at the time of
writing, which is how two consecutive commits with failing checks became the
deployed branch. The branch-protection settings that close this, and the path a
change takes from a working tree to a running service, are in
[the release process](docs/release-process.md).

What a green run still does not cover: a real phone, a screen reader, printed
output looked at by a person, and two commands that are deliberately outside CI
because their output is something to read rather than a threshold to pass —
`npm run test:load` (a latency measurement) and `npm run print:samples`.

### Print output for review

`npm run print:samples` builds a search shaped to break layout — a county name
that wraps, long candidate answers, a wide table, eight candidates with names
that do not fit a column — and writes seven PDFs and matching PNGs to
`print-samples/` (gitignored). Looking at the first set found two defects: the
print stylesheet applied only to the brochure and advertisements, so Ctrl+P
anywhere else printed the navigation rail and filter controls; and an internal
review warning printed on the client-facing brochure. Both are fixed and pinned
by browser checks. **The remaining sign-off needs a person** — a screen PDF and
paper are not the same thing. See **[docs/test-evidence.md](docs/test-evidence.md)**.

## Outcomes and closeout

**A candidate's outcome is not their pipeline stage, and closing a search is
not archiving it.** `stage` says where someone sits in the process; it cannot
say a finalist withdrew or that one was hired. Archive is filing.

Outcomes: `withdrawn`, `not-selected`, `selected`, `declined-offer`. Every one
records the actor, timestamp and reason; `not-selected` and `selected` also
require the job-related evidence they rest on. Withdrawals and declined offers
are marked `staff-recorded-from-candidate`, so a candidate's own decision never
reads as the firm's.

**A correction is a new event.** It names the entry it supersedes and leaves
the original in place. A hiring record that can be silently rewritten is not a
record.

An outcome constrains what follows. A withdrawn or not-selected candidate
cannot be advanced or newly scored, and their questionnaire link is revoked
immediately. **Scores already recorded are kept** — they are evidence of how
the committee worked, not just of that person. A selected candidate keeps
access through contracting.

**Closeout** (`POST /api/searches/:id/close`, `closed` or `cancelled`) freezes
ordinary edits, refuses questionnaire submissions, revokes every outstanding
link, and summarises disposition and final documents. Reads keep working.

**Reopening** requires a reason and is recorded. It restores editing but
**does not restore revoked links** — reissuing one is a separate, deliberate
act, so reopening a search months later never puts an old bearer URL back into
circulation.

The export carries the lifecycle and every outcome decision with its reason,
evidence, actor, and any corrections.

**Where this is in the app.** A candidate's **Outcome** section — the third tab
on their page — records and corrects the decision and lists the history, with
the earlier entries marked superseded. Closeout is its own screen, reached from
**More** on the search overview; it summarises the outcomes, names the
candidates still undecided, lists the final documents, offers the record as a
download, and holds both the close and the reopen form. Recording an outcome,
closing and reopening are the account manager's; a consultant who opens those
screens is told who runs the search rather than shown a control that would be
refused. While a search is closed, every screen in it carries a
notice saying so — the alternative is a Save button that quietly fails.

## Candidate intake and submission recovery

**A committed submission is never lost to a dropped connection.** Submitting
returns a receipt with a reference and a timestamp, and the receipt comes back
on every reload. If the same answers arrive again — the response was lost, the
phone suspended the tab, they pressed submit twice — the server returns 200
with the original receipt and says the questionnaire was already received.
Previously this returned 409, which reads as failure and pushes a candidate
into sending a second, conflicting set of answers.

Genuinely *different* answers against a submitted questionnaire are still
refused, with the original kept and instructions to request a correction. A
submitted response is part of the record; replacing it is a decision a person
makes, not a side effect of a retry.

**Documents and contact are recorded on the candidate's Details tab.** Slate
holds neither. A document entry is a reference — a type, a label, and an https
link into the approved repository — and recording it does not widen who can
read the document; reference and background material is marked restricted.
The contact log records what staff say they did: the channel, the purpose, a
summary and an optional follow-up date. **Slate sends nothing and cannot
confirm delivery**, and the screen says so, because a search record that
implies a candidate was notified when all it knows is that someone meant to is
worse than no record. Dated follow-ups and anyone never contacted appear in a
panel at the top of the candidate list.

**Drafts are server-side and expire** (14 days). A long answer typed on a phone
survives a lost connection without leaving the candidate's text sitting in the
browser of a possibly shared device with nothing to remove it. A draft can
never modify a submitted response, and is cleared once its questionnaire is
submitted.

**Documents are references, not files.** Resumes live in the county-approved
repository. Slate records that a document was received and where it is;
`https` links only, so a record cannot point at `file://` or a
`javascript:` URL. Reference and background material is flagged `restricted`.

**The communication log is staff-recorded.** Slate sends nothing, so every
entry is labelled `staff-recorded` with a note that delivery cannot be
confirmed. `GET /api/searches/:id/follow-ups` lists candidates never
contacted and those whose follow-up date has passed.

Candidate pages state whether a date is enforced (it is not) and in which
timezone, and carry the support contact, correction instructions, and the
privacy notice — reporting the notice as missing until one is configured.

## The user guide

**One catalog, three renderings.** `content/help/` is the only copy of the
help content; `server/help.js` projects it and `public/help.js` renders it into
the in-app drawer, the searchable help screen, and the printable guide. Nothing
downstream holds content of its own, so a printed copy a committee member is
handed cannot drift from the button they are looking at.

Every article follows one template, enforced by fields rather than prose:
**who this is for → before you start → numbered steps using the actual button
labels → how to know it worked → who sees the result → next step → recovery
and help**. `content/help/schema.js` refuses an article that omits any of them.

**The catalog is checked against the build it describes.** `help.verify()` runs
at startup and the process refuses to start if an article names a process step
or a package that does not exist. `tests/help.js` additionally lifts
`knownView()` out of `public/app.js` and asserts that every screen the guide
claims to explain is one this client can render — a help link that lands
nowhere is found by somebody who is already stuck.

**Help never costs you what you have typed.** "Help with this page" opens a
drawer built against the live DOM and appended to `<body>`; it does not go
through the application's renderer, which replaces the page. Escape closes it
and focus returns to the control that opened it. The drawer is deliberately not
`aria-modal`: the point is to read it while looking at the control it explains.

**Every help trigger has a name of its own.** `withTip()` derives it from the
control's own visible text — "Explain Replace candidate link" — rather than
repeating "Explain this control" eleven times on one screen. It also *merges*
into an existing `aria-describedby` rather than writing a second attribute,
which browsers ignore: before this, adding a tooltip to a field silently
replaced that field's visible hint in the accessibility tree.

`GET /api/help` serves the whole guide to a signed-in reader.
`GET /api/public/help` serves the candidate articles to the portal, built from
an allowlist of `public: true` rather than from the staff guide with things
taken out.

## Public postings and the candidate portal

**Nothing is public until a search manager publishes it.** There is no
default-public state, and the 7→8 migration leaves every existing search
unpublished — a migration that inferred "this search is advertising" from an ad
plan would put a client's search on the internet because somebody upgraded the
application. `publishPosting` is in the authority matrix
(`server/authority.js`): consultants prepare and preview, the manager
publishes, pauses, closes and republishes.

**Publishing takes a snapshot.** `server/postings.js` freezes the approved
fields at publication. Research, draft ads and search facts change all week and
none of it reaches a page members of the public are reading; the live page
serves that snapshot until somebody publishes a new one, and the staff screen
says when the draft has moved on.

**The public projection is an allowlist.** `publicView()` names every field it
emits and never takes a search or a candidate as an argument, so there is
nothing private in scope to leak by accident.

**Posting state and search state are separate.** Closing recruitment stops new
applications while staff carry on evaluating. Closing, cancelling or archiving
the *search* takes the posting offline regardless, and restoring the search
republishes nothing.

**Only the deadline policy you choose is enforced.** A hard closing date closes
applications at the end of the stated day. "Open until filled" with a first
review date displays that date and never acts on it — the same promise the
semifinalist questionnaire already makes.

**Applicant identity is separate from staff identity.** `server/applicant-access.js`
is passwordless: a six-digit code proves one email address, and that issues a
revocable session cookie scoped to `/api/applications`. Codes and session
tokens are stored as SHA-256 hashes, so a copy of the store does not let its
reader open anybody's application. Asking for a code answers identically
whatever the address, so the endpoint cannot be used to ask whether somebody
applied for a job. An applicant never needs an invitation to anything, and an
applicant session opens no staff route.

**A draft is not an application.** `server/applications.js` keeps applications
in their own table rather than on the search: a draft stored on the search
would be one forgotten filter away from a committee's candidate list or an
export. Drafts are invisible to staff, absent from every export, and expire
after 14 days — the same policy the questionnaire drafts use. Saving again puts
the expiry back.

**Submission is idempotent and honest.** The posting state, the deadline and
the form version are all rechecked at commit. A retry, a double-click or a lost
response returns the same receipt rather than a second application. If the
posting closed while somebody was writing, their work is preserved, they are
given a contact, and no receipt is claimed. A failed confirmation email is
recorded and changes nothing: the application is received either way.

**A form that changes under a draft never discards an answer.** Questions carry
a stable key, so rewording or reordering one keeps the answers against it.
A *material* change — a new required question, one that became required, a
removed question, a newly required material — stops the submission and shows
the applicant exactly what changed. Answers to a removed question are kept out
of sight rather than deleted.

**A receipt is not a hiring status.** It says an application arrived, and every
rendering of it says what it is not. The portal never infers "under review" or
"shortlisted" from internal scoring or workflow, and staff accepting an
application onto the candidate list changes nothing the applicant sees.

**A possible duplicate is a review, not a merge.** Slate never merges records
and never reveals an existing candidate because somebody entered the same
address: two people can share a family mailbox. Staff read both and decide.

**Materials are conservative** (`server/application-files.js`). Generated
storage keys, an extension *and* content check against a narrow allowlist —
PDF, with the posting's support contact as the accommodation route — bounded
size and count, and per-request download authorization. Nothing is readable by
a reviewer until a scanner has cleared it, and with no scanner configured that
means nothing is readable and the record says so. The bytes live beside the
store under `application-files/`, so `server/backup.js` covers them and a
restore brings the documents back with the records that reference them.

**With uploads on, Slate holds candidate documents — and that changes the
operating model.** Everywhere else Slate records *where* a document is and
refuses to hold it. The portal with `SLATE_APPLICATION_UPLOADS=on` is the
exception: applicant PDFs are stored under `DATA_DIR/application-files/`, which
makes Slate a storage location and a processor for them, puts them in every
recovery snapshot and in the off-volume copy, and brings them inside the
records-retention and legal-hold decisions. The two modes are set out in
[the operating procedure](docs/search-operating-procedure.md) §5, and the
retention split in [operations](docs/operations.md) §6.

**Three things are off by default, and the application says so.** Without a
mail provider a posting publishes as a readable advertisement and does not
offer an application form it cannot complete; without uploads enabled no
material can be attached; without a scanner no material can be opened. The
posting screen warns before publishing and `/api/ready` reports all three. See
`.env.example` for `SLATE_MAIL_TRANSPORT`, `SLATE_APPLICATION_UPLOADS` and
`SLATE_FILE_SCANNER`.

**Two of them cannot be faked in production, and today neither is real.**
`SLATE_MAIL_TRANSPORT=echo` and `SLATE_FILE_SCANNER=accept-all` exist for
development and are refused under `NODE_ENV=production`, resolving to the safe
value and logging a warning rather than crashing a live service. Beyond that,
no transport in `server/mailer.js` delivers to a real mailbox and no scanner in
`server/application-files.js` reads a byte, so `/api/ready` reports
`portal.mail.productionCapable: false` and `portal.files.productionCapable:
false` on **every** deployment, and a production portal offers no email flow at
all — including on `log`, which would otherwise tell an applicant a code was
sent and put it in a log file they cannot read. Each is one function and one
list entry away from working; neither is guessed at here. A controlled pilot
therefore runs public intake only with a real provider and a real scanner
configured, or not at all.

Public routes: `/careers`, `/careers/:firm`, `/careers/:firm/:posting`, and
`/careers/:firm/:posting/apply` (no-store, `noindex`). Read APIs under
`/api/public/`, applicant APIs under `/api/applications/`, staff publishing
under the existing authorized search routes. The service worker bypasses all of
it, and `public/robots.txt` allows the job pages and nothing else.

## County searches: facts that need a person

A county's authority structure cannot be inferred from a position title. Two
counties with identically titled administrators can differ on who appoints
them, which departments report to them, and which offices are separately
elected. Slate records these explicitly rather than letting a draft assert them.

`PUT /api/searches/:id/verification` records eight facts — governing body,
reporting relationship, appointment and removal authority, separately elected
offices, departments and services in scope, employment terms, how candidates
apply, and the responsible fact reviewer at the county.

A material fact counts as **confirmed** only with a value, a source, the date
that source was current, and a named person who confirmed it. A value alone is
an assertion, and is reported as `unverified`. Every search read carries
`factStatus` with what is confirmed, what is outstanding, and whether the
material facts are complete enough to publish recruiting copy against.

Confirmation timestamps are stamped by the server; a client cannot backdate who
confirmed a fact.

Site research is jurisdiction-aware: a county search looks for the board of
supervisors, elected officials, organizational chart, strategic plan and
adopted budget, and ranks those ahead of generic pages. Municipal discovery is
unchanged. Discovery is tested against synthetic HTML — CI never depends on a
live county website.

**Generated text is not authoritative.** Drafts suggest what to ask; the
county-approved job description and the county's own sources settle it.

**Where this is in the app.** **County fact verification**, from Search facts or
from **More** on the overview. Each fact gets its value, source, as-of date and
the person confirming it, with its state shown beside it; the screen leads with
whether the material facts are complete enough to publish against, and Search
facts carries a count of what is still outstanding.

## Records export

Closeout offers the record as a readable report and as a data bundle;
`GET /api/searches/:id/export` is the route behind both, with `?format=text`
for the report. It produces the complete record of one search: facts and
sources, committee and intake, adopted criteria with their revision, artifacts
and approvals, candidates with their responses **and the questions those
responses answer**, any responses a reopened questionnaire replaced, the
inventory of material held elsewhere, the contact log, staff work, every outcome
with its reason and job-related basis, the lifecycle, and decision history with
actor attribution. The plain-text report stands alone without the application
and carries all of it — a records officer reads the same record, not a summary
of it.

Restricted to consultants. A committee member cannot obtain through an export
what they cannot read in the app — the export is a different format for the
same authority, never a wider one.

Never included: credential hashes, sessions, invitation tokens, API keys, or
any other search. **Sealed scores stay sealed**, and are reported as withheld
rather than quietly omitted. External documents are named so a reviewer knows
what to retrieve from the repository that holds them.

Material actions carry a stable actor id alongside a display name. The shared
firm sign-in is marked `shared-account` and stated to identify the firm rather
than an individual. Entries predating actor ids are labelled `name-only`, not
presented as attributed.

Every bundle states that this is **recoverable history, not a tamper-evident
audit log**. If the county requires tamper-evident audit, that is separate
infrastructure Slate does not provide.

Decisions the pilot depends on that cannot be answered in code are registered
in **[docs/pilot-decisions.md](docs/pilot-decisions.md)**.

## Monitoring

`GET /api/health` is cheap liveness for the platform health check.
`GET /api/ready` reports readiness, recovery health, metrics, and alert status.
Keep the platform check on `/api/health`: pointing it at `/api/ready` would let
an overdue backup restart the container instead of paging someone.

Requests and errors are logged as one JSON object per line with the same
correlation id the caller was given (`X-Request-Id`), so a support call can be
traced to a log entry. Route names are templates and actors are account ids —
no bodies, names, emails, or bearer tokens reach the logs.

Alerts (`SLATE_ALERT_WEBHOOK` or `SLATE_ALERT_COMMAND`) fire on
`backup-overdue`, `storage-unwritable`, and `error-rate`, deduplicated so a
persisting condition pages once. AI availability is reported separately from
readiness: an Anthropic outage stops drafting, not the application.

Details, drills, and the incident quick reference are in
**[docs/operations.md](docs/operations.md)**.

## Recovery

Snapshots run hourly inside the app process and are verified before they are
published. Off-volume copies, the restore drill, monitoring, retention, and
incident handling are in **[docs/operations.md](docs/operations.md)**.

Two things to know here:

- A local snapshot lives on the disk it protects. Losing the volume loses it.
  Set `SLATE_BACKUP_MIRROR` or `SLATE_BACKUP_COMMAND`, or there is no recovery
  from volume loss. `/api/ready` reports `offVolumeCopy: "NOT CONFIGURED"`
  until you do.
- **Do not run `scripts/backup.js snapshot` against a running app.** Nothing
  orders an outside process against the writer, so the copy can catch a write
  in progress. The CLI refuses when it detects a live writer.

Alert on `recovery.overdue` from `/api/ready`. Nothing is deleted
automatically: retention is a records policy the county has not set, and a
destructive job running before that policy exists could destroy something
under legal hold.

## Storage safety and the deployment lifecycle

**One writer, enforced.** The store is a single JSON file rewritten whole. Two
processes against one volume do not merge — the second writer's save discards
everything the first committed since it loaded. Slate takes a lock
(`DATA_DIR/.writer.lock`) at startup and refuses to run if a live process
already holds it. **Do not run multiple replicas, and do not use PM2 cluster
mode.**

The holder proves it is alive by touching that lock every 30 seconds, and names
itself with a token rather than a process ID. A PID is not an identity: the
operating system reuses the number, so a crashed writer's PID can belong to an
unrelated program by the time the replacement boots, and across containers on
one volume it names a process the claimant cannot see at all. A lock whose
heartbeat has stopped is taken over with a warning in the log; a writer that
crashed on the same host is reclaimed at once, because its PID is provably
gone. If a running instance ever finds the lock taken by another, it exits
rather than let two processes overwrite each other.

**Photos are content addressed and never overwritten.** Files are named
`slot.<hash>.jpg`. Replacing a photo stages the new file under a name nothing
references, commits the record, and only then reclaims files that neither the
record nor its history points at. The previous implementation deleted the old
photo first, so a failed save rolled the record back over an image that no
longer existed — a successful rollback that still lost data. Uploads are also
decoded and checked for real JPEG markers before anything references them.

Because history is included in what the sweep keeps, **restoring an earlier
brochure shows the photo it was approved with**, not whatever replaced it.

**Schema version.** The store carries `schemaVersion`, with ordered migrations
and a pre-migration snapshot. A store written by a *newer* release is refused
outright rather than downgraded: rolling the app back onto a store it does not
understand is how a rollback becomes data loss. Roll back the application and
its matching snapshot together.

Schema 7 split committee intake into per-member response records: a private
draft and a committed answer, where there had been one record with a
`submitted` flag. A legacy record is read for what it was — flagged means the
member sent it, unflagged means they never did — and nothing invents a
submitted version the old schema had already overwritten. Refusing a downgrade
matters here because an older build writes the one-record shape back, which
would publish somebody's unsent draft as their answer.

Schema 4 introduced workspace ownership. It is the migration where refusing a
downgrade matters most: rolling an organization-aware store back onto a build
that predates workspaces would serve several firms through one global
permission model. Every search it touches comes out **unowned**, which is to say
readable by nobody, because deciding which firm owns a record that predates
workspaces is a migration decision (`scripts/organizations.js`) and not
something the first person to sign in should settle by signing in. Clerk holds
the organizations, memberships and invitations, so restoring a database snapshot
does not restore those: they are a separate recovery step.

**Shutdown.** On SIGTERM the app stops accepting writes (reads continue,
mutations get 503 with `Retry-After`), drains in-flight requests, releases the
write lock, and exits — with a 10-second ceiling so it exits deliberately
rather than being killed mid-write.

### Residual limitations

- **Graceful shutdown cannot be verified on Windows.** Node emulates SIGTERM
  there as unconditional termination, so the handler never runs on a developer
  machine. It is checked in CI with `docker stop`, which sends a real SIGTERM.
  An unclean kill is survivable regardless: the next start finds a stale lock
  and takes over.
- **The lock is advisory and pid-based.** It protects against a second process
  on the same host and filesystem. It does not coordinate two hosts sharing a
  network volume, and pid reuse after an unclean shutdown could in principle
  make a live lock look stale.
- **No load testing has been done.** The plan's pilot envelope (100 candidates,
  20 concurrent sessions, p95 under a second) is unmeasured. Whether JSON is
  adequate for it is an open question, not an answered one.
- Growth is bounded only by the media sweep. History and store growth are
  **not** yet monitored or archived on a schedule.

## Account administration

Two levels, deliberately apart.

**Inside a workspace**, an organization administrator manages members,
invitations and roles from **Team & access** in the app. That is routine work
and belongs to the firm, not to whoever has shell access.

**Above every workspace** sits one thing a workspace administrator must not be
able to do: end an account's access to the deployment entirely, whichever firms
it belongs to. That stays a CLI, run inside the deployment against its
`DATA_DIR`:

```bash
node scripts/accounts.js list            # accounts, and the workspaces last seen for each
node scripts/accounts.js rename u3 "Dana Ruiz-Alvarez"
node scripts/accounts.js disable u3      # revokes access, keeps the record
node scripts/accounts.js enable u3
```

There is no longer a command that grants consultant access, because there is no
longer a firm-wide consultant: authority comes from membership in a workspace
and nothing else. Mapping legacy records onto a workspace is
`scripts/organizations.js`, which is a dry run until `--apply`.

Keeping the deployment-level controls out of HTTP is deliberate. Over HTTP, a
compromised administrator session could disable accounts across every firm on
the deployment; requiring shell access keeps that behind whatever controls the
hosting account has.

**Disabling keeps the record.** History attributes decisions to accounts, and a
search must stay readable after someone leaves, so a disabled account retains
its identity and loses its access. There is no session to revoke: every request
resolves the Clerk identity back to the account and re-checks the flag, so
access ends on the next request rather than whenever a cookie lapses.

**Session length** belongs to Clerk, and so does signing out. Slate stores no
session, which is also why a restored backup cannot bring one back.

**Still an owner decision:** MFA/SSO. If the county requires it, it should come
from an established identity provider rather than a bespoke implementation
here. Nothing in this section substitutes for that.

## Browser security boundary

Implemented in `server/http.js` and covered by `tests/security.js`.

**Response headers.** Every response, including static files, media, and
candidate pages, carries a Content-Security-Policy, `nosniff`,
`X-Frame-Options: DENY`, `Cross-Origin-Opener-Policy`,
`Cross-Origin-Resource-Policy`, and a `Permissions-Policy`. HSTS is added in
production only. Candidate pages retain the strict first-party-only policy.
The staff workspace allows the configured Clerk domain, Clerk profile images,
telemetry and abuse protection, and Cloudflare bot protection. Clerk's runtime
styles require `style-src 'unsafe-inline'`; inline scripts and eval remain
blocked. Fonts continue to be served from this origin.

**Fonts are vendored.** `public/fonts/` is generated by
`node scripts/vendor-fonts.js`. Candidate questionnaire pages are opened by
members of the public holding a bearer link; a CDN font request would disclose
each candidate's IP address and the page they opened to a third party.

**Same-origin enforcement.** Cookie-authenticated mutations must come from this
origin, checked with `Sec-Fetch-Site` and `Origin`. Requests carrying neither
are treated as non-browser clients (CLI, tests, monitoring) and allowed
through: they cannot be driven by a hostile page, which is the threat this
control addresses. A browser always sends `Origin` on a cross-origin mutation,
so this is not a gap a browser can walk into, but it does mean the control is
not a defence against a client that can set arbitrary headers.

**Bearer-link privacy.** `/apply/:token` pages send `Referrer-Policy:
no-referrer` and `Cache-Control: no-store`. Private media sends `no-store,
private` and `Vary: Cookie`. Tokens are stripped from log paths by
`safePath()`, so a candidate link never lands in a log with weaker access rules
than the record it unlocks.

**Request bounds.** Ordinary endpoints accept 256 KB. Only the photo upload
route accepts a large body (9 MB, for a 6 MB decoded JPEG). Candidate fields
are individually bounded. Malformed JSON returns 400 and an oversized body 413,
both with a support reference and no stack trace.

**Rate limits.** Unauthenticated candidate routes are limited per IP; photo
upload, drafting, and research are limited per account so one busy consultant
cannot exhaust another. Limits are set to bound abuse, not to interrupt
ordinary work.

**Errors.** Every response carries an `X-Request-Id`. Production error replies
give the reference and nothing else; detail stays in the process log.

### Residual limitations

Honest boundaries on what the above does and does not establish:

- These are **protocol-level tests**. They prove the server sends the right
  headers and refuses the right requests. They do not prove a real browser
  enforces them. That needs the browser coverage in DEP-12.
- **A CSP is a second line of defence**, not a substitute for output escaping.
  The renderer's escaping is covered separately in `tests/integrity.js`.
- **Rate limits are per process and in memory.** They reset on restart and
  would not be shared across replicas, which is consistent with the
  single-writer deployment model but is not a defence against a distributed
  source.
- **Bearer links remain bearer links.** Anyone holding the URL can open the
  questionnaire. `no-store` and `no-referrer` reduce how long and how widely
  the URL survives; they do not make the link an authenticated session.
- `slate.html` at the repository root is a **design source** read by
  `scripts/extract-css.js`, not a served page. It still references a font CDN;
  that has no runtime effect because it is never sent to a browser.

## Revisions, questionnaires, and recovery

Every search response includes `revision`. Signed-in search mutations must send
that value in the `If-Match` header; missing revisions return 428, stale revisions
return 409. The browser sends it automatically and preserves unsaved fields when
a save fails. AI generation and city research also reject results if the search
changed while they ran. Use **Reload search** after copying edits you want to keep.

Changing the profile preserves the previous criteria, scores, and notes in
**History and recovery**, clears current scores, and seals the new evaluation.

A **scoring** entry records what that save replaced — the reviewer-and-candidate
pairs whose marks or notes actually changed — and names the profile revision
rather than copying the criteria into every entry. It previously copied the
whole panel each time, which grew faster than linearly in a panel's work: the
load measurement put 255 score saves at 217 KB of history against 3.5 KB of
actual scores, now 16.5 KB. **Nothing left the record.** A mark that did not
change is recorded in the entry where it did, or in the current state, and the
full picture at any point is the profile revision's baseline plus the deltas
after it. Entries written before the change keep their old shape; the export
labels each one `changed-only` or `complete-snapshot` so a reader never guesses.
This bounds growth; it does not set a retention period, which is the county's
decision.
Consensus adoption preserves IDs for matching criteria. Changes to recruiting
facts, community copy, the ad plan, and the brochure invalidate dependent copy
approvals. Old artifact versions can be restored from history; restoring a
profile requires reassessment. Activity history is no longer capped at 40 entries.

Candidate questionnaires are frozen for each candidate when first opened
(survey two is frozen when the consultant opens access). A submission must include
the `surveyVersion` returned by `/api/apply/:token` and valid answers to all required
questions. Responses retain their question and profile snapshots. Older responses
are explicitly labeled because their original question wording cannot be verified.
**Reopen questionnaire** preserves the submitted response in history and issues a
fresh candidate link for corrections. Requested response dates are advisory; late
responses are accepted. **Open questionnaire** does not send email: the consultant
must contact the candidate and share the link.

**Archive** replaces permanent search deletion. Archived searches and their media
can be restored from **Archived searches**. Their candidate links stop working
while archived and remain revoked on restoration. Reissue a candidate link
separately when access is appropriate. Committee accounts with no active
places are retired; roster accounts are recovered on restoration.
If an email was reassigned to a different account, restoration stops for that
conflict to be resolved. No permanent purge is exposed in the app.

## County searches

Choose **County** under **Jurisdiction type** when creating a search. Setup shows
county examples, including County Administrator, and saves the choice on the file.
Enter the actual position title and official form of government. For an Arizona
county, enter `AZ` or `Arizona` in State; research and drafting instructions then
use Board of Supervisors terminology and distinguish separately elected offices
from departments directed by the administrator.

The type can also be changed in **Search facts**. Custom facts are preserved;
the default form of government follows the selected type. Changing type flags
existing documents for review and removes their approvals. Existing files default
to City or town until explicitly changed. County-specific authority and duties
still need to be confirmed from the client's official sources.

## Backups and restore drill

Before migration and the first API request of each UTC day, the app ensures a
verified snapshot under `DATA_DIR/backups/YYYY-MM-DD`. A snapshot includes the JSON
store, brochure media, and SHA-256 checksums. These are local-volume recovery copies;
copy verified snapshots to separate storage for protection against volume loss.
Snapshots are retained until an operator removes them, so monitor volume capacity.

For a manual backup, stop the server first so the store and media cannot change
during the copy. Use a new backup destination:

```text
node scripts/backup.js snapshot /data /safe-backups/slate-2026-09-06
node scripts/backup.js verify /safe-backups/slate-2026-09-06
node scripts/backup.js restore /safe-backups/slate-2026-09-06 /data-restored
```

Restore refuses a nonempty destination and drops any pre-Clerk session table. Stop the app,
point `DATA_DIR` at the restored directory, restart, sign in, and check a search,
candidate response, and brochure photo. Keep the original directory until that
check succeeds. The isolated regression suite exercises data/media restoration,
checksum corruption detection, and preservation of the committed store on a failed
write. Automatic snapshots publish only after verification.

## Sign-in and deployment changes

Clerk authentication replaces shared credential-free access and email-only login.
Existing accounts, search memberships, and history stay in place. The old `start`,
`login` and `logout` routes are gone, along with the session table behind them;
a store carrying one loses it on the schema 2 to 3 migration. Legacy PINs and PIN
hashes were already removed from the active store on startup, and the public
config lists no accounts. Configure production Clerk keys, and use each person's
verified identity for attributable approvals.

Workspace support (schema 3 to 4) changes where authority comes from. There is
no longer a firm-wide consultant role, no operator email allowlist, and no
command that grants access; a person's authority is their membership in a Clerk
organization, re-read from Clerk on every protected request so that removing
them there ends their access on their next request rather than whenever their
session token expires. The cost is one directory call per request, taken
deliberately for the pilot in preference to a cache whose revocation guarantee
has not been tested; measure it before adding one.

Cutting over needs both halves in one window, and they are not both in the
database:

1. Enable Organizations on the Clerk instance and register `org:consultant`
   and `org:committee`. Map or migrate any existing `org:member` memberships
   deliberately — Slate reads that role as no access.
2. Back up and verify the store, then rehearse `scripts/organizations.js plan`
   and `adopt` against a copy with at least two workspaces.
3. Deploy the application and the authorization change together. There is no
   intermediate release that shows a workspace switcher over global permissions.
4. Map the legacy searches, archives included, to the workspace that owns them.
   Until that runs they are readable by nobody, which is the safe state, not a
   fault.
5. Smoke-test staff collaboration, committee restriction, cross-workspace
   denial, and the public `/apply` pages, which need no membership and are
   unchanged.

Rolling back after more than one firm is onboarded would remove isolation. Use
maintenance mode and an authorized restore, and account for the Clerk side —
organizations, memberships, invitations — separately from the database snapshot.

The privacy migration replaces legacy candidate invitation links once because
they were previously included in committee API responses. **After updating, share
the new links from Screening with active candidates.** Existing responses remain
on file. Newly issued links survive later restarts, and can be replaced individually
from the candidate page.

Forwarded IP headers are ignored by default. If deployed behind a proxy, set
`TRUST_PROXY` to the actual proxy IPs/subnets (comma-separated), with direct app
access restricted appropriately. Do not configure arbitrary client-supplied IPs
as trusted. Login throttling applies to both IP and account. Continue running one
app replica against the JSON store.
