# Pilot-readiness test plan

Prepared 2026-09-16 from the working tree at `3be3db1`, including existing uncommitted changes.

**Status: plan prepared; execution and pilot approval pending.** This review inspected application code, test harnesses, CI configuration, and the handoff documents. It did not run the suites, exercise the UI, contact external services, or establish that this release passes. Existing reported results are historical evidence only.

## 1. Scope and success criteria

Planning assumption: one firm, one active search, up to 100 synthetic candidates, 15 staff/committee accounts, and 20 concurrent user sessions. This follows the existing deployment handoff and must be confirmed before a live pilot. Use an Executive search for the complete rehearsal, plus small Basic and Enhanced searches for package checks. Include both county and municipal setup. A second synthetic firm is required to test isolation even if only one firm will pilot.

The aim is to prove that users can complete the search process, private information stays within its intended audience, saved work survives failures, and an operator can recover the service. Passing automated tests alone does not establish pilot readiness.

- **P0:** Access, privacy, record integrity, recovery, or a blocked essential user journey. Any failure or missing evidence blocks live candidate use.
- **P1:** Required pilot functionality, usability, performance, or output quality. Pass before launch unless the owner accepts a documented workaround with an owner and expiry. A workaround cannot waive a county obligation.
- **P2:** Cosmetic or optional behavior outside the agreed pilot scope. Record and schedule; do not silently ignore.

Use the existing three gates in [release-checklist.md](release-checklist.md): technical staging ready, county onboarding ready, and live pilot ready. This plan supplies test evidence for those gates; it does not replace the decisions in [pilot-decisions.md](pilot-decisions.md).

## 2. What exists and what needs proving

| Area | Existing foundation | Remaining evidence or extension |
|---|---|---|
| Server/API | `tests/run.js` runs 16 suites covering roles, organizations, candidates, disposition, security, storage, recovery, export, monitoring, AI, research, and integrity | Rerun the current tree on the release runtime; add only missing behavioral assertions |
| Browser | 11 spec files, configured for desktop Chromium, desktop WebKit, and mobile Chromium emulation | Complete connected journeys, failure recovery, two-user conflicts, and real identity components |
| Identity | Real verification of fixture-signed JWTs; stubbed Clerk browser/directory behavior | Hosted sign-in, invitation delivery/acceptance, role changes, revocation, and directory latency |
| AI and research | Stubbed provider failures, budgets, job lifecycle, cancellation, duplicate requests, restart and partial-result handling | Bounded hosted drafting/research, real cost/latency, source review, standard/premium paths if enabled |
| Storage and container | Single-writer and recovery tests; CI image boot, shutdown, restart | Representative populated-store persistence, deployed disk behavior, independent restore, rollback |
| Accessibility and print | Axe, keyboard/reflow checks, print sample generator | Real screen reader, physical phones, actual Clerk controls, visual/paper review |
| Performance | `tests/load.js` creates its own local server and measures a synthetic envelope | Hosted harness and thresholds; the existing script cannot be pointed at staging merely by setting `SLATE_URL` |

[test-evidence.md](test-evidence.md) reports 566 server checks and 234 browser checks as of September 14. Capture actual passed, failed, and skipped counts in the new run; do not copy these numbers as a fresh result. Project-specific skips are present and need a reason, not a blanket claim of three-browser coverage.

Known review findings to resolve in the first work package:

1. Local Node is `v22.18.0`; the documented release and CI target is Node `24.20.0`. Execute readiness checks with the release runtime.
2. The working tree contains application changes and new research files. Freeze a reviewable candidate before collecting final evidence; a commit ID alone does not identify the current dirty tree.
3. `release-checklist.md` still references PIN/credential audits and first-boot credentials. Current authentication is Clerk-based, `scripts/accounts.js` exposes list/rename/disable/enable, and CI explicitly boots without PIN configuration. Reconcile obsolete checks against current behavior.
4. Browser WebKit blocks service workers; its passing result cannot certify Safari/PWA offline behavior. Clerk UI is stubbed and parts are excluded from axe checks.
5. CI's persistence step checks that the store still exists and prints hashes. Add an assertion for representative saved records and media surviving restart; file existence alone is insufficient.
6. Print notes document truncated editor values and remaining row actions. Reproduce against the release candidate and classify by whether they affect pilot deliverables.
7. `server/steps.js` includes “AI candidate screening” in package service text, while the pilot decisions exclude automated candidate acceptance, rejection, ranking, and sensitive-trait inference. Resolve the advertised scope and test the agreed wording/behavior before sign-off.

## 3. Fixtures and execution rules

Create reproducible fixtures through supported APIs. Use unique run IDs and synthetic names; include long names, accented characters, punctuation, long answers, missing optional facts, boundary dates, duplicate emails, and invalid inputs.

| Fixture | Purpose |
|---|---|
| Firm A | Administrator; managing consultant; second consultant; two assigned committee members; unassigned member; unsupported role; disabled account |
| Firm B | Independent administrator, search, candidates, media and archives; one account with a different role in each firm |
| Main search | Executive county search with verified and unverified facts, committee intake, all included artifacts, candidates at each stage, reference consent and outcomes |
| Package searches | Basic municipal and Enhanced county searches; an archived and a closed search |
| Candidate links | Active initial and semifinalist questionnaires, draft, submitted receipt, replaced/revoked links, withdrawn candidate and closed search |
| Full-size store | 100 candidates and 15 accounts, representative history and photos; generated separately from the small deterministic fixtures |

Local automated work uses temporary stores, fixture identity, and an empty model key. Keep service-worker/network interception limitations explicit. Never run `test:live`, audit capture scripts, or a hosted mutation harness against an unspecified server: those may create or change records.

Hosted execution requires an identified staging URL, isolated persistent storage, real Clerk configuration, controlled test recipients, and an agreed AI budget. Sending invitations, billed calls, deployments, or recovery mutations are later execution tasks, not actions performed by this planning document. Fault injection and restore drills use disposable environments, never the active pilot volume.

## 4. Test series

In the tables below, **extend** means inspect the named existing tests first and add the missing assertion or journey. Existing coverage is a starting point, not an instruction to duplicate tests. Every case starts `NOT RUN` for the chosen release. Owner labels identify responsibility; assign actual names in the execution record.

### Series A — Build, identity and privacy

Owner: engineer; hosted identity checks also need the workspace administrator.

| ID / priority | Procedure | Pass condition | Method and starting point |
|---|---|---|---|
| A01 / P0 | Install from lockfile on the release runtime; run syntax, API, browser, dependency and container checks | All required checks pass, failures exit nonzero, skips explained; exact release and image recorded; dependency findings triaged | Existing CI and scripts; record fresh results |
| A02 / P0 | Sign up/sign in with controlled real accounts; accept consultant and committee invitations; reload, sign out, expire session; try unsupported role and unassigned member | Intended workspace/role only; sign-out and expired sessions require identity; no accidental authority from onboarding choices | Existing auth/onboarding suites plus hosted manual execution |
| A03 / P0 | Change/demote/remove membership during an open session; disable an account; attempt removal of last administrator and current search manager; simulate directory outage | Revocation applies on next protected request; protected reads and writes fail closed on outage; last administrator and manager handover rules hold | Extend `tests/organizations.js`, `tests/auth.js`; hosted role-change rehearsal |
| A04 / P0 | Firm A requests Firm B's IDs through search, candidate, archive, export, media and research-job routes; switch firms in two tabs while requests are delayed | No foreign content, token, count from scoped listings, or stale response rendered; queued work cannot write after authority is lost | Existing organization/research suites; extend browser organization cases |
| A05 / P0 | Attempt manager actions as ordinary consultant/committee member; inspect response bodies, history and export before/after score release | Search roles enforced by API; sealed scores, private staff records, candidate bearer links and credentials withheld from unauthorized viewers | Existing roles, integrity, export and security suites |
| A06 / P0 | Submit HTML/script strings and malformed/oversized input; exercise CSRF, framing, SSRF/redirects and rate limits; inspect logs and cache | No script execution, internal-network fetch or unauthorized mutation; bounded rejection; no secret/private response in logs or service-worker cache | Existing security/policy suites; extend rendered-input and cache assertions |

### Series B — The complete search workflow

Owner: engineer for regression coverage; search owner and a committee participant for rehearsal.

| ID / priority | Procedure | Pass condition | Method and starting point |
|---|---|---|---|
| B01 / P1 | Create county and municipal searches; select each package; edit facts; reload; change package and open excluded routes directly | Correct type, facts and package persist; excluded operations refused; existing records retained consistently; required facts remain unverified without source evidence | `tests/jurisdictions.js`, baseline suite, browser recordkeeping/recruiting; extend package transition cases |
| B02 / P0 | Add committee rows including duplicates/invalid addresses; hand over management; open intake; submit separate private responses; close and adopt consensus | Partial errors retain only failed rows; invitations are described honestly; manager boundaries hold; private inputs stay private; published/adopted criteria match the approved revision | Existing roster/roles tests; add connected browser intake/adoption journey |
| B03 / P1 | Prepare/review the profile, community material, surveys, guide, ad plan, brochure and ads as included; change salary/profile/source facts afterward | Manual editing works; stale approvals are visibly invalidated; excluded package steps stay excluded; approved output reflects the intended version | Existing integrity/workspace tests; extend artifact review journey |
| B04 / P0 | Open initial questionnaire on an anonymous phone session; omit required answers; save draft; reload; submit; drop submission response after server commit and retry | Validation is actionable; saved draft reloads; one response is recorded against original questions; retry produces the same receipt without duplicate or overwritten answers | Existing candidates/integrity/journeys; extend browser network-loss case |
| B05 / P0 | Publish revised questions while a candidate has an old form open; open semifinalist survey; replace/revoke link; reopen a submitted response; test displayed deadline/timezone | Stale version cannot be silently submitted as current; correction is explicit and preserves history; invalid links fail; advisory dates are not described as enforced; opening survey never implies email delivery | Existing candidates/integrity suites; extend browser candidate lifecycle |
| B06 / P0 | Two reviewers score and write notes; attempt invalid scores; release results; revise criteria and reassess | Only valid scores accepted; sealed/released views are correct; historical scores retain original meaning; revision changes never silently reuse scores against changed criteria | Existing integrity/roles suites; extend two-context browser scoring |
| B07 / P0 | Record sourcing and video work; attempt references without consent; record consent and reference work; complete then edit/delete evidence | Consent and stage requirements enforced; committee cannot read restricted logs; changed evidence reopens completion; empty work cannot be certified complete | Existing baseline/integrity tests; extend browser staff-work path |
| B08 / P0 | Advance finalists; record hired, withdrawn and not-selected outcomes; correct a decision; close, reopen, archive and restore search | Required rationale is enforced; decision history survives correction; closed/withdrawn paths refuse unauthorized further work; old links stay revoked after reopening | Existing disposition/recordkeeping suites; extend end-to-end closeout |
| B09 / P0 | Export before and after release/closeout; compare with known fixture, including original questions, decision authors, document inventory and photos where applicable | Complete permitted record; sealed material withheld as declared; no secrets or other firm's data; external documents explicitly listed as external | Existing export suite plus records custodian review |

### Series C — Failures, concurrency and AI

Owner: engineer; paid hosted checks require an identified budget owner.

| ID / priority | Procedure | Pass condition | Method and starting point |
|---|---|---|---|
| C01 / P0 | Two browser contexts edit the same facts/artifact/scores; save in opposite orders; lose connection during save; cancel navigation/workspace switch with edits | Stale save rejected visibly; local unsaved values and newer server data preserved; UI does not claim failed writes succeeded | Existing integrity/workspace/organization tests; add browser conflict cases |
| C02 / P0 | Trigger research; lose start response; retry/double-click; reload; cancel; restart server; edit target facts or revoke authority while job runs | At most one operation for the same start; visible terminal/interrupted state; no unauthorized write, stale overwrite or automatic paid replay; partial facts require review | Existing `tests/research.js` and browser research spec; add only uncovered boundaries |
| C03 / P0 | Inject missing key/model, 429, provider 5xx, malformed output, deadline, hostile source content and budget exhaustion | Safe actionable error; bounded retries/concurrency; earlier usage accounted for and unknown cost labeled; core manual search work remains usable; AI cannot bypass access or human review | Existing AI reliability/research/security suites |
| C04 / P1 | On hosted staging, run one bounded public-jurisdiction research job and a representative draft for every model path enabled in pilot; exercise cancellation separately | Record first response, crawl time, rounds, total time, request IDs, status and usage/cost; saved facts/sources reviewed; reload works; configured 180-second research bound is handled cleanly, including partial/failure outcome | Models preflight plus hosted manual run; entitlement alone does not pass |
| C05 / P0 | In a disposable populated environment inject write/media failure; interrupt during save; restart after job cancellation; attempt a second writer | No false success or corrupt committed record; prior photos/history readable; second writer refused; interrupted work recoverable without replay | Existing storage/integrity/research suites; extend process-level fault cases as needed |
| C06 / P1 | Disconnect/reconnect, sign out, use Back, switch firm, and update/reload an installed app with an older shell | No private cached response or wrong-firm content; no false saved state; clear retry/sign-in path; shell refreshes successfully | Extend browser policy/workspace tests; physical Safari/PWA check because WebKit CI blocks workers |

### Series D — Human usability, accessibility and output

Owner: search owner, accessibility tester, and representative committee/candidate testers.

| ID / priority | Procedure | Pass condition | Method and starting point |
|---|---|---|---|
| D01 / P0 | Keyboard-only and screen-reader pass through real sign-in, invitation acceptance, candidate draft/submit, committee scoring, errors, dialogs and research progress | Every essential action is reachable and named; no focus trap/loss; errors/status announced; an actual user can finish each task | Existing axe/reflow tests plus NVDA with Chrome or Edge; VoiceOver with Safari for the iPhone path |
| D02 / P1 | Repeat candidate and scoring journeys on physical iPhone Safari and Android Chrome; test on-screen keyboard, rotation, zoom and slow connectivity | No obscured required controls, lost draft or unusable scrolling; clear receipt and recovery; device/OS/browser versions recorded | Manual devices; Chromium emulation remains supplementary |
| D03 / P1 | Generate print samples; inspect every page of brochure, ad plan, candidate answers and panel materials; print representative long output on paper | No clipped fields, missing answers, inappropriate internal notices or unusable page breaks; external-facing output matches reviewed content | `npm run print:samples` and visual/paper sign-off; if tagged accessible documents are required, verify a separate accepted delivery path |
| D04 / P1 | A consultant, committee member and candidate complete assigned tasks without coaching; trigger one validation and one connection error; find support | Each task completed without administrator repair; confusion and assistance recorded; support/accommodation details visible and staffed; manual notification and resume handoff understood | Moderated rehearsal; screenshots and task notes, no real candidate data |

### Series E — Hosted operations and release

Owner: primary operator with backup operator; engineer supports instrumentation.

| ID / priority | Procedure | Pass condition | Method and starting point |
|---|---|---|---|
| E01 / P1 | Measure hosted ordinary reads/saves with 100 candidates, 15 accounts and 20 concurrent user sessions; include realistic think time, independent writes, brief same-record collisions, photos and scheduled backup | Target p95 below 1 second for ordinary reads and saves; zero lost acknowledged writes or unexpected errors; expected conflicts recover cleanly; no sustained memory growth/disk exhaustion | Keep local load baseline; build an opt-in hosted harness; proposed 5-minute warmup, 15-minute load and 60-minute soak |
| E02 / P0 | Save known populated records and photos; deploy/restart container on persistent storage; test schema upgrade on a copy and clean shutdown | Record fields, original answers, scores/history and media survive; one writer only; incompatible schemas fail clearly; interrupted jobs do not remain permanently running | Extend container CI assertions plus hosted drill |
| E03 / P0 | Retrieve independent backup using backup operator access; verify checksums; restore to an empty separate volume; validate fixture and real Clerk access | Complete records and media recovered; revoked memberships still denied; no restored local sessions; measured recovery point/time meet agreed targets (proposed one hour/four hours) | Existing recovery suite plus timed [operations runbook](operations.md) drill |
| E04 / P0 | Break backup destination or make snapshot overdue in staging; simulate service outage; observe alert and recovery | Actual named recipient gets actionable alert, backup operator can respond, and recovery clears it; record timestamps and escalation path | Existing monitoring suite plus live staging delivery drill |
| E05 / P0 | Roll back staging using identified last-good image and compatible snapshot; restore service and repeat critical smoke | Operator can execute the documented rollback, data impact is known, health and critical journeys recover, release identity is accurate | Manual runbook rehearsal; never assume an older binary can read a newer schema |

For E01, report sample count, p50/p95/p99, maximum, errors, expected conflicts, CPU/memory/disk, store/history size and Clerk directory latency. Separate AI timings from ordinary API latency. Twenty request loops in the current local load script are not twenty browser sessions. Thresholds beyond the documented one-second target and proposed recovery targets must be agreed before the run, not adjusted afterward to make it pass.

## 5. Implementation and execution order

| Work package | Deliverable | Dependency / exit |
|---|---|---|
| 1. Establish baseline | Select exact release; Node/runtime alignment; fresh suite reports; resolve stale checklist language and scope mismatch | Can start immediately; all failures classified |
| 2. Add missing regressions | Connected workflow, candidate retry, browser conflict, two-tab privacy and populated-container assertions | Extend existing helpers/specs; each fixed defect gets a targeted regression |
| 3. Rehearse locally | Executive full journey plus Basic/Enhanced checks; keyboard, axe and print results | Automated P0 checks green; outputs reviewed |
| 4. Prove hosted dependencies | Real Clerk lifecycle, bounded AI, hosted load, persistent storage and configuration | Dedicated staging, recipients, operator access and budget in place |
| 5. Prove human and operational readiness | Physical devices, screen reader, unassisted role tasks, off-volume restore, alert and rollback drills | Named participants; required defects fixed and retested |
| 6. Decide readiness | Evidence packet, resolved pilot decisions, second-person review, release-specific go/no-go | All required gates satisfied; owner decides live onboarding |

Suggested additions: `tests/browser/pilot-journey.spec.js`, `tests/browser/conflicts.spec.js`, `tests/browser/candidate-recovery.spec.js`, and `tests/hosted/pilot-load.js`. These are proposed files, not implemented commands. Keep real-service tests separate from default CI, require an explicit staging target and synthetic run marker, bound duration/calls, and clean up only records created by that run. Browser tests should use condition-based waits and independent contexts for concurrent users; a single application writer does not eliminate concurrent browser requests.

Use existing commands for the baseline, in a clean test environment:

```text
npm ci
npm run check
npm test
npx playwright install chromium webkit
npm run test:browser
npm audit --omit=dev --audit-level=moderate
npm run test:load
npm run print:samples
```

Container evidence comes from CI on the same release. The audit and browser installation need network access. Load and print commands produce measurements/artifacts requiring review, not automatic pilot approval. `npm run preflight` is a separate real-provider metadata check with configured environment; it makes no generation call and does not replace C04.

## 6. Full rehearsal script

Run against one connected record so disconnected API fixtures cannot hide missing UI handoffs. For the rehearsal itself, perform user work through the UI; use API assertions afterward to verify record integrity.

1. Administrator invites controlled consultant and committee accounts; recipients accept and select the intended firm.
2. Consultant creates Example County's Executive search, records authoritative facts, adds committee members, and confirms the roster.
3. Members submit private input; manager closes the window and adopts consensus; consultant prepares and reviews the recruiting materials.
4. Consultant adds synthetic candidates and communicates links through the agreed manual process. Candidate saves a draft, reloads, submits, and verifies a receipt.
5. Reviewers independently score. Reproduce a concurrent-edit conflict, then resolve it. Release scores and deliberately revise one criterion to verify reassessment/history.
6. Advance a semifinalist, open the second questionnaire, log the actual communication, collect the response and record video work.
7. Advance a finalist, record consent and reference work, then prepare included finalist/contract/evaluation artifacts. Record a hiring outcome and a separate withdrawal or rejection with evidence.
8. Export the record and reconcile it to the known actions. Close the search, prove old links fail, reopen it deliberately, and prove links do not reactivate automatically.
9. Restore the independent backup to a separate instance. A second operator verifies answers, question versions, decisions, scores and media; verify removed membership still confers no access.

## 7. Evidence, defects and go/no-go

For each case record: ID, priority, named tester, timestamp, exact release (and dirty-tree snapshot if applicable), environment, configuration excluding secrets, fixture/run ID, steps, expected/actual result, `PASS / FAIL / BLOCKED / NOT RUN`, artifact links, defect reference and retest result. Store the run summary in a new `docs/pilot-runs/<run-id>.md`; do not check identity tokens, candidate bearer URLs, credentials or unsanitized traces into Git.

Save browser traces/screenshots, CI URL/image identity, sanitized server logs, representative exports, print reviews, latency measurements and timed operator drill notes. Configure CI to retain `test-results/` as well as the HTML report so failure traces/screenshots remain available. A quarantined or skipped P0 test stays an unmet gate. Fixes require the targeted case and affected suite to pass again; final approval uses a full regression run on the exact release to be deployed.

The release is eligible for a live-pilot decision only when:

- All P0 cases pass with current evidence; required P1 cases pass or have an explicitly accepted, time-limited workaround.
- The complete rehearsal succeeds, including candidate receipt, scoring privacy, closeout/export and independent restoration.
- Hosted identity, persistent storage, monitoring, performance and enabled AI paths have been exercised successfully.
- Real-device, screen-reader and print reviews are complete for the actual pilot paths.
- The applicable decisions in `pilot-decisions.md` are resolved by their owners; support and both operators are named and available.
- A second person reviews the evidence and the owner approves the specific release and onboarding action under the existing release checklist.

During the pilot, operators check health, backup freshness, failed submissions, provider errors and support issues each working day. Pause new intake on unauthorized disclosure, lost acknowledged records, unavailable essential submission paths, or loss of verified recovery protection; use the agreed incident/escalation process. Rerun relevant gates before adding firms, increasing volume, changing identity/storage/model configuration, or expanding pilot scope.
