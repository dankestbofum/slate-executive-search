# Slate

Guided executive-search workspace. Node 20, Express, JSON file store.

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

```bash
cp .env.example .env
# add ANTHROPIC_API_KEY
npm install
npm start
```

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
