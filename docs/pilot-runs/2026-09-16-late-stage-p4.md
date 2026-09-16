# Late-stage P4 implementation record — 2026-09-16

What the engineering half of P4 of
[the late-stage pilot plan](../late-stage-pilot-plan.md) built, what building it
found, and what it does not establish.

**This is implementation evidence, not pilot approval, and not a release run.**
It was produced from a dirty working tree on Windows with Node `v22.18.0`; the
supported release runtime is Node `24.20.0`. No release candidate is frozen, so
nothing here is evidence for a later commit or container image. Every case in
[the pilot test plan](../pilot-test-plan.md) remains `NOT RUN` for the release.

It also runs ahead of its own dependency. P4 depends on P3, and P3 depends on the
P2 tabletop. Neither has happened: no consultant has walked this, and the search
owner has not accepted the authority matrix. What is built is an engineer's
reading of the §3 proposal, expressed so that revising it after P2 is an edit to
one table rather than a hunt through the routes.

## Release and environment

| Field | Value |
|---|---|
| Base commit | `612dded` |
| Dirty tree | Yes — not frozen, not reviewable as a release candidate |
| Node | v22.18.0 (below the v24 release floor) |
| Host | Windows 11 |
| Clerk | Fixture-signed sessions verified for real; no hosted instance |
| AI | `ANTHROPIC_API_KEY` empty; no paid call made |
| Data | Throwaway directories; synthetic records only |

## What was built

### One statement of who decides

`server/authority.js` holds the §3 matrix as a single table of actions and the
authority each needs (`staff`, `manager`, `orgAdmin`). The routes ask it, the
client is handed its answers on every read of a search as `you.may`, and
`tests/authority.js` pins every row. A screen cannot offer a control the route
will refuse, and changing a row changes both at once.

Enforced: advancement to and from finalist; score release and resealing,
including through the generic `PATCH /api/searches/:id` facts path; candidate
outcomes; reference certification; closing, cancelling and reopening; archiving,
including in bulk; archive restoration; and manager handover.

### The hole that made the rest advisory

Any consultant on the roster could take the account off its manager, silently
and without a reason. A consultant refused a closeout could simply take the
account and close the search. Handover now needs the outgoing manager, or a
workspace administrator supplying a written reason that is recorded on the file.

`tests/bughunt.js` previously asserted the old behaviour — "any consultant can
take an account rather than being stranded by it". That case is replaced, and the
concern behind it is answered by the administrator's reassignment rather than by
leaving the door open. Restoring an archived search also accepts an
administrator, because handover runs against a search on the book: without that,
a search whose manager had left the firm could never be restored by anybody.

### A defect the matrix work exposed

The guards being replaced read the legacy account-level `user.role` field. Only
the three seeded accounts (`abe`, `mike`, `team`) carry `role: 'consultant'`;
every account created by sign-up or invitation is `role: 'pending'`. So a real
consultant invited into a workspace **could not advance a candidate, release
scores, sign off staff work, send a semifinalist questionnaire, or delete a
search.** The test fixtures use the seeded emails, which is why it passed. This
would have surfaced as a blocked essential journey on the first real invitation.

Classification: P0 under the pilot test plan (blocked essential user journey).
Found by inspection during P4, fixed here, covered by `tests/authority.js` and by
`tests/browser/late-stage.spec.js`, which runs its second consultant as
`team@slate.local` acting through the interface.

### Certification now describes evidence that can change

A completion stamp said work was done and what it consisted of, but only new log
entries withdrew it. Removing a log entry, rewriting the working notes,
withdrawing a finalist's reference consent, and changing the finalist roster all
left a certification standing over a record it no longer described. All four now
withdraw it and write the reason to the activity feed.

### Defects found in the export, and fixed

B09 is the reason to build the browser journey, and running it found four:

1. **Questions and submission dates were missing from every export.** The record
   stores a response's timestamp as `at` and the frozen questionnaire under
   `survey`; the export read `submittedAt` and `questions`, which are not fields
   the record has. Answers shipped with neither the questions they answered nor
   the date they arrived — the thing that section exists to carry, and something
   [pilot-decisions.md](../pilot-decisions.md) already claimed was in it.
2. **The document inventory and contact log were absent.** Both have been on the
   candidate since DEP-08; the export still described them as future work,
   shipped neither, and listed them under "known gaps".
3. **Outcomes and the lifecycle never appeared in the readable report.** They
   were in the JSON bundle. The plain-text report — the copy a records officer is
   actually handed — said who applied and what they answered, and nothing about
   what was decided, by whom, or on what basis.
4. **Superseded questionnaire responses were not on the candidate.** A reopened
   questionnaire's original is kept in the search history, but a reader
   comparing the file against a candidate would see only the latest answers, so
   a correction read as an original.

The sealed-score declaration was correct throughout and is unchanged.

### Why the first of those was invisible

`tests/export.js` already had the case — "candidate answers keep the questions
they were asked" — and it was passing. It was doing neither of the things its
name claims:

- Its fixture never put a questionnaire on the search, so the candidate's link
  opened nothing, and the case hit `if (!page.survey1) return;` and reported a
  pass. An early return in a P0 assertion is a skip that does not appear in the
  skip count.
- The submission it would have made sent `version` where the route reads
  `surveyVersion`, so even with a questionnaire present it would have been
  refused with a reload prompt rather than asserting anything.

Both are fixed: the fixture issues a real questionnaire, the field name matches
the route, and the absent questionnaire is now an assertion failure rather than a
quiet return. This is worth carrying into the wider evidence review — the
project's headline check counts are only as good as the cases behind them, and
this one had been green while proving nothing.

### The export had no control in the interface

`GET /api/searches/:id/export` existed with nothing anywhere in the application
that reached it. B09 asks for a download through the UI; there was none. Closeout
now offers the readable report and the data bundle, gated on the same matrix,
with the sealed state stated before the download rather than discovered in the
file.

## Automated results

Run on this host, on the tree described above. Node 22, so none of it is A01
evidence for the release.

| Command | Result | Notes |
|---|---|---|
| `npm run check` | PASS | 77 files parsed, 0 failed |
| `npm test` | PASS | 603 checks passed, 0 failed. 566 before this work; the new `tests/authority.js` contributes 27, the revised handover and export cases the rest |
| `npm run test:browser` | PASS with explained skips | 252 tests: 226 passed, 26 project-specific skips, 0 failed, 7.7 minutes |
| Container job | NOT RUN | Needs the release image and Node 24 CI |
| `npm audit`, clean install | NOT RUN | Needs Node 24 CI on a frozen release |
| Hosted load | NOT RUN | Needs a named staging URL and authorization |
| `npm run print:samples` | NOT RUN | No print surface changed except the closeout export panel, which carries no print output |

The skip count is project-specific: several viewport and touch-target cases run
in one project only, the connected late-stage journeys run once in desktop
Chrome, and desktop WebKit blocks service workers so PWA and offline behaviour
is Chromium-only. That is a limitation of the harness, not three-browser
coverage.

One existing case had to be marked slow rather than changed: the record-keeping
axe scan covers five populated surfaces in two themes, and adding the export
panel to closeout pushed its WebKit run past the 30-second default. It is a
duration, not a violation — trimming a surface to save seconds would leave a
record-keeping screen unscanned.

## What this does not establish

- **B07–B09 acceptance.** `tests/browser/late-stage.spec.js` exercises the
  connected journey; the cases are accepted by the P2 rehearsal with a practicing
  consultant, and by the final run on a frozen release.
- **The matrix itself.** The search owner has not accepted or revised §3. Two
  rows already differ from the proposal as written, and are flagged there.
- **Anything hosted.** No deployed identity, persistence, restore, rollback,
  alert or load evidence. Real Clerk sign-in, invitation, role change and
  revocation remain unexercised.
- **Anything human.** No device, screen-reader, print, or unassisted-user
  session. No records-custodian review of an export against a known fixture,
  which is what would confirm the export fixes above are sufficient rather than
  merely present.
- **The release.** The tree is dirty and the runtime is below the supported
  floor. A01 is established by Node 24 CI on a frozen candidate, not here.

## Follow-ups for the tabletop

- Whether a shared firm account may hold a search manager place at all. It
  satisfies `manager` today; the export labels its actions as taken by a firm
  rather than a person, which is a strange pairing for a decision the county
  will be shown.
- Whether recording a candidate's withdrawal needs a delegated path. It is
  manager-only today, and a withdrawal is time-sensitive and not really the
  firm's decision to make.
- Whether an administrator's emergency reassignment should notify the outgoing
  manager. It is recorded on the file; nothing tells them.
