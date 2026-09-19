# User guide, in-app guidance, and public candidate portal — implementation record

Written September 19, 2026, against the plan in [IMPLEMENTATION_PLAN.md](IMPLEMENTATION_PLAN.md).
**Status: implemented locally and tested locally. Not released, and not verified against a deployment.**

Packages P1 through P4 are built. Two operational dependencies P4 names — a
mail provider and a malware scanner — are procurement decisions that could not
be made here; they are interfaces with honest defaults rather than guesses, and
the application refuses to offer an applicant a flow it cannot complete.
Storage is implemented and working; what is open there is how big the volume
needs to be. See [the three external dependencies](#the-three-external-dependencies-answered).

## What was built

| Package | Delivered |
| --- | --- |
| P1 — Guide foundation | `content/help/` as the single content source, `server/help.js`, `public/help.js` + `public/help.css`, a searchable help screen with a role filter and glossary, a per-screen help drawer, a printable view, and eighteen articles |
| P2 — Contextual guidance | Unique accessible names on every help trigger, a fix to `withTip()` that stopped it replacing existing descriptions, visible instructions beside consequential actions, and a getting-started checklist derived from search state |
| P3 — Publish and browse | `server/postings.js`, the `publishPosting` authority, staff publishing screen, public listings and job pages at `/careers`, allowlisted public serializers, schema migration 7→8 |
| P4 — Apply and return | `server/applicant-access.js`, `server/applications.js`, `server/application-files.js`, `server/mailer.js`, the applicant flow in `public/careers.js`, the staff **New applications** inbox, export and backup coverage |

### New files

```
content/help/schema.js          the article template, and the checks that keep it matching the build
content/help/catalog.js         the guide: eighteen articles and a glossary
server/help.js                  staff and public projections of the catalog
server/postings.js              posting snapshots, state, deadline rules, public projection
server/applications.js          drafts, submission, idempotency, receipts, reconciliation
server/applicant-access.js      passwordless applicant identity and recovery
server/application-files.js     private materials, type checking, quarantine, scoped reads
server/mailer.js                the mail interface, with no provider
public/help.js, help.css        the guide in the browser: drawer, screen, print
public/careers.{html,js,css}    the public portal
public/robots.txt               job pages allowed; nothing else
tests/help.js                   16 checks
tests/portal.js                 63 checks
tests/browser/help.spec.js      8 browser checks
tests/browser/careers.spec.js   7 browser checks
tests/browser/accessibility.spec.js  two scans added: the portal in both themes, and the guide
```

## Decisions taken, and why

**The guide has one source, and the build checks it.** `help.verify()` runs at
startup and the process refuses to start if an article names a process step or
package that does not exist. `tests/help.js` lifts `knownView()` out of
`public/app.js` and asserts every screen the guide claims to explain is one the
client can render. The alternative — a second list of view names on the server —
is exactly the drift the plan warns about in §2.

**The help drawer does not go through the renderer.** `paint()` replaces
`#app.innerHTML`. A help control that triggered it would take a half-written
committee answer with it, which is the reservation people have about clicking
Help mid-form. The drawer is built against the live DOM and appended to
`<body>`; the browser suite asserts a filled field survives opening and closing
it, and that Escape returns focus to the trigger.

**`withTip()` was replacing descriptions, not adding to them.** It wrote a
second `aria-describedby` attribute; browsers take the first and discard the
rest. A field with a visible hint lost that hint in the accessibility tree the
moment somebody added a tooltip to it. The ids are now merged, hint first.
Separately, every trigger's accessible name is derived from the control's own
visible text, so a screen no longer offers eleven controls all called "Explain
this control".

**A posting is a snapshot, not a view of the search.** Research, draft ads and
search facts change all week. Publishing freezes the approved fields, and the
public page serves that frozen copy until somebody publishes again. The staff
screen states separately what is live and what the draft has become.

**The public projection is an allowlist.** `publicView()` names every field it
emits, and takes a posting rather than a search, so there is nothing private in
scope. The test suite additionally asserts the client name, criteria,
candidates, members, scores and organization id are all absent from the page.

**Applications are a separate table.** A draft stored on the search would be
one forgotten filter away from a committee's candidate list or a permitted-
records export, and "we remembered to exclude it everywhere" is not a property
you can check. The search has to ask for them, and only submitted ones are ever
returned.

**Posting state and search state are separate, and the search wins.** Closing
recruitment stops new applications while staff keep evaluating. Closing,
cancelling or archiving the search takes the posting offline regardless, and
restoring the search republishes nothing.

**Question keys are stable, and the server does not rely on the client to keep
them.** Answers are stored against a key rather than a position, so rewording
or reordering a question keeps the answers. A request that omits the keys falls
back to matching on the prompt: losing an applicant's paragraph because a
caller omitted a field they have never heard of is not an acceptable way to
fail.

**A receipt is never a status.** Every rendering of it says what it is not, and
`tests/help.js` and the browser suite both assert that any mention of "under
review", "shortlisted" or "declined" in candidate-facing content is a denial.

## Defects found and fixed during implementation

Adding the posting to `painted()` broke two organization tests. `postings.ensure()`
attached `search.posting` on a **read**, and `integrity.reconcile()` compares
the whole record against the copy taken at the last save and increments
`revision` when they differ — so a GET silently invalidated the revision the
client was holding, and the next save failed as a conflict that never happened.

Fixed three ways: `postings.of()` is a non-mutating accessor used on every read
path, `blankSearch()` creates the posting with the search, and every posting
route returns the search revision so the client stays in step. This is a
general hazard in this codebase worth remembering: **a read must not touch the
search record.**

Naming the help triggers broke thirteen browser tests on the phone project, and
the reason is worth recording because it will catch the next author too. Below
the `pointer:coarse` breakpoint the tooltip's tap-alternative is visible, so its
accessible name — now "Explain Save my scores" rather than "Explain this
control" — is in the accessibility tree beside the control it explains.
Playwright matches names by substring, so `getByRole('button', { name: 'Save my
scores' })` began resolving to two elements on a phone and one everywhere else:
a test that passes in two projects and fails in the third.

The product behaviour is the one the plan asked for, so the locators were
tightened rather than the naming reverted — `exact: true` for string names, an
anchored pattern where a regular expression was genuinely needed. The rule is
written down at the top of `tests/browser/help.spec.js`.

The alternative would have been to take the tap-alternative out of the
accessibility tree entirely (`aria-hidden` plus `tabindex="-1"`), on the
grounds that the tooltip text already reaches assistive technology through the
control's own `aria-describedby` and the button is a purely visual affordance.
That is a defensible design and it would have avoided the collision, but it
removes a control from a user who may be using magnification alongside a
screen reader, and it is a larger change than the plan asked for. It is
recorded here as the road not taken rather than settled.

**The guide's background fetch could destroy unsaved typing.** The catalog is
loaded after the first paint so that "Help with this page" can appear only on
screens that have an article. The first version did that by calling `render()`
when the response arrived — and `paint()` rebuilds the page from state, while
no form in this application holds an unsaved value anywhere but the DOM. A
consultant who started typing into Search facts before the request came back
would have lost it the moment it did. It is now inserted into the page that is
already there (`paintHelpControl`), which is the same rule the drawer follows.
`tests/browser/help.spec.js` delays the catalog response by two and a half
seconds, types into the field during that window, and asserts both that the
control appears and that the typing survives; it fails against the old code.

**A receipt printed a UTC time under the posting's timezone label.** Found by
reading the rendered pages rather than by a test — everything asserted the
right strings and none of them asserted the right *instant*. Submissions are
stored in UTC; the confirmation rendered that clock time and appended
"(America/Phoenix)", putting the arrival seven hours late. On a posting with a
hard closing date that is the difference between inside and outside the
deadline, on the one record an applicant would produce to argue about it. The
conversion is now real (`stamp()` in `public/careers.js`), falling back to
saying UTC where a posting names no zone or names one the browser does not
know. `tests/browser/careers.spec.js` computes the expected Phoenix rendering
independently and asserts the page shows it, and asserts the page does *not*
show the UTC clock wearing the Phoenix label; it fails against the old code.

Three smaller things came out of the same read-the-page pass, all in
applicant-facing copy: the outstanding-items list was the server's last answer
rather than the live form, so it told somebody they still owed a name they had
just typed; the required-materials hint repeated "PDF, up to 8 MB" immediately
after the posting's own note said it; and "your application is not submitted
until you select Submit application" disappeared from the save state the
moment anybody started typing, which is when it matters. Dates across the
portal were raw ISO (`2026-11-14`) and are now written out, parsed field by
field rather than through `new Date()` so that a plain date does not shift a
day west of Greenwich.

## Verification

`npm run check` — 97 files parsed, 0 failed.

`npm test` — **752 passed, 0 failed**, including the two new suites:

- `tests/help.js` — 16 checks. Catalog validity against the process catalog and
  against the client's own `knownView()`; every article reachable; the ten
  articles the plan names present; the public projection carries candidate
  content only and links nowhere the reader cannot follow; `/api/public/help`
  needs no session and `/api/help` does.
- `tests/portal.js` — 63 checks, following the plan's verification table:
  publication and authority, the public/private boundary, ownership across two
  applicants, submission integrity (retry, duplicate, incomplete, closed
  mid-application, changed form), materials (wrong type, oversize, guessed id,
  path escape, unscanned), reconciliation, corrections, search lifecycle,
  expiry, and compatibility with the existing private questionnaire flow.

`npx playwright test` — green across all three projects (Chromium, WebKit and
an emulated phone). Fifteen new specs: eight for the guide (drawer preserves
typed work, Escape and focus return, unique trigger names, descriptions merged
rather than replaced, the catalog arriving without disturbing the page,
checklist hide and restore) and seven for the portal
(readable with no account, no console errors under the strict CSP, verify →
draft → return, review → submit → receipt, no-store and noindex on the
application page, 320px reflow, candidate help with no staff content).

The phone project is worth naming separately, because it is where the help
trigger regression above surfaced and it is the only project that renders the
tap-alternative at all. Baseline at commit `9290200`: 77 passed, 0 failed.
After this work: 97 passed, 0 failed.

Accessibility is scanned with axe (WCAG 2.1 AA) on the careers portal in both
themes and on the help screen and drawer, across Chromium, WebKit and an
emulated phone. Two real contrast failures were found that way and fixed: the
guide's section labels and index summaries were using `--ink-3`, which measures
4.33:1 on `--accent-tint` and is under the 4.5:1 floor. **Automated scanning
finds roughly a third of real accessibility problems**; nothing here establishes
that any of this is usable with a screen reader, which the plan asks for as a
manual pilot task.

**Not verified:** nothing here has been walked through against a deployed
build. The guide's articles carry `reviewed: 2026-09-19` and
`verifiedRelease: null`, and the help screen prints that state rather than
implying verification that has not happened. This machine runs Node 22; the
supported runtime is Node 24.

## What is not done

These are the plan's own dependencies, not omissions of scope. Each is a
decision with an owner outside this work.

| Dependency | State | What it blocks |
| --- | --- | --- |
| Mail provider | `server/mailer.js` is an interface with three transports and no provider. `none` is the default and tells every caller so. | Online applications entirely. Without it a posting publishes as a readable advertisement with a support contact and does not offer an application form. `deliver()` is the one function a provider replaces. |
| Volume for materials | Files are written under `DATA_DIR/application-files/` with generated keys and 0600 permissions, covered by the existing snapshot and restore. Working, not blocked. | Nothing for a pilot. The open question is size: render.yaml mounts **1 GB**, and the disk has to hold the materials times the retention window plus the store. `/api/ready` now reports both figures. |
| Malware scanning | An interface. `none` is the default: files are stored and are **not** available to reviewers. `accept-all` is a named pilot setting that records `scanned: false`. | Reviewers opening materials. This is deliberate: an unscanned file is not shown on the grounds that the reviewer is trusted, because the reviewer is not the risk. |
| Format policy | PDF only, with the posting's support contact as the accommodation route. | Nothing. Widening the list is one entry in `TYPES` plus its magic bytes. |
| Pilot, usability sessions, load test | Not run. | The release gates in plan §7. The pilot targets — five candidates, four completing without coaching — are unmet because no pilot has happened. |
| Screenshots in the guide | None. | Plan §2 asks for synthetic screenshots where an image helps. The articles are written to work without them. |

**Adding materials to the backup could fill the production disk.** Copying
application files into the snapshot was right — a restore that brought back the
records without the documents they name is not a restore. But nothing has ever
pruned snapshots: `ensureDaily` writes one dated directory per day, for ever.
That was survivable while a snapshot held a JSON store and some brochure
photography. With resumes in it, every day copies every resume again, and
render.yaml mounts 1 GB — a hundred applicants at 2 MB fills it inside a
fortnight, and the first symptom is saves failing.

`backup.pruneSnapshots` now keeps the most recent `SLATE_BACKUP_KEEP_DAYS`
(default 14) and runs only *after* a new snapshot has been written and
verified, so a sweep can never drop the last good copy before its replacement
exists. Only dated directories are considered; `pre-migration-*` safety copies
are never touched. `/api/ready` reports the live material bytes and the
snapshot bytes, so the disk filling is visible before it does.

## Security review

An adversarial review of the new public surface — the hand-rolled applicant
identity, the uploads, the public serializers, and the two new client files —
found two real defects. Both were mine, both are fixed, and both now have
tests that fail against the old code.

**A committee member was handed the raw posting record.** `decorate()` builds
the search payload with a spread and then strips the staff-only fields
(`history`, `adoptions`, `publication`); I added `posting` to the record and
did not add it to that list. `painted()` assigns a small, deliberate summary
in its place — but only inside `if (db.canEdit(...))`, so for anybody who
cannot edit the search the raw record survived from the spread: the *draft*
advertisement including a compensation line the client has not approved, and
the log naming who published or paused it and when. Invisible in the interface,
because the client never renders those fields, and therefore invisible to every
browser test. Reproduced directly against `decorate()` before fixing. One line:
`delete out.posting`, beside the three that were already there.

**A withdrawn advertisement came back on its own.** Posting visibility was
derived rather than stored: `isLive()` returns false while the search is frozen
or archived, so closing a search correctly took its posting off the internet.
Reopening the search — or restoring it from the archive — made `isLive()` true
again, and with `state` still `published` the posting was immediately live and
accepting applications from the public, with nobody having decided to publish
anything. The same two routes are careful to revoke candidate bearer links on
exactly this reasoning; the posting was missed.

Worse, the interface and the guide both promised the opposite — "Reopening the
search does not republish the posting; that is a separate, deliberate act" —
and my own test asserted the broken behaviour under a comment rationalising it.
The code, the test and the copy disagreed, and the copy was right.
`postings.suspendForLifecycle()` now writes the state down: the posting drops
to `closed` on reopen and on restore, so a followed link still answers and says
it is closed rather than 404-ing, and returning it to `published` is the search
manager's act under the `publishPosting` authority.

A third, smaller thing the review flagged and declined to call a vulnerability,
fixed anyway: the frozen-search exemption `//reopen/?$/` also matched the
application-correction route the portal added, so an application could be
reopened on a search that had already concluded. The pattern is now anchored on
the search's own reopen route.

Checked and cleared by the same review, with reasoning recorded there: path
traversal in the file store (both id and key patterns are fully anchored and
server-generated); XSS across `careers.js`, `help.js` and the `app.js` diff
(every interpolation escaped, no single-quoted attribute or URL-scheme context,
`rich()` and `paras()` both escape before inserting markup); the
Content-Disposition header; upload type validation; applicant authorization and
route ordering; the OTP and session construction; CSRF coverage of the new
cookie-authenticated writes; the public projections; and the backup changes.

## The three external dependencies, answered

**Mail.** Two different messages need sending, and they are not the same
problem. A *verification code* proves an address; a *receipt* tells somebody
their application arrived and carries its reference. Clerk can do the first —
it already sends email for its own flows, with a configured sender domain, and
passwordless email OTP is exactly the flow `server/applicant-access.js`
hand-rolls. It cannot do the second: a receipt is application content Clerk has
no concept of, and Clerk exposes no general transactional-send API to borrow.
So Clerk removes at most half the dependency.

Using Clerk for applicant identity is viable and would delete a few hundred
lines of credential handling. It carries three costs that are decisions rather
than engineering:

- **Every applicant becomes a Clerk user**, and Clerk bills per monthly active
  user. A public careers portal is built to attract strangers; the bill then
  tracks how well the advertising works.
- **The identity pools merge.** `resolveUser` in `server/auth.js` creates a
  Slate user row for any Clerk identity that signs in. Today an applicant has
  no Clerk identity at all, so two independent things keep them out of staff
  routes. With Clerk it becomes one — "no organization membership" — and every
  place that enumerates users needs to start excluding them.
- **It changes the Clerk instance's sign-up settings.** Production currently
  restricts workspace creation to `SLATE_WORKSPACE_FOUNDERS`; opening
  self-service sign-up for applicants is the change the plan warned against
  making silently.

Recommendation: a transactional provider (Resend, Postmark, SES) for both
messages, keeping applicant identity separate as built. One API key, one
function — `deliver()` in `server/mailer.js` — and the boundary stays two
walls thick. Revisit Clerk if the applicant volume turns out small and the MAU
cost is acceptable.

**Storage.** Not actually blocked: materials are written to the app's volume
with generated keys, 0600 permissions, per-request download authorization, and
they are in the snapshot and the restore. The open question is capacity. The
Render blueprint mounts 1 GB, shared with the store, the brochure photography
and the snapshots — and each daily snapshot copies every resume again. A
hundred applicants at 2 MB is 200 MB live and 2.8 GB across a fortnight of
snapshots. That is why retention is now bounded (below) and why `/api/ready`
reports both the live bytes and the snapshot bytes. The decision is: a bigger
volume, a shorter window, or object storage (S3/R2) behind
`server/application-files.js`.

**Scanner.** Malware scanning of applicant PDFs before a reviewer opens one.
The realistic options are a self-hosted ClamAV daemon — which wants 1–2 GB of
RAM for its signature database and does not fit beside the app on a Render
starter instance, so it means a second service — or an HTTP scanning API, which
is one more `fetch` in `store()` and no infrastructure. Until one exists the
default stands: files are stored and are not openable, and the record says so
rather than showing a download that opens an unscanned file.

## Before release

1. Choose and configure a mail provider; set sender domain, SPF and DKIM,
   bounce handling and resend limits. Test with controlled recipients.
2. Choose a scanner, or accept in writing that materials are unreadable.
3. Name the four owners the plan asks for: product/content, engineering,
   operations for email and storage, and pilot coordinator.
4. Have the content owner and a technical reviewer read the eighteen articles
   against a deployed build, then set `VERIFIED_RELEASE` in
   `content/help/catalog.js`.
5. Run the pilot: the guide with one administrator, one manager, one consultant
   and two committee members; the portal with five representative candidates
   including phone and keyboard users.
6. Rehearse a restore, and confirm application materials come back with the
   records that reference them.
7. Release the guide first. Enable public intake for one controlled posting.

Rollback: public intake is behind per-posting publication state, so pausing a
posting stops new applications and preserves submissions, receipts, materials
and staff review access. Reverting the code below schema 8 is refused by
`runMigrations`, which is what stops a rollback from serving a portal whose
records the previous release would drop.
