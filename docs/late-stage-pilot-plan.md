# Late-stage tabletop pilot and live-readiness plan

Follow-up: [implementation review fixes](pilot-runs/2026-09-16-late-stage-review-fixes.md)
address export privacy, archive access, reassignment and connected browser
coverage. These are local engineering results; the acceptance gates remain open.

Prepared 2026-09-16. **Status: the engineering half of P4 is built ahead of the
tabletop; every human, hosted and organizational package remains pending.**
See [the P4 implementation record](pilot-runs/2026-09-16-late-stage-p4.md) for
what was built, what it found, and what it does not establish. Execution and
approval of the plan itself are unchanged: nothing below has been rehearsed with
a consultant, and no gate has been passed.

Start with a synthetic Executive search and an actual search consultant. Use
three semifinalists to expose mistakes in the workflow and authority model
before onboarding a real county or accepting real candidate data. Complete
Steps 13–19, outcomes, export, closure, reopening, archive restoration, and an
independent backup restore. Fix what the rehearsal reveals, then repeat the
journey on the release intended for live use.

This is the execution sequence for [the pilot test plan](pilot-test-plan.md),
not a replacement for its A01–E05 cases or the three
[release gates](release-checklist.md). All P0 controls must have passing
evidence before live data is allowed. The early tabletop is permitted to find
failures; it does not confer readiness.

## 1. Starting evidence and boundaries

- The user reports that the tested candidate commit passed full branch CI.
  Attach that run and its exact SHA to the execution record. Do not repeat
  completed checks solely because a duplicate workflow exists.
- The [duplicate main-branch run](https://github.com/dankestbofum/slate-executive-search/actions/runs/35135711857)
  was reported running. Its current result could not be retrieved during
  planning. Verify its conclusion and SHA before release sign-off; a result
  for a different commit is not evidence for the deployed commit.
- Repository HEAD during planning is `612dded`. Match the tested SHA, deploy
  SHA, runtime, and image identity explicitly. Render remains unverified.
- Planning found consultant-level guards on candidate stage changes, score
  release, outcomes, reference completion, and close/reopen in `server/index.js`,
  with manager controls covering only roster and intake work. Those guards read
  the legacy account-level `user.role` field, which only the three seeded
  accounts carry: a consultant invited into a workspace today was refused by
  them. That is now replaced by `server/authority.js`, which states the §3 matrix
  in one table that the routes, the client and `tests/authority.js` all read.
  **The values in that table remain proposals** until the search owner accepts or
  revises them after P2; revising one is an edit to §3 and to that table.
- `tests/browser/pilot-journey.spec.js` connects an initial candidate response
  and two reviewers, but releases scores through an API request and ends before
  late-stage work. `tests/browser/late-stage.spec.js` now carries the connected
  B07–B09 journey through the browser. It is coverage, not acceptance: the
  rehearsal in P2 is with real people and is what B07–B09 acceptance rests on.

Use synthetic records, controlled test accounts, and a clearly identified
environment. No invitations, deployment changes, paid provider calls, or
restore mutations are performed by this planning task. During execution,
restore and fault drills use disposable storage, never an active pilot volume.

## 2. Work sequence, owners, and deliverables

Assign actual names and calendar dates at kickoff. Effort below is a planning
allowance, not a delivery promise; defect repair and county review can extend it.

| Work package | Accountable role | Dependency | Deliverable / exit condition | Allowance |
|---|---|---|---|---|
| P1. Establish the rehearsal | App owner | None | Named participants, synthetic environment, release/run IDs, initial authority proposal, session booked | Half day |
| P2. Run the exploratory tabletop | Practicing search consultant | P1 | One connected three-semifinalist search through the script below; evidence, workflow corrections, and defects recorded | Half day plus debrief |
| P3. Confirm authority and write the operating procedure | Search owner | P2; draft before P2 | Accepted action matrix and tested external-work procedure; engineer identifies enforcement gaps | 1–2 days plus review |
| P4. Implement gaps and connected browser coverage | Engineer | P3 | B07–B09 journeys pass, permission regressions pass, changed workflows retested; exact candidate frozen | Estimate after P2 |

P2 has a facilitation script at [TABLETOP-SCRIPT.md](pilot-runs/TABLETOP-SCRIPT.md)
and a seeder, `npm run seed:tabletop`, which stands the synthetic environment up
to the start of Step 13 and nothing beyond it. Seeding removes an hour of setup
from the consultant's time and makes two sessions comparable; the manifest it
prints records what was seeded and, deliberately, what was not. The session
itself still needs the named people in P1.

The P3 procedure is drafted at [search-operating-procedure.md](search-operating-procedure.md),
with owners and systems left explicitly unassigned; the enforcement half of P4
is built and recorded in [the P4 record](pilot-runs/2026-09-16-late-stage-p4.md).
None of them closes its package. P3 closes when the search owner accepts the matrix
and a second person has walked the procedure without coaching; P4 closes on a
frozen release candidate with the full regression run on the release runtime.
| P5. Resolve organizational decisions | App owner coordinates named decision owners | Start at P1; resolve before onboarding | Every applicable register item decided with owner, date, rationale, and evidence; obligations implemented | Lead time set by owners |
| P6. Verify hosted operations | Primary and backup operators | P4; hosting/access decisions | Deployed identity, persistence, restore, rollback, alert and hosted-load evidence | 1–2 days plus fixes |
| P7. Complete human testing and final rehearsal | Search owner and accessibility tester | P3–P4; stable hosted environment | Device, screen-reader, print, unassisted-user results; actual consultant completes final connected search | 1–2 days plus fixes |
| P8. Decide onboarding and live use | App owner with independent reviewer | P5–P7 and all required A01–E05 evidence | Release-specific Gate 1, Gate 2, and Gate 3 decisions recorded | Half day |

P5 can proceed while engineering and testing run. Hosted and human sessions
can overlap once the candidate is stable. A changed permission or workflow
requires the affected journeys to be repeated; final approval also requires
full regression evidence on the exact release.

## 3. Proposed authority matrix

Use the assigned **search manager**, distinct from a Clerk organization role.
Recommend named individual accounts for material decisions. Clerk membership
and the search assignment must both support access. These are proposals for
the search owner to accept or revise after observing P2.

| Action | Proposed decision authority | Consultant preparation / required evidence |
|---|---|---|
| Advance to finalist or reverse that advancement | Search manager | Consultant prepares recommendation; retain actor, time, and rationale |
| Release or reseal scores | Search manager | Reviewers save their own scores; record release state and criteria revision; resealing cannot recall prior exports |
| Record or correct hired, withdrawn, or not-selected outcomes | Search manager | Consultant logs source communication; preserve original decision, correction, rationale, and source reference; this records the appointing body's decision, not substitute hiring authority |
| Certify or reopen reference completion | Search manager | Consultants record consent and permitted reference work; all current finalists need consent and evidence; evidence changes invalidate certification |
| Close or cancel a search | Search manager | Consultant prepares closeout inventory; require reason, outcome review, export check, and candidate-link revocation |
| Reopen a search | Search manager | Require reason; old revoked links remain invalid; issuing a new link is a separate action |
| Archive and restore an archived search | Search manager, proposed; restore also accepts a workspace administrator | Preserve lifecycle and decision history; restoration grants no new membership or candidate access |
| Export permitted records | Authorized consultant, proposed | Records custodian reviews recipient and completeness; sealed material and credentials remain excluded |
| Emergency manager handover | Workspace administrator, proposed | Explicit reassignment with reason and actor; no silent bypass of search-manager decisions |

Resolve whether recording a candidate's withdrawal needs a delegated,
time-sensitive path and who handles manager absence. Do not leave such
exceptions implicit. Confirm the distinction between staff evidence entry,
completion certification, and official county approval.

The matrix above is now stated once, in `server/authority.js`, and enforced from
there: the API routes ask it, `/api/searches/:id` returns its answers to the
browser as `you.may` so the controls drawn and the calls accepted cannot drift,
and `tests/authority.js` pins each row. The generic `PATCH /api/searches/:id`
path is covered — sending `released` beside an ordinary fact is refused and
writes neither — as are bulk archiving, archive restoration and the manager
handover. Handover was the hole that made the rest advisory: any consultant on
the roster could take the account and then make every decision the matrix
reserves. It now needs the outgoing manager, or a workspace administrator with a
written reason on the file.

Two rows are not enforced exactly as written above, and the search owner should
confirm or revise both at P3. **Export** is enforced at the `staff` level rather
than "authorized consultant": Slate has no separate authorization for it, and
the records-custodian review in §5 is procedural rather than something the
application can check. **Restoring an archived search** also accepts a workspace
administrator, because handover runs against a search on the book: without that
fallback, a search whose manager had left the firm could never be restored by
anybody.

P4 must enforce the accepted matrix in API routes and UI controls, including
generic PATCH paths and alternate history/archive restoration paths. Test the
manager, ordinary consultant, non-manager administrator, assigned committee,
unassigned user, disabled/removed member, and another firm's user. Verify
denied actions leave records unchanged. Repeat after handover and mid-session
role revocation; inspect responses and exports as well as visible controls.

## 4. Connected tabletop script

Participants: an actual practicing consultant as manager, a second consultant,
two committee reviewers, candidate role-players, a records reviewer, and an
observer. Operators join the recovery segment. Use separate browser sessions
for each identity and anonymous candidate sessions. The initial tabletop may
use fixture identity; final hosted acceptance must use real Clerk controls.

Prepare one synthetic Executive county search with approved synthetic upstream
facts, profile, interview guide, original questionnaire/answers, semifinalist
survey, and representative brochure media. Record which prerequisites were
seeded. Start with three semifinalists: A ultimately hired, B withdrawn, and C
not selected. A and C become finalists so references exercise multiple people.
Include a second synthetic firm for isolation checks.

Perform all actions being accepted through the browser. APIs may prepare
upstream fixtures and independently verify persisted results; they may not
perform the user action whose UI handoff is under test.

| Segment | Participant actions and deliberate failure | Evidence / pass condition |
|---|---|---|
| Step 13: semifinalist survey | Open links for A, B, C; deliver through the controlled manual process; save/reload drafts and submit; replace one link and retry the old one | Opening a survey never claims delivery; communications match actual sends; original question versions and receipts survive reload; replaced link fails |
| Step 14 and B07: video and sourcing | Record sourcing history, schedule externally, conduct simulated interviews, record staff work, attempt empty completion | Evidence identifies what happened and who did it; empty work cannot be certified; committee cannot read restricted work |
| Scoring and B09 baseline | Two reviewers score independently; export while sealed; ordinary consultant attempts release, then authorized manager releases in UI | Private scoring stays private; permitted export declares withheld scores; unauthorized change fails; released view and export match the accepted policy |
| Step 15: finalists | Consultant recommends A and C; manager advances them; B withdraws through the accepted outcome process | Authority and rationale enforced; B's link no longer allows work; decision author and history retained |
| Step 16: finalist process | Prepare interview/assessment plan, perform external scheduling and simulated panel work | Approved plan, calendar details, accommodations, and communication record agree |
| Step 17 and B07: references | Attempt reference work before finalist stage/consent; then record consent for A and C, reference contacts and external note locations; certify; change/delete evidence and withdraw consent | Preconditions enforced; private content withheld; completion invalidated by changed supporting evidence; incomplete current-finalist coverage cannot be certified |
| Steps 18–19 | Prepare model employment contract and first-year evaluation process; route mock counsel review; record synthetic signed-agreement inventory | Draft, reviewed version, and signed agreement remain distinguishable; mock legal review is labeled; evaluation process has an owner and handoff date |
| Outcomes and B08 | Record A hired, C not selected, and B withdrawn; correct one deliberate erroneous outcome with a reason | All three outcomes represented; original and corrected decisions survive; prohibited work and links fail |
| Export and B09 | Download through UI before release, after release, and after closeout; records reviewer compares each to the known fixture and external inventory | Original questions/answers, decisions/authors, permitted scores, staff work, inventory and applicable photos accounted for; no credentials, bearer links or foreign-firm data |
| Lifecycle and B08 | Close; retry old links and writes; reopen with a reason; retry old links; close again, archive, and restore from archive | Lifecycle/history survive; frozen work is rejected; reopening/restoration does not revive revoked links or grant access |
| Independent recovery | Backup operator retrieves an off-volume copy and restores to a separate instance; manager opens recovered search | Verify answers/questions, score revisions, history, outcomes, lifecycle, inventory and images; current Clerk revocations still apply; measure recovery point/time |

Archive restoration and backup restoration are separate checks. If an older
backup predates a link revocation, document and test how the recovery procedure
reconciles revocations before exposing the recovered service. Do not assume a
historical snapshot contains decisions made after it was taken.

Pause for observations after each handoff. Record hesitation, missing ownership,
duplicate entry, inaccessible controls, authority surprises, and every piece
of work that leaves Slate. A developer-assisted repair is a defect, not a
successful unassisted task. The final acceptance run repeats this journey
after fixes, including the consultant's contract and records handoffs.

## 5. Operating procedure to produce in P3

Write `docs/search-operating-procedure.md` with named primary/backup owners,
approved systems, access rules, required record fields, timing, failure paths,
and closeout reconciliation. Walk it with the consultant during P2, revise it,
then have another participant use it without coaching during P7.

| Work outside Slate | Procedure must specify | Rehearsal acceptance |
|---|---|---|
| Email delivery | Sender, approved mailbox/templates, recipient check, link handling, actual sent timestamp, delivery/bounce tracking, retry and escalation | Controlled recipient receives correct link; failed delivery is distinguished from opening the survey; communication logged accurately |
| Scheduling | Calendar owner, timezone, panel availability, video/location details, accommodation handling, reminders and rescheduling | Candidate and panel receive matching details; changed appointment reconciled with Slate's record |
| Resume storage | Approved repository, submission method, stable document identifier, versions, access and receipt confirmation | Authorized reviewer retrieves the correct version; inventory points to it without embedding a sharing credential |
| Reference-note storage | Consent evidence, permitted contacts, restricted repository, note author/date, minimal Slate summary, access review | Authorized consultant retrieves notes; committee cannot; consent withdrawal and evidence changes trigger the agreed follow-up |
| Counsel review | Review trigger, draft/version handoff, reviewer, findings, approval record and unresolved-issue escalation | Reviewer can distinguish unreviewed model language from the approved version; unresolved issues prevent final agreement handoff |
| Signed agreements | Signatory authority confirmed by owner/counsel, signature process, final executed repository/version, receipt and inventory | Mock executed file matches reviewed terms; draft is not represented as executed; custodian can retrieve it at closeout |

Include records requests, legal holds, retention/disposal approval, account
offboarding, support/accommodation escalation, incident notification, and the
handoff from hiring to first-year evaluation. Keep legal determinations with
the decision owners; the procedure must implement their approved decisions.

## 6. Decision closure in P5

Use [pilot-decisions.md](pilot-decisions.md) as the single decision register.
For each item add the named approver, decision date, rationale, supporting
artifact, implementation owner, and verification link. Keep proposals open
until accepted. Assign target dates at kickoff and escalate missed dates to
the app owner. A decision requiring code or infrastructure is not satisfied
by a signature alone.

| Register items | Required result / decision owners |
|---|---|
| 1.1–1.5: engagement | Search owner, HR and counsel confirm county, role, appointing authority, package and calendar before onboarding; synthetic assumptions remain labeled |
| 2.1–2.6 and 3.1: records | Records officer/counsel assign custodian, classification, retention, hold/disclosure and deliberation procedures; decide whether tamper-evident storage is required and implement it before launch if required |
| 4.1–4.5: access | Search owner/HR/counsel agree record audiences and action matrix; IT decides MFA/SSO; app owner confirms actual Clerk session policy; settle firm-wide versus search-specific consultant access and named-account policy |
| 5.1–5.4: AI | Counsel/IT approve processor and permitted data; owner sets spending cap and overrun authority; counsel approves notice; validate enabled paths within scope |
| 6.1–6.5: hosting/recovery | IT/procurement approve vendor/region; owner names independent backup account and alternate restorer; agree measurable recovery objectives |
| 7.1–7.5: candidate privacy/support | HR/operations/counsel approve staffed contact/hours, resume intake, privacy notice, advisory/enforced dates and manual communication ownership |
| 8.1–8.2: accessibility | Accessibility lead/counsel confirm applicable requirements and any accepted alternatives; verify the actual alternative path |
| 9.1–9.5: operations | Name primary/backup operator, alert/escalation recipient, incident owner and county notification path, and maintenance window |

Reconcile stale or conflicting statements while closing decisions: shared
firm sign-in language versus current Clerk identity; proposed session length
versus actual configuration; and “nothing deleted automatically” versus the
documented 14-day candidate-draft expiry. Determine which records and drafts
must be preserved under the accepted retention/hold policy. Also resolve the
release checklist's public readiness-count question. Do not copy historical
test counts or gate checkmarks into a new release record as fresh evidence.

## 7. Hosted and human verification

P6 follows [operations.md](operations.md) and E01–E05. Capture actual Render
configuration, not only `render.yaml`: service URL, deployed SHA/image/runtime,
region, single writer, attached persistent disk, mount and effective `DATA_DIR`.
The blueprint currently specifies `/data/clean-owner` beneath `/data`; verify
the running service and recovery tools use the intended store.

Save a known populated search and media, then restart and redeploy. Compare
record fields and media, not just file existence. Configure the independent
backup destination and platform backups, verify copy freshness, and have the
backup operator restore without relying on the primary hosting account.
Measure snapshot age and elapsed recovery against the owner-approved targets
(currently proposed as one hour and four hours). Exercise rollback using the
matching image and pre-upgrade snapshot; never start an older image on an
incompatible newer store.

Trigger a controlled failure/overdue-backup alert in disposable staging and
prove delivery, acknowledgement, escalation, and recovery. Verify hosted Clerk
instance, authorized origin, organization selection, consultant/committee
roles, founder allowlist, invitations/acceptance, manager handover, revocation,
and directory latency. Repeat the authority checks with real sessions.

Use the existing `npm run test:hosted-load` harness with its explicit staging
acknowledgement, unique synthetic run ID and protected session-token inputs.
Exercise 100 candidates, 15 distinct staff/committee accounts and 20 sessions;
confirm role coverage rather than treating repeated tokens as distinct users.
Use the planned 5-minute warmup, 15-minute load and 60-minute soak, including
photos and a scheduled backup. Pass requires ordinary read/save p95 below
1 second, no lost acknowledged writes or unexpected errors, recoverable expected
conflicts, and bounded memory/disk use. Supplement any missing workload coverage;
retain sanitized measurements. Run enabled AI paths under the approved budget.

P7 covers D01–D04 on physical iPhone Safari and Android Chrome; NVDA with
Chrome/Edge and VoiceOver with Safari; keyboard, zoom, errors, dialogs, and
slow/disconnected recovery. Include real Clerk sign-in/invitation controls,
candidate draft/receipt, committee scoring, and manager closeout. Record device,
OS, browser, assistive technology and versions. Inspect all print pages and
representative paper output.

Give an actual consultant, representative committee user, and candidate tester
role-specific tasks without live coaching. Log completion, time, errors and
assistance; each essential task must finish without administrator repair.
Support and accommodation contact must be findable and receive a controlled
test request. Fix and retest inaccessible essential paths before sign-off.

## 8. Evidence and go/no-go

Create a release-specific run from [the evidence template](pilot-runs/TEMPLATE.md).
Map all applicable A01–E05 cases plus each authority decision and external-work
handoff to a named tester, expected/actual result, timestamp, evidence, defect,
and retest. Keep tokens, candidate links and unsanitized traces out of Git.

Required packet: accepted authority matrix; consultant tabletop/debrief and
final-run record; operating procedure; B07–B09 browser reports; exact-release
CI/image evidence; decided register; Render configuration and persistence
checks; independent restore/rollback and alert drills; hosted measurements;
device/screen-reader/unassisted-user/print results; second-person review.

Gate 1 requires technical evidence, Gate 2 requires resolved county onboarding
decisions, and Gate 3 requires both plus accepted rehearsal and operational
readiness. No P0 failure, skip, missing evidence, or unresolved P0 policy may be
waived for this plan. P1 workarounds require a named accepting owner, consequence,
compensating measure and expiry, and cannot waive county obligations. The owner
approves the specific release and onboarding action explicitly.

After approval, start within the agreed one-firm/one-search envelope. Operators
check service health, backups, failed submissions and support daily. Pause new
intake on unauthorized access/disclosure, lost acknowledged data, a blocked
essential candidate path, or loss of verified recovery protection. Follow the
incident procedure and retest affected gates before resuming or expanding.
