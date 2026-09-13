# Slate

Guided executive-search workspace. Node 24 LTS, Express, JSON file store.

## How a search runs

Nineteen steps in three phases. The catalog lives in `server/steps.js`; both the
store and the Claude prompts read step numbers from there, so renumbering the
process is a one-file change.

**Phase 0 — seat the committee and hear them.**

1. **Search committee.** Everyone who gets a say, plus one account manager.
   Seating someone without an account creates one. They sign in with their email.
2. **Committee input.** The manager opens a window; each seated member answers
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

## Service packages

A search carries one of three packages, picked when the file is opened and
changeable on Search facts. The package decides how many of the nineteen steps
are on the file. The committee is on every one: each package seats the people
who will hire and builds the profile from their answers. What a cheaper package
leaves out is the later work, not the room.

| Step | Basic | Enhanced | Executive |
|---|---|---|---|
| Committee, intake, profile | yes | yes | yes |
| Initial survey, ad plan, advertisement | yes | yes | yes |
| Screening, finalists | yes | yes | yes |
| Community profile, brochure | | yes | yes |
| Sourcing, video interviews (staff) | | yes | yes |
| Interview guide, semifinalist survey and send, finalist week | | yes | yes |
| Reference checks (staff) | | | yes |
| Model contract, annual evaluation | | | yes |
| Fee | $3,500 to $5,000 | $7,500 to $12,500 | $15,000 to $25,000+ |

Home, New search, and Search facts draw the same comparison matrix
(`COMPARE` in `server/steps.js`): service rows, one column per pay level,
potential fee in the footer. Picking a column on New search or Search facts
sets `package` on the file. **Packages** in the rail (and the column headers
on Home) opens a sample workspace for that pay level so a consultant can
show a client the Basic dashboard, the Enhanced recruited view, or the
Executive spec without opening a live file.

The overview reads differently by package, and the layout is part of the
catalog (`PACKAGES[key].view`): Basic opens on an applicant dashboard (committee
and profile, announcement, applicants, recommendation) with the process as one
row of chips; Enhanced adds sourcing and interview panels over the full phase
list; Executive keeps the step-by-step spec. `layout`, `panels`, `steps`,
`kicker`, and `lede` are served through `/api/config` and read by
`vOverview` in `public/app.js`, so changing what a tier looks like is a
catalog edit.

Each step in `server/steps.js` names the smallest package that includes it
(`pkg`). `stepsFor(package)` returns the steps on a file with `needs` trimmed to
steps that are also on it, so a Basic search's advertisement waits on the ad
plan rather than on a brochure it does not have. The API refuses drafts, saves,
reviews, photos, and the semifinalist send for steps outside the package
(`400`). Searches written before packages existed are treated as Executive.

## Roles

| | Consultant | Account manager | Committee member |
|---|---|---|---|
| See every search | yes | yes | only their own |
| Edit the search file | yes | yes | no |
| Seat members, run intake, adopt consensus | no | yes | no |
| Answer intake, score candidates | yes | yes | yes |

The account manager is whichever consultant holds the seat. **Any consultant can
join a search and take the account** — who runs a file is a firm decision, not a
wall between colleagues, and gating it on the current manager would strand a
search whenever that person is unavailable. Everything else the manager does
(seating members, running the intake window, adopting consensus) stays with
whoever holds the seat.

Consultant accounts come from the environment. Committee accounts are created
per search and retired automatically when the last seat holding them goes away.

### Opening the workspace

Select **Sign in** or **Sign up** on the landing page. Clerk verifies identity;
the profile menu manages the account and signs out. Slate keeps its existing
consultant roles, committee seats, and attribution history. On first sign-in,
a verified primary email links to the matching Slate account; subsequent
requests use its persisted Clerk user ID. Disabled accounts remain blocked.

New sign-ups receive committee access and see only searches they are seated on.
`SLATE_CLERK_ADMIN_EMAILS` may designate verified emails for initial consultant
provisioning. It applies only when creating a new Slate account; it never
promotes or re-enables existing accounts. Additional consultants can be created
with `node scripts/accounts.js create "Full Name" email@example.com "Title"`.

Clerk is the only way in. Slate issues no credential, keeps no session table
and has no sign-in route of its own; identity is proven on every request and
resolved to the account that holds the roles and seats. Missing Clerk
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

## Local

Requires **Node 24 LTS** (24.20.0 or newer), matching the container and CI.
Node 20 is end of life and no longer receives security patches.

```bash
cp .env.example .env
# add ANTHROPIC_API_KEY
npm ci        # lockfile install, same as CI and the image
clerk auth login
clerk init --app app_3JCIQzCE9yeVbFBkzQF0qP4LRfS
# Set SLATE_CLERK_ADMIN_EMAILS to your first consultant's verified email.
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
   match. Production refuses to start without it, which is what stops records
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
     one, and `SLATE_CLERK_ADMIN_EMAILS` for initial consultant provisioning.
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

## Browser and accessibility testing

`npm run test:browser` (Playwright) starts its own server against a throwaway
data directory and runs 162 checks — the same 54 in each of three projects:
desktop Chromium, desktop WebKit, and an emulated Pixel 7. They cover the
critical journeys, WCAG 2.1 AA scanning with axe-core, and whether the
Content-Security-Policy is actually enforced by a browser.

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
| `container` | The image builds, refuses to start without storage, boots on an empty volume without PIN configuration, runs as non-root, answers `/api/health` with the built release, and survives a restart with its store intact |

A failing run means the commit is not eligible to be marked ready for release.

What a green run still does not cover: a real phone, a screen reader, printed
output looked at by a person, and `npm run test:load`, which is deliberately
outside CI because its output is a measurement to read rather than a threshold
to pass. See **[docs/test-evidence.md](docs/test-evidence.md)**.

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
candidates still undecided, lists the final documents, and holds both the close
and the reopen form. While a search is closed, every screen in it carries a
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

`GET /api/searches/:id/export` produces the complete record of one search:
facts and sources, committee and intake, adopted criteria with their revision,
artifacts and approvals, candidates with their responses **and the questions
those responses answer**, staff work, decision history with actor attribution,
and a document inventory. Add `?format=text` for a plain-text report that
stands alone without the application.

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
mode.** A lock left by a crashed process is detected and taken over, with a
warning in the log.

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

Named consultant accounts are managed with a CLI, run inside the deployment
against its `DATA_DIR`:

```bash
node scripts/accounts.js list
node scripts/accounts.js create "Dana Ruiz" dana@firm.example "Search consultant"
node scripts/accounts.js rename u3 "Dana Ruiz-Alvarez"
node scripts/accounts.js disable u3      # revokes access, keeps the record
node scripts/accounts.js enable u3
```

This is deliberately **not** an HTTP route. Account administration is the
authority that grants every other authority, and the app has no role above
consultant to hold it. Over HTTP, any compromised consultant session could
mint accounts; requiring shell access keeps it behind whatever
controls the hosting account has. If the county needs delegated in-app
administration, that is a new role and a new decision, not a flag.

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
while archived and are replaced on restoration. Committee accounts with no active
seats are retired; roster accounts are recovered on restoration.
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
config lists no accounts. Provision consultant emails before inviting staff,
configure production Clerk keys, and use each person's verified identity for
attributable approvals.

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
