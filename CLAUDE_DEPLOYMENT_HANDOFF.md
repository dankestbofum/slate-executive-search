# Slate deployment readiness and Arizona county pilot plan

Prepared September 6, 2026. Intended recipient: Claude working in this repository.

## 1. Objective and working instructions

Make Slate ready for a controlled pilot supporting an **appointed county administrator search in Arizona**. The county has not been identified. Deliver a tested release, deployment configuration, recovery procedures, and a usable search workflow from setup through closeout.

This is an implementation handoff, not evidence that the application is ready today. Start from the existing application and preserve its design, packages, and guided search process. Avoid a framework rewrite.

Instructions for Claude:

1. Read this file, README.md, and the implementation update at the beginning of BLINDSPOTS.md. Much of that audit describes defects already fixed; reproduce a suspected regression before reopening it.
2. Inspect the working tree before editing. It contains substantial uncommitted work. Preserve it; do not reset files or overwrite unrelated changes. Identify the actual baseline before creating commits.
3. Run `npm ci` and `npm test` in a development checkout. On Windows PowerShell, use `npm.cmd` if script execution policy blocks `npm.ps1`. Use synthetic records and isolated data directories.
4. Implement the work below in small, reviewable changes. Each completed ticket needs relevant automated checks and evidence for its acceptance criteria.
5. Continue with local implementation and synthetic staging preparation while county details are pending. Mark missing business decisions explicitly; do not invent a county, approved policy, retention period, or production credential.
6. Prepare a concrete release for the owner to review. This document does not authorize production deployment, spending on services or model calls, importing live candidate records, sending invitations, or contacting candidates or officials.
7. At handoff, distinguish implemented, verified in staging, and awaiting owner/county decisions. Passing unit tests alone is not deployment approval.

## 2. Scope and recommended pilot defaults

| Decision | Recommended starting point | What could change it |
|---|---|---|
| Pilot audience | One county, a small named consultant team, invited committee members, individually invited candidates | Multiple firms or requirements for independent client isolation |
| Search type | County; Arizona; actual appointed position title | County-approved job description and governance structure |
| Hosting | Existing Railway Docker path, if county procurement and IT approve it | Required hosting region, approved vendor list, SSO, or security controls |
| Storage | One app process and one persistent volume; retain JSON for the bounded pilot if recovery and load gates pass | Multiple writers, availability commitments, or storage/load tests that fail |
| Environments | Separate development, synthetic staging, and production data and secrets | None: production data must not be used as routine test fixtures |
| Service package | Confirm the purchased package; Executive is the working rehearsal assumption | Actual engagement scope; preserve Basic and Enhanced behavior |
| Notifications | Manual communication, explicitly logged in Slate | A requirement for automatic reminders or delivery tracking |
| Resumes and attachments | County-approved external repository, with restricted document references recorded in Slate | County requires native upload and document management |
| Hiring decisions | Human committee evaluation against adopted, job-related criteria | No automated candidate acceptance, rejection, or inferred sensitive traits in this pilot |
| Access | Named accounts for routine work and approvals | Shared account remains supported, but use it only under a documented accountability policy |
| Recovery targets | Proposed maximum one hour of data loss and restoration within four hours | Owner/county approval and measured recovery capability |

These are planning defaults, not claims about purchased infrastructure or contractual service levels. If the county requires MFA/SSO, more granular consultant access, or a different hosting arrangement, those become launch requirements before live records enter Slate.

Do not make PostgreSQL, native email delivery, public self-service applications, or native resume storage prerequisites without evidence that the pilot needs them. Conversely, do not call the JSON implementation suitable for multiple replicas.

## 3. Verified baseline and open evidence gaps

The current isolated suite was rerun for this plan: **298 checks passed**: 243 baseline, 18 county, and 37 integrity checks. It does not call paid AI services. Browser behavior, accessibility conformance, a production container, and real hosting configuration were not validated by this run.

Already implemented; preserve and extend:

- City or town / County selection in New search and Search facts, persistence, and Arizona county drafting context.
- Hashed credentials, stronger newly issued committee PINs, and session revocation on credential reset.
- Committee candidate responses that omit bearer invitations and private history.
- Search revisions and stale-write rejection, including late AI/research writes.
- Profile and questionnaire history, frozen candidate question versions, server-side answer validation, and correction/reopen flows.
- Approval invalidation, archive/restore, candidate link replacement, and verified local backups.
- Explicit manual questionnaire notification language and a deterministic test runner that exits nonzero on failure.

Observed in source; investigate and address through the tickets below:

| Area | Current evidence | Deployment implication |
|---|---|---|
| Runtime | Dockerfile and nixpacks.toml use Node 20; package.json permits >=20 | Align production, CI, and documentation on supported Node 24 LTS. Node 20 is EOL. See [Node releases](https://nodejs.org/en/about/previous-releases) and [Node EOL](https://nodejs.org/en/about/eol). |
| Production identity | Named accounts are seeded from environment; shared account is reconciled at boot; sessions last 14 days | Need reliable named-account rotation, revocation, lifecycle, and a documented session policy. Changing a seed variable is not a general account-management workflow. |
| Configuration | dotenv loads with override enabled outside tests | Ensure development .env cannot override production platform configuration. |
| HTTP controls | API responses use no-store; cookie protections and proxy configuration exist; no explicit general security-header or origin/CSRF middleware found | Validate and harden browser boundaries, media responses, and error handling. |
| Media writes | Existing photo is removed/replaced before JSON persistence succeeds | JSON rollback cannot restore the previous image; add a failure-safe media commit sequence. This risk is from source inspection, not a reproduced production incident. |
| Backup and health | Synchronous daily backup runs from API middleware, including before the health route; snapshots stay on the same volume | Separate health from backup work and establish scheduled, independent recovery copies and alerts. |
| County research | site.js link matching still includes city-manager/council patterns but lacks explicit county-administrator/supervisor patterns | County setup is implemented; county research discovery still needs targeted coverage. |
| Candidate lifecycle | Stages are applicant, semifinalist, finalist, declined | Withdrawal, selected/hired outcome, and search closeout need explicit behavior. |
| Candidate intake | Consultants create candidates; no native resume intake or notification delivery | Implement and document the external handoffs needed for the pilot. |
| AI operations | Usage is stored after successful saves; no app-wide spending/concurrency budget is evident | Failed or conflicting runs can still incur cost; meter attempts and enforce limits. |
| Quality evidence | API, helper, and some source/VM rendering checks exist; no browser test project found | Add actual browser flow tests and manual device/accessibility evidence. |

No dependency vulnerability scan, production security assessment, live model compatibility test, or county policy review is claimed by this plan.

## 4. Implementation backlog

**P0** means required before real candidate information is used. **P1** means required before the pilot starts, but an explicitly documented operational handoff may satisfy the requirement where stated. **P2** is later expansion.

### DEP-01 — Reproducible runtime and release pipeline — P0

Files: Dockerfile, package.json, package-lock.json, nixpacks.toml, railway.json, .dockerignore, .env.example, README.md; add CI configuration for the repository's actual provider.

- Update to a supported Node 24 LTS patch and align all build paths. Remove the stale alternate build configuration if it is not used; otherwise keep it consistent.
- Use lockfile installs. Audit production dependencies and container packages, investigate findings, and update selectively. Do not apply force upgrades without compatibility testing.
- Run the container as a non-root user. Verify the mounted DATA_DIR is writable under that identity, including first boot, restart, backups, and restore.
- Make production environment variables authoritative; keep local .env loading a development convenience.
- Add CI for syntax checks, the isolated suite, later browser tests, and a container build/start smoke test with an ephemeral mounted directory.
- Record release version/commit and image digest. Keep secrets, real data, backups, and client documents out of build artifacts and logs.

Acceptance: clean checkout builds reproducibly; production container boots on an empty writable volume with explicit credentials, fails clearly without required storage/credentials, and survives restart with saved synthetic records intact. CI failure prevents the release from being marked ready.

### DEP-02 — Accounts, sessions, and permission boundaries — P0

Files: server/credentials.js, server/db.js, server/index.js, public/app.js; tests for credentials and roles.

- Provide a documented administrative route or CLI for creating, renaming, disabling, and resetting named consultant accounts. Restrict administrative authority explicitly; do not expose account management publicly.
- Define minimum production credential strength, reject development defaults for new production setup, and audit existing migrated accounts. Hashing an old weak PIN does not strengthen it.
- Make credential rotation and account disabling revoke sessions. Provide a usable recovery process that does not require hand-editing JSON.
- Make session duration configurable, with an agreed maximum and expiration behavior that preserves unsaved work. Define candidate link expiration/renewal and revoke links on withdrawal/closeout as specified below.
- Retain account-aware and IP-aware login limits. Test actual proxy routing, shared county egress IPs, restart behavior, malformed credentials, and repeated expensive password verification. Bound abusive request volume without locking every committee member out behind one NAT address.
- Preserve the deliberate firm-wide consultant access model. County participants are committee accounts unless explicitly authorized as consultants. If search-specific consultant access is needed, implement it before onboarding them.
- Decide MFA/SSO with the county. If required, use an established identity provider; do not build a bespoke MFA system.

Acceptance: a role matrix test covers consultant, manager, committee, unrelated committee, disabled user, unauthenticated visitor, and candidate token across facts, responses, media, history, exports, scores, archive, and account actions. Revoked sessions and replaced links fail immediately. Shared-account actions are never falsely attributed to an individual.

### DEP-03 — HTTP security, privacy, and input boundaries — P0

Files: server/index.js, server/site.js, public/index.html, public/app.js, public/sw.js.

- Add appropriate security headers, including frame restrictions, MIME sniffing protection, and a tested Content Security Policy. Roll out CSP with actual UI/print tests; current styles and fonts need compatible treatment.
- Establish same-origin/CSRF protection for authenticated mutations, including login/logout as appropriate. Define expected behavior for requests without Origin and preserve authorized CLI/test use. SameSite cookies are useful but should not be the entire review.
- Apply private/no-store policy to protected media and candidate pages as appropriate, not only /api. Use a restrictive referrer policy on bearer-link pages. Redact candidate tokens, session IDs, passwords, and bodies from app, hosting, analytics, and error logs.
- Review external font requests. Prefer bundled fonts for predictable printing and fewer third-party requests on candidate pages. Do not add analytics to bearer-link pages by default.
- Extend server validation to candidate fields, artifact structures, URLs, and bounded text/array sizes. Keep a narrow larger limit for images if needed; ordinary JSON requests should not inherit an unnecessary upload allowance.
- Return safe structured production errors and correlation IDs; retain diagnostic details only in restricted logs. Test malformed JSON and persistence failures.
- Add conservative rate/concurrency limits for unauthenticated candidate routes, media uploads, generation, and research. Preserve existing DNS-pinned public-site fetching and test reserved/private addresses, redirects, and malformed URLs. Treat researched pages as untrusted input.

Acceptance: adversarial and role tests demonstrate no stored-script execution through supported input paths, no access to another search, no private media from browser cache after a revoked session without a valid server response, no sensitive PWA cache entries, and no bearer URLs or secrets in ordinary request/error logs. Document any residual browser cache limitation honestly.

### DEP-04 — Failure-safe storage and deployment lifecycle — P0

Files: server/db.js, server/index.js media handlers, server/backup.js, container/deployment configuration.

- Keep one process writing the JSON store. Ensure deploy/restart behavior cannot start a second writer against the volume. Document that PM2 clustering and multiple replicas are unsupported.
- Reproduce media failure cases, then write new images to unique staged files and validate/decode them before publishing references. Commit JSON only when its referenced image exists; retain the previous image until the new state is durable. Apply the same discipline to deletion and historical artifact restoration.
- Review how history references photo URLs: restoring a historical brochure must not silently display unrelated replacement bytes. Preserve referenced versions or explicitly communicate unavailability.
- Introduce an explicit schema version and ordered migrations with fixtures covering legacy, current, and archived searches. Back up before migration and make migration failure fail safely instead of partially starting.
- Add SIGTERM handling: stop accepting writes, allow bounded requests to finish, handle active AI work predictably, and close cleanly. Verify the host's termination allowance.
- Bound application and history growth through monitoring and approved archival practices. Do not truncate records or silently delete history to solve performance problems.

Acceptance: injected disk-write failure, corrupt input store, process restart, interrupted media replacement, and migration failure preserve the last committed record and valid media. A previous release is used only with a compatible store, or restored together with its matching snapshot. Load testing confirms JSON is acceptable for the agreed pilot envelope.

### DEP-05 — Scheduled recovery outside the app volume — P0

Files: server/backup.js, scripts/backup.js; add deployment-specific scheduling/copy configuration and docs/operations.md.

- Retain verified local snapshots, but create recovery copies in a separate storage failure domain under a controlled account, with encryption and limited access. Identify who can restore if the primary hosting account is unavailable.
- Implement a consistent hourly snapshot path if the proposed one-hour recovery point is accepted. Do not run the existing manual snapshot CLI against a live writing store: coordinate snapshots in-process or pause writes deliberately.
- Copy only fully published verified snapshots; verify the downloaded independent copy before calling backup successful. Record age and outcome without logging record contents.
- Set retention with the owner and records officer, including legal holds. Separate short operational backup rotation from the official records retention policy. No automatic destructive retention job until that policy is approved.
- Move expensive backups off the health/request path. Define degraded behavior for backup failure, disk exhaustion, and overdue independent copies; alert an operator rather than turning every API request into an opaque error.
- Configure platform volume backups as an additional layer where available. Render documents [persistent disks](https://render.com/docs/disks), including their snapshot behaviour and the constraints a disk places on a service; verify the selected account's configuration instead of assuming defaults.

Acceptance: restore an independently downloaded snapshot into an empty environment. Verify a search, its committee access, candidate answers and original questions, scores/history, and brochure images; old login sessions must remain invalid. Record elapsed recovery time and recoverable snapshot age. No off-volume restore evidence means no live pilot.

### DEP-06 — Health, monitoring, and support operations — P0

Files: server/index.js, server/ai.js, deployment config; docs/operations.md.

- Separate cheap liveness from readiness. Readiness should reflect loaded data, startup validation, shutdown state, and usable storage without expensive full backups or paid AI calls.
- Keep core manual search work usable during an Anthropic outage; expose AI availability separately to consultants.
- Add structured request/error logging with correlation IDs, safe route names, status, timing, and release identifier. Record actor IDs for audit events without copying candidate answers into telemetry.
- Track uptime, error rate, disk use, store size, memory/event-loop delay, backup age, failed backups, AI latency/failures, and AI usage. Configure alerts with an actual recipient and escalation backup.
- Document handling for login loss, candidate link replacement, failed submissions, stale saves, wrong published copy, AI outage, lost volume, and suspected disclosure. Give candidates a real support/accommodation contact on their page.

Acceptance: staging can intentionally trigger and clear an uptime/backup alert. The operator can find the relevant sanitized log using a support correlation ID. A named primary and backup operator can execute the runbook.

### DEP-07 — Finish county setup and factual verification — P1

Files: server/jurisdictions.js, server/site.js, server/ai.js, server/brochure.js, public/app.js, tests/jurisdictions.js.

- Preserve the existing County selector. Do not infer the county's identity or statutory authority from the position title.
- Extend site discovery for county administrator/manager, board of supervisors, elected officials, adopted budget, organizational chart, and strategic-plan pages. Test with synthetic HTML and redirects; do not make CI depend on county websites.
- Audit remaining municipal assumptions in error messages, brochure field labels, suggested criteria, recruiting outlets, and prompts. Keep stored JSON keys backward compatible.
- Capture or clearly structure the governing body, reporting relationship, separately elected offices, appointment authority, service responsibilities, employment terms, application method, and responsible fact reviewer. Require source/date evidence for material public claims.
- Use Board of Supervisors terminology for Arizona county context, but validate the actual county-approved job description and authority rather than treating generated text as authoritative.
- Show which facts are confirmed versus still missing. County policy choices and contract clauses remain human-reviewed drafts.

Acceptance: create and reload an Arizona County Administrator search, then produce and review its community profile, brochure, ads, questionnaires, interview guide, schedule, agreement, and evaluation. No unjustified city-manager authority or municipal-only recruiting assumptions remain. A municipal regression fixture still behaves correctly.

### DEP-08 — Candidate intake, communications, and submission recovery — P1

Files: server/index.js candidate/questionnaire routes, public/app.js; corresponding tests.

- Add search-specific instructions, support/accommodation contact, and owner-approved privacy/data-use notice to candidate pages. State whether dates are advisory or enforced and include the relevant timezone.
- Record application/resume receipt and an access-controlled external document reference. Validate permitted URL schemes; never make a private document publicly shareable simply to fit Slate. Keep reference/background-check material under its appropriate narrower access rules.
- Add a manual communication log: candidate, purpose, channel, actor, timestamp, and follow-up date. Label this as staff-recorded contact, not provider-verified delivery. Support practical copy-link/message templates without sending automatically.
- Preserve answers through validation errors and network retries. Resolve the case where submission committed but the response was lost: reload status and show a receipt instead of encouraging duplicate or conflicting submissions.
- Supply a submission timestamp/receipt and correction instructions. Test accidental reload and mobile browser suspension. If long-answer drafts cannot recover reliably, implement a scoped, expiring server-side draft mechanism; do not silently store sensitive answers indefinitely in localStorage.
- Existing correction/reopen must retain the prior submission, original questions, and link/version behavior. A new draft-saving mechanism must not mutate submitted answers.

Acceptance: a synthetic candidate can obtain materials through the chosen process, submit on mobile, survive a simulated connection failure without losing a committed response, get a receipt, and request a correction. Staff can identify who still needs follow-up. Native email and native attachments may remain deferred only when this documented external process has been rehearsed.

### DEP-09 — Withdrawal, disposition, and search closeout — P1

Files: server/index.js, server/db.js, server/steps.js, server/integrity.js, public/app.js.

- Define explicit outcomes, at least withdrawn, not selected, selected/hired, and search closed/cancelled as appropriate. Separate candidate status from the search's overall lifecycle; do not overload Archive as the hiring decision.
- Record decision actor, timestamp, reason, and supporting job-related evidence. Make a correction a new event rather than erasing the original decision.
- Support a staff-recorded withdrawal request, revoke submission access, retain required history, and prevent new scoring/advancement that contradicts the status. Decide whether direct candidate withdrawal is required; staff-assisted withdrawal is acceptable for the pilot if clearly advertised and promptly handled.
- Closeout should freeze ordinary edits and submissions, summarize disposition, identify final documents, and allow a deliberate authorized reopening with a reason. Renew links only deliberately; do not resurrect old bearer links.
- Keep declined, withdrawn, and hired candidates out of inappropriate later-stage actions while preserving their historical evaluations.

Acceptance: rehearse withdrawal, selection, no-hire cancellation, closeout, archive, restoration, and authorized reopening. Verify links, roles, history, score visibility, and reopened questionnaire access at each transition.

### DEP-10 — Records export, decision attribution, and county review — P0

Files: server/db.js, server/integrity.js, server/index.js, public/app.js; add docs/pilot-decisions.md.

- Add a restricted consultant export for a complete search record: facts, source references, adopted criteria/revisions, question versions, responses, score explanations, approvals, communications, disposition, and related media/document inventory.
- Supply machine-readable records and a readable report suitable for review. Preserve timestamps, version relationships, and provenance. Clearly identify external documents that must be exported from their original repository.
- Exclude credential hashes, active sessions, invitation tokens, API secrets, and unrelated searches. Respect sealed scoring and narrower reference-information access; export must not become an alternate privacy bypass.
- Use stable actor IDs plus displayed names for material decisions. Distinguish system events and candidate submissions from authenticated consultant decisions. Current JSON history is recoverable history, not a tamper-proof audit service; document that limitation and evaluate stronger audit storage if the county requires it.
- Have county counsel/records staff classify records, assign the applicable schedule, define legal-hold and disclosure procedures, and approve candidate notices. Do not promise confidentiality merely because Slate requires login.
- Record approval of AI data use, vendors, hosting, retention, accessibility obligations, and any public-meeting handling. Keep sensitive session materials out of broadly visible committee fields unless that access is specifically approved.

Acceptance: an authorized export reconciles to a synthetic search and can be understood without the running app; unauthorized roles cannot obtain it. The owner has a documented records custodian and county review outcome before real records are collected.

Use official material as review inputs: [Arizona retention schedules](https://azlibrary.gov/arm/retention-schedules) and [Arizona executive-session statute](https://www.azleg.gov/ars/38/00431-03.htm). The exact county, record classifications, and circumstances determine the operational policy; this plan does not assign legal retention periods or decide disclosure questions.

### DEP-11 — AI reliability, cost control, and human review — P0

Files: server/ai.js, server/desk.js, server/index.js, server/site.js, public/app.js, .env.example.

- Verify configured model IDs and tool/effort compatibility against the actual Anthropic account. Existing names are configuration, not evidence of entitlement. Consult [model IDs and versions](https://platform.claude.com/docs/en/about-claude/models/model-ids-and-versions) and [Models API](https://platform.claude.com/docs/en/api/typescript/models). Recheck at implementation time.
- Add an operator preflight that reports missing credentials, unavailable models, and disabled capabilities safely. Real calls belong in an explicitly authorized synthetic staging test, never the normal isolated suite.
- Configure bounded timeouts, retries, research/tool turns, concurrent calls, and per-search/per-day usage limits. Log attempts and available usage even when a generated result is rejected as stale; distinguish known usage from estimates and unknown billed failures.
- Ensure generation fits the host's actual request timeouts. If it cannot, implement persistent job IDs/status and safe retry/cancel semantics before launch; do not hide the issue by increasing only the browser timeout.
- Treat web pages, workshop notes, and uploaded/external text as data, not instructions. Add prompt-injection fixtures and keep source checking separate from instructions governing permissions and publishing.
- Minimize submitted personal information. Keep drafting advisory, preserve source references, require human fact/criteria review, and never make autonomous hiring or rejection decisions.
- Handle missing key, wrong model, rate limit, timeout, malformed JSON, partial research, unsupported tool, interrupted request, and conflict while preserving existing work. Allow manual editing when AI is unavailable.

Acceptance: deterministic failure tests pass; an authorized staging run validates at least one real draft and one research job with measured latency and cost. A consultant can inspect sources, correct output, and approve the exact revision. AI failure cannot overwrite newer work or disable core manual workflows.

### DEP-12 — Browser, accessibility, and print quality — P0

Files: public/app.js, public/app.css, public/styles.css, public/index.html, public/sw.js; add browser automation and accessibility checks.

- Add real browser tests, such as Playwright against an isolated server, for the journeys in section 6. Source-text assertions can remain as inexpensive guards but cannot substitute for interaction tests.
- Verify desktop Chrome/Edge and Safari/WebKit coverage, Android Chrome, and iPhone Safari. Emulated viewport checks do not establish real-device browser behavior; include at least one real phone rehearsal.
- Check keyboard access, focus restoration, modal focus trapping, accessible labels, errors, live announcements, status indicators, contrast, zoom, touch targets, and screen-reader flow. County forms and candidate questionnaires are priority paths.
- Use WCAG 2.1 AA as the minimum review target, with useful WCAG 2.2 improvements where feasible. Have the county verify applicability and current deadlines; its population and arrangements are unknown. See [DOJ guidance for state/local government web accessibility](https://www.ada.gov/resources/small-entity-compliance-guide/).
- Verify print and PDF output for long county names, long candidate responses, tables, photos, page breaks, headers, and readable text. A browser-printed PDF is not automatically an accessible tagged document; provide an accessible alternative or improve export where required.
- Verify offline/PWA behavior communicates that private work needs a connection and that logout, back navigation, application updates, and token replacement do not expose stale private content.

Acceptance: the critical journeys pass with actual browser evidence; no unresolved blocker prevents a candidate or committee member from completing a task with keyboard/assistive technology. Automated accessibility checks and manual findings are recorded separately. Print/export examples have been visually inspected.

## 5. Execution order and completion evidence

| Phase | Work | Evidence required to advance |
|---|---|---|
| A: Establish baseline | DEP-01; confirm pilot defaults and constraints | Green isolated CI, reproducible image, decision log with owners |
| B: Protect access and data | DEP-02 through DEP-06; export foundation from DEP-10 | Role/security tests, storage failure tests, independent restore drill, alerts |
| C: Complete the county workflow | DEP-07 through DEP-10 | End-to-end synthetic county search, external intake/communication procedure, export and closeout |
| D: Validate AI and interaction | DEP-11 and DEP-12; start browser coverage earlier as flows stabilize | Authorized AI smoke results, browser/mobile/accessibility and print evidence |
| E: Rehearse and release | Section 7 gates and section 8 runbook | Signed release checklist, matching rollback snapshot/image, trained operators |

Planning allowance: approximately **15–25 focused developer days** for the bounded pilot, subject to reproduction findings and the external decisions below. This is not a delivery commitment. MFA/SSO, a database migration, native attachment intake, or a new email system would require re-estimation. County review and account provisioning can take additional calendar time.

Every ticket should produce: a short change description, affected files, meaningful tests, remaining limitations, and a link to its evidence. Do not report a ticket complete merely because a checklist was written.

Suggested delivery documents: docs/pilot-decisions.md, docs/operations.md, docs/test-evidence.md, docs/release-checklist.md, and updated README.md. These are proposed implementation deliverables; only this handoff plan exists as a result of the planning task.

## 6. Required test and rehearsal matrix

Use synthetic people and Example County until the real county authorizes onboarding. Proposed initial load envelope: one active county search, 100 candidates, 15 committee/consultant accounts, and 20 concurrent browser sessions. Confirm actual expected volume before treating this as sufficient.

| Journey or failure | Expected evidence |
|---|---|
| New county and municipal search | Correct type, saved facts, package behavior, reload and editing |
| Committee setup/intake/adoption | Correct manager authority, private inputs, published consensus, stable criteria and revisions |
| Candidate and committee isolation | No other search, candidate credential, private staff record, or sealed score exposure |
| Two consultants editing | Stale save rejected; both local draft and newer saved work preserved |
| AI/research finishes after another edit | Newer work retained; conflict visible; usage attempt accounted for |
| Initial and semifinalist response | Required fields, original question versions, receipt, retry after lost response, correction |
| Scoring and profile revision | Score bounds, escaped rendering, sealed/released views, history and reassessment |
| Consent and references | No reference contact without recorded candidate consent; changed evidence reopens completion |
| Withdrawal and closed search | No further submission/advancement without deliberate reopening; prior record retained |
| Export | Complete related records, external document inventory, no secrets or unrelated data |
| Media replacement/disk failure | Previous committed photo and record remain usable; rollback does not corrupt history |
| Restart/deploy/migration | Single writer, saved records/media persist, correct schema, clean shutdown |
| Independent restore | Checksums verified; complete selected records; no resurrected sessions; recovery targets measured |
| AI failure | Missing key/model, 429, timeout, malformed response, and hostile source content fail safely |
| Mobile/accessibility | Candidate submission and committee scoring usable on actual devices and keyboard/screen reader |
| Print/PDF | Brochure, panel materials, and long answers readable, with required accessible alternatives |
| Load and growth | Proposed target: ordinary reads/saves p95 under 1 second, no lost writes, bounded memory; measure AI separately |

Test expensive AI calls with stubs for load tests. Measure backups, candidate page opening, concurrent scores, history growth, and media separately because the JSON store and synchronous operations can amplify latency. Change the storage architecture if the agreed envelope cannot be met safely.

## 7. Release gates and decisions that cannot be inferred

Three distinct gates:

1. **Technical staging ready:** supported container; all relevant automated checks pass; security/storage controls implemented; synthetic browser and recovery evidence complete.
2. **County onboarding ready:** county and position identified; vendor/hosting, access, records, AI data use, notice, accommodation, application method, and support arrangements accepted by responsible people.
3. **Live pilot ready:** staging rehearsal accepted; production storage/secrets/monitoring configured; independent backup verified; operators trained; owner explicitly approves the specific release and onboarding action.

Outstanding decisions and suggested owners:

| Decision | Owner | Work can continue before answer? |
|---|---|---|
| County, official job description, appointing body, package, dates | Search owner and county HR | Yes, with synthetic fixtures |
| Who may see applications, reference notes, scores, and drafts | Search owner, HR, counsel | Yes for existing roles; changes need resolution before real access |
| Hosting vendor/region, procurement, MFA/SSO requirements | County IT/procurement and app owner | Yes for portable container/staging preparation |
| Data ownership, records custodian, retention/hold/disclosure policy | County records officer and counsel | Yes for export capability; no live collection or automated purge |
| AI processor/data-use approval and spending cap | County and app owner | Yes with mocked calls; no real candidate data in AI tests |
| Resume repository and manual notification responsibility | Search operations | Yes; configure actual handoff before invitations |
| Support/accommodation contact and coverage hours | Search owner and county HR | Yes; must be visible and staffed for pilot |
| Recovery point/time, maintenance window, incident response owner | App owner and technical operator | Yes with proposed targets; verify before launch |
| Accessibility scope/current deadlines and accepted alternatives | County accessibility lead/counsel | Yes; test accessible critical paths now |

Do not enter real candidate information while a P0 control is unverified. Any proposed exception must state the specific unmet criterion, consequence, compensating measure, owner, and expiry; it is not permission to waive county obligations.

## 8. Deployment, rollback, and pilot operation runbook

Pre-deployment:

1. Freeze a reviewed release identifier; inventory included migrations and known limitations. Confirm no secrets or client records are committed.
2. Build the exact tested image. Provision separate production storage, HTTPS/domain, explicit production configuration, named accounts, approved proxy settings, and alert destinations.
3. Disable demonstration credentials and check inherited accounts as well as first-boot variables. Verify container/volume permissions.
4. Use a planned write pause for migration or snapshot operations that require consistency. Take and verify a fresh backup; copy it independently. Record which image and schema it belongs to.
5. Confirm the last-good image and matching restore path. Application rollback alone is not sufficient after an incompatible schema change.

Deployment and smoke test, after owner authorization:

1. Deploy one writer. Check readiness, HTTPS, secure cookies, storage, and logs.
2. Run a tightly scoped synthetic smoke flow: consultant login, county search, committee restriction, candidate questionnaire/receipt, document/media access, export, logout. Do not run the existing destructive/mutating live test suite against real searches.
3. Restart once and verify persistence. Confirm the independent backup schedule and trigger an alert test.
4. Have a second person review the release checklist. Open the pilot only after both technical evidence and business approvals are recorded.

Rollback or incident:

1. Stop onboarding and affected writes. Preserve logs and the current volume for diagnosis; do not delete it as a recovery shortcut.
2. Determine whether reverting the image is schema-compatible. Otherwise restore the matching verified snapshot into a new empty volume and deploy its compatible image.
3. Revalidate permissions and representative records, require new logins, and reconcile any submissions after the recovered snapshot. Do not ask a candidate to resubmit until staff have checked whether the original committed.
4. Revoke exposed credentials/links when appropriate and follow the named incident/records procedure. Document cause, affected records, recovery window, and prevention before resuming.

Pilot operation:

- First week: daily review of errors, backup age, submission issues, AI spend, and user feedback; verify candidate follow-ups against the manual contact log.
- Weekly: review unresolved defects, permissions, archive growth, and factual/AI quality; test a sample export. Track operator minutes per candidate and actual support requests.
- Before expansion: repeat independent restoration, evaluate load and costs against observed usage, close serious privacy/data-integrity/accessibility issues, and obtain pilot feedback from a consultant, committee member, and candidate.

Suggested success measures: zero confirmed cross-search disclosures or lost committed submissions; every material approval/disposition attributable; recovery targets demonstrated; no critical workflow/accessibility blocker; all recruiting claims human-reviewed; no unassigned candidate follow-ups. Define numerical completion/time targets with the pilot owner once its actual audience is known.

## 9. Explicit post-pilot backlog — P2 unless requirements change

- Transactional email, verified delivery/bounce status, and automated reminders.
- Native resume/attachment intake with file validation, scanning, storage permissions, retention, and accessible download behavior.
- Public application intake, duplicate candidate detection, and broader applicant tracking.
- PostgreSQL, multiple instances, background workers, and stronger tenant isolation for multiple firms or larger operations.
- Recurring annual evaluation cycles, calendar integrations, advanced reporting, and client dashboards.
- Broader SSO integrations if not already required for the first county.

Prefer completing and rehearsing the bounded pilot over expanding these features during hardening. Promote a deferred item only when the actual county workflow or acceptance evidence makes it necessary.

## 10. Final handoff expected from Claude

Deliver the implementation and updated operational documents, with a concise report covering:

- Ticket status and links to changed files and test evidence.
- Exact commands, runtime/image versions, browser/device coverage, and pass/fail results.
- What was tested with stubs versus actual external services.
- The measured restore result, backup configuration, monitoring owner, and tested rollback path.
- Remaining owner/county decisions, residual limitations, and which release gate is reached.
- The exact release proposed for approval and its migration implications.

Use the wording **ready for synthetic staging**, **ready for county review**, or **ready for authorized pilot launch** only when the corresponding gate is supported by evidence. Do not substitute a general “production ready” claim for that evidence.
