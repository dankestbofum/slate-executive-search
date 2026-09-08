# Slate

Guided executive-search workspace. Node 24 LTS, Express, JSON file store.

## How a search runs

Nineteen steps in three phases. The catalog lives in `server/steps.js`; both the
store and the Claude prompts read step numbers from there, so renumbering the
process is a one-file change.

**Phase 0 — seat the committee and hear them.**

1. **Search committee.** Everyone who gets a say, plus one account manager.
   Seating someone without an account creates one and returns an eight-digit PIN
   once, for the manager to read to them.
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
per search and retired automatically, sessions included, when the last seat
holding them goes away.

### Signing in

There is one shared firm account, `team@slate.local`, so routine work does not
require remembering which named consultant you are. It is ensured on every
boot, not only on first seed, so it exists on stores that predate it.

| Variable | Default (local) | Notes |
|---|---|---|
| `SLATE_EMAIL_TEAM` | `team@slate.local` | The shared sign-in |
| `SLATE_PIN_TEAM` | `1234` | **Required in production**, or the shared account is not created at all |
| `SLATE_PIN_ABE` / `SLATE_PIN_MIKE` | `2468` / `1357` | The named consultant accounts |

In production, leaving `SLATE_PIN_TEAM` unset means no shared account exists; an
account already in the store is left alone rather than being locked out.

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
npm start
```

`.env` is loaded only outside production. In production the platform's
environment is authoritative, so a file that slipped into an image cannot
quietly replace deployed configuration.

Open http://127.0.0.1:4173 and sign in as `team@slate.local` / `1234`. The named
accounts still work (`abe@slate.local` / `2468`, `mike@slate.local` / `1357`).

Only consultant accounts are ever listed on the sign-in page; committee PINs are
shown once, on the roster, to the manager who seated them.

`npm test` starts its own local server and temporary data stores. It never reads
your `.env`, contacts Claude, or changes live searches. Failed checks exit nonzero.
`npm run test:live` explicitly targets an already-running server through
`SLATE_URL` (default `http://127.0.0.1:4173`) and creates test records there.
External website checks are opt-in with `SLATE_NETWORK_TESTS=true`.

## Railway (or similar)

1. New service from this repo. Start command is `npm start`. Health check: `/api/health`.
2. Variables:
   - `ANTHROPIC_API_KEY` (required for drafts and city research)
   - `CLAUDE_MODEL` / `CLAUDE_MODEL_PREMIUM` (optional)
   - `NODE_ENV=production` (Railway sets this)
3. Attach a **volume** and set `DATA_DIR` to the mount path (for example `/data`). Production will not start without this.
4. Set `SLATE_PIN_TEAM` for the shared sign-in, and on first boot of an empty volume `SLATE_PIN_ABE` and `SLATE_PIN_MIKE`. Do not turn on `SHOW_DEMO_LOGINS`.
5. Keep a **single replica**. The store is one JSON file; two instances will overwrite each other.

The app binds `0.0.0.0` and uses `PORT` from the platform. Session cookies are `Secure` in production.

The image is built from `Dockerfile` (`railway.json` selects the `DOCKERFILE`
builder). There is no second build path: the former `nixpacks.toml` was removed
so the runtime cannot drift between build methods.

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

## Continuous integration

`.github/workflows/ci.yml` runs on pushes and pull requests to `main`:

| Job | What it proves |
|---|---|
| `checks` | Every first-party file parses (`npm run check`), the isolated suite passes on Node 24, and production dependencies have no advisory at moderate or above |
| `container` | The image builds, refuses to start without storage or first-boot credentials, boots on an empty volume, runs as non-root, answers `/api/health` with the built release, and survives a restart with its store intact |

A failing run means the commit is not eligible to be marked ready for release.
Browser, accessibility, and print coverage are not in CI yet, so a green run is
not evidence of those.

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
node scripts/accounts.js reset u3        # new PIN, revokes that account's sessions
node scripts/accounts.js disable u3      # revokes access, keeps the record
node scripts/accounts.js enable u3
node scripts/accounts.js audit           # flags published development PINs
```

This is deliberately **not** an HTTP route. Account administration is the
authority that grants every other authority, and the app has no role above
consultant to hold it. Over HTTP, any compromised consultant session could
mint or reset accounts; requiring shell access keeps it behind whatever
controls the hosting account has. If the county needs delegated in-app
administration, that is a new role and a new decision, not a flag.

`create` and `reset` print a PIN once. It is stored only as a scrypt hash and
cannot be printed again — issue a new one with `reset`.

**Disabling keeps the record.** History attributes decisions to accounts, and a
search must stay readable after someone leaves, so a disabled account retains
its identity and loses its access. Sessions are revoked immediately, and every
request re-checks the flag, so a session restored from a backup cannot outlive
the decision to withdraw access.

**Credential strength.** New production credentials must be at least 8
characters and must not be a published development PIN, a repeated character,
or a simple run. The app refuses to boot in production with a credential that
fails this. Hashing an old weak PIN does not make it strong, so
`accounts.js audit` reports existing accounts that still authenticate with a
published default, and production logs the same warning at startup.

That audit rules out the *published* PINs. It cannot tell you whether a
remaining PIN is otherwise guessable.

**Sessions** last `SLATE_SESSION_DAYS` (default 14), capped at 30 by the
server. Configuration cannot raise the ceiling.

**Still an owner decision:** MFA/SSO. If the county requires it, it should come
from an established identity provider rather than a bespoke implementation
here. Nothing in this section substitutes for that.

## Browser security boundary

Implemented in `server/http.js` and covered by `tests/security.js`.

**Response headers.** Every response, including static files, media, and
candidate pages, carries a Content-Security-Policy, `nosniff`,
`X-Frame-Options: DENY`, `Cross-Origin-Opener-Policy`,
`Cross-Origin-Resource-Policy`, and a `Permissions-Policy`. HSTS is added in
production only. The policy needs no `unsafe-inline`, no `unsafe-eval`, and no
third-party origin, because the front end has no inline scripts or style
attributes and fonts are served from this origin.

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
seats are retired with their sessions; roster accounts are recovered on restoration.
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

Restore refuses a nonempty destination and clears old login sessions. Stop the app,
point `DATA_DIR` at the restored directory, restart, sign in, and check a search,
candidate response, and brochure photo. Keep the original directory until that
check succeeds. The isolated regression suite exercises data/media restoration,
checksum corruption detection, and preservation of the committed store on a failed
write. Automatic snapshots publish only after verification.

## Sign-in and deployment changes

Stored PINs migrate to salted scrypt hashes without changing existing sign-ins.
New committee PINs have eight digits; resetting one ends that account's sessions.
Production never exposes demo credentials, even if `SHOW_DEMO_LOGINS=true`.
Prefer named consultant accounts for attributable approvals; the shared firm
account remains available for the existing team workflow. Use strong consultant
secrets in production.

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
